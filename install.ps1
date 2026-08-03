#Requires -Version 5.1
#Requires -RunAsAdministrator
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
    [switch]$RemoveData,
    [switch]$SkipUpdater
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$workRoot = Join-Path $env:TEMP ('SIRK-Portal-Bootstrap-' + [guid]::NewGuid().ToString('N'))
$sourceZip = Join-Path $workRoot 'source.zip'
$extractRoot = Join-Path $workRoot 'source'

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-Utf8Script {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$Parameters
    )

    $source = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput(
        $source,
        [ref]$tokens,
        [ref]$errors) | Out-Null
    if ($errors.Count) {
        throw ('Błąd składni skryptu {0}: {1}' -f $Path, (($errors | ForEach-Object Message) -join '; '))
    }
    $script = [scriptblock]::Create($source)
    & $script @Parameters
}

$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()
$existingIdentityFile = Join-Path $DataRoot 'identity.json'
$preserveExistingData = -not $RemoveData -and (Test-Path -LiteralPath $existingIdentityFile -PathType Leaf)
$effectiveFqdn = $PortalFqdn.Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($effectiveFqdn)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_FQDN)) {
        $effectiveFqdn = $env:SIRK_INSTALL_FQDN.Trim().ToLowerInvariant()
    }
    elseif ($NonInteractive) {
        $effectiveFqdn = $defaultFqdn
    }
    else {
        $answer = Read-Host "Nazwa DNS Portalu [$defaultFqdn]"
        $effectiveFqdn = if ([string]::IsNullOrWhiteSpace($answer)) {
            $defaultFqdn
        } else {
            $answer.Trim().ToLowerInvariant()
        }
    }
}

if (-not $preserveExistingData -and -not $NonInteractive -and [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {
    $password1 = Read-Host 'Hasło administratora Break-Glass (minimum 14 znaków)' -AsSecureString
    $password2 = Read-Host 'Powtórz hasło' -AsSecureString
    $plain1 = ConvertFrom-SecureStringPlain $password1
    $plain2 = ConvertFrom-SecureStringPlain $password2
    try {
        if ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) {
            throw 'Hasło musi mieć minimum 14 znaków.'
        }
        if ($plain1 -cne $plain2) { throw 'Hasła nie są identyczne.' }
        $env:SIRK_INSTALL_BREAKGLASS_PASSWORD = $plain1
    }
    finally {
        $plain1 = $null
        $plain2 = $null
    }
}

if (-not $NonInteractive -and
    -not $TrustCertificate -and
    -not $DoNotTrustCertificate -and
    [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_TRUST_CERTIFICATE)) {
    $trustAnswer = (Read-Host 'Dodać certyfikat Portalu do LocalMachine\Root? [T/n]').Trim().ToLowerInvariant()
    if ($trustAnswer -in @('n','nie','no')) {
        $DoNotTrustCertificate = $true
    } else {
        $TrustCertificate = $true
    }
}

New-Item -ItemType Directory -Path $workRoot,$extractRoot -Force | Out-Null
try {
    Write-Host "=== SIRK Portal .NET 10 clean installation ===" -ForegroundColor Cyan
    Write-Host "Źródło: Eris92/SIRK-Portal@$Branch" -ForegroundColor DarkCyan
    if ($preserveExistingData) {
        Write-Host "Tryb: aktualizacja programu z zachowaniem $DataRoot" -ForegroundColor DarkGreen
    }

    $encodedBranch = [Uri]::EscapeDataString($Branch)
    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/$encodedBranch" `
        -OutFile $sourceZip
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'Pobrane archiwum repozytorium jest nieprawidłowe.' }

    $installerPath = Join-Path $sourceRoot.FullName 'install-dotnet10.ps1'
    if (-not (Test-Path -LiteralPath $installerPath)) {
        throw "Brak natywnego instalatora .NET 10: $installerPath"
    }

    $parameters = @{
        Branch = $Branch
        InstallRoot = $InstallRoot
        DataRoot = $DataRoot
        HttpsPort = $HttpsPort
        BootstrapUserName = $BootstrapUserName
        PortalFqdn = $effectiveFqdn
        NonInteractive = $true
    }
    if ($TrustCertificate) { $parameters.TrustCertificate = $true }
    if ($DoNotTrustCertificate) { $parameters.DoNotTrustCertificate = $true }
    if ($RemoveData) { $parameters.RemoveData = $true }

    Invoke-Utf8Script -Path $installerPath -Parameters $parameters

    $accessFile = Join-Path $DataRoot 'security\break-glass-access-code.txt'
    if (-not (Test-Path -LiteralPath $accessFile -PathType Leaf)) {
        throw "Brak wygenerowanego Access Code: $accessFile"
    }
    $accessCode = (Get-Content -LiteralPath $accessFile -Raw -Encoding ASCII).Trim()
    if ($accessCode -notmatch '^[A-Za-z0-9_-]{32,256}$') {
        throw 'Wygenerowany Access Code jest nieprawidłowy.'
    }
    $publicUrl = if ($HttpsPort -eq 443) {
        "https://$effectiveFqdn"
    } else {
        "https://$effectiveFqdn`:$HttpsPort"
    }
    $accessUrl = "$publicUrl/login#access=$accessCode"

    Write-Host ''
    Write-Host "Access URL: $accessUrl" -ForegroundColor Yellow

    if (-not $SkipUpdater) {
        $updaterInstaller = Join-Path $sourceRoot.FullName 'tools\installer\Ensure-SirkUpdater.ps1'
        if (-not (Test-Path -LiteralPath $updaterInstaller)) {
            throw "Brak integracji SIRK Updater: $updaterInstaller"
        }
        Invoke-Utf8Script -Path $updaterInstaller -Parameters @{
            PortalServiceName = 'SirkPortal'
            InstallPath = $InstallRoot
            DataPath = $DataRoot
            HealthUrl = "https://localhost:$HttpsPort/readyz"
            Channel = 'dev'
        }
        $updater = Get-Service -Name SirkUpdater -ErrorAction Stop
        if ($updater.Status -ne 'Running') { throw 'SIRK Updater nie działa po instalacji.' }
    }

    $portal = Get-Service -Name SirkPortal -ErrorAction Stop
    if ($portal.Status -ne 'Running' -or $portal.StartType -ne 'Automatic') {
        throw "Nieprawidłowy stan SirkPortal: $($portal.Status) / $($portal.StartType)"
    }

    Write-Host "Access URL zapisano również w: $accessFile" -ForegroundColor DarkYellow
    Write-Host 'SIRK_PORTAL_DOTNET10_INSTALL_OK' -ForegroundColor Green
    if (-not $NonInteractive) { Start-Process $accessUrl }
}
finally {
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
