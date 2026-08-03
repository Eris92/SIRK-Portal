#PL Test akceptacji i sekretu | Weryfikuje Approval_2 oraz SaveSecretRequired.
#EN Approval and secret test | Verifies Approval_2 and SaveSecretRequired.
# Approval_2: true
# SaveSecretRequiredPL: $ApiToken, Token API | Sekretny token wymagany do wykonania testu
# SaveSecretRequiredEN: $ApiToken, API token | Secret token required to run the test

Write-Output ("Approval_2 and SaveSecretRequired test. TokenConfigured=" + (-not [string]::IsNullOrWhiteSpace($ApiToken)))
