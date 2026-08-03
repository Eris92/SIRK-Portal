#!/usr/bin/env python3

import base64
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
import uuid
from pathlib import Path

BASE_URL = "http://127.0.0.1:18089"
PASSWORD = "Sirk-Agent-V1-Test!2026"
ACCESS_CODE = "sirk-agent-v1-access-code-2026"


class Browser:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.csrf = ""

    def call(self, method: str, path: str, payload=None, expected: int = 200, headers=None):
        values = {"Accept": "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            values["Content-Type"] = "application/json; charset=utf-8"
        if method not in ("GET", "HEAD", "OPTIONS") and self.csrf:
            values["X-SIRK-CSRF"] = self.csrf
        values.update(headers or {})
        request = urllib.request.Request(
            BASE_URL + path, data=body, headers=values, method=method
        )
        try:
            response = self.opener.open(request, timeout=20)
            status = response.status
            raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        if status != expected:
            raise RuntimeError(
                f"{method} {path}: expected {expected}, got {status}: "
                f"{raw.decode(errors='replace')}"
            )
        return json.loads(raw.decode("utf-8")) if raw else {}

    def authenticate(self) -> None:
        value = self.call(
            "POST",
            "/api/v1/auth/login",
            {
                "userName": "admin",
                "password": PASSWORD,
                "accessCode": ACCESS_CODE,
            },
            headers={"Authorization": "Bearer " + ACCESS_CODE},
        )
        if value.get("user", {}).get("role") != "Break-Glass":
            raise RuntimeError("Break-Glass authentication failed.")
        token = self.call("GET", "/api/v1/auth/csrf")
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


def raw_call(method: str, path: str, body: bytes, headers: dict[str, str], expected: int):
    request = urllib.request.Request(
        BASE_URL + path, data=body, headers=headers, method=method
    )
    try:
        response = urllib.request.urlopen(request, timeout=20)
        status = response.status
        raw = response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read()
    if status != expected:
        raise RuntimeError(
            f"{method} {path}: expected {expected}, got {status}: "
            f"{raw.decode(errors='replace')}"
        )
    return json.loads(raw.decode("utf-8")) if raw else {}


def read_der_length(data: bytes, offset: int):
    first = data[offset]
    offset += 1
    if first < 0x80:
        return first, offset
    count = first & 0x7F
    if count < 1 or count > 4:
        raise RuntimeError("Invalid DER length.")
    return int.from_bytes(data[offset : offset + count], "big"), offset + count


def der_signature_to_p1363(value: bytes) -> bytes:
    offset = 0
    if value[offset] != 0x30:
        raise RuntimeError("ECDSA signature is not a DER sequence.")
    offset += 1
    sequence_length, offset = read_der_length(value, offset)
    end = offset + sequence_length
    integers = []
    for _ in range(2):
        if value[offset] != 0x02:
            raise RuntimeError("ECDSA signature contains an invalid integer.")
        offset += 1
        length, offset = read_der_length(value, offset)
        integer = value[offset : offset + length]
        offset += length
        integer = integer.lstrip(b"\x00")
        if len(integer) > 32:
            raise RuntimeError("ECDSA signature integer is too large.")
        integers.append(integer.rjust(32, b"\x00"))
    if offset != end:
        raise RuntimeError("ECDSA signature has trailing data.")
    return integers[0] + integers[1]


def signed_headers(key_path: Path, body: bytes, root: Path, token: str):
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    signed = root / "signed.bin"
    signature_der = root / "signature.der"
    signed.write_bytes(timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body)
    subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path), "-out", str(signature_der), str(signed)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    signature = der_signature_to_p1363(signature_der.read_bytes())
    return {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": "Bearer " + token,
        "X-SIRK-Timestamp": timestamp,
        "X-SIRK-Nonce": nonce,
        "X-SIRK-Signature": base64.b64encode(signature).decode("ascii"),
    }


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-agent-v1-compat.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-agent-v1-") as temporary:
        root = Path(temporary)
        data_root = root / "data"
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
            browser.authenticate()

            installer_request = urllib.request.Request(
                BASE_URL + "/api/v1/agent/install-script",
                headers={"Accept": "text/plain"},
            )
            with urllib.request.urlopen(installer_request, timeout=10) as response:
                installer = response.read().decode("utf-8")
            for marker in (
                "SIRK-Agent-Setup.exe.sha256",
                "Get-FileHash",
                "--portal-url",
                "$GroupId + '.' + $EnrollmentToken",
                "SIRK_AGENT_PORTAL_INSTALL_OK",
            ):
                if marker not in installer:
                    raise RuntimeError(f"Agent install script is missing marker: {marker}")

            created = browser.call(
                "POST",
                "/api/v1/admin/computer-groups",
                {
                    "id": "agent-v1-test",
                    "name": "Agent V1 Test",
                    "description": "Signed compatibility E2E",
                },
            )
            enrollment_token = str(created.get("enrollmentToken") or "")
            if not enrollment_token:
                raise RuntimeError("Computer group enrollment token was not issued.")

            key_path = root / "device-key.pem"
            public_der = root / "device-public.der"
            subprocess.run(
                ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key_path)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            subprocess.run(
                ["openssl", "pkey", "-in", str(key_path), "-pubout", "-outform", "DER", "-out", str(public_der)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            device_id = "agent-v1-device"
            enrollment_body = json.dumps(
                {
                    "protocolVersion": 1,
                    "tenantId": "investa",
                    "deviceId": device_id,
                    "machineName": "AGENT-V1-DEVICE",
                    "publicKeySpki": base64.b64encode(public_der.read_bytes()).decode("ascii"),
                },
                separators=(",", ":"),
            ).encode("utf-8")
            enrolled = raw_call(
                "POST",
                "/api/agent/v1/enroll",
                enrollment_body,
                {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": "Bearer agent-v1-test." + enrollment_token,
                },
                201,
            )
            device_token = str(enrolled.get("deviceToken") or "")
            if enrolled.get("deviceId") != device_id or not device_token:
                raise RuntimeError("Agent enrollment response is incomplete.")
            if enrolled.get("checkInEndpoint") != "/api/agent/v1/checkin":
                raise RuntimeError("Agent check-in endpoint is invalid.")

            checkin_body = json.dumps(
                {
                    "protocolVersion": 1,
                    "tenantId": "investa",
                    "deviceId": device_id,
                    "machineName": "AGENT-V1-DEVICE",
                    "agentVersion": "1.0.16-test",
                    "heartbeat": {"status": "healthy"},
                    "management": {"status": "Healthy"},
                    "runtimeHealth": {"status": "healthy"},
                    "security": {"status": "protected"},
                    "quarantine": {"active": False},
                    "risk": {"score": 0},
                    "commandResults": [],
                    "waitMilliseconds": 0,
                    "events": [],
                },
                separators=(",", ":"),
            ).encode("utf-8")
            headers = signed_headers(key_path, checkin_body, root, device_token)
            checked = raw_call(
                "POST", "/api/agent/v1/checkin", checkin_body, headers, 200
            )
            if checked.get("ok") is not True or not isinstance(checked.get("commands"), list):
                raise RuntimeError("Signed Agent check-in response is invalid.")

            raw_call(
                "POST", "/api/agent/v1/checkin", checkin_body, headers, 401
            )

            snapshot = browser.call("GET", "/api/v1/admin/computer-groups")["value"]
            device = next(
                (item for item in snapshot.get("devices", []) if item.get("id") == device_id),
                None,
            )
            if not device or device.get("online") is not True:
                raise RuntimeError("Enrolled Agent is not online in the Portal inventory.")
            if device.get("agentVersion") != "1.0.16-test":
                raise RuntimeError("Agent version was not updated by signed check-in.")

            print("SIRK Agent Setup v1 signed enrollment and check-in E2E: OK")
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
