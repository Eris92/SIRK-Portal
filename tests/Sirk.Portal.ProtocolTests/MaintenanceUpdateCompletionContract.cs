namespace Sirk.Portal.ProtocolTests;

internal static class MaintenanceUpdateCompletionContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var script = File.ReadAllText(Path.Combine(
            root,
            "public",
            "portal",
            "standalone",
            "scripts",
            "maintenance-update-restart-guard.js"));

        Require(script.Contains("maximumWaitMilliseconds = 5 * 60 * 1000", StringComparison.Ordinal),
            "GUI update wait must fail open after five minutes instead of blocking for 30 minutes.");
        Require(script.Contains("/admin/maintenance/status", StringComparison.Ordinal),
            "GUI update wait must poll the maintenance status endpoint.");
        Require(script.Contains("sameCommit(currentCommit, state.targetCommit)", StringComparison.Ordinal),
            "GUI update completion must be driven by the installed target commit.");
        Require(script.Contains("window.setInterval(pollCompletion, 1500)", StringComparison.Ordinal),
            "GUI update completion must poll independently of readyz downtime detection.");
        Require(script.Contains("Portal nie jest blokowany", StringComparison.Ordinal),
            "Timed-out update monitoring must release the Portal UI.");
        Require(!script.Contains("maximumWaitMilliseconds = 30 * 60 * 1000", StringComparison.Ordinal),
            "Legacy 30-minute update blocking must not return.");
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "public")) &&
                Directory.Exists(Path.Combine(directory.FullName, "src")))
                return directory.FullName;
            directory = directory.Parent;
        }
        throw new InvalidOperationException("Repository root could not be located.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
