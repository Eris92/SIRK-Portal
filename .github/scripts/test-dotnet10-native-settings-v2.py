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
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf = ""

    def call(self, method: str, path: str, payload=None, expected: int = 200, accept: str = "application/json"):
        headers = {"Accept": accept}
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if method not in ("GET", "HEAD", "OPTIONS") and self.csrf:
            headers["X-SIRK-CSRF"] = self.csrf
        request = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
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
            raise RuntimeError(f"{method} {path}: expected {expected}, got {status}: {raw.decode(errors='replace')}")
        return raw, response_headers

    def json(self, method: str, path: str, payload=None, expected: int = 200):
        raw, _ = self.call(method, path, payload, expected)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def authenticate(self) -> None:
        result = self.json("POST", "/api/v1/auth/login", {
            "userName": "admin",
            "password": PASSWORD,
            "accessCode": ACCESS_CODE,
        })
        if result.get("user", {}).get("role") != "Break-Glass":
            raise RuntimeError("Break-Glass session was not established.")
        token = self.json("GET", "/api/v1/auth/csrf")
        self.csrf = str(token.get("requestToken") or "")
        if not self.csrf:
            raise RuntimeError("CSRF token was not issued.")


def wait_ready(timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = None
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


def item_by(items, key, value):
    for item in items:
        if item.get(key) == value:
            return item
    raise RuntimeError(f"Item not found: {key}={value}")


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-native-settings-v2.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-portal-settings-v2-") as temporary:
        data_root = Path(temporary) / "data"
        data_root.mkdir(mode=0o700)
        environment = os.environ.copy()
        environment.update({
            "ASPNETCORE_ENVIRONMENT": "Development",
            "ASPNETCORE_URLS": BASE_URL,
            "Sirk__DataRoot": str(data_root),
            "Sirk__Central__Enabled": "false",
            "Sirk__CentralTunnel__Enabled": "false",
            "SIRK_BOOTSTRAP_PASSWORD": PASSWORD,
            "SIRK_BOOTSTRAP_ACCESS_CODE": ACCESS_CODE,
        })
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
            browser.authenticate()

            settings_asset, headers = browser.call("GET", "/assets/settings.js", accept="text/javascript")
            source = settings_asset.decode("utf-8")
            if "text/javascript" not in headers.get("content-type", ""):
                raise RuntimeError("Native settings asset has an invalid content type.")
            for marker in (
                "/api/v1/admin/settings",
                "/api/v1/admin/identity/",
                "/api/v1/admin/maintenance/status",
                '"Break-Glass"',
                '"Operator L1"',
                '"Support L2"',
                '"Engineer L3"',
            ):
                if marker not in source:
                    raise RuntimeError(f"Native settings asset is missing marker: {marker}")
            for legacy in ("plugin-operation", "/api/admin/runtime", "/api/system/updates/"):
                if legacy in source:
                    raise RuntimeError(f"Legacy settings API is still active: {legacy}")

            settings = browser.json("GET", "/api/v1/admin/settings")["value"]
            portal = settings["portal"]
            portal["siteName"] = "SIRK Portal Native Test"
            changed = browser.json("PUT", "/api/v1/admin/settings", {"portal": portal})["value"]
            if changed["portal"].get("siteName") != "SIRK Portal Native Test":
                raise RuntimeError("Portal settings were not persisted.")

            identity = browser.json("GET", "/api/v1/admin/identity/")["value"]
            if item_by(identity["users"], "userName", "admin").get("role") != "Break-Glass":
                raise RuntimeError("Bootstrap account has a non-canonical role.")

            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "save-group",
                "id": "native-test",
                "name": "Native Test",
                "description": "Native settings E2E",
                "memberIds": [],
            })["value"]
            item_by(identity["groups"], "id", "native-test")

            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "create-user",
                "userName": "native.user",
                "displayName": "Native User",
                "password": "Native-User-Password!2026",
                "role": "Operator L1",
            })["value"]
            user = item_by(identity["users"], "userName", "native.user")
            if user.get("role") != "Operator L1":
                raise RuntimeError("Created user has an invalid role.")

            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "update-user",
                "id": user["id"],
                "displayName": "Native User Updated",
                "role": "Support L2",
                "enabled": True,
            })["value"]
            user = item_by(identity["users"], "userName", "native.user")
            if user.get("role") != "Support L2":
                raise RuntimeError("Canonical role update was not persisted.")

            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "save-group",
                "id": "native-test",
                "name": "Native Test",
                "description": "Native settings E2E",
                "memberIds": [user["id"]],
            })["value"]
            if user["id"] not in item_by(identity["groups"], "id", "native-test").get("memberIds", []):
                raise RuntimeError("Group membership was not persisted.")

            maintenance = browser.json("GET", "/api/v1/admin/maintenance/status")["value"]
            if maintenance["current"].get("channel") != "dev":
                raise RuntimeError("Initial maintenance channel is invalid.")
            maintenance = browser.json("POST", "/api/v1/admin/maintenance/channel", {"channel": "beta"})["value"]
            if maintenance["current"].get("channel") != "beta":
                raise RuntimeError("Maintenance channel was not persisted.")

            maintenance = browser.json("POST", "/api/v1/admin/maintenance/backup", {"reason": "settings-e2e"})["value"]
            if len(maintenance.get("backups", [])) != 1:
                raise RuntimeError("Native backup was not created.")
            backup_id = maintenance["backups"][0]["id"]
            maintenance = browser.json("POST", "/api/v1/admin/maintenance/delete-backup", {"id": backup_id})["value"]
            if maintenance.get("backups"):
                raise RuntimeError("Native backup was not deleted.")

            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "delete-user", "id": user["id"]
            })["value"]
            if any(value.get("userName") == "native.user" for value in identity["users"]):
                raise RuntimeError("Native test user was not deleted.")
            identity = browser.json("POST", "/api/v1/admin/identity/", {
                "action": "delete-group", "id": "native-test"
            })["value"]
            if any(value.get("id") == "native-test" for value in identity["groups"]):
                raise RuntimeError("Native test group was not deleted.")

            runtime = browser.json("GET", "/api/v1/admin/runtime")
            if not runtime.get("service", {}).get("version"):
                raise RuntimeError("Native runtime status is incomplete.")

            print("SIRK Portal native settings v2 and maintenance E2E: OK")
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
