namespace Sirk.Portal.ProtocolTests;

internal static class InstallerBuildSdkCacheContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var bootstrap = File.ReadAllText(Path.Combine(root, "install.ps1"));
        var installer = File.ReadAllText(Path.Combine(root, "install-dotnet10.ps1"));
        var connected = File.ReadAllText(Path.Combine(root, "install-connected-dotnet10.ps1"));

        Require(bootstrap.Contains("[switch]$KeepBuildSdk", StringComparison.Ordinal) &&
                bootstrap.Contains("$parameters.KeepBuildSdk = $true", StringComparison.Ordinal),
            "The bootstrap installer must expose and forward KeepBuildSdk.");
        Require(connected.Contains("[switch]$KeepBuildSdk", StringComparison.Ordinal) &&
                connected.Contains("$installerArguments += '-KeepBuildSdk'", StringComparison.Ordinal),
            "The Central-connected installer must forward KeepBuildSdk.");
        Require(installer.Contains("Test-IsolatedDotNetSdk", StringComparison.Ordinal) &&
                installer.Contains("SIRK\\Build Cache\\dotnet-sdk", StringComparison.Ordinal) &&
                installer.Contains("jest już w cache. Pomijam pobieranie", StringComparison.Ordinal),
            "The canonical installer must reuse an exact-version persistent SDK cache.");
        Require(installer.Contains("Join-Path $persistentBuildSdkRoot $sdkVersion", StringComparison.Ordinal) &&
                installer.Contains("if ($KeepBuildSdk)", StringComparison.Ordinal),
            "The persistent SDK location must only be selected by the explicit test switch.");
        Require(installer.Contains("Remove-Item -LiteralPath $workRoot -Recurse -Force", StringComparison.Ordinal),
            "Temporary installer files must still be cleaned independently of the persistent SDK cache.");
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
