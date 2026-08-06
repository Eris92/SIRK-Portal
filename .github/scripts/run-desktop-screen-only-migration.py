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
