namespace Sirk.Portal.ProtocolTests;

internal static class InstallerEventLogSourceContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var installer = File.ReadAllText(Path.Combine(root, "install-dotnet10.ps1"));

        Require(installer.Contains("function Ensure-PortalEventLogSource", StringComparison.Ordinal) &&
                installer.Contains("[System.Diagnostics.EventLog]::CreateEventSource($SourceName, 'Application')", StringComparison.Ordinal),
            "The Windows installer must explicitly register the Portal Event Log source.");

        var registration = installer.IndexOf("Ensure-PortalEventLogSource -SourceName 'Sirk.Portal'", StringComparison.Ordinal);
        var serviceCreation = installer.IndexOf("New-Service -Name $serviceName", StringComparison.Ordinal);
        var serviceStart = installer.IndexOf("Start-Service $serviceName", StringComparison.Ordinal);
        Require(registration >= 0 && serviceCreation > registration && serviceStart > serviceCreation,
            "The Event Log source must be registered before the Portal service is created and started.");

        Require(installer.Contains("LogNameFromSourceName($SourceName, '.')", StringComparison.Ordinal) &&
                installer.Contains("zamiast Application", StringComparison.Ordinal),
            "An existing Event Log source assigned to a different log must fail closed.");
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
