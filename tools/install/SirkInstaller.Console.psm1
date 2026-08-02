Set-StrictMode -Version Latest

$script:SirkInstallerLogPath = $null
$script:SirkInstallerStarted = Get-Date

function Initialize-SirkInstallerConsole {
    [CmdletBinding()]
    param(
        [string]$Component = 'SIRK Component',
        [string]$Version = 'unknown',
        [string]$Channel = 'develop',
        [string]$LogPath = 'C:\ProgramData\SIRK\Logs\Install.log'
    )

    $script:SirkInstallerStarted = Get-Date
    $script:SirkInstallerLogPath = $LogPath
    $logDirectory = Split-Path -Parent $LogPath
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

    Write-SirkBanner -Title 'SIRK Platform Installer'
    Write-SirkKeyValue -Name 'Component' -Value $Component
    Write-SirkKeyValue -Name 'Version' -Value $Version
    Write-SirkKeyValue -Name 'Channel' -Value $Channel
    Write-SirkKeyValue -Name 'Log' -Value $LogPath
}

function Write-SirkLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('INFO','OK','WARNING','ERROR','INPUT')][string]$Level = 'INFO'
    )

    if (-not $script:SirkInstallerLogPath) { return }
    $line = '{0:o} [{1}] {2}' -f (Get-Date), $Level, $Message
    Add-Content -LiteralPath $script:SirkInstallerLogPath -Value $line -Encoding UTF8
}

function Write-SirkBanner {
    param([Parameter(Mandatory)][string]$Title)
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host (" {0}" -f $Title) -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-SirkLog -Message $Title
}

function Write-SirkStep {
    param(
        [Parameter(Mandatory)][int]$Number,
        [Parameter(Mandatory)][int]$Total,
        [Parameter(Mandatory)][string]$Text
    )
    $message = '[{0:D2}/{1:D2}] {2}' -f $Number, $Total, $Text
    Write-Host "`n$message" -ForegroundColor Cyan
    Write-SirkLog -Message $message
}

function Write-SirkOk {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor Green
    Write-SirkLog -Message $Text -Level OK
}

function Write-SirkWarning {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host "[WARNING] $Text" -ForegroundColor Yellow
    Write-SirkLog -Message $Text -Level WARNING
}

function Write-SirkError {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor Red
    Write-SirkLog -Message $Text -Level ERROR
}

function Write-SirkInputRequired {
    param([Parameter(Mandatory)][string]$Text)
    Write-Host "`n============================================================" -ForegroundColor Yellow
    Write-Host ' INPUT REQUIRED' -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host " $Text" -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Yellow
    Write-SirkLog -Message $Text -Level INPUT
}

function Write-SirkKeyValue {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowEmptyString()][string]$Value,
        [ConsoleColor]$ValueColor = [ConsoleColor]::White
    )
    Write-Host ("{0,-18}: " -f $Name) -NoNewline -ForegroundColor DarkGray
    Write-Host $Value -ForegroundColor $ValueColor
    Write-SirkLog -Message "$Name=$Value"
}

function Read-SirkYesNo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [bool]$DefaultYes = $true
    )

    $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        Write-SirkInputRequired "$Prompt $suffix"
        $answer = (Read-Host 'Selection').Trim().ToLowerInvariant()
        if (-not $answer) { return $DefaultYes }
        if ($answer -in @('y','yes','t','tak')) { return $true }
        if ($answer -in @('n','no','nie')) { return $false }
        Write-SirkWarning 'Enter Y or N.'
    }
}

function Copy-SirkValue {
    param(
        [Parameter(Mandatory)][string]$Value,
        [string]$Label = 'Value'
    )
    try {
        Set-Clipboard -Value $Value
        Write-SirkOk "$Label copied to clipboard."
        return $true
    }
    catch {
        Write-SirkWarning "$Label could not be copied to clipboard: $($_.Exception.Message)"
        return $false
    }
}

function Invoke-SirkDownload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][uri]$Uri,
        [Parameter(Mandatory)][string]$Destination,
        [string]$DisplayName = 'Package'
    )

    $directory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null

    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.AllowAutoRedirect = $true
    $request.UserAgent = 'SIRK-Installer/2.0'
    $response = $request.GetResponse()
    try {
        $total = [int64]$response.ContentLength
        $input = $response.GetResponseStream()
        $output = [IO.File]::Open($Destination, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $buffer = New-Object byte[] 1048576
            $readTotal = [int64]0
            $watch = [Diagnostics.Stopwatch]::StartNew()
            while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                $readTotal += $read
                $elapsed = [Math]::Max($watch.Elapsed.TotalSeconds, 0.1)
                $speed = $readTotal / $elapsed
                $percent = if ($total -gt 0) { [Math]::Min(100, [int](($readTotal * 100) / $total)) } else { 0 }
                $status = if ($total -gt 0) {
                    '{0:N1} MB / {1:N1} MB | {2:N1} MB/s' -f ($readTotal / 1MB), ($total / 1MB), ($speed / 1MB)
                } else {
                    '{0:N1} MB | {1:N1} MB/s' -f ($readTotal / 1MB), ($speed / 1MB)
                }
                Write-Progress -Activity "Downloading $DisplayName" -Status $status -PercentComplete $percent
            }
            Write-Progress -Activity "Downloading $DisplayName" -Completed
            Write-SirkOk "$DisplayName downloaded: $([Math]::Round($readTotal / 1MB, 1)) MB."
        }
        finally {
            $output.Dispose()
            $input.Dispose()
        }
    }
    finally {
        $response.Dispose()
    }
}

function Add-SirkTrustedCertificate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','LocalMachine')
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Add($Certificate)
    }
    finally {
        $store.Close()
    }
    Write-SirkOk "Certificate trusted in LocalMachine\\Root: $($Certificate.Thumbprint)"
}

function Show-SirkInstallationSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Values,
        [string[]]$CopyValues = @(),
        [string]$SuccessCode = 'SIRK_INSTALL_OK'
    )

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host ' INSTALLATION COMPLETED' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    foreach ($entry in $Values.GetEnumerator()) {
        $color = if ([string]$entry.Value -match 'Running|OK|Trusted|Completed') { [ConsoleColor]::Green } else { [ConsoleColor]::Cyan }
        Write-SirkKeyValue -Name ([string]$entry.Name) -Value ([string]$entry.Value) -ValueColor $color
    }
    Write-SirkKeyValue -Name 'Installation time' -Value ((Get-Date) - $script:SirkInstallerStarted).ToString('hh\:mm\:ss') -ValueColor Green
    if ($script:SirkInstallerLogPath) { Write-SirkKeyValue -Name 'Installation log' -Value $script:SirkInstallerLogPath -ValueColor Cyan }
    foreach ($value in $CopyValues) { [void](Copy-SirkValue -Value $value -Label 'URL') }
    Write-Host $SuccessCode -ForegroundColor Green
    Write-SirkLog -Message $SuccessCode -Level OK
}

Export-ModuleMember -Function @(
    'Initialize-SirkInstallerConsole','Write-SirkLog','Write-SirkBanner','Write-SirkStep',
    'Write-SirkOk','Write-SirkWarning','Write-SirkError','Write-SirkInputRequired',
    'Write-SirkKeyValue','Read-SirkYesNo','Copy-SirkValue','Invoke-SirkDownload',
    'Add-SirkTrustedCertificate','Show-SirkInstallationSummary'
)
