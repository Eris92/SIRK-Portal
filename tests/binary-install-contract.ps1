#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installer = Get-Content (Join-Path $PSScriptRoot '..\install-binary.ps1') -Raw -Encoding UTF8

foreach ($required in @(
    'portal-main-latest',
    'portal-update.json',
    'sirk-portal-win-x64.zip',
    'Get-FileHash -LiteralPath $packagePath -Algorithm SHA256',
    'release-manifest.json',
    'Microsoft.NETCore.App',
    'Microsoft.AspNetCore.App',
    'New-SelfSignedCertificate',
    'New-Service -Name $serviceName',
    'Ensure-SirkUpdater.ps1',
    'SIRK_PORTAL_BINARY_INSTALL_OK'
)) {
    if (-not $installer.Contains($required, [StringComparison]::Ordinal)) {
        throw "Binary clean installer is missing required contract: $required"
    }
}

foreach ($forbidden in @(
    'dotnet publish',
    'dotnet-install.ps1',
    'global.json',
    'codeload.github.com/Eris92/SIRK-Portal/zip',
    'Build Cache\\dotnet-sdk'
)) {
    if ($installer.Contains($forbidden, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Binary clean installer must not perform source-build work: $forbidden"
    }
}

if (-not $installer.Contains("Public Portal release must not contain appsettings.Production.json.", [StringComparison]::Ordinal)) {
    throw 'Binary installer must reject machine-specific configuration in the public release.'
}
if (-not $installer.Contains("Portal package SHA-256 mismatch", [StringComparison]::Ordinal)) {
    throw 'Binary installer must verify release package SHA-256.'
}
if (-not $installer.Contains("Portal release manifest does not match release metadata.", [StringComparison]::Ordinal)) {
    throw 'Binary installer must bind release manifest to release metadata.'
}

Write-Host 'binary-install-contract: OK' -ForegroundColor Green
