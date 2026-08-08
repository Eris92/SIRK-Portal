#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidateSet('main')]
    [string]$Branch = 'main',
    [ValidateSet('preview','stable')]
    [string]$Channel = 'preview',
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [int]$HttpsPort = 443,
    [string]$BootstrapUserName = 'admin',
    [string]$PortalFqdn = '',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$NonInteractive,
    [switch]$RemoveData,
    [switch]$KeepBuildSdk,
    [switch]$SkipUpdater,
    [switch]$ForceSourceBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$existingIdentity = Join-Path $DataRoot 'identity.json'
$cleanInstall = $RemoveData -or -not (Test-Path -LiteralPath $existingIdentity -PathType Leaf)
if (-not $cleanInstall -and -not $ForceSourceBuild) {
    throw 'Existing SIRK Portal detected. Runtime updates must be performed through Portal Maintenance -> SIRK Central -> SIRK Updater. Use -ForceSourceBuild only for explicit bootstrap/recovery.'
}

$useBinaryInstaller = $cleanInstall -and -not $ForceSourceBuild
$scriptName = if ($useBinaryInstaller) { 'install-binary.ps1' } else { 'install-core.ps1' }

$commonDataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
if ([string]::IsNullOrWhiteSpace($commonDataRoot)) {
    throw 'Unable to determine ProgramData.'
}
$bootstrapRoot = Join-Path $commonDataRoot ('SIRK\Temp\InstallRouter-' + [guid]::NewGuid().ToString('N'))
$scriptPath = Join-Path $bootstrapRoot $scriptName
$localScriptPath = Join-Path $PSScriptRoot $scriptName
$scriptUrl = 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/' + $scriptName + '?nocache=' + [guid]::NewGuid()

function Convert-InstallerAclToWellKnownSids {
    param([Parameter(Mandatory)][string]$Path)

    $source = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $replacements = [ordered]@{
        "'SYSTEM:(OI)(CI)F'" = "'*S-1-5-18:(OI)(CI)F'"
        "'Administrators:(OI)(CI)F'" = "'*S-1-5-32-544:(OI)(CI)F'"
        "'SYSTEM:F'" = "'*S-1-5-18:F'"
        "'Administrators:F'" = "'*S-1-5-32-544:F'"
    }
    foreach ($entry in $replacements.GetEnumerator()) {
        $source = $source.Replace([string]$entry.Key, [string]$entry.Value)
    }
    Set-Content -LiteralPath $Path -Value $source -Encoding UTF8
}

try {
    New-Item -ItemType Directory -Path $bootstrapRoot -Force | Out-Null
    $route = if ($useBinaryInstaller) { 'immutable signed binary bootstrap' } else { 'explicit source recovery' }
    Write-Host ('=== SIRK Portal installer route: ' + $route + ' ===') -ForegroundColor Cyan

    if (Test-Path -LiteralPath $localScriptPath -PathType Leaf) {
        Copy-Item -LiteralPath $localScriptPath -Destination $scriptPath -Force
    }
    else {
        # Public GitHub access is bootstrap/recovery only. Installed runtime updates do not use this router.
        Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl -OutFile $scriptPath
    }
    Convert-InstallerAclToWellKnownSids -Path $scriptPath

    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Error $_.Message }
        throw "$scriptName contains PowerShell syntax errors."
    }

    $parameters = @{
        Branch = $Branch
        Channel = $Channel
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
    if ($SkipUpdater) { $parameters.SkipUpdater = $true }

    if ($useBinaryInstaller) {
        $parameters.Remove('Branch')
        & $scriptPath @parameters
    }
    else {
        if ($KeepBuildSdk) { $parameters.KeepBuildSdk = $true }
        if ($ForceSourceBuild) { $parameters.ForceSourceBuild = $true }
        & $scriptPath @parameters
    }

    if (-not $?) {
        throw "$scriptName returned a failure status."
    }
}
finally {
    Remove-Item -LiteralPath $bootstrapRoot -Recurse -Force -ErrorAction SilentlyContinue
}
