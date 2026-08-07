using System.Runtime.CompilerServices;

namespace Sirk.Portal.ProtocolTests;

internal static class MaintenanceUpdateAvailabilityContract
{
    [ModuleInitializer]
    internal static void Run()
    {
        var root = FindRepositoryRoot();
        var maintenance = File.ReadAllText(Path.Combine(
            root, "src", "Sirk.Portal", "Maintenance", "PortalMaintenanceEndpoints.cs"));
        var probe = File.ReadAllText(Path.Combine(
            root, "src", "Sirk.Portal", "Maintenance", "PortalUpdateProbe.cs"));
        var ui = File.ReadAllText(Path.Combine(
            root, "public", "portal", "standalone", "scripts", "update-availability-ui.js"));
        var bundler = File.ReadAllText(Path.Combine(
            root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));

        Require(!maintenance.Contains(
            "updateAvailable = OperatingSystem.IsWindows(),",
            StringComparison.Ordinal),
            "Maintenance status must not report an update merely because Portal runs on Windows.");
        Require(maintenance.Contains("PortalUpdateProbe.Probe()", StringComparison.Ordinal) &&
                maintenance.Contains("PortalUpdateProbe.Probe(force: true)", StringComparison.Ordinal) &&
                maintenance.Contains("commit = update.InstalledCommit", StringComparison.Ordinal) &&
                maintenance.Contains("commit = update.RemoteCommit", StringComparison.Ordinal),
            "Maintenance status must compare installed and remote release commits and support force refresh.");
        Require(maintenance.Contains(
            "Portal jest już aktualny dla main/latest.",
            StringComparison.Ordinal),
            "Direct update calls must be rejected when the installed release is already current.");

        Require(probe.Contains("release-manifest.json", StringComparison.Ordinal) &&
                probe.Contains("portal-update.json", StringComparison.Ordinal) &&
                probe.Contains("remoteCommit", StringComparison.Ordinal) &&
                probe.Contains("installedCommit", StringComparison.Ordinal) &&
                probe.Contains("StringComparison.OrdinalIgnoreCase", StringComparison.Ordinal),
            "Update probe must compare the installed release manifest commit with verified release metadata.");
        Require(probe.Contains("CacheLifetime = TimeSpan.FromMinutes(1)", StringComparison.Ordinal) &&
                probe.Contains("public static PortalUpdateProbeResult Probe(bool force = false)", StringComparison.Ordinal),
            "Update probing must be cached while allowing an explicit refresh.");

        Require(ui.Contains("Portal jest aktualny dla main/latest.", StringComparison.Ordinal) &&
                ui.Contains("Nie udało się sprawdzić aktualizacji:", StringComparison.Ordinal) &&
                ui.Contains("updateButton.disabled", StringComparison.Ordinal),
            "Update UI must distinguish current, available and check-error states.");
        Require(bundler.Contains(
            "portal/standalone/scripts/update-availability-ui.js",
            StringComparison.Ordinal),
            "Update availability UI patch must be part of the canonical settings bundle.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(
                    current.FullName,
                    "src",
                    "Sirk.Portal",
                    "Sirk.Portal.csproj")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
