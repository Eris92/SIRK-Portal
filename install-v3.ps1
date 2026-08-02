#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalName,
    [switch]$RemoveData,
    [switch]$Force,
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($TrustCertificate -and $DoNotTrustCertificate) {
    throw 'Use only one of -TrustCertificate or -DoNotTrustCertificate.'
}

$PortalRoot = 'C:\Program Files\SIRK\Portal'
$WatchdogRoot = 'C:\Program Files\SIRK\Portal Watchdog'
$DataRoot = 'C:\ProgramData\SIRK\Portal'
$BackupRoot = 'C:\ProgramData\SIRK\Backups\Portal'
$LogPath = 'C:\ProgramData\SIRK\Logs\Portal-Install.log'
$WinSwUri = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$FrameworkUri = 'https://raw.githubusercontent.com/Eris92/SIRK-Portal/develop/tools/install/SirkInstaller.Console.psm1'
$TotalSteps = 12
$Work = Join-Path $env:TEMP ('SIRK-Portal-v3-' + [guid]::NewGuid().ToString('N'))
$FrameworkPath = Join-Path $Work 'SirkInstaller.Console.psm1'
$Zip = Join-Path $Work 'portal.zip'
$Extract = Join-Path $Work 'extract'
$password = $null
$passwordAgain = $null

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Escape-Xml([string]$Value) {
    return [Security.SecurityElement]::Escape($Value)
}

function New-RandomBase64([int]$ByteCount = 48) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function New-AccessToken {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Get-Sha256Hex([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant()
    }
    finally { $sha.Dispose() }
}

function Remove-ServiceIfPresent([string]$Name) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Name | Out-Null
    for ($i = 0; $i -lt 45; $i++) {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    throw "Service '$Name' is pending deletion. Restart Windows and retry."
}

function Install-WinSwService {
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$DisplayName,
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][hashtable]$Environment,
        [Parameter(Mandatory)][string]$DaemonRoot
    )

    New-Item -ItemType Directory -Path $DaemonRoot -Force | Out-Null
    $serviceExe = Join-Path $DaemonRoot ($ServiceName + '.exe')
    $serviceXml = Join-Path $DaemonRoot ($ServiceName + '.xml')

    Invoke-SirkDownload -Uri $WinSwUri -Destination $serviceExe -DisplayName "$DisplayName service wrapper"
    $hash = (Get-FileHash -LiteralPath $serviceExe -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -ne $WinSwSha256) {
        throw "WinSW SHA-256 mismatch for $ServiceName. Actual=$hash"
    }
    Write-SirkOk "$DisplayName WinSW SHA-256 verified."

    $envXml = ($Environment.GetEnumerator() | Sort-Object Name | ForEach-Object {
        '  <env name="' + (Escape-Xml ([string]$_.Name)) + '" value="' + (Escape-Xml ([string]$_.Value)) + '" />'
    }) -join "`r`n"

    $xml = @"
<service>
  <id>$(Escape-Xml $ServiceName)</id>
  <name>$(Escape-Xml $DisplayName)</name>
  <description>$(Escape-Xml $Description)</description>
  <executable>$(Escape-Xml $Executable)</executable>
  <arguments>$(Escape-Xml $Arguments)</arguments>
  <workingdirectory>$(Escape-Xml $WorkingDirectory)</workingdirectory>
  <startmode>Automatic</startmode>
  <stoptimeout>30sec</stoptimeout>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="15 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 day</resetfailure>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
$envXml
</service>
"@
    Set-Content -LiteralPath $serviceXml -Value $xml -Encoding UTF8

    & $serviceExe install | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Unable to install service $ServiceName. ExitCode=$LASTEXITCODE" }
    & $serviceExe start | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Unable to start service $ServiceName. ExitCode=$LASTEXITCODE" }
    (Get-Service -Name $ServiceName -ErrorAction Stop).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    return @{ Exe = $serviceExe; Xml = $serviceXml; Content = $xml }
}

function Wait-Portal([string]$Name, [int]$TimeoutSeconds = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $code = & curl.exe -k -sS -o NUL -w '%{http_code}' --resolve "$Name`:443`:127.0.0.1" "https://$Name/login" 2>$null
        if ($code -eq '200') { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Portal readiness failed. HTTP=$code"
}

function Ensure-SirkUpdater {
    $service = Get-Service -Name SirkUpdater -ErrorAction SilentlyContinue
    $cli = 'C:\Program Files\SIRK\Updater\SirkUpdater.exe'
    if (-not $service -or -not (Test-Path -LiteralPath $cli)) {
        $installer = Join-Path $Work 'install-updater.ps1'
        Invoke-SirkDownload -Uri 'https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release.ps1' -Destination $installer -DisplayName 'SIRK Updater installer'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -AllowSourceFallback
        if ($LASTEXITCODE -ne 0) { throw "SIRK Updater installation failed. ExitCode=$LASTEXITCODE" }
    }
    $service = Get-Service -Name SirkUpdater -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service SirkUpdater
        $service.WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
    }
    if (-not (Test-Path -LiteralPath $cli)) { throw "SIRK Updater CLI missing: $cli" }
    return $cli
}

New-Item -ItemType Directory -Path $Work -Force | Out-Null
try {
    Invoke-WebRequest -UseBasicParsing -Uri ($FrameworkUri + '?nocache=' + [guid]::NewGuid()) -OutFile $FrameworkPath
    Import-Module $FrameworkPath -Force

    if (-not $PortalName) {
        $defaultName = 'portal.' + $env:COMPUTERNAME.ToLowerInvariant() + '.local'
        Write-SirkInputRequired "Enter Portal DNS name. Default: $defaultName"
        $PortalName = (Read-Host 'Portal DNS name').Trim().ToLowerInvariant()
        if (-not $PortalName) { $PortalName = $defaultName }
    }
    else { $PortalName = $PortalName.Trim().ToLowerInvariant() }

    if ($PortalName -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$') {
        throw 'Invalid Portal DNS name.'
    }

    Initialize-SirkInstallerConsole -Component 'SIRK Portal' -Version 'develop' -Channel 'develop' -LogPath $LogPath
    Write-SirkKeyValue -Name 'Portal URL' -Value "https://$PortalName/login" -ValueColor Cyan
    Write-SirkKeyValue -Name 'Install root' -Value $PortalRoot
    Write-SirkKeyValue -Name 'Data root' -Value $DataRoot
    Write-SirkKeyValue -Name 'Remove data' -Value ([string]$RemoveData)

    Write-SirkInputRequired 'Enter Break-Glass administrator password (minimum 12 characters).'
    $passwordSecure = Read-Host 'Break-Glass administrator password' -AsSecureString
    Write-SirkInputRequired 'Repeat Break-Glass administrator password.'
    $passwordRepeat = Read-Host 'Repeat password' -AsSecureString
    $password = ConvertFrom-SecureStringPlain $passwordSecure
    $passwordAgain = ConvertFrom-SecureStringPlain $passwordRepeat
    if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 12) { throw 'Password must contain at least 12 characters.' }
    if ($password -cne $passwordAgain) { throw 'Passwords do not match.' }
    Write-SirkOk 'Break-Glass password accepted.'

    Write-SirkStep 1 $TotalSteps 'Validate prerequisites'
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
    Write-SirkOk "Node.js $(& $node --version)"
    Write-SirkOk ".NET SDK $(& $dotnet --version)"

    Write-SirkStep 2 $TotalSteps 'Update npm to latest release'
    & $npm install --global npm@latest --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm update failed. ExitCode=$LASTEXITCODE" }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Write-SirkOk "npm $(& $npm --version)"

    Write-SirkStep 3 $TotalSteps 'Stop and remove previous Portal services'
    foreach ($name in @('SirkPortalWatchdog','sirkportalwatchdog.exe','SirkPortal','SirkPortalStandalone','sirkportal.exe')) {
        Remove-ServiceIfPresent $name
    }
    Write-SirkOk 'Previous services removed.'

    Write-SirkStep 4 $TotalSteps 'Backup and clean previous installation'
    if ((Test-Path $PortalRoot) -or (Test-Path $DataRoot)) {
        $backup = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        if (Test-Path $PortalRoot) { Copy-Item $PortalRoot (Join-Path $backup 'Install') -Recurse -Force }
        if (Test-Path $DataRoot) { Copy-Item $DataRoot (Join-Path $backup 'Data') -Recurse -Force }
        Write-SirkOk "Backup: $backup"
    }
    Remove-Item $PortalRoot, $WatchdogRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($RemoveData) { Remove-Item $DataRoot -Recurse -Force -ErrorAction SilentlyContinue }

    Write-SirkStep 5 $TotalSteps 'Download Portal package'
    New-Item -ItemType Directory -Path $Extract -Force | Out-Null
    Invoke-SirkDownload -Uri 'https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/develop' -Destination $Zip -DisplayName 'SIRK Portal'
    Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force
    $source = Get-ChildItem $Extract -Directory | Where-Object Name -Like 'SIRK-Portal-*' | Select-Object -First 1
    if (-not $source) { throw 'Downloaded Portal archive has unexpected layout.' }
    New-Item -ItemType Directory -Path $PortalRoot -Force | Out-Null
    & robocopy.exe $source.FullName $PortalRoot /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Portal copy failed. Robocopy=$LASTEXITCODE" }
    Write-SirkOk 'Portal files extracted.'

    Write-SirkStep 6 $TotalSteps 'Install production dependencies'
    $npmLog = Join-Path $Work 'npm-ci.log'
    & $npm ci --omit=dev --no-audit --no-fund --loglevel=error --prefix $PortalRoot *> $npmLog
    if ($LASTEXITCODE -ne 0) {
        Get-Content $npmLog -Tail 100 | Out-Host
        throw "npm ci failed. ExitCode=$LASTEXITCODE"
    }
    Write-SirkOk 'Production dependencies installed.'

    Write-SirkStep 7 $TotalSteps 'Prepare persistent data and TLS'
    $tlsRoot = Join-Path $DataRoot 'TLS'
    New-Item -ItemType Directory -Path $tlsRoot -Force | Out-Null
    $pfxPath = Join-Path $tlsRoot 'portal.pfx'
    $pfxPasswordPath = Join-Path $tlsRoot 'portal-pfx-password.txt'
    $enrollmentTokenPath = Join-Path $DataRoot 'agent-enrollment-token.txt'
    $pfxPassword = New-RandomBase64
    $enrollmentToken = New-RandomBase64
    Set-Content $pfxPasswordPath $pfxPassword -Encoding ASCII -NoNewline
    Set-Content $enrollmentTokenPath $enrollmentToken -Encoding ASCII -NoNewline
    $certificate = New-SelfSignedCertificate -DnsName @($PortalName,$env:COMPUTERNAME,"$($env:COMPUTERNAME).local",'localhost') -CertStoreLocation 'Cert:\LocalMachine\My' -FriendlyName 'SIRK Portal HTTPS' -NotAfter (Get-Date).AddYears(3) -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256
    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) | Out-Null
    Write-SirkOk "TLS certificate created for $PortalName."

    $trust = if ($TrustCertificate) { $true } elseif ($DoNotTrustCertificate) { $false } else { Read-SirkYesNo -Prompt 'Trust the generated TLS certificate in LocalMachine\\Root?' -DefaultYes $true }
    if ($trust) { Add-SirkTrustedCertificate -Certificate $certificate } else { Write-SirkWarning 'TLS certificate was not added to the trusted root store.' }

    Write-SirkStep 8 $TotalSteps 'Install SIRK Portal WinSW service'
    $accessToken = New-AccessToken
    $accessHash = Get-Sha256Hex $accessToken
    $portalEnv = @{
        SIRK_DATA_ROOT = $DataRoot
        SIRK_SERVICE_NAME = 'SirkPortal'
        SIRK_TLS_PFX = $pfxPath
        SIRK_TLS_PFX_PASSWORD_FILE = $pfxPasswordPath
        SIRK_ENROLLMENT_TOKEN_FILE = $enrollmentTokenPath
        SIRK_HTTPS_PORT = '443'
        SIRK_INTERNAL_PORT = '9080'
        SIRK_PORTAL_FQDN = $PortalName
        SIRK_PUBLIC_URL = "https://$PortalName"
        SIRK_ACCESS_KEY_HASH = $accessHash
        SIRK_LOGIN_USER = 'admin'
        SIRK_LOGIN_DISPLAY_NAME = 'Administrator'
        SIRK_LOGIN_PASSWORD = $password
    }
    $portalService = Install-WinSwService -ServiceName 'SirkPortal' -DisplayName 'SIRK Portal' -Description 'SIRK Portal local management and Agent broker.' -Executable $node -Arguments ('--harmony "' + (Join-Path $PortalRoot 'server\standalone-https.js') + '"') -WorkingDirectory $PortalRoot -Environment $portalEnv -DaemonRoot (Join-Path $PortalRoot 'server\daemon')
    Write-SirkOk 'SIRK Portal service installed and running.'

    Write-SirkStep 9 $TotalSteps 'Initialize identity and remove bootstrap password'
    Wait-Portal $PortalName
    & $portalService.Exe stop | Out-Null
    (Get-Service SirkPortal).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
    $runtimeXml = $portalService.Content -replace '(?m)^\s*<env name="SIRK_LOGIN_(USER|DISPLAY_NAME|PASSWORD)"[^\r\n]*\r?\n?', ''
    Set-Content -LiteralPath $portalService.Xml -Value $runtimeXml -Encoding UTF8
    & $portalService.Exe start | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to restart SIRK Portal after identity bootstrap.' }
    (Get-Service SirkPortal).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    Wait-Portal $PortalName
    Write-SirkOk 'Identity initialized; bootstrap password removed from service configuration.'

    Write-SirkStep 10 $TotalSteps 'Install SIRK Portal Watchdog WinSW service'
    $watchdogScript = Join-Path $PortalRoot 'tools\watchdog\portal-watchdog.js'
    if (Test-Path $watchdogScript) {
        $watchdogEnv = @{
            SIRK_PORTAL_SERVICE_NAME = 'SirkPortal'
            SIRK_PORTAL_HEALTH_URL = 'https://127.0.0.1/login'
            SIRK_DATA_ROOT = $DataRoot
        }
        Install-WinSwService -ServiceName 'SirkPortalWatchdog' -DisplayName 'SIRK Portal Watchdog' -Description 'Monitors and automatically recovers SIRK Portal.' -Executable $node -Arguments ('"' + $watchdogScript + '"') -WorkingDirectory $PortalRoot -Environment $watchdogEnv -DaemonRoot (Join-Path $WatchdogRoot 'daemon') | Out-Null
        Write-SirkOk 'SIRK Portal Watchdog installed and running.'
    }
    else { Write-SirkWarning 'Watchdog script is missing; Watchdog was not installed.' }

    Write-SirkStep 11 $TotalSteps 'Install and register shared SIRK Updater'
    $updaterCli = Ensure-SirkUpdater
    $manifestPath = Join-Path $Work 'sirk-portal-updater.json'
    $manifest = [ordered]@{
        schemaVersion = 1
        applicationId = 'sirk-portal'
        displayName = 'SIRK Portal'
        serviceName = 'SirkPortal'
        watchdogServiceName = 'SirkPortalWatchdog'
        installRoot = $PortalRoot
        dataRoot = $DataRoot
        healthUrl = 'https://127.0.0.1/login'
        channel = 'dev'
        updateSource = 'https://github.com/Eris92/SIRK-Portal'
        packageSha256Url = $null
        signatureRequired = $false
    }
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    & $updaterCli register $manifestPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Portal registration in SIRK Updater failed. ExitCode=$LASTEXITCODE" }
    Write-SirkOk 'SIRK Updater running; sirk-portal registered.'

    Write-SirkStep 12 $TotalSteps 'Verify services, HTTPS and prepare summary'
    Wait-Portal $PortalName
    $portalStatus = (Get-Service SirkPortal).Status
    $watchdogService = Get-Service SirkPortalWatchdog -ErrorAction SilentlyContinue
    $updaterStatus = (Get-Service SirkUpdater).Status
    $portalUrl = "https://$PortalName/login"
    $breakGlassUrl = "https://$PortalName/login?access=$accessToken"
    $statusUrl = "https://$PortalName/api/system/status"
    $summaryPath = Join-Path $DataRoot 'installation-summary.txt'
    @"
SIRK Portal installation completed
Portal URL: $portalUrl
Break-Glass URL: $breakGlassUrl
System status: $statusUrl
Portal service: $portalStatus
Watchdog service: $(if ($watchdogService) { $watchdogService.Status } else { 'Not installed' })
Updater service: $updaterStatus
Certificate trusted: $trust
Installation log: $LogPath
"@ | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    try { Set-Clipboard -Value (Get-Content -LiteralPath $summaryPath -Raw) } catch { Write-SirkWarning 'Installation summary could not be copied to clipboard.' }

    Show-SirkInstallationSummary -Values ([ordered]@{
        'Portal service' = [string]$portalStatus
        'Watchdog service' = if ($watchdogService) { [string]$watchdogService.Status } else { 'Not installed' }
        'Updater service' = [string]$updaterStatus
        'Certificate' = if ($trust) { 'Trusted' } else { 'Not trusted' }
        'Portal URL' = $portalUrl
        'Break-Glass URL' = $breakGlassUrl
        'System status' = $statusUrl
        'Summary file' = $summaryPath
    }) -SuccessCode 'SIRK_PORTAL_INSTALL_V3_OK'
}
catch {
    if (Get-Command Write-SirkError -ErrorAction SilentlyContinue) { Write-SirkError $_.Exception.Message }
    throw
}
finally {
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
    $password = $null
    $passwordAgain = $null
}
