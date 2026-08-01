#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallPath,
    [string]$DataPath = "$env:ProgramData\SIRK\Portal",
    [ValidateRange(1, 65535)][int]$HttpsPort = 443,
    [int]$InternalPort = 9080
)
$ErrorActionPreference = 'Stop'
$serviceId = 'SirkPortalStandalone'
$wrapper = Join-Path $InstallPath 'server\daemon\sirkportal.exe'
$xml = Join-Path $InstallPath 'server\daemon\sirkportal.xml'
$node = Join-Path $InstallPath 'runtime\node.exe'
$server = Join-Path $InstallPath 'server\standalone-https.js'
foreach ($required in @($wrapper, $node, $server)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Brak wymaganego pliku: $required" }
}
New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
$tls = Join-Path $DataPath 'TLS'
New-Item -ItemType Directory -Path $tls -Force | Out-Null
$tokenFile = Join-Path $DataPath 'agent-enrollment-token.txt'
if (-not (Test-Path -LiteralPath $tokenFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes) | Set-Content -LiteralPath $tokenFile -Encoding ASCII
}
$pfx = Join-Path $tls 'portal.pfx'
$passwordFile = Join-Path $tls 'portal-pfx-password.txt'
if (-not (Test-Path -LiteralPath $pfx)) {
    $passwordBytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
    $password = [Convert]::ToBase64String($passwordBytes)
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    $dns = @($env:COMPUTERNAME, 'localhost') | Select-Object -Unique
    $cert = New-SelfSignedCertificate -DnsName $dns -CertStoreLocation 'Cert:\LocalMachine\My' `
        -FriendlyName 'SIRK Portal TLS' -NotAfter (Get-Date).AddYears(3) `
        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
    $password | Set-Content -LiteralPath $passwordFile -Encoding ASCII
}
& icacls.exe $DataPath /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nie ustawiono bezpiecznych ACL katalogu danych Portalu.' }
$escapedInstall = [Security.SecurityElement]::Escape($InstallPath)
$escapedData = [Security.SecurityElement]::Escape($DataPath)
@"
<service>
  <id>$serviceId</id>
  <name>SIRK Portal</name>
  <description>SIRK Management Portal HTTPS service</description>
  <executable>$escapedInstall\runtime\node.exe</executable>
  <argument>$escapedInstall\server\standalone-https.js</argument>
  <workingdirectory>$escapedInstall</workingdirectory>
  <logpath>$escapedData\Logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="15 sec"/>
  <stoptimeout>30 sec</stoptimeout>
  <env name="NODE_ENV" value="production"/>
  <env name="SIRK_DATA_ROOT" value="$escapedData"/>
  <env name="SIRK_INTERNAL_PORT" value="$InternalPort"/>
  <env name="SIRK_HTTPS_PORT" value="$HttpsPort"/>
  <env name="SIRK_TLS_PFX" value="$escapedData\TLS\portal.pfx"/>
  <env name="SIRK_TLS_PFX_PASSWORD_FILE" value="$escapedData\TLS\portal-pfx-password.txt"/>
  <env name="SIRK_ENROLLMENT_TOKEN_FILE" value="$escapedData\agent-enrollment-token.txt"/>
</service>
"@ | Set-Content -LiteralPath $xml -Encoding UTF8
$existing = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne 'Stopped') { & $wrapper stop | Out-Null }
    & $wrapper uninstall | Out-Null
}
$legacy = Get-Service -Name 'sirkportal.exe' -ErrorAction SilentlyContinue
if ($legacy) {
    if ($legacy.Status -ne 'Stopped') {
        Stop-Service -Name 'sirkportal.exe' -Force
        $legacy.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    & sc.exe delete 'sirkportal.exe' | Out-Null
}
& $wrapper install | Out-Null
& $wrapper start | Out-Null
(Get-Service -Name $serviceId).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
$firewallRule = 'SIRK Portal HTTPS'
& netsh.exe advfirewall firewall delete rule name="$firewallRule" dir=in | Out-Null
& netsh.exe advfirewall firewall add rule name="$firewallRule" dir=in action=allow `
    protocol=TCP localport=$HttpsPort program="$node" profile=domain,private | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nie skonfigurowano reguły Zapory Windows dla HTTPS Portalu.' }
Write-Host "SIRK Portal działa pod adresem https://$($env:COMPUTERNAME):$HttpsPort/" -ForegroundColor Green
