# Checks SharePoint variable values without logging in or changing the computer.
#runAsUser: 1
#Variable: $SharePointHostName, SharePoint organization short name, for example contoso
#Variable: $AppId, Microsoft Entra Application (client) ID GUID, optional for SharePoint Online

$tenantShortName = ([string]$SharePointHostName).Trim()
$clientId = ([string]$AppId).Trim()

Write-Output "SharePoint variable check"
Write-Output ""

if ([string]::IsNullOrWhiteSpace($tenantShortName)) {
    Write-Output "SharePointHostName: EMPTY"
    Write-Output "Enter only the tenant short name, for example: contoso"
    Write-Output "Do not enter https:// and do not enter -admin.sharepoint.com"
} else {
    $normalizedTenant = $tenantShortName -replace '^https?://', ''
    $normalizedTenant = $normalizedTenant -replace '\.sharepoint\.com.*$', ''
    $normalizedTenant = $normalizedTenant -replace '-admin$', ''
    $adminUrl = "https://$normalizedTenant-admin.sharepoint.com"
    $siteUrl = "https://$normalizedTenant.sharepoint.com"

    Write-Output "SharePointHostName: $tenantShortName"
    Write-Output "Normalized name:   $normalizedTenant"
    Write-Output "Admin URL:         $adminUrl"
    Write-Output "Tenant site URL:   $siteUrl"

    if ($normalizedTenant -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$') {
        Write-Output "WARNING: the organization name contains invalid characters or is too short."
    } else {
        Write-Output "Name format:       OK"
    }

    try {
        $dns = Resolve-DnsName "$normalizedTenant-admin.sharepoint.com" -Type A -ErrorAction Stop |
            Select-Object -First 1
        Write-Output "DNS admin URL:     OK ($($dns.IPAddress))"
    } catch {
        Write-Output "DNS admin URL:     NOT RESOLVED (check the tenant name or network)"
    }
}

Write-Output ""
if ([string]::IsNullOrWhiteSpace($clientId)) {
    Write-Output "AppId:              EMPTY"
    Write-Output "PnP management will be skipped by ConnectO365Services.ps1."
    Write-Output "For PnP, enter the Application (client) ID from Microsoft Entra App registrations."
} elseif ($clientId -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    Write-Output "AppId:              $clientId"
    Write-Output "AppId format:       OK (GUID)"
    Write-Output "AppId source:       Microsoft Entra admin center -> App registrations -> Application (client) ID"
} else {
    Write-Output "AppId:              $clientId"
    Write-Output "WARNING: AppId is not in the expected GUID format."
}

Write-Output ""
Write-Output "This test does not authenticate and does not install any module."
