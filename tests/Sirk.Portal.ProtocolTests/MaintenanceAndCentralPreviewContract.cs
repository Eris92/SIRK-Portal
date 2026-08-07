using System.Runtime.CompilerServices;

namespace Sirk.Portal.ProtocolTests;

internal static class MaintenanceAndCentralPreviewContract
{
    [ModuleInitializer]
    internal static void Run()
    {
        var root = FindRepositoryRoot();
        var maintenance = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Maintenance",
            "PortalMaintenanceEndpoints.cs"));
        var updateClient = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Maintenance",
            "PortalUpdateProbe.cs"));
        var verifier = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Maintenance",
            "PortalUpdatePackageVerifier.cs"));
        var settings = File.ReadAllText(Path.Combine(
            root,
            "public",
            "portal",
            "standalone",
            "scripts",
            "settings-native-v2.js"));
        var tunnel = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Central",
            "CentralTunnelService.cs"));
        var program = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Program.cs"));
        var linuxInstaller = File.ReadAllText(Path.Combine(root, "install-linux.sh"));

        Require(
            maintenance.Contains("group.MapPost(\"/update\", UpdateAsync);", StringComparison.Ordinal) &&
            maintenance.Contains("public object ScheduleUpdate()", StringComparison.Ordinal) &&
            maintenance.Contains("SupportsServiceMaintenance", StringComparison.Ordinal) &&
            maintenance.Contains("OperatingSystem.IsWindows() || OperatingSystem.IsLinux()", StringComparison.Ordinal) &&
            maintenance.Contains("_updates.PrepareUpdate()", StringComparison.Ordinal) &&
            maintenance.Contains("RunLinuxMaintenanceHelper(\n                    \"update-helper\",", StringComparison.Ordinal) &&
            maintenance.Contains("SirkUpdater.exe", StringComparison.Ordinal) &&
            maintenance.Contains("RunLinuxMaintenanceHelper(\"restart-helper\", [])", StringComparison.Ordinal),
            "Portal maintenance must use one Central-prepared package and the shared SIRK Updater on Windows/Linux.");

        Require(
            !maintenance.Contains("raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase) &&
            !maintenance.Contains("github.com/Eris92", StringComparison.OrdinalIgnoreCase) &&
            !updateClient.Contains("raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase) &&
            !updateClient.Contains("github.com/Eris92", StringComparison.OrdinalIgnoreCase) &&
            updateClient.Contains("/api/portal/v1/update/products/sirk-portal/latest", StringComparison.Ordinal) &&
            updateClient.Contains("PortalRequestSigner.Create", StringComparison.Ordinal) &&
            updateClient.Contains("VerifyDescriptorSignature", StringComparison.Ordinal) &&
            verifier.Contains("--verify-update-payload", StringComparison.Ordinal) &&
            verifier.Contains("ES256", StringComparison.Ordinal),
            "Installed Portal runtime updates must be Central-only and locally verify signed release metadata/payloads.");

        Require(
            maintenance.Contains("maintenance-update.lock", StringComparison.Ordinal) &&
            !maintenance.Contains("Invoke-WebRequest", StringComparison.Ordinal) &&
            !maintenance.Contains("install.ps1", StringComparison.OrdinalIgnoreCase),
            "Portal GUI update must serialize execution without downloading installers at runtime.");

        Require(
            linuxInstaller.Contains("systemd-run", StringComparison.Ordinal) &&
            linuxInstaller.Contains("update-helper", StringComparison.Ordinal) &&
            linuxInstaller.Contains("sirk-central-cache", StringComparison.Ordinal) &&
            linuxInstaller.Contains("\"signatureRequired\": true", StringComparison.Ordinal) &&
            linuxInstaller.Contains("--verify-update-payload", StringComparison.Ordinal) &&
            !linuxInstaller.Contains("--update-only", StringComparison.Ordinal),
            "Linux installed update path must detach privileged work, require signed payloads and consume only Central-cached packages.");

        Require(
            settings.Contains("maintenance(\"update\", {}, true)", StringComparison.Ordinal),
            "Portal Settings must invoke the maintenance update endpoint.");

        Require(
            tunnel.Contains("ConnectCallback = ConnectIpv4LoopbackAsync", StringComparison.Ordinal) &&
            tunnel.Contains("AddressFamily.InterNetwork", StringComparison.Ordinal) &&
            tunnel.Contains("IPAddress.Loopback", StringComparison.Ordinal) &&
            tunnel.Contains("CreateLoopbackHandler(useCookies: true", StringComparison.Ordinal),
            "Delegated Central requests must retain HTTPS and CSRF cookies while forcing the localhost socket to IPv4.");

        Require(
            !program.Contains("options.Listen(IPAddress.Loopback, 8080)", StringComparison.Ordinal) &&
            !tunnel.Contains("new Uri(\"http://127.0.0.1:8080/\"", StringComparison.Ordinal),
            "Central preview repair must not expose or depend on an additional loopback HTTP listener.");
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
