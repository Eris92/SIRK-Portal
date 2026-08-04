[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$ConnectionFile = '',
    [string]$PortalFqdn = '',
    [string]$PortalPublicUrl = '',
    [int]$HttpsPort = 443,
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$BootstrapUserName = 'admin',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$RemoveData,
    [switch]$KeepSourceConnectionFile,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-PowerShellScript([string]$Path) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $Path,
        [ref]$tokens,
        [ref]$errors) | Out-Null

    if ($errors.Count -gt 0) {
        $message = ($errors | ForEach-Object { $_.Message }) -join '; '
        throw "Pobrany skrypt PowerShell ma blad skladni: $message"
    }
}

function Write-Utf8Bom([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [IO.File]::WriteAllText($Path, $Text, $encoding)
}

if (-not (Test-Administrator)) {
    throw 'Uruchom instalator przez polecenie z -Verb RunAs.'
}
if ($Branch -notmatch '^[A-Za-z0-9._/-]{1,128}$' -or $Branch.Contains('..')) {
    throw 'Nazwa galezi Git jest nieprawidlowa.'
}
if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) {
    throw 'Port HTTPS jest nieprawidlowy.'
}
if ($TrustCertificate -and $DoNotTrustCertificate) {
    throw 'Nie mozna jednoczesnie wlaczyc i wylaczyc zaufania certyfikatu.'
}

$previousTemp = [Environment]::GetEnvironmentVariable('TEMP', 'Process')
$previousTmp = [Environment]::GetEnvironmentVariable('TMP', 'Process')
$shortBase = Join-Path $env:SystemDrive 'SIRK-TMP'
$runRoot = Join-Path $shortBase ('P-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$installer = Join-Path $runRoot 'connected.ps1'

try {
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    & icacls.exe $shortBase /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Nie mozna zabezpieczyc katalogu tymczasowego: $shortBase"
    }

    [Environment]::SetEnvironmentVariable('TEMP', $runRoot, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $runRoot, 'Process')

    Write-Host "Krotki katalog roboczy: $runRoot" -ForegroundColor DarkCyan
    $installerUrl = "https://raw.githubusercontent.com/Eris92/SIRK-Portal/$Branch/install-connected-dotnet10.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installer
    if ((Get-Item -LiteralPath $installer).Length -lt 10000) {
        throw 'Pobrany instalator polaczony jest niekompletny.'
    }

    # Windows PowerShell 5.1 interprets UTF-8 without BOM as the active ANSI
    # code page. Normalize the downloaded script and patch the canonical
    # installer download so install-dotnet10.ps1 is also saved with a BOM.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $source = [IO.File]::ReadAllText($installer, $utf8NoBom).Replace("`r`n", "`n")
    $needle = (@'
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath
    if ((Get-Item -LiteralPath $installerPath).Length -lt 10000) {
'@).Replace("`r`n", "`n")
    $replacement = (@'
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath
    $canonicalSource = [IO.File]::ReadAllText(
        $installerPath,
        (New-Object System.Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText(
        $installerPath,
        $canonicalSource,
        (New-Object System.Text.UTF8Encoding($true)))
    $canonicalTokens = $null
    $canonicalErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $installerPath,
        [ref]$canonicalTokens,
        [ref]$canonicalErrors) | Out-Null
    if ($canonicalErrors.Count -gt 0) {
        $canonicalMessage = ($canonicalErrors | ForEach-Object { $_.Message }) -join '; '
        throw "Pobrany kanoniczny instalator ma blad skladni: $canonicalMessage"
    }
    if ((Get-Item -LiteralPath $installerPath).Length -lt 10000) {
'@).Replace("`r`n", "`n")
    if (-not $source.Contains($needle)) {
        throw 'Nie rozpoznano kontraktu pobierania kanonicznego instalatora.'
    }
    $source = $source.Replace($needle, $replacement)
    Write-Utf8Bom -Path $installer -Text $source
    Test-PowerShellScript -Path $installer

    $childArguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $installer,
        '-Branch', $Branch,
        '-HttpsPort', [string]$HttpsPort,
        '-InstallRoot', $InstallRoot,
        '-DataRoot', $DataRoot,
        '-BootstrapUserName', $BootstrapUserName
    )
    if (-not [string]::IsNullOrWhiteSpace($ConnectionFile)) {
        $childArguments += @('-ConnectionFile', $ConnectionFile)
    }
    if (-not [string]::IsNullOrWhiteSpace($PortalFqdn)) {
        $childArguments += @('-PortalFqdn', $PortalFqdn)
    }
    if (-not [string]::IsNullOrWhiteSpace($PortalPublicUrl)) {
        $childArguments += @('-PortalPublicUrl', $PortalPublicUrl)
    }
    if ($TrustCertificate) { $childArguments += '-TrustCertificate' }
    if ($DoNotTrustCertificate) { $childArguments += '-DoNotTrustCertificate' }
    if ($RemoveData) { $childArguments += '-RemoveData' }
    if ($KeepSourceConnectionFile) { $childArguments += '-KeepSourceConnectionFile' }
    if ($ValidateOnly) { $childArguments += '-ValidateOnly' }

    & powershell.exe @childArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Instalator polaczony zakonczyl sie kodem $LASTEXITCODE."
    }
}
finally {
    [Environment]::SetEnvironmentVariable('TEMP', $previousTemp, 'Process')
    [Environment]::SetEnvironmentVariable('TMP', $previousTmp, 'Process')
    Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
}
