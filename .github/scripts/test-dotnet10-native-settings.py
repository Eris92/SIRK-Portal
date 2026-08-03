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

BASE_URL = "http://127.0.0.1:18084"
PASSWORD = "Sirk-Portal-Settings-Test!2026"
ACCESS_CODE = "sirk-settings-test-access-code-2026"


class Browser:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.csrf = ""

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        expected: int = 200,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        body = None
        request_headers = {"Accept": "application/json"}
        request_headers.update(headers or {})
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json; charset=utf-8"
        if method not in ("GET", "HEAD", "OPTIONS") and self.csrf:
            request_headers["X-SIRK-CSRF"] = self.csrf
        request = urllib.request.Request(
            BASE_URL + path,
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=20)
            status = response.status
            raw = response.read()
            response_headers = {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
            response_headers = {key.lower(): value for key, value in error.headers.items()}
        if status != expected:
            raise RuntimeError(
                f"{method} {path}: expected HTTP {expected}, got {status}: "
                f"{raw.decode('utf-8', errors='replace')}"
            )
        return raw, response_headers

    def json(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        expected: int = 200,
    ) -> dict:
        raw, _ = self.request(method, path, payload, expected)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def issue_csrf(self) -> None:
        value = self.json("GET", "/api/v1/auth/csrf")
        self.csrf = str(value.get("requestToken") or "")
        if not self.csrf:
            raise RuntimeError("CSRF token was not issued.")


def wait_ready(timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(BASE_URL + "/readyz", timeout=2) as response:
                value = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and value.get("status") == "ready":
                    return
        except Exception as error:  # noqa: BLE001
            last_error = error
        time.sleep(0.2)
    raise RuntimeError(f"Portal did not become ready: {last_error}")


def find_user(snapshot: dict, username: str) -> dict:
    for user in snapshot.get("users", []):
        if user.get("userName") == username:
            return user
    raise RuntimeError(f"User was not found: {username}")


def find_group(snapshot: dict, group_id: str) -> dict:
    for group in snapshot.get("groups", []):
        if group.get("id") == group_id:
            return group
    raise RuntimeError(f"Group was not found: {group_id}")


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-native-settings.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-portal-settings-") as temporary_directory:
        data_root = Path(temporary_directory) / "data"
        data_root.mkdir(mode=0o700)
        environment = os.environ.copy()
        environment.update(
            {
                "ASPNETCORE_ENVIRONMENT": "Development",
                "ASPNETCORE_URLS": BASE_URL,
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
            browser = Browser()
            browser.json(
                "POST",
                "/api/v1/auth/login",
                {"userName": "admin", "password": PASSWORD, "accessCode": ACCESS_CODE},
            )
            browser.issue_csrf()

            raw_settings_js, _ = browser.request(
                "GET",
                "/assets/settings.js",
                headers={"Accept": "text/javascript"},
            )
            settings_js = raw_settings_js.decode("utf-8")
            for marker in (
                "/api/v1/admin/settings",
                "/api/v1/admin/identity/",
                "/api/v1/admin/maintenance/status",
            ):
                if marker not in settings_js:
                    raise RuntimeError(f"Native settings asset is missing marker: {marker}")
            for legacy in ("plugin-operation", "/api/admin/runtime", "/api/system/updates/"):
                if legacy in settings_js:
                    raise RuntimeError(f"Legacy settings API is still active: {legacy}")

            settings = browser.json("GET", "/api/v1/admin/settings").get("value", {})
            portal = settings.get("portal", {})
            portal["siteName"] = "SIRK Portal Native Test"
            updated_settings = browser.json(
                "PUT",
                "/api/v1/admin/settings",
                {"portal": portal},
            ).get("value", {})
            if updated_settings.get("portal", {}).get("siteName") != "SIRK Portal Native Test":
                raise RuntimeError("Portal settings were not persisted.")

            identity = browser.json("GET", "/api/v1/admin/identity/").get("value", {})
            if find_user(identity, "admin").get("role") != "BreakGlass":
                raise RuntimeError("Bootstrap identity has an invalid role.")

            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {
                    "action": "save-group",
                    "id": "native-test",
                    "name": "Native Test",
                    "description": "Native settings E2E",
                    "memberIds": [],
                },
            ).get("value", {})
            find_group(identity, "native-test")

            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {
                    "action": "create-user",
                    "userName": "native.user",
                    "displayName": "Native User",
                    "password": "Native-User-Password!2026",
                    "role": "OperatorL1",
                },
            ).get("value", {})
            created_user = find_user(identity, "native.user")

            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {
                    "action": "update-user",
                    "id": created_user["id"],
                    "displayName": "Native User Updated",
                    "role": "SupportL2",
                    "enabled": True,
                },
            ).get("value", {})
            updated_user = find_user(identity, "native.user")
            if updated_user.get("role") != "SupportL2":
                raise RuntimeError("User role update was not persisted.")

            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {
                    "action": "save-group",
                    "id": "native-test",
                    "name": "Native Test",
                    "description": "Native settings E2E",
                    "memberIds": [updated_user["id"]],
                },
            ).get("value", {})
            if updated_user["id"] not in find_group(identity, "native-test").get("memberIds", []):
                raise RuntimeError("Group membership was not persisted.")

            maintenance = browser.json("GET", "/api/v1/admin/maintenance/status").get("value", {})
            if maintenance.get("current", {}).get("channel") != "dev":
                raise RuntimeError("Initial maintenance channel is invalid.")

            maintenance = browser.json(
                "POST",
                "/api/v1/admin/maintenance/channel",
                {"channel": "beta"},
            ).get("value", {})
            if maintenance.get("current", {}).get("channel") != "beta":
                raise RuntimeError("Maintenance channel was not persisted.")

            maintenance = browser.json(
                "POST",
                "/api/v1/admin/maintenance/backup",
                {"reason": "settings-e2e"},
            ).get("value", {})
            backups = maintenance.get("backups", [])
            if len(backups) != 1 or not backups[0].get("id"):
                raise RuntimeError("Native backup was not created.")
            backup_id = backups[0]["id"]
            maintenance = browser.json(
                "POST",
                "/api/v1/admin/maintenance/delete-backup",
                {"id": backup_id},
            ).get("value", {})
            if maintenance.get("backups"):
                raise RuntimeError("Native backup was not deleted.")

            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {"action": "delete-user", "id": updated_user["id"]},
            ).get("value", {})
            if any(user.get("userName") == "native.user" for user in identity.get("users", [])):
                raise RuntimeError("Native test user was not deleted.")
            identity = browser.json(
                "POST",
                "/api/v1/admin/identity/",
                {"action": "delete-group", "id": "native-test"},
            ).get("value", {})
            if any(group.get("id") == "native-test" for group in identity.get("groups", [])):
                raise RuntimeError("Native test group was not deleted.")

            runtime = browser.json("GET", "/api/v1/admin/runtime")
            if runtime.get("service", {}).get("version") is None:
                raise RuntimeError("Native runtime status is incomplete.")

            print("SIRK Portal native settings and maintenance E2E: OK")
            return 0
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM) if os.name != "nt" else process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
            output = process.stdout.read() if process.stdout else ""
            if process.returncode not in (0, -signal.SIGTERM):
                sys.stderr.write(output)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
