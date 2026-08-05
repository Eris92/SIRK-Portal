from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}\n--- old ---\n{old}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]

tabs_js = root / "public/portal/standalone/scripts/device-tabs.js"
tabs_css = root / "public/portal/standalone/styles/device-tabs.css"
view_mode = root / "public/portal/standalone/scripts/view-mode.js"
commands_css = root / "public/shared/ui/commands.css"
contract = root / "tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs"

replace_once(
    tabs_js,
    'if (window.__sirkPlatformDeviceTabsV13Loaded) return;\n    window.__sirkPlatformDeviceTabsV13Loaded = true;',
    'if (window.__sirkPlatformDeviceTabsV14Loaded) return;\n    window.__sirkPlatformDeviceTabsV14Loaded = true;'
)
replace_once(
    tabs_js,
    '    function wideMode() { return document.documentElement.classList.contains("sirk-device-focus-mode"); }',
    '    function wideMode() {\n        return document.documentElement.classList.contains("sirk-device-focus-mode") ||\n            document.documentElement.classList.contains("sirk-device-connection-mode");\n    }'
)
replace_once(
    tabs_js,
    '    function positionMenu(toggle) {',
    '''    function syncQuickCommandsToggle() {
        if (!state.header || !state.content) return;
        var panel = state.content.querySelector("#sirkQuickCommandsPanel");
        var toggle = document.getElementById("sirkQuickCommandsToggle");
        if (!panel) {
            if (toggle && toggle.classList.contains("is-header-mounted")) toggle.remove();
            return;
        }
        if (!toggle || !desktopMode()) return;
        var anchor = state.header.querySelector(".sirk-device-view-mode") || state.header.querySelector("#sirkUserMenu");
        toggle.classList.add("is-header-mounted");
        if (toggle.parentNode !== state.header || toggle.nextElementSibling !== anchor) {
            state.header.insertBefore(toggle, anchor || null);
        }
    }

    function positionMenu(toggle) {'''
)
replace_once(
    tabs_js,
    '''        if (!visible) {
            hideMenu();
            return;
        }''',
    '''        if (!visible) {
            hideMenu();
            syncQuickCommandsToggle();
            return;
        }'''
)
replace_once(
    tabs_js,
    '''        if (statusesChanged) persist();
        renderTabs();''',
    '''        if (statusesChanged) persist();
        syncQuickCommandsToggle();
        renderTabs();'''
)

replace_once(
    tabs_css,
    '''#sirkPortalRoot .sirk-device-host-tab{display:grid;grid-template-columns:minmax(72px,1fr) 25px;min-width:118px;padding:0;overflow:visible}
#sirkPortalRoot .sirk-device-tab-main{display:flex;align-items:center;justify-content:center;min-width:0;height:100%;padding:0 10px;border:0;border-radius:8px 0 0 8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
#sirkPortalRoot .sirk-device-tab-actions{display:grid;grid-template-rows:minmax(0,1fr);height:100%;border-left:1px solid rgba(101,113,135,.28)}
#sirkPortalRoot .sirk-device-tab-close,#sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid;place-items:center;width:24px;min-width:24px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:600 14px/1 Segoe UI,Arial,sans-serif;cursor:pointer;opacity:.78}
#sirkPortalRoot .sirk-device-tab-menu-toggle{display:none;font-size:12px}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions{grid-template-rows:1fr 1fr}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-close{border-bottom:1px solid rgba(101,113,135,.28)}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}''',
    '''#sirkPortalRoot .sirk-device-host-tab{display:grid;grid-template-columns:minmax(72px,1fr) 25px;grid-template-rows:1fr 1fr;min-width:118px;padding:0;overflow:visible}
#sirkPortalRoot .sirk-device-tab-main{grid-column:1;grid-row:1 / span 2;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0!important;height:auto;padding:0 10px;border:0;border-radius:8px 0 0 8px;background:transparent;color:inherit;font:inherit;cursor:pointer;box-sizing:border-box}
#sirkPortalRoot .sirk-device-tab-actions{grid-column:2;grid-row:1 / span 2;align-self:stretch;display:grid;grid-template-rows:minmax(0,1fr);min-height:0;height:auto;border-left:1px solid rgba(101,113,135,.28)}
#sirkPortalRoot .sirk-device-tab-close,#sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid;place-items:center;width:24px;min-width:24px;min-height:0!important;height:auto;padding:0;border:0;background:transparent;color:inherit;font:600 14px/1 Segoe UI,Arial,sans-serif;cursor:pointer;opacity:.78;box-sizing:border-box}
#sirkPortalRoot .sirk-device-tab-menu-toggle{display:none;font-size:12px}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions,
html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-actions{grid-template-rows:1fr 1fr}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-close,
html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-close{border-bottom:1px solid rgba(101,113,135,.28)}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-menu-toggle,
html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}'''
)
replace_once(
    tabs_css,
    '#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkStandaloneTitle{display:none!important}',
    '''html.sirk-device-focus-mode #sirkPortalRoot .sirk-standalone-header,
html.sirk-device-connection-mode #sirkPortalRoot .sirk-standalone-header{flex:0 0 48px!important;min-height:48px!important;height:48px!important;padding:2px 22px!important;box-sizing:border-box!important}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-standalone-content,
html.sirk-device-connection-mode #sirkPortalRoot .sirk-standalone-content{padding:0!important;margin:0!important}
#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkStandaloneTitle{display:none!important}'''
)

replace_once(
    commands_css,
    '#sirkPortalRoot .sirk-quick-commands-toggle svg{width:18px;height:18px}',
    '''#sirkPortalRoot .sirk-quick-commands-toggle svg{width:18px;height:18px}
#sirkPortalRoot .sirk-quick-commands-toggle.is-header-mounted{
    position:static!important;
    inset:auto!important;
    flex:0 0 44px;
    width:44px;
    min-width:44px;
    height:44px;
    min-height:44px;
    margin:0;
    padding:0;
    gap:0;
    border-radius:12px;
    box-shadow:0 3px 10px rgba(15,23,42,.08);
}
#sirkPortalRoot .sirk-quick-commands-toggle.is-header-mounted span{display:none}
#sirkPortalRoot .sirk-quick-commands-toggle.is-header-mounted svg{width:20px;height:20px}'''
)

replace_once(
    view_mode,
    '            "html.sirk-device-focus-mode #sirkPortalRoot,html.sirk-device-focus-mode #sirkStandaloneRoot,html.sirk-device-focus-mode .sirk-standalone-main{width:100%!important;height:100%!important;min-height:100%!important}",',
    '''            "html.sirk-device-focus-mode #sirkPortalRoot,html.sirk-device-focus-mode #sirkStandaloneRoot,html.sirk-device-focus-mode .sirk-standalone-main{width:100%!important;height:100%!important;min-height:100%!important}",
            "html.sirk-device-focus-mode .sirk-standalone-header,html.sirk-device-connection-mode .sirk-standalone-header{padding:2px 22px!important}",'''
)
replace_once(
    view_mode,
    '            "html.sirk-device-focus-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;box-sizing:border-box!important;overflow:hidden!important}",',
    '            "html.sirk-device-focus-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border-radius:0!important;box-sizing:border-box!important;overflow:hidden!important}",'
)
replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;padding:0!important;gap:0!important;overflow:hidden!important}",',
    '            "html.sirk-device-connection-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border-radius:0!important;box-sizing:border-box!important;overflow:hidden!important}",'
)
replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode .sirk-quick-commands-toggle{z-index:60!important}",',
    '            "html.sirk-device-connection-mode .sirk-quick-commands-toggle.is-header-mounted,html.sirk-device-focus-mode .sirk-quick-commands-toggle.is-header-mounted{z-index:60!important}",'
)

replace_once(
    contract,
    '''        Require(tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}", StringComparison.Ordinal),
            "The lower split-menu control must only appear in wide mode.");''',
    '''        Require(tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}", StringComparison.Ordinal),
            "The lower split-menu control must appear in both expanded device modes.");'''
)
replace_once(
    contract,
    '''        Require(viewMode.Contains("width:44px;height:44px", StringComparison.Ordinal),
            "The view-mode and user controls must use the same 44px footprint.");''',
    '''        Require(viewMode.Contains("width:44px;height:44px", StringComparison.Ordinal),
            "The view-mode and user controls must use the same 44px footprint.");
        Require(tabsScript.Contains("syncQuickCommandsToggle", StringComparison.Ordinal) &&
                tabsScript.Contains("is-header-mounted", StringComparison.Ordinal) &&
                File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css")).Contains(".sirk-quick-commands-toggle.is-header-mounted", StringComparison.Ordinal),
            "Quick Commands must mount in the expanded header instead of being clipped by the desktop stage.");
        Require(tabsCss.Contains("padding:2px 22px!important", StringComparison.Ordinal) &&
                viewMode.Contains("padding:0!important;gap:0!important;border-radius:0!important", StringComparison.Ordinal),
            "Expanded connection mode must remove content spacing and rounded desktop framing.");'''
)

print("Expanded connection layout migration applied.")
