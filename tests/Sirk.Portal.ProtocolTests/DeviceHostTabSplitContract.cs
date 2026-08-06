namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHostTabSplitContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var connectionScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "workspace-connection.js"));
        var bundler = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));

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
                connectionScript.Contains("border-color:#16a34a", StringComparison.Ordinal) &&
                connectionScript.Contains("border-color:#dc2626", StringComparison.Ordinal),
            "Host tabs must hide per-tab connection actions and use green online or red offline status styling.");

        Require(connectionScript.Contains("[data-agent-desktop-connect]", StringComparison.Ordinal) &&
                connectionScript.Contains("[data-agent-desktop-disconnect]", StringComparison.Ordinal) &&
                connectionScript.Contains("desktopStop(ws)", StringComparison.Ordinal),
            "The single workspace toggle must control the real Desktop stream without exposing duplicate Desktop buttons.");

        var tabsIndex = bundler.IndexOf("portal/standalone/scripts/device-tabs.js", StringComparison.Ordinal);
        var connectionIndex = bundler.IndexOf("portal/standalone/scripts/workspace-connection.js", StringComparison.Ordinal);
        Require(tabsIndex >= 0 && connectionIndex > tabsIndex,
            "The workspace connection controller must be bundled after the existing device workspace and tab controllers.");
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
