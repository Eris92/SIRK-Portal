from pathlib import Path

path = Path(__file__).resolve().parents[2] / ".github/scripts/test-dotnet10-full-ui.py"
text = path.read_text(encoding="utf-8")
text = text.replace(
'''                "/assets/standalone-core.js": "text/javascript",\n                "/assets/portal-standalone.js": "text/javascript",\n                "/assets/settings.js": "text/javascript",\n''',
'''                "/assets/bundles/portal-shell.bundle.js": "text/javascript",\n                "/assets/bundles/portal-devices.bundle.js": "text/javascript",\n                "/assets/bundles/portal-modules.bundle.js": "text/javascript",\n''',
1)
text = text.replace(
'''                '/assets/portal-standalone.js',\n''',
'''                '/assets/bundles/portal-shell.bundle.js',\n''',
1)
if '/assets/portal-standalone.js' in text:
    raise SystemExit("legacy standalone asset marker remains in full UI contract")
if '/assets/bundles/portal-shell.bundle.js' not in text:
    raise SystemExit("bundle shell marker was not added")
path.write_text(text, encoding="utf-8", newline="\n")
