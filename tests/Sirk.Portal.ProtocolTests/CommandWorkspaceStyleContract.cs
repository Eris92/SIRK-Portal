namespace Sirk.Portal.ProtocolTests;

internal static class CommandWorkspaceStyleContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));
        var deviceCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-workspace.css"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var index = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "index.html"));

        foreach (var marker in new[]
                 {
                     ".sirk-device-commands-host", ".sirk-quick-commands-panel",
                     ".sirk-quick-command-browser", ".sirk-command-toolbar",
                     "minmax(165px,var(--sirk-command-primary))",
                     "minmax(285px,var(--sirk-command-secondary))",
                     "minmax(240px,1fr)", "is-details-collapsed"
                 })
            Require(commandsCss.Contains(marker, StringComparison.Ordinal),
                "Canonical command workspace CSS marker is missing: " + marker);

        Require(!deviceCss.Contains(".sirk-quick-command", StringComparison.Ordinal) &&
                !deviceCss.Contains(".sirk-quick-commands", StringComparison.Ordinal),
            "Quick Commands must not retain a second style implementation in device-workspace.css.");
        Require(!commandsCss.Contains("sirk-command-error", StringComparison.Ordinal) &&
                commandsCss.Contains(".sirk-command-message.is-error", StringComparison.Ordinal),
            "Quick Commands errors must use the compact message state instead of sirk-command-error.");

        foreach (var marker in new[]
                 {
                     "sirkPortal.quickCommands.categoriesCollapsed",
                     "sirkPortal.quickCommands.detailsCollapsed",
                     "sirkPlatform.commands.preferences",
                     "data-quick-command-collapse", "data-quick-command-favorites",
                     "data-quick-command-details", "data-quick-command-refresh",
                     "sirk-command-layout", "loadCompactCommands(true)"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Quick Commands shared configuration marker is missing: " + marker);

        Require(viewMode.Contains("sirk-expanded-desktop-dock", StringComparison.Ordinal) &&
                viewMode.Contains("width:min(560px", StringComparison.Ordinal) &&
                viewMode.Contains("restoreStandardDesktop", StringComparison.Ordinal),
            "Wide Devices mode must create its compact Quick dock without changing normal Desktop CSS.");

        var moduleShell = index.IndexOf("portal-module-shell.css", StringComparison.Ordinal);
        var commands = index.IndexOf("shared-ui/commands.css", StringComparison.Ordinal);
        Require(moduleShell >= 0 && commands > moduleShell,
            "Canonical commands.css must load last, after the general module shell.");
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
