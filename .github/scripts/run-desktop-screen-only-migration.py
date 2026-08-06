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
