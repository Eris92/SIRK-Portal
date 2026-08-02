#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch]$UpgradeExisting
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $items = @($machine, $user) -join ';'
    $items = ($items -split ';' | Where-Object {
        $_ -and $_.Trim() -and $_.TrimEnd('\') -ine 'C:\Program Files\SIRK\Runtime\Node'
    } | Select-Object -Unique) -join ';'
    $env:Path = $items
}

function Get-WinGetCommand {
    $command = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $package = Get-AppxPackage -AllUsers Microsoft.DesktopAppInstaller -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($package) {
        $candidate = Join-Path $package.InstallLocation 'winget.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    return $null
}

function Ensure-WinGet {
    $winget = Get-WinGetCommand
    if ($winget) {
        Write-Host "WinGet available: $winget"
        return $winget
    }

    Write-Host '=== Bootstrap WinGet package manager ==='
    Write-Host 'Installing Microsoft.WinGet.Client from PowerShell Gallery...'

    $repository = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
    $previousPolicy = if ($repository) { $repository.InstallationPolicy } else { $null }

    try {
        if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers | Out-Null
        }

        if (-not $repository) {
            Register-PSRepository -Default
            $repository = Get-PSRepository -Name PSGallery -ErrorAction Stop
            $previousPolicy = $repository.InstallationPolicy
        }

        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
        Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope AllUsers -Force -AllowClobber
        Import-Module Microsoft.WinGet.Client -Force

        Write-Host 'Repairing/installing Windows Package Manager for all users...'
        Repair-WinGetPackageManager -AllUsers
    }
    finally {
        if ($previousPolicy) {
            Set-PSRepository -Name PSGallery -InstallationPolicy $previousPolicy -ErrorAction SilentlyContinue
        }
    }

    Refresh-ProcessPath
    $winget = Get-WinGetCommand
    if (-not $winget) {
        throw 'WinGet bootstrap completed, but winget.exe is still unavailable.'
    }

    Write-Host "WinGet installed: $winget"
    return $winget
}

function Invoke-WinGet {
    param(
        [Parameter(Mandatory)][string]$Winget,
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$Operation = 'WinGet operation'
    )

    & $Winget @Arguments
    $code = $LASTEXITCODE
    if ($code -notin @(0, -1978335189)) {
        throw "$Operation failed. WinGet ExitCode=$code"
    }
}

function Ensure-WinGetPackage {
    param(
        [Parameter(Mandatory)][string]$Winget,
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$DisplayName
    )

    $common = @(
        '--id', $Id,
        '--exact',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity'
    )

    Write-Host "=== Ensure $DisplayName ==="
    Invoke-WinGet -Winget $Winget -Arguments (@('install') + $common) -Operation "$DisplayName installation"

    if ($UpgradeExisting) {
        Invoke-WinGet -Winget $Winget -Arguments (@('upgrade') + $common) -Operation "$DisplayName upgrade"
    }
}

$winget = Ensure-WinGet

try {
    Invoke-WinGet -Winget $winget -Arguments @('source', 'update', '--disable-interactivity') -Operation 'WinGet source update'
} catch {
    Write-Warning $_.Exception.Message
}

Ensure-WinGetPackage -Winget $winget -Id 'OpenJS.NodeJS.LTS' -DisplayName 'latest Node.js LTS'
Ensure-WinGetPackage -Winget $winget -Id 'Microsoft.DotNet.SDK.10' -DisplayName 'latest .NET 10 LTS SDK'

Refresh-ProcessPath

$portableNode = 'C:\Program Files\SIRK\Runtime\Node'
if (Test-Path -LiteralPath $portableNode) {
    Write-Host "Removing obsolete portable Node.js runtime: $portableNode"
    Remove-Item -LiteralPath $portableNode -Recurse -Force -ErrorAction SilentlyContinue
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue

if (-not $node) { throw 'Managed Node.js installation completed, but node.exe is unavailable.' }
if (-not $npm) { throw 'Managed Node.js installation completed, but npm.cmd is unavailable.' }
if (-not $dotnet) { throw 'Managed .NET installation completed, but dotnet.exe is unavailable.' }

$nodeVersion = (& $node.Source --version).Trim()
$dotnetVersion = (& $dotnet.Source --version).Trim()

if ($nodeVersion -notmatch '^v24\.') {
    throw "Expected highest Node.js LTS major 24, detected $nodeVersion."
}
if ($dotnetVersion -notmatch '^10\.') {
    throw "Expected highest .NET LTS SDK major 10, detected $dotnetVersion."
}

Write-Host ''
Write-Host 'SIRK_WINDOWS_PREREQUISITES_OK'
Write-Host "WinGet: $winget"
Write-Host "Node.js: $nodeVersion ($($node.Source))"
Write-Host ".NET SDK: $dotnetVersion ($($dotnet.Source))"
