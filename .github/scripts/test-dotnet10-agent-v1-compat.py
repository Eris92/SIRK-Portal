#!/usr/bin/env python3

import base64
import hashlib
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
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "http://127.0.0.1:18089"
PASSWORD = "Sirk-Agent-V1-Test!2026"
ACCESS_CODE = "sirk-agent-v1-access-code-2026"
GROUP_ID = "agent-v1-test"
ENROLLMENT_TOKEN = "AgentV1EnrollmentToken_0123456789abcdefghijklmnopqrstuvwxyz"


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


def raw_call(method: str, path: str, body: bytes | None, headers: dict[str, str], expected: int):
    request = urllib.request.Request(
        BASE_URL + path, data=body, headers=headers, method=method
    )
    response_headers = {}
    try:
        response = urllib.request.urlopen(request, timeout=20)
        status = response.status
        raw = response.read()
        response_headers = {key.lower(): value for key, value in response.headers.items()}
    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read()
        response_headers = {key.lower(): value for key, value in error.headers.items()}
    if status != expected:
        raise RuntimeError(
            f"{method} {path}: expected {expected}, got {status}: "
            f"{raw.decode(errors='replace')}"
        )
    content_type = response_headers.get("content-type", "")
    if raw and "json" in content_type:
        return json.loads(raw.decode("utf-8"))
    if raw and raw[:1] in (b"{", b"["):
        return json.loads(raw.decode("utf-8"))
    return raw.decode("utf-8") if raw else ""


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
        [
            "openssl",
            "dgst",
            "-sha256",
            "-sign",
            str(key_path),
            "-out",
            str(signature_der),
            str(signed),
        ],
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


def seed_agent_group(data_root: Path) -> None:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    token_hash = base64.b64encode(
        hashlib.sha256(ENROLLMENT_TOKEN.encode("utf-8")).digest()
    ).decode("ascii")
    document = {
        "schemaVersion": 1,
        "groups": [
            {
                "id": GROUP_ID,
                "name": "Agent V1 Test",
                "description": "Signed compatibility E2E",
                "enrollmentTokenHashBase64": token_hash,
                "enabled": True,
                "createdAtUtc": now,
                "updatedAtUtc": now,
            }
        ],
        "devices": [],
        "updatedAtUtc": now,
    }
    (data_root / "agents.json").write_text(
        json.dumps(document, separators=(",", ":")), encoding="utf-8"
    )


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
        seed_agent_group(data_root)
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

            installer = raw_call(
                "GET",
                "/api/v1/agent/install-script",
                None,
                {"Accept": "text/plain"},
                200,
            )
            for marker in (
                "SIRK-Agent-Setup.exe.sha256",
                "Get-FileHash",
                "--portal-url",
                "$GroupId + '.' + $EnrollmentToken",
                "SIRK_AGENT_PORTAL_INSTALL_OK",
            ):
                if marker not in installer:
                    raise RuntimeError(f"Agent install script is missing marker: {marker}")

            key_path = root / "device-key.pem"
            public_der = root / "device-public.der"
            subprocess.run(
                [
                    "openssl",
                    "ecparam",
                    "-name",
                    "prime256v1",
                    "-genkey",
                    "-noout",
                    "-out",
                    str(key_path),
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            subprocess.run(
                [
                    "openssl",
                    "pkey",
                    "-in",
                    str(key_path),
                    "-pubout",
                    "-outform",
                    "DER",
                    "-out",
                    str(public_der),
                ],
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
                    "publicKeySpki": base64.b64encode(public_der.read_bytes()).decode(
                        "ascii"
                    ),
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
                    "Authorization": "Bearer " + GROUP_ID + "." + ENROLLMENT_TOKEN,
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
            if checked.get("ok") is not True or not isinstance(
                checked.get("commands"), list
            ):
                raise RuntimeError("Signed Agent check-in response is invalid.")

            raw_call(
                "POST", "/api/agent/v1/checkin", checkin_body, headers, 401
            )

            stored = json.loads((data_root / "agents.json").read_text(encoding="utf-8"))
            device = next(
                (
                    item
                    for item in stored.get("devices", [])
                    if item.get("id") == device_id
                ),
                None,
            )
            if not device or not device.get("lastSeenAtUtc"):
                raise RuntimeError("Enrolled Agent did not persist a successful check-in.")
            if device.get("agentVersion") != "1.0.16-test":
                raise RuntimeError("Agent version was not updated by signed check-in.")
            if device.get("metadata", {}).get("protocol") != "agent-v1-ecdsa":
                raise RuntimeError("Agent protocol metadata is missing.")

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
