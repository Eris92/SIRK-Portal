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

BASE_URL = "http://127.0.0.1:18085"
PASSWORD = "Sirk-Portal-Modules-Test!2026"
ACCESS_CODE = "sirk-modules-test-access-code-2026"


class Browser:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf_header = "X-SIRK-CSRF"
        self.csrf_token = ""

    def call(self, method: str, path: str, payload=None, expected: int = 200):
        headers = {"Accept": "application/json", "Authorization": "Bearer " + ACCESS_CODE}
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if method not in ("GET", "HEAD", "OPTIONS") and self.csrf_token:
            headers[self.csrf_header] = self.csrf_token
        request = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
            status = response.status
            raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        if status != expected:
            raise RuntimeError(f"{method} {path}: expected {expected}, got {status}: {raw.decode(errors='replace')}")
        return json.loads(raw.decode("utf-8")) if raw else {}

    def authenticate(self) -> None:
        login = self.call("POST", "/api/v1/auth/login", {
            "userName": "admin",
            "password": PASSWORD,
            "accessCode": ACCESS_CODE,
        })
        if login.get("user", {}).get("role") != "Break-Glass":
            raise RuntimeError("Break-Glass login failed.")
        csrf = self.call("GET", "/api/v1/auth/csrf")
        self.csrf_header = csrf.get("headerName") or "X-SIRK-CSRF"
        self.csrf_token = csrf.get("requestToken") or ""
        if not self.csrf_token:
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


def find_request(rows, request_id):
    for row in rows:
        if row.get("id") == request_id:
            return row
    raise RuntimeError(f"Approval request not found: {request_id}")


def approve(browser: Browser, request_id: str):
    value = browser.call("POST", "/api/v1/modules/approvals/decide", {
        "requestId": request_id,
        "approved": True,
        "note": "Native module E2E",
        "level": 1,
    })
    request = value.get("request", {})
    if request.get("status") != "completed":
        raise RuntimeError(f"Approved workflow was not queued: {request}")
    result = request.get("executionResult") or {}
    if not result.get("commandId"):
        raise RuntimeError("Approved workflow has no command ID.")
    return request


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-modules.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-portal-modules-") as temporary:
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

            credentials = {}
            for group_id, name in (("source", "Source"), ("target", "Target")):
                result = browser.call("POST", "/api/v1/admin/agent-groups", {
                    "action": "create",
                    "id": group_id,
                    "name": name,
                    "description": "Native module E2E",
                    "portalOrigin": "https://portal.example",
                    "interactive": False,
                })
                credentials[group_id] = result["credential"]["enrollmentToken"]

            enrolled = browser.call("POST", "/api/v1/agent/enroll", {
                "groupId": "source",
                "enrollmentToken": credentials["source"],
                "tenantId": "tenant-modules",
                "name": "Module Test Device",
                "hostName": "module-test",
                "platform": "windows-x64",
                "agentVersion": "1.0.0-test",
                "metadata": {"serial": "MODULE-001"},
            }, expected=201)
            device_id = enrolled["credential"]["deviceId"]

            inventory = browser.call("GET", "/api/v1/modules/portal/devices")
            if device_id not in [row.get("id") for row in inventory.get("nodes", [])]:
                raise RuntimeError("Portal devices module does not contain the enrolled device.")
            overview = browser.call("GET", "/api/v1/modules/portal/overview")
            if "pendingApprovals" not in overview or "integrations" not in overview:
                raise RuntimeError("Portal overview payload is incomplete.")

            providers = browser.call("GET", "/api/v1/modules/approvals/providers")
            provider_types = {value.get("type") for value in providers.get("providers", [])}
            if provider_types != {"move-requests", "commands", "management"}:
                raise RuntimeError(f"Approval providers are invalid: {provider_types}")
            browser.call("GET", "/api/v1/modules/approvals/overview")
            browser.call("GET", "/api/v1/modules/approvals/settings")
            browser.call("GET", "/api/v1/modules/move-requests/groups")
            browser.call("GET", "/api/v1/modules/move-requests/settings")

            submitted_move = browser.call("POST", "/api/v1/modules/move-requests/submit", {
                "deviceId": device_id,
                "nodeId": device_id,
                "nodeName": "Module Test Device",
                "sourceGroupId": "source",
                "sourceGroupName": "Source",
                "targetGroupId": "target",
                "targetGroupName": "Target",
                "approvalLevels": [1],
                "note": "Move E2E",
            })["request"]
            if submitted_move.get("status") != "pending":
                raise RuntimeError("Move request is not pending.")
            move = approve(browser, submitted_move["id"])
            browser.call("GET", "/api/v1/modules/approvals/request?id=" + move["id"])

            script_payload = {
                "originalPath": None,
                "path": "Tests/native-e2e.ps1",
                "name": "native-e2e",
                "label": "Native E2E",
                "description": "Native module E2E script",
                "shell": "powershell",
                "body": "Get-Date",
                "runAsUser": 0,
                "confirmExecution": False,
                "approvalLevels": [1],
                "variables": [],
            }
            saved = browser.call("POST", "/api/v1/modules/management/save", script_payload)["script"]
            if not saved.get("hash"):
                raise RuntimeError("Saved script has no integrity hash.")
            browser.call("GET", "/api/v1/modules/management/tree")
            loaded = browser.call("GET", "/api/v1/modules/management/script?path=Tests%2Fnative-e2e.ps1")["script"]
            if loaded.get("hash") != saved["hash"]:
                raise RuntimeError("Loaded script hash differs from the saved hash.")
            browser.call("GET", "/api/v1/modules/commands/script?path=Tests%2Fnative-e2e.ps1", expected=404)
            if not (data_root / "Files" / "management" / "scripts.json").is_file():
                raise RuntimeError("Management script library was not stored under Files/management.")
            if not (data_root / "Files" / "commands").is_dir():
                raise RuntimeError("Commands script library directory is missing under Files/commands.")

            submitted_script = browser.call("POST", "/api/v1/modules/management/execute", {
                "deviceId": device_id,
                "nodeId": device_id,
                "nodeName": "Module Test Device",
                "scriptPath": saved["path"],
                "scriptHash": saved["hash"],
                "variableValues": {},
                "approvalLevels": [1],
                "confirmedExecution": True,
                "note": "Script E2E",
            })["request"]
            script_request = approve(browser, submitted_script["id"])
            script_command_id = script_request["executionResult"]["commandId"]
            output = browser.call("GET", "/api/v1/modules/management/output?id=" + script_command_id)
            if output.get("status") != "queued" or output.get("ready") is not False:
                raise RuntimeError("Queued script output state is invalid.")

            catalog = browser.call("GET", "/api/v1/modules/commands/catalog")
            if not catalog.get("catalog"):
                raise RuntimeError("Built-in command catalog is empty.")
            submitted_command = browser.call("POST", "/api/v1/modules/commands/execute", {
                "deviceId": device_id,
                "nodeId": device_id,
                "nodeName": "Module Test Device",
                "commandId": "flushdns",
                "variableValues": {},
                "approvalLevels": [1],
                "confirmedExecution": True,
                "note": "Command E2E",
            })["request"]
            command_request = approve(browser, submitted_command["id"])
            command_id = command_request["executionResult"]["commandId"]

            results = browser.call("GET", "/api/v1/modules/commands/results?deviceId=" + device_id)
            result_ids = {row.get("id") for row in results.get("rows", [])}
            if not {move["executionResult"]["commandId"], script_command_id, command_id}.issubset(result_ids):
                raise RuntimeError("Module result history is missing queued workflows.")

            requests = browser.call("GET", "/api/v1/modules/approvals/requests?limit=100")
            for request_id in (move["id"], script_request["id"], command_request["id"]):
                if find_request(requests.get("requests", []), request_id).get("status") != "completed":
                    raise RuntimeError("Approval center does not expose completed workflow.")

            for module in ("jira", "security", "monitoring", "assets", "reports"):
                value = browser.call("GET", f"/api/v1/modules/{module}/status")
                if value.get("module") != module or value.get("action") != "status":
                    raise RuntimeError(f"Integration module adapter failed: {module}")

            browser.call("POST", "/api/v1/modules/management/delete", {"path": saved["path"]})
            browser.call("GET", "/api/v1/modules/management/script?path=Tests%2Fnative-e2e.ps1", expected=404)

            audit = browser.call("GET", "/api/v1/audit?limit=500")
            actions = {entry.get("event", {}).get("action") for entry in audit.get("entries", [])}
            expected_actions = {"move-request.submit", "approval.decide", "script.save", "script.execute", "script.delete"}
            if not expected_actions.issubset(actions):
                raise RuntimeError(f"Module audit is incomplete: {sorted(expected_actions - actions)}")

            print("SIRK Portal native modules E2E: OK")
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
