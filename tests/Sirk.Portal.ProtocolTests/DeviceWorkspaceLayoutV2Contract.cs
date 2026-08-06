namespace Sirk.Portal.ProtocolTests;

internal static class DeviceWorkspaceLayoutV2Contract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var tabs = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var connection = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "workspace-connection.js"));
        var css = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-workspace.css"));

        Require(workspace.Contains("[\"general\", \"desktop\", \"terminal\", \"commands\", \"files\", \"settings\"]", StringComparison.Ordinal), "Device workspace must expose Settings.");
        Require(workspace.Contains("data-device-pane", StringComparison.Ordinal) && workspace.Contains("initializeWorkspacePanes", StringComparison.Ordinal), "Device tabs must preserve their panes.");
        Require(workspace.Contains("function renderAgentSettings", StringComparison.Ordinal) && workspace.Contains("sirk-agent-desktop-settings", StringComparison.Ordinal), "Desktop controls and statistics must be in Settings.");
        Require(!workspace.Contains("Pulpit SIRK Agent Live", StringComparison.Ordinal) && !workspace.Contains("<header class=\"sirk-device-compact-header\">", StringComparison.Ordinal), "Legacy headers must be removed.");
        Require(css.Contains("SIRK_DEVICE_WORKSPACE_LAYOUT_V2", StringComparison.Ordinal) && css.Contains("border-radius:11px 11px 0 0", StringComparison.Ordinal), "The device tab bar must own the rounded header surface.");
        Require(tabs.Contains("{ key: \"settings\", label: \"Ustawienia\" }", StringComparison.Ordinal) && tabs.Contains("{ key: \"settings\", label: \"Settings\" }", StringComparison.Ordinal), "Host menus must expose Settings.");
        Require(connection.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) && connection.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) && connection.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal), "Host tabs must use sidebar-style status accents.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj"))) return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
