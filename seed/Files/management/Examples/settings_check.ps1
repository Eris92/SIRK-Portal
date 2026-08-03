#PL Test ustawień Directory Tools | Sprawdza lokalną konfigurację integracji Directory Tools.
#EN Directory Tools settings test | Checks the local Directory Tools integration configuration.

param(
    [string]$PluginRoot = "C:\Program Files\Open Source\MeshCentral\meshcentral-data\plugins\directorytools",
    [switch]$RevealSecrets
)

$ErrorActionPreference = "Continue"

function Write-Step {
    param([string]$Text)
    Write-Output ""
    Write-Output "=== $Text ==="
}

function ConvertFrom-SecureValueToPlain {
    param(
        [object]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    if ($Value -is [securestring]) {
        $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
        try {
            return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
        }
        finally {
            if ($Bstr -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
            }
        }
    }

    return [string]$Value
}

function Mask-Secret {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return "[empty]"
    }

    if ($RevealSecrets) {
        return $Value
    }

    if ($Value.Length -le 6) {
        return ("*" * $Value.Length)
    }

    return $Value.Substring(0, 3) + ("*" * ($Value.Length - 6)) + $Value.Substring($Value.Length - 3)
}

function Test-AdCredential {
    param([pscredential]$Credential)

    if ($null -eq $Credential) {
        return [pscustomobject]@{
            Ok      = $false
            Details = "Brak AD Credential"
        }
    }

    try {
        $User = $Credential.UserName
        $Password = $Credential.GetNetworkCredential().Password

        $RootDse = New-Object System.DirectoryServices.DirectoryEntry("LDAP://RootDSE", $User, $Password)
        $NamingContext = [string]$RootDse.Properties["defaultNamingContext"].Value

        if ([string]::IsNullOrWhiteSpace($NamingContext)) {
            return [pscustomobject]@{
                Ok      = $false
                Details = "LDAP bind wykonany, ale brak defaultNamingContext"
            }
        }

        return [pscustomobject]@{
            Ok      = $true
            Details = "LDAP bind OK, defaultNamingContext=$NamingContext"
        }
    }
    catch {
        return [pscustomobject]@{
            Ok      = $false
            Details = $_.Exception.Message
        }
    }
}

Write-Step "DirectoryTools settings check"

$HelperPath = Join-Path $PluginRoot "settings\directorytools-settings.helper.ps1"
$XmlPath    = Join-Path $PluginRoot "settings\directorytools-settings.xml"

Write-Output "PluginRoot : $PluginRoot"
Write-Output "Helper     : $HelperPath"
Write-Output "XML        : $XmlPath"

Write-Step "File check"

if (Test-Path -LiteralPath $HelperPath) {
    Write-Output "OK Helper exists"
}
else {
    Write-Output "NOK Helper missing"
    exit 1
}

if (Test-Path -LiteralPath $XmlPath) {
    Write-Output "OK XML exists"
}
else {
    Write-Output "NOK XML missing - zapisz Settings w pluginie jeszcze raz"
    exit 1
}

Write-Step "Import helper"

try {
    . $HelperPath
    Write-Output "OK Helper imported"
}
catch {
    Write-Output "NOK Helper import failed"
    Write-Output $_.Exception.Message
    exit 1
}

if (-not (Get-Command Get-DirectoryToolsSettings -ErrorAction SilentlyContinue)) {
    Write-Output "NOK Brak funkcji Get-DirectoryToolsSettings"
    exit 1
}

Write-Step "Read settings"

try {
    $Settings = Get-DirectoryToolsSettings
    Write-Output "OK Settings loaded"
}
catch {
    Write-Output "NOK Settings read failed"
    Write-Output $_.Exception.Message
    exit 1
}

$CertPathPlain     = [string]$Settings.CertificatePath
$CertPasswordPlain = ConvertFrom-SecureValueToPlain $Settings.CertificatePassword
$AadSecretPlain    = ConvertFrom-SecureValueToPlain $Settings.AadSecretPlainText
$AdUser            = [string]$Settings.AdLogin
$AdPasswordPlain   = ConvertFrom-SecureValueToPlain $Settings.AdPasswordPlainText
$AdCredential      = $Settings.AdCredential

Write-Step "Values"

Write-Output ("CertificatePath     : " + $(if ($CertPathPlain) { $CertPathPlain } else { "[empty]" }))
Write-Output ("CertificateExists   : " + $(if ($CertPathPlain -and (Test-Path -LiteralPath $CertPathPlain)) { "YES" } else { "NO" }))
Write-Output ("CertificatePassword : " + (Mask-Secret $CertPasswordPlain))
Write-Output ("AAD Secret          : " + (Mask-Secret $AadSecretPlain))
Write-Output ("AD Login            : " + $(if ($AdUser) { $AdUser } else { "[empty]" }))
Write-Output ("AD Password         : " + (Mask-Secret $AdPasswordPlain))

Write-Step "Certificate test"

if ([string]::IsNullOrWhiteSpace($CertPathPlain)) {
    Write-Output "SKIP CertificatePath empty"
}
elseif (-not (Test-Path -LiteralPath $CertPathPlain)) {
    Write-Output "NOK Certificate file not found: $CertPathPlain"
}
else {
    try {
        $CertBytes = [System.IO.File]::ReadAllBytes($CertPathPlain)
        $Flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
        $Cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertBytes, $CertPasswordPlain, $Flags)

        Write-Output ("OK Cert loaded")
        Write-Output ("Subject       : " + $Cert.Subject)
        Write-Output ("Issuer        : " + $Cert.Issuer)
        Write-Output ("Thumbprint    : " + $Cert.Thumbprint)
        Write-Output ("NotBefore     : " + $Cert.NotBefore)
        Write-Output ("NotAfter      : " + $Cert.NotAfter)
        Write-Output ("HasPrivateKey : " + $Cert.HasPrivateKey)
    }
    catch {
        Write-Output "NOK Certificate load failed"
        Write-Output $_.Exception.Message
    }
}

Write-Step "AD credential test"

if ($null -eq $AdCredential) {
    Write-Output "SKIP Brak AD Credential"
}
else {
    $AdTest = Test-AdCredential -Credential $AdCredential

    if ($AdTest.Ok) {
        Write-Output ("OK " + $AdTest.Details)
    }
    else {
        Write-Output ("NOK " + $AdTest.Details)
    }
}

Write-Step "AAD Secret check"

if ([string]::IsNullOrEmpty($AadSecretPlain)) {
    Write-Output "NOK AAD Secret empty"
}
else {
    Write-Output ("OK AAD Secret loaded, length=" + $AadSecretPlain.Length)
    Write-Output ("Value: " + (Mask-Secret $AadSecretPlain))
}

Write-Step "Done"
