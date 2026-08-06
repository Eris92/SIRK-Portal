namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHostTabSplitContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var tabsCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));

        Require(tabsScript.Contains("sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsScript.Contains("data-device-tab-close", StringComparison.Ordinal) &&
                tabsScript.Contains("data-device-tab-menu-toggle", StringComparison.Ordinal),
            "Host tabs must expose a split close/menu control column.");
        Require(tabsScript.Contains("data-device-tab-section", StringComparison.Ordinal) &&
                tabsScript.Contains("Ogólne", StringComparison.Ordinal) &&
                tabsScript.Contains("Połączenie", StringComparison.Ordinal) &&
                tabsScript.Contains("Polecenia", StringComparison.Ordinal),
            "The expanded host menu must expose the device workspace sections.");
        Require(tabsScript.Contains("desktopMode() ? \"desktop\" : null", StringComparison.Ordinal) &&
                tabsScript.Contains("state.pendingSection[info.key] = \"desktop\"", StringComparison.Ordinal),
            "Opening a host in wide or connection mode must default to Desktop.");
        Require(tabsScript.Contains("row.querySelector(\".sirk-device-connection.is-online\")", StringComparison.Ordinal) &&
                tabsScript.Contains("is-online", StringComparison.Ordinal),
            "Host tabs must inherit the live online state from the device list.");

        Require(tabsCss.Contains(".sirk-device-host-tab.is-online", StringComparison.Ordinal) &&
                tabsCss.Contains("border-color:#16a34a", StringComparison.Ordinal),
            "Online host tabs must keep a green outline.");
        Require(tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-connection-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}", StringComparison.Ordinal),
            "The lower split-menu control must appear in both expanded device modes.");
        Require(tabsCss.Contains("sirk-device-tab-all", StringComparison.Ordinal) ||
                tabsScript.Contains("sirk-device-tab sirk-device-tab-all", StringComparison.Ordinal),
            "All must remain a plain tab without host split controls.");

        Require(viewMode.Contains("width:44px;height:44px", StringComparison.Ordinal),
            "The view-mode and user controls must use the same 44px footprint.");
        Require(tabsScript.Contains("function syncQuickCommandsToggle()", StringComparison.Ordinal) &&
                tabsScript.Contains("toggle.classList.remove(\"is-header-mounted\")", StringComparison.Ordinal) &&
                !tabsScript.Contains("state.header.insertBefore(toggle", StringComparison.Ordinal),
            "Device tabs must not compete with the scoped Desktop presenter for Quick Commands.");
        Require(viewMode.Contains("sirk-expanded-desktop-dock", StringComparison.Ordinal) &&
                viewMode.Contains("stage.appendChild(dock)", StringComparison.Ordinal) &&
                viewMode.Contains("restoreStandardDesktop", StringComparison.Ordinal),
            "Quick Commands must be pinned inside the stage only in expanded Devices mode.");
        Require(tabsCss.Contains("padding:2px 22px!important", StringComparison.Ordinal) &&
                viewMode.Contains("padding:0!important;gap:0!important;border-radius:0!important", StringComparison.Ordinal),
            "Expanded connection mode must remove content spacing and rounded desktop framing.");
        Require(viewMode.Contains("sirk-device-focus-mode .sirk-device-workspace>.sirk-device-compact-header", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-focus-mode .sirk-device-tab-body", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-agent-desktop-stage canvas{max-width:100%!important;max-height:100%!important", StringComparison.Ordinal),
            "Wide mode must replace the inner tabs and dedicate the content area to the selected workspace, including Desktop.");
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
