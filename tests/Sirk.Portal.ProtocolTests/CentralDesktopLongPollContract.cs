using System.Runtime.CompilerServices;

namespace Sirk.Portal.ProtocolTests;

internal static class CentralDesktopLongPollContract
{
    [ModuleInitializer]
    internal static void Run()
    {
        var root = FindRepositoryRoot();
        var guardPath = Path.Combine(
            root,
            "public",
            "portal",
            "standalone",
            "scripts",
            "central-desktop-longpoll.js");
        var bundlerPath = Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Ui",
            "PortalAssetBundler.cs");

        var guard = File.ReadAllText(guardPath);
        var bundler = File.ReadAllText(bundlerPath);

        Require(
            guard.Contains("maximumWaitMilliseconds = 15000", StringComparison.Ordinal) &&
            guard.Contains("/api\\/v1\\/desktop\\/frame", StringComparison.Ordinal) &&
            guard.Contains("response.status === 504", StringComparison.Ordinal) &&
            guard.Contains("status: 204", StringComparison.Ordinal) &&
            guard.Contains("gatewayRetryMilliseconds", StringComparison.Ordinal),
            "Central desktop frame polling must stay below the Central relay timeout and retry transient gateway failures with backoff.");

        Require(
            bundler.Contains(
                "portal/standalone/scripts/central-tunnel-transport.js\",\n                \"portal/standalone/scripts/central-desktop-longpoll.js\",\n                \"portal/standalone/scripts/device-workspace.js",
                StringComparison.Ordinal),
            "The Central desktop long-poll guard must load before the device workspace starts frame polling.");
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
