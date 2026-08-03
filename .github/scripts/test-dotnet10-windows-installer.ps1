[CmdletBinding()]
param(
    [string]$PortalFqdn = 'portal-ci.sirk.local',
    [int]$HttpsPort = 9443,
    [string]$BreakGlassPassword = 'Sirk-Portal-Windows-Installer-2026!',
    [string]$Branch = 'rewrite/dotnet10-clean'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$InstallerPath = Join-Path $RepositoryRoot 'install-dotnet10.ps1'
$InstallRoot = 'C:\Program Files\SIRK\Portal'
$DataRoot = 'C:\ProgramData\SIRK\Portal'
$BackupRoot = 'C:\ProgramData\SIRK\Portal Backups'
$BaseUrl = "https://$PortalFqdn`:$HttpsPort"
$AccessFile = Join-Path $DataRoot 'security\break-glass-access-code.txt'

function Test-InstallerSyntax {
    $source = Get-Content -LiteralPath $InstallerPath -Raw -Encoding UTF8
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput(
        $source,
        [ref]$tokens,
        [ref]$errors) | Out-Null
    if ($errors.Count) {
        throw ('Installer syntax errors: ' + (($errors | ForEach-Object Message) -join '; '))
    }
}

function Wait-PortalReady {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    do {
        try {
            $ready = Invoke-RestMethod -Uri "$BaseUrl/readyz" -TimeoutSec 5
            if ($ready.status -eq 'ready') { return }
        }
        catch { $lastError = $_ }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Portal did not become ready: $lastError"
}

function New-PortalSession {
    if (-not (Test-Path -LiteralPath $AccessFile)) {
        throw 'Break-Glass access code file is missing.'
    }
    $accessCode = (Get-Content -LiteralPath $AccessFile -Raw).Trim()
    if ($accessCode.Length -lt 40) { throw 'Access Code is missing or too short.' }

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $payload = @{
        userName = 'admin'
        password = $BreakGlassPassword
        accessCode = $accessCode
    } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/login" `
        -Method Post `
        -ContentType 'application/json; charset=utf-8' `
        -Body $payload `
        -WebSession $session `
        -TimeoutSec 15
    if ($login.user.role -ne 'Break-Glass') { throw 'Break-Glass login failed.' }
    return $session
}

function Get-CsrfHeaders {
    param([Parameter(Mandatory)][Microsoft.PowerShell.Commands.WebRequestSession]$Session)
    $csrf = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/csrf" -WebSession $Session -TimeoutSec 10
    if (-not $csrf.requestToken) { throw 'CSRF token was not issued.' }
    return @{ 'X-SIRK-CSRF' = [string]$csrf.requestToken }
}

function Invoke-PortalPost {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][object]$Body,
        [Parameter(Mandatory)][Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [Parameter(Mandatory)][hashtable]$Headers
    )
    return Invoke-RestMethod -Uri ($BaseUrl + $Path) `
        -Method Post `
        -ContentType 'application/json; charset=utf-8' `
        -Body ($Body | ConvertTo-Json -Depth 12 -Compress) `
        -WebSession $Session `
        -Headers $Headers `
        -TimeoutSec 30
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Description
    )
    if ($Value -notmatch [regex]::Escape($Marker)) {
        throw "$Description marker is missing: $Marker"
    }
}

Test-InstallerSyntax
$env:NO_PROXY = "$PortalFqdn,localhost,127.0.0.1"
$env:no_proxy = $env:NO_PROXY
$env:SIRK_INSTALL_FQDN = $PortalFqdn
$env:SIRK_INSTALL_BREAKGLASS_PASSWORD = $BreakGlassPassword
$env:SIRK_INSTALL_TRUST_CERTIFICATE = 'true'

$source = Get-Content -LiteralPath $InstallerPath -Raw -Encoding UTF8
$installer = [scriptblock]::Create($source)
& $installer `
    -Branch $Branch `
    -NonInteractive `
    -RemoveData `
    -PortalFqdn $PortalFqdn `
    -HttpsPort $HttpsPort `
    -TrustCertificate

Wait-PortalReady
$service = Get-CimInstance Win32_Service -Filter "Name='SirkPortal'"
if (-not $service -or $service.State -ne 'Running' -or $service.StartMode -ne 'Auto') {
    throw "Invalid service state: $($service.State) / $($service.StartMode)"
}
$expectedExecutable = Join-Path $InstallRoot 'Sirk.Portal.exe'
if ($service.PathName -notmatch [regex]::Escape($expectedExecutable)) {
    throw "Invalid service command line: $($service.PathName)"
}
if (Get-ChildItem -LiteralPath $InstallRoot -Recurse -Filter node.exe -ErrorAction SilentlyContinue) {
    throw 'Legacy Node.js runtime is present in the native installation.'
}

$personal = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object FriendlyName -eq 'SIRK Portal HTTPS' |
    Sort-Object NotBefore -Descending |
    Select-Object -First 1
if (-not $personal -or -not $personal.HasPrivateKey) {
    throw 'Portal certificate with private key is missing.'
}
$dnsNames = @($personal.DnsNameList | ForEach-Object Unicode)
foreach ($required in @($PortalFqdn, $env:COMPUTERNAME.ToLowerInvariant(), 'localhost')) {
    if ($dnsNames -notcontains $required.ToLowerInvariant()) {
        throw "Certificate SAN is missing: $required. Actual: $($dnsNames -join ', ')"
    }
}
$trusted = Get-ChildItem Cert:\LocalMachine\Root |
    Where-Object Thumbprint -eq $personal.Thumbprint |
    Select-Object -First 1
if (-not $trusted) { throw 'Portal certificate is not trusted in LocalMachine\Root.' }

$health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 10
$ready = Invoke-RestMethod -Uri "$BaseUrl/readyz" -TimeoutSec 10
if ($health.status -ne 'healthy' -or $ready.status -ne 'ready') {
    throw 'Portal health/readiness check failed.'
}
$loginPage = (Invoke-WebRequest -Uri "$BaseUrl/login" -UseBasicParsing -TimeoutSec 10).Content
foreach ($marker in @('sirk-login-page', '/assets/portal-login.css', 'name="accessCode"')) {
    Assert-Contains -Value $loginPage -Marker $marker -Description 'Login UI'
}
foreach ($asset in @(
    '/assets/portal-login.css',
    '/assets/portal-standalone.css',
    '/assets/standalone-core.js',
    '/assets/portal-standalone.js',
    '/assets/settings.js',
    '/assets/icons/sirk-ui.svg'
)) {
    $response = Invoke-WebRequest -Uri ($BaseUrl + $asset) -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -ne 200 -or $response.RawContentLength -lt 10) {
        throw "Frontend asset failed: $asset"
    }
}
$settingsAsset = (Invoke-WebRequest -Uri "$BaseUrl/assets/settings.js" -UseBasicParsing -TimeoutSec 10).Content
foreach ($marker in @('data-portal-settings-native', '/api/v1/admin/maintenance/status', '"Break-Glass"')) {
    Assert-Contains -Value $settingsAsset -Marker $marker -Description 'Native settings'
}
if ($settingsAsset -match '/api/admin/settings' -or $settingsAsset -match 'plugin-operation') {
    throw 'Legacy settings API is active.'
}

$session = New-PortalSession
$portal = (Invoke-WebRequest -Uri "$BaseUrl/" -WebSession $session -UseBasicParsing -TimeoutSec 10).Content
foreach ($marker in @('sirkStandaloneRoot', 'data-view="devices"', 'data-view="settings"')) {
    Assert-Contains -Value $portal -Marker $marker -Description 'Portal shell'
}
$settings = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/settings" -WebSession $session -TimeoutSec 10
if (-not $settings.value.modules -or -not $settings.value.identity) {
    throw 'Native settings API is incomplete.'
}
$maintenance = Invoke-RestMethod -Uri "$BaseUrl/api/v1/admin/maintenance/status" -WebSession $session -TimeoutSec 10
if (-not $maintenance.value.capabilities.backup -or -not $maintenance.value.capabilities.restore) {
    throw 'Native Windows maintenance capabilities are incomplete.'
}
$headers = Get-CsrfHeaders -Session $session

$backup = Invoke-PortalPost `
    -Path '/api/v1/admin/maintenance/backup' `
    -Body @{ reason = 'windows-installer-e2e' } `
    -Session $session `
    -Headers $headers
$backupRecord = @($backup.value.backups)[0]
if (-not $backupRecord.id) { throw 'Backup operation did not return a record.' }
$backupPath = Join-Path $BackupRoot ($backupRecord.id + '.zip')
if (-not (Test-Path -LiteralPath $backupPath) -or (Get-Item -LiteralPath $backupPath).Length -le 0) {
    throw "Backup archive was not created: $backupPath"
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($backupPath)
try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    if ($entries -notcontains 'identity.json' -or $entries -notcontains 'settings.json') {
        throw 'Backup archive is missing critical Portal data.'
    }
    if ($entries | Where-Object { $_ -like 'backups/*' -or $_ -like '*.zip' }) {
        throw 'Backup archive recursively contains backup files.'
    }
}
finally { $archive.Dispose() }

$markerPath = Join-Path $DataRoot 'restore-marker.txt'
Set-Content -LiteralPath $markerPath -Value 'must-disappear-after-restore' -Encoding ASCII

$null = Invoke-PortalPost `
    -Path '/api/v1/admin/maintenance/restart' `
    -Body @{} `
    -Session $session `
    -Headers $headers
Start-Sleep -Seconds 4
Wait-PortalReady
if ((Get-Service SirkPortal).Status -ne 'Running') {
    throw 'Portal did not recover after native restart.'
}

$session = New-PortalSession
$headers = Get-CsrfHeaders -Session $session
$null = Invoke-PortalPost `
    -Path '/api/v1/admin/maintenance/restore' `
    -Body @{ id = $backupRecord.id } `
    -Session $session `
    -Headers $headers
Start-Sleep -Seconds 5
Wait-PortalReady
if (Test-Path -LiteralPath $markerPath) {
    throw 'Restore did not replace DataRoot with the selected backup.'
}
if ((Get-Service SirkPortal).Status -ne 'Running') {
    throw 'Portal did not recover after restore.'
}
$restoredHealth = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 10
if ($restoredHealth.status -ne 'healthy') { throw 'Portal is unhealthy after restore.' }

Write-Host 'SIRK Portal Windows installer HTTPS/UI/backup/restart/restore E2E: OK' -ForegroundColor Green
