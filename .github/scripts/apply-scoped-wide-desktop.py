from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:100]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]
view_mode = root / "public/portal/standalone/scripts/view-mode.js"
contract = root / "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode .sirk-quick-commands-dock,html.sirk-device-focus-mode .sirk-quick-commands-dock{z-index:60!important}",\n            "html.sirk-device-workspace-child .sirk-device-view-mode{display:none!important}"',
    '''            "html.sirk-device-focus-mode .sirk-agent-desktop>header,html.sirk-device-focus-mode .sirk-agent-desktop-controls,html.sirk-device-focus-mode .sirk-agent-desktop-stats,html.sirk-device-focus-mode .sirk-agent-desktop-admin,html.sirk-device-focus-mode .sirk-agent-desktop-input,html.sirk-device-focus-mode .sirk-agent-desktop-clipboard,html.sirk-device-focus-mode .sirk-agent-policy-action,html.sirk-device-focus-mode .sirk-agent-desktop>pre,html.sirk-device-connection-mode .sirk-agent-desktop>header,html.sirk-device-connection-mode .sirk-agent-desktop-controls,html.sirk-device-connection-mode .sirk-agent-desktop-stats,html.sirk-device-connection-mode .sirk-agent-desktop-admin,html.sirk-device-connection-mode .sirk-agent-desktop-input,html.sirk-device-connection-mode .sirk-agent-desktop-clipboard,html.sirk-device-connection-mode .sirk-agent-policy-action,html.sirk-device-connection-mode .sirk-agent-desktop>pre{display:none!important}",
            "html.sirk-device-focus-mode .sirk-agent-operation.sirk-agent-desktop,html.sirk-device-connection-mode .sirk-agent-operation.sirk-agent-desktop{display:flex!important;flex-direction:column!important;width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;overflow:hidden!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock,html.sirk-device-connection-mode .sirk-expanded-desktop-dock{position:absolute;z-index:60;top:8px;right:8px;display:block}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock[hidden],html.sirk-device-connection-mode .sirk-expanded-desktop-dock[hidden]{display:none!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle{position:relative!important;inset:auto!important;width:34px!important;min-width:34px!important;height:34px!important;min-height:34px!important;padding:0!important;border-radius:9px!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle span,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle span{display:none!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-panel,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-panel{position:absolute!important;top:42px!important;right:0!important;width:min(560px,calc(100vw - 32px))!important;max-height:min(480px,calc(100vh - 90px))!important;overflow:auto!important}",
            "html.sirk-device-workspace-child .sirk-device-view-mode{display:none!important}"'''
)

replace_once(
    view_mode,
    '    function updateConnectionSidebarToggle() {',
    '''    function isDevicesView() {
        var header = document.querySelector(".sirk-standalone-header");
        return !!(header && header.classList.contains("is-devices-view"));
    }

    function expandedModeActive() {
        return document.documentElement.classList.contains("sirk-device-focus-mode") ||
            document.documentElement.classList.contains("sirk-device-connection-mode");
    }

    var desktopPresentationTimer = 0;

    function scheduleDesktopPresentation() {
        if (desktopPresentationTimer) return;
        desktopPresentationTimer = window.setTimeout(function () {
            desktopPresentationTimer = 0;
            syncDesktopPresentation();
        }, 0);
    }

    function restoreStandardDesktop(operation, stage, toggle, panel, dock) {
        operation.classList.remove("is-expanded-desktop");
        operation.removeAttribute("data-sirk-expanded-auto-connect");
        if (toggle && stage && toggle.parentNode !== stage) stage.appendChild(toggle);
        if (panel && panel.parentNode !== operation) operation.appendChild(panel);
        if (dock) dock.remove();
        if (toggle) toggle.hidden = false;
    }

    function syncDesktopPresentation() {
        if (!isDevicesView() && expandedModeActive()) {
            exitExpandedModes();
            return;
        }

        var operation = document.querySelector("#sirkStandaloneContent .sirk-agent-operation.sirk-agent-desktop");
        if (!operation) return;
        var stage = operation.querySelector(".sirk-agent-desktop-stage");
        var toggle = operation.querySelector("#sirkQuickCommandsToggle") || document.getElementById("sirkQuickCommandsToggle");
        var panel = operation.querySelector("#sirkQuickCommandsPanel") || document.getElementById("sirkQuickCommandsPanel");
        var dock = operation.querySelector(".sirk-expanded-desktop-dock");
        var expanded = isDevicesView() && expandedModeActive();

        if (!expanded || !stage) {
            restoreStandardDesktop(operation, stage, toggle, panel, dock);
            return;
        }

        operation.classList.add("is-expanded-desktop");
        if (!dock) {
            dock = document.createElement("div");
            dock.className = "sirk-expanded-desktop-dock";
            dock.hidden = true;
            stage.appendChild(dock);
        }
        if (toggle && toggle.parentNode !== dock) dock.appendChild(toggle);
        if (panel && panel.parentNode !== dock) dock.appendChild(panel);

        var connect = operation.querySelector("[data-agent-desktop-connect]");
        var disconnect = operation.querySelector("[data-agent-desktop-disconnect]");
        var connected = !!(disconnect && !disconnect.disabled);
        dock.hidden = !connected;
        if (toggle) toggle.hidden = !connected;

        if (!connected && connect && !connect.disabled &&
            operation.getAttribute("data-sirk-expanded-auto-connect") !== "pending") {
            operation.setAttribute("data-sirk-expanded-auto-connect", "pending");
            connect.click();
            window.setTimeout(function () {
                if (!operation.isConnected) return;
                var currentDisconnect = operation.querySelector("[data-agent-desktop-disconnect]");
                if (!currentDisconnect || currentDisconnect.disabled)
                    operation.removeAttribute("data-sirk-expanded-auto-connect");
                scheduleDesktopPresentation();
            }, 3000);
        }
        else if (connected) {
            operation.setAttribute("data-sirk-expanded-auto-connect", "connected");
        }
    }

    function exitExpandedModes() {
        var changed = expandedModeActive() ||
            document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        document.documentElement.classList.remove("sirk-device-focus-mode");
        document.documentElement.classList.remove("sirk-device-connection-mode");
        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        try { localStorage.setItem("sirkPortal.focusMode", "0"); } catch (error) {}
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        if (changed) {
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", {
                detail: { focus: false, connection: false }
            }));
        }
    }

    function updateConnectionSidebarToggle() {'''
)

replace_once(
    view_mode,
    '''    function setFocusMode(enabled) {
        document.documentElement.classList.toggle("sirk-device-focus-mode", enabled);
        if (enabled) {
            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }
        try { localStorage.setItem("sirkPortal.focusMode", enabled ? "1" : "0"); }
        catch (error) {}
        updateConnectionSidebarToggle();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: enabled, connection: false } }));
    }''',
    '''    function setFocusMode(enabled) {
        enabled = enabled === true && isDevicesView();
        document.documentElement.classList.toggle("sirk-device-focus-mode", enabled);
        if (enabled) {
            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }
        try { localStorage.setItem("sirkPortal.focusMode", enabled ? "1" : "0"); }
        catch (error) {}
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: enabled, connection: false } }));
    }'''
)

replace_once(
    view_mode,
    '''    function setConnectionMode(enabled) {
        document.documentElement.classList.toggle("sirk-device-connection-mode", enabled);
        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: false, connection: enabled } }));
    }''',
    '''    function setConnectionMode(enabled) {
        enabled = enabled === true && isDevicesView();
        document.documentElement.classList.toggle("sirk-device-connection-mode", enabled);
        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: false, connection: enabled } }));
    }'''
)

replace_once(
    view_mode,
    '''    function restoreFocusMode() {
        try { setFocusMode(localStorage.getItem("sirkPortal.focusMode") === "1"); }
        catch (error) { setFocusMode(false); }
    }''',
    '''    function restoreFocusMode() {
        exitExpandedModes();
    }'''
)

replace_once(
    view_mode,
    '''            toggle.classList.toggle("is-active", focusActive || connectionActive);
            updateConnectionSidebarToggle();''',
    '''            toggle.classList.toggle("is-active", focusActive || connectionActive);
            updateConnectionSidebarToggle();
            scheduleDesktopPresentation();'''
)

replace_once(
    view_mode,
    '''    var observerRoot = document.getElementById("sirkStandaloneRoot");
    if (observerRoot) new MutationObserver(function () {
        mountViewModeButton();
        mountConnectionSidebarToggle();
    }).observe(observerRoot, { childList: true, subtree: true });''',
    '''    document.addEventListener("click", function (event) {
        var navigation = event.target && event.target.closest &&
            event.target.closest(".sirk-standalone-nav [data-view]");
        if (!navigation) return;
        if (navigation.getAttribute("data-view") !== "devices") exitExpandedModes();
    }, true);

    var observerRoot = document.getElementById("sirkStandaloneRoot");
    if (observerRoot) new MutationObserver(function () {
        mountViewModeButton();
        mountConnectionSidebarToggle();
        if (!isDevicesView() && expandedModeActive()) exitExpandedModes();
        scheduleDesktopPresentation();
    }).observe(observerRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "hidden"]
    });
    scheduleDesktopPresentation();'''
)

contract.write_text('''namespace Sirk.Portal.ProtocolTests;

internal static class DeviceConnectionWorkspaceContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));

        Require(workspace.Contains("function renderAgentTerminal(host, node)", StringComparison.Ordinal) &&
                workspace.Contains("function renderAgentFiles(host, node)", StringComparison.Ordinal) &&
                workspace.Contains("function renderAgentDesktop(host, node)", StringComparison.Ordinal),
            "Desktop changes must preserve Terminal and Files.");

        foreach (var standardControl in new[]
                 {
                     "sirk-agent-operation sirk-agent-desktop", "sirk-agent-desktop-controls",
                     "sirk-agent-desktop-stats", "sirk-agent-desktop-admin",
                     "sirk-agent-desktop-input", "sirk-agent-desktop-clipboard",
                     "sirk-agent-policy-action", "data-agent-desktop-connect",
                     "data-agent-desktop-disconnect"
                 })
            Require(workspace.Contains(standardControl, StringComparison.Ordinal),
                "Normal Desktop must retain its standard control: " + standardControl);

        Require(workspace.Contains("connectButton.addEventListener", StringComparison.Ordinal) &&
                !workspace.Contains("connectDesktop();", StringComparison.Ordinal),
            "Normal Desktop must require its standard manual Connect button.");
        Require(workspace.Contains("ensureCompactCommands(host)", StringComparison.Ordinal),
            "Normal Desktop must retain standard Quick Commands.");

        Require(viewMode.Contains("function isDevicesView()", StringComparison.Ordinal) &&
                viewMode.Contains("enabled === true && isDevicesView()", StringComparison.Ordinal) &&
                viewMode.Contains("navigation.getAttribute(\\\"data-view\\\") !== \\\"devices\\\"", StringComparison.Ordinal),
            "Wide and connection modes must be scoped to the top-level Devices view.");
        Require(viewMode.Contains("function exitExpandedModes()", StringComparison.Ordinal) &&
                viewMode.Contains("localStorage.setItem(\\\"sirkPortal.focusMode\\\", \\\"0\\\")", StringComparison.Ordinal),
            "Leaving Devices must immediately reset every expanded mode.");

        Require(viewMode.Contains("function syncDesktopPresentation()", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-controls", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-stats", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-admin", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-input", StringComparison.Ordinal),
            "Screen-only styling must exist only inside expanded-mode CSS.");
        Require(viewMode.Contains("connect.click();", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-expanded-desktop-dock", StringComparison.Ordinal) &&
                viewMode.Contains("restoreStandardDesktop", StringComparison.Ordinal),
            "Expanded Desktop must auto-connect, pin Quick Commands and restore the standard layout afterward.");

        Require(tabsCss.Contains("padding:0 12px!important", StringComparison.Ordinal),
            "The Devices header must keep its 12px inset.");
        Require(viewMode.Contains(".sirk-connection-sidebar-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-sidebar-open .sirk-standalone-sidebar", StringComparison.Ordinal),
            "Connection mode must retain its left-menu overlay control.");
        Require(commandsCss.Contains(".sirk-quick-commands-panel", StringComparison.Ordinal),
            "The shared Quick Commands presentation must remain available in normal Desktop mode.");
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

print("Scoped wide desktop migration applied.")
