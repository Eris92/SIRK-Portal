#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalName,
    [switch]$RemoveData,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Started = Get-Date
$PortalRoot = 'C:\Program Files\SIRK\Portal'
$WatchdogRoot = 'C:\Program Files\SIRK\Portal Watchdog'
$DataRoot = 'C:\ProgramData\SIRK\Portal'
$BackupRoot = 'C:\ProgramData\SIRK\Backups\Portal'
$WinSwUri = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

function Write-Banner([string]$Text) {
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}
function Write-Step([int]$Number, [int]$Total, [string]$Text) {
    Write-Host ("`n[{0:D2}/{1:D2}] {2}" -f $Number, $Total, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARNING] $Text" -ForegroundColor Yellow }
function Write-InputRequired([string]$Text) {
    Write-Host "`n============================================================" -ForegroundColor Yellow
    Write-Host ' INPUT REQUIRED' -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host " $Text" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
}
function ConvertFrom-SecureStringPlain([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Escape-Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
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
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Remove-ServiceIfPresent([string]$Name) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Name | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
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
    Invoke-WebRequest -UseBasicParsing -Uri $WinSwUri -OutFile $serviceExe
    $hash = (Get-FileHash -LiteralPath $serviceExe -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -ne $WinSwSha256) { throw "WinSW SHA-256 mismatch for $ServiceName. Actual=$hash" }

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

if (-not $PortalName) {
    $defaultName = 'portal.' + $env:COMPUTERNAME.ToLowerInvariant() + '.local'
    Write-InputRequired "Enter Portal DNS name. Default: $defaultName"
    $PortalName = (Read-Host 'Portal DNS name').Trim().ToLowerInvariant()
    if (-not $PortalName) { $PortalName = $defaultName }
} else {
    $PortalName = $PortalName.Trim().ToLowerInvariant()
}
if ($PortalName -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$') { throw 'Invalid Portal DNS name.' }

Write-Banner 'SIRK Portal Installer v2 - WinSW only'
Write-Host "Portal URL : https://$PortalName/login" -ForegroundColor White
Write-Host "Install    : $PortalRoot" -ForegroundColor White
Write-Host "Data       : $DataRoot" -ForegroundColor White
Write-Host "RemoveData : $RemoveData" -ForegroundColor White

Write-InputRequired 'Enter Break-Glass administrator password (minimum 12 characters).'
$passwordSecure = Read-Host 'Break-Glass administrator password' -AsSecureString
Write-InputRequired 'Repeat Break-Glass administrator password.'
$passwordRepeat = Read-Host 'Repeat password' -AsSecureString
$password = ConvertFrom-SecureStringPlain $passwordSecure
$passwordAgain = ConvertFrom-SecureStringPlain $passwordRepeat
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 12) { throw 'Password must contain at least 12 characters.' }
if ($password -cne $passwordAgain) { throw 'Passwords do not match.' }
Write-Ok 'Break-Glass password accepted.'

$Total = 10
$Work = Join-Path $env:TEMP ('SIRK-Portal-v2-' + [guid]::NewGuid().ToString('N'))
$Zip = Join-Path $Work 'portal.zip'
$Extract = Join-Path $Work 'extract'
try {
    Write-Step 1 $Total 'Validate prerequisites'
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
    Write-Ok "Node.js $(& $node --version)"
    Write-Ok ".NET SDK $(& $dotnet --version)"

    Write-Step 2 $Total 'Stop and remove previous Portal services'
    foreach ($name in @('SirkPortalWatchdog','sirkportalwatchdog.exe','SirkPortal','SirkPortalStandalone','sirkportal.exe')) { Remove-ServiceIfPresent $name }
    Write-Ok 'Previous services removed.'

    Write-Step 3 $Total 'Backup and clean previous installation'
    if ((Test-Path $PortalRoot) -or (Test-Path $DataRoot)) {
        $backup = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        if (Test-Path $PortalRoot) { Copy-Item $PortalRoot (Join-Path $backup 'Install') -Recurse -Force }
        if (Test-Path $DataRoot) { Copy-Item $DataRoot (Join-Path $backup 'Data') -Recurse -Force }
        Write-Ok "Backup: $backup"
    }
    Remove-Item $PortalRoot, $WatchdogRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($RemoveData) { Remove-Item $DataRoot -Recurse -Force -ErrorAction SilentlyContinue }

    Write-Step 4 $Total 'Download Portal source'
    New-Item -ItemType Directory -Path $Work, $Extract -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri 'https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/develop' -OutFile $Zip
    Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force
    $source = Get-ChildItem $Extract -Directory | Where-Object Name -Like 'SIRK-Portal-*' | Select-Object -First 1
    if (-not $source) { throw 'Downloaded Portal archive has unexpected layout.' }
    New-Item -ItemType Directory -Path $PortalRoot -Force | Out-Null
    & robocopy.exe $source.FullName $PortalRoot /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Portal copy failed. Robocopy=$LASTEXITCODE" }
    Write-Ok 'Portal files downloaded.'

    Write-Step 5 $Total 'Install production dependencies'
    & $npm ci --omit=dev --no-audit --no-fund --prefix $PortalRoot
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed. ExitCode=$LASTEXITCODE" }
    Write-Ok 'Production dependencies installed.'

    Write-Step 6 $Total 'Prepare persistent data and TLS'
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
    Write-Ok "TLS certificate created for $PortalName."

    Write-Step 7 $Total 'Install SIRK Portal WinSW service'
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
    Write-Ok 'SIRK Portal service installed and running.'

    Write-Step 8 $Total 'Initialize identity store and remove bootstrap password'
    Wait-Portal $PortalName
    & $portalService.Exe stop | Out-Null
    (Get-Service SirkPortal).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
    $runtimeXml = $portalService.Content -replace '(?m)^\s*<env name="SIRK_LOGIN_(USER|DISPLAY_NAME|PASSWORD)"[^\r\n]*\r?\n?', ''
    Set-Content -LiteralPath $portalService.Xml -Value $runtimeXml -Encoding UTF8
    & $portalService.Exe start | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to restart SIRK Portal after identity bootstrap.' }
    (Get-Service SirkPortal).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    Wait-Portal $PortalName
    Write-Ok 'Identity initialized; bootstrap password removed from service configuration.'

    Write-Step 9 $Total 'Install SIRK Portal Watchdog WinSW service'
    $watchdogScript = Join-Path $PortalRoot 'tools\watchdog\portal-watchdog.js'
    if (Test-Path $watchdogScript) {
        $watchdogEnv = @{ SIRK_PORTAL_SERVICE_NAME = 'SirkPortal'; SIRK_PORTAL_HEALTH_URL = 'https://127.0.0.1/login'; SIRK_DATA_ROOT = $DataRoot }
        Install-WinSwService -ServiceName 'SirkPortalWatchdog' -DisplayName 'SIRK Portal Watchdog' -Description 'Monitors and automatically recovers SIRK Portal.' -Executable $node -Arguments ('"' + $watchdogScript + '"') -WorkingDirectory $PortalRoot -Environment $watchdogEnv -DaemonRoot (Join-Path $WatchdogRoot 'daemon') | Out-Null
        Write-Ok 'SIRK Portal Watchdog installed and running.'
    } else { Write-Warn 'Watchdog script is missing; Watchdog was not installed.' }

    Write-Step 10 $Total 'Verify services and endpoints'
    Wait-Portal $PortalName
    $portalStatus = Get-Service SirkPortal
    $watchdogStatus = Get-Service SirkPortalWatchdog -ErrorAction SilentlyContinue
    $portalUrl = "https://$PortalName/login"
    $breakGlassUrl = "https://$PortalName/login?access=$accessToken"
    $statusUrl = "https://$PortalName/api/system/status"
    try { Set-Clipboard -Value $portalUrl } catch { Write-Warn 'Could not copy Portal URL to clipboard.' }

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host ' INSTALLATION COMPLETED' -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host 'Portal service:' -ForegroundColor White
    Write-Host ("  {0}" -f $portalStatus.Status) -ForegroundColor Green
    Write-Host 'Watchdog service:' -ForegroundColor White
    Write-Host ("  {0}" -f $(if ($watchdogStatus) { $watchdogStatus.Status } else { 'Not installed' })) -ForegroundColor $(if ($watchdogStatus) { 'Green' } else { 'Yellow' })
    Write-Host 'Portal URL (copied to clipboard):' -ForegroundColor White
    Write-Host "  $portalUrl" -ForegroundColor Cyan
    Write-Host 'Break-Glass URL (save securely):' -ForegroundColor White
    Write-Host "  $breakGlassUrl" -ForegroundColor Yellow
    Write-Host 'System status:' -ForegroundColor White
    Write-Host "  $statusUrl" -ForegroundColor Cyan
    Write-Host 'Installation time:' -ForegroundColor White
    Write-Host ('  ' + ((Get-Date) - $Started).ToString('hh\:mm\:ss')) -ForegroundColor Green
    Write-Host 'SIRK_PORTAL_INSTALL_V2_OK' -ForegroundColor Green
}
finally {
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
    if ($password) { $password = $null }
    if ($passwordAgain) { $passwordAgain = $null }
}
