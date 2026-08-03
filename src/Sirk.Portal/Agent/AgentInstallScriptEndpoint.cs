namespace Sirk.Portal.Agent;

internal static class AgentInstallScriptEndpoint
{
    public static IEndpointRouteBuilder MapAgentInstallScript(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/agent/install-script", () =>
                Results.Text(Script, "text/plain; charset=utf-8"))
            .AllowAnonymous();
        return endpoints;
    }

    private const string Script = """
#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PortalUrl,
    [Parameter(Mandatory)][string]$GroupId,
    [Parameter(Mandatory)][string]$EnrollmentToken,
    [ValidateSet('stable','dev')][string]$Channel = 'stable',
    [ValidateSet('Silent','Interactive')][string]$Mode = 'Silent'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PortalUrl = $PortalUrl.Trim().TrimEnd('/')
if ($PortalUrl -notmatch '^https://[^/]+(?::\d+)?$') {
    throw 'PortalUrl must be an HTTPS origin without a path.'
}
$GroupId = $GroupId.Trim().ToLowerInvariant()
if ($GroupId -notmatch '^[a-z0-9][a-z0-9._-]{2,127}$') {
    throw 'GroupId is invalid.'
}
$EnrollmentToken = $EnrollmentToken.Trim()
if ($EnrollmentToken.Length -lt 20 -or $EnrollmentToken.Length -gt 512) {
    throw 'EnrollmentToken is invalid.'
}

$work = Join-Path $env:TEMP ('SIRK-Agent-Install-' + [guid]::NewGuid().ToString('N'))
$setup = Join-Path $work 'SIRK-Agent-Setup.exe'
$hashFile = "$setup.sha256"
try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $headers = @{ 'User-Agent' = 'SIRK-Portal-Agent-Installer' }
    $releases = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri 'https://api.github.com/repos/Eris92/SIRK-Agent/releases?per_page=30'
    $setupAsset = $null
    $hashAsset = $null
    foreach ($release in @($releases)) {
        if ($release.draft) { continue }
        $candidateSetup = @($release.assets | Where-Object name -eq 'SIRK-Agent-Setup.exe' | Select-Object -First 1)
        $candidateHash = @($release.assets | Where-Object name -eq 'SIRK-Agent-Setup.exe.sha256' | Select-Object -First 1)
        if ($candidateSetup.Count -eq 1 -and $candidateHash.Count -eq 1) {
            $setupAsset = $candidateSetup[0]
            $hashAsset = $candidateHash[0]
            break
        }
    }
    if (-not $setupAsset -or -not $hashAsset) {
        throw 'No verified SIRK Agent .NET 10 Setup release was found.'
    }

    Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $setupAsset.browser_download_url -OutFile $setup
    Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $hashAsset.browser_download_url -OutFile $hashFile
    $expected = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0]
    if ($expected -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'Agent Setup SHA-256 file is invalid.'
    }
    $actual = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Agent Setup SHA-256 mismatch. Expected=$expected Actual=$actual"
    }

    $compoundToken = $GroupId + '.' + $EnrollmentToken
    & $setup --portal-url $PortalUrl --enrollment-token $compoundToken --channel $Channel
    if ($LASTEXITCODE -ne 0) {
        throw "SIRK Agent Setup failed with exit code $LASTEXITCODE."
    }

    Write-Host 'SIRK_AGENT_PORTAL_INSTALL_OK' -ForegroundColor Green
    Get-Service SirkAgent,SirkAgentWatchdog,SirkUpdater -ErrorAction Stop |
        Format-Table Name,Status,StartType
}
finally {
    Remove-Variable EnrollmentToken,compoundToken -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
""";
}
