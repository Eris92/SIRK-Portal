#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalName,
    [switch]$RemoveData,
    [switch]$Force,
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [string]$CentralUrl,
    [string]$CentralPortalId,
    [string]$CentralPortalName,
    [string]$PublicUrl,
    [switch]$WaitForCentralApproval
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

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

        $content = Get-Content -LiteralPath $path -Raw
        $updaterNonce = [guid]::NewGuid().ToString('N')
        $content = $content.Replace(
            'https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release.ps1',
            "https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.ps1?nocache=$updaterNonce"
        )

        $oldUpdaterInvocation = @'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -AllowSourceFallback
        if ($LASTEXITCODE -ne 0) { throw "SIRK Updater installation failed. ExitCode=$LASTEXITCODE" }
'@
        $newUpdaterInvocation = @'
        Write-Host '[UPDATER] Installing transactional verified release package v2.' -ForegroundColor DarkCyan
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer | Out-Host
        $updaterInstallerExitCode = $LASTEXITCODE
        if ($updaterInstallerExitCode -ne 0) {
            throw "SIRK Updater release v2 installation failed. ExitCode=$updaterInstallerExitCode. Local source build is disabled."
        }
'@
        if (-not $content.Contains($oldUpdaterInvocation.Trim())) {
            throw 'Unable to apply Updater v2 integration patch to install-v3.ps1.'
        }
        $content = $content.Replace($oldUpdaterInvocation.Trim(), $newUpdaterInvocation.Trim())
        Set-Content -LiteralPath $path -Value $content -Encoding UTF8

        Write-Host '[BOOTSTRAP] Starting SIRK Portal installer v3.' -ForegroundColor DarkCyan
        Write-Host '[BOOTSTRAP] Nested installers use cache-busting.' -ForegroundColor DarkCyan
        Write-Host '[BOOTSTRAP] SIRK Updater policy: transactional verified release v2 only.' -ForegroundColor DarkCyan

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

function Invoke-CentralEnrollment {
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$PortalId,
        [string]$DisplayName,
        [string]$PortalPublicUrl,
        [switch]$Wait
    )

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cli = 'C:\Program Files\SIRK\Portal\tools\enrollment\sirk-central-enroll.js'
    if (-not (Test-Path -LiteralPath $cli)) {
        throw "Central enrollment CLI is missing: $cli"
    }

    if (-not $PortalId) {
        $PortalId = $env:COMPUTERNAME.ToLowerInvariant() -replace '[^a-z0-9-]', '-'
        $PortalId = $PortalId.Trim('-')
    }
    if (-not $DisplayName) { $DisplayName = $env:COMPUTERNAME }
    if (-not $PortalPublicUrl -and $PortalName) { $PortalPublicUrl = "https://$PortalName" }

    Write-Host "`n============================================================" -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host ' INPUT REQUIRED' -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host ' Enter the one-time Portal enrollment token from SIRK Central.' -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host "============================================================" -ForegroundColor Yellow -BackgroundColor DarkBlue
    $secureToken = Read-Host 'Central enrollment token' -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlain $secureToken
    try {
        if (-not $plainToken -or $plainToken.Length -lt 20) { throw 'Central enrollment token is invalid.' }
        $previousToken = $env:SIRK_CENTRAL_ENROLLMENT_TOKEN
        $env:SIRK_CENTRAL_ENROLLMENT_TOKEN = $plainToken
        try {
            $arguments = @(
                $cli, 'begin',
                '--central-url', $Url,
                '--portal-id', $PortalId,
                '--portal-name', $DisplayName
            )
            if ($PortalPublicUrl) { $arguments += @('--public-url', $PortalPublicUrl) }
            & $node @arguments | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "Central enrollment request failed. ExitCode=$LASTEXITCODE" }
        }
        finally {
            $env:SIRK_CENTRAL_ENROLLMENT_TOKEN = $previousToken
        }
    }
    finally {
        $plainToken = $null
        $secureToken = $null
    }

    Write-Host '[OK] Portal enrollment request is pending approval in SIRK Central.' -ForegroundColor Green
    if (-not $Wait) {
        Write-Host 'Complete later:' -ForegroundColor Cyan
        Write-Host ('  "{0}" "{1}" wait' -f $node, $cli) -ForegroundColor Cyan
        return
    }

    Write-Host '[WAIT] Waiting for Central approval...' -ForegroundColor DarkCyan
    & $node $cli wait '--wait-timeout-seconds' '1800' '--interval-seconds' '5' | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Central enrollment approval failed or timed out. ExitCode=$LASTEXITCODE" }

    Restart-Service -Name SirkPortal -Force
    (Get-Service -Name SirkPortal).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    Write-Host '[OK] Portal connected to SIRK Central and service restarted.' -ForegroundColor Green
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host ' SIRK PORTAL MANAGED INSTALLATION' -ForegroundColor Cyan
Write-Host ' WinGet + Node.js LTS + npm latest + .NET LTS + WinSW' -ForegroundColor Cyan
Write-Host ' Shared SIRK Installer Framework v3' -ForegroundColor Cyan
Write-Host ' Updater: verified release v2 with transactional rollback' -ForegroundColor Cyan
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

if ($CentralUrl) {
    Invoke-CentralEnrollment `
        -Url $CentralUrl `
        -PortalId $CentralPortalId `
        -DisplayName $CentralPortalName `
        -PortalPublicUrl $PublicUrl `
        -Wait:$WaitForCentralApproval
}
