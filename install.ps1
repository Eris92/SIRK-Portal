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
    [switch]$KeepBuildSdk,
    [switch]$SkipUpdater,
    [switch]$ForceSourceBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$existingIdentity = Join-Path $DataRoot 'identity.json'
$isMain = [string]::Equals($Branch, 'main', [StringComparison]::OrdinalIgnoreCase)
$cleanInstall = $RemoveData -or -not (Test-Path -LiteralPath $existingIdentity -PathType Leaf)
$useBinaryInstaller = $isMain -and -not $ForceSourceBuild -and $cleanInstall
$scriptName = if ($useBinaryInstaller) { 'install-binary.ps1' } else { 'install-core.ps1' }

$commonDataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
if ([string]::IsNullOrWhiteSpace($commonDataRoot)) {
    throw 'Unable to determine ProgramData.'
}
$bootstrapRoot = Join-Path $commonDataRoot ('SIRK\Temp\InstallRouter-' + [guid]::NewGuid().ToString('N'))
$scriptPath = Join-Path $bootstrapRoot $scriptName
$scriptUrl = 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/' + $scriptName + '?nocache=' + [guid]::NewGuid()

try {
    New-Item -ItemType Directory -Path $bootstrapRoot -Force | Out-Null
    Write-Host ('=== SIRK Portal installer route: ' + $(if ($useBinaryInstaller) { 'verified binary clean install' } else { 'core installer/update' }) + ' ===') -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl -OutFile $scriptPath

    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Error $_.Message }
        throw "$scriptName contains PowerShell syntax errors."
    }

    if ($useBinaryInstaller) {
        $parameters = @{
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
        & $scriptPath @parameters
    }
    else {
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
        if ($KeepBuildSdk) { $parameters.KeepBuildSdk = $true }
        if ($SkipUpdater) { $parameters.SkipUpdater = $true }
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
