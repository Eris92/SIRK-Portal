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

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-RandomBase64 {
    param([ValidateRange(16,4096)][int]$ByteCount = 48)
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $PWD.Path,
        [int[]]$SuccessCodes = @(0)
    )
    $stdout = Join-Path $env:TEMP ('sirk-out-' + [guid]::NewGuid().ToString('N') + '.log')
    $stderr = Join-Path $env:TEMP ('sirk-err-' + [guid]::NewGuid().ToString('N') + '.log')
    try {
        $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        foreach ($file in @($stdout, $stderr)) {
            if (Test-Path $file) {
                $text = Get-Content $file -Raw -ErrorAction SilentlyContinue
                if ($text) { Write-Host $text.TrimEnd() }
            }
        }
        if ($SuccessCodes -notcontains $process.ExitCode) {
            throw "Native process failed: $FilePath (ExitCode=$($process.ExitCode))"
        }
        return $process.ExitCode
    }
    finally {
        Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

function Get-SirkServiceCandidates {
    param([Parameter(Mandatory)][ValidateSet('Portal','Watchdog')][string]$Kind)
    $values = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue
    if ($Kind -eq 'Portal') {
        return @($values | Where-Object {
            $_.Name -in @('SirkPortal','SirkPortalStandalone','sirkportal.exe') -or
            $_.DisplayName -eq 'SIRK Portal' -or
            ($_.PathName -match '\\SIRK\\Portal\\daemon\\' -and $_.PathName -notmatch 'Portal Watchdog')
        })
    }
    return @($values | Where-Object {
        $_.Name -in @('SirkPortalWatchdog','sirkportalwatchdog.exe') -or
        $_.DisplayName -eq 'SIRK Portal Watchdog' -or
        $_.PathName -match '\\SIRK\\Portal Watchdog\\daemon\\'
    })
}

function Remove-ServiceCompletely {
    param([Parameter(Mandatory)][string]$Name)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Name | Out-Null
    for ($attempt = 1; $attempt -le 45; $attempt++) {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    throw "Service '$Name' is pending deletion. Close services.msc and restart Windows."
}

function Wait-RegisteredService {
    param(
        [Parameter(Mandatory)][ValidateSet('Portal','Watchdog')][string]$Kind,
        [int]$TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $service = Get-SirkServiceCandidates -Kind $Kind | Select-Object -First 1
        if ($service) { return $service }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "SIRK $Kind service was not registered in Service Control Manager."
}

function Set-ServiceIdentity {
    param(
        [Parameter(Mandatory)][string]$ActualName,
        [Parameter(Mandatory)][string]$DisplayName,
        [Parameter(Mandatory)][string]$Description
    )
    & sc.exe config $ActualName start= auto DisplayName= $DisplayName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to configure service '$ActualName'." }
    & sc.exe description $ActualName $Description | Out-Null
}

function Wait-ServiceRunning {
    param([Parameter(Mandatory)][string]$Name, [int]$TimeoutSeconds = 60)
    $service = Get-Service -Name $Name -ErrorAction Stop
    if ($service.Status -ne 'Running') { Start-Service -Name $Name }
    (Get-Service -Name $Name).WaitForStatus('Running', [TimeSpan]::FromSeconds($TimeoutSeconds))
}

function Wait-Https {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $status = & curl.exe -k -s -o NUL -w '%{http_code}' https://127.0.0.1/login 2>$null
        if ($status -eq '200') { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw 'SIRK Portal did not pass the HTTPS readiness check.'
}

if (-not (Test-Administrator)) { throw 'Run PowerShell as Administrator.' }

Write-Host '=== SIRK Portal clean installation ==='
Write-Host 'Existing Portal services, binaries and active data will be replaced.'
Write-Host 'A timestamped local backup will be retained.'

$passwordSecure = Read-Host 'Break-Glass administrator password' -AsSecureString
$passwordRepeat = Read-Host 'Repeat password' -AsSecureString
$password = ConvertFrom-SecureStringPlain $passwordSecure
$passwordAgain = ConvertFrom-SecureStringPlain $passwordRepeat
$work = $null

try {
    if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 12) {
        throw 'Password must contain at least 12 characters.'
    }
    if ($password -cne $passwordAgain) { throw 'Passwords do not match.' }

    $portalRoot = 'C:\Program Files\SIRK\Portal'
    $watchdogRoot = 'C:\Program Files\SIRK\Portal Watchdog'
    $dataRoot = 'C:\ProgramData\SIRK\Portal'
    $backupRoot = 'C:\ProgramData\SIRK\Install Backups'
    $backup = Join-Path $backupRoot ('Portal-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $work = Join-Path $env:TEMP ('SIRK-Portal-Install-' + [guid]::NewGuid().ToString('N'))
    $zip = Join-Path $work 'portal.zip'
    $extract = Join-Path $work 'extract'
    New-Item -ItemType Directory -Path $work, $extract, $backupRoot -Force | Out-Null

    Write-Host '=== Stop and remove previous services ==='
    $services = @(Get-SirkServiceCandidates -Kind Watchdog) + @(Get-SirkServiceCandidates -Kind Portal)
    foreach ($service in ($services | Sort-Object Name -Unique)) {
        Remove-ServiceCompletely -Name $service.Name
    }

    Write-Host '=== Preserve previous installation ==='
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    if (Test-Path $portalRoot) { Move-Item $portalRoot (Join-Path $backup 'Portal') -Force }
    if (Test-Path $watchdogRoot) { Move-Item $watchdogRoot (Join-Path $backup 'Portal Watchdog') -Force }
    if (Test-Path $dataRoot) { Move-Item $dataRoot (Join-Path $backup 'Data') -Force }

    Write-Host '=== Ensure Node.js ==='
    $nodePath = 'C:\Program Files\nodejs\node.exe'
    $npmPath = 'C:\Program Files\nodejs\npm.cmd'
    if (-not (Test-Path $nodePath)) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) { throw 'Node.js is missing and winget is unavailable.' }
        Invoke-Native $winget.Source @('install','--id','OpenJS.NodeJS.LTS','--exact','--silent','--accept-package-agreements','--accept-source-agreements') $work | Out-Null
    }
    if (-not (Test-Path $nodePath) -or -not (Test-Path $npmPath)) { throw 'Node.js installation is incomplete.' }

    Write-Host '=== Download complete Portal tree ==='
    Invoke-WebRequest 'https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/develop' -OutFile $zip -UseBasicParsing
    Expand-Archive $zip $extract -Force
    $source = Get-ChildItem $extract -Directory | Where-Object Name -Like 'SIRK-Portal-*' | Select-Object -First 1 -ExpandProperty FullName
    if (-not $source) { throw 'Downloaded Portal archive has an unexpected layout.' }
    foreach ($relative in @(
        'config.json','package.json','portal-independence.json','server\standalone.js',
        'server\standalone-https.js','server\core\runtime.js','server\core\identity-store.js',
        'public\portal\standalone\index.html','public\portal\standalone\login.html',
        'public\portal\vendor\sirk-portal.css','tools\watchdog\portal-watchdog.js'
    )) {
        if (-not (Test-Path (Join-Path $source $relative) -PathType Leaf)) { throw "Downloaded package is incomplete: $relative" }
    }
    New-Item -ItemType Directory -Path $portalRoot -Force | Out-Null
    & robocopy.exe $source $portalRoot /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Portal copy failed. Robocopy=$LASTEXITCODE" }

    Write-Host '=== Install production dependencies ==='
    Invoke-Native $npmPath @('ci','--omit=dev','--no-audit','--no-fund') $portalRoot | Out-Null
    Invoke-Native $npmPath @('install','node-windows@1.0.0-beta.8','--no-save','--omit=dev','--no-audit','--no-fund') $portalRoot | Out-Null

    Write-Host '=== Prepare fresh persistent data and TLS ==='
    $tlsRoot = Join-Path $dataRoot 'TLS'
    New-Item -ItemType Directory -Path $tlsRoot -Force | Out-Null
    $pfxPath = Join-Path $tlsRoot 'portal.pfx'
    $pfxPasswordPath = Join-Path $tlsRoot 'portal-pfx-password.txt'
    $enrollmentTokenPath = Join-Path $dataRoot 'agent-enrollment-token.txt'
    $pfxPassword = New-RandomBase64 -ByteCount 48
    $enrollmentToken = New-RandomBase64 -ByteCount 48
    Set-Content $pfxPasswordPath $pfxPassword -Encoding ASCII -NoNewline
    Set-Content $enrollmentTokenPath $enrollmentToken -Encoding ASCII -NoNewline
    $certificate = New-SelfSignedCertificate -DnsName @($env:COMPUTERNAME,"$($env:COMPUTERNAME).local",'localhost') `
        -CertStoreLocation 'Cert:\LocalMachine\My' -FriendlyName 'SIRK Portal HTTPS' `
        -NotAfter (Get-Date).AddYears(3) -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256
    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath `
        -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) | Out-Null

    Write-Host '=== Install SIRK Portal service ==='
    $serviceInstaller = Join-Path $work 'install-portal-service.js'
    $nodeWindowsRoot = Join-Path $portalRoot 'node_modules\node-windows'
    $entrypoint = Join-Path $portalRoot 'server\standalone-https.js'
    @"
'use strict';
const { Service } = require($(ConvertTo-Json $nodeWindowsRoot -Compress));
const service = new Service({ name: 'SIRK Portal', description: 'SIRK Portal local management and Agent broker.', script: $(ConvertTo-Json $entrypoint -Compress), wait: 2, grow: 0.5, maxRestarts: 10, maxRetries: 10, abortOnError: false });
service.on('install', () => process.exit(0));
service.on('alreadyinstalled', () => process.exit(0));
service.on('error', error => { console.error(error); process.exit(1); });
service.install();
setTimeout(() => process.exit(2), 60000);
"@ | Set-Content $serviceInstaller -Encoding UTF8
    Invoke-Native $nodePath @($serviceInstaller) $work | Out-Null
    $portalService = Wait-RegisteredService -Kind Portal
    $portalServiceName = $portalService.Name
    Set-ServiceIdentity $portalServiceName 'SIRK Portal' 'SIRK Portal local management and Agent broker.'

    $portalServiceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$portalServiceName"
    $bootstrapEnvironment = @(
        "SIRK_DATA_ROOT=$dataRoot","SIRK_SERVICE_NAME=$portalServiceName","SIRK_TLS_PFX=$pfxPath",
        "SIRK_TLS_PFX_PASSWORD_FILE=$pfxPasswordPath","SIRK_ENROLLMENT_TOKEN_FILE=$enrollmentTokenPath",
        'SIRK_HTTPS_PORT=443','SIRK_INTERNAL_PORT=9080','SIRK_LOGIN_USER=admin',
        'SIRK_LOGIN_DISPLAY_NAME=Administrator',"SIRK_LOGIN_PASSWORD=$password"
    )
    New-ItemProperty $portalServiceKey Environment -PropertyType MultiString -Value $bootstrapEnvironment -Force | Out-Null
    Start-Service $portalServiceName
    Wait-Https

    Write-Host '=== Remove bootstrap password ==='
    Stop-Service $portalServiceName -Force
    $runtimeEnvironment = @($bootstrapEnvironment | Where-Object { $_ -notmatch '^SIRK_LOGIN_' })
    New-ItemProperty $portalServiceKey Environment -PropertyType MultiString -Value $runtimeEnvironment -Force | Out-Null
    Start-Service $portalServiceName
    Wait-Https -TimeoutSeconds 90

    Write-Host '=== Install independent Watchdog ==='
    New-Item -ItemType Directory -Path $watchdogRoot -Force | Out-Null
    Copy-Item (Join-Path $portalRoot 'tools\watchdog\portal-watchdog.js') (Join-Path $watchdogRoot 'portal-watchdog.js') -Force
    @{ name='sirk-portal-watchdog'; version='1.0.0'; private=$true } | ConvertTo-Json | Set-Content (Join-Path $watchdogRoot 'package.json') -Encoding UTF8
    Invoke-Native $npmPath @('install','node-windows@1.0.0-beta.8','--save-exact','--omit=dev','--no-audit','--no-fund') $watchdogRoot | Out-Null
    $watchdogInstaller = Join-Path $work 'install-watchdog-service.js'
    $watchdogNodeWindows = Join-Path $watchdogRoot 'node_modules\node-windows'
    $watchdogScript = Join-Path $watchdogRoot 'portal-watchdog.js'
    @"
'use strict';
const { Service } = require($(ConvertTo-Json $watchdogNodeWindows -Compress));
const service = new Service({ name: 'SIRK Portal Watchdog', description: 'Monitors and automatically recovers SIRK Portal.', script: $(ConvertTo-Json $watchdogScript -Compress), wait: 2, grow: 0.5, maxRestarts: 10, maxRetries: 10, abortOnError: false });
service.on('install', () => process.exit(0));
service.on('alreadyinstalled', () => process.exit(0));
service.on('error', error => { console.error(error); process.exit(1); });
service.install();
setTimeout(() => process.exit(2), 60000);
"@ | Set-Content $watchdogInstaller -Encoding UTF8
    Invoke-Native $nodePath @($watchdogInstaller) $work | Out-Null
    $watchdogService = Wait-RegisteredService -Kind Watchdog
    $watchdogServiceName = $watchdogService.Name
    Set-ServiceIdentity $watchdogServiceName 'SIRK Portal Watchdog' 'Monitors and automatically recovers SIRK Portal.'
    $watchdogKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$watchdogServiceName"
    New-ItemProperty $watchdogKey Environment -PropertyType MultiString -Force -Value @(
        "SIRK_PORTAL_ROOT=$portalRoot","SIRK_DATA_ROOT=$dataRoot","SIRK_SERVICE_NAME=$portalServiceName",
        'SIRK_PORTAL_HEALTH_URL=https://127.0.0.1/login','SIRK_WATCHDOG_INTERVAL_MS=15000','SIRK_WATCHDOG_FAILURE_THRESHOLD=3'
    ) | Out-Null
    Start-Service $watchdogServiceName
    Wait-ServiceRunning $watchdogServiceName

    Write-Host '=== Configure Windows Firewall ==='
    Get-NetFirewallRule -DisplayName 'SIRK Portal HTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'SIRK Portal HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -Profile Domain,Private | Out-Null

    Write-Host '=== Final validation ==='
    Wait-ServiceRunning $portalServiceName
    Wait-ServiceRunning $watchdogServiceName
    Wait-Https -TimeoutSeconds 60
    $config = Get-Content (Join-Path $portalRoot 'config.json') -Raw | ConvertFrom-Json
    Write-Host ''
    Write-Host 'SIRK_PORTAL_CLEAN_INSTALL_OK'
    Write-Host "Version: $($config.version)"
    Write-Host "URL: https://$env:COMPUTERNAME/"
    Write-Host 'Login: admin'
    Write-Host "Previous installation backup: $backup"
    Get-Service $portalServiceName, $watchdogServiceName | Format-Table Name, DisplayName, Status, StartType -AutoSize
}
finally {
    $password = $null
    $passwordAgain = $null
    if ($passwordSecure) { $passwordSecure.Dispose() }
    if ($passwordRepeat) { $passwordRepeat.Dispose() }
    if ($work -and (Test-Path $work)) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
