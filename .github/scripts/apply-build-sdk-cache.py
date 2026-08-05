from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}\n--- old ---\n{old}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]
bootstrap = root / "install.ps1"
installer = root / "install-dotnet10.ps1"
connected = root / "install-connected-dotnet10.ps1"
program = root / "tests/Sirk.Portal.ProtocolTests/Program.cs"
contract = root / "tests/Sirk.Portal.ProtocolTests/InstallerBuildSdkCacheContract.cs"

replace_once(
    bootstrap,
    "    [switch]$RemoveData,\n    [switch]$SkipUpdater\n)",
    "    [switch]$RemoveData,\n    [switch]$KeepBuildSdk,\n    [switch]$SkipUpdater\n)"
)
replace_once(
    bootstrap,
    "    if ($RemoveData) { $parameters.RemoveData = $true }\n\n    Invoke-Utf8Script -Path $installerPath -Parameters $parameters",
    "    if ($RemoveData) { $parameters.RemoveData = $true }\n    if ($KeepBuildSdk) { $parameters.KeepBuildSdk = $true }\n\n    Invoke-Utf8Script -Path $installerPath -Parameters $parameters"
)

replace_once(
    installer,
    "    [switch]$NonInteractive,\n    [switch]$RemoveData\n)",
    "    [switch]$NonInteractive,\n    [switch]$RemoveData,\n    [switch]$KeepBuildSdk\n)"
)
replace_once(
    installer,
    "function Ensure-SystemDotNet10([string]$DownloadRoot) {",
    r'''function Test-IsolatedDotNetSdk {
    param(
        [Parameter(Mandatory)][string]$DotNetRoot,
        [Parameter(Mandatory)][string]$SdkVersion
    )

    $candidateExe = Join-Path $DotNetRoot 'dotnet.exe'
    $candidateSdk = Join-Path $DotNetRoot (Join-Path 'sdk' (Join-Path $SdkVersion 'dotnet.dll'))
    if (-not (Test-Path -LiteralPath $candidateExe -PathType Leaf) -or
        -not (Test-Path -LiteralPath $candidateSdk -PathType Leaf)) {
        return $false
    }

    try {
        $installedSdks = @(& $candidateExe --list-sdks 2>$null)
        if ($LASTEXITCODE -ne 0) { return $false }
        $escapedVersion = [regex]::Escape($SdkVersion)
        return [bool]($installedSdks | Where-Object { $_ -match ("^" + $escapedVersion + "\\s+\\[") })
    }
    catch {
        return $false
    }
}

function Ensure-SystemDotNet10([string]$DownloadRoot) {'''
)
replace_once(
    installer,
    "$runtimeDownloadRoot = Join-Path $workRoot 'runtime-installers'\n$dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'",
    "$runtimeDownloadRoot = Join-Path $workRoot 'runtime-installers'\n$persistentBuildSdkRoot = Join-Path $commonDataRoot 'SIRK\\Build Cache\\dotnet-sdk'\n$dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'"
)
replace_once(
    installer,
    r'''    Write-Step 'Instalacja izolowanego .NET 10 SDK wyłącznie do kompilacji'
    $sdkVersion = (Get-Content -LiteralPath $globalJsonPath -Raw | ConvertFrom-Json).sdk.version
    $dotnetInstall = Join-Path $workRoot 'dotnet-install.ps1'
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $dotnetInstall -UseBasicParsing
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dotnetInstall -Version $sdkVersion -InstallDir $dotnetRoot -NoPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dotnetExe)) {
        throw "Instalacja .NET SDK $sdkVersion nie powiodła się. ExitCode=$LASTEXITCODE"
    }''',
    r'''    Write-Step 'Izolowane .NET 10 SDK wyłącznie do kompilacji'
    $sdkVersion = [string](Get-Content -LiteralPath $globalJsonPath -Raw | ConvertFrom-Json).sdk.version
    if ([string]::IsNullOrWhiteSpace($sdkVersion)) {
        throw 'global.json nie zawiera wymaganej wersji SDK.'
    }

    if ($KeepBuildSdk) {
        $dotnetRoot = Join-Path $persistentBuildSdkRoot $sdkVersion
        $dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'
        Write-Host "Tryb testowy: zachowuję izolowane SDK w $dotnetRoot" -ForegroundColor DarkCyan
    }

    if (Test-IsolatedDotNetSdk -DotNetRoot $dotnetRoot -SdkVersion $sdkVersion) {
        Write-Host ".NET SDK $sdkVersion jest już w cache. Pomijam pobieranie." -ForegroundColor DarkGreen
    }
    else {
        if (Test-Path -LiteralPath $dotnetRoot) {
            Write-Warning "Cache SDK jest niekompletny albo ma inną wersję. Odtwarzam: $dotnetRoot"
            Remove-Item -LiteralPath $dotnetRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $dotnetRoot -Force | Out-Null

        $dotnetInstall = Join-Path $workRoot 'dotnet-install.ps1'
        Write-Host "Pobieranie izolowanego .NET SDK $sdkVersion..." -ForegroundColor DarkCyan
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $dotnetInstall -UseBasicParsing
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dotnetInstall -Version $sdkVersion -InstallDir $dotnetRoot -NoPath
        if ($LASTEXITCODE -ne 0 -or
            -not (Test-IsolatedDotNetSdk -DotNetRoot $dotnetRoot -SdkVersion $sdkVersion)) {
            throw "Instalacja .NET SDK $sdkVersion nie powiodła się. ExitCode=$LASTEXITCODE"
        }
    }'''
)
replace_once(
    installer,
    "    Write-Host \"Log instalacji: $installLog\"\n    if (-not $NonInteractive) { Start-Process \"$publicUrl/login\" }",
    "    Write-Host \"Log instalacji: $installLog\"\n    if ($KeepBuildSdk) { Write-Host \"Cache izolowanego SDK: $dotnetRoot\" -ForegroundColor DarkGreen }\n    if (-not $NonInteractive) { Start-Process \"$publicUrl/login\" }"
)

replace_once(
    connected,
    "    [switch]$RemoveData,\n    [switch]$KeepSourceConnectionFile,",
    "    [switch]$RemoveData,\n    [switch]$KeepBuildSdk,\n    [switch]$KeepSourceConnectionFile,"
)
replace_once(
    connected,
    "    if ($RemoveData) { $installerArguments += '-RemoveData' }\n\n    & powershell.exe @installerArguments",
    "    if ($RemoveData) { $installerArguments += '-RemoveData' }\n    if ($KeepBuildSdk) { $installerArguments += '-KeepBuildSdk' }\n\n    & powershell.exe @installerArguments"
)

replace_once(
    program,
    "DeviceHostTabSplitContract.Run();\n",
    "DeviceHostTabSplitContract.Run();\nInstallerBuildSdkCacheContract.Run();\n"
)

contract.write_text(r'''namespace Sirk.Portal.ProtocolTests;

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
''', encoding="utf-8")

print("Persistent isolated .NET SDK cache support applied.")
