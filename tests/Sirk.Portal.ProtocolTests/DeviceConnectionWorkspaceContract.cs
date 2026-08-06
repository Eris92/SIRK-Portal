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

        Require(tabsCss.Contains("padding:0 12px!important", StringComparison.Ordinal),
            "The Devices header must keep a 12px outer inset.");
        Require(tabsCss.Contains(".sirk-device-tabs-standalone{flex:1 1 auto", StringComparison.Ordinal) &&
                tabsCss.Contains("border:0!important", StringComparison.Ordinal),
            "The top device tab strip must not render vertical separators.");

        Require(!viewMode.Contains("sirk-device-focus-mode .sirk-standalone-main>header", StringComparison.Ordinal),
            "Wide view must keep the device tabs header visible.");
        Require(!viewMode.Contains("sirk-device-connection-mode .sirk-standalone-main>header", StringComparison.Ordinal),
            "Connection view must keep the device tabs header visible.");
        Require(!viewMode.Contains("sirk-device-connection-mode .sirk-device-tabs-standalone{display:none", StringComparison.Ordinal),
            "Connection view must keep All and host tabs visible.");
        Require(viewMode.Contains(".sirk-device-workspace>.sirk-device-compact-header", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-stage canvas", StringComparison.Ordinal),
            "Connection view must dedicate the complete area below host tabs to the remote desktop.");
        Require(viewMode.Contains(".sirk-quick-commands-dock{z-index:60", StringComparison.Ordinal) &&
                commandsCss.Contains("z-index:45", StringComparison.Ordinal),
            "The pinned Quick Commands dock must remain above the connected desktop.");

        foreach (var removed in new[]
                 {
                     "sirk-agent-desktop-controls", "sirk-agent-desktop-stats",
                     "sirk-agent-desktop-admin", "sirk-agent-desktop-input",
                     "sirk-agent-desktop-clipboard", "sirk-agent-policy-action",
                     "sirk-agent-operation sirk-agent-desktop", "sirk-command-error"
                 })
            Require(!workspace.Contains(removed, StringComparison.Ordinal),
                "The screen-only desktop must not contain: " + removed);
        Require(workspace.Contains("desktopStage.appendChild(dock)", StringComparison.Ordinal) &&
                workspace.Contains("setCompactCommandsConnected(host, true)", StringComparison.Ordinal) &&
                workspace.Contains("connectDesktop();", StringComparison.Ordinal),
            "Quick Commands must stay inside the desktop stage and appear only after automatic connection.");
        Require(commandsCss.Contains(".sirk-quick-commands-dock", StringComparison.Ordinal) &&
                commandsCss.Contains("right:8px", StringComparison.Ordinal) &&
                commandsCss.Contains("width:min(560px", StringComparison.Ordinal),
            "Quick Commands must be a smaller pinned right-side desktop dock.");
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
