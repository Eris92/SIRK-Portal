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
            maintenance.Contains("RunLinuxMaintenanceHelper(\"update-helper\")", StringComparison.Ordinal) &&
            maintenance.Contains("RunLinuxMaintenanceHelper(\"restart-helper\")", StringComparison.Ordinal),
            "Portal maintenance must expose GUI update and restart on Windows and Linux systemd.");

        Require(
            maintenance.Contains("-TrustCertificate -NonInteractive -KeepBuildSdk", StringComparison.Ordinal) &&
            !maintenance.Contains("-RemoveData *>> $logPath", StringComparison.Ordinal) &&
            maintenance.Contains("maintenance-update.lock", StringComparison.Ordinal) &&
            maintenance.Contains("gui-update-", StringComparison.Ordinal),
            "Windows GUI updates must preserve Portal data, trust the certificate, retain the isolated SDK cache and serialize execution.");

        Require(
            linuxInstaller.Contains("systemd-run", StringComparison.Ordinal) &&
            linuxInstaller.Contains("update-runner", StringComparison.Ordinal) &&
            linuxInstaller.Contains("--update-only --non-interactive", StringComparison.Ordinal) &&
            linuxInstaller.Contains("SIRK_PORTAL_LINUX_UPDATE_OK", StringComparison.Ordinal) &&
            linuxInstaller.Contains("Type=simple", StringComparison.Ordinal),
            "Linux maintenance must detach update/restart work from the Portal cgroup and retain transactional updates.");

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
