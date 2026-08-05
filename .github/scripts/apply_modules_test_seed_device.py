from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / '.github/scripts/test-dotnet10-modules.py'
text = path.read_text(encoding='utf-8-sig')

if 'from datetime import datetime, timezone\n' not in text:
    text = text.replace(
        'import urllib.request\nfrom pathlib import Path\n',
        'import urllib.request\nfrom datetime import datetime, timezone\nfrom pathlib import Path\n',
        1,
    )

old_start = '''        data_root = Path(temporary) / "data"
        data_root.mkdir(mode=0o700)
        environment = os.environ.copy()
'''
new_start = '''        data_root = Path(temporary) / "data"
        data_root.mkdir(mode=0o700)
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        device_id = "module-test-device"
        (data_root / "agents.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "groups": [
                        {
                            "id": "source",
                            "name": "Source",
                            "description": "Native module E2E",
                            "enrollmentTokenHashBase64": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                            "enabled": True,
                            "createdAtUtc": now,
                            "updatedAtUtc": now,
                        },
                        {
                            "id": "target",
                            "name": "Target",
                            "description": "Native module E2E",
                            "enrollmentTokenHashBase64": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                            "enabled": True,
                            "createdAtUtc": now,
                            "updatedAtUtc": now,
                        },
                    ],
                    "devices": [
                        {
                            "id": device_id,
                            "groupId": "source",
                            "tenantId": "tenant-modules",
                            "name": "Module Test Device",
                            "hostName": "module-test",
                            "platform": "windows-x64",
                            "agentVersion": "1.0.16-test",
                            "protectedSigningKey": "not-used-by-module-smoke",
                            "enabled": True,
                            "status": "offline",
                            "remoteAddress": "127.0.0.1",
                            "enrolledAtUtc": now,
                            "lastSeenAtUtc": None,
                            "updatedAtUtc": now,
                            "metadata": {"serial": "MODULE-001", "protocol": "test-seed"},
                        }
                    ],
                    "updatedAtUtc": now,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        environment = os.environ.copy()
'''
if text.count(old_start) != 1:
    raise RuntimeError(f'data root block: expected one occurrence, found {text.count(old_start)}')
text = text.replace(old_start, new_start, 1)

old_enrollment = '''            credentials = {}
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

'''
if text.count(old_enrollment) != 1:
    raise RuntimeError(f'legacy module enrollment block: expected one occurrence, found {text.count(old_enrollment)}')
text = text.replace(old_enrollment, '', 1)

if '/api/v1/agent/enroll' in text or 'credentials["source"]' in text:
    raise RuntimeError('modules smoke still performs Agent enrollment')

path.write_text(text, encoding='utf-8', newline='\n')
print('Modules E2E now uses an isolated seeded device instead of Agent enrollment.')
