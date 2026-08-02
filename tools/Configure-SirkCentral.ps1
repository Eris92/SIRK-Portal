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

    $urlText = $urlText.Trim().TrimEnd('/')
    $idText = $idText.Trim().ToLowerInvariant()
    $tokenText = $tokenText.Trim()
    $nameText = $nameText.Trim()
    $publicUrlText = $publicUrlText.Trim().TrimEnd('/')

    if ($urlText -notmatch '^https://[^/]+(?::\d+)?$') {
        throw 'CentralUrl must be an HTTPS origin without a path.'
    }
    if ($idText -notmatch '^[a-z0-9][a-z0-9-]{2,62}$') {
        throw 'PortalId must contain 3-63 lowercase letters, digits or hyphens.'
    }
    if ($tokenText.Length -lt 32) {
        throw 'PortalToken must contain at least 32 characters.'
    }
    if (-not $nameText) { $nameText = $idText }
    if ($nameText.Length -gt 100) { throw 'PortalName cannot exceed 100 characters.' }
    if ($publicUrlText -and $publicUrlText -notmatch '^https://[^/]+(?::\d+)?$') {
        throw 'PublicUrl must be an HTTPS origin without a path.'
    }

    return [ordered]@{
        CentralUrl = $urlText
        PortalId = $idText
        PortalToken = $tokenText
        PortalName = $nameText
        PublicUrl = $publicUrlText
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

$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$($portal.Name)"
if (-not (Test-Path -LiteralPath $serviceKey)) { throw "Service registry key was not found: $serviceKey" }

$existing = @((Get-ItemProperty -LiteralPath $serviceKey -Name Environment -ErrorAction SilentlyContinue).Environment)
$managedNames = @(
    'SIRK_CENTRAL_URL',
    'SIRK_CENTRAL_API_URL',
    'SIRK_CENTRAL_PORTAL_ID',
    'SIRK_CENTRAL_PORTAL_NAME',
    'SIRK_CENTRAL_TOKEN',
    'SIRK_PUBLIC_URL'
)
$environment = @($existing | Where-Object {
    $line = [string]$_
    if (-not $line) { return $false }
    foreach ($name in $managedNames) {
        if ($line.StartsWith($name + '=', [StringComparison]::OrdinalIgnoreCase)) { return $false }
    }
    return $true
})

$webSocketUrl = $configuration.CentralUrl -replace '^https://', 'wss://'
$tunnelUrl = "$webSocketUrl/tunnel"
$environment += @(
    "SIRK_CENTRAL_URL=$tunnelUrl",
    "SIRK_CENTRAL_API_URL=$($configuration.CentralUrl)",
    "SIRK_CENTRAL_PORTAL_ID=$($configuration.PortalId)",
    "SIRK_CENTRAL_PORTAL_NAME=$($configuration.PortalName)",
    "SIRK_CENTRAL_TOKEN=$($configuration.PortalToken)"
)
if ($configuration.PublicUrl) { $environment += "SIRK_PUBLIC_URL=$($configuration.PublicUrl)" }

New-ItemProperty -LiteralPath $serviceKey -Name Environment -PropertyType MultiString -Value $environment -Force | Out-Null

$persisted = @((Get-ItemProperty -LiteralPath $serviceKey -Name Environment -ErrorAction Stop).Environment)
foreach ($requiredName in @('SIRK_CENTRAL_URL', 'SIRK_CENTRAL_API_URL', 'SIRK_CENTRAL_PORTAL_ID', 'SIRK_CENTRAL_TOKEN')) {
    if (-not ($persisted | Where-Object { ([string]$_).StartsWith($requiredName + '=', [StringComparison]::OrdinalIgnoreCase) })) {
        throw "Portal service environment was not persisted: $requiredName"
    }
}

Restart-Service -Name $portal.Name -Force
(Get-Service -Name $portal.Name).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
Start-Sleep -Seconds 5

if (-not $SkipRemoteValidation) {
    $credential = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($configuration.PortalId):$($configuration.PortalToken)"))
        .TrimEnd('=').Replace('+','-').Replace('/','_')
    $headers = @{ Authorization = "SIRK-Portal $credential" }
    $response = Invoke-RestMethod -Method Get -Uri "$($configuration.CentralUrl)/api/portal/v1/config" -Headers $headers -TimeoutSec 20
    if (-not $response.ok -or $response.portalId -ne $configuration.PortalId) {
        throw 'Central configuration validation returned an unexpected response.'
    }
}

Write-Host 'SIRK_CENTRAL_PORTAL_CONFIGURATION_OK' -ForegroundColor Green
Write-Host "Portal ID: $($configuration.PortalId)"
Write-Host "Central: $($configuration.CentralUrl)"
Write-Host "Tunnel: $tunnelUrl"
