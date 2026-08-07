#requires -Version 7.4
$ErrorActionPreference = 'Stop'

$router = Get-Content 'install.ps1' -Raw -Encoding UTF8
$core = Get-Content 'install-core.ps1' -Raw -Encoding UTF8
$workflow = Get-Content '.github/workflows/portal-dotnet10-ci.yml' -Raw -Encoding UTF8

foreach ($required in @(
    'install-binary.ps1',
    'install-core.ps1',
    '$useBinaryInstaller',
    '$cleanInstall',
    'ForceSourceBuild'
)) {
    if (-not $router.Contains($required, [StringComparison]::Ordinal)) {
        throw "Portal install router is missing contract: $required"
    }
}

foreach ($required in @(
    'Invoke-SirkPortalBinaryUpdate',
    'SirkUpdater.exe',
    "update 'sirk-portal'",
    'portal-main-latest',
    'portal-update.json',
    'sirk-portal-win-x64.zip',
    'Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256',
    'Copy-Item -LiteralPath $settingsPath',
    'SIRK_PORTAL_BINARY_UPDATE_OK',
    'ForceSourceBuild'
)) {
    if (-not $core.Contains($required, [StringComparison]::Ordinal)) {
        throw "Portal core installer is missing binary updater contract: $required"
    }
}

$binaryStart = $core.IndexOf('function Invoke-SirkPortalBinaryUpdate', [StringComparison]::Ordinal)
$binaryEnd = $core.IndexOf('$defaultFqdn =', $binaryStart, [StringComparison]::Ordinal)
if ($binaryStart -lt 0 -or $binaryEnd -le $binaryStart) {
    throw 'Unable to locate Portal binary update function boundaries.'
}
$binarySection = $core.Substring($binaryStart, $binaryEnd - $binaryStart)

foreach ($forbidden in @(
    '& $dotnetExe publish',
    'New-SelfSignedCertificate',
    'New-NetFirewallRule',
    'Remove-ServiceCompletely'
)) {
    if ($binarySection.Contains($forbidden, [StringComparison]::Ordinal)) {
        throw "Binary update path must not perform source-install work: $forbidden"
    }
}

foreach ($required in @(
    'binary-update-package:',
    'dotnet publish src/Sirk.Portal/Sirk.Portal.csproj',
    '--self-contained false',
    'appsettings.Production.json must not be published',
    'Get-FileHash -LiteralPath $package -Algorithm SHA256',
    'gh release create portal-main-latest',
    'portal-update.json'
)) {
    if (-not $workflow.Contains($required, [StringComparison]::Ordinal)) {
        throw "Canonical Portal CI is missing binary release contract: $required"
    }
}

Write-Host 'binary-update-contract: OK'
