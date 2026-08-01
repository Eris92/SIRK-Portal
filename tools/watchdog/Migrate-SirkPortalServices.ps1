[CmdletBinding()]
param(
    [string]$PortalRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$LegacyServiceName = 'SirkPortalStandalone',
    [string]$ServiceName = 'SirkPortal'
)

$ErrorActionPreference = 'Stop'
$StandaloneScript = Join-Path $PortalRoot 'server\standalone.js'
$NodeWindowsRoot = Join-Path $PortalRoot 'node_modules\node-windows'
$TemporaryInstaller = Join-Path $env:TEMP ('sirk-portal-service-' + [guid]::NewGuid().ToString('N') + '.js')

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js executable not found: $NodePath" }
if (-not (Test-Path -LiteralPath $StandaloneScript -PathType Leaf)) { throw "Portal entrypoint not found: $StandaloneScript" }

if (-not (Test-Path -LiteralPath $NodeWindowsRoot -PathType Container)) {
    Push-Location $PortalRoot
    try {
        & npm.cmd install node-windows@1.0.0-beta.8 --no-save --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "Unable to install node-windows. Exit code: $LASTEXITCODE" }
    }
    finally { Pop-Location }
}

$ExistingCanonical = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingCanonical) {
    if ($ExistingCanonical.Status -ne 'Running') { Start-Service -Name $ServiceName }
    Set-Service -Name $ServiceName -StartupType Automatic
} else {
    $Installer = @"
'use strict';
const { Service } = require(${($NodeWindowsRoot | ConvertTo-Json -Compress)});
const service = new Service({
  name: ${($ServiceName | ConvertTo-Json -Compress)},
  description: 'SIRK Portal local management and Agent broker.',
  script: ${($StandaloneScript | ConvertTo-Json -Compress)},
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  maxRetries: 10,
  abortOnError: false,
  env: [
    { name: 'SIRK_DATA_ROOT', value: ${($DataRoot | ConvertTo-Json -Compress)} },
    { name: 'SIRK_SERVICE_NAME', value: ${($ServiceName | ConvertTo-Json -Compress)} }
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
service.on('start', () => { if (!completed) { completed = true; process.exit(0); } });
service.on('error', fail);
service.install();
setTimeout(() => fail(new Error('SirkPortal service installation timed out.')), 60000);
"@
    Set-Content -LiteralPath $TemporaryInstaller -Value $Installer -Encoding UTF8
    try {
        & $NodePath $TemporaryInstaller
        if ($LASTEXITCODE -ne 0) { throw "Unable to install $ServiceName. Exit code: $LASTEXITCODE" }
    }
    finally { Remove-Item -LiteralPath $TemporaryInstaller -Force -ErrorAction SilentlyContinue }
}

(Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
Set-Service -Name $ServiceName -StartupType Automatic

$Legacy = Get-Service -Name $LegacyServiceName -ErrorAction SilentlyContinue
if ($Legacy) {
    Stop-Service -Name $LegacyServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $LegacyServiceName | Out-Null
}

$Watchdog = Get-CimInstance Win32_Service |
    Where-Object { $_.Name -eq 'SirkPortalWatchdog' -or $_.PathName -match 'Portal Watchdog' } |
    Select-Object -First 1
if ($Watchdog) {
    $WatchdogKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$($Watchdog.Name)"
    $Environment = @((Get-ItemProperty -Path $WatchdogKey -Name Environment -ErrorAction SilentlyContinue).Environment)
    $Environment = @($Environment | Where-Object { $_ -and $_ -notmatch '^SIRK_SERVICE_NAME=' -and $_ -notmatch '^SIRK_PORTAL_HEALTH_URL=' })
    $Environment += 'SIRK_SERVICE_NAME=SirkPortal'
    $Environment += 'SIRK_PORTAL_HEALTH_URL=https://127.0.0.1/login'
    New-ItemProperty -Path $WatchdogKey -Name Environment -PropertyType MultiString -Value $Environment -Force | Out-Null
    Restart-Service -Name $Watchdog.Name -Force
}

Write-Host 'SIRK_PORTAL_SERVICE_MIGRATION_OK'
Get-Service SirkPortal, SirkPortalWatchdog -ErrorAction SilentlyContinue |
    Format-Table Name, Status, StartType -AutoSize
