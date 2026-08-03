#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [int]$HttpsPort = 443,
    [string]$BootstrapUserName = 'admin',
    [string]$PortalFqdn = '',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$NonInteractive,
    [switch]$RemoveData,
    [switch]$SkipUpdater
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$workRoot = Join-Path $env:TEMP ('SIRK-Portal-Bootstrap-' + [guid]::NewGuid().ToString('N'))
$sourceZip = Join-Path $workRoot 'source.zip'
$extractRoot = Join-Path $workRoot 'source'

function Invoke-Utf8Script {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$Parameters
    )

    $source = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput(
        $source,
        [ref]$tokens,
        [ref]$errors) | Out-Null
    if ($errors.Count) {
        throw ('Błąd składni skryptu {0}: {1}' -f $Path, (($errors | ForEach-Object Message) -join '; '))
    }
    $script = [scriptblock]::Create($source)
    & $script @Parameters
}

function Enable-FirewallCompatibility {
    param([Parameter(Mandatory)][string]$InstallerPath)

    $source = Get-Content -LiteralPath $InstallerPath -Raw -Encoding UTF8
    $pattern = "(?ms)^    \`$firewallName = 'SIRK Portal HTTPS'\r?\n    Remove-NetFirewallRule[^\r\n]*\r?\n    New-NetFirewallRule[^\r\n]*\r?\n"
    $replacement = @'
    $firewallName = 'SIRK Portal HTTPS'
    $firewallConfigured = $false
    try {
        if (-not (Get-Command Remove-NetFirewallRule -ErrorAction SilentlyContinue) -or
            -not (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) {
            throw 'Cmdlety Windows Firewall są niedostępne.'
        }
        Remove-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpsPort -Profile Domain,Private -ErrorAction Stop | Out-Null
        $firewallConfigured = $true
    }
    catch {
        Write-Warning ('Nie można skonfigurować zapory przez NetSecurity: {0}. Próba netsh.exe.' -f $_.Exception.Message)
    }
    if (-not $firewallConfigured) {
        & netsh.exe advfirewall firewall delete rule name="$firewallName" | Out-Null
        & netsh.exe advfirewall firewall add rule name="$firewallName" dir=in action=allow protocol=TCP localport=$HttpsPort profile=domain,private enable=yes | Out-Null
        if ($LASTEXITCODE -eq 0) { $firewallConfigured = $true }
    }
    if (-not $firewallConfigured) {
        Write-Warning "Nie udało się dodać reguły zapory dla TCP/$HttpsPort. Portal będzie działał lokalnie; regułę można dodać później ręcznie."
    }
'@

    $patched = [regex]::Replace($source, $pattern, ($replacement + [Environment]::NewLine), 1)
    if ($patched -eq $source) {
        throw 'Nie znaleziono oczekiwanego bloku konfiguracji zapory w instalatorze.'
    }
    Set-Content -LiteralPath $InstallerPath -Value $patched -Encoding UTF8
}

New-Item -ItemType Directory -Path $workRoot,$extractRoot -Force | Out-Null
try {
    Write-Host "=== SIRK Portal .NET 10 clean installation ===" -ForegroundColor Cyan
    Write-Host "Źródło: Eris92/SIRK-Portal@$Branch" -ForegroundColor DarkCyan

    $encodedBranch = [Uri]::EscapeDataString($Branch)
    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/$encodedBranch" `
        -OutFile $sourceZip
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'Pobrane archiwum repozytorium jest nieprawidłowe.' }

    $installerPath = Join-Path $sourceRoot.FullName 'install-dotnet10.ps1'
    if (-not (Test-Path -LiteralPath $installerPath)) {
        throw "Brak natywnego instalatora .NET 10: $installerPath"
    }
    Enable-FirewallCompatibility -InstallerPath $installerPath

    $parameters = @{
        Branch = $Branch
        InstallRoot = $InstallRoot
        DataRoot = $DataRoot
        HttpsPort = $HttpsPort
        BootstrapUserName = $BootstrapUserName
        PortalFqdn = $PortalFqdn
    }
    if ($TrustCertificate) { $parameters.TrustCertificate = $true }
    if ($DoNotTrustCertificate) { $parameters.DoNotTrustCertificate = $true }
    if ($NonInteractive) { $parameters.NonInteractive = $true }
    if ($RemoveData) { $parameters.RemoveData = $true }

    Invoke-Utf8Script -Path $installerPath -Parameters $parameters

    if (-not $SkipUpdater) {
        $updaterInstaller = Join-Path $sourceRoot.FullName 'tools\installer\Ensure-SirkUpdater.ps1'
        if (-not (Test-Path -LiteralPath $updaterInstaller)) {
            throw "Brak integracji SIRK Updater: $updaterInstaller"
        }
        Invoke-Utf8Script -Path $updaterInstaller -Parameters @{
            PortalServiceName = 'SirkPortal'
            InstallPath = $InstallRoot
            DataPath = $DataRoot
            HealthUrl = "https://localhost:$HttpsPort/readyz"
            Channel = 'dev'
        }
        $updater = Get-Service -Name SirkUpdater -ErrorAction Stop
        if ($updater.Status -ne 'Running') { throw 'SIRK Updater nie działa po instalacji.' }
    }

    $portal = Get-Service -Name SirkPortal -ErrorAction Stop
    if ($portal.Status -ne 'Running' -or $portal.StartType -ne 'Automatic') {
        throw "Nieprawidłowy stan SirkPortal: $($portal.Status) / $($portal.StartType)"
    }

    Write-Host 'SIRK_PORTAL_DOTNET10_INSTALL_OK' -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
