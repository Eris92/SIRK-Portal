namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHostTabSplitContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var transportScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "central-tunnel-transport.js"));
        var workspaceScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var tabsScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var connectionScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "workspace-connection.js"));
        var lifecycleScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs-lifecycle-v4.js"));
        var selectionScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tab-selection-state.js"));
        var headerContextScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "header-toggle-context-menu.js"));
        var bundler = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));

        Require(transportScript.Contains("window.detailItem = function", StringComparison.Ordinal) &&
                transportScript.Contains("sirk-device-detail-item", StringComparison.Ordinal) &&
                workspaceScript.Contains("detailItem(t(\"name\")", StringComparison.Ordinal),
            "The device detail helper must exist before workspace initialization so one missing function cannot leave every section empty.");

        Require(tabsScript.Contains("data-device-tab-close", StringComparison.Ordinal) &&
                tabsScript.Contains("data-device-tab-menu-toggle", StringComparison.Ordinal) &&
                tabsScript.Contains("TAB_ICONS.close", StringComparison.Ordinal) &&
                tabsScript.Contains("TAB_ICONS.menu", StringComparison.Ordinal),
            "Host tabs must retain crisp close and section-menu controls.");

        Require(connectionScript.Contains("data-sirk-workspace-connection-toggle", StringComparison.Ordinal) &&
                connectionScript.Contains("is-connected", StringComparison.Ordinal) &&
                connectionScript.Contains("is-disconnected", StringComparison.Ordinal) &&
                connectionScript.Contains("Rozłącz", StringComparison.Ordinal) &&
                connectionScript.Contains("Połącz", StringComparison.Ordinal),
            "The device workspace must expose one explicit Connect/Disconnect toggle.");

        Require(connectionScript.Contains("type === \"general\" || connected", StringComparison.Ordinal) &&
                connectionScript.Contains("button.disabled = !allowed", StringComparison.Ordinal) &&
                connectionScript.Contains("Najpierw połącz z urządzeniem", StringComparison.Ordinal),
            "Overview must remain available while remote sections stay disabled until explicit connection.");

        Require(connectionScript.Contains("s.explicit !== active(ws)", StringComparison.Ordinal) &&
                connectionScript.Contains("s.explicit !== \"desktop\"", StringComparison.Ordinal) &&
                connectionScript.Contains("sirkWorkspaceStarted", StringComparison.Ordinal),
            "Programmatic Desktop activation must be rejected and Desktop streaming may start only after an explicit workspace connection and tab choice.");

        Require(connectionScript.Contains(".sirk-device-tab-connection-actions{display:none!important}", StringComparison.Ordinal) &&
                connectionScript.Contains(".sirk-device-host-tab.is-online", StringComparison.Ordinal) &&
                connectionScript.Contains(".sirk-device-host-tab.is-offline", StringComparison.Ordinal) &&
                connectionScript.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) &&
                connectionScript.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) &&
                connectionScript.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal),
            "Host tabs must hide per-tab connection actions and reuse the sidebar active style with online/offline accents.");

        Require(connectionScript.Contains("[data-agent-desktop-connect]", StringComparison.Ordinal) &&
                connectionScript.Contains("[data-agent-desktop-disconnect]", StringComparison.Ordinal) &&
                connectionScript.Contains("desktopStop(ws)", StringComparison.Ordinal),
            "The single workspace toggle must control the real Desktop stream without exposing duplicate Desktop buttons.");

        Require(lifecycleScript.Contains("sessionStorage", StringComparison.Ordinal) &&
                lifecycleScript.Contains("function restoreWorkspace(ws)", StringComparison.Ordinal) &&
                lifecycleScript.Contains("data-sirk-lifecycle-connection", StringComparison.Ordinal),
            "Refresh must restore the logical connection once per mounted workspace and the wide dropdown must start with Connect/Disconnect.");
        Require(lifecycleScript.Contains("function wideMode()", StringComparison.Ordinal) &&
                lifecycleScript.Contains("menu.hidden = true", StringComparison.Ordinal) &&
                lifecycleScript.Contains("has-section-menu", StringComparison.Ordinal),
            "The host dropdown must be available only in wide or connection mode.");
        Require(lifecycleScript.Contains(".sirk-device-tab-pane.is-active", StringComparison.Ordinal) &&
                lifecycleScript.Contains("function showSection(ws, section, persist)", StringComparison.Ordinal) &&
                lifecycleScript.Contains("Array.prototype.forEach.call(body.children", StringComparison.Ordinal),
            "Workspace sections must explicitly activate their populated panes instead of rendering blank content.");
        Require(lifecycleScript.Contains("border-bottom:1px solid", StringComparison.Ordinal) &&
                lifecycleScript.Contains("border-radius:0!important", StringComparison.Ordinal) &&
                lifecycleScript.Contains("border-bottom-color:var(--sirk-active-accent", StringComparison.Ordinal),
            "The workspace navigation must use a flat divider and underline instead of a rounded container.");
        Require(lifecycleScript.Contains("rgba(239,68,68,.72)", StringComparison.Ordinal) &&
                lifecycleScript.Contains("width:12px", StringComparison.Ordinal),
            "The close glyph must stay small and subtly red without a filled hover background.");
        Require(lifecycleScript.Contains("#sirkPortalRoot:not(.sirk-theme-dark)", StringComparison.Ordinal) &&
                lifecycleScript.Contains("#sirkPortalRoot.sirk-theme-dark", StringComparison.Ordinal),
            "Host tabs and their dropdown must follow the active light or dark Portal theme.");

        Require(selectionScript.Contains("pointerdown", StringComparison.Ordinal) &&
                selectionScript.Contains("element.removeAttribute(\"data-device-workspace-key\")", StringComparison.Ordinal) &&
                selectionScript.Contains("function findDeviceRow", StringComparison.Ordinal) &&
                selectionScript.Contains("row.click()", StringComparison.Ordinal),
            "Device host and All tabs must complete navigation on the first pointer interaction instead of requiring a second click.");
        Require(selectionScript.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) &&
                selectionScript.Contains("inset 3px 0 0 var(--sirk-view-accent", StringComparison.Ordinal),
            "The selected All or host tab must reuse the active left-menu surface and selection accent.");
        Require(selectionScript.Contains("inset -3px 0 0 #16a34a", StringComparison.Ordinal) &&
                selectionScript.Contains("inset -3px 0 0 #dc2626", StringComparison.Ordinal) &&
                selectionScript.Contains(".is-online.is-active", StringComparison.Ordinal) &&
                selectionScript.Contains(".is-offline.is-active", StringComparison.Ordinal),
            "Online and offline status accents must remain on the right edge independently of the selected state.");

        Require(headerContextScript.Contains("#sirkConnectionHeaderToggle", StringComparison.Ordinal) &&
                headerContextScript.Contains("contextmenu", StringComparison.Ordinal) &&
                headerContextScript.Contains("data-header-context-connection", StringComparison.Ordinal),
            "Right-clicking the top-bar visibility handle must open its workspace context menu with Connect or Disconnect first.");
        Require(headerContextScript.Contains("data-header-context-section", StringComparison.Ordinal) &&
                headerContextScript.Contains("Ogólne", StringComparison.Ordinal) &&
                headerContextScript.Contains("Połączenie", StringComparison.Ordinal) &&
                headerContextScript.Contains("Ustawienia", StringComparison.Ordinal),
            "The top-bar handle context menu must expose the same device sections as the host dropdown.");
        Require(headerContextScript.Contains("function connectionMode()", StringComparison.Ordinal) &&
                headerContextScript.Contains("!connectionMode() || !ws", StringComparison.Ordinal),
            "The top-bar handle context menu must be restricted to connection view.");

        var transportIndex = bundler.IndexOf("portal/standalone/scripts/central-tunnel-transport.js", StringComparison.Ordinal);
        var workspaceIndex = bundler.IndexOf("portal/standalone/scripts/device-workspace.js", StringComparison.Ordinal);
        var tabsIndex = bundler.IndexOf("portal/standalone/scripts/device-tabs.js", StringComparison.Ordinal);
        var connectionIndex = bundler.IndexOf("portal/standalone/scripts/workspace-connection.js", StringComparison.Ordinal);
        var lifecycleIndex = bundler.IndexOf("portal/standalone/scripts/device-tabs-lifecycle-v4.js", StringComparison.Ordinal);
        var selectionIndex = bundler.IndexOf("portal/standalone/scripts/device-tab-selection-state.js", StringComparison.Ordinal);
        var legacyLifecycleIndex = bundler.IndexOf("portal/standalone/scripts/device-tabs-lifecycle-v3.js", StringComparison.Ordinal);
        var headerContextIndex = bundler.IndexOf("portal/standalone/scripts/header-toggle-context-menu.js", StringComparison.Ordinal);
        var terminalIndex = bundler.IndexOf("portal/standalone/scripts/terminal-connect.js", StringComparison.Ordinal);
        Require(transportIndex >= 0 && workspaceIndex > transportIndex && tabsIndex > workspaceIndex &&
                connectionIndex > tabsIndex && lifecycleIndex > connectionIndex && selectionIndex > lifecycleIndex &&
                legacyLifecycleIndex < 0 && headerContextIndex > selectionIndex && terminalIndex > headerContextIndex,
            "Workspace prerequisites, lifecycle, and selected-tab behavior must load in a deterministic order.");
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