# Pobiera użytkowników Active Directory i zwraca wynik jako tabelę Commands.
#runAsUser: 0
#Variable: $SearchBase, Search base (optional), for example OU=Users,DC=contoso,DC=local
#VariableRequired: $ResultLimit=100, Maximum number of users

$ErrorActionPreference = "Stop"
Import-Module ActiveDirectory

$limit = 100
if (-not [int]::TryParse([string]$ResultLimit, [ref]$limit)) {
    throw "ResultLimit must be a number."
}
$limit = [Math]::Max(1, [Math]::Min($limit, 1000))

Write-Output "__COMMANDTABS_PROGRESS__ 10% Loading Active Directory users"

$parameters = @{
    Filter        = "*"
    Properties    = @("DisplayName", "Mail", "Enabled", "Department", "LastLogonDate")
    ResultSetSize = $limit
}
if (-not [string]::IsNullOrWhiteSpace([string]$SearchBase)) {
    $parameters.SearchBase = ([string]$SearchBase).Trim()
}

$rows = @(Get-ADUser @parameters |
    Sort-Object SamAccountName |
    Select-Object SamAccountName, DisplayName, Mail, Enabled, Department, LastLogonDate)

Write-Output "__COMMANDTABS_PROGRESS__ 80% Preparing the web table"

$json = ConvertTo-Json -InputObject $rows -Compress -Depth 4
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$base64 = [Convert]::ToBase64String($bytes)
Write-Output ("__SIRK_COMMANDS_TABLE_B64__" + $base64)
Write-Output "__COMMANDTABS_PROGRESS__ 100% Completed"
