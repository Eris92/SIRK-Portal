#PL Incydenty | Pobiera ostatnie incydenty Microsoft Defender XDR z Microsoft Graph.
#EN Incidents | Loads recent Microsoft Defender XDR incidents from Microsoft Graph.
$ErrorActionPreference = 'Stop'
$tenantId = [Environment]::GetEnvironmentVariable('SIRK_MANAGEMENT_ENTRA_TENANT_ID')
$clientId = [Environment]::GetEnvironmentVariable('SIRK_MANAGEMENT_ENTRA_CLIENT_ID')
$clientSecret = [Environment]::GetEnvironmentVariable('SIRK_MANAGEMENT_ENTRA_CLIENT_SECRET')

if ([string]::IsNullOrWhiteSpace($tenantId) -or [string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
    throw 'Configure Microsoft Defender / Graph credentials in Management settings before loading Defender incidents.'
}

$tokenBody = @{
    client_id = $clientId
    client_secret = $clientSecret
    scope = 'https://graph.microsoft.com/.default'
    grant_type = 'client_credentials'
}
$token = Invoke-RestMethod -Method Post -Uri ("https://login.microsoftonline.com/{0}/oauth2/v2.0/token" -f [Uri]::EscapeDataString($tenantId)) -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'
if ([string]::IsNullOrWhiteSpace($token.access_token)) { throw 'Microsoft Graph did not return an access token.' }

$headers = @{ Authorization = "Bearer $($token.access_token)"; Accept = 'application/json' }
$incidentUris = @(
    'https://graph.microsoft.com/v1.0/security/incidents?$expand=alerts&$top=50',
    'https://graph.microsoft.com/v1.0/security/incidents?$top=50',
    'https://graph.microsoft.com/v1.0/security/incidents'
)

$response = $null
$lastRequestError = $null
foreach ($uri in $incidentUris) {
    try {
        $response = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
        break
    } catch {
        $lastRequestError = $_
        $statusCode = 0
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { }
        if ($statusCode -ne 400) { throw }
    }
}
if ($null -eq $response) { throw $lastRequestError }
$rows = @($response.value | Sort-Object -Property createdDateTime -Descending | ForEach-Object {
    $incidentUrl = if ($_.incidentWebUrl -and $_.incidentWebUrl -match '^https://security\.microsoft\.com/') { $_.incidentWebUrl } else { '' }
    [ordered]@{
        'Date / time' = [string]$_.createdDateTime
        'Incident' = [string]$_.displayName
        'Severity' = [string]$_.severity
        'Assigned to' = [string]$_.assignedTo
        'Status' = [string]$_.status
        'Open' = if ($incidentUrl) { [ordered]@{ text = 'Open'; url = $incidentUrl } } else { '' }
    }
})

[ordered]@{
    meshTable = $true
    title = 'Microsoft Defender XDR - Incidents'
    columns = @('Date / time', 'Incident', 'Severity', 'Assigned to', 'Status', 'Open')
    rows = $rows
} | ConvertTo-Json -Depth 8 -Compress
