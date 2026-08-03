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

BASE_URL = "http://127.0.0.1:18083"
PASSWORD = "Sirk-Portal-Ui-Test!2026"
ACCESS_CODE = "sirk-ui-test-access-code-2026-secure"


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
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        body = None
        request_headers = {"Accept": accept}
        request_headers.update(headers or {})
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json; charset=utf-8"
        request = urllib.request.Request(
            BASE_URL + path,
            data=body,
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
        headers: dict[str, str] | None = None,
    ) -> dict:
        raw, _ = self.request(method, path, payload, expected, headers=headers)
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
            require(login, 'id="sirkMicrosoftLogin"', "Microsoft sign-in")
            require(login, 'id="sirkLocalLogin" class="sirk-local-login" hidden', "Hidden local sign-in")
            if 'name="accessCode"' in login:
                raise RuntimeError("Access Code must not be rendered as a local sign-in field.")
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
            asset_bodies: dict[str, bytes] = {}
            for path, expected_type in critical_assets.items():
                raw, headers = browser.request("GET", path, accept="*/*")
                asset_bodies[path] = raw
                if not raw:
                    raise RuntimeError(f"Frontend asset is empty: {path}")
                if expected_type not in headers.get("content-type", ""):
                    raise RuntimeError(
                        f"Frontend asset has invalid content type: {path}: "
                        f"{headers.get('content-type', '')}"
                    )

            login_script = asset_bodies["/assets/portal-login.js"].decode("utf-8")
            for marker in (
                "window.location.hash",
                'fragment.get("access")',
                'fetch("/api/v1/auth/local-access"',
                '"Authorization": "Bearer " + accessCode',
            ):
                require(login_script, marker, "Access URL login script")

            browser.request("GET", "/api/v1/auth/local-access", expected=404)
            browser.request(
                "GET",
                "/api/v1/auth/local-access",
                expected=404,
                headers={"Authorization": "Bearer invalid-invalid-invalid-invalid-invalid"},
            )
            local_access = browser.json(
                "GET",
                "/api/v1/auth/local-access",
                headers={"Authorization": "Bearer " + ACCESS_CODE},
            )
            if local_access.get("ok") is not True:
                raise RuntimeError("Valid Portal access URL was not accepted.")

            browser.request("GET", "/", expected=200, accept="text/html")
            browser.json(
                "POST",
                "/api/v1/auth/login",
                {
                    "userName": "admin",
                    "password": PASSWORD,
                    "accessCode": ACCESS_CODE,
                },
                expected=404,
            )
            login_result = browser.json(
                "POST",
                "/api/v1/auth/login",
                {
                    "userName": "admin",
                    "password": PASSWORD,
                    "accessCode": ACCESS_CODE,
                },
                headers={"Authorization": "Bearer " + ACCESS_CODE},
            )
            if login_result.get("user", {}).get("role") != "Break-Glass":
                raise RuntimeError("Access URL login did not establish a Break-Glass session.")

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

            settings = browser.json("GET", "/api/admin/settings")
            snapshot = settings.get("value", {})
            if not snapshot.get("modules") or "moduleSettings" not in snapshot:
                raise RuntimeError("Settings adapter returned an incomplete snapshot.")

            updates = browser.json("GET", "/api/system/updates/status")
            if updates.get("value", {}).get("current", {}).get("version") is None:
                raise RuntimeError("System update status adapter is incomplete.")

            print("SIRK Portal access URL gated native UI smoke: OK")
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
