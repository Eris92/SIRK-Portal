from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "public/portal/standalone/scripts/device-tabs.js"
text = path.read_text(encoding="utf-8")
old = '        window.addEventListener("sirkportal:deviceviewmodechange", scheduleSync);\n'
new = '''        window.addEventListener("sirkportal:deviceviewmodechange", function (event) {
            var detail = event && event.detail || {};
            if ((detail.focus === true || detail.connection === true) && state.active !== "all" && state.panes[state.active]) {
                state.pendingSection[state.active] = "desktop";
                applyPendingSection(state.active, 0);
            }
            scheduleSync();
        });
'''
if old not in text:
    raise RuntimeError("Device view mode listener was not found.")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
