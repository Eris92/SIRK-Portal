#!/usr/bin/env python3

import base64
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


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


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
    if raw and ("json" in content_type or raw[:1] in (b"{", b"[")):
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


def der_length(length: int) -> bytes:
    if length < 0x80:
        return bytes([length])
    encoded = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(encoded)]) + encoded


def p1363_signature_to_der(value: bytes) -> bytes:
    if len(value) != 64:
        raise RuntimeError("ES256 P1363 signature must contain 64 bytes.")

    def integer(part: bytes) -> bytes:
        part = part.lstrip(b"\x00") or b"\x00"
        if part[0] & 0x80:
            part = b"\x00" + part
        return b"\x02" + der_length(len(part)) + part

    payload = integer(value[:32]) + integer(value[32:])
    return b"\x30" + der_length(len(payload)) + payload


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


def system_text_json_canonical(value: object) -> bytes:
    # Portal and Agent both use Utf8JsonWriter with the default encoder.
    # The default .NET encoder escapes HTML-sensitive Basic Latin characters,
    # including '+' in DateTimeOffset strings, unlike Python's json module.
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    for character, escape in (
        ("+", "\\u002B"),
        ("&", "\\u0026"),
        ("'", "\\u0027"),
        ("<", "\\u003C"),
        (">", "\\u003E"),
    ):
        encoded = encoded.replace(character, escape)
    return encoded.encode("utf-8")


def verify_signed_policy(envelope: dict, trusted_key: dict, root: Path) -> None:
    signature = envelope.get("signature") or {}
    if signature.get("algorithm") != "ES256":
        raise RuntimeError("Signed policy does not use ES256.")
    if signature.get("keyId") != trusted_key.get("keyId"):
        raise RuntimeError("Signed policy key ID does not match the delivered trust anchor.")

    payload = {key: value for key, value in envelope.items() if key != "signature"}
    canonical = system_text_json_canonical(payload)
    canonical_path = root / "policy-canonical.json"
    signature_path = root / "policy-signature.der"
    public_key_path = root / "policy-public.pem"
    canonical_path.write_bytes(canonical)
    signature_path.write_bytes(
        p1363_signature_to_der(b64url_decode(str(signature.get("value") or "")))
    )
    public_key_path.write_text(str(trusted_key.get("publicKeyPem") or ""), encoding="utf-8")
    result = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(public_key_path),
            "-signature",
            str(signature_path),
            str(canonical_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Portal policy ES256 signature is invalid: "
            + (result.stdout + result.stderr).strip()
        )


def seed_agent_state(data_root: Path) -> None:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    import hashlib

    token_hash = base64.b64encode(
        hashlib.sha256(ENROLLMENT_TOKEN.encode("utf-8")).digest()
    ).decode("ascii")
    agents = {
        "schemaVersion": 1,
        "groups": [
            {
                "id": GROUP_ID,
                "name": "Agent V1 Test",
                "description": "Signed canonical E2E",
                "enrollmentTokenHashBase64": token_hash,
                "enabled": True,
                "createdAtUtc": now,
                "updatedAtUtc": now,
            }
        ],
        "devices": [],
        "updatedAtUtc": now,
    }
    policies = {
        "schemaVersion": 1,
        "revision": 2,
        "policies": [
            {
                "scopeType": "group",
                "scopeId": GROUP_ID,
                "version": 1,
                "policy": {"remoteDesktopEnabled": True},
                "updatedAtUtc": now,
                "updatedById": "test",
                "updatedByName": "Canonical Agent E2E",
            }
        ],
        "updatedAtUtc": now,
    }
    (data_root / "agents.json").write_text(
        json.dumps(agents, separators=(",", ":")), encoding="utf-8"
    )
    (data_root / "agent-policies.json").write_text(
        json.dumps(policies, separators=(",", ":")), encoding="utf-8"
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: test-dotnet10-agent-v1.py <Sirk.Portal.dll>")
    portal_dll = Path(sys.argv[1]).resolve()
    if not portal_dll.is_file():
        raise RuntimeError(f"Portal assembly was not found: {portal_dll}")

    with tempfile.TemporaryDirectory(prefix="sirk-agent-v1-") as temporary:
        root = Path(temporary)
        data_root = root / "data"
        data_root.mkdir(mode=0o700)
        seed_agent_state(data_root)
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
                    "publicKeySpki": base64.b64encode(public_der.read_bytes()).decode("ascii"),
                },
                separators=(",", ":"),
            ).encode("utf-8")
            enrolled = raw_call(
                "POST",
                "/api/v1/agent/enroll",
                enrollment_body,
                {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8",
                    "Authorization": "Bearer " + GROUP_ID + "." + ENROLLMENT_TOKEN,
                },
                201,
            )
            device_token = str(enrolled.get("deviceToken") or "")
            enrollment_keys = enrolled.get("trustedPolicyKeys") or []
            if enrolled.get("deviceId") != device_id or not device_token:
                raise RuntimeError("Canonical Agent enrollment response is incomplete.")
            if enrolled.get("checkInEndpoint") != "/api/v1/agent/checkin":
                raise RuntimeError("Canonical Agent check-in endpoint is invalid.")
            if len(enrollment_keys) != 1:
                raise RuntimeError("Canonical Agent enrollment did not deliver one policy trust anchor.")

            checkin_payload = {
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
                "acknowledgedPolicyIds": [],
                "commandResults": [],
                "waitMilliseconds": 0,
                "events": [],
            }
            checkin_body = json.dumps(checkin_payload, separators=(",", ":")).encode("utf-8")
            headers = signed_headers(key_path, checkin_body, root, device_token)
            checked = raw_call(
                "POST", "/api/v1/agent/checkin", checkin_body, headers, 200
            )
            policies = checked.get("policies") or []
            trusted_keys = checked.get("trustedPolicyKeys") or []
            if checked.get("ok") is not True or not isinstance(checked.get("commands"), list):
                raise RuntimeError("Canonical signed Agent check-in response is invalid.")
            if len(policies) != 1 or len(trusted_keys) != 1:
                raise RuntimeError("Canonical check-in did not deliver one signed effective policy.")
            if trusted_keys[0] != enrollment_keys[0]:
                raise RuntimeError("Enrollment and check-in policy trust anchors differ.")

            policy = policies[0]
            settings = policy.get("settings") or {}
            if policy.get("tenantId") != "investa" or policy.get("deviceId") != device_id:
                raise RuntimeError("Signed policy target is invalid.")
            if policy.get("version") != 2 or policy.get("epoch") != 1 or policy.get("mode") != "Normal":
                raise RuntimeError("Signed policy anti-rollback coordinates are invalid.")
            if settings.get("remoteDesktopEnabled") is not True:
                raise RuntimeError("Signed policy did not enable remote desktop.")
            for key in (
                "remoteAdministrativeDesktopEnabled",
                "remoteTerminalEnabled",
                "remoteFilesEnabled",
            ):
                if settings.get(key) is not False:
                    raise RuntimeError(f"Restrictive signed policy default is invalid: {key}")
            verify_signed_policy(policy, trusted_keys[0], root)

            raw_call(
                "POST", "/api/v1/agent/checkin", checkin_body, headers, 401
            )

            checkin_payload["acknowledgedPolicyIds"] = [policy["policyId"]]
            acknowledged_body = json.dumps(
                checkin_payload, separators=(",", ":")
            ).encode("utf-8")
            acknowledged = raw_call(
                "POST",
                "/api/v1/agent/checkin",
                acknowledged_body,
                signed_headers(key_path, acknowledged_body, root, device_token),
                200,
            )
            if acknowledged.get("policies") != []:
                raise RuntimeError("Acknowledged policy was delivered again.")

            stored = json.loads((data_root / "agents.json").read_text(encoding="utf-8"))
            device = next(
                (item for item in stored.get("devices", []) if item.get("id") == device_id),
                None,
            )
            if not device or not device.get("lastSeenAtUtc"):
                raise RuntimeError("Enrolled Agent did not persist a successful check-in.")
            if device.get("agentVersion") != "1.0.16-test":
                raise RuntimeError("Agent version was not updated by signed check-in.")
            if device.get("metadata", {}).get("protocol") != "agent-v1-ecdsa":
                raise RuntimeError("Canonical Agent protocol metadata is missing.")

            signing_document = json.loads(
                (data_root / "agent-policy-signing-key.json").read_text(encoding="utf-8")
            )
            if not signing_document.get("protectedPrivateKey") or "PRIVATE KEY" in json.dumps(signing_document):
                raise RuntimeError("Portal policy signing private key is not protected at rest.")

            print("SIRK Agent canonical ECDSA enrollment, check-in and signed policy E2E: OK")
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
