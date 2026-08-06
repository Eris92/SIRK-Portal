from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8-sig")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}\n--- needle ---\n{old}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


maintenance = ROOT / "src/Sirk.Portal/Maintenance/PortalMaintenanceEndpoints.cs"
replace_once(
    maintenance,
    '                    branch = "rewrite/dotnet10-clean"',
    '                    branch = "main"')
replace_once(
    maintenance,
    '''                remote = new
                {
                    availableVersion = VersionInfo.Current,
                    updateAvailable = false,
                    error = (string?)null
                },''',
    '''                remote = new
                {
                    availableVersion = "main/latest",
                    updateAvailable = OperatingSystem.IsWindows(),
                    error = (string?)null
                },''')
replace_once(
    maintenance,
    '''                    restore = OperatingSystem.IsWindows(),
                    update = false''',
    '''                    restore = OperatingSystem.IsWindows(),
                    update = OperatingSystem.IsWindows()''')
replace_once(
    maintenance,
    '            AppendHistory("check", "Sprawdzono kanał aktualizacji.", null);',
    '            AppendHistory("check", "Sprawdzono kanał aktualizacji main/latest.", null);')

schedule_update = r'''
    public object ScheduleUpdate()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Aktualizacja Portalu jest dostępna tylko na Windows.");

        var lockPath = Path.Combine(_paths.DataRoot, "maintenance-update.lock");
        lock (_sync)
        {
            if (File.Exists(lockPath))
            {
                var age = DateTimeOffset.UtcNow - File.GetLastWriteTimeUtc(lockPath);
                if (age < TimeSpan.FromHours(2))
                    throw new InvalidOperationException("Aktualizacja Portalu jest już uruchomiona.");
                File.Delete(lockPath);
            }
            File.WriteAllText(lockPath, DateTimeOffset.UtcNow.ToString("O"));
            AtomicJsonFile.SecureFile(lockPath);
        }

        var installRoot = AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        var settingsPath = Path.Combine(installRoot, "appsettings.Production.json");
        if (!File.Exists(settingsPath))
        {
            File.Delete(lockPath);
            throw new InvalidOperationException("Brak appsettings.Production.json wymaganych do aktualizacji.");
        }

        var logRoot = Path.Combine(_paths.DataRoot, "Logs");
        Directory.CreateDirectory(logRoot);
        AtomicJsonFile.SecureDirectory(logRoot);
        var logPath = Path.Combine(
            logRoot,
            "gui-update-" + DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss") + ".log");

        var script = $$"""
Start-Sleep -Seconds 2
$installRoot={{QuotePs(installRoot)}}
$dataRoot={{QuotePs(_paths.DataRoot)}}
$settingsPath={{QuotePs(settingsPath)}}
$lockPath={{QuotePs(lockPath)}}
$logPath={{QuotePs(logPath)}}
$bootstrap=Join-Path ([IO.Path]::GetTempPath()) ('SIRK-Portal-Gui-Update-' + [guid]::NewGuid().ToString('N') + '.ps1')
$transcriptStarted=$false
try {
    Start-Transcript -LiteralPath $logPath -Append | Out-Null
    $transcriptStarted=$true
    $settings=Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $httpsEndpoint=[uri][string]$settings.Kestrel.Endpoints.Https.Url
    $publicUri=[uri][string]$settings.Sirk.Central.PublicUrl
    $portalFqdn=[string]$publicUri.DnsSafeHost
    $httpsPort=[int]$httpsEndpoint.Port
    if([string]::IsNullOrWhiteSpace($portalFqdn)){throw 'Nie można ustalić FQDN Portalu z konfiguracji.'}
    if($httpsPort -lt 1 -or $httpsPort -gt 65535){throw 'Nie można ustalić portu HTTPS Portalu z konfiguracji.'}
    Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install.ps1?nocache=' + [guid]::NewGuid()) -OutFile $bootstrap
    & $bootstrap -Branch 'main' -InstallRoot $installRoot -DataRoot $dataRoot -HttpsPort $httpsPort -PortalFqdn $portalFqdn -TrustCertificate -NonInteractive -KeepBuildSdk
    if(-not $?){throw 'Instalator SIRK Portal zakończył się błędem.'}
}
finally {
    if($transcriptStarted){try{Stop-Transcript | Out-Null}catch{}}
    Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
""";

        try
        {
            StartHelperScript("update", script);
        }
        catch
        {
            File.Delete(lockPath);
            throw;
        }

        lock (_sync)
        {
            AppendHistory(
                "update",
                "Uruchomiono aktualizację Portalu z main/latest. Log: " + logPath,
                null);
            Save();
        }
        return new
        {
            accepted = true,
            action = "update",
            channel = "main",
            logPath
        };
    }

'''
replace_once(
    maintenance,
    '    public object ScheduleRestore(string? id)\n',
    schedule_update + '    public object ScheduleRestore(string? id)\n')
replace_once(
    maintenance,
    '''        group.MapPost("/restart", RestartAsync);
        group.MapPost("/restore", RestoreAsync);''',
    '''        group.MapPost("/restart", RestartAsync);
        group.MapPost("/update", UpdateAsync);
        group.MapPost("/restore", RestoreAsync);''')
update_endpoint = '''
    private static async Task<IResult> UpdateAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(
            context,
            antiforgery,
            audit,
            "maintenance.update",
            "main/latest",
            store.ScheduleUpdate);

'''
replace_once(
    maintenance,
    '    private static async Task<IResult> RestoreAsync(\n',
    update_endpoint + '    private static async Task<IResult> RestoreAsync(\n')

installer = ROOT / "install-dotnet10.ps1"
replace_once(
    installer,
    '''    $localOrigin = if ($HttpsPort -eq 443) { 'https://localhost/' } else { "https://localhost`:$HttpsPort/" }''',
    '''    # Central dispatches delegated requests through an IPv4 loopback-only HTTP listener.
    # This avoids localhost resolving to ::1 while the public HTTPS endpoint is IPv4-bound.
    $localOrigin = 'http://127.0.0.1:8080/' ''')
replace_once(
    installer,
    '''        Kestrel = @{ Endpoints = @{ Https = @{ Url = "https://0.0.0.0:$HttpsPort"; Certificate = @{ Path = $pfxPath; Password = $pfxPassword } } } }''',
    '''        Kestrel = @{
            Endpoints = @{
                Https = @{
                    Url = "https://0.0.0.0:$HttpsPort"
                    Certificate = @{ Path = $pfxPath; Password = $pfxPassword }
                }
                TunnelLoopback = @{ Url = 'http://127.0.0.1:8080' }
            }
        }''')

settings_ui = ROOT / "public/portal/standalone/scripts/settings-native-v2.js"
replace_once(
    settings_ui,
    '''        var updateNow = button("Aktualizuj teraz", function () { maintenance("update", {}, true); });''',
    '''        var updateNow = button("Aktualizuj teraz", function () {
            if (window.confirm("Zainstalować najnowszą wersję Portalu z gałęzi main? Dane, konfiguracja, certyfikat zaufany i cache SDK zostaną zachowane.")) {
                maintenance("update", {}, true);
            }
        });''')
replace_once(
    settings_ui,
    '''        if (!capabilities.update) updates.appendChild(el("p", "sirk-muted", "Przycisk uaktywni się, gdy kanał udostępni zweryfikowany pakiet obsługiwany przez SIRK Updater."));''',
    '''        if (capabilities.update) updates.appendChild(el("p", "sirk-muted", "Aktualizacja działa w tle z main/latest, zachowuje ProgramData i używa cache izolowanego .NET SDK."));
        else updates.appendChild(el("p", "sirk-muted", "Aktualizacja z GUI jest dostępna tylko na Windows."));''')

contract = ROOT / "tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs"
text = contract.read_text(encoding="utf-8-sig")
needle = '''        var headerContextScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "header-toggle-context-menu.js"));
        var bundler = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));'''
replacement = '''        var headerContextScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "header-toggle-context-menu.js"));
        var maintenanceScript = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Maintenance", "PortalMaintenanceEndpoints.cs"));
        var installerScript = File.ReadAllText(Path.Combine(root, "install-dotnet10.ps1"));
        var settingsScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "settings-native-v2.js"));
        var bundler = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Ui", "PortalAssetBundler.cs"));'''
if needle not in text:
    raise SystemExit("Contract variable marker not found")
text = text.replace(needle, replacement, 1)
marker = '''        Require(headerContextScript.Contains("#sirkConnectionHeaderToggle", StringComparison.Ordinal) &&'''
checks = '''        Require(maintenanceScript.Contains("group.MapPost(\\\"/update\\\", UpdateAsync)", StringComparison.Ordinal) &&
                maintenanceScript.Contains("public object ScheduleUpdate()", StringComparison.Ordinal) &&
                maintenanceScript.Contains("-KeepBuildSdk", StringComparison.Ordinal) &&
                maintenanceScript.Contains("-TrustCertificate", StringComparison.Ordinal) &&
                maintenanceScript.Contains("maintenance-update.lock", StringComparison.Ordinal),
            "Portal maintenance must provide a serialized GUI update that preserves data, trust and the isolated SDK cache.");
        Require(installerScript.Contains("TunnelLoopback = @{ Url = 'http://127.0.0.1:8080' }", StringComparison.Ordinal) &&
                installerScript.Contains("$localOrigin = 'http://127.0.0.1:8080/'", StringComparison.Ordinal),
            "Central tunnel dispatch must use a dedicated IPv4 loopback listener instead of localhost HTTPS.");
        Require(settingsScript.Contains("maintenance(\\\"update\\\", {}, true)", StringComparison.Ordinal) &&
                settingsScript.Contains("najnowszą wersję Portalu z gałęzi main", StringComparison.Ordinal),
            "Portal settings must expose a confirmed application-level update action.");

'''
if marker not in text:
    raise SystemExit("Contract insertion marker not found")
contract.write_text(text.replace(marker, checks + marker, 1), encoding="utf-8")

print("GUI updater and Central tunnel fix applied.")
