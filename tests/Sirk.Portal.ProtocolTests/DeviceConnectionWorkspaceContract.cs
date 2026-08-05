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
        Require(viewMode.Contains(".sirk-quick-commands-panel{z-index:59", StringComparison.Ordinal),
            "Quick Commands must remain above the connected desktop.");

        Require(workspace.Contains("(desktopStage || operation).appendChild(toggle)", StringComparison.Ordinal),
            "The Quick Commands toggle must be mounted on the remote desktop stage.");
        Require(!workspace.Contains("operation.appendChild(toggle);", StringComparison.Ordinal),
            "The Quick Commands toggle must not remain outside the visible connected stage.");
        Require(commandsCss.Contains("z-index:40", StringComparison.Ordinal) &&
                commandsCss.Contains("z-index:39", StringComparison.Ordinal),
            "Quick Commands controls must have a stable overlay stacking order.");
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
