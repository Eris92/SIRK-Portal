#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$PortalName = 'portal.sir-k.local'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARNING] $Text" -ForegroundColor Yellow }
function Write-InputRequired([string]$Text) {
    Write-Host "`n[INPUT REQUIRED] $Text" -ForegroundColor Yellow -BackgroundColor DarkBlue
}
function ConvertFrom-SecureStringPlain([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Escape-Xml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }

$portalRoot = 'C:\Program Files\SIRK\Portal'
$dataRoot = 'C:\ProgramData\SIRK\Portal'
$tlsRoot = Join-Path $dataRoot 'TLS'
$pfxPath = Join-Path $tlsRoot 'portal.pfx'
$pfxPasswordPath = Join-Path $tlsRoot 'portal-pfx-password.txt'
$enrollmentTokenPath = Join-Path $dataRoot 'agent-enrollment-token.txt'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$entrypoint = Join-Path $portalRoot 'server\standalone-https.js'
$daemonRoot = Join-Path $portalRoot 'server\daemon'
$serviceExe = Join-Path $daemonRoot 'SirkPortal.exe'
$serviceXml = Join-Path $daemonRoot 'SirkPortal.xml'
$serviceName = 'SirkPortal'

foreach ($required in @($entrypoint, $pfxPath, $pfxPasswordPath, $enrollmentTokenPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required Portal file is missing: $required" }
}

$PortalName = $PortalName.Trim().ToLowerInvariant()
if ($PortalName -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$') {
    throw 'Invalid Portal DNS name.'
}

Write-InputRequired 'Enter the Break-Glass administrator password (minimum 12 characters).'
$passwordSecure = Read-Host 'Break-Glass administrator password' -AsSecureString
Write-InputRequired 'Repeat the Break-Glass administrator password.'
$passwordRepeat = Read-Host 'Repeat password' -AsSecureString
$password = ConvertFrom-SecureStringPlain $passwordSecure
$passwordAgain = ConvertFrom-SecureStringPlain $passwordRepeat
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 12) { throw 'Password must contain at least 12 characters.' }
if ($password -cne $passwordAgain) { throw 'Passwords do not match.' }

Write-Step 'Remove incomplete or legacy Portal services'
foreach ($name in @('SirkPortal','SirkPortalStandalone','sirkportal.exe')) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service) {
        Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
        & sc.exe delete $name | Out-Null
        Start-Sleep -Seconds 2
    }
}

Write-Step 'Install verified WinSW service wrapper'
New-Item -ItemType Directory -Path $daemonRoot -Force | Out-Null
$winswUri = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
Invoke-WebRequest -UseBasicParsing -Uri $winswUri -OutFile $serviceExe
$winswHash = (Get-FileHash -LiteralPath $serviceExe -Algorithm SHA256).Hash.ToUpperInvariant()
if ($winswHash -ne '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA') {
    throw "WinSW SHA-256 verification failed: $winswHash"
}
Write-Ok "WinSW verified: $winswHash"

$pfxPassword = (Get-Content -LiteralPath $pfxPasswordPath -Raw).Trim()
if (-not $pfxPassword) { throw 'TLS PFX password is empty.' }

$xml = @"
<service>
  <id>$serviceName</id>
  <name>SIRK Portal</name>
  <description>SIRK Portal local management and Agent broker.</description>
  <executable>$(Escape-Xml $nodePath)</executable>
  <arguments>--harmony &quot;$(Escape-Xml $entrypoint)&quot;</arguments>
  <workingdirectory>$(Escape-Xml $portalRoot)</workingdirectory>
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
  <env name="SIRK_DATA_ROOT" value="$(Escape-Xml $dataRoot)" />
  <env name="SIRK_SERVICE_NAME" value="$serviceName" />
  <env name="SIRK_TLS_PFX" value="$(Escape-Xml $pfxPath)" />
  <env name="SIRK_TLS_PFX_PASSWORD_FILE" value="$(Escape-Xml $pfxPasswordPath)" />
  <env name="SIRK_ENROLLMENT_TOKEN_FILE" value="$(Escape-Xml $enrollmentTokenPath)" />
  <env name="SIRK_HTTPS_PORT" value="443" />
  <env name="SIRK_INTERNAL_PORT" value="9080" />
  <env name="SIRK_PORTAL_FQDN" value="$(Escape-Xml $PortalName)" />
  <env name="SIRK_PUBLIC_URL" value="https://$(Escape-Xml $PortalName)" />
  <env name="SIRK_LOGIN_USER" value="admin" />
  <env name="SIRK_LOGIN_DISPLAY_NAME" value="Administrator" />
  <env name="SIRK_LOGIN_PASSWORD" value="$(Escape-Xml $password)" />
</service>
"@
Set-Content -LiteralPath $serviceXml -Value $xml -Encoding UTF8

Write-Step 'Register and start SIRK Portal service'
& $serviceExe install
if ($LASTEXITCODE -ne 0) { throw "WinSW service installation failed. ExitCode=$LASTEXITCODE" }
& $serviceExe start
if ($LASTEXITCODE -ne 0) { throw "WinSW service start failed. ExitCode=$LASTEXITCODE" }
(Get-Service -Name $serviceName -ErrorAction Stop).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

Write-Step 'Initialize identity store and verify HTTPS'
$deadline = (Get-Date).AddSeconds(120)
do {
    $httpCode = & curl.exe -k -sS -o NUL -w '%{http_code}' --resolve "$PortalName`:443`:127.0.0.1" "https://$PortalName/login" 2>$null
    if ($httpCode -eq '200') { break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if ($httpCode -ne '200') { throw "Portal readiness failed. HTTP=$httpCode" }

Write-Step 'Remove bootstrap password from service configuration'
& $serviceExe stop | Out-Null
(Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
$xml = $xml -replace '(?m)^\s*<env name="SIRK_LOGIN_(USER|DISPLAY_NAME|PASSWORD)"[^\r\n]*\r?\n?', ''
Set-Content -LiteralPath $serviceXml -Value $xml -Encoding UTF8
& $serviceExe start
if ($LASTEXITCODE -ne 0) { throw "WinSW service restart failed. ExitCode=$LASTEXITCODE" }
(Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

$portalUrl = "https://$PortalName/login"
$statusUrl = "https://$PortalName/api/system/status"
try { Set-Clipboard -Value $portalUrl } catch { Write-Warn 'Could not copy Portal URL to clipboard.' }

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host ' SIRK PORTAL SERVICE REPAIR COMPLETED' -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host 'Portal URL (copied to clipboard):' -ForegroundColor White
Write-Host $portalUrl -ForegroundColor Cyan
Write-Host 'System status:' -ForegroundColor White
Write-Host $statusUrl -ForegroundColor Cyan
Write-Host 'Service:' -ForegroundColor White
Get-Service -Name $serviceName | Format-Table Name, Status, StartType -AutoSize
Write-Host 'IMPORTANT: keep the Break-Glass password in a secure password manager.' -ForegroundColor Yellow
Write-Host 'SIRK_PORTAL_SERVICE_REPAIR_OK' -ForegroundColor Green
