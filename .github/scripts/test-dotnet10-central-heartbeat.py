#!/usr/bin/env python3

import base64
import hashlib
import hmac
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORTAL_ID = "portal-test"
PORTAL_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
CENTRAL_URL = "http://127.0.0.1:19090"
PORTAL_URL = "http://127.0.0.1:18081"
HEARTBEAT_RECEIVED = threading.Event()
HEARTBEAT_ERROR: list[str] = []


def decode_base64url(value: str) -> bytes:
    value += "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value.encode("ascii"))


def validate_heartbeat(handler: BaseHTTPRequestHandler, body: bytes) -> None:
    authorization = handler.headers.get("Authorization", "")
    scheme = "SIRK-Portal "
    if not authorization.startswith(scheme):
        raise ValueError("Authorization scheme is invalid.")
    credential = decode_base64url(authorization[len(scheme) :]).decode("utf-8")
    if credential != f"{PORTAL_ID}:{PORTAL_TOKEN}":
        raise ValueError("Portal credential is invalid.")

    timestamp = handler.headers.get("X-SIRK-Timestamp", "")
    nonce = handler.headers.get("X-SIRK-Nonce", "")
    signature = handler.headers.get("X-SIRK-Signature", "")
    timestamp_ms = int(timestamp)
    if abs(int(time.time() * 1000) - timestamp_ms) > 30_000:
        raise ValueError("Portal timestamp is outside the test clock-skew window.")
    if len(decode_base64url(nonce)) < 16:
        raise ValueError("Portal nonce is too short.")

    expected = hmac.new(
        PORTAL_TOKEN.encode("utf-8"),
        timestamp.encode("ascii") + b"\n" + nonce.encode("ascii") + b"\n" + body,
        hashlib.sha256,
    ).digest()
    supplied = decode_base64url(signature)
    if not hmac.compare_digest(expected, supplied):
        raise ValueError("Portal heartbeat HMAC is invalid.")

    payload = json.loads(body.decode("utf-8"))
    if payload.get("protocolVersion") != 1:
        raise ValueError("Portal protocol version is invalid.")
    if payload.get("portalVersion") != "3.0.0-dev.1":
        raise ValueError("Portal version is invalid.")
    capabilities = payload.get("capabilities", [])
    if "signed-heartbeat" not in capabilities:
        raise ValueError("Portal signed-heartbeat capability is missing.")
    if "protected-central-config" not in capabilities:
        raise ValueError("Portal protected-central-config capability is missing.")


class CentralHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        if self.path != "/api/portal/v1/heartbeat":
            self.send_error(404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)
        try:
            validate_heartbeat(self, body)
        except Exception as error:  # noqa: BLE001 - test boundary
            HEARTBEAT_ERROR.append(str(error))
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":false}')
            HEARTBEAT_RECEIVED.set()
            return

        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"nextHeartbeatSeconds":60}')
        HEARTBEAT_RECEIVED.set()

    def log_message(self, format_string: str, *args: object) -> None:
        return


def wait_portal_status(timeout_seconds: int) -> dict:
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{PORTAL_URL}/api/v1/portal/status", timeout=2) as response:
                status = json.loads(response.read().decode("utf-8"))
                if status.get("central", {}).get("connected") is True:
                    return status
        except Exception as error:  # noqa: BLE001 - bounded startup retry
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"Portal did not report a connected Central state: {last_error}")


def write_protected_connection_file(directory: Path) -> Path:
    path = directory / "central-connection.json"
    document = {
        "schemaVersion": 1,
        "centralUrl": CENTRAL_URL,
        "tunnelUrl": "ws://127.0.0.1:19090/tunnel",
        "portalId": PORTAL_ID,
        "portalName": "Portal Test",
        "portalToken": PORTAL_TOKEN,
        "publicUrl": "https://portal.example",
        "updatedAtUtc": "2026-08-02T12:00:00Z",
    }
    path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    path.chmod(0o600)
    return path


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-central-heartbeat.py <Sirk.Portal.dll>")

    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    server = ThreadingHTTPServer(("127.0.0.1", 19090), CentralHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    with tempfile.TemporaryDirectory(prefix="sirk-portal-central-") as temporary_directory:
        connection_file = write_protected_connection_file(Path(temporary_directory))
        environment = os.environ.copy()
        environment.update(
            {
                "ASPNETCORE_ENVIRONMENT": "Development",
                "ASPNETCORE_URLS": PORTAL_URL,
                "Sirk__Central__ConnectionFile": str(connection_file),
                "Sirk__Central__UpdateChannel": "dev",
                "Sirk__Central__HeartbeatIntervalSeconds": "30",
                "Sirk__Central__RequestTimeoutSeconds": "5",
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
            if not HEARTBEAT_RECEIVED.wait(timeout=30):
                raise RuntimeError("Portal did not send a heartbeat within 30 seconds.")
            if HEARTBEAT_ERROR:
                raise RuntimeError(HEARTBEAT_ERROR[0])

            status = wait_portal_status(15)
            central = status["central"]
            if central.get("lastStatusCode") != 202 or central.get("portalId") != PORTAL_ID:
                raise RuntimeError("Portal Central status does not contain the accepted heartbeat state.")
            if central.get("configurationSource") != "protected-file":
                raise RuntimeError("Portal did not load the protected Central connection file.")
            if PORTAL_TOKEN in json.dumps(status, separators=(",", ":")):
                raise RuntimeError("Portal status response exposes the Portal token.")

            print("SIRK Portal protected-file Central heartbeat smoke: OK")
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
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CI entry point
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
