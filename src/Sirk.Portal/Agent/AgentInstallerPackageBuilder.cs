using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace Sirk.Portal.Agent;

internal sealed record GeneratedAgentInstaller(
    byte[] Content,
    string FileName);

internal static partial class AgentInstallerPackageBuilder
{
    private const int MaximumInstallerBytes = 32 * 1024 * 1024;

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{2,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex GroupIdPattern();

    [GeneratedRegex("^install-[a-f0-9]{20}\\.[A-Za-z0-9_-]{40,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex TicketPattern();

    public static async Task<GeneratedAgentInstaller> BuildAsync(
        string portalOrigin,
        string groupId,
        string enrollmentTicket,
        string channel,
        CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException(
                "On-demand SIRK Agent EXE generation requires Windows and the built-in IExpress tool.");

        var origin = ValidatePortalOrigin(portalOrigin);
        var normalizedGroupId = (groupId ?? string.Empty).Trim().ToLowerInvariant();
        if (!GroupIdPattern().IsMatch(normalizedGroupId))
            throw new InvalidDataException("Agent installer group ID is invalid.");

        var normalizedTicket = (enrollmentTicket ?? string.Empty).Trim();
        if (!TicketPattern().IsMatch(normalizedTicket))
            throw new InvalidDataException("Agent installer enrollment ticket is invalid.");

        var normalizedChannel = (channel ?? string.Empty).Trim().ToLowerInvariant();
        if (normalizedChannel is not ("stable" or "dev"))
            throw new InvalidDataException("Agent installer channel must be stable or dev.");

        var windowsRoot = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows";
        var iexpress = Path.Combine(windowsRoot, "System32", "iexpress.exe");
        if (!File.Exists(iexpress))
            throw new FileNotFoundException("Windows IExpress was not found.", iexpress);

        var workRoot = Path.Combine(
            windowsRoot,
            "Temp",
            "SIRK-Agent-Installer-" + Guid.NewGuid().ToString("N"));
        var scriptPath = Path.Combine(workRoot, "Install.ps1");
        var sedPath = Path.Combine(workRoot, "Package.sed");
        var outputPath = Path.Combine(workRoot, "SIRK-Agent-Installer.exe");

        Directory.CreateDirectory(workRoot);
        try
        {
            File.WriteAllText(
                scriptPath,
                BuildBootstrapScript(origin, normalizedGroupId, normalizedTicket, normalizedChannel),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            File.WriteAllText(
                sedPath,
                BuildSed(workRoot, outputPath, normalizedGroupId),
                Encoding.ASCII);

            var start = new ProcessStartInfo(iexpress)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            start.ArgumentList.Add("/N");
            start.ArgumentList.Add("/Q");
            start.ArgumentList.Add(sedPath);

            using var process = Process.Start(start)
                ?? throw new InvalidOperationException("Windows IExpress could not be started.");
            var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var output = (await stdout + Environment.NewLine + await stderr).Trim();
            if (process.ExitCode != 0)
                throw new InvalidOperationException(
                    $"Windows IExpress failed with exit code {process.ExitCode}: {output}");

            var file = new FileInfo(outputPath);
            if (!file.Exists || file.Length is < 4096 or > MaximumInstallerBytes)
                throw new InvalidDataException("Generated SIRK Agent installer has an invalid size.");

            var bytes = await File.ReadAllBytesAsync(outputPath, cancellationToken);
            if (bytes.Length < 2 || bytes[0] != (byte)'M' || bytes[1] != (byte)'Z')
                throw new InvalidDataException("Generated SIRK Agent installer is not a Windows executable.");

            return new GeneratedAgentInstaller(
                bytes,
                $"SIRK-Agent-{normalizedGroupId}-Installer.exe");
        }
        finally
        {
            TryDeleteDirectory(workRoot);
        }
    }

    private static Uri ValidatePortalOrigin(string value)
    {
        if (!Uri.TryCreate((value ?? string.Empty).Trim(), UriKind.Absolute, out var uri) ||
            uri is null ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            (uri.AbsolutePath.Length > 0 && uri.AbsolutePath != "/"))
        {
            throw new InvalidDataException(
                "Agent installer Portal origin must be an HTTPS origin without credentials, path, query or fragment.");
        }
        return new Uri(uri.GetLeftPart(UriPartial.Authority), UriKind.Absolute);
    }

    private static string BuildBootstrapScript(
        Uri origin,
        string groupId,
        string enrollmentTicket,
        string channel) => $$"""
        #requires -Version 5.1
        #requires -RunAsAdministrator
        $ErrorActionPreference = 'Stop'
        Set-StrictMode -Version Latest
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $PortalUrl = '{{EscapePowerShell(origin.GetLeftPart(UriPartial.Authority))}}'
        $GroupId = '{{EscapePowerShell(groupId)}}'
        $EnrollmentTicket = '{{EscapePowerShell(enrollmentTicket)}}'
        $Channel = '{{EscapePowerShell(channel)}}'
        $LogRoot = Join-Path $env:ProgramData 'SIRK\Logs'
        $LogPath = Join-Path $LogRoot ('Agent-Group-Installer-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
        $Installer = Join-Path $env:TEMP ('Install-SirkAgent-' + [guid]::NewGuid().ToString('N') + '.ps1')
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        try {
            Start-Transcript -Path $LogPath -Force | Out-Null
            Write-Host ('SIRK Agent group installer started. Group=' + $GroupId + ' Portal=' + $PortalUrl)
            Invoke-WebRequest -UseBasicParsing -Uri ($PortalUrl + '/api/v1/agent/install-script') -OutFile $Installer
            & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Installer `
                -PortalUrl $PortalUrl `
                -GroupId $GroupId `
                -EnrollmentToken $EnrollmentTicket `
                -Channel $Channel `
                -Mode Silent
            $ExitCode = $LASTEXITCODE
            if ($ExitCode -ne 0) {
                throw "SIRK Agent installer failed with exit code $ExitCode."
            }
            $RequiredCli = 'C:\Program Files\SIRK\Agent\sirkctl.exe'
            if (-not (Test-Path -LiteralPath $RequiredCli -PathType Leaf)) {
                throw "SIRK Agent installation returned success but the installed CLI is missing: $RequiredCli"
            }
            Get-Service SirkAgent,SirkAgentWatchdog,SirkUpdater -ErrorAction Stop | ForEach-Object {
                if ($_.Status -ne 'Running') {
                    throw "SIRK Agent service $($_.Name) is not running after installation."
                }
            }
            Write-Host 'SIRK_AGENT_GROUP_INSTALLER_OK' -ForegroundColor Green
        }
        catch {
            Write-Error $_
            exit 1
        }
        finally {
            Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
            Remove-Item -LiteralPath $Installer -Force -ErrorAction SilentlyContinue
            Remove-Variable EnrollmentTicket -ErrorAction SilentlyContinue
        }
        exit 0
        """;

    private static string BuildSed(
        string sourceDirectory,
        string targetPath,
        string groupId) => $$"""
        [Version]
        Class=IEXPRESS
        SEDVersion=3
        [Options]
        PackagePurpose=InstallApp
        ShowInstallProgramWindow=0
        HideExtractAnimation=1
        UseLongFileName=1
        InsideCompressed=0
        CAB_FixedSize=0
        CAB_ResvCodeSigning=0
        RebootMode=N
        InstallPrompt=%InstallPrompt%
        DisplayLicense=%DisplayLicense%
        FinishMessage=%FinishMessage%
        TargetName=%TargetName%
        FriendlyName=%FriendlyName%
        AppLaunched=%AppLaunched%
        PostInstallCmd=%PostInstallCmd%
        AdminQuietInstCmd=%AdminQuietInstCmd%
        UserQuietInstCmd=%UserQuietInstCmd%
        SourceFiles=SourceFiles
        [Strings]
        InstallPrompt=
        DisplayLicense=
        FinishMessage=
        TargetName={{targetPath}}
        FriendlyName=SIRK Agent installer - {{groupId}}
        AppLaunched=powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File Install.ps1
        PostInstallCmd=<None>
        AdminQuietInstCmd=powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File Install.ps1
        UserQuietInstCmd=powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File Install.ps1
        FILE0="Install.ps1"
        [SourceFiles]
        SourceFiles0={{sourceDirectory}}\
        [SourceFiles0]
        %FILE0%=
        """;

    private static string EscapePowerShell(string value) =>
        value.Replace("'", "''", StringComparison.Ordinal);

    private static void TryDeleteDirectory(string path)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
                return;
            }
            catch (IOException) when (attempt < 4)
            {
                Thread.Sleep(200);
            }
            catch (UnauthorizedAccessException) when (attempt < 4)
            {
                Thread.Sleep(200);
            }
        }
    }
}
