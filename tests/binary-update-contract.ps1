#requires -Version 7.4
$ErrorActionPreference = 'Stop'

$bootstrap = Get-Content 'install.ps1' -Raw -Encoding UTF8
$workflow = Get-Content '.github/workflows/portal-binary-release.yml' -Raw -Encoding UTF8

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
    if (-not $bootstrap.Contains($required, [StringComparison]::Ordinal)) {
        throw "Portal bootstrap is missing binary updater contract: $required"
    }
}

foreach ($forbidden in @(
    '& $dotnetExe publish',
    'New-SelfSignedCertificate',
    'New-NetFirewallRule',
    'Remove-ServiceCompletely'
)) {
    $binaryStart = $bootstrap.IndexOf('function Invoke-SirkPortalBinaryUpdate', [StringComparison]::Ordinal)
    $binaryEnd = $bootstrap.IndexOf('$defaultFqdn =', $binaryStart, [StringComparison]::Ordinal)
    $binarySection = $bootstrap.Substring($binaryStart, $binaryEnd - $binaryStart)
    if ($binarySection.Contains($forbidden, [StringComparison]::Ordinal)) {
        throw "Binary update path must not perform source-install work: $forbidden"
    }
}

foreach ($required in @(
    'dotnet publish src/Sirk.Portal/Sirk.Portal.csproj',
    '--self-contained false',
    'appsettings.Production.json must not be published',
    'Get-FileHash -LiteralPath $package -Algorithm SHA256',
    'gh release create portal-main-latest',
    'portal-update.json'
)) {
    if (-not $workflow.Contains($required, [StringComparison]::Ordinal)) {
        throw "Binary release workflow is missing contract: $required"
    }
}

Write-Host 'binary-update-contract: OK'
