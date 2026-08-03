#PL Lista dozwolonych i blokowanych | Otwiera listę dozwolonych i blokowanych elementów dzierżawy w Microsoft Defender.
#EN Tenant Allow/Block List | Opens the Microsoft Defender Tenant Allow/Block List.
$result = [ordered]@{
    meshPortal = $true
    title = 'Tenant Allow/Block List'
    description = 'Manage trusted and blocked domains, URLs and senders.'
    url = 'https://security.microsoft.com/tenantAllowBlockList'
    buttonLabel = 'Open Tenant Allow/Block List'
}
$result | ConvertTo-Json -Compress
