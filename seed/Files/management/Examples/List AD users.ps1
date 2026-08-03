#PL Lista użytkowników AD | Pobiera użytkowników Active Directory i zwraca tabelę danych.
#EN List AD users | Retrieves Active Directory users and returns structured table data.
# VariableSelectRequiredPL: $Limit=100, Limit | Maksymalna liczba użytkowników |20=20 użytkowników|50=50 użytkowników|100=100 użytkowników
# VariableSelectRequiredEN: $Limit=100, Limit | Maximum number of users |20=20 users|50=50 users|100=100 users
# VariablePL: $Search, Filtr | Opcjonalny filtr nazwy lub loginu
# VariableEN: $Search, Filter | Optional name or login filter

Import-Module ActiveDirectory -ErrorAction Stop

$safeLimit = [Math]::Min(100, [Math]::Max(1, [int]$Limit))
$searchText = [string]$Search
$filter = '*'
if (-not [string]::IsNullOrWhiteSpace($searchText)) {
    $escaped = $searchText.Replace("'", "''")
    $filter = "Name -like '*$escaped*' -or SamAccountName -like '*$escaped*' -or UserPrincipalName -like '*$escaped*'"
}

$rows = Get-ADUser -Filter $filter -Properties DisplayName, Mail, Enabled |
    Sort-Object DisplayName, SamAccountName |
    Select-Object -First $safeLimit |
    ForEach-Object {
        [ordered]@{
            DisplayName = [string]$_.DisplayName
            Login = [string]$_.SamAccountName
            UserPrincipalName = [string]$_.UserPrincipalName
            Email = [string]$_.Mail
            Enabled = [bool]$_.Enabled
        }
    }

[ordered]@{
    meshTable = $true
    columns = @('DisplayName', 'Login', 'UserPrincipalName', 'Email', 'Enabled')
    rows = @($rows)
} | ConvertTo-Json -Depth 4 -Compress
