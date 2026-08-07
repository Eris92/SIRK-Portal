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
    [switch]$KeepBuildSdk,
    [switch]$SkipUpdater,
    [switch]$ForceSourceBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$commonDataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
if ([string]::IsNullOrWhiteSpace($commonDataRoot)) {
    throw 'Unable to determine the system ProgramData directory.'
}
$installerWorkBase = Join-Path $commonDataRoot 'SIRK\Temp'
New-Item -ItemType Directory -Path $installerWorkBase -Force | Out-Null
$workRoot = Join-Path $installerWorkBase ('Bootstrap-' + [guid]::NewGuid().ToString('N'))
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
        throw ('PowerShell syntax error in {0}: {1}' -f $Path, (($errors | ForEach-Object Message) -join '; '))
    }
    $script = [scriptblock]::Create($source)
    & $script @Parameters
}

function Test-SafePortalUpdateMetadata {
    param([Parameter(Mandatory)]$Metadata)

    if ([int]$Metadata.schemaVersion -ne 1) {
        throw 'Unsupported Portal binary update metadata schema.'
    }
    if ([string]$Metadata.applicationId -cne 'sirk-portal') {
        throw 'The binary update package targets a different application.'
    }
    if ([string]$Metadata.channel -cne 'main') {
        throw 'The binary update package is not from the main channel.'
    }
    if ([string]$Metadata.package -cne 'sirk-portal-win-x64.zip') {
        throw 'The binary update package name is invalid.'
    }
    if ([string]$Metadata.sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'The binary update SHA-256 value is invalid.'
    }
    if ([string]$Metadata.commit -notmatch '^[A-Fa-f0-9]{40}$') {
        throw 'The binary update commit value is invalid.'
    }
    $sizeBytes = [long]$Metadata.sizeBytes
    if ($sizeBytes -lt 1024 -or $sizeBytes -gt 268435456) {
        throw 'The binary update package size is outside the allowed range.'
    }
}

function Invoke-SirkPortalBinaryUpdate {
    param(
        [Parameter(Mandatory)][string]$CurrentInstallRoot,
        [Parameter(Mandatory)][string]$CurrentDataRoot
    )

    $updaterCli = Join-Path $env:ProgramFiles 'SIRK\Updater\SirkUpdater.exe'
    if (-not (Test-Path -LiteralPath $updaterCli -PathType Leaf)) {
        throw 'SIRK Updater is not installed. Run this installer once with -ForceSourceBuild.'
    }

    $settingsPath = Join-Path $CurrentInstallRoot 'appsettings.Production.json'
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
        throw "Missing installed Portal configuration: $settingsPath"
    }

    $binaryRoot = Join-Path $installerWorkBase ('BinaryUpdate-' + [guid]::NewGuid().ToString('N'))
    $metadataPath = Join-Path $binaryRoot 'portal-update.json'
    $downloadPath = Join-Path $binaryRoot 'sirk-portal-win-x64.zip'
    $payloadRoot = Join-Path $binaryRoot 'payload'
    $preparedPath = Join-Path $binaryRoot 'sirk-portal-prepared-win-x64.zip'
    $releaseBase = 'https://github.com/Eris92/SIRK-Portal/releases/download/portal-main-latest'

    try {
        New-Item -ItemType Directory -Path $binaryRoot,$payloadRoot -Force | Out-Null
        & icacls.exe $binaryRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

        Write-Host '=== Downloading verified SIRK Portal binary update ===' -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing `
            -Uri ($releaseBase + '/portal-update.json?nocache=' + [guid]::NewGuid()) `
            -OutFile $metadataPath

        $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Test-SafePortalUpdateMetadata -Metadata $metadata

        Invoke-WebRequest -UseBasicParsing `
            -Uri ($releaseBase + '/' + [string]$metadata.package + '?nocache=' + [guid]::NewGuid()) `
            -OutFile $downloadPath

        $downloadInfo = Get-Item -LiteralPath $downloadPath
        if ($downloadInfo.Length -ne [long]$metadata.sizeBytes) {
            throw "Binary update size mismatch. Expected=$($metadata.sizeBytes), Actual=$($downloadInfo.Length)."
        }
        $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash
        if ($downloadHash -cne ([string]$metadata.sha256).ToUpperInvariant()) {
            throw "Binary update SHA-256 mismatch. Actual=$downloadHash"
        }

        Expand-Archive -LiteralPath $downloadPath -DestinationPath $payloadRoot -Force
        foreach ($required in @(
            'Sirk.Portal.exe',
            'Sirk.Portal.dll',
            'Sirk.Portal.runtimeconfig.json',
            'public\portal\standalone\index.html'
        )) {
            $requiredPath = Join-Path $payloadRoot $required
            if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
                throw "Binary update payload is incomplete: $required"
            }
        }
        if (Test-Path -LiteralPath (Join-Path $payloadRoot 'appsettings.Production.json')) {
            throw 'The public binary package must not contain machine-specific appsettings.Production.json.'
        }

        Copy-Item -LiteralPath $settingsPath `
            -Destination (Join-Path $payloadRoot 'appsettings.Production.json') `
            -Force

        Compress-Archive `
            -Path (Join-Path $payloadRoot '*') `
            -DestinationPath $preparedPath `
            -CompressionLevel Optimal `
            -Force
        $preparedHash = (Get-FileHash -LiteralPath $preparedPath -Algorithm SHA256).Hash

        Write-Host ('Applying transactional update for commit ' + [string]$metadata.commit + '...') -ForegroundColor Cyan
        & $updaterCli update 'sirk-portal' $preparedPath $preparedHash ([string]$metadata.commit)
        if ($LASTEXITCODE -ne 0) {
            throw "SIRK Updater failed. ExitCode=$LASTEXITCODE"
        }

        $portal = Get-Service -Name SirkPortal -ErrorAction Stop
        if ($portal.Status -ne 'Running') {
            $portal.WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
        }
        & icacls.exe $settingsPath /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null

        Write-Host 'SIRK_PORTAL_BINARY_UPDATE_OK' -ForegroundColor Green
        return $true
    }
    finally {
        Remove-Item -LiteralPath $binaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
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
        $answer = Read-Host "Portal DNS name [$defaultFqdn]"
        $effectiveFqdn = if ([string]::IsNullOrWhiteSpace($answer)) {
            $defaultFqdn
        } else {
            $answer.Trim().ToLowerInvariant()
        }
    }
}

if (-not $preserveExistingData -and -not $NonInteractive -and [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {
    $password1 = Read-Host 'Break-Glass administrator password (minimum 14 characters)' -AsSecureString
    $password2 = Read-Host 'Repeat password' -AsSecureString
    $plain1 = ConvertFrom-SecureStringPlain $password1
    $plain2 = ConvertFrom-SecureStringPlain $password2
    try {
        if ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) {
            throw 'The password must contain at least 14 characters.'
        }
        if ($plain1 -cne $plain2) { throw 'Passwords do not match.' }
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
    $trustAnswer = (Read-Host 'Add the Portal certificate to LocalMachine\Root? [Y/n]').Trim().ToLowerInvariant()
    if ($trustAnswer -in @('n','no')) {
        $DoNotTrustCertificate = $true
    } else {
        $TrustCertificate = $true
    }
}

if ($preserveExistingData -and
    -not $ForceSourceBuild -and
    -not $SkipUpdater -and
    [string]::Equals($Branch, 'main', [StringComparison]::OrdinalIgnoreCase)) {
    try {
        if (Invoke-SirkPortalBinaryUpdate -CurrentInstallRoot $InstallRoot -CurrentDataRoot $DataRoot) {
            return
        }
    }
    finally {
        Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Path $workRoot,$extractRoot -Force | Out-Null
try {
    Write-Host '=== SIRK Portal .NET 10 source installation ===' -ForegroundColor Cyan
    Write-Host "Source: Eris92/SIRK-Portal@$Branch" -ForegroundColor DarkCyan
    if ($preserveExistingData) {
        Write-Host "Mode: program update preserving $DataRoot" -ForegroundColor DarkGreen
    }

    $encodedBranch = [Uri]::EscapeDataString($Branch)
    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/$encodedBranch" `
        -OutFile $sourceZip
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'The downloaded repository archive is invalid.' }

    $installerPath = Join-Path $sourceRoot.FullName 'install-dotnet10.ps1'
    if (-not (Test-Path -LiteralPath $installerPath)) {
        throw "Missing native .NET 10 installer: $installerPath"
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
    if ($KeepBuildSdk) { $parameters.KeepBuildSdk = $true }

    Invoke-Utf8Script -Path $installerPath -Parameters $parameters

    $accessFile = Join-Path $DataRoot 'security\break-glass-access-code.txt'
    if (-not (Test-Path -LiteralPath $accessFile -PathType Leaf)) {
        throw "Missing generated Access Code: $accessFile"
    }
    $accessCode = (Get-Content -LiteralPath $accessFile -Raw -Encoding ASCII).Trim()
    if ($accessCode -notmatch '^[A-Za-z0-9_-]{32,256}$') {
        throw 'The generated Access Code is invalid.'
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
            throw "Missing SIRK Updater integration: $updaterInstaller"
        }
        Invoke-Utf8Script -Path $updaterInstaller -Parameters @{
            PortalServiceName = 'SirkPortal'
            InstallPath = $InstallRoot
            DataPath = $DataRoot
            HealthUrl = "https://localhost:$HttpsPort/readyz"
            Channel = 'dev'
        }
        $updater = Get-Service -Name SirkUpdater -ErrorAction Stop
        if ($updater.Status -ne 'Running') { throw 'SIRK Updater is not running after installation.' }
    }

    $portal = Get-Service -Name SirkPortal -ErrorAction Stop
    if ($portal.Status -ne 'Running' -or $portal.StartType -ne 'Automatic') {
        throw "Invalid SirkPortal state: $($portal.Status) / $($portal.StartType)"
    }

    Write-Host "Access URL is also stored in: $accessFile" -ForegroundColor DarkYellow
    Write-Host 'SIRK_PORTAL_DOTNET10_INSTALL_OK' -ForegroundColor Green
    if (-not $NonInteractive) { Start-Process $accessUrl }
}
finally {
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
