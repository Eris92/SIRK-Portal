namespace Sirk.Portal.ProtocolTests;

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
                viewMode.Contains("navigation.getAttribute(\"data-view\") !== \"devices\"", StringComparison.Ordinal),
            "Wide and connection modes must be scoped to the top-level Devices view.");
        Require(viewMode.Contains("function exitExpandedModes()", StringComparison.Ordinal) &&
                viewMode.Contains("localStorage.setItem(\"sirkPortal.focusMode\", \"0\")", StringComparison.Ordinal),
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
