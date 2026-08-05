[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$ConnectionFile = '',
    [string]$PortalFqdn = '',
    [string]$PortalPublicUrl = '',
    [int]$HttpsPort = 443,
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal',
    [string]$BootstrapUserName = 'admin',
    [switch]$TrustCertificate,
    [switch]$DoNotTrustCertificate,
    [switch]$RemoveData,
    [switch]$KeepBuildSdk,
    [switch]$KeepSourceConnectionFile,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

function Write-Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function ConvertFrom-SecureStringPlain([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Test-DnsName([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 253) { return $false }
    if ($Value -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$') { return $false }
    foreach ($label in $Value.Split('.')) {
        if ($label.Length -lt 1 -or $label.Length -gt 63 -or $label.StartsWith('-') -or $label.EndsWith('-')) {
            return $false
        }
    }
    return $true
}

function Resolve-ConnectionFilePath([string]$RequestedPath) {
    $candidate = $RequestedPath
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = [Environment]::GetEnvironmentVariable('SIRK_PORTAL_CONNECTION_FILE', 'Process')
    }

    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
        $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction Stop
        return $resolved.ProviderPath
    }

    $roots = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $roots.Add((Join-Path $env:USERPROFILE 'Downloads'))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:PUBLIC)) {
        $roots.Add((Join-Path $env:PUBLIC 'Downloads'))
    }

    $files = @()
    foreach ($root in $roots | Select-Object -Unique) {
        if (Test-Path -LiteralPath $root -PathType Container) {
            $files += Get-ChildItem -LiteralPath $root -Filter 'SIRK-Portal-*-connection.json' -File -ErrorAction SilentlyContinue
        }
    }

    $selected = @($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
    if ($selected.Count -ne 1) {
        throw 'Nie znaleziono pliku SIRK-Portal-*-connection.json. Pobierz plik polaczenia z SIRK Central albo podaj -ConnectionFile.'
    }

    Write-Host ("Automatycznie wybrano plik polaczenia: " + $selected[0].FullName) -ForegroundColor DarkCyan
    return $selected[0].FullName
}

function Test-OriginUri([Uri]$Uri, [string]$Scheme) {
    return $Uri.IsAbsoluteUri -and
        $Uri.Scheme.Equals($Scheme, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::IsNullOrEmpty($Uri.UserInfo) -and
        [string]::IsNullOrEmpty($Uri.Query) -and
        [string]::IsNullOrEmpty($Uri.Fragment) -and
        ($Uri.AbsolutePath -eq '/' -or [string]::IsNullOrEmpty($Uri.AbsolutePath))
}

function Read-CentralConnectionDocument([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item -or $item.PSIsContainer) { throw 'Plik polaczenia nie jest zwyklym plikiem.' }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Plik polaczenia nie moze byc linkiem symbolicznym ani reparse point.'
    }
    if ($item.Length -lt 1 -or $item.Length -gt 32768) {
        throw 'Plik polaczenia musi miec rozmiar 1-32768 bajtow.'
    }

    try {
        $document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw ('Plik polaczenia zawiera nieprawidlowy JSON: ' + $_.Exception.Message)
    }

    if ([int]$document.schemaVersion -ne 1) { throw 'Nieobslugiwana wersja pliku polaczenia.' }

    $centralUrl = [string]$document.centralUrl
    $tunnelUrl = [string]$document.tunnelUrl
    $portalId = [string]$document.portalId
    $portalName = [string]$document.portalName
    $portalToken = [string]$document.portalToken
    $publicUrl = [string]$document.publicUrl

    $centralUri = $null
    if (-not [Uri]::TryCreate($centralUrl, [UriKind]::Absolute, [ref]$centralUri) -or
        -not (Test-OriginUri $centralUri 'https')) {
        throw 'Plik polaczenia zawiera nieprawidlowy HTTPS Central URL.'
    }

    $tunnelUri = $null
    if (-not [Uri]::TryCreate($tunnelUrl, [UriKind]::Absolute, [ref]$tunnelUri) -or
        -not $tunnelUri.Scheme.Equals('wss', [StringComparison]::OrdinalIgnoreCase) -or
        -not $tunnelUri.Host.Equals($centralUri.Host, [StringComparison]::OrdinalIgnoreCase) -or
        $tunnelUri.Port -ne $centralUri.Port -or
        $tunnelUri.AbsolutePath -ne '/tunnel' -or
        -not [string]::IsNullOrEmpty($tunnelUri.UserInfo) -or
        -not [string]::IsNullOrEmpty($tunnelUri.Query) -or
        -not [string]::IsNullOrEmpty($tunnelUri.Fragment)) {
        throw 'Tunnel URL musi wskazywac na ten sam host Central i sciezke /tunnel.'
    }

    if ($portalId -notmatch '^[a-z0-9][a-z0-9-]{2,62}$') {
        throw 'Plik polaczenia zawiera nieprawidlowy Portal ID.'
    }
    if ($portalName.Length -lt 2 -or $portalName.Length -gt 100 -or $portalName -cne $portalName.Trim()) {
        throw 'Plik polaczenia zawiera nieprawidlowa nazwe Portalu.'
    }
    if ($portalToken.Length -lt 32 -or $portalToken.Length -gt 512 -or $portalToken -notmatch '^[A-Za-z0-9_-]+$') {
        throw 'Plik polaczenia zawiera nieprawidlowy token Portalu.'
    }

    if (-not [string]::IsNullOrWhiteSpace($publicUrl)) {
        $publicUri = $null
        if (-not [Uri]::TryCreate($publicUrl, [UriKind]::Absolute, [ref]$publicUri) -or
            -not (Test-OriginUri $publicUri 'https')) {
            throw 'Plik polaczenia zawiera nieprawidlowy publicUrl Portalu.'
        }
    }

    return $document
}

function Set-JsonProperty($Document, [string]$Name, $Value) {
    $property = $Document.PSObject.Properties[$Name]
    if ($property) { $property.Value = $Value }
    else { $Document | Add-Member -MemberType NoteProperty -Name $Name -Value $Value }
}

function Write-JsonNoBom($Document, [string]$Path) {
    $json = $Document | ConvertTo-Json -Depth 16
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($Path, $json, $encoding)
}

function Protect-FileAcl([string]$Path) {
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Nie mozna zabezpieczyc ACL pliku: $Path" }
}

function Restore-ProcessEnvironment([string]$Name, [string]$PreviousValue, [bool]$WasPresent) {
    if ($WasPresent) { [Environment]::SetEnvironmentVariable($Name, $PreviousValue, 'Process') }
    else { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
}

function Wait-PortalCentralConnection([string]$StatusUrl, [string]$ExpectedPortalId) {
    $deadline = (Get-Date).AddMinutes(2)
    $lastStatus = $null
    do {
        try {
            $raw = & curl.exe -k -sS --max-time 6 $StatusUrl
            if ($LASTEXITCODE -eq 0 -and $raw) {
                $lastStatus = ($raw | Out-String) | ConvertFrom-Json
                if ($lastStatus.central.connected -eq $true -and
                    [string]$lastStatus.central.portalId -eq $ExpectedPortalId -and
                    [string]$lastStatus.central.configurationSource -eq 'protected-file') {
                    return $lastStatus
                }
            }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    if ($lastStatus -and $lastStatus.central) {
        throw ("Portal zostal zainstalowany, ale Central nie zaakceptowal heartbeat. Status={0}; Error={1}; HTTP={2}" -f
            $lastStatus.central.status,
            $lastStatus.central.lastError,
            $lastStatus.central.lastStatusCode)
    }
    throw 'Portal zostal zainstalowany, ale nie udalo sie odczytac statusu polaczenia z Central.'
}

if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) { throw 'Port HTTPS jest nieprawidlowy.' }
if ($TrustCertificate -and $DoNotTrustCertificate) {
    throw 'Nie mozna jednoczesnie wlaczyc i wylaczyc zaufania certyfikatu.'
}
if ($Branch -notmatch '^[A-Za-z0-9._/-]{1,128}$' -or $Branch.Contains('..')) {
    throw 'Nazwa galezi Git jest nieprawidlowa.'
}

Write-Step 'Walidacja pliku polaczenia SIRK Central'
$sourceConnectionFile = Resolve-ConnectionFilePath $ConnectionFile
$connectionDocument = Read-CentralConnectionDocument $sourceConnectionFile

$defaultFqdn = ($env:COMPUTERNAME + '.local').ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($PortalFqdn)) {
    $PortalFqdn = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_FQDN', 'Process')
}
if ([string]::IsNullOrWhiteSpace($PortalFqdn)) {
    if ($ValidateOnly) { $PortalFqdn = $defaultFqdn }
    else {
        $PortalFqdn = Read-Host "Nazwa DNS Portalu [$defaultFqdn]"
        if ([string]::IsNullOrWhiteSpace($PortalFqdn)) { $PortalFqdn = $defaultFqdn }
    }
}
$PortalFqdn = $PortalFqdn.Trim().ToLowerInvariant()
if (-not (Test-DnsName $PortalFqdn)) { throw 'Nazwa DNS Portalu jest nieprawidlowa.' }

$portalUrl = if ($HttpsPort -eq 443) { "https://$PortalFqdn" } else { "https://$PortalFqdn`:$HttpsPort" }
if ([string]::IsNullOrWhiteSpace($PortalPublicUrl)) { $PortalPublicUrl = $portalUrl }
$PortalPublicUrl = $PortalPublicUrl.Trim().TrimEnd('/')
$portalPublicUri = $null
if (-not [Uri]::TryCreate($PortalPublicUrl, [UriKind]::Absolute, [ref]$portalPublicUri) -or
    -not (Test-OriginUri $portalPublicUri 'https')) {
    throw 'PortalPublicUrl musi byc pelnym origin HTTPS bez sciezki, query i fragmentu.'
}

if ($ValidateOnly) {
    Write-Host 'SIRK Portal connected installer validation: PASS' -ForegroundColor Green
    Write-Host ("Portal ID: " + [string]$connectionDocument.portalId)
    Write-Host ("Portal name: " + [string]$connectionDocument.portalName)
    Write-Host ("Central: " + [string]$connectionDocument.centralUrl)
    Write-Host ("Tunnel: " + [string]$connectionDocument.tunnelUrl)
    Write-Host ("Portal URL: " + $PortalPublicUrl)
    exit 0
}

if (-not (Test-Administrator)) { throw 'Uruchom PowerShell jako Administrator.' }

$existingIdentity = (-not $RemoveData) -and
    (Test-Path -LiteralPath (Join-Path $DataRoot 'identity.json') -PathType Leaf)
$plainPassword = $null
if (-not $existingIdentity) {
    $plainPassword = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_BREAKGLASS_PASSWORD', 'Process')
    if ([string]::IsNullOrWhiteSpace($plainPassword)) {
        $password1 = Read-Host 'Haslo administratora Break-Glass (minimum 14 znakow)' -AsSecureString
        $password2 = Read-Host 'Powtorz haslo' -AsSecureString
        $plain1 = ConvertFrom-SecureStringPlain $password1
        $plain2 = ConvertFrom-SecureStringPlain $password2
        if ($plain1 -cne $plain2) { throw 'Hasla nie sa identyczne.' }
        $plainPassword = $plain1
        $plain1 = $null
        $plain2 = $null
    }
    if ($plainPassword.Length -lt 14) { throw 'Haslo musi miec minimum 14 znakow.' }
}

$trustValue = $true
if ($DoNotTrustCertificate) { $trustValue = $false }
elseif ($TrustCertificate) { $trustValue = $true }
else {
    $configuredTrust = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_TRUST_CERTIFICATE', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($configuredTrust)) {
        $trustValue = $configuredTrust -notmatch '^(0|false|no|n|nie)$'
    }
}

$workRoot = Join-Path $env:TEMP ('SIRK-Portal-Connected-' + [guid]::NewGuid().ToString('N'))
$installerPath = Join-Path $workRoot 'install-dotnet10.ps1'
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

$passwordWasPresent = Test-Path Env:SIRK_INSTALL_BREAKGLASS_PASSWORD
$passwordPrevious = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_BREAKGLASS_PASSWORD', 'Process')
$fqdnWasPresent = Test-Path Env:SIRK_INSTALL_FQDN
$fqdnPrevious = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_FQDN', 'Process')
$trustWasPresent = Test-Path Env:SIRK_INSTALL_TRUST_CERTIFICATE
$trustPrevious = [Environment]::GetEnvironmentVariable('SIRK_INSTALL_TRUST_CERTIFICATE', 'Process')

try {
    Write-Step 'Pobieranie kanonicznego instalatora SIRK Portal .NET 10'
    $installerUrl = "https://raw.githubusercontent.com/Eris92/SIRK-Portal/$Branch/install-dotnet10.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath
    if ((Get-Item -LiteralPath $installerPath).Length -lt 10000) {
        throw 'Pobrany instalator SIRK Portal jest niekompletny.'
    }

    if (-not $existingIdentity) {
        [Environment]::SetEnvironmentVariable('SIRK_INSTALL_BREAKGLASS_PASSWORD', $plainPassword, 'Process')
    }
    [Environment]::SetEnvironmentVariable('SIRK_INSTALL_FQDN', $PortalFqdn, 'Process')
    [Environment]::SetEnvironmentVariable(
        'SIRK_INSTALL_TRUST_CERTIFICATE',
        $(if ($trustValue) { '1' } else { '0' }),
        'Process')

    Write-Step 'Instalacja SIRK Portal .NET 10'
    $installerArguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $installerPath,
        '-Branch', $Branch,
        '-InstallRoot', $InstallRoot,
        '-DataRoot', $DataRoot,
        '-HttpsPort', [string]$HttpsPort,
        '-BootstrapUserName', $BootstrapUserName,
        '-PortalFqdn', $PortalFqdn,
        '-NonInteractive'
    )
    if ($trustValue) { $installerArguments += '-TrustCertificate' }
    else { $installerArguments += '-DoNotTrustCertificate' }
    if ($RemoveData) { $installerArguments += '-RemoveData' }
    if ($KeepBuildSdk) { $installerArguments += '-KeepBuildSdk' }

    & powershell.exe @installerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Kanoniczny instalator SIRK Portal zakonczyl sie kodem $LASTEXITCODE."
    }

    Write-Step 'Import chronionego polaczenia SIRK Central'
    $serviceName = 'SirkPortal'
    $serviceWasStopped = $false
    $temporary = $null
    $destination = Join-Path $DataRoot 'central-connection.json'
    try {
        Stop-Service -Name $serviceName -Force -ErrorAction Stop
        (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        $serviceWasStopped = $true

        New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
        $temporary = Join-Path $DataRoot ('central-connection.tmp-' + [guid]::NewGuid().ToString('N') + '.json')

        Set-JsonProperty $connectionDocument 'publicUrl' $PortalPublicUrl
        Set-JsonProperty $connectionDocument 'updatedAtUtc' ([DateTimeOffset]::UtcNow.ToString('O'))
        Write-JsonNoBom $connectionDocument $temporary
        Protect-FileAcl $temporary
        Move-Item -LiteralPath $temporary -Destination $destination -Force
        $temporary = $null
        Protect-FileAcl $destination
    }
    finally {
        if ($temporary -and (Test-Path -LiteralPath $temporary -PathType Leaf)) {
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        }
        if ($serviceWasStopped) {
            $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($service -and $service.Status -ne 'Running') {
                Start-Service -Name $serviceName
            }
        }
    }

    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    Write-Step 'Weryfikacja heartbeat SIRK Portal -> SIRK Central'
    $statusUrl = if ($HttpsPort -eq 443) {
        'https://localhost/api/v1/portal/status'
    }
    else {
        "https://localhost`:$HttpsPort/api/v1/portal/status"
    }
    $status = Wait-PortalCentralConnection $statusUrl ([string]$connectionDocument.portalId)

    if (-not $KeepSourceConnectionFile -and
        (Test-Path -LiteralPath $sourceConnectionFile -PathType Leaf) -and
        -not [IO.Path]::GetFullPath($sourceConnectionFile).Equals(
            [IO.Path]::GetFullPath($destination),
            [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $sourceConnectionFile -Force
    }

    $accessPath = Join-Path $DataRoot 'security\break-glass-access-code.txt'
    $accessUrl = ''
    if (Test-Path -LiteralPath $accessPath -PathType Leaf) {
        $accessCode = (Get-Content -LiteralPath $accessPath -Raw -Encoding ASCII).Trim()
        if ($accessCode -match '^[A-Za-z0-9_-]{32,256}$') {
            $accessUrl = "$portalUrl/login#access=$accessCode"
        }
    }

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host 'SIRK Portal connected install: PASS' -ForegroundColor Green
    Write-Host ("Portal ID:          " + [string]$connectionDocument.portalId)
    Write-Host ("Portal name:        " + [string]$connectionDocument.portalName)
    Write-Host ("Portal URL:         " + $portalUrl)
    Write-Host ("Central:            " + [string]$connectionDocument.centralUrl)
    Write-Host ("Heartbeat:          " + [string]$status.central.status)
    Write-Host ("Configuration:      " + [string]$status.central.configurationSource)
    Write-Host ("Connection file:    " + $destination)
    if ($accessUrl) { Write-Host ("Break-Glass URL:    " + $accessUrl) -ForegroundColor Yellow }
    Write-Host '============================================================' -ForegroundColor Green
}
finally {
    $plainPassword = $null
    Restore-ProcessEnvironment 'SIRK_INSTALL_BREAKGLASS_PASSWORD' $passwordPrevious $passwordWasPresent
    Restore-ProcessEnvironment 'SIRK_INSTALL_FQDN' $fqdnPrevious $fqdnWasPresent
    Restore-ProcessEnvironment 'SIRK_INSTALL_TRUST_CERTIFICATE' $trustPrevious $trustWasPresent
    Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
