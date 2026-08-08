#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [int]$HttpsPort = 443,
    [ValidateSet('stable','preview')][string]$Channel = 'preview'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Uruchom PowerShell jako Administrator.'
    }
}

function Ensure-SirkUpdater {
    $updaterRoot = Join-Path $env:ProgramFiles 'SIRK\Updater'
    $updaterExe = Join-Path $updaterRoot 'SirkUpdater.exe'
    $service = Get-Service -Name 'SirkUpdater' -ErrorAction SilentlyContinue
    if ($service -and (Test-Path -LiteralPath $updaterExe -PathType Leaf)) {
        if ($service.Status -ne 'Running') {
            Start-Service -Name 'SirkUpdater'
            (Get-Service -Name 'SirkUpdater').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        }
        return $updaterExe
    }

    $work = Join-Path $env:TEMP ('SIRK-Updater-Bootstrap-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $installer = Join-Path $work 'install-release-v2.ps1'
        Invoke-WebRequest -UseBasicParsing `
            -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.ps1' `
            -OutFile $installer
        if ((Get-Item -LiteralPath $installer).Length -lt 8000) {
            throw 'Pobrany instalator SIRK Updater jest niekompletny.'
        }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
        if ($LASTEXITCODE -ne 0) {
            throw "Instalator SIRK Updater zakonczyl sie kodem $LASTEXITCODE."
        }
    }
    finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $updaterExe -PathType Leaf)) {
        throw 'SIRK Updater CLI nie zostal zainstalowany.'
    }
    return $updaterExe
}

Assert-Administrator
if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) { throw 'Nieprawidlowy port HTTPS.' }
$portalExe = Join-Path $InstallRoot 'Sirk.Portal.exe'
$trustKeys = Join-Path $InstallRoot 'release-trusted-keys.json'
$appSettings = Join-Path $InstallRoot 'appsettings.Production.json'
if (-not (Test-Path -LiteralPath $portalExe -PathType Leaf)) { throw "Brak runtime Portalu: $portalExe" }
if (-not (Test-Path -LiteralPath $trustKeys -PathType Leaf)) { throw "Brak release trust keyring: $trustKeys" }
if (-not (Test-Path -LiteralPath $appSettings -PathType Leaf)) { throw "Brak host-specific appsettings: $appSettings" }

$updaterExe = Ensure-SirkUpdater
$healthUrl = if ($HttpsPort -eq 443) {
    'https://localhost/healthz'
} else {
    "https://localhost`:$HttpsPort/healthz"
}

$manifest = [ordered]@{
    schemaVersion = 1
    applicationId = 'sirk-portal'
    displayName = 'SIRK Portal'
    serviceName = 'SirkPortal'
    watchdogServiceName = $null
    installRoot = [IO.Path]::GetFullPath($InstallRoot)
    dataRoot = [IO.Path]::GetFullPath($DataRoot)
    healthUrl = $healthUrl
    channel = $Channel
    updateSource = 'sirk-central-cache'
    packageSha256Url = $null
    signatureRequired = $true
    signatureVerifierPath = [IO.Path]::GetFullPath($portalExe)
    signatureVerifierArguments = @(
        '--verify-update-payload',
        '{payload}',
        '--trusted-keys',
        [IO.Path]::GetFullPath($trustKeys)
    )
    preserveFiles = @('appsettings.Production.json')
}

$temp = Join-Path $env:TEMP ('sirk-portal-updater-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [IO.File]::WriteAllText(
        $temp,
        ($manifest | ConvertTo-Json -Depth 8),
        [Text.UTF8Encoding]::new($false))
    & $updaterExe register $temp
    if ($LASTEXITCODE -ne 0) { throw "SIRK Updater register zakonczyl sie kodem $LASTEXITCODE." }

    $registered = & $updaterExe show sirk-portal
    if ($LASTEXITCODE -ne 0 -or -not $registered) { throw 'Nie mozna odczytac zarejestrowanego manifestu Portalu.' }
    $document = ($registered | Out-String) | ConvertFrom-Json
    if ([string]$document.applicationId -ne 'sirk-portal' -or
        [string]$document.serviceName -ne 'SirkPortal' -or
        [string]$document.updateSource -ne 'sirk-central-cache') {
        throw 'Zarejestrowany manifest Portalu jest nieprawidlowy.'
    }

    Write-Host 'SIRK_PORTAL_UPDATER_REGISTRATION_OK' -ForegroundColor Green
    Write-Host ("Manifest: " + (Join-Path $env:ProgramData 'SIRK\Updater\applications\sirk-portal.json'))
    Write-Host ("Health:   " + $healthUrl)
    Write-Host ("Channel:  " + $Channel)
}
finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
