#!/usr/bin/env python3

import http.cookiejar
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PORTAL_URL = "http://127.0.0.1:18082"
PASSWORD = "Sirk-Portal-Test!2026-Strong"
ACCESS_CODE = "sirk-break-glass-test-access-code-2026"
EXPECTED_VERSION = "0.1.1.0"


class Client:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.csrf_header = ""
        self.csrf_token = ""

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        headers: dict[str, str] | None = None,
        expected: int = 200,
    ) -> tuple[dict, bytes, dict[str, str]]:
        body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request_headers = {"Accept": "application/json"}
        if payload is not None:
            request_headers["Content-Type"] = "application/json"
        if method in {"POST", "PUT", "PATCH", "DELETE"} and self.csrf_header:
            request_headers[self.csrf_header] = self.csrf_token
        request_headers.update(headers or {})
        request = urllib.request.Request(
            PORTAL_URL + path,
            data=body if method in {"POST", "PUT", "PATCH", "DELETE"} else None,
            headers=request_headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=10)
            status = response.status
            raw = response.read()
            response_headers = {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
            response_headers = {key.lower(): value for key, value in error.headers.items()}
        if status != expected:
            raise RuntimeError(
                f"{method} {path}: expected HTTP {expected}, got {status}: {raw.decode('utf-8', errors='replace')}"
            )
        value = json.loads(raw.decode("utf-8")) if raw else {}
        return value, raw, response_headers

    def csrf(self) -> None:
        value, _, _ = self.request("GET", "/api/v1/auth/csrf")
        self.csrf_header = value["headerName"]
        self.csrf_token = value["requestToken"]


def wait_ready(timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(PORTAL_URL + "/readyz", timeout=2) as response:
                value = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and value.get("status") == "ready":
                    return
        except Exception as error:  # noqa: BLE001 - bounded startup retry
            last_error = error
        time.sleep(0.2)
    raise RuntimeError(f"Portal did not become ready: {last_error}")


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-native-api.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-portal-native-") as temporary_directory:
        data_root = Path(temporary_directory) / "data"
        data_root.mkdir(mode=0o700)
        environment = os.environ.copy()
        environment.update(
            {
                "ASPNETCORE_ENVIRONMENT": "Development",
                "ASPNETCORE_URLS": PORTAL_URL,
                "Sirk__DataRoot": str(data_root),
                "Sirk__Central__Enabled": "false",
                "Sirk__CentralTunnel__Enabled": "false",
                "SIRK_BOOTSTRAP_PASSWORD": PASSWORD,
                "SIRK_BOOTSTRAP_ACCESS_CODE": ACCESS_CODE,
            }
        )
        process = subprocess.Popen(
            ["dotnet", str(portal_dll)],
            cwd=portal_dll.parent,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_ready()
            client = Client()

            status, _, _ = client.request("GET", "/api/v1/setup/status")
            if status.get("initialized") is not True:
                raise RuntimeError("Portal bootstrap identity was not initialized.")

            for legacy in ("/api/session", "/api/bootstrap", "/api/login"):
                client.request("GET", legacy, expected=404)

            client.request("GET", "/api/v1/admin/settings", expected=401)
            login, _, _ = client.request(
                "POST",
                "/api/v1/auth/login",
                {
                    "userName": "admin",
                    "password": PASSWORD,
                    "accessCode": ACCESS_CODE,
                },
                headers={"Authorization": "Bearer " + ACCESS_CODE},
            )
            if login.get("user", {}).get("role") != "Break-Glass":
                raise RuntimeError("Break-Glass login did not return the expected role.")

            session, _, _ = client.request("GET", "/api/v1/auth/session")
            if session.get("authenticated") is not True or "*" not in session["user"]["permissions"]:
                raise RuntimeError("Authenticated session permissions are invalid.")
            client.csrf()

            identity, _, _ = client.request("GET", "/api/v1/admin/identity/")
            if len(identity["value"]["users"]) != 1:
                raise RuntimeError("Identity store contains an unexpected user count.")

            group_result, _, _ = client.request(
                "POST",
                "/api/v1/admin/agent-groups",
                {
                    "action": "create",
                    "id": "test-group",
                    "name": "Test Group",
                    "description": "Native API acceptance group",
                    "portalOrigin": "https://portal.example",
                    "interactive": False,
                },
            )
            enrollment_token = group_result["credential"]["enrollmentToken"]
            if not enrollment_token or "SIRK Agent" not in group_result["bootstrapScript"]:
                raise RuntimeError("Agent group credential or bootstrap script is missing.")

            updated_policy, _, _ = client.request(
                "PUT",
                "/api/v1/admin/agent-policies",
                {
                    "scopeType": "group",
                    "scopeId": "test-group",
                    "policy": {"remoteDesktopEnabled": True},
                },
            )
            if updated_policy.get("value", {}).get("version") != 1:
                raise RuntimeError("Agent policy revision was not created.")
            listed_policies, _, _ = client.request(
                "GET", "/api/v1/admin/agent-policies"
            )
            matching = [
                value
                for value in listed_policies.get("value", [])
                if value.get("scopeType") == "group"
                and value.get("scopeId") == "test-group"
            ]
            if len(matching) != 1 or matching[0].get("policy", {}).get(
                "remoteDesktopEnabled"
            ) is not True:
                raise RuntimeError("Agent policy administration is invalid.")

            client.request(
                "DELETE", "/api/v1/admin/agent-policies/group/test-group"
            )
            policies_after_delete, _, _ = client.request(
                "GET", "/api/v1/admin/agent-policies"
            )
            if any(
                value.get("scopeType") == "group"
                and value.get("scopeId") == "test-group"
                for value in policies_after_delete.get("value", [])
            ):
                raise RuntimeError("Deleted Agent policy is still listed.")

            bootstrap, _, _ = client.request("GET", "/api/v1/bootstrap")
            if bootstrap.get("version") != EXPECTED_VERSION or not bootstrap.get("modules"):
                raise RuntimeError("Portal module bootstrap is invalid.")

            audit, _, _ = client.request("GET", "/api/v1/audit?limit=200")
            actions = {entry["event"]["action"] for entry in audit["entries"]}
            required_actions = {
                "authentication.login",
                "agent-group.create",
                "agent.policy.update",
                "agent.policy.delete",
            }
            if not required_actions.issubset(actions):
                raise RuntimeError(f"Audit log is missing actions: {sorted(required_actions - actions)}")

            client.request("POST", "/api/v1/auth/logout", {})
            client.request("GET", "/api/v1/auth/session", expected=401)

            print("SIRK Portal native API end-to-end smoke: OK")
            return 0
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            output = process.stdout.read() if process.stdout else ""
            if process.returncode not in (0, -signal.SIGTERM) and output:
                print(output, file=sys.stderr)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CI entrypoint
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
