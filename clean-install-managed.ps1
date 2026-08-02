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

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host ' SIRK PORTAL MANAGED INSTALLATION' -ForegroundColor Cyan
Write-Host ' WinGet + Node.js LTS + npm latest + .NET LTS + WinSW' -ForegroundColor Cyan
Write-Host ' Shared SIRK Installer Framework v3' -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Invoke-RemotePowerShellScript `
    -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/tools/install/Ensure-SirkWindowsPrerequisites.ps1' `
    -Parameters @{ UpgradeExisting = $true }

Invoke-RemotePowerShellScript `
    -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/install-v3.ps1' `
    -Parameters @{
        PortalName = $PortalName
        RemoveData = $RemoveData
        Force = $Force
        TrustCertificate = $TrustCertificate
        DoNotTrustCertificate = $DoNotTrustCertificate
    }
