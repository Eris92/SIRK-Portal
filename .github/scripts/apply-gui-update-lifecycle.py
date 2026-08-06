from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: marker not found")
    if text.count(old) != 1:
        raise SystemExit(f"{label}: marker is not unique")
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start] + replacement + text[end:]


root = Path(__file__).resolve().parents[2]
backend_path = root / "src" / "Sirk.Portal" / "Maintenance" / "PortalMaintenanceEndpoints.cs"
settings_path = root / "public" / "portal" / "standalone" / "scripts" / "settings-native-v2.js"
test_path = root / "tests" / "Sirk.Portal.ProtocolTests" / "GuiUpdaterLifecycleContract.cs"

backend = backend_path.read_text(encoding="utf-8-sig")
backend = replace_once(
    backend,
    "using System.Diagnostics;\nusing System.IO.Compression;\n",
    "using System.Diagnostics;\nusing System.Globalization;\nusing System.IO.Compression;\nusing System.Text;\n",
    "backend usings",
)
backend = replace_once(
    backend,
    "                jobs = new Dictionary<string, object>(),\n",
    "                jobs = new Dictionary<string, object>\n                {\n                    [\"update\"] = UpdateJobSnapshotLocked()\n                },\n",
    "maintenance jobs snapshot",
)

schedule_update = r'''    public object ScheduleUpdate()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Aktualizacja Portalu jest dostępna tylko na Windows.");

        var lockPath = UpdateLockPath();
        lock (_sync)
        {
            if (UpdateIsActiveLocked())
                throw new InvalidOperationException("Aktualizacja Portalu jest już uruchomiona.");
            File.Delete(lockPath);
            File.WriteAllText(lockPath, "0", Encoding.ASCII);
            AtomicJsonFile.SecureFile(lockPath);
        }

        var installRoot = AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar);
        var settingsPath = Path.Combine(installRoot, "appsettings.Production.json");
        if (!File.Exists(settingsPath))
        {
            File.Delete(lockPath);
            throw new InvalidOperationException(
                "Brak appsettings.Production.json wymaganych do aktualizacji.");
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
$success=$false
try {
    ('Start GUI update: ' + [DateTimeOffset]::UtcNow.ToString('O')) | Set-Content -LiteralPath $logPath -Encoding UTF8
    $settings=Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $httpsEndpoint=[uri][string]$settings.Kestrel.Endpoints.Https.Url
    $publicUri=[uri][string]$settings.Sirk.Central.PublicUrl
    $portalFqdn=[string]$publicUri.DnsSafeHost
    $httpsPort=[int]$httpsEndpoint.Port
    if([string]::IsNullOrWhiteSpace($portalFqdn)){throw 'Nie można ustalić FQDN Portalu z konfiguracji.'}
    if($httpsPort -lt 1 -or $httpsPort -gt 65535){throw 'Nie można ustalić portu HTTPS Portalu z konfiguracji.'}
    Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install.ps1?nocache=' + [guid]::NewGuid()) -OutFile $bootstrap
    & $bootstrap -Branch 'main' -InstallRoot $installRoot -DataRoot $dataRoot -HttpsPort $httpsPort -PortalFqdn $portalFqdn -TrustCertificate -NonInteractive -KeepBuildSdk *>> $logPath
    if(-not $?){throw 'Instalator SIRK Portal zakończył się błędem.'}
    'SIRK_GUI_UPDATE_SUCCEEDED' | Add-Content -LiteralPath $logPath -Encoding UTF8
    $success=$true
}
catch {
    $message=$_.Exception.Message
    ('SIRK_GUI_UPDATE_FAILED: ' + $message) | Add-Content -LiteralPath $logPath -Encoding UTF8
    ($_ | Out-String) | Add-Content -LiteralPath $logPath -Encoding UTF8
}
finally {
    Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
if(-not $success){throw 'Aktualizacja SIRK Portal zakończyła się błędem. Sprawdź log GUI update.'}
""";

        int processId;
        try
        {
            using var process = StartHelperScript("update", script);
            processId = process.Id;
            lock (_sync)
            {
                File.WriteAllText(
                    lockPath,
                    processId.ToString(CultureInfo.InvariantCulture),
                    Encoding.ASCII);
                AtomicJsonFile.SecureFile(lockPath);
                AppendHistory(
                    "update",
                    "Uruchomiono aktualizację Portalu z main/latest. PID: " +
                    processId.ToString(CultureInfo.InvariantCulture) + ". Log: " + logPath,
                    null);
                Save();
            }
        }
        catch
        {
            File.Delete(lockPath);
            throw;
        }

        object job;
        lock (_sync)
        {
            job = UpdateJobSnapshotLocked();
        }
        return new
        {
            accepted = true,
            action = "update",
            channel = "main",
            logPath,
            processId,
            job
        };
    }

'''
backend = replace_between(
    backend,
    "    public object ScheduleUpdate()\n",
    "    public object ScheduleRestore",
    schedule_update,
    "ScheduleUpdate",
)

helper_block = r'''    private Process StartHelperScript(string action, string scriptBody)
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            "sirk-portal-" + action + "-" + Guid.NewGuid().ToString("N") + ".ps1");
        File.WriteAllText(
            path,
            "$ErrorActionPreference='Stop'\r\ntry {\r\n" + scriptBody +
            "\r\n}\r\nfinally {\r\n" +
            "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n" +
            "}\r\n",
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-NonInteractive");
        start.ArgumentList.Add("-ExecutionPolicy");
        start.ArgumentList.Add("Bypass");
        start.ArgumentList.Add("-File");
        start.ArgumentList.Add(path);
        return Process.Start(start)
               ?? throw new InvalidOperationException(
                   "Nie można uruchomić pomocniczego procesu maintenance.");
    }

    private object UpdateJobSnapshotLocked()
    {
        var active = UpdateIsActiveLocked();
        var lockPath = UpdateLockPath();
        var processId = 0;
        if (File.Exists(lockPath))
        {
            _ = int.TryParse(
                File.ReadAllText(lockPath, Encoding.ASCII).Trim(),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out processId);
        }

        var logPath = LatestUpdateLogPath();
        var logTail = ReadLogTail(logPath);
        var state = active
            ? "running"
            : logTail.Contains("SIRK_GUI_UPDATE_FAILED:", StringComparison.Ordinal)
                ? "failed"
                : logTail.Contains("SIRK_GUI_UPDATE_SUCCEEDED", StringComparison.Ordinal)
                    ? "succeeded"
                    : "idle";
        DateTimeOffset? startedAtUtc = File.Exists(lockPath)
            ? new DateTimeOffset(File.GetCreationTimeUtc(lockPath), TimeSpan.Zero)
            : logPath is null
                ? null
                : new DateTimeOffset(File.GetCreationTimeUtc(logPath), TimeSpan.Zero);
        DateTimeOffset? completedAtUtc = !active && logPath is not null
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(logPath), TimeSpan.Zero)
            : null;
        return new
        {
            state,
            active,
            processId = processId > 0 ? processId : (int?)null,
            startedAtUtc,
            completedAtUtc,
            logPath,
            logTail,
            error = state == "failed"
                ? "Aktualizacja zakończyła się błędem. Szczegóły znajdują się w logu."
                : null
        };
    }

    private bool UpdateIsActiveLocked()
    {
        var lockPath = UpdateLockPath();
        if (!File.Exists(lockPath)) return false;

        var value = File.ReadAllText(lockPath, Encoding.ASCII).Trim();
        var age = DateTimeOffset.UtcNow - new DateTimeOffset(
            File.GetLastWriteTimeUtc(lockPath),
            TimeSpan.Zero);
        if (int.TryParse(
                value,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var processId) &&
            processId > 0 &&
            IsProcessRunning(processId))
        {
            return true;
        }

        if ((value == "0" && age < TimeSpan.FromSeconds(30)) ||
            (!int.TryParse(value, out _) && age < TimeSpan.FromMinutes(5)))
        {
            return true;
        }

        File.Delete(lockPath);
        return false;
    }

    private string UpdateLockPath() =>
        Path.Combine(_paths.DataRoot, "maintenance-update.lock");

    private string? LatestUpdateLogPath()
    {
        var logRoot = Path.Combine(_paths.DataRoot, "Logs");
        if (!Directory.Exists(logRoot)) return null;
        return Directory.GetFiles(logRoot, "gui-update-*.log", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    private static string ReadLogTail(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return string.Empty;
        try
        {
            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var length = (int)Math.Min(stream.Length, 16 * 1024);
            if (length <= 0) return string.Empty;
            stream.Seek(-length, SeekOrigin.End);
            var buffer = new byte[length];
            var read = stream.Read(buffer, 0, buffer.Length);
            return Encoding.UTF8.GetString(buffer, 0, read).Trim();
        }
        catch (IOException)
        {
            return string.Empty;
        }
    }

    private static bool IsProcessRunning(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited &&
                   process.ProcessName.Contains("powershell", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

'''
backend = replace_between(
    backend,
    "    private void StartHelperScript(string action, string scriptBody)\n",
    "    private PortalBackupRecord FindBackup",
    helper_block,
    "StartHelperScript and update lifecycle helpers",
)
backend_path.write_text(backend, encoding="utf-8")

settings = settings_path.read_text(encoding="utf-8-sig")
settings = replace_once(
    settings,
    "        page: null,\n        mountGeneration: 0\n",
    "        page: null,\n        mountGeneration: 0,\n        updatePollToken: 0\n",
    "settings state update poll token",
)

maintenance_block = r'''    function maintenanceUpdateJob() {
        var jobs = state.maintenance && state.maintenance.jobs || {};
        return jobs.update || { state: "idle", active: false };
    }

    function pollMaintenanceUpdate(token) {
        if (token !== state.updatePollToken || !state.page) return;
        api("/api/v1/admin/maintenance/status").then(function (result) {
            if (token !== state.updatePollToken || !state.page) return;
            state.maintenance = result.value;
            renderAll();
            var job = maintenanceUpdateJob();
            if (job.active || job.state === "running") {
                setTimeout(function () { pollMaintenanceUpdate(token); }, 2000);
                return;
            }
            if (job.state === "succeeded") {
                location.reload();
            }
        }).catch(function () {
            if (token !== state.updatePollToken || !state.page) return;
            setTimeout(function () { pollMaintenanceUpdate(token); }, 1500);
        });
    }

    function startMaintenanceUpdatePolling(delay) {
        var token = ++state.updatePollToken;
        setTimeout(function () { pollMaintenanceUpdate(token); }, delay || 0);
    }

    function startMaintenanceUpdate() {
        var existing = maintenanceUpdateJob();
        if (existing.active || existing.state === "running") {
            startMaintenanceUpdatePolling(250);
            renderAll();
            return;
        }
        api("/api/v1/admin/maintenance/update", "POST", {}).then(function (result) {
            state.maintenance.jobs = state.maintenance.jobs || {};
            state.maintenance.jobs.update = result.value && result.value.job || {
                state: "running",
                active: true,
                processId: result.value && result.value.processId || null,
                logPath: result.value && result.value.logPath || ""
            };
            renderAll();
            startMaintenanceUpdatePolling(750);
        }).catch(function (error) {
            api("/api/v1/admin/maintenance/status").then(function (result) {
                state.maintenance = result.value;
                renderAll();
                if (maintenanceUpdateJob().active) startMaintenanceUpdatePolling(500);
                else showError(error);
            }).catch(function () { showError(error); });
        });
    }

    function maintenance(action, body, restart) {
        if (action === "update") {
            startMaintenanceUpdate();
            return;
        }
        api("/api/v1/admin/maintenance/" + action, "POST", body || {}).then(function (result) {
            if (restart) {
                clear(state.page.details);
                state.page.details.appendChild(card("Oczekiwanie na usługę", "Operacja została zaplanowana."));
                setTimeout(function poll() {
                    fetch("/readyz", { cache: "no-store" }).then(function (response) {
                        if (!response.ok) throw new Error("starting");
                        location.reload();
                    }).catch(function () { setTimeout(poll, 1500); });
                }, 4000);
                return;
            }
            state.maintenance = result.value;
            renderAll();
        }).catch(showError);
    }

'''
settings = replace_between(
    settings,
    "    function maintenance(action, body, restart) {\n",
    "    function tabDefinitions()",
    maintenance_block,
    "settings maintenance lifecycle",
)

render_updates = r'''    function renderUpdates(host) {
        var current = state.maintenance.current || {};
        var remote = state.maintenance.remote || {};
        var capabilities = state.maintenance.capabilities || {};
        var job = maintenanceUpdateJob();
        var updates = card("Aktualizacje", "Wersja: " + (current.version || "—") + " · dostępna: " + (remote.availableVersion || "—"));
        var channel = field("Kanał", current.channel || "dev", "select", [["stable", "Stable"], ["beta", "Beta"], ["dev", "Dev"]]);
        channel.input.disabled = job.active === true;
        updates.appendChild(channel.wrapper);
        var actions = actionRow();
        var saveChannel = button("Zapisz kanał", function () { maintenance("channel", { channel: channel.input.value }, false); });
        var checkUpdate = button("Sprawdź aktualizacje", function () { maintenance("check", {}, false); });
        var updateNow = button(job.active ? "Aktualizacja trwa…" : "Aktualizuj teraz", function () { maintenance("update", {}, true); });
        saveChannel.disabled = job.active === true;
        checkUpdate.disabled = job.active === true;
        updateNow.disabled = job.active === true || !(capabilities.update && remote.updateAvailable);
        updateNow.title = job.active
            ? "Aktualizacja działa w tle. Stan i log są odświeżane automatycznie."
            : updateNow.disabled
                ? "Brak nowszego zweryfikowanego pakietu aktualizacji."
                : "Zainstaluj zweryfikowaną aktualizację przez SIRK Updater.";
        actions.appendChild(saveChannel);
        actions.appendChild(checkUpdate);
        actions.appendChild(updateNow);
        updates.appendChild(actions);
        updates.appendChild(el("p", "", remote.updateAvailable ? "Dostępna jest aktualizacja." : "System jest aktualny dla skonfigurowanego kanału."));

        if (job.state && job.state !== "idle") {
            var labels = {
                running: "Aktualizacja jest wykonywana w tle",
                succeeded: "Aktualizacja zakończyła się poprawnie",
                failed: "Aktualizacja zakończyła się błędem"
            };
            var status = el("section", "sirk-card sirk-maintenance-update-job");
            status.appendChild(el("h3", job.state === "failed" ? "sirk-error" : "", labels[job.state] || job.state));
            if (job.processId) status.appendChild(el("p", "", "PID procesu: " + job.processId));
            if (job.startedAtUtc) status.appendChild(el("p", "", "Uruchomiono: " + new Date(job.startedAtUtc).toLocaleString()));
            if (job.completedAtUtc && !job.active) status.appendChild(el("p", "", "Zakończono: " + new Date(job.completedAtUtc).toLocaleString()));
            if (job.logPath) status.appendChild(el("p", "sirk-muted", "Log: " + job.logPath));
            if (job.error) status.appendChild(el("p", "sirk-error", job.error));
            if (job.logTail) {
                var output = el("pre", "sirk-maintenance-log-tail", job.logTail);
                output.setAttribute("aria-label", "Końcówka logu aktualizacji");
                status.appendChild(output);
            }
            updates.appendChild(status);
        }
        if (!capabilities.update) updates.appendChild(el("p", "sirk-muted", "Przycisk uaktywni się, gdy kanał udostępni zweryfikowany pakiet obsługiwany przez SIRK Updater."));
        host.appendChild(updates);
    }

'''
settings = replace_between(
    settings,
    "    function renderUpdates(host) {\n",
    "    function renderBackups(host) {",
    render_updates,
    "renderUpdates",
)
settings = replace_once(
    settings,
    "        state.csrf = \"\";\n    }\n\n    function mount(host) {\n",
    "        state.csrf = \"\";\n        state.updatePollToken += 1;\n    }\n\n    function mount(host) {\n",
    "unmount update polling cancellation",
)
settings = replace_once(
    settings,
    "            renderAll();\n        }).catch(function (error) {\n",
    "            renderAll();\n            if (maintenanceUpdateJob().active) startMaintenanceUpdatePolling(500);\n        }).catch(function (error) {\n",
    "mount active update polling",
)
settings_path.write_text(settings, encoding="utf-8")

test_path.write_text(
    r'''using System.Runtime.CompilerServices;

namespace Sirk.Portal.ProtocolTests;

internal static class GuiUpdaterLifecycleContract
{
    [ModuleInitializer]
    internal static void Run()
    {
        var root = FindRepositoryRoot();
        var backend = File.ReadAllText(Path.Combine(
            root,
            "src",
            "Sirk.Portal",
            "Maintenance",
            "PortalMaintenanceEndpoints.cs"));
        var settings = File.ReadAllText(Path.Combine(
            root,
            "public",
            "portal",
            "standalone",
            "scripts",
            "settings-native-v2.js"));

        Require(
            backend.Contains("UpdateIsActiveLocked()", StringComparison.Ordinal) &&
            backend.Contains("process.ProcessName.Contains(\"powershell\"", StringComparison.Ordinal) &&
            backend.Contains("SIRK_GUI_UPDATE_SUCCEEDED", StringComparison.Ordinal) &&
            backend.Contains("SIRK_GUI_UPDATE_FAILED:", StringComparison.Ordinal) &&
            backend.Contains("logTail", StringComparison.Ordinal) &&
            backend.Contains("encoderShouldEmitUTF8Identifier: true", StringComparison.Ordinal),
            "GUI updater must track its process, self-heal stale locks, expose the log tail and run a Windows PowerShell compatible UTF-8 helper.");

        Require(
            settings.Contains("function pollMaintenanceUpdate(token)", StringComparison.Ordinal) &&
            settings.Contains("/api/v1/admin/maintenance/status", StringComparison.Ordinal) &&
            settings.Contains("Aktualizacja trwa…", StringComparison.Ordinal) &&
            settings.Contains("sirk-maintenance-log-tail", StringComparison.Ordinal) &&
            settings.Contains("maintenanceUpdateJob().active", StringComparison.Ordinal),
            "Portal Settings must monitor the actual update job instead of reloading while the old service is still ready.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(
                    current.FullName,
                    "src",
                    "Sirk.Portal",
                    "Sirk.Portal.csproj")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
''',
    encoding="utf-8",
)
