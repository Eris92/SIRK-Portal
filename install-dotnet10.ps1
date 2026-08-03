[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [int]$HttpsPort = 443,
    [string]$BootstrapUserName = 'admin',
    [string]$PortalFqdn = '',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$NonInteractive,
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function ConvertFrom-SecureStringPlain([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-UrlSafeToken([int]$Bytes = 48) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Remove-ServiceCompletely([string]$Name) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    try { $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } catch {}
    & sc.exe delete $Name | Out-Null
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Usługa $Name oczekuje na usunięcie. Uruchom Windows ponownie i ponów instalację."
}

function Test-DnsName([string]$Value) {
    if ($Value.Length -gt 253 -or $Value -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$') { return $false }
    foreach ($label in $Value.Split('.')) {
        if ($label.Length -lt 1 -or $label.Length -gt 63 -or $label.StartsWith('-') -or $label.EndsWith('-')) { return $false }
    }
    return $true
}

function Add-LocalHostsEntry([string]$DnsName) {
    $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $escaped = [regex]::Escape($DnsName)
    $existing = Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue
    if ($existing -match "(?im)^\s*(?:127\.0\.0\.1|::1)\s+.*\b$escaped\b") { return }
    Add-Content -LiteralPath $hostsPath -Value "`r`n127.0.0.1`t$DnsName`t# SIRK Portal local test" -Encoding ASCII
}

function Get-SystemDotNetPath {
    return (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe')
}

function Get-InstalledDotNetRuntimes {
    $dotnetPath = Get-SystemDotNetPath
    if (-not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) { return @() }
    $lines = @(& $dotnetPath --list-runtimes 2>$null)
    if ($LASTEXITCODE -ne 0) { return @() }
    return $lines
}

function Test-DotNet10Runtime([string]$RuntimeName) {
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

    if (Test-DotNet10Runtime $RuntimeName) {
        Write-Host "$DisplayName jest już zainstalowany." -ForegroundColor DarkGreen
        return
    }

    $metadataUrl = 'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json'
    $metadata = Invoke-RestMethod -UseBasicParsing -Uri $metadataUrl
    $latestRelease = [string]$metadata.'latest-release'
    $release = @($metadata.releases | Where-Object {
        [string]$_.'release-version' -eq $latestRelease
    } | Select-Object -First 1)
    if ($release.Count -ne 1) {
        throw "Nie można odnaleźć metadanych .NET 10 release $latestRelease."
    }

    $componentProperty = $release[0].PSObject.Properties[$MetadataProperty]
    if (-not $componentProperty -or -not $componentProperty.Value) {
        throw "Metadane .NET 10 nie zawierają komponentu: $MetadataProperty"
    }
    $component = $componentProperty.Value
    $installerAsset = @($component.files | Where-Object {
        $_.rid -eq 'win-x64' -and $_.name -match '\.exe$'
    } | Select-Object -First 1)
    if ($installerAsset.Count -ne 1) {
        throw "Nie można odnaleźć instalatora win-x64 dla $DisplayName."
    }

    New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null
    $installerPath = Join-Path $DownloadRoot $installerAsset[0].name
    Write-Host "Pobieranie $DisplayName $($component.version)..." -ForegroundColor DarkCyan
    Invoke-WebRequest -UseBasicParsing -Uri $installerAsset[0].url -OutFile $installerPath

    $expectedHash = ([string]$installerAsset[0].hash).Trim().ToLowerInvariant()
    if (-not [string]::IsNullOrWhiteSpace($expectedHash)) {
        $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA512).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Nieprawidłowy SHA-512 instalatora $DisplayName."
        }
    }

    $process = Start-Process -FilePath $installerPath -ArgumentList @('/install','/quiet','/norestart') -Wait -PassThru
    if ($process.ExitCode -notin @(0, 1641, 3010)) {
        throw "Instalacja $DisplayName nie powiodła się. ExitCode=$($process.ExitCode)"
    }
    if (-not (Test-DotNet10Runtime $RuntimeName)) {
        throw "$DisplayName nie został wykryty po instalacji."
    }
}

function Ensure-SystemDotNet10([string]$DownloadRoot) {
    Write-Step 'Instalacja współdzielonego .NET 10 Runtime'
    Install-DotNet10Component `
        -DisplayName 'Microsoft .NET Runtime 10 x64' `
        -MetadataProperty 'runtime' `
        -RuntimeName 'Microsoft.NETCore.App' `
        -DownloadRoot $DownloadRoot
    Install-DotNet10Component `
        -DisplayName 'Microsoft ASP.NET Core Runtime 10 x64' `
        -MetadataProperty 'aspnetcore-runtime' `
        -RuntimeName 'Microsoft.AspNetCore.App' `
        -DownloadRoot $DownloadRoot

    $dotnetPath = Get-SystemDotNetPath
    if (-not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) {
        throw 'Systemowy dotnet.exe nie został odnaleziony.'
    }
    $env:PATH = (Split-Path -Parent $dotnetPath) + ';' + $env:PATH

    $blockMu = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\.NET' -Name BlockMU -ErrorAction SilentlyContinue).BlockMU
    if ($blockMu -eq 1) {
        Write-Warning 'Aktualizacje .NET przez Microsoft Update są zablokowane kluczem HKLM\SOFTWARE\Microsoft\.NET\BlockMU.'
    }

    Get-InstalledDotNetRuntimes |
        Where-Object { $_ -match '^(Microsoft\.NETCore\.App|Microsoft\.AspNetCore\.App) 10\.0\.' } |
        ForEach-Object { Write-Host "Runtime: $_" -ForegroundColor DarkGreen }
}

if (-not (Test-Administrator)) { throw 'Uruchom PowerShell jako Administrator.' }
if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) { throw 'Port HTTPS jest nieprawidłowy.' }
if ($TrustCertificate -and $DoNotTrustCertificate) { throw 'Nie można jednocześnie włączyć i wyłączyć zaufania certyfikatu.' }

$serviceName = 'SirkPortal'
$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($PortalFqdn)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_FQDN)) {
        $PortalFqdn = $env:SIRK_INSTALL_FQDN
    }
    elseif ($NonInteractive) {
        $PortalFqdn = $defaultFqdn
    }
    else {
        $PortalFqdn = Read-Host "Nazwa DNS Portalu [$defaultFqdn]"
    }
}
$portalFqdn = $PortalFqdn.Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($portalFqdn)) { $portalFqdn = $defaultFqdn }
if (-not (Test-DnsName $portalFqdn)) { throw 'Nazwa DNS Portalu jest nieprawidłowa.' }

$plain1 = $null
$plain2 = $null
if (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {
    $plain1 = $env:SIRK_INSTALL_BREAKGLASS_PASSWORD
    $plain2 = $plain1
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
}
elseif ($NonInteractive) {
    throw 'W trybie NonInteractive ustaw zmienną SIRK_INSTALL_BREAKGLASS_PASSWORD.'
}
else {
    $password1 = Read-Host 'Hasło administratora Break-Glass (minimum 14 znaków)' -AsSecureString
    $password2 = Read-Host 'Powtórz hasło' -AsSecureString
    $plain1 = ConvertFrom-SecureStringPlain $password1
    $plain2 = ConvertFrom-SecureStringPlain $password2
}
if ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) { throw 'Hasło musi mieć minimum 14 znaków.' }
if ($plain1 -cne $plain2) { throw 'Hasła nie są identyczne.' }

if ($TrustCertificate) {
    $trustCertificateValue = $true
}
elseif ($DoNotTrustCertificate) {
    $trustCertificateValue = $false
}
elseif (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_TRUST_CERTIFICATE)) {
    $trustCertificateValue = $env:SIRK_INSTALL_TRUST_CERTIFICATE -notmatch '^(0|false|no|n|nie)$'
}
elseif ($NonInteractive) {
    $trustCertificateValue = $true
}
else {
    $trustAnswer = (Read-Host 'Dodać certyfikat Portalu do LocalMachine\Root? [T/n]').Trim().ToLowerInvariant()
    $trustCertificateValue = $trustAnswer -notin @('n','nie','no')
}

$workRoot = Join-Path $env:TEMP ('SIRK-Portal-DotNet10-' + [guid]::NewGuid().ToString('N'))
$sourceZip = Join-Path $workRoot 'source.zip'
$sourceExtract = Join-Path $workRoot 'source'
$publishRoot = Join-Path $workRoot 'publish'
$dotnetRoot = Join-Path $workRoot 'dotnet-sdk'
$runtimeDownloadRoot = Join-Path $workRoot 'runtime-installers'
$dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'
$logRoot = 'C:\ProgramData\SIRK\Logs'
$installLog = Join-Path $logRoot 'Portal-DotNet10-Install.log'
$backupRoot = 'C:\ProgramData\SIRK\Install Backups'
$health = $null
$pfxPassword = $null

New-Item -ItemType Directory -Path $workRoot,$sourceExtract,$publishRoot,$dotnetRoot,$DataRoot,$logRoot,$backupRoot -Force | Out-Null
Start-Transcript -Path $installLog -Append | Out-Null
try {
    Ensure-SystemDotNet10 -DownloadRoot $runtimeDownloadRoot

    Write-Step 'Pobieranie kompletnego SIRK Portal .NET 10'
    $encodedBranch = [Uri]::EscapeDataString($Branch)
    Invoke-WebRequest "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/$encodedBranch" -OutFile $sourceZip -UseBasicParsing
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $sourceExtract -Force
    $source = Get-ChildItem $sourceExtract -Directory | Select-Object -First 1
    if (-not $source) { throw 'Nieprawidłowa struktura archiwum źródłowego.' }
    $project = Join-Path $source.FullName 'src\Sirk.Portal\Sirk.Portal.csproj'
    $globalJsonPath = Join-Path $source.FullName 'global.json'
    if (-not (Test-Path -LiteralPath $project)) { throw "Brak projektu .NET 10: $project" }
    if (-not (Test-Path -LiteralPath $globalJsonPath)) { throw 'Brak global.json.' }

    Write-Step 'Instalacja izolowanego .NET 10 SDK wyłącznie do kompilacji'
    $sdkVersion = (Get-Content -LiteralPath $globalJsonPath -Raw | ConvertFrom-Json).sdk.version
    $dotnetInstall = Join-Path $workRoot 'dotnet-install.ps1'
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $dotnetInstall -UseBasicParsing
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dotnetInstall -Version $sdkVersion -InstallDir $dotnetRoot -NoPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dotnetExe)) {
        throw "Instalacja .NET SDK $sdkVersion nie powiodła się. ExitCode=$LASTEXITCODE"
    }

    Write-Step 'Publikowanie framework-dependent Windows x64'
    & $dotnetExe publish $project --configuration Release --runtime win-x64 --self-contained false --output $publishRoot /p:PublishSingleFile=false /p:DebugType=None /p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish nie powiódł się. ExitCode=$LASTEXITCODE" }
    $publishedExe = Join-Path $publishRoot 'Sirk.Portal.exe'
    foreach ($required in @(
        $publishedExe,
        (Join-Path $publishRoot 'Sirk.Portal.dll'),
        (Join-Path $publishRoot 'Sirk.Portal.runtimeconfig.json'),
        (Join-Path $publishRoot 'public\portal\standalone\index.html'),
        (Join-Path $publishRoot 'public\portal\standalone\login.html'),
        (Join-Path $publishRoot 'public\portal\standalone\scripts\app.js'),
        (Join-Path $publishRoot 'public\portal\standalone\scripts\settings-native-v2.js'),
        (Join-Path $publishRoot 'public\portal\standalone\styles\base.css')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Publish jest niekompletny: $required" }
    }
    foreach ($forbidden in @('coreclr.dll','hostfxr.dll','hostpolicy.dll','clrjit.dll','System.Private.CoreLib.dll')) {
        if (Test-Path -LiteralPath (Join-Path $publishRoot $forbidden)) {
            throw "Publish zawiera prywatną kopię runtime: $forbidden"
        }
    }

    Write-Step 'Usuwanie poprzedniej instalacji'
    foreach ($name in @('SirkPortal','SirkPortalStandalone','sirkportal.exe','SirkPortalWatchdog','sirkportalwatchdog.exe')) {
        Remove-ServiceCompletely $name
    }
    if ((Test-Path -LiteralPath $InstallRoot) -or (Test-Path -LiteralPath $DataRoot)) {
        $backup = Join-Path $backupRoot ('Portal-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        if (Test-Path -LiteralPath $InstallRoot) { Move-Item -LiteralPath $InstallRoot -Destination (Join-Path $backup 'Program') -Force }
        if ((Test-Path -LiteralPath $DataRoot) -and -not $RemoveData) { Move-Item -LiteralPath $DataRoot -Destination (Join-Path $backup 'Data') -Force }
    }
    if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) { Remove-Item -LiteralPath $DataRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $InstallRoot,$DataRoot -Force | Out-Null
    Copy-Item (Join-Path $publishRoot '*') $InstallRoot -Recurse -Force

    Write-Step 'Generowanie poświadczeń Break-Glass'
    $securityRoot = Join-Path $DataRoot 'security'
    New-Item -ItemType Directory -Path $securityRoot -Force | Out-Null
    $passwordFile = Join-Path $securityRoot 'break-glass-password.bootstrap'
    $accessFile = Join-Path $securityRoot 'break-glass-access-code.txt'
    Set-Content -LiteralPath $passwordFile -Value $plain1 -Encoding UTF8 -NoNewline
    $accessCode = New-UrlSafeToken 48
    Set-Content -LiteralPath $accessFile -Value $accessCode -Encoding ASCII -NoNewline

    Write-Step 'Generowanie certyfikatu HTTPS'
    $tlsRoot = Join-Path $DataRoot 'TLS'
    New-Item -ItemType Directory -Path $tlsRoot -Force | Out-Null
    $pfxPath = Join-Path $tlsRoot 'portal.pfx'
    $cerPath = Join-Path $tlsRoot 'portal.cer'
    $pfxPassword = New-UrlSafeToken 48
    $securePfxPassword = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
    $dnsNames = @(
        $portalFqdn,
        $env:COMPUTERNAME,
        ($env:COMPUTERNAME + '.local'),
        'localhost'
    ) | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique
    Get-ChildItem 'Cert:\LocalMachine\My' | Where-Object FriendlyName -eq 'SIRK Portal HTTPS' | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem 'Cert:\LocalMachine\Root' | Where-Object FriendlyName -eq 'SIRK Portal HTTPS' | Remove-Item -Force -ErrorAction SilentlyContinue
    $certificate = New-SelfSignedCertificate -Subject "CN=$portalFqdn" -DnsName $dnsNames `
        -CertStoreLocation 'Cert:\LocalMachine\My' -FriendlyName 'SIRK Portal HTTPS' `
        -NotBefore (Get-Date).AddMinutes(-5) -NotAfter (Get-Date).AddYears(3) `
        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature,KeyEncipherment `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1')
    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePfxPassword -Force | Out-Null
    Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT -Force | Out-Null
    if ($trustCertificateValue) {
        $trusted = Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\Root'
        if (-not $trusted) { throw 'Nie można dodać certyfikatu do Trusted Root.' }
    }
    Add-LocalHostsEntry $portalFqdn

    Write-Step 'Konfiguracja HTTPS i trwałych danych'
    $publicUrl = if ($HttpsPort -eq 443) { "https://$portalFqdn" } else { "https://$portalFqdn`:$HttpsPort" }
    $localOrigin = if ($HttpsPort -eq 443) { 'https://localhost/' } else { "https://localhost`:$HttpsPort/" }
    $appSettings = @{
        Logging = @{ LogLevel = @{ Default = 'Information'; 'Microsoft.AspNetCore' = 'Warning' } }
        AllowedHosts = '*'
        Kestrel = @{ Endpoints = @{ Https = @{ Url = "https://0.0.0.0:$HttpsPort"; Certificate = @{ Path = $pfxPath; Password = $pfxPassword } } } }
        Sirk = @{
            DataRoot = $DataRoot
            ReverseProxy = @{ TrustAll = $false }
            Security = @{
                Enabled = $true
                SessionMinutes = 30
                LoginAttemptsPerFiveMinutes = 8
                BootstrapUserName = $BootstrapUserName
                BootstrapDisplayName = 'Administrator'
                BootstrapPasswordFile = $passwordFile
                BootstrapAccessCodeFile = $accessFile
            }
            Central = @{
                Enabled = $false
                BaseUrl = ''
                PortalId = ''
                PortalName = $env:COMPUTERNAME
                PortalToken = ''
                PublicUrl = $publicUrl
                UpdateChannel = 'dev'
                HeartbeatIntervalSeconds = 60
                RequestTimeoutSeconds = 15
                ConnectionFile = ''
            }
            CentralTunnel = @{
                Enabled = $false
                LocalOrigin = $localOrigin
                PollIntervalMilliseconds = 750
                MaximumConcurrency = 8
                MaximumBodyBytes = 8388608
            }
        }
    }
    $productionSettings = Join-Path $InstallRoot 'appsettings.Production.json'
    $appSettings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $productionSettings -Encoding UTF8

    & icacls.exe $DataRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
    & icacls.exe $productionSettings /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null

    Write-Step 'Rejestracja usługi Windows'
    $installedExe = Join-Path $InstallRoot 'Sirk.Portal.exe'
    $binaryPath = '"' + $installedExe + '"'
    New-Service -Name $serviceName -BinaryPathName $binaryPath -DisplayName 'SIRK Portal' -StartupType Automatic | Out-Null
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
        Write-Warning ('Nie można skonfigurować zapory przez NetSecurity: {0}. Próba netsh.exe.' -f $_.Exception.Message)
        try {
            & netsh.exe advfirewall firewall delete rule name="$firewallName" | Out-Null
            & netsh.exe advfirewall firewall add rule name="$firewallName" dir=in action=allow protocol=TCP localport=$HttpsPort profile=domain,private enable=yes | Out-Null
            if ($LASTEXITCODE -eq 0) { $firewallConfigured = $true }
        }
        catch {
            Write-Warning ('Nie można skonfigurować zapory przez netsh.exe: {0}' -f $_.Exception.Message)
        }
    }
    if (-not $firewallConfigured) {
        Write-Warning "Nie udało się dodać reguły zapory dla TCP/$HttpsPort. Portal będzie działał lokalnie; regułę można dodać później ręcznie."
    }

    Start-Service $serviceName
    (Get-Service $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    Write-Step 'Health, readiness i pełny frontend'
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $raw = & curl.exe -sS --max-time 5 "$publicUrl/healthz"
            if ($LASTEXITCODE -eq 0 -and $raw) {
                $health = $raw | ConvertFrom-Json
                if ($health.status -eq 'healthy') { break }
            }
        } catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or $health.status -ne 'healthy') {
        throw 'Portal nie przeszedł health check. Sprawdź Event Viewer i log instalacji.'
    }
    $readyRaw = & curl.exe -sS --max-time 10 "$publicUrl/readyz"
    $ready = $readyRaw | ConvertFrom-Json
    if ($ready.status -ne 'ready') { throw 'Portal nie przeszedł readiness check.' }
    $loginHtml = (& curl.exe -sS --max-time 10 "$publicUrl/login" | Out-String)
    if ($loginHtml -notmatch 'sirk-login-page' -or $loginHtml -notmatch '/assets/portal-login.css') {
        throw 'Pełny frontend logowania nie został opublikowany.'
    }
    $portalCssStatus = & curl.exe -sS -o NUL -w '%{http_code}' --max-time 10 "$publicUrl/assets/portal-standalone.css"
    if ($portalCssStatus -ne '200') { throw "Frontend CSS nie jest dostępny. HTTP=$portalCssStatus" }
    $settingsStatus = & curl.exe -sS -o NUL -w '%{http_code}' --max-time 10 "$publicUrl/assets/settings.js"
    if ($settingsStatus -ne '200') { throw "Natywne Ustawienia nie są dostępne. HTTP=$settingsStatus" }
    if (-not (Test-Path (Join-Path $DataRoot 'identity.json'))) { throw 'Konto Break-Glass nie zostało zainicjalizowane.' }
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue

    Write-Host "`nSIRK Portal .NET 10 został zainstalowany i przeszedł testy." -ForegroundColor Green
    Write-Host 'Model wdrożenia: framework-dependent (współdzielony, aktualizowany Runtime 10)' -ForegroundColor Green
    Write-Host "URL: $publicUrl/login" -ForegroundColor Cyan
    Write-Host "Login: $BootstrapUserName" -ForegroundColor Cyan
    Write-Host "Access Code: $accessCode" -ForegroundColor Yellow
    Write-Host "Access Code zapisano w: $accessFile" -ForegroundColor DarkYellow
    Write-Host "Certyfikat: $($certificate.Thumbprint)" -ForegroundColor Cyan
    Write-Host "Log instalacji: $installLog"
    if (-not $NonInteractive) { Start-Process "$publicUrl/login" }
}
catch {
    Write-Host "`nInstalacja nie powiodła się: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    $plain1 = $null
    $plain2 = $null
    $pfxPassword = $null
    try { Stop-Transcript | Out-Null } catch {}
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
