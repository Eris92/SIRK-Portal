using System.Diagnostics;
using System.IO.Compression;
using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Infrastructure;
using Sirk.Portal.Security;

namespace Sirk.Portal.Maintenance;

internal sealed record PortalMaintenanceMutation(
    string? Id,
    string? Channel,
    string? Reason);

internal sealed record PortalMaintenanceHistory(
    string Type,
    DateTimeOffset At,
    string Version,
    string Message,
    string? Error);

internal sealed record PortalBackupRecord(
    string Id,
    string Version,
    DateTimeOffset CreatedAt,
    string Reason,
    long SizeBytes,
    string FileName);

internal sealed record PortalMaintenanceDocument(
    int SchemaVersion,
    string Channel,
    IReadOnlyList<PortalBackupRecord> Backups,
    IReadOnlyList<PortalMaintenanceHistory> History,
    DateTimeOffset UpdatedAtUtc);

internal sealed class PortalMaintenanceStore
{
    private const int SchemaVersion = 1;
    private static readonly HashSet<string> Channels =
        new(StringComparer.Ordinal) { "stable", "beta", "dev" };

    private readonly object _sync = new();
    private readonly PortalPaths _paths;
    private readonly string _stateFile;
    private readonly string _backupRoot;
    private PortalMaintenanceDocument _document;

    public PortalMaintenanceStore(PortalPaths paths)
    {
        _paths = paths;
        _stateFile = Path.Combine(paths.DataRoot, "maintenance.json");
        var sirkRoot = Path.GetDirectoryName(paths.DataRoot)
                       ?? throw new InvalidOperationException("Portal data root has no parent directory.");
        _backupRoot = OperatingSystem.IsWindows()
            ? Path.Combine(sirkRoot, "Portal Backups")
            : Path.Combine(paths.DataRoot, "backups");
        Directory.CreateDirectory(_backupRoot);
        AtomicJsonFile.SecureDirectory(_backupRoot);
        _document = File.Exists(_stateFile)
            ? Validate(AtomicJsonFile.Read<PortalMaintenanceDocument>(_stateFile))
            : NewDocument();
        CleanupMissingFiles();
        Save();
    }

    public object Snapshot()
    {
        lock (_sync)
        {
            CleanupMissingFiles();
            return new
            {
                current = new
                {
                    version = VersionInfo.Current,
                    channel = _document.Channel,
                    branch = "rewrite/dotnet10-clean"
                },
                remote = new
                {
                    availableVersion = VersionInfo.Current,
                    updateAvailable = false,
                    error = (string?)null
                },
                jobs = new Dictionary<string, object>(),
                backups = _document.Backups
                    .OrderByDescending(value => value.CreatedAt)
                    .Select(value => new
                    {
                        value.Id,
                        value.Version,
                        value.CreatedAt,
                        value.Reason,
                        value.SizeBytes
                    })
                    .ToArray(),
                history = _document.History
                    .OrderByDescending(value => value.At)
                    .Take(500)
                    .ToArray(),
                capabilities = new
                {
                    check = true,
                    backup = true,
                    deleteBackup = true,
                    channel = true,
                    restart = OperatingSystem.IsWindows(),
                    restore = OperatingSystem.IsWindows(),
                    update = false
                }
            };
        }
    }

    public object Check()
    {
        lock (_sync)
        {
            AppendHistory("check", "Sprawdzono kanał aktualizacji.", null);
            Save();
            return Snapshot();
        }
    }

    public object SetChannel(string? channel)
    {
        var normalized = (channel ?? string.Empty).Trim().ToLowerInvariant();
        if (!Channels.Contains(normalized))
            throw new InvalidDataException("Update channel must be stable, beta or dev.");
        lock (_sync)
        {
            _document = _document with
            {
                Channel = normalized,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            AppendHistory("channel", "Kanał ustawiono na " + normalized + ".", null);
            Save();
            return Snapshot();
        }
    }

    public object CreateBackup(string? reason)
    {
        var normalizedReason = string.IsNullOrWhiteSpace(reason)
            ? "manual"
            : reason.Trim();
        if (normalizedReason.Length > 256)
            throw new InvalidDataException("Backup reason is too long.");

        lock (_sync)
        {
            var created = DateTimeOffset.UtcNow;
            var id = "backup-" + created.ToString("yyyyMMdd-HHmmss") + "-" +
                     Guid.NewGuid().ToString("N")[..8];
            var fileName = id + ".zip";
            var destination = Path.Combine(_backupRoot, fileName);
            var temporary = Path.Combine(
                Path.GetTempPath(),
                fileName + ".tmp-" + Environment.ProcessId + "-" + Guid.NewGuid().ToString("N"));
            try
            {
                CreateDataArchive(temporary);
                File.Move(temporary, destination, overwrite: true);
                AtomicJsonFile.SecureFile(destination);
                var record = new PortalBackupRecord(
                    id,
                    VersionInfo.Current,
                    created,
                    normalizedReason,
                    new FileInfo(destination).Length,
                    fileName);
                _document = _document with
                {
                    Backups = _document.Backups.Append(record).ToArray(),
                    UpdatedAtUtc = created
                };
                AppendHistory("backup", "Utworzono backup " + id + ".", null);
                Save();
                return Snapshot();
            }
            catch (Exception exception)
            {
                File.Delete(temporary);
                AppendHistory("backup", "Tworzenie backupu nie powiodło się.", exception.Message);
                Save();
                throw;
            }
        }
    }

    public object DeleteBackup(string? id)
    {
        var normalized = RequiredId(id);
        lock (_sync)
        {
            var backup = FindBackup(normalized);
            File.Delete(Path.Combine(_backupRoot, backup.FileName));
            _document = _document with
            {
                Backups = _document.Backups.Where(value => value.Id != normalized).ToArray(),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            AppendHistory("delete-backup", "Usunięto backup " + normalized + ".", null);
            Save();
            return Snapshot();
        }
    }

    public object ScheduleRestart()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Restart usługi jest dostępny tylko na Windows.");
        StartHelperScript(
            "restart",
            "Start-Sleep -Seconds 2\r\n" +
            "Restart-Service -Name 'SirkPortal' -Force\r\n");
        lock (_sync)
        {
            AppendHistory("restart", "Zaplanowano restart usługi SirkPortal.", null);
            Save();
        }
        return new { accepted = true, action = "restart" };
    }

    public object ScheduleRestore(string? id)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Przywracanie backupu jest dostępne tylko na Windows.");
        var normalized = RequiredId(id);
        PortalBackupRecord backup;
        lock (_sync)
        {
            backup = FindBackup(normalized);
        }
        var archive = Path.Combine(_backupRoot, backup.FileName);
        var rollback = Path.Combine(
            Path.GetDirectoryName(_paths.DataRoot)!,
            "Portal Restore Rollback " + DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss"));
        var script =
            "Start-Sleep -Seconds 2\r\n" +
            "Stop-Service -Name 'SirkPortal' -Force -ErrorAction Stop\r\n" +
            "$data=" + QuotePs(_paths.DataRoot) + "\r\n" +
            "$archive=" + QuotePs(archive) + "\r\n" +
            "$rollback=" + QuotePs(rollback) + "\r\n" +
            "if(Test-Path -LiteralPath $rollback){Remove-Item -LiteralPath $rollback -Recurse -Force}\r\n" +
            "if(Test-Path -LiteralPath $data){Move-Item -LiteralPath $data -Destination $rollback -Force}\r\n" +
            "New-Item -ItemType Directory -Path $data -Force | Out-Null\r\n" +
            "Expand-Archive -LiteralPath $archive -DestinationPath $data -Force\r\n" +
            "Start-Service -Name 'SirkPortal'\r\n";
        StartHelperScript("restore", script);
        lock (_sync)
        {
            AppendHistory("restore", "Zaplanowano przywrócenie backupu " + normalized + ".", null);
            Save();
        }
        return new { accepted = true, action = "restore", id = normalized };
    }

    private void CreateDataArchive(string destination)
    {
        var dataRoot = Path.GetFullPath(_paths.DataRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var backupRoot = Path.GetFullPath(_backupRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var backupPrefix = backupRoot + Path.DirectorySeparatorChar;

        using var output = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            128 * 1024,
            FileOptions.WriteThrough);
        using var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: false);
        foreach (var path in Directory.EnumerateFiles(dataRoot, "*", SearchOption.AllDirectories))
        {
            var fullPath = Path.GetFullPath(path);
            if (string.Equals(fullPath, backupRoot, StringComparison.OrdinalIgnoreCase) ||
                fullPath.StartsWith(backupPrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var relative = Path.GetRelativePath(dataRoot, fullPath).Replace('\\', '/');
            if (relative.StartsWith("../", StringComparison.Ordinal) || relative == "..")
                continue;

            var entry = archive.CreateEntry(relative, CompressionLevel.Optimal);
            using var source = new FileStream(
                fullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                128 * 1024,
                FileOptions.SequentialScan);
            using var target = entry.Open();
            source.CopyTo(target);
        }
    }

    private void StartHelperScript(string action, string scriptBody)
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            "sirk-portal-" + action + "-" + Guid.NewGuid().ToString("N") + ".ps1");
        File.WriteAllText(
            path,
            "$ErrorActionPreference='Stop'\r\n" + scriptBody +
            "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n");
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
        _ = Process.Start(start)
            ?? throw new InvalidOperationException("Nie można uruchomić pomocniczego procesu maintenance.");
    }

    private PortalBackupRecord FindBackup(string id)
    {
        var backup = _document.Backups.FirstOrDefault(value => value.Id == id)
                     ?? throw new KeyNotFoundException("Backup was not found.");
        if (!File.Exists(Path.Combine(_backupRoot, backup.FileName)))
            throw new KeyNotFoundException("Backup archive was not found.");
        return backup;
    }

    private void CleanupMissingFiles()
    {
        var existing = _document.Backups
            .Where(value => File.Exists(Path.Combine(_backupRoot, value.FileName)))
            .ToArray();
        if (existing.Length != _document.Backups.Count)
        {
            _document = _document with
            {
                Backups = existing,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
        }
    }

    private void AppendHistory(string type, string message, string? error)
    {
        var next = _document.History
            .Append(new PortalMaintenanceHistory(
                type,
                DateTimeOffset.UtcNow,
                VersionInfo.Current,
                message,
                error))
            .TakeLast(1000)
            .ToArray();
        _document = _document with
        {
            History = next,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
    }

    private void Save() => AtomicJsonFile.Write(_stateFile, _document);

    private static PortalMaintenanceDocument Validate(PortalMaintenanceDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Portal maintenance schema is unsupported.");
        if (!Channels.Contains(value.Channel))
            throw new InvalidDataException("Portal maintenance channel is invalid.");
        return value with
        {
            Backups = value.Backups ?? [],
            History = value.History ?? []
        };
    }

    private static PortalMaintenanceDocument NewDocument() => new(
        SchemaVersion,
        "dev",
        [],
        [],
        DateTimeOffset.UtcNow);

    private static string RequiredId(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is < 1 or > 128 ||
            normalized.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
        {
            throw new InvalidDataException("Backup ID is invalid.");
        }
        return normalized;
    }

    private static string QuotePs(string value) =>
        "'" + value.Replace("'", "''", StringComparison.Ordinal) + "'";
}

internal static class PortalMaintenanceEndpoints
{
    public static IEndpointRouteBuilder MapPortalMaintenance(
        this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/api/v1/admin/maintenance")
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        group.MapGet("/status", (PortalMaintenanceStore store) =>
            Results.Ok(new { ok = true, value = store.Snapshot() }));
        group.MapPost("/check", CheckAsync);
        group.MapPost("/backup", BackupAsync);
        group.MapPost("/channel", ChannelAsync);
        group.MapPost("/delete-backup", DeleteBackupAsync);
        group.MapPost("/restart", RestartAsync);
        group.MapPost("/restore", RestoreAsync);
        return endpoints;
    }

    private static Task<IResult> CheckAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        MutateAsync(context, antiforgery, audit, "maintenance.check", "check", store.Check);

    private static async Task<IResult> BackupAsync(
        PortalMaintenanceMutation request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(context, antiforgery, audit, "maintenance.backup", "backup", () => store.CreateBackup(request.Reason));

    private static async Task<IResult> ChannelAsync(
        PortalMaintenanceMutation request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(context, antiforgery, audit, "maintenance.channel", "channel", () => store.SetChannel(request.Channel));

    private static async Task<IResult> DeleteBackupAsync(
        PortalMaintenanceMutation request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(context, antiforgery, audit, "maintenance.delete-backup", request.Id ?? string.Empty, () => store.DeleteBackup(request.Id));

    private static async Task<IResult> RestartAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(context, antiforgery, audit, "maintenance.restart", "SirkPortal", store.ScheduleRestart);

    private static async Task<IResult> RestoreAsync(
        PortalMaintenanceMutation request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalMaintenanceStore store,
        PortalAuditLog audit) =>
        await MutateAsync(context, antiforgery, audit, "maintenance.restore", request.Id ?? string.Empty, () => store.ScheduleRestore(request.Id));

    private static async Task<IResult> MutateAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalAuditLog audit,
        string operation,
        string target,
        Func<object> action)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var value = action();
            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                operation,
                "maintenance",
                target,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier));
            return Results.Ok(new { ok = true, value });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "BACKUP_NOT_FOUND", exception.Message);
        }
        catch (PlatformNotSupportedException exception)
        {
            return PortalAuthenticationEndpoints.Error(409, "MAINTENANCE_PLATFORM_UNSUPPORTED", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return PortalAuthenticationEndpoints.Error(400, "MAINTENANCE_FAILED", exception.Message);
        }
    }
}
