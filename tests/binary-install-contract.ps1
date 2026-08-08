#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installerPath = Join-Path $PSScriptRoot '..\install-binary.ps1'
$installer = Get-Content -LiteralPath $installerPath -Raw -Encoding UTF8

foreach ($required in @(
    "[ValidateSet('preview','stable')]",
    'https://api.github.com/repos/$PortalReleaseRepository/releases?per_page=50',
    '^v(0\.1\.1\.\d+)$',
    'SIRK-Portal-$versionText-win-x64.update.json',
    'SIRK-Portal-$versionText-win-x64.zip',
    'release-trusted-keys.json',
    'PortalReleasePublicKeySha256',
    'Get-FileHash -LiteralPath $packagePath -Algorithm SHA256',
    '--verify-update-payload',
    '--trusted-keys',
    'UpdateChannel = $Channel',
    'Ensure-SirkUpdater.ps1',
    '-Channel $Channel',
    'SIRK_PORTAL_BINARY_INSTALL_OK'
)) {
    if ($installer.IndexOf($required, [StringComparison]::Ordinal) -lt 0) {
        throw "Binary clean installer is missing immutable signed bootstrap contract: $required"
    }
}

foreach ($forbidden in @(
    'portal-main-latest',
    'portal-update.json',
    'sirk-portal-win-x64.zip',
    "UpdateChannel = 'dev'",
    "-Channel 'dev'",
    "channel -cne 'main'",
    'dotnet publish',
    'dotnet-install.ps1',
    'global.json',
    'codeload.github.com/Eris92/SIRK-Portal/zip',
    'Build Cache\\dotnet-sdk'
)) {
    if ($installer.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Binary clean installer still contains legacy/source-build infrastructure: $forbidden"
    }
}

if ($installer.IndexOf('Public Portal release must not contain appsettings.Production.json.', [StringComparison]::Ordinal) -lt 0) {
    throw 'Binary installer must reject machine-specific configuration in the public release.'
}
if ($installer.IndexOf('Portal package SHA-256 does not match the signed descriptor.', [StringComparison]::Ordinal) -lt 0) {
    throw 'Binary installer must bind package SHA-256 to the signed descriptor.'
}
if ($installer.IndexOf('Portal release manifest does not match the signed release descriptor.', [StringComparison]::Ordinal) -lt 0) {
    throw 'Binary installer must bind release manifest to the signed release descriptor.'
}

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($installerPath,[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) { throw (($errors | ForEach-Object Message) -join '; ') }

Write-Host 'SIRK_PORTAL_IMMUTABLE_SIGNED_BINARY_BOOTSTRAP_CONTRACT_OK' -ForegroundColor Green
