from pathlib import Path
import runpy

path = Path(__file__).with_name("apply-desktop-screen-only.py")
lines = path.read_text(encoding="utf-8").splitlines()
changed = False
for index, line in enumerate(lines):
    if "host\\.innerHTML" in line and "sirk-agent-operation sirk-agent-desktop" in line:
        lines[index] = '    r"        host\\.innerHTML = .*?;\\n        ensureCompactCommands\\(host\\);",'
        changed = True
        break
if not changed:
    raise RuntimeError("Desktop markup matcher was not found in migration script.")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
runpy.run_path(str(path), run_name="__main__")

root = Path(__file__).resolve().parents[2]
contract_path = root / "tests" / "Sirk.Portal.ProtocolTests" / "CanonicalAgentManagementV1Contract.cs"
contract = contract_path.read_text(encoding="utf-8-sig")
old = '''        Require(workspace.Contains("OPERATION_NOT_ALLOWED", StringComparison.Ordinal) &&
                workspace.Contains("/api/v1/admin/agent-policies", StringComparison.Ordinal),
            "Desktop workspace does not surface or remediate policy rejection.");'''
new = '''        Require(workspace.Contains("Agent odrzucił pobranie sesji", StringComparison.Ordinal) &&
                workspace.Contains("scheduleReconnect", StringComparison.Ordinal) &&
                !workspace.Contains("/api/v1/admin/agent-policies", StringComparison.Ordinal),
            "The screen-only desktop must fail closed and retry without exposing a policy administration control.");'''
if contract.count(old) != 1:
    raise RuntimeError("Canonical Agent policy UI contract was not found exactly once.")
contract_path.write_text(contract.replace(old, new, 1), encoding="utf-8", newline="\n")

codec_contract_path = root / "tests" / "Sirk.Portal.ProtocolTests" / "DesktopImageCodecUiContract.cs"
codec_contract = codec_contract_path.read_text(encoding="utf-8-sig")
old_codec = '''        foreach (var marker in new[]
                 {
                     "data-agent-desktop-codec", "data-agent-desktop-quality",
                     "imageEncoding: settings.imageEncoding", "codec: \\\"webp\\\"",
                     "codec: \\\"png\\\"", "codec: \\\"jpeg\\\"",
                     "image\\\\/(?:jpeg|png|webp)", "Math"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Desktop codec UI marker is missing: " + marker);
'''
new_codec = '''        foreach (var marker in new[]
                 {
                     "function effectiveProfile()", "imageEncoding: settings.imageEncoding",
                     "codec: \\\"webp\\\"", "codec: \\\"png\\\"", "codec: \\\"jpeg\\\"",
                     "image\\\\/(?:jpeg|png|webp)", "activeAutoProfile"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Desktop automatic codec marker is missing: " + marker);

        Require(!workspace.Contains("data-agent-desktop-codec", StringComparison.Ordinal) &&
                !workspace.Contains("data-agent-desktop-quality", StringComparison.Ordinal),
            "The screen-only desktop must not expose codec or quality controls.");
'''
if codec_contract.count(old_codec) != 1:
    raise RuntimeError("Desktop codec UI contract block was not found exactly once.")
codec_contract_path.write_text(codec_contract.replace(old_codec, new_codec, 1), encoding="utf-8", newline="\n")

connection_contract_path = root / "tests" / "Sirk.Portal.ProtocolTests" / "DeviceConnectionWorkspaceContract.cs"
connection_contract = connection_contract_path.read_text(encoding="utf-8-sig")
old_layering = '''        Require(viewMode.Contains(".sirk-quick-commands-panel{z-index:59", StringComparison.Ordinal),
            "Quick Commands must remain above the connected desktop.");'''
new_layering = '''        Require(viewMode.Contains(".sirk-quick-commands-dock{z-index:60", StringComparison.Ordinal) &&
                commandsCss.Contains("z-index:45", StringComparison.Ordinal),
            "The pinned Quick Commands dock must remain above the connected desktop.");'''
if connection_contract.count(old_layering) != 1:
    raise RuntimeError("Quick Commands layering contract was not found exactly once.")
connection_contract_path.write_text(
    connection_contract.replace(old_layering, new_layering, 1),
    encoding="utf-8",
    newline="\n")
