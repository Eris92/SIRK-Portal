[CmdletBinding()]
param(
    [string]$PortalRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$PortalServiceName = 'SirkPortal',
    [string]$LegacyPortalServiceName = 'SirkPortalStandalone',
    [string]$ServiceName = 'SirkPortalWatchdog'
)

$ErrorActionPreference = 'Stop'
$WatchdogRoot = 'C:\Program Files\SIRK\Portal Watchdog'
$WatchdogScript = Join-Path $WatchdogRoot 'portal-watchdog.js'
$SourceScript = Join-Path $PortalRoot 'tools\watchdog\portal-watchdog.js'
$InstallerScript = Join-Path $WatchdogRoot 'install-watchdog.js'
$PackageFile = Join-Path $WatchdogRoot 'package.json'

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node.js executable not found: $NodePath"
}
if (-not (Test-Path -LiteralPath $SourceScript -PathType Leaf)) {
    throw "Watchdog source not found: $SourceScript"
}

$ManagedPortalService = if (Get-Service -Name $PortalServiceName -ErrorAction SilentlyContinue) {
    $PortalServiceName
} elseif (Get-Service -Name $LegacyPortalServiceName -ErrorAction SilentlyContinue) {
    $LegacyPortalServiceName
} else {
    throw 'SIRK Portal Windows service was not found.'
}

New-Item -ItemType Directory -Path $WatchdogRoot -Force | Out-Null
Copy-Item -LiteralPath $SourceScript -Destination $WatchdogScript -Force

if (-not (Test-Path -LiteralPath $PackageFile -PathType Leaf)) {
    @{
        name = 'sirk-portal-watchdog'
        version = '1.0.0'
        private = $true
    } | ConvertTo-Json | Set-Content -LiteralPath $PackageFile -Encoding UTF8
}

Push-Location $WatchdogRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $WatchdogRoot 'node_modules\node-windows') -PathType Container)) {
        & npm.cmd install node-windows@1.0.0-beta.8 --save-exact --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to install node-windows. Exit code: $LASTEXITCODE"
        }
    }
}
finally {
    Pop-Location
}

$Existing = Get-CimInstance Win32_Service |
    Where-Object {
        $_.Name -eq $ServiceName -or
        $_.DisplayName -eq 'SIRK Portal Watchdog' -or
        $_.PathName -match 'Portal Watchdog'
    } |
    Select-Object -First 1

if ($Existing) {
    Stop-Service -Name $Existing.Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Existing.Name | Out-Null
    for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
        if (-not (Get-CimInstance Win32_Service -Filter "Name='$($Existing.Name)'" -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Seconds 1
    }
}

$Installer = @"
'use strict';
const { Service } = require(${((Join-Path $WatchdogRoot 'node_modules\node-windows') | ConvertTo-Json -Compress)});
const service = new Service({
  name: ${($ServiceName | ConvertTo-Json -Compress)},
  description: 'Validates and automatically recovers SIRK Portal after failed updates.',
  script: ${($WatchdogScript | ConvertTo-Json -Compress)},
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  maxRetries: 10,
  abortOnError: false,
  env: [
    { name: 'SIRK_PORTAL_ROOT', value: ${($PortalRoot | ConvertTo-Json -Compress)} },
    { name: 'SIRK_DATA_ROOT', value: ${($DataRoot | ConvertTo-Json -Compress)} },
    { name: 'SIRK_SERVICE_NAME', value: ${($ManagedPortalService | ConvertTo-Json -Compress)} },
    { name: 'SIRK_PORTAL_HEALTH_URL', value: 'https://127.0.0.1/login' },
    { name: 'SIRK_WATCHDOG_INTERVAL_MS', value: '15000' },
    { name: 'SIRK_WATCHDOG_FAILURE_THRESHOLD', value: '3' }
  ]
});
let completed = false;
function fail(error) {
  if (completed) return;
  completed = true;
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
service.on('install', () => service.start());
service.on('alreadyinstalled', () => service.start());
service.on('start', () => {
  if (completed) return;
  completed = true;
  console.log('SIRK_PORTAL_WATCHDOG_INSTALLED');
  process.exit(0);
});
service.on('error', fail);
service.install();
setTimeout(() => fail(new Error('SirkPortalWatchdog installation timed out.')), 60000);
"@

Set-Content -LiteralPath $InstallerScript -Value $Installer -Encoding UTF8
try {
    & $NodePath $InstallerScript
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to install $ServiceName. Exit code: $LASTEXITCODE"
    }
}
finally {
    Remove-Item -LiteralPath $InstallerScript -Force -ErrorAction SilentlyContinue
}

$WatchdogService = $null
for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
    $WatchdogService = Get-CimInstance Win32_Service |
        Where-Object {
            $_.Name -eq $ServiceName -or
            $_.DisplayName -eq 'SIRK Portal Watchdog' -or
            $_.PathName -match 'Portal Watchdog'
        } |
        Select-Object -First 1
    if ($WatchdogService) { break }
    Start-Sleep -Seconds 1
}
if (-not $WatchdogService) {
    throw "$ServiceName was not registered in Service Control Manager."
}

& sc.exe config $WatchdogService.Name start= auto | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Unable to configure Automatic startup for $($WatchdogService.Name)."
}

if ($WatchdogService.State -ne 'Running') {
    Start-Service -Name $WatchdogService.Name
    (Get-Service -Name $WatchdogService.Name).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

Write-Host 'SIRK_PORTAL_WATCHDOG_INSTALLED'
Get-Service $ManagedPortalService, $WatchdogService.Name |
    Format-Table Name, Status, StartType -AutoSize
