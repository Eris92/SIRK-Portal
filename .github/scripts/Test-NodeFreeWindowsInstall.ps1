#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Branch,
    [string]$Fqdn = 'portal-ci.sirk.local',
    [int]$Port = 9443,
    [string]$Password = 'Sirk-Portal-Windows-Installer-2026!'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:NO_PROXY = "$Fqdn,localhost,127.0.0.1"
$env:no_proxy = $env:NO_PROXY
$env:SIRK_INSTALL_FQDN = $Fqdn
$env:SIRK_INSTALL_BREAKGLASS_PASSWORD = $Password
$env:SIRK_INSTALL_TRUST_CERTIFICATE = 'true'

function Remove-TestService([string]$Name) {
    $service = Get-Service $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service $Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Name | Out-Null
    $global:LASTEXITCODE = 0
}

try {
    $source = Get-Content '.\install.ps1' -Raw -Encoding UTF8
    $installer = [scriptblock]::Create($source)
    & $installer -Branch $Branch -NonInteractive -RemoveData -PortalFqdn $Fqdn -HttpsPort $Port -TrustCertificate

    foreach ($name in @('SirkPortal','SirkUpdater')) {
        $service = Get-Service $name
        if ($service.Status -ne 'Running' -or $service.StartType -ne 'Automatic') {
            throw "Invalid service state for ${name}: $($service.Status) / $($service.StartType)"
        }
    }

    $portalService = Get-CimInstance Win32_Service -Filter "Name='SirkPortal'"
    if ($portalService.PathName -notmatch 'Sirk\.Portal\.exe') {
        throw "Invalid SirkPortal command: $($portalService.PathName)"
    }
    if ($portalService.PathName -match 'node|npm|winsw') {
        throw "Legacy runtime detected in service command: $($portalService.PathName)"
    }

    $certificate = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object FriendlyName -eq 'SIRK Portal HTTPS' |
        Sort-Object NotBefore -Descending |
        Select-Object -First 1
    if (-not $certificate -or -not $certificate.HasPrivateKey) { throw 'Portal certificate is missing.' }
    if (-not (Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $certificate.Thumbprint)) {
        throw 'Portal certificate is not trusted.'
    }

    $baseUrl = "https://$Fqdn`:$Port"
    if ((Invoke-RestMethod "$baseUrl/healthz").status -ne 'healthy') { throw 'Health failed.' }
    if ((Invoke-RestMethod "$baseUrl/readyz").status -ne 'ready') { throw 'Readiness failed.' }

    foreach ($asset in @(
        '/login',
        '/assets/portal-login.css',
        '/assets/portal-login.js',
        '/assets/portal-standalone.css',
        '/assets/standalone-core.js',
        '/assets/portal-standalone.js',
        '/assets/settings.js',
        '/assets/icons/sirk-ui.svg'
    )) {
        $response = Invoke-WebRequest ($baseUrl + $asset) -UseBasicParsing
        if ($response.StatusCode -ne 200 -or $response.RawContentLength -lt 10) {
            throw "Frontend asset failed: $asset"
        }
    }

    $loginPage = (Invoke-WebRequest "$baseUrl/login" -UseBasicParsing).Content
    foreach ($marker in @('id="sirkMicrosoftLogin"','id="sirkLocalLogin" class="sirk-local-login" hidden')) {
        if ($loginPage -notmatch [regex]::Escape($marker)) { throw "Login UI marker missing: $marker" }
    }
    if ($loginPage -match 'name="accessCode"') { throw 'Access Code field must not be rendered.' }

    $accessCode = (Get-Content 'C:\ProgramData\SIRK\Portal\security\break-glass-access-code.txt' -Raw).Trim()
    if ($accessCode.Length -lt 40) { throw 'Break-Glass access code is invalid.' }
    $authHeaders = @{ Authorization = "Bearer $accessCode" }
    $access = Invoke-RestMethod "$baseUrl/api/v1/auth/local-access" -Headers $authHeaders
    if ($access.ok -ne $true) { throw 'Portal access URL validation failed.' }

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $payload = @{ userName='admin'; password=$Password; accessCode=$accessCode } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod "$baseUrl/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body $payload -WebSession $session | Out-Null
        throw 'Local login without the access URL was unexpectedly accepted.'
    }
    catch {
        if ($_.Exception.Message -eq 'Local login without the access URL was unexpectedly accepted.') { throw }
        $status = [int]$_.Exception.Response.StatusCode
        if ($status -ne 404) { throw "Local login without access returned HTTP $status instead of 404." }
    }

    $login = Invoke-RestMethod "$baseUrl/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body $payload -Headers $authHeaders -WebSession $session
    if ($login.user.role -ne 'Break-Glass') { throw 'Break-Glass access URL login failed.' }

    $portal = (Invoke-WebRequest "$baseUrl/" -WebSession $session -UseBasicParsing).Content
    foreach ($marker in @('sirkStandaloneRoot','data-view="devices"','data-view="settings"')) {
        if ($portal -notmatch [regex]::Escape($marker)) { throw "Portal UI marker missing: $marker" }
    }

    Restart-Service SirkPortal -Force
    (Get-Service SirkPortal).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    $deadline = (Get-Date).AddMinutes(2)
    do {
        try {
            if ((Invoke-RestMethod "$baseUrl/readyz" -TimeoutSec 5).status -eq 'ready') { break }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if ((Invoke-RestMethod "$baseUrl/readyz").status -ne 'ready') { throw 'Portal restart recovery failed.' }

    Write-Host 'SIRK_PORTAL_WINDOWS_CLEAN_INSTALL_OK' -ForegroundColor Green
}
catch {
    Get-Service SirkPortal,SirkUpdater -ErrorAction SilentlyContinue | Format-List *
    Get-Content 'C:\ProgramData\SIRK\Logs\Portal-DotNet10-Install.log' -Tail 300 -ErrorAction SilentlyContinue
    Get-WinEvent -FilterHashtable @{ LogName='Application'; StartTime=(Get-Date).AddMinutes(-25) } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'Sirk\.Portal|SirkUpdater' } |
        Select-Object -First 50 | Format-List
    throw
}
finally {
    Remove-TestService SirkPortal
    Remove-TestService SirkUpdater
    Remove-NetFirewallRule -DisplayName 'SIRK Portal HTTPS' -ErrorAction SilentlyContinue
    Get-ChildItem Cert:\LocalMachine\My,Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
        Where-Object FriendlyName -eq 'SIRK Portal HTTPS' |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item 'C:\Program Files\SIRK\Portal','C:\ProgramData\SIRK\Portal' -Recurse -Force -ErrorAction SilentlyContinue
}
