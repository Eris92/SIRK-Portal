from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:120]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]
view_mode = root / "public/portal/standalone/scripts/view-mode.js"
contract = root / "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode .sirk-connection-sidebar-toggle{display:flex!important}",',
    '            "html.sirk-device-focus-mode .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode .sirk-connection-sidebar-toggle{display:flex!important}",'
)

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle{left:248px}",',
    '            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle{left:248px}",'
)

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg{transform:rotate(180deg)}",',
    '            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg{transform:rotate(180deg)}",'
)

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-standalone-sidebar{position:fixed!important;inset:0 auto 0 0!important;z-index:2147483400!important;display:flex!important;width:248px!important;height:100dvh!important;box-shadow:12px 0 30px rgba(15,23,42,.34)}",',
    '            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-standalone-sidebar,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-standalone-sidebar{position:fixed!important;inset:0 auto 0 0!important;z-index:2147483400!important;display:flex!important;width:248px!important;height:100dvh!important;box-shadow:12px 0 30px rgba(15,23,42,.34)}",'
)

replace_once(
    view_mode,
    '            "html.sirk-device-focus-mode .sirk-standalone-sidebar{display:none!important}",',
    '            "html.sirk-device-focus-mode:not(.sirk-device-connection-sidebar-open) .sirk-standalone-sidebar{display:none!important}",'
)

replace_once(
    view_mode,
    '''        var connection = document.documentElement.classList.contains("sirk-device-connection-mode");
        var open = connection && document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        if (!connection) document.documentElement.classList.remove("sirk-device-connection-sidebar-open");''',
    '''        var expanded = expandedModeActive();
        var open = expanded && document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        if (!expanded) document.documentElement.classList.remove("sirk-device-connection-sidebar-open");'''
)

replace_once(
    view_mode,
    '''    function setConnectionSidebarOpen(enabled) {
        var active = document.documentElement.classList.contains("sirk-device-connection-mode");
        document.documentElement.classList.toggle("sirk-device-connection-sidebar-open", active && enabled);''',
    '''    function setConnectionSidebarOpen(enabled) {
        var active = expandedModeActive();
        document.documentElement.classList.toggle("sirk-device-connection-sidebar-open", active && enabled);'''
)

replace_once(
    contract,
    '''        Require(viewMode.Contains(".sirk-connection-sidebar-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-sidebar-open .sirk-standalone-sidebar", StringComparison.Ordinal),
            "Connection mode must retain its left-menu overlay control.");''',
    '''        Require(viewMode.Contains("html.sirk-device-focus-mode .sirk-connection-sidebar-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("html.sirk-device-connection-mode .sirk-connection-sidebar-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("var active = expandedModeActive();", StringComparison.Ordinal),
            "Both expanded Devices modes must expose the left-menu overlay control.");
        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");'''
)

print("Wide view sidebar toggle fix applied.")
