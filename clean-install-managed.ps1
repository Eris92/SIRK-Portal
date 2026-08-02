#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalName,
    [switch]$RemoveData,
    [switch]$Force,
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-RemotePowerShellScript {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][hashtable]$Parameters
    )

    $path = Join-Path $env:TEMP ('sirk-script-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri ($Uri + '?nocache=' + [guid]::NewGuid()) -OutFile $path
        $script = [scriptblock]::Create((Get-Content -LiteralPath $path -Raw))
        & $script @Parameters
    }
    finally {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-RemotePowerShellProcess {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string[]]$ArgumentList
    )

    $path = Join-Path $env:TEMP ('sirk-installer-' + [guid]::NewGuid().ToString('N') + '.ps1')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri ($Uri + '?nocache=' + [guid]::NewGuid()) -OutFile $path

        # Force cache-busting for every nested raw GitHub installer fetched by install-v3.
        $content = Get-Content -LiteralPath $path -Raw
        $updaterNonce = [guid]::NewGuid().ToString('N')
        $content = $content.Replace(
            'https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release.ps1',
            "https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release.ps1?nocache=$updaterNonce"
        )
        Set-Content -LiteralPath $path -Value $content -Encoding UTF8

        Write-Host '[BOOTSTRAP] Starting SIRK Portal installer v3 with cache-busted nested installers.' -ForegroundColor DarkCyan
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $path @ArgumentList
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "SIRK Portal installer failed. ExitCode=$exitCode"
        }
    }
    finally {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host ' SIRK PORTAL MANAGED INSTALLATION' -ForegroundColor Cyan
Write-Host ' WinGet + Node.js LTS + npm latest + .NET LTS + WinSW' -ForegroundColor Cyan
Write-Host ' Shared SIRK Installer Framework v3' -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Invoke-RemotePowerShellScript `
    -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/tools/install/Ensure-SirkWindowsPrerequisites.ps1' `
    -Parameters @{ UpgradeExisting = $true }

$installerArguments = @()
if ($PortalName) { $installerArguments += @('-PortalName', $PortalName) }
if ($RemoveData) { $installerArguments += '-RemoveData' }
if ($Force) { $installerArguments += '-Force' }
if ($TrustCertificate) { $installerArguments += '-TrustCertificate' }
if ($DoNotTrustCertificate) { $installerArguments += '-DoNotTrustCertificate' }

Invoke-RemotePowerShellProcess `
    -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/install-v3.ps1' `
    -ArgumentList $installerArguments
