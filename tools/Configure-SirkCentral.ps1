#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding(DefaultParameterSetName = 'Values')]
param(
    [Parameter(ParameterSetName = 'Values', Mandatory = $true)]
    [string]$CentralUrl,

    [Parameter(ParameterSetName = 'Values', Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9-]{2,62}$')]
    [string]$PortalId,

    [Parameter(ParameterSetName = 'Values', Mandatory = $true)]
    [string]$PortalToken,

    [Parameter(ParameterSetName = 'Values')]
    [string]$PortalName,

    [Parameter(ParameterSetName = 'Bootstrap', Mandatory = $true)]
    [string]$BootstrapFile,

    [string]$PortalServiceDisplayName = 'SIRK Portal',
    [string]$DataRoot = "$env:ProgramData\SIRK\Portal",
    [string]$PublicUrl,
    [switch]$SkipRemoteValidation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Normalize-CentralConfiguration {
    param([hashtable]$InputValues)

    $urlText = [string]$InputValues.CentralUrl
    if (-not $urlText) { $urlText = [string]$InputValues.centralUrl }
    $idText = [string]$InputValues.PortalId
    if (-not $idText) { $idText = [string]$InputValues.portalId }
    $tokenText = [string]$InputValues.PortalToken
    if (-not $tokenText) { $tokenText = [string]$InputValues.portalToken }
    $nameText = [string]$InputValues.PortalName
    if (-not $nameText) { $nameText = [string]$InputValues.portalName }
    $publicUrlText = [string]$InputValues.PublicUrl
    if (-not $publicUrlText) { $publicUrlText = [string]$InputValues.publicUrl }
    $tunnelText = [string]$InputValues.TunnelUrl
    if (-not $tunnelText) { $tunnelText = [string]$InputValues.tunnelUrl }

    $urlText = $urlText.Trim().TrimEnd('/')
    $idText = $idText.Trim().ToLowerInvariant()
    $tokenText = $tokenText.Trim()
    $nameText = $nameText.Trim()
    $publicUrlText = $publicUrlText.Trim().TrimEnd('/')

    if ($urlText -notmatch '^https://[^/]+(?::\d+)?$') {
        throw 'CentralUrl must be an HTTPS origin without a path.'
    }
    if (-not $tunnelText) { $tunnelText = ($urlText -replace '^https://', 'wss://') + '/tunnel' }
    if ($tunnelText -ne (($urlText -replace '^https://', 'wss://') + '/tunnel')) {
        throw 'TunnelUrl must use the Central origin and /tunnel path.'
    }
    if ($idText -notmatch '^[a-z0-9][a-z0-9-]{2,62}$') {
        throw 'PortalId must contain 3-63 lowercase letters, digits or hyphens.'
    }
    if ($tokenText -notmatch '^[A-Za-z0-9_-]{32,512}$') {
        throw 'PortalToken has an invalid format.'
    }
    if (-not $nameText) { $nameText = $idText }
    if ($nameText.Length -gt 100) { throw 'PortalName cannot exceed 100 characters.' }
    if ($publicUrlText -and $publicUrlText -notmatch '^https://[^/]+(?::\d+)?$') {
        throw 'PublicUrl must be an HTTPS origin without a path.'
    }

    return [ordered]@{
        schemaVersion = 1
        centralUrl = $urlText
        tunnelUrl = $tunnelText
        portalId = $idText
        portalName = $nameText
        portalToken = $tokenText
        publicUrl = $publicUrlText
        updatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
}

if ($PSCmdlet.ParameterSetName -eq 'Bootstrap') {
    if (-not (Test-Path -LiteralPath $BootstrapFile)) {
        throw "Bootstrap file was not found: $BootstrapFile"
    }
    $raw = Get-Content -LiteralPath $BootstrapFile -Raw | ConvertFrom-Json
    if ($raw.PSObject.Properties.Name -contains 'bootstrap' -and $raw.bootstrap) {
        $raw = $raw.bootstrap
    }
    $values = @{}
    foreach ($property in $raw.PSObject.Properties) { $values[$property.Name] = $property.Value }
    $configuration = Normalize-CentralConfiguration -InputValues $values
}
else {
    $configuration = Normalize-CentralConfiguration -InputValues @{
        CentralUrl = $CentralUrl
        PortalId = $PortalId
        PortalToken = $PortalToken
        PortalName = $PortalName
        PublicUrl = $PublicUrl
    }
}

$portal = Get-CimInstance Win32_Service |
    Where-Object DisplayName -eq $PortalServiceDisplayName |
    Select-Object -First 1
if (-not $portal) { throw "Portal service was not found: $PortalServiceDisplayName" }

New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
$configPath = Join-Path $DataRoot 'central-connection.json'
$tempPath = "$configPath.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
try {
    $configuration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tempPath -Encoding UTF8
    Move-Item -LiteralPath $tempPath -Destination $configPath -Force
}
finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
}

& icacls.exe $configPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to secure central-connection.json ACL.' }

$persisted = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($persisted.portalId -ne $configuration.portalId -or $persisted.tunnelUrl -ne $configuration.tunnelUrl) {
    throw 'Persisted Central configuration validation failed.'
}

Restart-Service -Name $portal.Name -Force
(Get-Service -Name $portal.Name).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
Start-Sleep -Seconds 5

if (-not $SkipRemoteValidation) {
    $credential = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($configuration.portalId):$($configuration.portalToken)"))
        .TrimEnd('=').Replace('+','-').Replace('/','_')
    $headers = @{ Authorization = "SIRK-Portal $credential" }
    $response = Invoke-RestMethod -Method Get -Uri "$($configuration.centralUrl)/api/portal/v1/config" -Headers $headers -TimeoutSec 20
    if (-not $response.ok -or $response.portalId -ne $configuration.portalId) {
        throw 'Central configuration validation returned an unexpected response.'
    }
}

Write-Host 'SIRK_CENTRAL_PORTAL_CONFIGURATION_OK' -ForegroundColor Green
Write-Host "Portal ID: $($configuration.portalId)"
Write-Host "Central: $($configuration.centralUrl)"
Write-Host "Tunnel: $($configuration.tunnelUrl)"
Write-Host "Configuration: $configPath"
