[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-AccessToken {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Get-Sha256Hex([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Ensure-SirkUpdater {
    $service = Get-Service -Name 'SirkUpdater' -ErrorAction SilentlyContinue
    $cli = 'C:\Program Files\SIRK\Updater\SirkUpdater.exe'

    if (-not $service -or -not (Test-Path -LiteralPath $cli)) {
        Write-Host '=== Install shared SIRK Updater ==='
        $installer = Join-Path $env:TEMP ('sirk-updater-install-' + [guid]::NewGuid().ToString('N') + '.ps1')
        try {
            Invoke-WebRequest `
                -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install.ps1?nocache=' + [guid]::NewGuid()) `
                -OutFile $installer `
                -UseBasicParsing
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
            if ($LASTEXITCODE -ne 0) { throw "SIRK Updater installation failed. ExitCode=$LASTEXITCODE" }
        }
        finally {
            Remove-Item $installer -Force -ErrorAction SilentlyContinue
        }
    }

    $service = Get-Service -Name 'SirkUpdater' -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service -Name 'SirkUpdater'
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }

    if (-not (Test-Path -LiteralPath $cli)) {
        throw "SIRK Updater CLI is missing: $cli"
    }

    return $cli
}

function Register-PortalWithUpdater {
    param(
        [Parameter(Mandatory)][string]$UpdaterCli,
        [Parameter(Mandatory)]$PortalService,
        [Parameter(Mandatory)]$WatchdogService
    )

    Write-Host '=== Register Portal in shared SIRK Updater ==='
    $manifestPath = Join-Path $env:TEMP ('sirk-portal-updater-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $manifest = [ordered]@{
            schemaVersion       = 1
            applicationId       = 'sirk-portal'
            displayName         = 'SIRK Portal'
            serviceName         = $PortalService.Name
            watchdogServiceName = $WatchdogService.Name
            installRoot         = 'C:\Program Files\SIRK\Portal'
            dataRoot            = 'C:\ProgramData\SIRK\Portal'
            healthUrl           = 'https://127.0.0.1/login'
            channel             = 'develop'
            updateSource        = 'https://github.com/Eris92/SIRK-Portal'
            packageSha256Url    = $null
            signatureRequired   = $false
        }

        $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
        & $UpdaterCli register $manifestPath
        if ($LASTEXITCODE -ne 0) { throw "Portal registration in SIRK Updater failed. ExitCode=$LASTEXITCODE" }
        & $UpdaterCli show sirk-portal | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Registered Portal manifest cannot be read back.' }
    }
    finally {
        Remove-Item $manifestPath -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Administrator)) { throw 'Run PowerShell as Administrator.' }

$defaultName = $env:COMPUTERNAME.ToLowerInvariant()
$portalName = (Read-Host "Portal DNS name [$defaultName]").Trim().ToLowerInvariant()
if (-not $portalName) { $portalName = $defaultName }
if ($portalName.Length -gt 253 -or $portalName -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$') {
    throw 'Invalid DNS name. Enter only a hostname or FQDN without protocol, port or path.'
}

$core = Join-Path $env:TEMP ('sirk-portal-core-' + [guid]::NewGuid().ToString('N') + '.ps1')
try {
    Invoke-WebRequest `
        -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/7248871be620b0e4c7614f6a2aef2e1184a34eb9/install.ps1' `
        -OutFile $core -UseBasicParsing
    & $core

    $portal = Get-CimInstance Win32_Service | Where-Object {
        $_.DisplayName -eq 'SIRK Portal' -or $_.Name -in @('SirkPortal','sirkportal.exe')
    } | Select-Object -First 1
    $watchdog = Get-CimInstance Win32_Service | Where-Object {
        $_.DisplayName -eq 'SIRK Portal Watchdog' -or $_.Name -in @('SirkPortalWatchdog','sirkportalwatchdog.exe')
    } | Select-Object -First 1
    if (-not $portal -or -not $watchdog) { throw 'Portal services were not found after the core installation.' }

    $dataRoot = 'C:\ProgramData\SIRK\Portal'
    $tlsRoot = Join-Path $dataRoot 'TLS'
    $pfxPath = Join-Path $tlsRoot 'portal.pfx'
    $pfxPasswordPath = Join-Path $tlsRoot 'portal-pfx-password.txt'
    $pfxPassword = (Get-Content $pfxPasswordPath -Raw).Trim()
    if (-not $pfxPassword) { throw 'TLS PFX password is missing.' }

    Stop-Service -Name $watchdog.Name -Force -ErrorAction SilentlyContinue
    Stop-Service -Name $portal.Name -Force

    $dnsNames = @($portalName, $env:COMPUTERNAME, "$($env:COMPUTERNAME).local", 'localhost') | Select-Object -Unique
    $certificate = New-SelfSignedCertificate -DnsName $dnsNames `
        -CertStoreLocation 'Cert:\LocalMachine\My' -FriendlyName 'SIRK Portal HTTPS' `
        -NotAfter (Get-Date).AddYears(3) -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256
    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath `
        -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) -Force | Out-Null

    $accessToken = New-AccessToken
    $accessHash = Get-Sha256Hex $accessToken
    $portalKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$($portal.Name)"
    $environment = @((Get-ItemProperty -Path $portalKey -Name Environment -ErrorAction SilentlyContinue).Environment)
    $environment = @($environment | Where-Object {
        $_ -and $_ -notmatch '^SIRK_ACCESS_KEY_HASH=' -and $_ -notmatch '^SIRK_PORTAL_FQDN='
    })
    $environment += @("SIRK_ACCESS_KEY_HASH=$accessHash", "SIRK_PORTAL_FQDN=$portalName")
    New-ItemProperty -Path $portalKey -Name Environment -PropertyType MultiString -Value $environment -Force | Out-Null

    Start-Service -Name $portal.Name
    (Get-Service -Name $portal.Name).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    Start-Sleep -Seconds 8
    $status = & curl.exe -k -s -o NUL -w '%{http_code}' --resolve "$portalName`:443`:127.0.0.1" "https://$portalName/login"
    if ($status -ne '200') { throw "Portal readiness failed. HTTP=$status" }
    Start-Service -Name $watchdog.Name

    $updaterCli = Ensure-SirkUpdater
    Register-PortalWithUpdater -UpdaterCli $updaterCli -PortalService $portal -WatchdogService $watchdog

    Write-Host ''
    Write-Host 'SIRK_PORTAL_INSTALLATION_READY'
    Write-Host "Portal URL: https://$portalName/login"
    Write-Host "Break-Glass URL: https://$portalName/login?access=$accessToken"
    Write-Host 'Save the Break-Glass URL outside the Portal. The access token is not stored in plaintext.'
    Write-Host 'Shared updater: SIRK Updater (sirk-portal registered)'
}
finally {
    Remove-Item $core -Force -ErrorAction SilentlyContinue
}
