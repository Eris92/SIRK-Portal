#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [ValidateSet('preview','stable')]
    [string]$Channel = 'preview',
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [int]$HttpsPort = 443,
    [string]$BootstrapUserName = 'admin',
    [string]$PortalFqdn = '',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$NonInteractive,
    [switch]$RemoveData,
    [switch]$SkipUpdater
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$PortalReleaseRepository = 'Eris92/SIRK-Portal'
$PortalReleaseKeyId = 'sirk-release-2026-08-v1'
$PortalReleasePublicKeySha256 = '3dad6ad58afe0e56c3f6f3a4b55a922017450cfb7e12ab6718bd86a237e48562'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Step {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-UrlSafeToken {
    param([int]$Bytes = 48)
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Test-DnsName {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value.Length -gt 253 -or $Value -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$') { return $false }
    foreach ($label in $Value.Split('.')) {
        if ($label.Length -lt 1 -or $label.Length -gt 63 -or $label.StartsWith('-') -or $label.EndsWith('-')) { return $false }
    }
    return $true
}

function Add-LocalHostsEntry {
    param([Parameter(Mandatory)][string]$DnsName)
    $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $escaped = [regex]::Escape($DnsName)
    $existing = Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue
    if ($existing -match "(?im)^\s*(?:127\.0\.0\.1|::1)\s+.*\b$escaped\b") { return }
    Add-Content -LiteralPath $hostsPath -Value "`r`n127.0.0.1`t$DnsName`t# SIRK Portal local test" -Encoding ASCII
}

function Remove-ServiceCompletely {
    param([Parameter(Mandatory)][string]$Name)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    try { $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } catch {}
    & sc.exe delete $Name | Out-Null
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Service $Name is pending deletion. Restart Windows and retry the installation."
}

function Get-SystemDotNetPath { return (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe') }

function Get-InstalledDotNetRuntimes {
    $dotnetPath = Get-SystemDotNetPath
    if (-not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) { return @() }
    $lines = @(& $dotnetPath --list-runtimes 2>$null)
    if ($LASTEXITCODE -ne 0) { return @() }
    return $lines
}

function Test-DotNet10Runtime {
    param([Parameter(Mandatory)][string]$RuntimeName)
    return [bool](Get-InstalledDotNetRuntimes | Where-Object {
        $_ -match ('^' + [regex]::Escape($RuntimeName) + ' 10\.0\.')
    })
}

function Install-DotNet10Component {
    param(
        [Parameter(Mandatory)][string]$DisplayName,
        [Parameter(Mandatory)][string]$MetadataProperty,
        [Parameter(Mandatory)][string]$RuntimeName,
        [Parameter(Mandatory)][string]$DownloadRoot
    )
    if (Test-DotNet10Runtime -RuntimeName $RuntimeName) {
        Write-Host "$DisplayName is already installed." -ForegroundColor DarkGreen
        return
    }
    $metadata = Invoke-RestMethod -UseBasicParsing -Uri 'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json'
    $latestRelease = [string]$metadata.'latest-release'
    $release = @($metadata.releases | Where-Object { [string]$_.'release-version' -eq $latestRelease } | Select-Object -First 1)
    if ($release.Count -ne 1) { throw "Unable to find .NET 10 release metadata for $latestRelease." }
    $componentProperty = $release[0].PSObject.Properties[$MetadataProperty]
    if (-not $componentProperty -or -not $componentProperty.Value) { throw "The .NET 10 metadata does not contain component: $MetadataProperty" }
    $component = $componentProperty.Value
    $installerAsset = @($component.files | Where-Object { $_.rid -eq 'win-x64' -and $_.name -match '\.exe$' } | Select-Object -First 1)
    if ($installerAsset.Count -ne 1) { throw "Unable to find the win-x64 installer for $DisplayName." }
    New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null
    $installerPath = Join-Path $DownloadRoot $installerAsset[0].name
    Invoke-WebRequest -UseBasicParsing -Uri $installerAsset[0].url -OutFile $installerPath
    $expectedHash = ([string]$installerAsset[0].hash).Trim().ToLowerInvariant()
    if ($expectedHash) {
        $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA512).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) { throw "Invalid SHA-512 for $DisplayName installer." }
    }
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/install','/quiet','/norestart') -Wait -PassThru
    if ($process.ExitCode -notin @(0,1641,3010)) { throw "$DisplayName installation failed. ExitCode=$($process.ExitCode)" }
    if (-not (Test-DotNet10Runtime -RuntimeName $RuntimeName)) { throw "$DisplayName was not detected after installation." }
}

function Ensure-SystemDotNet10 {
    param([Parameter(Mandatory)][string]$DownloadRoot)
    Write-Step 'Ensuring shared .NET 10 runtimes'
    Install-DotNet10Component -DisplayName 'Microsoft .NET Runtime 10 x64' -MetadataProperty 'runtime' -RuntimeName 'Microsoft.NETCore.App' -DownloadRoot $DownloadRoot
    Install-DotNet10Component -DisplayName 'Microsoft ASP.NET Core Runtime 10 x64' -MetadataProperty 'aspnetcore-runtime' -RuntimeName 'Microsoft.AspNetCore.App' -DownloadRoot $DownloadRoot
    $dotnetPath = Get-SystemDotNetPath
    if (-not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) { throw 'System dotnet.exe was not found after runtime installation.' }
    $env:PATH = (Split-Path -Parent $dotnetPath) + ';' + $env:PATH
}

function Ensure-PortalEventLogSource {
    param([string]$SourceName = 'Sirk.Portal')
    if ([System.Diagnostics.EventLog]::SourceExists($SourceName)) { return }
    [System.Diagnostics.EventLog]::CreateEventSource($SourceName, 'Application')
    if (-not [System.Diagnostics.EventLog]::SourceExists($SourceName)) { throw "Unable to create Windows Event Log source: $SourceName" }
}

function Get-PemSha256 {
    param([Parameter(Mandatory)][string]$Pem)
    $normalized = $Pem.Replace("`r`n","`n").Trim() + "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized)) }
    finally { $sha.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}

function Resolve-SignedPortalRelease {
    param([Parameter(Mandatory)][string]$ReleaseChannel)
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'SIRK-Portal-Bootstrap' }
    $releases = @(Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri "https://api.github.com/repos/$PortalReleaseRepository/releases?per_page=50")
    $candidates = foreach ($release in $releases) {
        if ($release.draft) { continue }
        if ($ReleaseChannel -eq 'preview' -and -not $release.prerelease) { continue }
        if ($ReleaseChannel -eq 'stable' -and $release.prerelease) { continue }
        $tag = [string]$release.tag_name
        if ($tag -notmatch '^v(0\.1\.1\.\d+)$') { continue }
        $versionText = $Matches[1]
        $descriptorName = "SIRK-Portal-$versionText-win-x64.update.json"
        $packageName = "SIRK-Portal-$versionText-win-x64.zip"
        $names = @($release.assets | ForEach-Object { [string]$_.name })
        if (-not ($names -contains $descriptorName) -or -not ($names -contains $packageName) -or -not ($names -contains 'release-trusted-keys.json')) { continue }
        [pscustomobject]@{ Release = $release; Version = [version]$versionText; VersionText = $versionText; DescriptorName = $descriptorName; PackageName = $packageName }
    }
    $selected = @($candidates | Sort-Object Version -Descending | Select-Object -First 1)
    if ($selected.Count -ne 1) { throw "No immutable signed Portal $ReleaseChannel release was found." }
    return $selected[0]
}

function Get-VerifiedPortalPayload {
    param(
        [Parameter(Mandatory)][string]$ReleaseChannel,
        [Parameter(Mandatory)][string]$DestinationRoot
    )
    Write-Step 'Downloading immutable signed Portal release'
    $selected = Resolve-SignedPortalRelease -ReleaseChannel $ReleaseChannel
    $release = $selected.Release
    $assetByName = @{}
    foreach ($asset in @($release.assets)) { $assetByName[[string]$asset.name] = $asset }
    $descriptorPath = Join-Path $DestinationRoot $selected.DescriptorName
    $packagePath = Join-Path $DestinationRoot $selected.PackageName
    $keyringPath = Join-Path $DestinationRoot 'release-trusted-keys.json'
    $payloadRoot = Join-Path $DestinationRoot 'payload'
    New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$assetByName[$selected.DescriptorName].browser_download_url) -OutFile $descriptorPath
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$assetByName[$selected.PackageName].browser_download_url) -OutFile $packagePath
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$assetByName['release-trusted-keys.json'].browser_download_url) -OutFile $keyringPath

    $keyring = Get-Content -LiteralPath $keyringPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $keys = @($keyring.keys)
    if ($keys.Count -ne 1 -or [string]$keys[0].keyId -cne $PortalReleaseKeyId -or [string]$keys[0].publicKeyPem -notmatch 'BEGIN PUBLIC KEY') {
        throw 'Portal bootstrap release trust root is invalid.'
    }
    if ((Get-PemSha256 -Pem ([string]$keys[0].publicKeyPem)) -cne $PortalReleasePublicKeySha256) {
        throw 'Portal bootstrap release trust root fingerprint is not pinned.'
    }

    $descriptor = Get-Content -LiteralPath $descriptorPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$descriptor.schemaVersion -ne 1 -or
        [string]$descriptor.applicationId -cne 'sirk-portal' -or
        [string]$descriptor.product -cne 'SIRK Portal' -or
        [string]$descriptor.version -cne $selected.VersionText -or
        [string]$descriptor.runtime -cne 'win-x64' -or
        [string]$descriptor.channel -cne $ReleaseChannel -or
        [string]$descriptor.assetName -cne $selected.PackageName -or
        [string]$descriptor.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
        [string]$descriptor.commit -notmatch '^[A-Fa-f0-9]{40}$' -or
        [long]$descriptor.size -lt 1024 -or [long]$descriptor.size -gt 268435456 -or
        [string]$descriptor.signature.algorithm -cne 'ES256' -or
        [string]$descriptor.signature.keyId -cne $PortalReleaseKeyId) {
        throw 'Portal signed release descriptor metadata is invalid.'
    }
    $package = Get-Item -LiteralPath $packagePath
    if ($package.Length -ne [long]$descriptor.size) { throw 'Portal package size does not match the signed descriptor.' }
    $actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -cne ([string]$descriptor.sha256).ToLowerInvariant()) { throw 'Portal package SHA-256 does not match the signed descriptor.' }

    Expand-Archive -LiteralPath $packagePath -DestinationPath $payloadRoot -Force
    $verifier = Join-Path $payloadRoot 'Sirk.Portal.exe'
    if (-not (Test-Path -LiteralPath $verifier -PathType Leaf)) { throw 'Portal bootstrap payload verifier is missing.' }
    & $verifier --verify-update-payload $payloadRoot --trusted-keys $keyringPath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Signed Portal bootstrap payload verification failed.' }
    if (Test-Path -LiteralPath (Join-Path $payloadRoot 'appsettings.Production.json')) { throw 'Public Portal release must not contain appsettings.Production.json.' }
    foreach ($forbidden in @('coreclr.dll','hostfxr.dll','hostpolicy.dll','clrjit.dll','System.Private.CoreLib.dll')) {
        if (Test-Path -LiteralPath (Join-Path $payloadRoot $forbidden)) { throw "Portal release contains a private .NET runtime file: $forbidden" }
    }
    $releaseManifest = Get-Content -LiteralPath (Join-Path $payloadRoot 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$releaseManifest.applicationId -cne 'sirk-portal' -or
        [string]$releaseManifest.version -cne $selected.VersionText -or
        [string]$releaseManifest.runtime -cne 'win-x64' -or
        [string]$releaseManifest.commit -cne [string]$descriptor.commit) {
        throw 'Portal release manifest does not match the signed release descriptor.'
    }
    return [pscustomobject]@{ Descriptor = $descriptor; PayloadRoot = $payloadRoot; PackageHash = $actualHash; Version = $selected.VersionText }
}

if (-not (Test-Administrator)) { throw 'Run PowerShell as Administrator.' }
if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) { throw 'Invalid HTTPS port.' }
if ($TrustCertificate -and $DoNotTrustCertificate) { throw 'TrustCertificate and DoNotTrustCertificate cannot be used together.' }
$existingIdentity = Join-Path $DataRoot 'identity.json'
if ((Test-Path -LiteralPath $existingIdentity -PathType Leaf) -and -not $RemoveData) {
    throw 'Existing Portal data detected. Runtime updates must use Portal Maintenance -> SIRK Central -> SIRK Updater.'
}

$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($PortalFqdn)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_FQDN)) { $PortalFqdn = $env:SIRK_INSTALL_FQDN }
    elseif ($NonInteractive) { $PortalFqdn = $defaultFqdn }
    else { $PortalFqdn = Read-Host "Portal DNS name [$defaultFqdn]" }
}
$portalFqdn = $PortalFqdn.Trim().ToLowerInvariant()
if (-not $portalFqdn) { $portalFqdn = $defaultFqdn }
if (-not (Test-DnsName -Value $portalFqdn)) { throw 'Invalid Portal DNS name.' }

$plainPassword = $null
if (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {
    $plainPassword = $env:SIRK_INSTALL_BREAKGLASS_PASSWORD
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
}
elseif ($NonInteractive) { throw 'Set SIRK_INSTALL_BREAKGLASS_PASSWORD when using NonInteractive mode.' }
else {
    $password1 = Read-Host 'Break-Glass administrator password (minimum 14 characters)' -AsSecureString
    $password2 = Read-Host 'Repeat password' -AsSecureString
    $plain1 = ConvertFrom-SecureStringPlain -Value $password1
    $plain2 = ConvertFrom-SecureStringPlain -Value $password2
    try { if ($plain1 -cne $plain2) { throw 'Passwords do not match.' }; $plainPassword = $plain1 }
    finally { $plain1 = $null; $plain2 = $null }
}
if ([string]::IsNullOrWhiteSpace($plainPassword) -or $plainPassword.Length -lt 14) { throw 'Break-Glass password must contain at least 14 characters.' }

if ($TrustCertificate) { $trustCertificateValue = $true }
elseif ($DoNotTrustCertificate) { $trustCertificateValue = $false }
elseif (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_TRUST_CERTIFICATE)) { $trustCertificateValue = $env:SIRK_INSTALL_TRUST_CERTIFICATE -notmatch '^(0|false|no|n)$' }
elseif ($NonInteractive) { $trustCertificateValue = $true }
else { $trustCertificateValue = ((Read-Host 'Add the Portal certificate to LocalMachine\Root? [Y/n]').Trim().ToLowerInvariant() -notin @('n','no')) }

$commonDataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
if (-not $commonDataRoot) { throw 'Unable to determine ProgramData.' }
$workRoot = Join-Path (Join-Path $commonDataRoot 'SIRK\Temp') ('PortalBinaryInstall-' + [guid]::NewGuid().ToString('N'))
$runtimeDownloadRoot = Join-Path $workRoot 'runtime-installers'
$releaseRoot = Join-Path $workRoot 'release'
$logRoot = 'C:\ProgramData\SIRK\Logs'
$installLog = Join-Path $logRoot 'Portal-Binary-Install.log'
$backupRoot = 'C:\ProgramData\SIRK\Install Backups'
$serviceName = 'SirkPortal'
$health = $null
$pfxPassword = $null
New-Item -ItemType Directory -Path $workRoot,$runtimeDownloadRoot,$releaseRoot,$logRoot,$backupRoot -Force | Out-Null
& icacls.exe $workRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
Start-Transcript -Path $installLog -Append | Out-Null

try {
    Ensure-SystemDotNet10 -DownloadRoot $runtimeDownloadRoot
    $release = Get-VerifiedPortalPayload -ReleaseChannel $Channel -DestinationRoot $releaseRoot

    Write-Step 'Installing Portal program files'
    foreach ($name in @('SirkPortal','SirkPortalStandalone','sirkportal.exe','SirkPortalWatchdog','sirkportalwatchdog.exe')) { Remove-ServiceCompletely -Name $name }
    if (Test-Path -LiteralPath $InstallRoot) {
        $backup = Join-Path $backupRoot ('Portal-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Move-Item -LiteralPath $InstallRoot -Destination (Join-Path $backup 'Program') -Force
    }
    if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) { Remove-Item -LiteralPath $DataRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $InstallRoot,$DataRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $release.PayloadRoot '*') -Destination $InstallRoot -Recurse -Force

    Write-Step 'Creating Break-Glass bootstrap credentials'
    $securityRoot = Join-Path $DataRoot 'security'
    New-Item -ItemType Directory -Path $securityRoot -Force | Out-Null
    $passwordFile = Join-Path $securityRoot 'break-glass-password.bootstrap'
    $accessFile = Join-Path $securityRoot 'break-glass-access-code.txt'
    Set-Content -LiteralPath $passwordFile -Value $plainPassword -Encoding UTF8 -NoNewline
    $accessCode = New-UrlSafeToken -Bytes 48
    Set-Content -LiteralPath $accessFile -Value $accessCode -Encoding ASCII -NoNewline

    Write-Step 'Creating HTTPS certificate'
    $tlsRoot = Join-Path $DataRoot 'TLS'
    New-Item -ItemType Directory -Path $tlsRoot -Force | Out-Null
    $pfxPath = Join-Path $tlsRoot 'portal.pfx'
    $cerPath = Join-Path $tlsRoot 'portal.cer'
    $pfxPassword = New-UrlSafeToken -Bytes 48
    $securePfxPassword = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
    $dnsNames = @($portalFqdn,$env:COMPUTERNAME,($env:COMPUTERNAME + '.local'),'localhost') | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique
    Get-ChildItem 'Cert:\LocalMachine\My' | Where-Object FriendlyName -eq 'SIRK Portal HTTPS' | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem 'Cert:\LocalMachine\Root' | Where-Object FriendlyName -eq 'SIRK Portal HTTPS' | Remove-Item -Force -ErrorAction SilentlyContinue
    $certificate = New-SelfSignedCertificate -Subject "CN=$portalFqdn" -DnsName $dnsNames `
        -CertStoreLocation 'Cert:\LocalMachine\My' -FriendlyName 'SIRK Portal HTTPS' `
        -NotBefore (Get-Date).AddMinutes(-5) -NotAfter (Get-Date).AddYears(3) `
        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1')
    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePfxPassword -Force | Out-Null
    Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT -Force | Out-Null
    if ($trustCertificateValue) {
        if (-not (Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\Root')) { throw 'Unable to add the Portal certificate to LocalMachine\Root.' }
    }
    Add-LocalHostsEntry -DnsName $portalFqdn

    Write-Step 'Writing machine configuration'
    $publicUrl = if ($HttpsPort -eq 443) { "https://$portalFqdn" } else { "https://$portalFqdn`:$HttpsPort" }
    $localOrigin = if ($HttpsPort -eq 443) { 'https://localhost/' } else { "https://localhost`:$HttpsPort/" }
    $appSettings = @{
        Logging = @{ LogLevel = @{ Default = 'Information'; 'Microsoft.AspNetCore' = 'Warning' } }
        AllowedHosts = '*'
        Kestrel = @{ Endpoints = @{ Https = @{ Url = "https://0.0.0.0:$HttpsPort"; Certificate = @{ Path = $pfxPath; Password = $pfxPassword } } } }
        Sirk = @{
            DataRoot = $DataRoot
            ReverseProxy = @{ TrustAll = $false }
            Security = @{ Enabled = $true; SessionMinutes = 30; LoginAttemptsPerFiveMinutes = 8; BootstrapUserName = $BootstrapUserName; BootstrapDisplayName = 'Administrator'; BootstrapPasswordFile = $passwordFile; BootstrapAccessCodeFile = $accessFile }
            Central = @{ Enabled = $false; BaseUrl = ''; PortalId = ''; PortalName = $env:COMPUTERNAME; PortalToken = ''; PublicUrl = $publicUrl; UpdateChannel = $Channel; HeartbeatIntervalSeconds = 60; RequestTimeoutSeconds = 15; ConnectionFile = '' }
            CentralTunnel = @{ Enabled = $true; LocalOrigin = $localOrigin; PollIntervalMilliseconds = 750; MaximumConcurrency = 8; MaximumBodyBytes = 8388608 }
        }
    }
    $productionSettings = Join-Path $InstallRoot 'appsettings.Production.json'
    $appSettings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $productionSettings -Encoding UTF8
    & icacls.exe $DataRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
    & icacls.exe $productionSettings /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null

    Write-Step 'Registering Windows service and firewall'
    Ensure-PortalEventLogSource -SourceName 'Sirk.Portal'
    $installedExe = Join-Path $InstallRoot 'Sirk.Portal.exe'
    New-Service -Name $serviceName -BinaryPathName ('"' + $installedExe + '"') -DisplayName 'SIRK Portal' -StartupType Automatic | Out-Null
    & sc.exe description $serviceName 'SIRK Portal ASP.NET Core / shared .NET 10 runtime service' | Out-Null
    & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" -Name Environment -PropertyType MultiString -Value @('ASPNETCORE_ENVIRONMENT=Production','DOTNET_CLI_TELEMETRY_OPTOUT=1','DOTNET_NOLOGO=1') -Force | Out-Null
    $firewallName = 'SIRK Portal HTTPS'
    $firewallConfigured = $false
    try {
        Remove-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpsPort -Profile Domain,Private -ErrorAction Stop | Out-Null
        $firewallConfigured = $true
    }
    catch {
        & netsh.exe advfirewall firewall delete rule name="$firewallName" | Out-Null
        & netsh.exe advfirewall firewall add rule name="$firewallName" dir=in action=allow protocol=TCP localport=$HttpsPort profile=domain,private enable=yes | Out-Null
        if ($LASTEXITCODE -eq 0) { $firewallConfigured = $true }
    }
    if (-not $firewallConfigured) { Write-Warning "Unable to create firewall rule for TCP/$HttpsPort." }
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    Write-Step 'Validating health and full frontend'
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $raw = & curl.exe -sS --max-time 5 "$publicUrl/healthz"
            if ($LASTEXITCODE -eq 0 -and $raw) { $health = $raw | ConvertFrom-Json; if ($health.status -eq 'healthy') { break } }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or $health.status -ne 'healthy') { throw 'Portal did not pass health check.' }
    $ready = (& curl.exe -sS --max-time 10 "$publicUrl/readyz") | ConvertFrom-Json
    if ($ready.status -ne 'ready') { throw 'Portal did not pass readiness check.' }
    $loginHtml = (& curl.exe -sS --max-time 10 "$publicUrl/login" | Out-String)
    if ($loginHtml -notmatch 'sirk-login-page' -or $loginHtml -notmatch '/assets/portal-login.css') { throw 'Portal login frontend is incomplete.' }
    if (-not (Test-Path -LiteralPath (Join-Path $DataRoot 'identity.json') -PathType Leaf)) { throw 'Break-Glass identity was not initialized.' }
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue

    if (-not $SkipUpdater) {
        Write-Step 'Installing and registering SIRK Updater'
        $updaterScript = Join-Path $workRoot 'Ensure-SirkUpdater.ps1'
        Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/tools/installer/Ensure-SirkUpdater.ps1?nocache=' + [guid]::NewGuid()) -OutFile $updaterScript
        & $updaterScript -PortalServiceName 'SirkPortal' -InstallPath $InstallRoot -DataPath $DataRoot -HealthUrl "https://localhost:$HttpsPort/readyz" -Channel $Channel
        if ($LASTEXITCODE -ne 0) { throw "SIRK Updater setup failed. ExitCode=$LASTEXITCODE" }
        $updater = Get-Service -Name SirkUpdater -ErrorAction Stop
        if ($updater.Status -ne 'Running') { throw 'SIRK Updater is not running.' }
    }

    $accessUrl = "$publicUrl/login#access=$accessCode"
    Write-Host ''
    Write-Host 'SIRK_PORTAL_BINARY_INSTALL_OK' -ForegroundColor Green
    Write-Host "Release version: $($release.Version)" -ForegroundColor DarkGreen
    Write-Host "Release commit: $($release.Descriptor.commit)" -ForegroundColor DarkGreen
    Write-Host "Package SHA-256: $($release.PackageHash)" -ForegroundColor DarkGreen
    Write-Host "URL: $publicUrl/login" -ForegroundColor Cyan
    Write-Host "Access URL: $accessUrl" -ForegroundColor Yellow
    Write-Host "Access Code file: $accessFile" -ForegroundColor DarkYellow
    Write-Host "Certificate: $($certificate.Thumbprint)" -ForegroundColor Cyan
    Write-Host "Install log: $installLog"
    if (-not $NonInteractive) { Start-Process $accessUrl }
}
catch {
    Write-Host "`nBinary installation failed: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    $plainPassword = $null
    $pfxPassword = $null
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
    try { Stop-Transcript | Out-Null } catch {}
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
