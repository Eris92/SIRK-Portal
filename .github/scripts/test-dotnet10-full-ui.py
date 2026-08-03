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
import zipfile
from pathlib import Path

BASE_URL = "http://127.0.0.1:18083"
PASSWORD = "Sirk-Portal-Ui-Test!2026"
ACCESS_CODE = "sirk-ui-test-access-code-2026"


class Browser:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        expected: int = 200,
        accept: str = "application/json",
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        body = None
        headers = {"Accept": accept}
        headers.update(extra_headers or {})
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        request = urllib.request.Request(
            BASE_URL + path,
            data=body,
            headers=headers,
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
        extra_headers: dict[str, str] | None = None,
    ) -> dict:
        raw, _ = self.request(
            method,
            path,
            payload,
            expected,
            extra_headers=extra_headers,
        )
        return json.loads(raw.decode("utf-8")) if raw else {}


def wait_ready(timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(BASE_URL + "/readyz", timeout=2) as response:
                value = json.loads(response.read().decode("utf-8"))
                if response.status == 200 and value.get("status") == "ready":
                    return
        except Exception as error:  # noqa: BLE001 - bounded startup retry
            last_error = error
        time.sleep(0.2)
    raise RuntimeError(f"Portal did not become ready: {last_error}")


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise RuntimeError(f"{label} is missing required marker: {needle}")


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-full-ui.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-portal-full-ui-") as temporary_directory:
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

            login_raw, login_headers = browser.request("GET", "/login", accept="text/html")
            login = login_raw.decode("utf-8")
            require(login, 'class="sirk-login-page"', "Styled login")
            require(login, '/assets/portal-login.css', "Styled login")
            require(login, 'name="accessCode"', "Break-Glass login")
            if "text/html" not in login_headers.get("content-type", ""):
                raise RuntimeError("Login response has an invalid content type.")

            critical_assets = {
                "/assets/portal-login.css": "text/css",
                "/assets/portal-login.js": "text/javascript",
                "/assets/portal-standalone.css": "text/css",
                "/assets/standalone-core.js": "text/javascript",
                "/assets/portal-standalone.js": "text/javascript",
                "/assets/settings.js": "text/javascript",
                "/assets/shared-ui/shared-ui.css": "text/css",
                "/assets/icons/sirk-ui.svg": "image/svg+xml",
            }
            asset_values: dict[str, bytes] = {}
            for path, expected_type in critical_assets.items():
                raw, headers = browser.request("GET", path, accept="*/*")
                asset_values[path] = raw
                if not raw:
                    raise RuntimeError(f"Frontend asset is empty: {path}")
                if expected_type not in headers.get("content-type", ""):
                    raise RuntimeError(
                        f"Frontend asset has invalid content type: {path}: "
                        f"{headers.get('content-type', '')}"
                    )

            native_settings = asset_values["/assets/settings.js"].decode("utf-8")
            require(native_settings, "data-portal-settings-native", "Native settings UI")
            require(native_settings, "/api/v1/admin/maintenance/status", "Native settings UI")
            require(native_settings, '"BreakGlass"', "Native settings RBAC")
            if "/api/admin/settings" in native_settings or "plugin-operation" in native_settings:
                raise RuntimeError("Legacy settings API is still exposed by the active settings asset.")

            browser.request("GET", "/", expected=200, accept="text/html")
            login_result = browser.json(
                "POST",
                "/api/v1/auth/login",
                {
                    "userName": "admin",
                    "password": PASSWORD,
                    "accessCode": ACCESS_CODE,
                },
            )
            if login_result.get("user", {}).get("role") != "Break-Glass":
                raise RuntimeError("Styled UI login did not establish a Break-Glass session.")

            portal_raw, _ = browser.request("GET", "/", accept="text/html")
            portal = portal_raw.decode("utf-8")
            for marker in (
                'id="sirkStandaloneRoot"',
                'data-view="overview"',
                'data-view="devices"',
                'data-view="approvals"',
                'data-view="automation"',
                'data-view="security"',
                'data-view="settings"',
                '/assets/portal-standalone.css',
                '/assets/portal-standalone.js',
            ):
                require(portal, marker, "Full Portal shell")
            for placeholder in ("__API_BASE_JSON__", "__ASSET_BASE__", "__VERSION__"):
                if placeholder in portal:
                    raise RuntimeError(f"Portal template placeholder was not replaced: {placeholder}")

            bootstrap = browser.json("GET", "/api/v1/bootstrap")
            if bootstrap.get("ok") is not True or not bootstrap.get("modules"):
                raise RuntimeError("Native bootstrap did not return Portal modules.")

            legacy_bootstrap = browser.json("GET", "/api/bootstrap")
            if not legacy_bootstrap.get("csrfToken"):
                raise RuntimeError("Compatibility bootstrap did not issue a CSRF token.")

            devices = browser.json("GET", "/api/v1/modules/portal/devices")
            if not isinstance(devices.get("nodes"), list) or not isinstance(devices.get("groups"), list):
                raise RuntimeError("Portal device adapter returned an invalid payload.")

            overview = browser.json("GET", "/api/v1/modules/portal/overview")
            if "pendingApprovals" not in overview or "integrations" not in overview:
                raise RuntimeError("Portal overview adapter returned an invalid payload.")

            settings = browser.json("GET", "/api/v1/admin/settings")
            snapshot = settings.get("value", {})
            if not snapshot.get("modules") or not snapshot.get("identity"):
                raise RuntimeError("Native settings API returned an incomplete snapshot.")

            identity = browser.json("GET", "/api/v1/admin/identity/")
            if identity.get("value", {}).get("users", [])[0].get("role") != "BreakGlass":
                raise RuntimeError("Native identity API returned an invalid Break-Glass role.")

            csrf_value = browser.json("GET", "/api/v1/auth/csrf").get("requestToken")
            if not csrf_value:
                raise RuntimeError("Native CSRF endpoint did not return a request token.")
            csrf_headers = {"X-SIRK-CSRF": str(csrf_value)}

            maintenance = browser.json("GET", "/api/v1/admin/maintenance/status").get("value", {})
            if maintenance.get("current", {}).get("version") is None:
                raise RuntimeError("Native maintenance status is incomplete.")
            if maintenance.get("capabilities", {}).get("backup") is not True:
                raise RuntimeError("Native maintenance backup capability is unavailable.")

            checked = browser.json(
                "POST",
                "/api/v1/admin/maintenance/check",
                {},
                extra_headers=csrf_headers,
            ).get("value", {})
            if not checked.get("history"):
                raise RuntimeError("Maintenance check did not record history.")

            channel = browser.json(
                "POST",
                "/api/v1/admin/maintenance/channel",
                {"channel": "beta"},
                extra_headers=csrf_headers,
            ).get("value", {})
            if channel.get("current", {}).get("channel") != "beta":
                raise RuntimeError("Maintenance channel was not persisted.")

            backup_value = browser.json(
                "POST",
                "/api/v1/admin/maintenance/backup",
                {"reason": "complete-ui-smoke"},
                extra_headers=csrf_headers,
            ).get("value", {})
            backups = backup_value.get("backups", [])
            if len(backups) != 1:
                raise RuntimeError("Maintenance backup was not registered.")
            backup_id = backups[0].get("id")
            archive_path = data_root / "backups" / f"{backup_id}.zip"
            if not archive_path.is_file() or archive_path.stat().st_size <= 0:
                raise RuntimeError("Maintenance backup archive was not created.")
            with zipfile.ZipFile(archive_path) as archive:
                names = archive.namelist()
                if not names or any(name.startswith("backups/") for name in names):
                    raise RuntimeError("Maintenance backup is empty or recursively contains backups.")
                if "identity.json" not in names or "settings.json" not in names:
                    raise RuntimeError("Maintenance backup is missing critical Portal data.")

            deleted = browser.json(
                "POST",
                "/api/v1/admin/maintenance/delete-backup",
                {"id": backup_id},
                extra_headers=csrf_headers,
            ).get("value", {})
            if deleted.get("backups") or archive_path.exists():
                raise RuntimeError("Maintenance backup was not deleted.")

            unsupported = browser.json(
                "POST",
                "/api/v1/admin/maintenance/restart",
                {},
                expected=409,
                extra_headers=csrf_headers,
            )
            if unsupported.get("code") != "MAINTENANCE_PLATFORM_UNSUPPORTED":
                raise RuntimeError("Linux restart guard returned an invalid error contract.")

            print("SIRK Portal complete native UI and maintenance smoke: OK")
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
    except Exception as error:  # noqa: BLE001 - command-line smoke test
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
