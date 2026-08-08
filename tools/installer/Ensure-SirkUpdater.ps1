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
$PortalReleaseKeyId = 'sirk-release-2026-08-v1'
$PortalReleasePublicKeySha256 = '3dad6ad58afe0e56c3f6f3a4b55a922017450cfb7e12ab6718bd86a237e48562'

function Get-PemSha256 {
    param([Parameter(Mandatory)][string]$Pem)
    $normalized = $Pem.Replace("`r`n","`n").Trim() + "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized)) }
    finally { $sha.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}

$systemDotNet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $systemDotNet -PathType Leaf)) {
    throw 'System Microsoft .NET 10 Runtime is missing from C:\Program Files\dotnet.'
}
$runtimeList = @(& $systemDotNet --list-runtimes)
if ($LASTEXITCODE -ne 0 -or -not ($runtimeList | Where-Object { $_ -match '^Microsoft\.NETCore\.App 10\.0\.' })) {
    throw 'SIRK Updater requires system Microsoft.NETCore.App 10.0.'
}
$env:PATH = (Split-Path -Parent $systemDotNet) + ';' + $env:PATH

$updaterCli = "$env:ProgramFiles\SIRK\Updater\SirkUpdater.exe"
$updaterService = Get-Service -Name SirkUpdater -ErrorAction SilentlyContinue
if (-not $updaterService -or -not (Test-Path -LiteralPath $updaterCli -PathType Leaf)) {
    Write-Host '=== Installing SIRK Updater bootstrap ===' -ForegroundColor Cyan
    $bootstrap = Join-Path $env:TEMP ('sirk-updater-v2-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        # Public GitHub access is allowed here only because this is bootstrap.
        Invoke-WebRequest -UseBasicParsing `
            -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.ps1?nocache=' + [guid]::NewGuid()) `
            -OutFile $bootstrap
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap
        if ($LASTEXITCODE -ne 0) {
            throw "SIRK Updater bootstrap failed. ExitCode=$LASTEXITCODE"
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
if (-not (Test-Path -LiteralPath $updaterCli -PathType Leaf)) { throw "SIRK Updater CLI is missing: $updaterCli" }

$portalService = Get-Service -Name $PortalServiceName -ErrorAction SilentlyContinue
if (-not $portalService) { throw "Portal service is missing: $PortalServiceName" }
if ($portalService.Status -ne 'Running') {
    Start-Service -Name $PortalServiceName
    $portalService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

$portalVerifier = Join-Path $InstallPath 'Sirk.Portal.exe'
if (-not (Test-Path -LiteralPath $portalVerifier -PathType Leaf)) {
    throw "Portal verifier is missing: $portalVerifier"
}
$trustedKeys = Join-Path $InstallPath 'release-trusted-keys.json'
if (-not (Test-Path -LiteralPath $trustedKeys -PathType Leaf)) {
    Write-Host '=== Installing pinned public Portal release trust root (bootstrap) ===' -ForegroundColor Cyan
    $temporaryKeyring = Join-Path $env:TEMP ('sirk-portal-release-keys-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'SIRK-Portal-Bootstrap' }
        $response = Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri 'https://api.github.com/repos/Eris92/SIRK-Portal/releases?per_page=30'
        $parsed = ConvertFrom-Json -InputObject $response.Content
        $releases = @()
        if ($parsed -is [System.Array]) { foreach ($item in $parsed) { $releases += $item } }
        else { $releases += $parsed }
        $candidates = @()
        foreach ($release in $releases) {
            $tag = [string]$release.tag_name
            if ($release.draft -or $tag -notmatch '^v0\.1\.1\.[0-9]+$') { continue }
            $assets = @($release.assets | Where-Object { [string]$_.name -eq 'release-trusted-keys.json' })
            if ($assets.Count -ne 1) { continue }
            $candidates += [pscustomobject]@{ Release = $release; Version = [version]$tag.Substring(1); Asset = $assets[0] }
        }
        $candidate = @($candidates | Sort-Object Version -Descending | Select-Object -First 1)
        if ($candidate.Count -ne 1) { throw 'No immutable signed Portal release with a public trust root was found.' }
        Invoke-WebRequest -UseBasicParsing -Uri ([string]$candidate[0].Asset.browser_download_url) -OutFile $temporaryKeyring
        $keyring = Get-Content -LiteralPath $temporaryKeyring -Raw -Encoding UTF8 | ConvertFrom-Json
        $keys = @($keyring.keys)
        if ($keys.Count -ne 1 -or [string]$keys[0].keyId -cne $PortalReleaseKeyId -or [string]$keys[0].publicKeyPem -notmatch 'BEGIN PUBLIC KEY') {
            throw 'Portal release trust root metadata is invalid.'
        }
        if ((Get-PemSha256 -Pem ([string]$keys[0].publicKeyPem)) -cne $PortalReleasePublicKeySha256) {
            throw 'Portal release trust root fingerprint is not pinned.'
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
        signatureVerifierArguments = @('--verify-update-payload','{payload}','--trusted-keys',$trustedKeys)
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    & $updaterCli register $manifestPath
    if ($LASTEXITCODE -ne 0) { throw "Portal registration in SIRK Updater failed. ExitCode=$LASTEXITCODE" }
    & $updaterCli show sirk-portal | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Registered Portal Updater manifest could not be read.' }
}
finally {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'SIRK_PORTAL_SHARED_UPDATER_READY' -ForegroundColor Green
