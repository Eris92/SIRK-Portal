namespace Sirk.Portal.ProtocolTests;

internal static class DeviceConnectionWorkspaceContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var workspaceConnection = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "workspace-connection.js"));
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

        Require(workspaceConnection.Contains("var section = active(ws);", StringComparison.Ordinal) &&
                workspaceConnection.Contains("if (!s.connected) {", StringComparison.Ordinal) &&
                workspaceConnection.Contains("s.explicit = section;", StringComparison.Ordinal),
            "Connected workspace synchronization must adopt the actually active section.");
        Require(!workspaceConnection.Contains("(!s.connected || s.explicit !== active(ws))) general(ws, s)", StringComparison.Ordinal),
            "A stale explicit section must never force a connected workspace back to General.");

        Require(viewMode.Contains("function isDevicesView()", StringComparison.Ordinal) &&
                viewMode.Contains("enabled === true && isDevicesView()", StringComparison.Ordinal) &&
                viewMode.Contains("navigation.getAttribute(\"data-view\") !== \"devices\"", StringComparison.Ordinal),
            "Wide and connection modes must be scoped to the top-level Devices view.");
        Require(viewMode.Contains("function suspendExpandedModes()", StringComparison.Ordinal) &&
                viewMode.Contains("function restorePreferredExpandedMode()", StringComparison.Ordinal) &&
                viewMode.Contains("sirkPortal.devicesExpandedMode", StringComparison.Ordinal) &&
                viewMode.Contains("navigation.getAttribute(\"data-view\") !== \"devices\") suspendExpandedModes()", StringComparison.Ordinal),
            "Other top-level views must stay normal while Devices remembers and restores its expanded mode.");

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
        Require(viewMode.Contains(".sirk-connection-sidebar-toggle{position:fixed!important;left:0;top:92px", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-connection-header-toggle{position:fixed!important;left:0;top:54px", StringComparison.Ordinal) &&
                viewMode.Contains("width:12px", StringComparison.Ordinal) &&
                viewMode.Contains("width:34px", StringComparison.Ordinal) &&
                viewMode.Contains("--sirk-expanded-sidebar-width", StringComparison.Ordinal) &&
                viewMode.Contains("collapsed ? \"76px\" : \"248px\"", StringComparison.Ordinal),
            "Expanded Devices must stack the top-header and side-menu handles on the left edge and match collapsed or expanded sidebar width.");
        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");
        Require(viewMode.Contains(".sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("left:0;top:54px", StringComparison.Ordinal) &&
                viewMode.Contains("z-index:2147483560", StringComparison.Ordinal) &&
                !viewMode.Contains(".sirk-connection-sidebar-toggle:hover+.sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-sidebar-open .sirk-connection-header-toggle{left:var(--sirk-expanded-sidebar-width,248px)}", StringComparison.Ordinal) &&
                viewMode.Contains("sidebarButton.insertAdjacentElement", StringComparison.Ordinal) &&
                viewMode.Contains("afterend", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-header-open .sirk-standalone-header", StringComparison.Ordinal) &&
                viewMode.Contains("grid-template-rows:minmax(0,1fr)", StringComparison.Ordinal) &&
                viewMode.Contains("function mountConnectionHeaderToggle()", StringComparison.Ordinal),
            "Connection full view must place the top-header handle above the side-menu handle and keep both aligned with the overlay edge.");
        Require(viewMode.Contains("if (button.contains(event.target) || header.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionHeaderOpen(false);", StringComparison.Ordinal),
            "Clicking outside the connection header overlay must hide it.");
        Require(viewMode.Contains("function exitPortalFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("document.exitFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("if (expandedModeActive()) exitExpandedModes();", StringComparison.Ordinal) &&
                viewMode.Contains("var alreadyActive = document.documentElement.classList.contains", StringComparison.Ordinal) &&
                viewMode.Contains("&& !!document.fullscreenElement", StringComparison.Ordinal),
            "Expanded options must toggle off and always leave the browser fullscreen state.");
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
