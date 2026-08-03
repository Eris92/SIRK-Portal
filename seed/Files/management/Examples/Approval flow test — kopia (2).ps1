#PL Test procesu akceptacji v2 | Bezpieczny skrypt potwierdzający uruchomienie dopiero po akceptacji.
#EN Approval flow test v2 | Harmless script confirming that execution starts only after approval.
# VariableRequiredPL: $Message, Wiadomość | Tekst zwracany przez skrypt
# VariableRequiredEN: $Message, Message | Text returned by the script
# VariableSwitchPL: $IncludeEnvironment=false, Dołącz środowisko | Dołącza kontekst wykonania
# VariableSwitchEN: $IncludeEnvironment=false, Include environment | Includes execution context
# Approval_2: true

$result = [ordered]@{
    Message = [string]$Message
    ApprovedExecution = $true
    ExecutedAt = (Get-Date).ToString('o')
}

if ([System.Convert]::ToBoolean($IncludeEnvironment)) {
    $result.RequestId = [string]$env:SIRK_MANAGEMENT_REQUEST_ID
    $result.Requester = [string]$env:SIRK_MANAGEMENT_REQUESTER
    $result.ComputerName = [string]$env:COMPUTERNAME
}

$result | ConvertTo-Json -Compress
