[CmdletBinding()]
param(
    [string]$PortalRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$ServiceName = 'SirkPortalWatchdog'
)

$ErrorActionPreference = 'Stop'
$WatchdogRoot = 'C:\Program Files\SIRK\Portal Watchdog'
$WatchdogScript = Join-Path $WatchdogRoot 'portal-watchdog.js'
$SourceScript = Join-Path $PortalRoot 'tools\watchdog\portal-watchdog.js'

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node.js executable not found: $NodePath"
}
if (-not (Test-Path -LiteralPath $SourceScript -PathType Leaf)) {
    throw "Watchdog source not found: $SourceScript"
}

New-Item -ItemType Directory -Path $WatchdogRoot -Force | Out-Null
Copy-Item -LiteralPath $SourceScript -Destination $WatchdogScript -Force

$Existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Existing) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

$BinaryPath = '"{0}" "{1}"' -f $NodePath, $WatchdogScript
& sc.exe create $ServiceName binPath= $BinaryPath start= auto DisplayName= 'SIRK Portal Watchdog' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Unable to create $ServiceName." }

& sc.exe description $ServiceName 'Validates SIRK Portal, restarts it and restores the latest valid rollback tree after failed updates.' | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
& sc.exe config $ServiceName obj= LocalSystem | Out-Null

$ServiceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
$Environment = @(
    "SIRK_PORTAL_ROOT=$PortalRoot",
    "SIRK_DATA_ROOT=$DataRoot",
    'SIRK_SERVICE_NAME=SirkPortalStandalone',
    'SIRK_PORTAL_HEALTH_URL=https://127.0.0.1:9443/health',
    'SIRK_WATCHDOG_INTERVAL_MS=15000',
    'SIRK_WATCHDOG_FAILURE_THRESHOLD=3'
)
New-ItemProperty -Path $ServiceKey -Name Environment -PropertyType MultiString -Value $Environment -Force | Out-Null

Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

Write-Host 'SIRK_PORTAL_WATCHDOG_INSTALLED'
Get-Service SirkPortalStandalone, $ServiceName | Format-Table Name, Status, StartType -AutoSize
