#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [string]$InstallRoot = 'C:\Program Files\SIRK\Portal',
    [string]$DataRoot = 'C:\ProgramData\SIRK\Portal'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    throw 'Portal signed updater E2E requires the CI GitHub read token.'
}

$updaterCli = 'C:\Program Files\SIRK\Updater\SirkUpdater.exe'
$updaterManifestPath = 'C:\ProgramData\SIRK\Updater\applications\sirk-portal.json'
$configPath = Join-Path $InstallRoot 'appsettings.Production.json'
$identityPath = Join-Path $DataRoot 'identity.json'
$accessCodePath = Join-Path $DataRoot 'security\break-glass-access-code.txt'
$maintenanceLock = Join-Path $DataRoot 'maintenance.lock'
$root = Join-Path $env:RUNNER_TEMP ('SIRK-Portal-Signed-Update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null

function Assert-ServiceHealthy {
    foreach ($name in @('SirkPortal','SirkUpdater')) {
        $service = Get-Service -Name $name -ErrorAction Stop
        if ($service.Status -ne 'Running' -or $service.StartType -ne 'Automatic') {
            throw "Invalid service state after Portal update transaction for ${name}: $($service.Status) / $($service.StartType)"
        }
    }
    if (Test-Path -LiteralPath $maintenanceLock -PathType Leaf) {
        throw "Updater left Portal maintenance lock behind: $maintenanceLock"
    }
}

function Wait-PortalReady {
    param([int]$TimeoutSeconds = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            if ((Invoke-RestMethod "$BaseUrl/readyz" -TimeoutSec 5).status -eq 'ready') { return }
        }
        catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Portal did not return ready after updater transaction at $BaseUrl."
}

function Invoke-Updater {
    param(
        [Parameter(Mandatory)][string]$PackagePath,
        [Parameter(Mandatory)][string]$Sha256,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][int]$ExpectedExitCode,
        [Parameter(Mandatory)][string]$Label,
        [int]$HealthTimeoutSeconds = 30
    )
    $stdout = Join-Path $root ("updater-$Label.stdout.log")
    $stderr = Join-Path $root ("updater-$Label.stderr.log")
    $previousTimeout = $env:SIRK_UPDATER_HEALTH_TIMEOUT_SECONDS
    $env:SIRK_UPDATER_HEALTH_TIMEOUT_SECONDS = [string]$HealthTimeoutSeconds
    try {
        $arguments = 'update sirk-portal "{0}" {1} {2}' -f $PackagePath,$Sha256,$Version
        $process = Start-Process -FilePath $updaterCli `
            -ArgumentList $arguments `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -Wait `
            -PassThru
    }
    finally {
        $env:SIRK_UPDATER_HEALTH_TIMEOUT_SECONDS = $previousTimeout
    }
    $outText = [string](Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)
    $errText = [string](Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
    if ($outText) { Write-Host $outText }
    if ($errText) { Write-Host $errText }
    if ($process.ExitCode -ne $ExpectedExitCode) {
        throw "SIRK Updater Portal $Label transaction returned ExitCode=$($process.ExitCode), expected $ExpectedExitCode."
    }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $outText; StdErr = $errText }
}

function Start-SentinelHealthServer {
    param([Parameter(Mandatory)][string]$SentinelPath)
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    $port = ([Net.IPEndPoint]$probe.LocalEndpoint).Port
    $probe.Stop()

    $stopFile = Join-Path $root 'rollback-health.stop'
    $scriptPath = Join-Path $root 'rollback-health.ps1'
    Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
    $sentinelLiteral = $SentinelPath.Replace("'", "''")
    $stopLiteral = $stopFile.Replace("'", "''")
    $script = @"
`$ErrorActionPreference = 'Stop'
`$sentinel = '$sentinelLiteral'
`$stop = '$stopLiteral'
`$listener = [Net.HttpListener]::new()
`$listener.Prefixes.Add('http://127.0.0.1:$port/')
`$listener.Start()
try {
    while (-not (Test-Path -LiteralPath `$stop)) {
        `$async = `$listener.BeginGetContext(`$null, `$null)
        while (-not `$async.AsyncWaitHandle.WaitOne(200)) {
            if (Test-Path -LiteralPath `$stop) { break }
        }
        if (Test-Path -LiteralPath `$stop) { break }
        `$context = `$listener.EndGetContext(`$async)
        `$healthy = Test-Path -LiteralPath `$sentinel -PathType Leaf
        `$context.Response.StatusCode = if (`$healthy) { 200 } else { 503 }
        `$body = if (`$healthy) { 'healthy' } else { 'update-active' }
        `$bytes = [Text.Encoding]::UTF8.GetBytes(`$body)
        `$context.Response.ContentLength64 = `$bytes.Length
        `$context.Response.OutputStream.Write(`$bytes, 0, `$bytes.Length)
        `$context.Response.Close()
    }
}
finally {
    `$listener.Stop()
    `$listener.Close()
}
"@
    Set-Content -LiteralPath $scriptPath -Value $script -Encoding UTF8
    $process = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptPath) `
        -WindowStyle Hidden `
        -PassThru
    $uri = "http://127.0.0.1:$port/health"
    $deadline = (Get-Date).AddSeconds(15)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return [pscustomobject]@{ Process = $process; StopFile = $stopFile; Uri = $uri }
            }
        }
        catch {}
        if ($process.HasExited) { throw "Rollback health server exited early with code $($process.ExitCode)." }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Rollback health server did not become ready.'
}

function Stop-SentinelHealthServer {
    param([object]$Server)
    if (-not $Server) { return }
    Set-Content -LiteralPath $Server.StopFile -Value 'stop' -Encoding ASCII
    try { $Server.Process.WaitForExit(5000) | Out-Null } catch {}
    if (-not $Server.Process.HasExited) {
        Stop-Process -Id $Server.Process.Id -Force -ErrorAction SilentlyContinue
    }
}

try {
    foreach ($required in @($updaterCli,$updaterManifestPath,$configPath,$identityPath,$accessCodePath,(Join-Path $InstallRoot 'Sirk.Portal.exe'),(Join-Path $InstallRoot 'release-trusted-keys.json'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required Portal update E2E file is missing: $required"
        }
    }

    $installedManifestText = Get-Content -LiteralPath $updaterManifestPath -Raw -Encoding UTF8
    $installedManifest = $installedManifestText | ConvertFrom-Json
    $preserved = @($installedManifest.preserveFiles | ForEach-Object { [string]$_ })
    if ($installedManifest.applicationId -ne 'sirk-portal' -or
        $installedManifest.updateSource -ne 'sirk-central-cache' -or
        $installedManifest.signatureRequired -ne $true -or
        -not ($preserved -contains 'appsettings.Production.json')) {
        throw 'Installed Portal Updater manifest does not enforce Central-cache signing and mutable configuration preservation.'
    }
    if (-not [string]::Equals([string]$installedManifest.signatureVerifierPath, (Join-Path $InstallRoot 'Sirk.Portal.exe'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Installed Portal Updater verifier path mismatch: $($installedManifest.signatureVerifierPath)"
    }
    $verifierArguments = @($installedManifest.signatureVerifierArguments | ForEach-Object { [string]$_ })
    if (-not ($verifierArguments -contains '{payload}') -or
        -not ($verifierArguments -contains '--verify-update-payload') -or
        -not ($verifierArguments -contains '--trusted-keys')) {
        throw 'Installed Portal Updater manifest does not delegate signed payload verification to Sirk.Portal.'
    }

    # This token use is CI-only. Installed Portal runtime still obtains updates only
    # from SIRK Central; GitHub is used here solely to acquire the exact published
    # release artifact already independently verified by PlatformUpdateCache E2E.
    $headers = @{
        Accept = 'application/vnd.github+json'
        Authorization = "Bearer $env:GITHUB_TOKEN"
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent' = 'SIRK-Portal-Signed-Update-E2E'
    }
    $response = Invoke-WebRequest `
        -UseBasicParsing `
        -Headers $headers `
        -Uri 'https://api.github.com/repos/Eris92/SIRK-Portal/releases?per_page=30' `
        -TimeoutSec 30
    $parsed = ConvertFrom-Json -InputObject $response.Content
    $releases = @()
    if ($parsed -is [System.Array]) {
        foreach ($release in $parsed) { $releases += $release }
    }
    else {
        $releases += $parsed
    }

    $candidates = @()
    foreach ($release in $releases) {
        $tag = [string]$release.tag_name
        if ($release.draft -or -not $release.prerelease -or $tag -notmatch '^v0\.1\.1\.\d+$') { continue }
        $version = $tag.Substring(1)
        $descriptorName = "SIRK-Portal-$version-win-x64.update.json"
        $packageName = "SIRK-Portal-$version-win-x64.zip"
        $descriptorAsset = @($release.assets | Where-Object { [string]$_.name -eq $descriptorName })
        $packageAsset = @($release.assets | Where-Object { [string]$_.name -eq $packageName })
        if ($descriptorAsset.Count -eq 1 -and $packageAsset.Count -eq 1) {
            $candidates += [pscustomobject]@{
                Version = [version]$version
                VersionText = $version
                Descriptor = $descriptorAsset[0]
                Package = $packageAsset[0]
            }
        }
    }
    $selected = @($candidates | Sort-Object Version -Descending | Select-Object -First 1)
    if ($selected.Count -ne 1) { throw 'No signed immutable Portal preview win-x64 release was found.' }

    $versionText = [string]$selected[0].VersionText
    $descriptorPath = Join-Path $root ([string]$selected[0].Descriptor.name)
    $packagePath = Join-Path $root ([string]$selected[0].Package.name)
    $assetHeaders = @{
        Accept = 'application/octet-stream'
        Authorization = "Bearer $env:GITHUB_TOKEN"
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent' = 'SIRK-Portal-Signed-Update-E2E'
    }
    Invoke-WebRequest -UseBasicParsing -Headers $assetHeaders -Uri ([string]$selected[0].Descriptor.url) -OutFile $descriptorPath -TimeoutSec 30
    Invoke-WebRequest -UseBasicParsing -Headers $assetHeaders -Uri ([string]$selected[0].Package.url) -OutFile $packagePath -TimeoutSec 120

    $descriptor = Get-Content -LiteralPath $descriptorPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $expectedPackageName = "SIRK-Portal-$versionText-win-x64.zip"
    if ($descriptor.schemaVersion -ne 1 -or
        $descriptor.applicationId -ne 'sirk-portal' -or
        $descriptor.product -ne 'SIRK Portal' -or
        $descriptor.version -ne $versionText -or
        $descriptor.runtime -ne 'win-x64' -or
        $descriptor.channel -ne 'preview' -or
        $descriptor.assetName -ne $expectedPackageName -or
        [string]$descriptor.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or
        [int64]$descriptor.size -le 0 -or
        $descriptor.signature.algorithm -ne 'ES256' -or
        $descriptor.signature.keyId -ne 'sirk-release-2026-08-v1' -or
        [string]::IsNullOrWhiteSpace([string]$descriptor.signature.value)) {
        throw 'Published Portal win-x64 signed descriptor metadata is invalid.'
    }
    $actualSize = (Get-Item -LiteralPath $packagePath).Length
    $actualSha = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSize -ne [int64]$descriptor.size -or $actualSha -cne ([string]$descriptor.sha256).ToLowerInvariant()) {
        throw 'Published Portal package size/SHA does not match the signed descriptor.'
    }

    $configHashBefore = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
    $configAclBefore = (Get-Acl -LiteralPath $configPath).Sddl
    $identityHashBefore = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash
    $accessCodeBefore = (Get-Content -LiteralPath $accessCodePath -Raw).Trim()

    $positive = Invoke-Updater `
        -PackagePath $packagePath `
        -Sha256 ([string]$descriptor.sha256) `
        -Version $versionText `
        -ExpectedExitCode 0 `
        -Label 'positive'
    $positiveState = $positive.StdOut | ConvertFrom-Json
    if ($positiveState.phase -ne 'completed' -or $positiveState.progress -ne 100) {
        throw 'Positive Portal SIRK Updater transaction did not reach Completed/100.'
    }
    if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ne $configHashBefore) {
        throw 'Portal machine-specific appsettings.Production.json changed during signed update.'
    }
    if ((Get-Acl -LiteralPath $configPath).Sddl -cne $configAclBefore) {
        throw 'Portal machine-specific appsettings.Production.json ACL changed during signed update.'
    }
    if ((Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash -ne $identityHashBefore -or
        (Get-Content -LiteralPath $accessCodePath -Raw).Trim() -cne $accessCodeBefore) {
        throw 'Portal durable identity changed during signed update.'
    }
    Assert-ServiceHealthy
    Wait-PortalReady
    Write-Host "SIRK_PORTAL_UPDATER_REAL_PACKAGE_E2E_OK version=$versionText" -ForegroundColor Green

    $sentinel = Join-Path $InstallRoot 'e2e-rollback-sentinel.txt'
    Set-Content -LiteralPath $sentinel -Value ([guid]::NewGuid().ToString('N')) -Encoding ASCII
    $server = $null
    $originalManifestPath = Join-Path $root 'sirk-portal-updater-original.json'
    $rollbackManifestPath = Join-Path $root 'sirk-portal-updater-rollback.json'
    Set-Content -LiteralPath $originalManifestPath -Value $installedManifestText -Encoding UTF8
    try {
        $server = Start-SentinelHealthServer -SentinelPath $sentinel
        $rollbackManifest = $installedManifestText | ConvertFrom-Json
        $rollbackManifest.healthUrl = $server.Uri
        $rollbackManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $rollbackManifestPath -Encoding UTF8
        & $updaterCli register $rollbackManifestPath | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Could not register Portal rollback E2E manifest.' }

        $failed = Invoke-Updater `
            -PackagePath $packagePath `
            -Sha256 ([string]$descriptor.sha256) `
            -Version $versionText `
            -ExpectedExitCode 3 `
            -Label 'rollback' `
            -HealthTimeoutSeconds 5
        $failedState = $failed.StdErr | ConvertFrom-Json
        if ($failedState.phase -ne 'failed' -or $failedState.message -notmatch 'rollback was attempted') {
            throw 'Portal rollback E2E did not expose the expected failed-after-rollback state.'
        }
        if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
            throw 'Portal rollback did not restore the pre-update sentinel from backup.'
        }
        if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ne $configHashBefore) {
            throw 'Portal machine-specific configuration changed during rollback.'
        }
        if ((Get-Acl -LiteralPath $configPath).Sddl -cne $configAclBefore) {
            throw 'Portal machine-specific configuration ACL changed during rollback.'
        }
        Assert-ServiceHealthy
        Wait-PortalReady
        Write-Host "SIRK_PORTAL_UPDATER_ROLLBACK_E2E_OK version=$versionText" -ForegroundColor Green
    }
    finally {
        Stop-SentinelHealthServer -Server $server
        if (Test-Path -LiteralPath $originalManifestPath -PathType Leaf) {
            & $updaterCli register $originalManifestPath | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'Could not restore the original Portal Updater manifest.' }
        }
        Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
    }

    Assert-ServiceHealthy
    Write-Host 'SIRK_PORTAL_UPDATER_TRANSACTION_AND_ROLLBACK_E2E_OK' -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
