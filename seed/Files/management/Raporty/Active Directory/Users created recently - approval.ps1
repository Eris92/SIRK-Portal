#PL Ostatnio utworzeni użytkownicy AD — akceptacja | Zwraca użytkowników AD utworzonych w wybranym okresie po akceptacji.
#EN Recently created AD users — approval | Returns AD users created within the selected period after approval.
# Approval_1: true
# VariableSelectRequiredPL: $DaysBack=30, Zakres dni | Liczba dni wstecz |7=Ostatnie 7 dni|30=Ostatnie 30 dni|90=Ostatnie 90 dni|180=Ostatnie 180 dni
# VariableSelectRequiredEN: $DaysBack=30, Days back | Number of days to include |7=Last 7 days|30=Last 30 days|90=Last 90 days|180=Last 180 days

$ErrorActionPreference = 'Stop'
$days = [Math]::Max(1, [int]$DaysBack)
$cutoff = (Get-Date).AddDays(-$days)
$adFilterDate = $cutoff.ToUniversalTime().ToString('yyyyMMddHHmmss.0Z')

Import-Module ActiveDirectory -ErrorAction Stop
$rows = @(Get-ADUser -Filter "whenCreated -ge '$adFilterDate'" -Properties DisplayName, UserPrincipalName, Mail, Enabled, whenCreated |
    Sort-Object whenCreated -Descending |
    ForEach-Object {
        [ordered]@{
            DisplayName = [string]$_.DisplayName
            Login = [string]$_.SamAccountName
            UserPrincipalName = [string]$_.UserPrincipalName
            Email = [string]$_.Mail
            Enabled = [bool]$_.Enabled
            Created = ([datetime]$_.whenCreated).ToString('yyyy-MM-dd HH:mm:ss')
        }
    })

[ordered]@{
    meshTable = $true
    title = "AD users created within the last $days days"
    columns = @('DisplayName', 'Login', 'UserPrincipalName', 'Email', 'Enabled', 'Created')
    rows = @($rows)
} | ConvertTo-Json -Depth 4 -Compress
