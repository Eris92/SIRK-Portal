[CmdletBinding()]
param(
    [string]$Branch = 'rewrite/dotnet10-clean',
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$ListenUrl = 'http://0.0.0.0:8080',
    [string]$BootstrapUserName = 'admin',
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Uruchom PowerShell jako Administrator.'
}

$serviceName = 'SirkPortal'
$workRoot = Join-Path $env:TEMP ('SIRK-Portal-DotNet10-' + [guid]::NewGuid().ToString('N'))
$sourceZip = Join-Path $workRoot 'source.zip'
$sourceExtract = Join-Path $workRoot 'source'
$publishRoot = Join-Path $workRoot 'publish'
$dotnetRoot = 'C:\Program Files\SIRK\Runtime\DotNet10'
$dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'
$logRoot = 'C:\ProgramData\SIRK\Logs'
$installLog = Join-Path $logRoot 'Portal-DotNet10-Install.log'

function Write-Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function ConvertFrom-SecureStringPlain([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function New-UrlSafeToken([int]$Bytes = 48) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Stop-And-DeleteService([string]$Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    if ($svc.Status -ne 'Stopped') {
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        try { $svc.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30)) } catch {}
    }
    & sc.exe delete $Name | Out-Null
    for ($i=0; $i -lt 60; $i++) {
        if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Usługa $Name oczekuje na usunięcie. Uruchom ponownie Windows i ponów instalację."
}

New-Item -ItemType Directory -Path $workRoot,$sourceExtract,$publishRoot,$DataRoot,$logRoot -Force | Out-Null
Start-Transcript -Path $installLog -Append | Out-Null
try {
    Write-Step 'Dane Break-Glass'
    $password1 = Read-Host 'Hasło administratora Break-Glass (minimum 14 znaków)' -AsSecureString
    $password2 = Read-Host 'Powtórz hasło' -AsSecureString
    $plain1 = ConvertFrom-SecureStringPlain $password1
    $plain2 = ConvertFrom-SecureStringPlain $password2
    if ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) { throw 'Hasło musi mieć minimum 14 znaków.' }
    if ($plain1 -cne $plain2) { throw 'Hasła nie są identyczne.' }

    Write-Step 'Instalacja lokalnego .NET 10 SDK'
    if (-not (Test-Path -LiteralPath $dotnetExe)) {
        New-Item -ItemType Directory -Path $dotnetRoot -Force | Out-Null
        $dotnetInstall = Join-Path $workRoot 'dotnet-install.ps1'
        Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $dotnetInstall -UseBasicParsing
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dotnetInstall -Channel '10.0' -Quality 'preview' -InstallDir $dotnetRoot -NoPath
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $dotnetExe)) {
            throw "Instalacja .NET 10 nie powiodła się. ExitCode=$LASTEXITCODE"
        }
    }
    & $dotnetExe --info | Out-Host

    Write-Step 'Pobieranie kodu SIRK Portal .NET 10'
    $encodedBranch = [Uri]::EscapeDataString($Branch)
    Invoke-WebRequest "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/$encodedBranch" -OutFile $sourceZip -UseBasicParsing
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $sourceExtract -Force
    $source = Get-ChildItem $sourceExtract -Directory | Select-Object -First 1
    if (-not $source) { throw 'Nieprawidłowa struktura archiwum źródłowego.' }
    $project = Join-Path $source.FullName 'src\Sirk.Portal\Sirk.Portal.csproj'
    if (-not (Test-Path -LiteralPath $project)) { throw "Brak projektu .NET 10: $project" }

    Write-Step 'Publikowanie self-contained Windows x64'
    & $dotnetExe publish $project --configuration Release --runtime win-x64 --self-contained true --output $publishRoot /p:PublishSingleFile=false /p:DebugType=None /p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish nie powiódł się. ExitCode=$LASTEXITCODE" }
    $portalExe = Join-Path $publishRoot 'Sirk.Portal.exe'
    if (-not (Test-Path -LiteralPath $portalExe)) { throw "Brak pliku wykonywalnego: $portalExe" }

    Write-Step 'Zatrzymanie poprzedniej instalacji'
    foreach ($name in @('SirkPortal','SirkPortalStandalone','sirkportal.exe','SirkPortalWatchdog','sirkportalwatchdog.exe')) {
        Stop-And-DeleteService $name
    }
    if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) {
        Remove-Item -LiteralPath $DataRoot -Recurse -Force
        New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
    }
    if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Copy-Item (Join-Path $publishRoot '*') $InstallRoot -Recurse -Force

    Write-Step 'Konfiguracja trwałych danych i poświadczeń'
    $securityRoot = Join-Path $DataRoot 'security'
    New-Item -ItemType Directory -Path $securityRoot -Force | Out-Null
    $passwordFile = Join-Path $securityRoot 'break-glass-password.txt'
    $accessFile = Join-Path $securityRoot 'break-glass-access-code.txt'
    Set-Content -LiteralPath $passwordFile -Value $plain1 -Encoding UTF8 -NoNewline
    $accessCode = New-UrlSafeToken 48
    Set-Content -LiteralPath $accessFile -Value $accessCode -Encoding ASCII -NoNewline

    $appSettings = @{
        Logging = @{ LogLevel = @{ Default = 'Information'; 'Microsoft.AspNetCore' = 'Warning' } }
        AllowedHosts = '*'
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
                PublicUrl = ''
                UpdateChannel = 'dev'
                HeartbeatIntervalSeconds = 60
                RequestTimeoutSeconds = 15
                ConnectionFile = ''
            }
            CentralTunnel = @{
                Enabled = $true
                LocalOrigin = 'http://127.0.0.1:8080/'
                PollIntervalMilliseconds = 750
                MaximumConcurrency = 8
                MaximumBodyBytes = 8388608
            }
        }
    }
    $appSettings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $InstallRoot 'appsettings.Production.json') -Encoding UTF8

    & icacls.exe $DataRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

    Write-Step 'Rejestracja usługi Windows'
    $installedExe = Join-Path $InstallRoot 'Sirk.Portal.exe'
    $binPath = '"' + $installedExe + '" --urls "' + $ListenUrl + '"'
    & sc.exe create $serviceName binPath= $binPath start= auto DisplayName= 'SIRK Portal' | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Nie można utworzyć usługi. ExitCode=$LASTEXITCODE" }
    & sc.exe description $serviceName 'SIRK Portal native ASP.NET Core / .NET 10 service' | Out-Null
    & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    Start-Service $serviceName
    (Get-Service $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))

    Write-Step 'Health check'
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8080/healthz' -TimeoutSec 5
            if ($health.status -eq 'healthy') { break }
        } catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $health -or $health.status -ne 'healthy') { throw 'Portal nie przeszedł health check.' }

    Write-Host "`nSIRK Portal .NET 10 został zainstalowany." -ForegroundColor Green
    Write-Host "URL: http://127.0.0.1:8080/login" -ForegroundColor Cyan
    Write-Host "Login: $BootstrapUserName" -ForegroundColor Cyan
    Write-Host "Access code: $accessCode" -ForegroundColor Yellow
    Write-Host "Access code zapisano także w: $accessFile" -ForegroundColor DarkYellow
    Write-Host "Log instalacji: $installLog"
}
finally {
    $plain1 = $null
    $plain2 = $null
    try { Stop-Transcript | Out-Null } catch {}
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
