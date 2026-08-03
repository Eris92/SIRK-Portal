#!/usr/bin/env python3
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


test = ".github/scripts/test-dotnet10-native-settings-v2.py"
replace_once(
    test,
    '            "Sirk__Central__Enabled": "false",\n',
    '            "Sirk__Central__Enabled": "false",\n            "Sirk__Central__ConnectionFile": str(data_root / "central-connection.json"),\n',
)
replace_once(
    test,
    '''                "/api/v1/admin/maintenance/status",
                '"Break-Glass"',
''',
    '''                "/api/v1/admin/maintenance/status",
                "/api/v1/admin/central",
                "/api/v1/admin/computer-groups",
                '"Aktualizuj teraz"',
                '"Połączenie z Central"',
                '"Grupy komputerów"',
                '"Break-Glass"',
''',
)

insert_before = '            maintenance = browser.json("GET", "/api/v1/admin/maintenance/status")["value"]\n'
e2e = '''            icon_sprite, _ = browser.call("GET", "/assets/icons/sirk-ui.svg", accept="image/svg+xml")
            icon_source = icon_sprite.decode("utf-8")
            for symbol in ("home", "devices", "management", "settings", "chevron-left"):
                if f'<symbol id="{symbol}"' not in icon_source:
                    raise RuntimeError(f"Canonical icon sprite is missing symbol: {symbol}")

            central_payload = {
                "schemaVersion": 1,
                "centralUrl": "https://central.example.test",
                "tunnelUrl": "wss://central.example.test/tunnel",
                "portalId": "native-test-portal",
                "portalName": "Native Test Portal",
                "portalToken": "Abcdefghijklmnopqrstuvwxyz0123456789_-TOKEN",
                "publicUrl": "https://portal.example.test",
            }
            central = browser.json("PUT", "/api/v1/admin/central", central_payload)["value"]
            if not central.get("configured") or not central.get("restartRequired"):
                raise RuntimeError("Central connection was not persisted.")
            if central_payload["portalToken"] in json.dumps(central):
                raise RuntimeError("Central token was returned without redaction.")
            central = browser.json("GET", "/api/v1/admin/central")["value"]
            if central.get("configuration", {}).get("portalId") != "native-test-portal":
                raise RuntimeError("Central connection status is incomplete.")
            central = browser.json("DELETE", "/api/v1/admin/central")["value"]
            if central.get("configured") is not False:
                raise RuntimeError("Central connection was not removed.")

            groups = browser.json("POST", "/api/v1/admin/computer-groups", {
                "id": "native-computers",
                "name": "Native Computers",
                "description": "Native settings E2E",
            })
            first_token = groups.get("enrollmentToken")
            if not first_token:
                raise RuntimeError("Computer group enrollment token was not issued.")
            item_by(groups["value"]["groups"], "id", "native-computers")
            groups = browser.json("PUT", "/api/v1/admin/computer-groups/native-computers", {
                "name": "Native Computers Updated",
                "description": "Updated",
                "enabled": True,
            })
            if item_by(groups["value"]["groups"], "id", "native-computers").get("name") != "Native Computers Updated":
                raise RuntimeError("Computer group update was not persisted.")
            rotated = browser.json("POST", "/api/v1/admin/computer-groups/native-computers/rotate-token", {})
            if not rotated.get("enrollmentToken") or rotated["enrollmentToken"] == first_token:
                raise RuntimeError("Computer group token was not rotated.")
            groups = browser.json("DELETE", "/api/v1/admin/computer-groups/native-computers")
            if any(value.get("id") == "native-computers" for value in groups["value"]["groups"]):
                raise RuntimeError("Computer group was not deleted.")

'''
replace_once(test, insert_before, e2e + insert_before)
