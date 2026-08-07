#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Fqdn = 'portal-ci.sirk.local'
$Port = 9443
$InstallRoot = 'C:\Program Files\SIRK\Portal'
$DataRoot = 'C:\ProgramData\SIRK\Portal'
$Password = 'CI-Portal-BreakGlass-Password-2026!'
$installer = Join-Path $env:RUNNER_TEMP 'SIRK-Portal-CI-Install.ps1'
$longTemp = Join-Path $env:RUNNER_TEMP ('SIRK-Portal-LongPath-' + ('nested-' * 8).TrimEnd('-'))
$originalTemp = $env:TEMP
$originalTmp = $env:TMP

function Remove-TestService {
    param([Parameter(Mandatory)][string]$Name)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) { return }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    & sc.exe delete $Name | Out-Null
}

function Wait-Ready {
    param([Parameter(Mandatory)][string]$BaseUrl,[int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            if ((Invoke-RestMethod "$BaseUrl/readyz" -TimeoutSec 5).status -eq 'ready') { return }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Portal did not become ready at $BaseUrl."
}

try {
    Remove-TestService SirkPortal
    Remove-TestService SirkUpdater
    Remove-Item $InstallRoot,$DataRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName 'SIRK Portal HTTPS' -ErrorAction SilentlyContinue
    Get-ChildItem Cert:\LocalMachine\My,Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
        Where-Object FriendlyName -eq 'SIRK Portal HTTPS' |
        Remove-Item -Force -ErrorAction SilentlyContinue

    New-Item -ItemType Directory -Path $longTemp -Force | Out-Null
    $env:TEMP = $longTemp
    $env:TMP = $longTemp
    $env:SIRK_INSTALL_BREAKGLASS_PASSWORD = $Password

    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "https://raw.githubusercontent.com/Eris92/SIRK-Portal/$Branch/install.ps1?nocache=$([guid]::NewGuid())" `
        -OutFile $installer

    & $installer `
        -Branch $Branch `
        -NonInteractive `
        -PortalFqdn $Fqdn `
        -HttpsPort $Port `
        -TrustCertificate `
        -KeepBuildSdk
    if ($LASTEXITCODE -ne 0) { throw "Portal installer returned exit code $LASTEXITCODE." }

    $baseUrl = "https://${Fqdn}:$Port"
    Wait-Ready -BaseUrl $baseUrl

    $portalService = Get-Service SirkPortal -ErrorAction Stop
    if ($portalService.Status -ne 'Running' -or $portalService.StartType -ne 'Automatic') {
        throw "Invalid SirkPortal service state: $($portalService.Status) / $($portalService.StartType)"
    }

    $updaterService = Get-Service SirkUpdater -ErrorAction Stop
    if ($updaterService.Status -ne 'Running' -or $updaterService.StartType -ne 'Automatic') {
        throw "Invalid SirkUpdater service state: $($updaterService.Status) / $($updaterService.StartType)"
    }

    $health = Invoke-RestMethod "$baseUrl/healthz"
    if ($health.status -ne 'healthy') { throw 'Portal health endpoint failed.' }
    $ready = Invoke-RestMethod "$baseUrl/readyz"
    if ($ready.status -ne 'ready') { throw 'Portal readiness endpoint failed.' }

    $bundle = (Invoke-WebRequest "$baseUrl/assets/bundles/portal-devices.bundle.js" -UseBasicParsing).Content
    if ($bundle -notmatch '__sirkPlatformDeviceTabsV16Loaded') { throw 'Current device bundle marker is missing.' }

    $shellIconCss = (Invoke-WebRequest "$baseUrl/portal/standalone/styles/shell-icons.css" -UseBasicParsing).Content
    foreach ($marker in @(
        '[data-action="sidebar"] svg',
        '.sirk-standalone-nav button[data-view] > span > svg',
        'stroke: currentColor !important',
        'visibility: visible !important',
        'svg :is(path,rect,circle,line,polyline,polygon,ellipse)'
    )) {
        if ($shellIconCss -notmatch [regex]::Escape($marker)) {
            throw "Loaded sidebar icon CSS marker missing: $marker"
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
    foreach ($marker in @('sirkStandaloneRoot','data-view="devices"','data-view="settings"','portal-module-shell.css')) {
        if ($portal -notmatch [regex]::Escape($marker)) { throw "Portal UI marker missing: $marker" }
    }

    $manualScript = Join-Path $DataRoot 'Files\management\Preserved\Manual test.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $manualScript) -Force | Out-Null
    Set-Content -LiteralPath $manualScript -Value '#PL Zachowany skrypt | Test reinstalacji danych.' -Encoding UTF8
    $identityPath = Join-Path $DataRoot 'identity.json'
    $identityHashBefore = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash
    $accessCodeBefore = (Get-Content (Join-Path $DataRoot 'security\break-glass-access-code.txt') -Raw).Trim()
    Remove-Item Env:SIRK_INSTALL_BREAKGLASS_PASSWORD -ErrorAction SilentlyContinue

    $reinstallOutput = @(& $installer -Branch $Branch -NonInteractive -PortalFqdn $Fqdn -HttpsPort $Port -TrustCertificate -SkipUpdater 6>&1)
    $reinstallOutput | Out-Host
    $reinstallText = (($reinstallOutput | Out-String) -replace '\s+', ' ').Trim()
    if (-not ($reinstallText.Contains('SIRK_PORTAL_DOTNET10_INSTALL_OK') -or $reinstallText.Contains('SIRK_PORTAL_BINARY_INSTALL_OK'))) {
        throw 'Preserve-data reinstallation did not complete successfully.'
    }
    # Do not infer preserve-data behavior from localized installer prose. The
    # durable data, identity and Break-Glass assertions below are the contract.
    if (-not (Test-Path -LiteralPath $manualScript -PathType Leaf)) {
        throw 'Manual Management script was removed during reinstallation.'
    }
    $identityHashAfter = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash
    if ($identityHashAfter -ne $identityHashBefore) {
        throw 'Portal identity changed during preserve-data reinstallation.'
    }
    $accessCodeAfter = (Get-Content (Join-Path $DataRoot 'security\break-glass-access-code.txt') -Raw).Trim()
    if ($accessCodeAfter -ne $accessCodeBefore) {
        throw 'Break-Glass Access Code changed during preserve-data reinstallation.'
    }
    if ((Invoke-RestMethod "$baseUrl/readyz").status -ne 'ready') {
        throw 'Portal is not ready after preserve-data reinstallation.'
    }

    Restart-Service SirkPortal -Force
    (Get-Service SirkPortal).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    Wait-Ready -BaseUrl $baseUrl

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
    $env:TEMP = $originalTemp
    $env:TMP = $originalTmp
    Remove-Item -LiteralPath $longTemp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-TestService SirkPortal
    Remove-TestService SirkUpdater
    Remove-NetFirewallRule -DisplayName 'SIRK Portal HTTPS' -ErrorAction SilentlyContinue
    Get-ChildItem Cert:\LocalMachine\My,Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
        Where-Object FriendlyName -eq 'SIRK Portal HTTPS' |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item 'C:\Program Files\SIRK\Portal','C:\ProgramData\SIRK\Portal' -Recurse -Force -ErrorAction SilentlyContinue
}