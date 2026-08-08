#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalServiceName = 'SirkPortal',
    [string]$InstallPath = "$env:ProgramFiles\SIRK\Portal",
    [string]$DataPath = "$env:ProgramData\SIRK\Portal",
    [string]$HealthUrl = 'https://localhost/readyz',
    [ValidateSet('preview','stable')]
    [string]$Channel = 'preview'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$systemDotNet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $systemDotNet -PathType Leaf)) {
    throw 'Brak systemowego Microsoft .NET 10 Runtime w C:\Program Files\dotnet.'
}
$runtimeList = @(& $systemDotNet --list-runtimes)
if ($LASTEXITCODE -ne 0 -or
    -not ($runtimeList | Where-Object { $_ -match '^Microsoft\.NETCore\.App 10\.0\.' })) {
    throw 'SIRK Updater wymaga systemowego Microsoft.NETCore.App 10.0.'
}
$env:PATH = (Split-Path -Parent $systemDotNet) + ';' + $env:PATH

$updaterCli = "$env:ProgramFiles\SIRK\Updater\SirkUpdater.exe"
$updaterService = Get-Service -Name SirkUpdater -ErrorAction SilentlyContinue
if (-not $updaterService -or -not (Test-Path -LiteralPath $updaterCli -PathType Leaf)) {
    Write-Host '=== Instalacja SIRK Updater bootstrap ===' -ForegroundColor Cyan
    $bootstrap = Join-Path $env:TEMP ('sirk-updater-v2-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        # Public GitHub access is allowed here only because this is bootstrap.
        Invoke-WebRequest `
            -UseBasicParsing `
            -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.ps1?nocache=' + [guid]::NewGuid()) `
            -OutFile $bootstrap
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap
        if ($LASTEXITCODE -ne 0) {
            throw "Instalacja SIRK Updater nie powiodła się. ExitCode=$LASTEXITCODE"
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
if (-not (Test-Path -LiteralPath $updaterCli -PathType Leaf)) { throw "Brak CLI Updatera: $updaterCli" }

$portalService = Get-Service -Name $PortalServiceName -ErrorAction SilentlyContinue
if (-not $portalService) { throw "Usługa Portalu nie istnieje: $PortalServiceName" }
if ($portalService.Status -ne 'Running') {
    Start-Service -Name $PortalServiceName
    $portalService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

$portalVerifier = Join-Path $InstallPath 'Sirk.Portal.exe'
if (-not (Test-Path -LiteralPath $portalVerifier -PathType Leaf)) {
    throw "Brak Portal verifiera: $portalVerifier"
}
$trustedKeys = Join-Path $InstallPath 'release-trusted-keys.json'
if (-not (Test-Path -LiteralPath $trustedKeys -PathType Leaf)) {
    Write-Host '=== Instalacja publicznego release trust root (bootstrap) ===' -ForegroundColor Cyan
    $temporaryKeyring = Join-Path $env:TEMP ('sirk-portal-release-keys-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $releases = @(Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/Eris92/SIRK-Portal/releases?per_page=30')
        $candidate = @($releases | Where-Object {
            -not $_.draft -and
            ([string]$_.tag_name -match '^v0\.1\.1\.[0-9]+$') -and
            @($_.assets | Where-Object { $_.name -eq 'release-trusted-keys.json' }).Count -eq 1
        } | Sort-Object { [version](([string]$_.tag_name).Substring(1)) } -Descending | Select-Object -First 1)
        if ($candidate.Count -ne 1) {
            throw 'Nie znaleziono immutable signed Portal release z publicznym trust root.'
        }
        $asset = @($candidate[0].assets | Where-Object { $_.name -eq 'release-trusted-keys.json' } | Select-Object -First 1)
        Invoke-WebRequest -UseBasicParsing -Uri ([string]$asset.browser_download_url) -OutFile $temporaryKeyring
        $keyring = Get-Content -LiteralPath $temporaryKeyring -Raw -Encoding UTF8 | ConvertFrom-Json
        $keys = @($keyring.keys)
        if ($keys.Count -lt 1 -or $keys.Count -gt 32) {
            throw 'Publiczny Portal release trust root jest nieprawidłowy.'
        }
        foreach ($key in $keys) {
            if ([string]::IsNullOrWhiteSpace([string]$key.keyId) -or
                [string]$key.publicKeyPem -notmatch 'BEGIN PUBLIC KEY') {
                throw 'Publiczny Portal release trust key jest nieprawidłowy.'
            }
        }
        Copy-Item -LiteralPath $temporaryKeyring -Destination $trustedKeys -Force
    }
    finally {
        Remove-Item -LiteralPath $temporaryKeyring -Force -ErrorAction SilentlyContinue
    }
}

$manifestPath = Join-Path $env:TEMP ('sirk-portal-updater-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    [ordered]@{
        schemaVersion = 1
        applicationId = 'sirk-portal'
        displayName = 'SIRK Portal'
        serviceName = $portalService.Name
        watchdogServiceName = $null
        installRoot = $InstallPath
        dataRoot = $DataPath
        healthUrl = $HealthUrl
        channel = $Channel
        updateSource = 'sirk-central-cache'
        packageSha256Url = $null
        signatureRequired = $true
        signatureVerifierPath = $portalVerifier
        signatureVerifierArguments = @(
            '--verify-update-payload',
            '{payload}',
            '--trusted-keys',
            $trustedKeys
        )
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
