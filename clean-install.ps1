#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$PortalName,
    [switch]$RemoveData,
    [switch]$SkipBackup,
    [switch]$SkipRcTest,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallRoot = 'C:\Program Files\SIRK\Portal'
$DataRoot = 'C:\ProgramData\SIRK\Portal'
$BackupRoot = 'C:\ProgramData\SIRK\Backups\Portal'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LegacyServices = @(
    'SirkPortal',
    'SirkPortalStandalone',
    'sirkportal.exe',
    'SirkPortalWatchdog',
    'sirkportalwatchdog.exe'
)

function Test-ValidDnsName {
    param([Parameter(Mandatory)][string]$Value)
    return $Value.Length -le 253 -and
        $Value -match '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$'
}

function Wait-ServiceDeletion {
    param(
        [Parameter(Mandatory)][string]$Name,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $output = & sc.exe query $Name 2>&1
        $code = $LASTEXITCODE
        if ($code -eq 1060) { return }
        if ($code -eq 1072) {
            throw "Service '$Name' is marked for deletion. Restart Windows and run the clean installer again."
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "Service '$Name' was not removed within $TimeoutSeconds seconds. Restart Windows and retry."
}

function Remove-SirkService {
    param([Parameter(Mandatory)][string]$Name)

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }

    Write-Host "Removing service: $Name"
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        try { $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) } catch {}
    }

    & sc.exe delete $Name | Out-Null
    if ($LASTEXITCODE -notin @(0, 1060)) {
        throw "Unable to delete service '$Name'. sc.exe ExitCode=$LASTEXITCODE"
    }
    Wait-ServiceDeletion -Name $Name
}

function Backup-PortalState {
    if ($SkipBackup) { return $null }
    if (-not (Test-Path -LiteralPath $InstallRoot) -and -not (Test-Path -LiteralPath $DataRoot)) { return $null }

    $destination = Join-Path $BackupRoot $Timestamp
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    if (Test-Path -LiteralPath $InstallRoot) {
        Copy-Item -LiteralPath $InstallRoot -Destination (Join-Path $destination 'Install') -Recurse -Force
    }
    if (Test-Path -LiteralPath $DataRoot) {
        Copy-Item -LiteralPath $DataRoot -Destination (Join-Path $destination 'Data') -Recurse -Force
    }

    Get-ChildItem -LiteralPath $destination -Recurse -File |
        Get-FileHash -Algorithm SHA256 |
        ForEach-Object { "$($_.Hash)  $($_.Path.Substring($destination.Length + 1))" } |
        Set-Content -LiteralPath (Join-Path $destination 'SHA256SUMS.txt') -Encoding ASCII

    return $destination
}

if (-not $PortalName) {
    $defaultName = 'portal.' + $env:COMPUTERNAME.ToLowerInvariant() + '.local'
    $PortalName = (Read-Host "Portal DNS name [$defaultName]").Trim().ToLowerInvariant()
    if (-not $PortalName) { $PortalName = $defaultName }
} else {
    $PortalName = $PortalName.Trim().ToLowerInvariant()
}

if (-not (Test-ValidDnsName -Value $PortalName)) {
    throw 'Invalid Portal DNS name. Enter a hostname or FQDN without protocol, port or path.'
}

$summary = @(
    "Portal URL: https://$PortalName/login",
    "Install root: $InstallRoot",
    "Data root: $DataRoot",
    "Remove active data: $RemoveData",
    "Create backup: $(-not $SkipBackup)"
) -join [Environment]::NewLine

Write-Host '=== SIRK Portal clean installation ==='
Write-Host $summary
Write-Host ''

if (-not $Force -and -not $PSCmdlet.ShouldContinue(
    'Existing SIRK Portal services and binaries will be removed. Continue?',
    'SIRK Portal clean installation')) {
    throw 'Installation cancelled.'
}

$backup = Backup-PortalState
if ($backup) { Write-Host "Backup created: $backup" }

Write-Host '=== Stop and remove Portal services ==='
foreach ($serviceName in $LegacyServices) {
    Remove-SirkService -Name $serviceName
}

Write-Host '=== Remove previous Portal installation ==='
if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}

if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) {
    Write-Host 'Removing active Portal data.'
    Remove-Item -LiteralPath $DataRoot -Recurse -Force
}

Write-Host '=== Run canonical one-line installer ==='
$installerPath = Join-Path $env:TEMP ('sirk-portal-install-' + [guid]::NewGuid().ToString('N') + '.ps1')
try {
    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/install.ps1?nocache=' + [guid]::NewGuid()) `
        -OutFile $installerPath

    # The canonical installer reads the DNS name from stdin and then asks only for the Break-Glass password.
    $PortalName | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath
    if ($LASTEXITCODE -ne 0) {
        throw "Canonical Portal installer failed. ExitCode=$LASTEXITCODE"
    }
}
finally {
    Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
}

$statusUrl = "https://$PortalName/api/system/status"
$loginUrl = "https://$PortalName/login"

Write-Host '=== Verify clean installation ==='
$httpCode = & curl.exe -k -sS -o NUL -w '%{http_code}' --resolve "$PortalName`:443`:127.0.0.1" $statusUrl
if ($LASTEXITCODE -ne 0 -or $httpCode -notin @('200', '503')) {
    throw "Portal system status endpoint is unavailable. HTTP=$httpCode"
}

if (-not $SkipRcTest) {
    $rcTest = Join-Path $InstallRoot 'tools\test\Test-SirkPortal-Rc.ps1'
    if (-not (Test-Path -LiteralPath $rcTest)) {
        throw "RC validation script is missing: $rcTest"
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $rcTest `
        -PortalUrl "https://$PortalName" `
        -SkipCertificateValidation
    if ($LASTEXITCODE -ne 0) { throw "Portal RC validation failed. ExitCode=$LASTEXITCODE" }
}

Write-Host ''
Write-Host 'SIRK_PORTAL_CLEAN_INSTALL_OK'
Write-Host "Portal URL: $loginUrl"
Write-Host "System status: $statusUrl"
if ($backup) { Write-Host "Backup: $backup" }
