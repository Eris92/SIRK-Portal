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

    Write-Host ''
    Write-Host 'SIRK_PORTAL_INSTALLATION_READY'
    Write-Host "Portal URL: https://$portalName/"
    Write-Host "Break-Glass URL: https://$portalName/login?access=$accessToken"
    Write-Host 'Save the Break-Glass URL outside the Portal. The access token is not stored in plaintext.'
}
finally {
    Remove-Item $core -Force -ErrorAction SilentlyContinue
}
