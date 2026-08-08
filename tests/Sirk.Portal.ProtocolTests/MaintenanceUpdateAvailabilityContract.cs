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
        var settingsUi = File.ReadAllText(Path.Combine(
            root, "public", "portal", "standalone", "scripts", "settings-native-v2.js"));
        var bundler = File.ReadAllText(Path.Combine(
            root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));

        Require(!maintenance.Contains(
            "updateAvailable = OperatingSystem.IsWindows(),",
            StringComparison.Ordinal),
            "Maintenance status must not report an update merely because Portal runs on Windows.");
        Require(maintenance.Contains("_updates.Probe()", StringComparison.Ordinal) &&
                maintenance.Contains("_updates.Probe(force: true)", StringComparison.Ordinal) &&
                maintenance.Contains("commit = update.InstalledCommit", StringComparison.Ordinal) &&
                maintenance.Contains("commit = update.RemoteCommit", StringComparison.Ordinal),
            "Maintenance status must compare installed and Central release commits and support force refresh.");
        Require(maintenance.Contains("_updates.PrepareUpdate()", StringComparison.Ordinal) &&
                maintenance.Contains("Portal is already current.", StringComparison.Ordinal) == false,
            "Maintenance update must use the Central-backed PortalUpdateClient instead of a direct release path.");

        Require(probe.Contains("release-manifest.json", StringComparison.Ordinal) &&
                probe.Contains("/api/portal/v1/update/products/sirk-portal/latest", StringComparison.Ordinal) &&
                probe.Contains("RemoteCommit", StringComparison.Ordinal) &&
                probe.Contains("InstalledCommit", StringComparison.Ordinal) &&
                probe.Contains("VerifyDescriptorSignature", StringComparison.Ordinal) &&
                probe.Contains("sirk-portal", StringComparison.Ordinal),
            "Update client must compare installed state with a signed Central Portal offer.");
        Require(probe.Contains("CacheLifetime = TimeSpan.FromMinutes(1)", StringComparison.Ordinal) &&
                probe.Contains("public PortalUpdateProbeResult Probe(bool force = false)", StringComparison.Ordinal),
            "Update probing must be cached while allowing an explicit refresh.");
        Require(probe.IndexOf("channel = ReadMaintenanceChannel();", StringComparison.Ordinal) >
                probe.IndexOf("try", probe.IndexOf("public PortalUpdateProbeResult Probe", StringComparison.Ordinal), StringComparison.Ordinal),
            "Maintenance channel read failures must be returned as a controlled probe error.");
        Require(!probe.Contains("api.github.com", StringComparison.OrdinalIgnoreCase) &&
                !probe.Contains("github.com/Eris92/SIRK-Portal", StringComparison.OrdinalIgnoreCase) &&
                !probe.Contains("portal-main-latest", StringComparison.OrdinalIgnoreCase),
            "Installed Portal update probing must not access GitHub directly.");

        Require(ui.Contains("Nie udało się sprawdzić aktualizacji:", StringComparison.Ordinal) &&
                ui.Contains("updateButton.disabled", StringComparison.Ordinal),
            "Update UI must distinguish available and check-error states.");
        Require(settingsUi.Contains(
                    "current.channel || \"preview\", \"select\", [[\"stable\", \"Stable\"], [\"preview\", \"Preview\"]]",
                    StringComparison.Ordinal) &&
                !settingsUi.Contains(
                    "current.channel || \"dev\", \"select\", [[\"stable\", \"Stable\"], [\"beta\", \"Beta\"], [\"dev\", \"Dev\"]]",
                    StringComparison.Ordinal),
            "Update channel UI must expose only the canonical stable and preview values.");
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
