from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}: {count}\nMarker: {old[:160]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


app = ROOT / "public/portal/standalone/scripts/app.js"
replace_once(
    app,
    '''    function clearLoadingOverlay() {''',
    '''    function applyHeaderView(view) {
        var header = title && title.closest(".sirk-standalone-header");
        var devices = view === "devices";
        if (header) header.classList.toggle("is-devices-view", devices);
        if (title) {
            title.hidden = devices;
            title.setAttribute("aria-hidden", devices ? "true" : "false");
        }
    }

    function clearLoadingOverlay() {''')
replace_once(
    app,
    '''        title.textContent = viewName(activeView);
    }

    function applyUserProfile() {''',
    '''        title.textContent = viewName(activeView);
        applyHeaderView(activeView);
    }

    function applyUserProfile() {''')
replace_once(
    app,
    '''        applyViewSurface(view);
        applyShellLanguage();''',
    '''        applyViewSurface(view);
        applyHeaderView(view);
        applyShellLanguage();''')


device_tabs = ROOT / "public/portal/standalone/scripts/device-tabs.js"
replace_once(
    device_tabs,
    '''        main: null,
        content: null,''',
    '''        main: null,
        header: null,
        content: null,''')
replace_once(
    device_tabs,
    '''        var content = document.getElementById("sirkStandaloneContent");
        var main = content && content.closest(".sirk-standalone-main");
        if (!content || !main) return false;
        state.content = content;
        state.main = main;''',
    '''        var content = document.getElementById("sirkStandaloneContent");
        var main = content && content.closest(".sirk-standalone-main");
        var header = main && main.querySelector(".sirk-standalone-header");
        if (!content || !main || !header) return false;
        state.content = content;
        state.main = main;
        state.header = header;''')
replace_once(
    device_tabs,
    '''        if (!state.bar || !state.bar.isConnected) {
            state.bar = document.createElement("div");
            state.bar.className = "sirk-device-tabs sirk-device-tabs-standalone";
            state.bar.setAttribute("role", "tablist");
            main.insertBefore(state.bar, content);
        }''',
    '''        if (!state.bar || !state.bar.isConnected) {
            state.bar = document.createElement("div");
            state.bar.className = "sirk-device-tabs sirk-device-tabs-standalone";
            state.bar.setAttribute("role", "tablist");
        }
        var userMenu = header.querySelector("#sirkUserMenu");
        var anchor = header.querySelector(".sirk-device-view-mode") || userMenu;
        if (state.bar.parentNode !== header || state.bar.nextElementSibling !== anchor) {
            header.insertBefore(state.bar, anchor || null);
        }''')
replace_once(
    device_tabs,
    '''        var visible = devicesActive();
        state.bar.hidden = !visible;''',
    '''        var visible = devicesActive();
        if (state.header) state.header.classList.toggle("is-devices-view", visible);
        state.bar.hidden = !visible;''')


view_mode = ROOT / "public/portal/standalone/scripts/view-mode.js"
replace_once(
    view_mode,
    '''            ".sirk-device-tabs-standalone{position:relative!important;padding-right:54px!important;overflow:visible!important}",
            ".sirk-device-view-mode{position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:2147483000}",''',
    '''            ".sirk-device-view-mode{display:none;flex:0 0 auto;margin-left:8px;z-index:2147483000}",
            ".sirk-standalone-header.is-devices-view .sirk-device-view-mode{display:block}",''')
replace_once(
    view_mode,
    '''        var bar = document.querySelector(".sirk-device-tabs-standalone");
        if (!bar || bar.querySelector(".sirk-device-view-mode")) return false;''',
    '''        var header = document.querySelector(".sirk-standalone-header");
        var userMenu = header && header.querySelector("#sirkUserMenu");
        if (!header || header.querySelector(".sirk-device-view-mode")) return false;''')
replace_once(
    view_mode,
    '''        host.appendChild(toggle);
        bar.appendChild(host);
        document.body.appendChild(menu);''',
    '''        host.appendChild(toggle);
        header.insertBefore(host, userMenu || null);
        document.body.appendChild(menu);''')


css = ROOT / "public/portal/standalone/styles/device-tabs.css"
text = css.read_text(encoding="utf-8")
text = text.replace(
    '#sirkPortalRoot .sirk-standalone-header{flex:0 0 69px!important;border-bottom:0!important}',
    '#sirkPortalRoot .sirk-standalone-header{flex:0 0 69px!important;gap:8px!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important}')
text = text.replace(
    '#sirkPortalRoot .sirk-device-tabs-standalone{flex:0 0 46px;width:100%;margin:0;z-index:30}',
    '#sirkPortalRoot .sirk-device-tabs-standalone{flex:1 1 auto;width:auto;min-width:0;height:46px;min-height:46px;margin:0;padding:4px 0;border-bottom:0;background:transparent;z-index:30}')
old_adjacent = '#sirkPortalRoot .sirk-device-tabs-standalone:not([hidden]) + #sirkStandaloneContent{flex:1 1 auto!important;min-height:0!important;height:auto!important;overflow:hidden!important;padding:12px!important;margin:0!important;box-sizing:border-box!important}\n'
if old_adjacent not in text:
    raise RuntimeError("Legacy separate-row content selector was not found")
text = text.replace(old_adjacent, '')
marker = '#sirkPortalRoot .sirk-device-tab-close:hover{background:rgba(220,38,38,.14);color:#dc2626;opacity:1}\n'
if marker not in text:
    raise RuntimeError("Device tab close marker was not found")
header_css = '''#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkStandaloneTitle{display:none!important}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-menu{flex:0 0 auto;margin-left:0}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-tile{display:grid;place-items:center;width:44px;min-width:44px;height:44px;min-height:44px;padding:4px;gap:0;border-radius:12px}
#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkUserName{display:none!important}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-tile img{width:34px;height:34px}
'''
text = text.replace(marker, marker + header_css, 1)
css.write_text(text, encoding="utf-8")


contract = ROOT / "tests/Sirk.Portal.ProtocolTests/DeviceHeaderLayoutContract.cs"
contract.write_text('''namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHeaderLayoutContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var app = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "app.js"));
        var tabs = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var css = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));

        Require(app.Contains("function applyHeaderView(view)", StringComparison.Ordinal),
            "Devices must have an explicit header layout state.");
        Require(app.Contains("title.hidden = devices", StringComparison.Ordinal) &&
                app.Contains("is-devices-view", StringComparison.Ordinal),
            "The Devices header title must be hidden without affecting other views.");
        Require(tabs.Contains("header.insertBefore(state.bar, anchor || null)", StringComparison.Ordinal),
            "Device tabs must be mounted inside the main header.");
        Require(!tabs.Contains("main.insertBefore(state.bar, content)", StringComparison.Ordinal),
            "Device tabs must not create a separate row above content.");
        Require(viewMode.Contains("header.insertBefore(host, userMenu || null)", StringComparison.Ordinal),
            "The view-mode button must be immediately before the user control.");
        Require(!viewMode.Contains("bar.appendChild(host)", StringComparison.Ordinal),
            "The view-mode button must not remain inside the tab strip.");
        Require(css.Contains(".sirk-standalone-header.is-devices-view #sirkUserName{display:none!important}", StringComparison.Ordinal),
            "Only Devices must hide the user name.");
        Require(css.Contains(".sirk-device-tabs-standalone{flex:1 1 auto", StringComparison.Ordinal),
            "Device tabs must fill the former title area.");
        Require(!css.Contains(".sirk-device-tabs-standalone:not([hidden]) + #sirkStandaloneContent", StringComparison.Ordinal),
            "The legacy standalone tab row contract must be removed.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj")))
                return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
''', encoding="utf-8")

program = ROOT / "tests/Sirk.Portal.ProtocolTests/Program.cs"
replace_once(
    program,
    '''CommandWorkspaceStyleContract.Run();
''',
    '''CommandWorkspaceStyleContract.Run();
DeviceHeaderLayoutContract.Run();
''')

print("Devices header layout migration applied.")
