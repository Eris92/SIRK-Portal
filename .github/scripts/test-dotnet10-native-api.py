#!/usr/bin/env python3

import base64
import hashlib
import hmac
import http.cookiejar
import json
import os
import secrets
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PORTAL_URL = "http://127.0.0.1:18082"
PASSWORD = "Sirk-Portal-Test!2026-Strong"
ACCESS_CODE = "sirk-break-glass-test-access-code-2026"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


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


def signed_agent_headers(
    method: str,
    path: str,
    body: bytes,
    device_id: str,
    device_token: str,
    nonce: str | None = None,
    timestamp: str | None = None,
) -> tuple[dict[str, str], str, str]:
    timestamp = timestamp or str(int(time.time() * 1000))
    nonce = nonce or b64url(secrets.token_bytes(18))
    body_hash = b64url(hashlib.sha256(body).digest())
    canonical = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")
    signing_key = hashlib.sha256(device_token.encode("utf-8")).digest()
    signature = b64url(hmac.new(signing_key, canonical, hashlib.sha256).digest())
    return (
        {
            "Authorization": "SIRK-Agent " + b64url(device_id.encode("utf-8")),
            "X-SIRK-Timestamp": timestamp,
            "X-SIRK-Nonce": nonce,
            "X-SIRK-Signature": signature,
            "Accept": "application/json",
        },
        timestamp,
        nonce,
    )


def agent_request(
    method: str,
    path: str,
    device_id: str,
    device_token: str,
    payload: object | None = None,
    expected: int = 200,
    fixed_nonce: str | None = None,
    fixed_timestamp: str | None = None,
) -> tuple[dict, bytes, dict[str, str], str, str]:
    body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers, timestamp, nonce = signed_agent_headers(
        method,
        path,
        body,
        device_id,
        device_token,
        nonce=fixed_nonce,
        timestamp=fixed_timestamp,
    )
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        PORTAL_URL + path,
        data=body if method in {"POST", "PUT", "PATCH", "DELETE"} else None,
        headers=headers,
        method=method,
    )
    try:
        response = urllib.request.urlopen(request, timeout=10)
        status = response.status
        raw = response.read()
        response_headers = {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read()
        response_headers = {key.lower(): value for key, value in error.headers.items()}
    if status != expected:
        raise RuntimeError(
            f"Agent {method} {path}: expected HTTP {expected}, got {status}: {raw.decode('utf-8', errors='replace')}"
        )
    value = json.loads(raw.decode("utf-8")) if raw else {}
    return value, raw, response_headers, timestamp, nonce


def verify_agent_response(raw: bytes, headers: dict[str, str], device_token: str) -> None:
    timestamp = headers.get("x-sirk-timestamp", "")
    nonce = headers.get("x-sirk-nonce", "")
    signature = headers.get("x-sirk-signature", "")
    if not timestamp or not nonce or not signature:
        raise RuntimeError("Signed Agent response headers are missing.")
    body_hash = b64url(hashlib.sha256(raw).digest())
    canonical = f"{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")
    signing_key = hashlib.sha256(device_token.encode("utf-8")).digest()
    expected = hmac.new(signing_key, canonical, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, decode_b64url(signature)):
        raise RuntimeError("Agent response HMAC is invalid.")


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

            enrollment, _, _ = client.request(
                "POST",
                "/api/v1/agent/enroll",
                {
                    "groupId": "test-group",
                    "enrollmentToken": enrollment_token,
                    "tenantId": "tenant-test",
                    "name": "Native Test Device",
                    "hostName": "native-test",
                    "platform": "windows-x64",
                    "agentVersion": "1.0.0-test",
                    "metadata": {"serial": "TEST-001"},
                },
                expected=201,
            )
            device_id = enrollment["credential"]["deviceId"]
            device_token = enrollment["credential"]["deviceToken"]
            if not device_id.startswith("dev-"):
                raise RuntimeError("Portal did not assign the canonical Agent device ID.")

            heartbeat_payload = {
                "name": "Native Test Device",
                "hostName": "native-test",
                "platform": "windows-x64",
                "agentVersion": "1.0.0-test",
                "status": "online",
                "metadata": {"serial": "TEST-001", "os": "Windows"},
            }
            heartbeat, raw, response_headers, timestamp, nonce = agent_request(
                "POST",
                "/api/v1/agent/heartbeat",
                device_id,
                device_token,
                heartbeat_payload,
            )
            verify_agent_response(raw, response_headers, device_token)
            if heartbeat.get("device", {}).get("online") is not True:
                raise RuntimeError("Agent heartbeat did not mark the device online.")

            agent_request(
                "POST",
                "/api/v1/agent/heartbeat",
                device_id,
                device_token,
                heartbeat_payload,
                expected=401,
                fixed_nonce=nonce,
                fixed_timestamp=timestamp,
            )

            client.request(
                "PUT",
                "/api/v1/admin/agent-policies",
                {
                    "scopeType": "group",
                    "scopeId": "test-group",
                    "policy": {"desktop": {"enabled": True}, "commandPollingSeconds": 5},
                },
            )
            policy, raw, response_headers, _, _ = agent_request(
                "GET",
                "/api/v1/agent/policy",
                device_id,
                device_token,
            )
            verify_agent_response(raw, response_headers, device_token)
            if policy["value"]["policy"]["desktop"]["enabled"] is not True:
                raise RuntimeError("Effective Agent policy is invalid.")

            queued, _, _ = client.request(
                "POST",
                "/api/v1/admin/agent-commands",
                {
                    "deviceId": device_id,
                    "type": "system.info",
                    "parameters": {},
                    "timeoutSeconds": 60,
                },
                expected=202,
            )
            command_id = queued["value"]["id"]
            polled, raw, response_headers, _, _ = agent_request(
                "GET",
                "/api/v1/agent/commands?limit=8",
                device_id,
                device_token,
            )
            verify_agent_response(raw, response_headers, device_token)
            if [value["id"] for value in polled["commands"]] != [command_id]:
                raise RuntimeError("Agent did not receive the queued command.")

            completed, raw, response_headers, _, _ = agent_request(
                "POST",
                "/api/v1/agent/commands/results",
                device_id,
                device_token,
                {
                    "commandId": command_id,
                    "success": True,
                    "result": {"hostname": "native-test", "ok": True},
                    "error": None,
                },
            )
            verify_agent_response(raw, response_headers, device_token)
            if completed["command"]["status"] != "completed":
                raise RuntimeError("Agent command acknowledgement was not persisted.")

            command, _, _ = client.request(
                "GET",
                f"/api/v1/admin/agent-commands/{urllib.parse.quote(command_id)}",
            )
            if command["value"]["status"] != "completed":
                raise RuntimeError("Administrator command status is not completed.")

            bootstrap, _, _ = client.request("GET", "/api/v1/bootstrap")
            if bootstrap.get("version") != "3.0.0-dev.1" or not bootstrap.get("modules"):
                raise RuntimeError("Portal module bootstrap is invalid.")

            audit, _, _ = client.request("GET", "/api/v1/audit?limit=200")
            actions = {entry["event"]["action"] for entry in audit["entries"]}
            required_actions = {
                "authentication.login",
                "agent.enroll",
                "agent.command.queue",
                "agent.command.complete",
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
    except Exception as error:  # noqa: BLE001 - CI boundary
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
