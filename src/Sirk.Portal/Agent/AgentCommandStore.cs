using System.Collections.Concurrent;
using System.Text.Json;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Agent;

internal sealed record AgentCommandRecord(
    string Id,
    string DeviceId,
    string Type,
    JsonElement Parameters,
    string Status,
    string RequestedById,
    string RequestedByName,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    DateTimeOffset? DeliveredAtUtc,
    DateTimeOffset? CompletedAtUtc,
    JsonElement? Result,
    string? Error);

internal sealed record AgentCommandDocument(
    int SchemaVersion,
    IReadOnlyList<AgentCommandRecord> Commands,
    DateTimeOffset UpdatedAtUtc);

internal sealed record AgentCommandQueueRequest(
    string DeviceId,
    string Type,
    JsonElement Parameters,
    int? TimeoutSeconds);

internal sealed record AgentCommandResultRequest(
    string CommandId,
    bool Success,
    JsonElement? Result,
    string? Error);

internal sealed class AgentCommandStore
{
    private const int SchemaVersion = 1;
    private const int MaximumCommands = 20_000;

    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal)
    {
        "system.info",
        "service.restart",
        "process.list",
        "process.stop",
        "terminal.open",
        "terminal.input",
        "terminal.execute",
        "terminal.resize",
        "terminal.close",
        "files.list",
        "files.download",
        "files.upload",
        "files.delete",
        "files.mkdir",
        "files.read",
        "files.write",
        "desktop.start",
        "desktop.sessions",
        "desktop.monitors",
        "desktop.snapshot",
        "desktop.admin.start",
        "desktop.input",
        "desktop.stop",
        "clipboard.get",
        "clipboard.set",
        "script.run",
        "policy.refresh",
        "agent.update",
        "computer.restart",
        "computer.shutdown"
    };

    private readonly object _sync = new();
    private readonly string _path;
    private readonly AgentStore _agents;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<AgentCommandRecord>> _waiters =
        new(StringComparer.Ordinal);
    private AgentCommandDocument _document;

    public AgentCommandStore(PortalPaths paths, AgentStore agents)
    {
        _path = paths.AgentCommandsFile;
        _agents = agents;
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<AgentCommandDocument>(_path))
            : new AgentCommandDocument(SchemaVersion, [], DateTimeOffset.UtcNow);
    }

    public AgentCommandRecord Queue(
        AgentCommandQueueRequest request,
        string actorId,
        string actorName)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = (request.DeviceId ?? string.Empty).Trim().ToLowerInvariant();
        if (_agents.GetDevice(deviceId) is not { Enabled: true })
            throw new KeyNotFoundException("Device was not found or is disabled.");
        var type = (request.Type ?? string.Empty).Trim().ToLowerInvariant();
        if (!AllowedTypes.Contains(type))
            throw new InvalidDataException("Agent command type is not allowed.");

        var timeout = TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds ?? 60, 5, 3600));
        var now = DateTimeOffset.UtcNow;
        var command = new AgentCommandRecord(
            "cmd-" + Guid.NewGuid().ToString("N"),
            deviceId,
            type,
            request.Parameters.ValueKind == JsonValueKind.Undefined
                ? EmptyObject()
                : request.Parameters.Clone(),
            "queued",
            actorId,
            actorName,
            now,
            now.Add(timeout),
            null,
            null,
            null,
            null);

        lock (_sync)
        {
            var commands = Cleanup(_document.Commands, now)
                .Append(command)
                .TakeLast(MaximumCommands)
                .ToArray();
            Save(new AgentCommandDocument(SchemaVersion, commands, now));
        }
        return command;
    }

    public IReadOnlyList<AgentCommandRecord> Poll(string deviceId, int limit)
    {
        limit = Math.Clamp(limit, 1, 32);
        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            var commands = Cleanup(_document.Commands, now).ToArray();
            var selectedIds = commands
                .Where(value => value.DeviceId == deviceId && value.Status == "queued")
                .OrderBy(value => value.CreatedAtUtc)
                .Take(limit)
                .Select(value => value.Id)
                .ToHashSet(StringComparer.Ordinal);
            if (selectedIds.Count == 0)
            {
                if (commands.Length != _document.Commands.Count)
                    Save(new AgentCommandDocument(SchemaVersion, commands, now));
                return [];
            }

            commands = commands.Select(value => selectedIds.Contains(value.Id)
                ? value with { Status = "delivered", DeliveredAtUtc = now }
                : value).ToArray();
            Save(new AgentCommandDocument(SchemaVersion, commands, now));
            return commands.Where(value => selectedIds.Contains(value.Id)).ToArray();
        }
    }

    public AgentCommandRecord Complete(
        string deviceId,
        AgentCommandResultRequest request)
    {
        AgentCommandRecord completed;
        lock (_sync)
        {
            var commands = _document.Commands.ToArray();
            var index = Array.FindIndex(commands, value =>
                value.Id == request.CommandId && value.DeviceId == deviceId);
            if (index < 0) throw new KeyNotFoundException("Agent command was not found.");
            var current = commands[index];
            if (current.Status is "completed" or "failed" or "expired") return current;

            var now = DateTimeOffset.UtcNow;
            completed = current with
            {
                Status = request.Success ? "completed" : "failed",
                CompletedAtUtc = now,
                Result = request.Result?.Clone(),
                Error = request.Success
                    ? null
                    : NormalizeError(request.Error)
            };
            commands[index] = completed;
            Save(new AgentCommandDocument(SchemaVersion, commands, now));
        }

        if (_waiters.TryRemove(completed.Id, out var waiter))
            waiter.TrySetResult(completed);
        return completed;
    }

    public AgentCommandRecord? Get(string commandId)
    {
        lock (_sync)
        {
            return _document.Commands.FirstOrDefault(value => value.Id == commandId);
        }
    }

    public IReadOnlyList<AgentCommandRecord> List(string? deviceId, int limit)
    {
        limit = Math.Clamp(limit, 1, 1000);
        lock (_sync)
        {
            return _document.Commands
                .Where(value => string.IsNullOrWhiteSpace(deviceId) || value.DeviceId == deviceId)
                .OrderByDescending(value => value.CreatedAtUtc)
                .Take(limit)
                .ToArray();
        }
    }

    public async Task<AgentCommandRecord?> WaitAsync(
        string commandId,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var current = Get(commandId);
        if (current is null || current.Status is "completed" or "failed" or "expired")
            return current;

        var waiter = _waiters.GetOrAdd(
            commandId,
            static _ => new TaskCompletionSource<AgentCommandRecord>(
                TaskCreationOptions.RunContinuationsAsynchronously));
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        using var registration = timeoutSource.Token.Register(
            static state => ((TaskCompletionSource<AgentCommandRecord>)state!).TrySetCanceled(),
            waiter);
        try
        {
            return await waiter.Task.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Get(commandId);
        }
        finally
        {
            _waiters.TryRemove(new KeyValuePair<string, TaskCompletionSource<AgentCommandRecord>>(
                commandId,
                waiter));
        }
    }

    private void Save(AgentCommandDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_path, _document);
    }

    private static AgentCommandDocument Validate(AgentCommandDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Agent command schema is unsupported.");
        if (value.Commands.GroupBy(command => command.Id, StringComparer.Ordinal).Any(group => group.Count() > 1))
            throw new InvalidDataException("Agent command store contains duplicate identifiers.");
        return value;
    }

    private static IEnumerable<AgentCommandRecord> Cleanup(
        IReadOnlyList<AgentCommandRecord> commands,
        DateTimeOffset now)
    {
        foreach (var command in commands)
        {
            if (command.Status is "queued" or "delivered" && command.ExpiresAtUtc <= now)
            {
                yield return command with
                {
                    Status = "expired",
                    CompletedAtUtc = now,
                    Error = "Command expired before completion."
                };
            }
            else
            {
                yield return command;
            }
        }
    }

    private static string NormalizeError(string? value)
    {
        var normalized = (value ?? "Agent command failed.").Trim();
        if (normalized.Length > 4096) normalized = normalized[..4096];
        return normalized;
    }

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }
}
