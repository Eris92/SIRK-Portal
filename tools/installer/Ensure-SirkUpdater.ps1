#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalServiceName = 'SirkPortal',
    [string]$InstallPath = "$env:ProgramFiles\SIRK\Portal",
    [string]$DataPath = "$env:ProgramData\SIRK\Portal",
    [string]$HealthUrl = 'https://localhost/readyz',
    [ValidateSet('dev','stable')]
    [string]$Channel = 'dev'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$updaterCli = "$env:ProgramFiles\SIRK\Updater\SirkUpdater.exe"
$updaterService = Get-Service -Name SirkUpdater -ErrorAction SilentlyContinue
if (-not $updaterService -or -not (Test-Path -LiteralPath $updaterCli)) {
    Write-Host '=== Instalacja SIRK Updater v2 ===' -ForegroundColor Cyan
    $bootstrap = Join-Path $env:TEMP ('sirk-updater-v2-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        Invoke-WebRequest `
            -UseBasicParsing `
            -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.ps1?nocache=' + [guid]::NewGuid()) `
            -OutFile $bootstrap
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap
        if ($LASTEXITCODE -ne 0) {
            throw "Instalacja SIRK Updater v2 nie powiodła się. ExitCode=$LASTEXITCODE"
        }
    }
    finally {
        Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue
    }
}

$updaterService = Get-Service -Name SirkUpdater -ErrorAction Stop
if ($updaterService.Status -ne 'Running') {
    Start-Service -Name SirkUpdater
    $updaterService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}
if (-not (Test-Path -LiteralPath $updaterCli)) { throw "Brak CLI Updatera: $updaterCli" }

$portalService = Get-CimInstance Win32_Service -Filter "Name='$PortalServiceName'" -ErrorAction SilentlyContinue
if (-not $portalService) { throw "Usługa Portalu nie istnieje: $PortalServiceName" }

$manifestPath = Join-Path $env:TEMP ('sirk-portal-updater-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [ordered]@{
        schemaVersion = 2
        applicationId = 'sirk-portal'
        displayName = 'SIRK Portal'
        serviceName = $portalService.Name
        watchdogServiceName = $null
        installRoot = $InstallPath
        dataRoot = $DataPath
        healthUrl = $HealthUrl
        channel = $Channel
        updateSource = 'https://github.com/Eris92/SIRK-Portal'
        runtime = 'dotnet10'
        signatureRequired = $false
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    & $updaterCli register $manifestPath
    if ($LASTEXITCODE -ne 0) { throw "Rejestracja Portalu w Updaterze nie powiodła się. ExitCode=$LASTEXITCODE" }
    & $updaterCli show sirk-portal | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Nie można odczytać manifestu Portalu z Updatera.' }
}
finally {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'SIRK_PORTAL_SHARED_UPDATER_READY' -ForegroundColor Green
