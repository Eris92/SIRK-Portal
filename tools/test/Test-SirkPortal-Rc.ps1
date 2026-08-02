#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalUrl = 'https://127.0.0.1',
    [string]$PortalService = 'SirkPortal',
    [string]$UpdaterService = 'SirkUpdater',
    [int]$TimeoutSeconds = 90,
    [switch]$SkipCertificateValidation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-PortalRequest {
    param([Parameter(Mandatory)][string]$Path)
    $uri = $PortalUrl.TrimEnd('/') + $Path
    $parameters = @{ Uri = $uri; Method = 'GET'; TimeoutSec = 15; UseBasicParsing = $true }
    if ($SkipCertificateValidation -and $PSVersionTable.PSVersion.Major -ge 7) {
        $parameters.SkipCertificateCheck = $true
    }
    try {
        return Invoke-RestMethod @parameters
    } catch {
        if (-not $SkipCertificateValidation -or $PSVersionTable.PSVersion.Major -ge 7) { throw }
        [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        try { return Invoke-RestMethod @parameters }
        finally { [Net.ServicePointManager]::ServerCertificateValidationCallback = $null }
    }
}

function Wait-ServiceRunning {
    param([Parameter(Mandatory)][string]$Name)
    $service = Get-Service -Name $Name -ErrorAction Stop
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds($TimeoutSeconds))
    $service.Refresh()
    if ($service.Status -ne 'Running') { throw "Service $Name is not running." }
}

function Wait-PortalStatus {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $status = Invoke-PortalRequest -Path '/api/system/status'
            if ($status.portal.service.running -eq $true -and $status.certificate.configured -eq $true) { return $status }
        } catch { $lastError = $_ }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if ($lastError) { throw "Portal status did not recover: $($lastError.Exception.Message)" }
    throw 'Portal status did not recover before timeout.'
}

$results = [ordered]@{
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    portalService = $null
    updaterService = $null
    initialStatus = $null
    restartStatus = $null
    result = 'running'
}

try {
    foreach ($name in @($PortalService, $UpdaterService)) {
        $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop
        if (-not $service) { throw "Required service is missing: $name" }
        if ($service.StartMode -notin @('Auto', 'Automatic')) { throw "Service $name is not Automatic: $($service.StartMode)" }
    }

    Wait-ServiceRunning -Name $PortalService
    Wait-ServiceRunning -Name $UpdaterService
    $results.portalService = Get-CimInstance Win32_Service -Filter "Name='$PortalService'" |
        Select-Object Name, DisplayName, State, StartMode, PathName
    $results.updaterService = Get-CimInstance Win32_Service -Filter "Name='$UpdaterService'" |
        Select-Object Name, DisplayName, State, StartMode, PathName

    $initial = Wait-PortalStatus
    $results.initialStatus = $initial
    if ($initial.status -eq 'critical') { throw 'Initial Portal status is critical.' }
    if ($initial.updater.registered -ne $true) { throw 'SIRK Portal is not registered in SIRK Updater.' }

    Restart-Service -Name $PortalService -Force
    Wait-ServiceRunning -Name $PortalService
    $afterRestart = Wait-PortalStatus
    $results.restartStatus = $afterRestart
    if ($afterRestart.portal.version -ne $initial.portal.version) { throw 'Portal version changed unexpectedly after restart.' }
    if ($afterRestart.central.portalId -ne $initial.central.portalId) { throw 'Central Portal ID was not preserved after restart.' }

    Restart-Service -Name $UpdaterService -Force
    Wait-ServiceRunning -Name $UpdaterService
    $afterUpdater = Wait-PortalStatus
    if ($afterUpdater.updater.service.running -ne $true) { throw 'Updater did not recover after restart.' }

    $results.result = 'passed'
    $results.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
    $results | ConvertTo-Json -Depth 12
    Write-Host 'SIRK_PORTAL_RC_TEST_OK' -ForegroundColor Green
} catch {
    $results.result = 'failed'
    $results.error = $_.Exception.Message
    $results.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
    $results | ConvertTo-Json -Depth 12
    throw
}
