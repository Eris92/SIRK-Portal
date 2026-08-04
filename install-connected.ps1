[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$ConnectionFile = '',
    [string]$PortalFqdn = '',
    [string]$PortalPublicUrl = '',
    [int]$HttpsPort = 443,
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$BootstrapUserName = 'admin',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$RemoveData,
    [switch]$KeepSourceConnectionFile,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($Branch -notmatch '^[A-Za-z0-9._/-]{1,128}$' -or $Branch.Contains('..')) {
    throw 'Nazwa galezi Git jest nieprawidlowa.'
}

$previousTemp = [Environment]::GetEnvironmentVariable('TEMP', 'Process')
$previousTmp = [Environment]::GetEnvironmentVariable('TMP', 'Process')
$shortBase = Join-Path $env:SystemDrive 'SIRK-TMP'
$runRoot = Join-Path $shortBase ('P-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$installer = Join-Path $runRoot 'connected.ps1'

try {
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    & icacls.exe $shortBase /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Nie mozna zabezpieczyc katalogu tymczasowego: $shortBase"
    }

    [Environment]::SetEnvironmentVariable('TEMP', $runRoot, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $runRoot, 'Process')

    Write-Host "Krotki katalog roboczy: $runRoot" -ForegroundColor DarkCyan
    $installerUrl = "https://raw.githubusercontent.com/Eris92/SIRK-Portal/$Branch/install-connected-dotnet10.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installer
    if ((Get-Item -LiteralPath $installer).Length -lt 10000) {
        throw 'Pobrany instalator polaczony jest niekompletny.'
    }

    $arguments = @{
        Branch = $Branch
        ConnectionFile = $ConnectionFile
        PortalFqdn = $PortalFqdn
        PortalPublicUrl = $PortalPublicUrl
        HttpsPort = $HttpsPort
        InstallRoot = $InstallRoot
        DataRoot = $DataRoot
        BootstrapUserName = $BootstrapUserName
    }
    if ($TrustCertificate) { $arguments.TrustCertificate = $true }
    if ($DoNotTrustCertificate) { $arguments.DoNotTrustCertificate = $true }
    if ($RemoveData) { $arguments.RemoveData = $true }
    if ($KeepSourceConnectionFile) { $arguments.KeepSourceConnectionFile = $true }
    if ($ValidateOnly) { $arguments.ValidateOnly = $true }

    & $installer @arguments
}
finally {
    [Environment]::SetEnvironmentVariable('TEMP', $previousTemp, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $previousTmp, 'Process')
    Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
}
