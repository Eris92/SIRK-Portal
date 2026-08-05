from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    encoding = "utf-8-sig" if path.suffix.lower() == ".ps1" else "utf-8"
    text = path.read_text(encoding=encoding)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}")
    path.write_text(text.replace(old, new, 1), encoding=encoding)


root = Path(__file__).resolve().parents[2]
installer = root / "install-dotnet10.ps1"
program = root / "tests/Sirk.Portal.ProtocolTests/Program.cs"
contract = root / "tests/Sirk.Portal.ProtocolTests/InstallerEventLogSourceContract.cs"

replace_once(
    installer,
    "function Test-IsolatedDotNetSdk {",
    r'''function Ensure-PortalEventLogSource {
    param([string]$SourceName = 'Sirk.Portal')

    try {
        if ([System.Diagnostics.EventLog]::SourceExists($SourceName)) {
            $registeredLog = [System.Diagnostics.EventLog]::LogNameFromSourceName($SourceName, '.')
            if (-not [string]::Equals($registeredLog, 'Application', [StringComparison]::OrdinalIgnoreCase)) {
                throw "Źródło zdarzeń $SourceName jest przypisane do dziennika $registeredLog zamiast Application."
            }
            Write-Host "Źródło Windows Event Log $SourceName jest już zarejestrowane." -ForegroundColor DarkGreen
            return
        }

        [System.Diagnostics.EventLog]::CreateEventSource($SourceName, 'Application')
        if (-not [System.Diagnostics.EventLog]::SourceExists($SourceName)) {
            throw "Źródło zdarzeń $SourceName nie zostało utworzone."
        }
        Write-Host "Zarejestrowano źródło Windows Event Log: $SourceName" -ForegroundColor DarkGreen
    }
    catch {
        throw "Nie można przygotować źródła Windows Event Log $SourceName. $($_.Exception.Message)"
    }
}

function Test-IsolatedDotNetSdk {'''
)

replace_once(
    installer,
    "    Write-Step 'Rejestracja usługi Windows'\n    $installedExe = Join-Path $InstallRoot 'Sirk.Portal.exe'",
    "    Write-Step 'Rejestracja usługi Windows'\n    Ensure-PortalEventLogSource -SourceName 'Sirk.Portal'\n    $installedExe = Join-Path $InstallRoot 'Sirk.Portal.exe'"
)

replace_once(
    program,
    "InstallerBuildSdkCacheContract.Run();\n",
    "InstallerBuildSdkCacheContract.Run();\nInstallerEventLogSourceContract.Run();\n"
)

contract.write_text(r'''namespace Sirk.Portal.ProtocolTests;

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
''', encoding="utf-8")

print("Portal Event Log source registration applied.")
