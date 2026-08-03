#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, value):
    (ROOT / path).write_text(value, encoding="utf-8", newline="\n")


def replace_once(value, old, new, path):
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old[:120]!r}")
    return value.replace(old, new, 1)


path = "install.ps1"
value = read(path)
value = replace_once(
    value,
    "$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()\n$effectiveFqdn = $PortalFqdn.Trim().ToLowerInvariant()",
    "$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()\n"
    "$existingIdentityFile = Join-Path $DataRoot 'identity.json'\n"
    "$preserveExistingData = -not $RemoveData -and (Test-Path -LiteralPath $existingIdentityFile -PathType Leaf)\n"
    "$effectiveFqdn = $PortalFqdn.Trim().ToLowerInvariant()",
    path,
)
value = replace_once(
    value,
    "if (-not $NonInteractive -and [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {",
    "if (-not $preserveExistingData -and -not $NonInteractive -and [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {",
    path,
)
value = replace_once(
    value,
    "    Write-Host \"Źródło: Eris92/SIRK-Portal@$Branch\" -ForegroundColor DarkCyan\n",
    "    Write-Host \"Źródło: Eris92/SIRK-Portal@$Branch\" -ForegroundColor DarkCyan\n"
    "    if ($preserveExistingData) {\n"
    "        Write-Host \"Tryb: aktualizacja programu z zachowaniem $DataRoot\" -ForegroundColor DarkGreen\n"
    "    }\n",
    path,
)
write(path, value)

path = "install-dotnet10.ps1"
value = read(path)
value = replace_once(
    value,
    "$plain1 = $null\n$plain2 = $null\nif (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {\n    $plain1 = $env:SIRK_INSTALL_BREAKGLASS_PASSWORD\n    $plain2 = $plain1\n    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue\n}\nelseif ($NonInteractive) {\n    throw 'W trybie NonInteractive ustaw zmienną SIRK_INSTALL_BREAKGLASS_PASSWORD.'\n}\nelse {\n    $password1 = Read-Host 'Hasło administratora Break-Glass (minimum 14 znaków)' -AsSecureString\n    $password2 = Read-Host 'Powtórz hasło' -AsSecureString\n    $plain1 = ConvertFrom-SecureStringPlain $password1\n    $plain2 = ConvertFrom-SecureStringPlain $password2\n}\nif ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) { throw 'Hasło musi mieć minimum 14 znaków.' }\nif ($plain1 -cne $plain2) { throw 'Hasła nie są identyczne.' }",
    "$existingIdentityFile = Join-Path $DataRoot 'identity.json'\n"
    "$existingAccessFile = Join-Path $DataRoot 'security\\break-glass-access-code.txt'\n"
    "$preserveExistingData = -not $RemoveData -and (Test-Path -LiteralPath $existingIdentityFile -PathType Leaf)\n"
    "if ($preserveExistingData -and -not (Test-Path -LiteralPath $existingAccessFile -PathType Leaf)) {\n"
    "    throw 'Nie można zachować istniejących danych: brakuje pliku security\\break-glass-access-code.txt. Zaloguj się istniejącą sesją i wykonaj rotację Access Code albo użyj -RemoveData.'\n"
    "}\n\n"
    "$plain1 = $null\n"
    "$plain2 = $null\n"
    "if ($preserveExistingData) {\n"
    "    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue\n"
    "    Write-Host 'Wykryto istniejącą tożsamość Portalu — hasło i Access Code zostaną zachowane.' -ForegroundColor DarkGreen\n"
    "}\n"
    "elseif (-not [string]::IsNullOrWhiteSpace($env:SIRK_INSTALL_BREAKGLASS_PASSWORD)) {\n"
    "    $plain1 = $env:SIRK_INSTALL_BREAKGLASS_PASSWORD\n"
    "    $plain2 = $plain1\n"
    "    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue\n"
    "}\n"
    "elseif ($NonInteractive) {\n"
    "    throw 'W trybie NonInteractive ustaw zmienną SIRK_INSTALL_BREAKGLASS_PASSWORD.'\n"
    "}\n"
    "else {\n"
    "    $password1 = Read-Host 'Hasło administratora Break-Glass (minimum 14 znaków)' -AsSecureString\n"
    "    $password2 = Read-Host 'Powtórz hasło' -AsSecureString\n"
    "    $plain1 = ConvertFrom-SecureStringPlain $password1\n"
    "    $plain2 = ConvertFrom-SecureStringPlain $password2\n"
    "}\n"
    "if (-not $preserveExistingData) {\n"
    "    if ([string]::IsNullOrWhiteSpace($plain1) -or $plain1.Length -lt 14) { throw 'Hasło musi mieć minimum 14 znaków.' }\n"
    "    if ($plain1 -cne $plain2) { throw 'Hasła nie są identyczne.' }\n"
    "}",
    path,
)
value = replace_once(
    value,
    "    if ((Test-Path -LiteralPath $InstallRoot) -or (Test-Path -LiteralPath $DataRoot)) {\n        $backup = Join-Path $backupRoot ('Portal-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))\n        New-Item -ItemType Directory -Path $backup -Force | Out-Null\n        if (Test-Path -LiteralPath $InstallRoot) { Move-Item -LiteralPath $InstallRoot -Destination (Join-Path $backup 'Program') -Force }\n        if ((Test-Path -LiteralPath $DataRoot) -and -not $RemoveData) { Move-Item -LiteralPath $DataRoot -Destination (Join-Path $backup 'Data') -Force }\n    }\n    if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) { Remove-Item -LiteralPath $DataRoot -Recurse -Force }",
    "    if (Test-Path -LiteralPath $InstallRoot) {\n"
    "        $backup = Join-Path $backupRoot ('Portal-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))\n"
    "        New-Item -ItemType Directory -Path $backup -Force | Out-Null\n"
    "        Move-Item -LiteralPath $InstallRoot -Destination (Join-Path $backup 'Program') -Force\n"
    "    }\n"
    "    if ($RemoveData -and (Test-Path -LiteralPath $DataRoot)) {\n"
    "        Remove-Item -LiteralPath $DataRoot -Recurse -Force\n"
    "    }\n"
    "    elseif (Test-Path -LiteralPath $DataRoot) {\n"
    "        Write-Host \"Zachowano dane Portalu: $DataRoot\" -ForegroundColor DarkGreen\n"
    "    }",
    path,
)
value = replace_once(
    value,
    "    Set-Content -LiteralPath $passwordFile -Value $plain1 -Encoding UTF8 -NoNewline\n    $accessCode = New-UrlSafeToken 48\n    Set-Content -LiteralPath $accessFile -Value $accessCode -Encoding ASCII -NoNewline",
    "    if ($preserveExistingData) {\n"
    "        Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue\n"
    "        $accessCode = (Get-Content -LiteralPath $accessFile -Raw -Encoding ASCII).Trim()\n"
    "        if ($accessCode -notmatch '^[A-Za-z0-9_-]{32,256}$') {\n"
    "            throw 'Zachowany Access Code ma nieprawidłowy format.'\n"
    "        }\n"
    "    }\n"
    "    else {\n"
    "        Set-Content -LiteralPath $passwordFile -Value $plain1 -Encoding UTF8 -NoNewline\n"
    "        $accessCode = New-UrlSafeToken 48\n"
    "        Set-Content -LiteralPath $accessFile -Value $accessCode -Encoding ASCII -NoNewline\n"
    "    }",
    path,
)
value = replace_once(
    value,
    "    Write-Host 'Model wdrożenia: framework-dependent (współdzielony, aktualizowany Runtime 10)' -ForegroundColor Green\n",
    "    Write-Host 'Model wdrożenia: framework-dependent (współdzielony, aktualizowany Runtime 10)' -ForegroundColor Green\n"
    "    Write-Host ('Dane: ' + $(if ($preserveExistingData) { 'zachowane' } else { 'zainicjalizowane od nowa' })) -ForegroundColor Green\n",
    path,
)
write(path, value)

path = ".github/scripts/Test-NodeFreeWindowsInstall.ps1"
value = read(path)
marker = "    Restart-Service SirkPortal -Force\n"
preserve_test = r'''    $dataRoot = 'C:\ProgramData\SIRK\Portal'
    $manualScript = Join-Path $dataRoot 'Files\management\Preserved\Manual test.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $manualScript) -Force | Out-Null
    Set-Content -LiteralPath $manualScript -Value '#PL Zachowany skrypt | Test reinstalacji danych.' -Encoding UTF8
    $identityPath = Join-Path $dataRoot 'identity.json'
    $identityHashBefore = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash
    $accessCodeBefore = (Get-Content (Join-Path $dataRoot 'security\break-glass-access-code.txt') -Raw).Trim()
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue

    $reinstallOutput = @(& $installer -Branch $Branch -NonInteractive -PortalFqdn $Fqdn -HttpsPort $Port -TrustCertificate -SkipUpdater 6>&1)
    $reinstallOutput | Out-Host
    $reinstallText = (($reinstallOutput | Out-String) -replace '\s+', ' ').Trim()
    if (-not $reinstallText.Contains("Tryb: aktualizacja programu z zachowaniem $dataRoot")) {
        throw 'Reinstallation did not enter preserve-data mode.'
    }
    if (-not $reinstallText.Contains('SIRK_PORTAL_DOTNET10_INSTALL_OK')) {
        throw 'Preserve-data reinstallation did not complete successfully.'
    }
    if (-not (Test-Path -LiteralPath $manualScript -PathType Leaf)) {
        throw 'Manual Management script was removed during reinstallation.'
    }
    $identityHashAfter = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash
    if ($identityHashAfter -ne $identityHashBefore) {
        throw 'Portal identity changed during preserve-data reinstallation.'
    }
    $accessCodeAfter = (Get-Content (Join-Path $dataRoot 'security\break-glass-access-code.txt') -Raw).Trim()
    if ($accessCodeAfter -ne $accessCodeBefore) {
        throw 'Break-Glass Access Code changed during preserve-data reinstallation.'
    }
    if ((Invoke-RestMethod "$baseUrl/readyz").status -ne 'ready') {
        throw 'Portal is not ready after preserve-data reinstallation.'
    }

'''
value = replace_once(value, marker, preserve_test + marker, path)
write(path, value)

print('Preserve-data reinstall repair applied.')
