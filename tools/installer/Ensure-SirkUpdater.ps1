#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalServiceName = 'SirkPortal',
    [string]$PortalWatchdogServiceName = 'SirkPortalWatchdog',
    [string]$InstallPath = "$env:ProgramFiles\SIRK\Portal",
    [string]$DataPath = "$env:ProgramData\SIRK\Portal",
    [ValidateSet('dev','stable')]
    [string]$Channel = 'dev'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$updaterCli = "$env:ProgramFiles\SIRK\Updater\SirkUpdater.exe"
$updaterService = Get-Service -Name 'SirkUpdater' -ErrorAction SilentlyContinue
if (-not $updaterService -or -not (Test-Path -LiteralPath $updaterCli)) {
    Write-Host '=== Install shared SIRK Updater ==='
    $bootstrap = Join-Path $env:TEMP ('sirk-updater-release-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        Invoke-WebRequest `
            -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release.ps1?nocache=' + [guid]::NewGuid()) `
            -OutFile $bootstrap `
            -UseBasicParsing
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap -AllowSourceFallback
        if ($LASTEXITCODE -ne 0) { throw "SIRK Updater installation failed with ExitCode=$LASTEXITCODE." }
    }
    finally {
        Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue
    }
}

$updaterService = Get-Service -Name 'SirkUpdater' -ErrorAction Stop
if ($updaterService.Status -ne 'Running') {
    Start-Service -Name 'SirkUpdater'
    $updaterService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}
if (-not (Test-Path -LiteralPath $updaterCli)) { throw "SIRK Updater CLI is missing: $updaterCli" }

$portalService = Get-CimInstance Win32_Service -Filter "Name='$PortalServiceName'" -ErrorAction SilentlyContinue
if (-not $portalService) { throw "Portal service is not installed: $PortalServiceName" }
$watchdog = Get-CimInstance Win32_Service -Filter "Name='$PortalWatchdogServiceName'" -ErrorAction SilentlyContinue

$manifestPath = Join-Path $env:TEMP ('sirk-portal-updater-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [ordered]@{
        schemaVersion       = 1
        applicationId       = 'sirk-portal'
        displayName         = 'SIRK Portal'
        serviceName         = $portalService.Name
        watchdogServiceName = if ($watchdog) { $watchdog.Name } else { $null }
        installRoot         = $InstallPath
        dataRoot            = $DataPath
        healthUrl           = 'https://127.0.0.1/login'
        channel             = $Channel
        updateSource        = 'https://github.com/Eris92/SIRK-Portal'
        signatureRequired   = $false
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    & $updaterCli register $manifestPath
    if ($LASTEXITCODE -ne 0) { throw "Portal registration failed with ExitCode=$LASTEXITCODE." }
    & $updaterCli show sirk-portal | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Registered Portal manifest cannot be read back.' }
}
finally {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'SIRK_PORTAL_SHARED_UPDATER_READY' -ForegroundColor Green
