from pathlib import Path
import re

# 1. Replace the desktop relay with a relay that supports direct WebSocket viewers,
# tunneled HTTP frame polling and the legacy Agent desktop transport.
relay = r'''using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Sirk.Portal.Agent;

internal sealed record DesktopFrameSnapshot(
    long Sequence,
    byte[] Payload,
    string ContentType,
    string MetadataBase64);

internal sealed class DesktopRelayHub
{
    private const int MaximumFrameBytes = 8 * 1024 * 1024;
    private const int MaximumInputBytes = 64 * 1024;
    private static readonly TimeSpan HttpViewerLease = TimeSpan.FromSeconds(40);
    private readonly ConcurrentDictionary<string, DesktopSession> _sessions =
        new(StringComparer.Ordinal);

    public async Task AttachAgentAsync(
        string deviceId,
        WebSocket socket,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        var previous = Interlocked.Exchange(ref session.Agent, socket);
        if (previous is not null && previous.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            await SafeCloseAsync(previous, WebSocketCloseStatus.PolicyViolation,
                "Agent stream replaced.", cancellationToken);
        }
        Signal(session.ViewerSignal);

        try
        {
            await ReceiveAgentFramesAsync(session, socket, cancellationToken);
        }
        finally
        {
            Interlocked.CompareExchange(ref session.Agent, null, socket);
            await CloseViewersAsync(session, "Agent stream closed.", cancellationToken);
            Signal(session.ViewerSignal);
            RemoveIfEmpty(session);
        }
    }

    public async Task AttachViewerAsync(
        string deviceId,
        WebSocket socket,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        var viewerId = Guid.NewGuid();
        session.Viewers[viewerId] = socket;
        Signal(session.ViewerSignal);
        try
        {
            await ReceiveViewerInputAsync(session, socket, cancellationToken);
        }
        finally
        {
            session.Viewers.TryRemove(viewerId, out _);
            Signal(session.ViewerSignal);
            RemoveIfEmpty(session);
        }
    }

    public async Task<bool> WaitForViewerAsync(
        string deviceId,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        if (ViewerActive(session)) return true;
        Drain(session.ViewerSignal);
        if (ViewerActive(session)) return true;
        try
        {
            await session.ViewerSignal.WaitAsync(timeout, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
        }
        return ViewerActive(session);
    }

    public async Task<DesktopFrameSnapshot?> WaitForFrameAsync(
        string deviceId,
        long after,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        TouchHttpViewer(session);
        var current = Volatile.Read(ref session.LatestFrame);
        if (current is not null && current.Sequence > after) return current;
        Drain(session.FrameSignal);
        current = Volatile.Read(ref session.LatestFrame);
        if (current is not null && current.Sequence > after) return current;
        try
        {
            await session.FrameSignal.WaitAsync(timeout, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
        }
        current = Volatile.Read(ref session.LatestFrame);
        return current is not null && current.Sequence > after ? current : null;
    }

    public async Task SendInputAsync(
        string deviceId,
        string message,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        TouchHttpViewer(session);
        var agent = session.Agent;
        if (agent?.State != WebSocketState.Open)
            throw new InvalidOperationException("Agent desktop stream is offline.");
        var payload = Encoding.UTF8.GetBytes(message);
        if (payload.Length > MaximumInputBytes)
            throw new InvalidDataException("Desktop input is too large.");
        await session.AgentSendLock.WaitAsync(cancellationToken);
        try
        {
            await agent.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            session.AgentSendLock.Release();
        }
    }

    public object Status(string deviceId)
    {
        if (!_sessions.TryGetValue(deviceId, out var session))
            return new { deviceId, agentConnected = false, viewerCount = 0, httpViewerActive = false };
        return new
        {
            deviceId,
            agentConnected = session.Agent?.State == WebSocketState.Open,
            viewerCount = session.Viewers.Values.Count(value => value.State == WebSocketState.Open),
            httpViewerActive = HttpViewerActive(session)
        };
    }

    private static async Task ReceiveAgentFramesAsync(
        DesktopSession session,
        WebSocket agent,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested && agent.State == WebSocketState.Open)
        {
            var result = await agent.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) break;
            if (result.MessageType != WebSocketMessageType.Binary)
            {
                await SafeCloseAsync(agent, WebSocketCloseStatus.InvalidMessageType,
                    "Binary desktop frame required.", cancellationToken);
                break;
            }

            message.Write(buffer, 0, result.Count);
            if (message.Length > MaximumFrameBytes)
            {
                await SafeCloseAsync(agent, WebSocketCloseStatus.MessageTooBig,
                    "Desktop frame is too large.", cancellationToken);
                break;
            }
            if (!result.EndOfMessage) continue;

            var frame = message.ToArray();
            message.SetLength(0);
            if (!TryStoreFrame(session, frame))
            {
                await SafeCloseAsync(agent, WebSocketCloseStatus.InvalidPayloadData,
                    "Desktop frame packet is invalid.", cancellationToken);
                break;
            }

            foreach (var viewer in session.Viewers.ToArray())
            {
                if (viewer.Value.State != WebSocketState.Open)
                {
                    session.Viewers.TryRemove(viewer.Key, out _);
                    continue;
                }
                try
                {
                    await viewer.Value.SendAsync(frame, WebSocketMessageType.Binary, true,
                        cancellationToken);
                }
                catch (Exception exception) when (
                    exception is WebSocketException or OperationCanceledException)
                {
                    session.Viewers.TryRemove(viewer.Key, out _);
                }
            }
        }
    }

    private static bool TryStoreFrame(DesktopSession session, byte[] packet)
    {
        if (packet.Length < 6) return false;
        var metadataLength = BinaryPrimitives.ReadInt32BigEndian(packet.AsSpan(0, 4));
        if (metadataLength < 2 || metadataLength > packet.Length - 4) return false;
        var metadata = packet.AsSpan(4, metadataLength).ToArray();
        string contentType;
        try
        {
            using var document = JsonDocument.Parse(metadata);
            contentType = document.RootElement.TryGetProperty("contentType", out var value) &&
                          value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? "image/jpeg"
                : "image/jpeg";
        }
        catch (JsonException)
        {
            return false;
        }
        if (contentType.Length > 100 || contentType.Any(char.IsControl)) return false;
        var payload = packet.AsSpan(4 + metadataLength).ToArray();
        var sequence = Interlocked.Increment(ref session.Sequence);
        Volatile.Write(ref session.LatestFrame, new DesktopFrameSnapshot(
            sequence,
            payload,
            contentType,
            Convert.ToBase64String(metadata)));
        Signal(session.FrameSignal);
        return true;
    }

    private static async Task ReceiveViewerInputAsync(
        DesktopSession session,
        WebSocket viewer,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested && viewer.State == WebSocketState.Open)
        {
            var result = await viewer.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) break;
            if (result.MessageType != WebSocketMessageType.Text)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.InvalidMessageType,
                    "Text input message required.", cancellationToken);
                break;
            }
            message.Write(buffer, 0, result.Count);
            if (message.Length > MaximumInputBytes)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.MessageTooBig,
                    "Desktop input is too large.", cancellationToken);
                break;
            }
            if (!result.EndOfMessage) continue;
            var input = Encoding.UTF8.GetString(message.ToArray());
            message.SetLength(0);
            try
            {
                await SendInputAsync(session.DeviceId, input, cancellationToken);
            }
            catch (InvalidOperationException)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.EndpointUnavailable,
                    "Agent desktop stream is offline.", cancellationToken);
                break;
            }
        }
    }

    private async Task CloseViewersAsync(
        DesktopSession session,
        string reason,
        CancellationToken cancellationToken)
    {
        foreach (var viewer in session.Viewers.ToArray())
        {
            session.Viewers.TryRemove(viewer.Key, out _);
            await SafeCloseAsync(viewer.Value, WebSocketCloseStatus.EndpointUnavailable,
                reason, cancellationToken);
        }
    }

    private void RemoveIfEmpty(DesktopSession session)
    {
        if (session.Agent is null && session.Viewers.IsEmpty && !HttpViewerActive(session))
            _sessions.TryRemove(new KeyValuePair<string, DesktopSession>(session.DeviceId, session));
    }

    private static void TouchHttpViewer(DesktopSession session)
    {
        Interlocked.Exchange(ref session.HttpViewerUntilUnixMilliseconds,
            DateTimeOffset.UtcNow.Add(HttpViewerLease).ToUnixTimeMilliseconds());
        Signal(session.ViewerSignal);
    }

    private static bool HttpViewerActive(DesktopSession session) =>
        Interlocked.Read(ref session.HttpViewerUntilUnixMilliseconds) >
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static bool ViewerActive(DesktopSession session) =>
        HttpViewerActive(session) ||
        session.Viewers.Values.Any(value => value.State == WebSocketState.Open);

    private static void Signal(SemaphoreSlim signal)
    {
        try { signal.Release(); }
        catch (SemaphoreFullException) { }
    }

    private static void Drain(SemaphoreSlim signal)
    {
        while (signal.Wait(0)) { }
    }

    private static async Task SafeCloseAsync(
        WebSocket socket,
        WebSocketCloseStatus status,
        string reason,
        CancellationToken cancellationToken)
    {
        if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived)) return;
        try { await socket.CloseAsync(status, reason, cancellationToken); }
        catch (Exception exception) when (
            exception is WebSocketException or OperationCanceledException) { }
    }

    private sealed class DesktopSession(string deviceId)
    {
        public string DeviceId { get; } = deviceId;
        public WebSocket? Agent;
        public long Sequence;
        public DesktopFrameSnapshot? LatestFrame;
        public long HttpViewerUntilUnixMilliseconds;
        public SemaphoreSlim AgentSendLock { get; } = new(1, 1);
        public SemaphoreSlim FrameSignal { get; } = new(0, 1);
        public SemaphoreSlim ViewerSignal { get; } = new(0, 1);
        public ConcurrentDictionary<Guid, WebSocket> Viewers { get; } = new();
    }
}
'''
Path('src/Sirk.Portal/Agent/DesktopRelayHub.cs').write_text(relay, encoding='utf-8')

# 2. Legacy Agent check-in and desktop transport.
legacy_path = Path('src/Sirk.Portal/Agent/LegacyAgentCompatibilityEndpoints.cs')
legacy = legacy_path.read_text(encoding='utf-8')
legacy = legacy.replace(
'''internal sealed record LegacyAgentCommandResult(
    string CommandId,
    bool Ok,
    string? Code,
    string? Output,
    JsonElement? Data);
''',
'''internal sealed record LegacyAgentCommandResult(
    string CommandId,
    bool Ok,
    string? Code,
    string? Output,
    JsonElement? Data);

internal sealed record LegacyDesktopControlRequest(
    string TenantId,
    string DeviceId,
    int? WaitMilliseconds);
''', 1)
legacy = legacy.replace(
'''        endpoints.MapPost("/api/agent/v1/checkin", CheckInAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        return endpoints;
''',
'''        endpoints.MapPost("/api/agent/v1/checkin", CheckInAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapGet("/api/agent/v1/desktop/stream", LegacyDesktopStreamAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/agent/v1/desktop/control", LegacyDesktopControlAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        return endpoints;
''', 1)
old_complete = '''                    commands.Complete(
                        device.Id,
                        new AgentCommandResultRequest(
                            result.CommandId,
                            result.Ok,
                            result.Data,
                            result.Ok
                                ? null
                                : NormalizeError(result.Code, result.Output)));'''
new_complete = '''                    var legacyResult = JsonSerializer.SerializeToElement(new
                    {
                        ok = result.Ok,
                        code = result.Code ?? string.Empty,
                        output = result.Output ?? string.Empty,
                        data = result.Data
                    }, JsonOptions);
                    commands.Complete(
                        device.Id,
                        new AgentCommandResultRequest(
                            result.CommandId,
                            result.Ok,
                            legacyResult,
                            result.Ok
                                ? null
                                : NormalizeError(result.Code, result.Output)));'''
if old_complete not in legacy:
    raise SystemExit('Legacy command completion marker not found')
legacy = legacy.replace(old_complete, new_complete, 1)
old_map = '''    private static string? LegacyCommandType(string type) => type switch
    {
        "script.run" => "terminal.execute",
        "files.list" => "files.list",
        "files.download" => "files.read",
        "files.upload" => "files.write",
        "desktop.start" => "desktop.admin.start",
        "desktop.input" => "desktop.input",
        _ => null
    };'''
new_map = '''    private static string? LegacyCommandType(string type) => type switch
    {
        "script.run" => "terminal.execute",
        "terminal.execute" => "terminal.execute",
        "files.list" => "files.list",
        "files.download" => "files.read",
        "files.read" => "files.read",
        "files.upload" => "files.write",
        "files.write" => "files.write",
        "desktop.start" => "desktop.admin.start",
        "desktop.admin.start" => "desktop.admin.start",
        "desktop.sessions" => "desktop.sessions",
        "desktop.monitors" => "desktop.monitors",
        "desktop.snapshot" => "desktop.snapshot",
        "desktop.input" => "desktop.input",
        _ => null
    };'''
if old_map not in legacy:
    raise SystemExit('Legacy command map marker not found')
legacy = legacy.replace(old_map, new_map, 1)
methods = r'''
    private static async Task LegacyDesktopStreamAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        var deviceId = context.Request.Headers["X-SIRK-Device"].ToString()
            .Trim().ToLowerInvariant();
        var tenantId = context.Request.Headers["X-SIRK-Tenant"].ToString().Trim();
        var device = agents.GetDevice(deviceId);
        if (device is not { Enabled: true } ||
            !string.Equals(device.TenantId, tenantId, StringComparison.Ordinal) ||
            !Authenticate(context.Request, [], device, agents))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        await desktop.AttachAgentAsync(device.Id, socket, context.RequestAborted);
    }

    private static async Task<IResult> LegacyDesktopControlAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        var body = await ReadBodyAsync(context.Request, 64 * 1024, context.RequestAborted);
        LegacyDesktopControlRequest request;
        try { request = Deserialize<LegacyDesktopControlRequest>(body); }
        catch (Exception exception) when (exception is InvalidDataException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "DESKTOP_CONTROL_INVALID", exception.Message);
        }
        var device = agents.GetDevice(request.DeviceId);
        if (device is not { Enabled: true } ||
            !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal) ||
            !Authenticate(context.Request, body, device, agents))
        {
            return Unauthorized("AGENT_AUTHENTICATION_FAILED", "Agent authentication failed.");
        }
        var wait = TimeSpan.FromMilliseconds(Math.Clamp(request.WaitMilliseconds ?? 0, 0, 25_000));
        var viewerActive = await desktop.WaitForViewerAsync(device.Id, wait, context.RequestAborted);
        return Results.Ok(new
        {
            viewerActive,
            inputs = Array.Empty<object>()
        });
    }

'''
marker = '    private static bool Authenticate(\n'
if marker not in legacy:
    raise SystemExit('Legacy Authenticate marker not found')
legacy = legacy.replace(marker, methods + marker, 1)
legacy_path.write_text(legacy, encoding='utf-8')

# 3. Allow compatibility command types in the native command store.
store_path = Path('src/Sirk.Portal/Agent/AgentCommandStore.cs')
store = store_path.read_text(encoding='utf-8')
store = store.replace(
'''        "terminal.open",
        "terminal.input",''',
'''        "terminal.open",
        "terminal.input",
        "terminal.execute",''', 1)
store = store.replace(
'''        "files.mkdir",
        "desktop.start",''',
'''        "files.mkdir",
        "files.read",
        "files.write",
        "desktop.start",
        "desktop.sessions",
        "desktop.monitors",
        "desktop.snapshot",
        "desktop.admin.start",''', 1)
store_path.write_text(store, encoding='utf-8')

# 4. Native UI compatibility endpoints for operations and tunneled desktop polling.
ui_path = Path('src/Sirk.Portal/Ui/PortalUiCompatibilityEndpoints.cs')
ui = ui_path.read_text(encoding='utf-8')
ui = ui.replace(
'''internal sealed record LegacyAgentGroupMutation(string? Id, string? Name, string? Description);
''',
'''internal sealed record LegacyAgentGroupMutation(string? Id, string? Name, string? Description);
internal sealed record LegacyAgentOperationRequest(
    string? TenantId,
    string DeviceId,
    string Type,
    JsonElement Parameters);
internal sealed record LegacyDesktopInputRequest(
    string? TenantId,
    string DeviceId,
    JsonElement Input);
''', 1)
ui = ui.replace(
'''        endpoints.MapGet("/api/bootstrap", LegacyBootstrap)
            .RequireAuthorization();
''',
'''        endpoints.MapGet("/api/bootstrap", LegacyBootstrap)
            .RequireAuthorization();
        endpoints.MapPost("/api/agent-operations", LegacyAgentOperationCreateAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapGet("/api/agent-operations", LegacyAgentOperationStatusAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapGet("/api/agent-desktop/frame", LegacyDesktopFrameAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapPost("/api/agent-desktop/input", LegacyDesktopInputAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
''', 1)
# Include identity fields required by workspace and OS alias.
ui = ui.replace(
'''                id = device.GetProperty("id").GetString() ?? string.Empty,
                nodeId = device.GetProperty("id").GetString() ?? string.Empty,
                name = device.GetProperty("name").GetString() ?? string.Empty,''',
'''                id = device.GetProperty("id").GetString() ?? string.Empty,
                nodeId = device.GetProperty("id").GetString() ?? string.Empty,
                deviceId = device.GetProperty("id").GetString() ?? string.Empty,
                tenantId = device.GetProperty("tenantId").GetString() ?? string.Empty,
                name = device.GetProperty("name").GetString() ?? string.Empty,''', 1)
ui = ui.replace(
'''                osdesc = device.GetProperty("platform").GetString() ?? string.Empty,
                platform = device.GetProperty("platform").GetString() ?? string.Empty,''',
'''                osdesc = device.GetProperty("platform").GetString() ?? string.Empty,
                os = device.GetProperty("platform").GetString() ?? string.Empty,
                platform = device.GetProperty("platform").GetString() ?? string.Empty,''', 1)
ui_methods = r'''
    private static async Task<IResult> LegacyAgentOperationCreateAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        AgentCommandStore commands)
    {
        if (context.Items["Sirk.InternalTunnel"] is not true)
        {
            var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
            if (csrf is not null) return csrf;
        }
        try
        {
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var raw = form["payload"].ToString();
            var request = JsonSerializer.Deserialize<LegacyAgentOperationRequest>(
                              raw,
                              new JsonSerializerOptions(JsonSerializerDefaults.Web))
                          ?? throw new InvalidDataException("Agent operation payload is required.");
            var device = agents.GetDevice(request.DeviceId)
                         ?? throw new KeyNotFoundException("Device was not found.");
            if (!string.IsNullOrWhiteSpace(request.TenantId) &&
                !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal))
                throw new InvalidDataException("Agent tenant does not match the device.");
            var type = CanonicalOperationType(request.Type);
            var value = commands.Queue(
                new AgentCommandQueueRequest(
                    device.Id,
                    type,
                    request.Parameters.ValueKind == JsonValueKind.Undefined
                        ? JsonSerializer.SerializeToElement(new { })
                        : request.Parameters,
                    type.StartsWith("desktop.", StringComparison.Ordinal) ? 180 : 120),
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context));
            return Results.Json(new { ok = true, value = LegacyCommandValue(value) },
                statusCode: StatusCodes.Status202Accepted);
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_OPERATION_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> LegacyAgentOperationStatusAsync(
        HttpContext context,
        AgentCommandStore commands)
    {
        var commandId = context.Request.Query["commandId"].ToString();
        if (string.IsNullOrWhiteSpace(commandId))
            return PortalAuthenticationEndpoints.Error(400, "COMMAND_ID_REQUIRED", "Command ID is required.");
        var wait = int.TryParse(context.Request.Query["waitMilliseconds"], out var parsed)
            ? Math.Clamp(parsed, 0, 25_000)
            : 0;
        var value = wait > 0
            ? await commands.WaitAsync(commandId, TimeSpan.FromMilliseconds(wait), context.RequestAborted)
            : commands.Get(commandId);
        return value is null
            ? PortalAuthenticationEndpoints.Error(404, "AGENT_OPERATION_NOT_FOUND", "Operation was not found.")
            : Results.Ok(new { ok = true, value = LegacyCommandValue(value) });
    }

    private static async Task<IResult> LegacyDesktopFrameAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        var deviceId = context.Request.Query["deviceId"].ToString().Trim().ToLowerInvariant();
        var device = agents.GetDevice(deviceId);
        if (device is not { Enabled: true })
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", "Device was not found.");
        var after = long.TryParse(context.Request.Query["after"], out var parsedAfter)
            ? Math.Max(0, parsedAfter)
            : 0;
        var wait = int.TryParse(context.Request.Query["waitMilliseconds"], out var parsedWait)
            ? Math.Clamp(parsedWait, 0, 25_000)
            : 0;
        var frame = await desktop.WaitForFrameAsync(
            device.Id,
            after,
            TimeSpan.FromMilliseconds(wait),
            context.RequestAborted);
        if (frame is null) return Results.NoContent();
        context.Response.Headers["X-SIRK-Sequence"] = frame.Sequence.ToString(
            System.Globalization.CultureInfo.InvariantCulture);
        context.Response.Headers["X-SIRK-Metadata"] = frame.MetadataBase64;
        context.Response.Headers.CacheControl = "no-store";
        return Results.Bytes(frame.Payload, frame.ContentType);
    }

    private static async Task<IResult> LegacyDesktopInputAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        if (context.Items["Sirk.InternalTunnel"] is not true)
        {
            var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
            if (csrf is not null) return csrf;
        }
        try
        {
            var request = await context.Request.ReadFromJsonAsync<LegacyDesktopInputRequest>(
                              cancellationToken: context.RequestAborted)
                          ?? throw new InvalidDataException("Desktop input is required.");
            var device = agents.GetDevice(request.DeviceId)
                         ?? throw new KeyNotFoundException("Device was not found.");
            if (!string.IsNullOrWhiteSpace(request.TenantId) &&
                !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal))
                throw new InvalidDataException("Agent tenant does not match the device.");
            var message = JsonSerializer.Serialize(new
            {
                type = "input",
                id = 0,
                input = request.Input
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await desktop.SendInputAsync(device.Id, message, context.RequestAborted);
            return Results.Ok(new { ok = true });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return PortalAuthenticationEndpoints.Error(409, "DESKTOP_STREAM_OFFLINE", exception.Message);
        }
        catch (Exception exception) when (exception is InvalidDataException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "DESKTOP_INPUT_INVALID", exception.Message);
        }
    }

    private static string CanonicalOperationType(string? value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "terminal.execute" => "terminal.execute",
            "files.list" => "files.list",
            "files.read" => "files.read",
            "files.write" => "files.write",
            "desktop.sessions" => "desktop.sessions",
            "desktop.monitors" => "desktop.monitors",
            "desktop.admin.start" => "desktop.admin.start",
            "desktop.snapshot" => "desktop.snapshot",
            "desktop.input" => "desktop.input",
            _ => throw new InvalidDataException("Unsupported Agent operation.")
        };

    private static object LegacyCommandValue(AgentCommandRecord command)
    {
        object? result = null;
        if (command.Status is "completed" or "failed" or "expired")
        {
            if (command.Result is { ValueKind: JsonValueKind.Object } value &&
                value.TryGetProperty("ok", out _))
            {
                result = value;
            }
            else
            {
                result = new
                {
                    ok = command.Status == "completed",
                    code = command.Status == "completed" ? "OK" : "OPERATION_FAILED",
                    output = command.Error ?? string.Empty,
                    data = command.Result
                };
            }
        }
        return new
        {
            commandId = command.Id,
            status = command.Status,
            result,
            command.CreatedAtUtc,
            command.ExpiresAtUtc
        };
    }

'''
marker = '    private static IResult DeviceInventory(AgentStore agents) =>\n'
if marker not in ui:
    raise SystemExit('UI DeviceInventory marker not found')
ui = ui.replace(marker, ui_methods + marker, 1)
ui_path.write_text(ui, encoding='utf-8')

# 5. Direct viewer WebSocket accepts delegated tunnel identity when used by a future streaming tunnel.
agent_endpoints_path = Path('src/Sirk.Portal/Agent/AgentEndpoints.cs')
agent_endpoints = agent_endpoints_path.read_text(encoding='utf-8')
agent_endpoints = agent_endpoints.replace(
'''        if (!context.WebSockets.IsWebSocketRequest || !ValidSameOrigin(context))''',
'''        if (!context.WebSockets.IsWebSocketRequest ||
            (!ValidSameOrigin(context) && context.Items["Sirk.InternalTunnel"] is not true))''', 1)
agent_endpoints_path.write_text(agent_endpoints, encoding='utf-8')

# 6. Browser: use direct canonical WebSocket locally and HTTP long-poll through Central.
workspace_path = Path('public/portal/standalone/scripts/device-workspace.js')
workspace = workspace_path.read_text(encoding='utf-8')
workspace = workspace.replace(
'''    function portalWebSocketUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : new URL(pathAndQuery, window.location.href).href;
        var endpoint = new URL(rewritten, window.location.href);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        return endpoint.href;
    }
''',
'''    function portalWebSocketUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : new URL(pathAndQuery, window.location.href).href;
        var endpoint = new URL(rewritten, window.location.href);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        return endpoint.href;
    }

    function usesHttpTunnel() {
        try {
            var rewritten = core && typeof core.portalUrl === "function"
                ? core.portalUrl("/api/v1/desktop/stream")
                : "/api/v1/desktop/stream";
            return /^\/connect\//.test(new URL(rewritten, window.location.href).pathname);
        } catch (error) { return false; }
    }
''', 1)
old_input = '''            if (inputChannel && inputChannel.readyState === WebSocket.OPEN &&
                socketActions.indexOf(parameters.action) >= 0) {
                if (parameters.action === "move") {
                    inputChannel.send(JSON.stringify({ type: "input", id: 0, input: parameters }));
                    return Promise.resolve({ ok: true });
                }
                var id = ++inputSequence;
                return new Promise(function (resolve, reject) {
                    var timer = setTimeout(function () {
                        pendingInput.delete(id);
                        reject(new Error("Input dispatch timeout."));
                    }, 2000);
                    pendingInput.set(id, { resolve: resolve, reject: reject, timer: timer, started: started });
                    inputChannel.send(JSON.stringify({ type: "input", id: id, input: parameters }));
                });
            }
            var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
            var csrfToken = runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";
            return fetch("/api/agent-desktop/input", {'''
new_input = '''            if (inputChannel && inputChannel.readyState === WebSocket.OPEN &&
                socketActions.indexOf(parameters.action) >= 0) {
                inputChannel.send(JSON.stringify({ type: "input", id: ++inputSequence, input: parameters }));
                inputTimes.push(performance.now() - started);
                if (inputTimes.length > 60) inputTimes.shift();
                return Promise.resolve({ ok: true });
            }
            var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
            var csrfToken = runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";
            return fetch("/api/agent-desktop/input", {'''
if old_input not in workspace:
    raise SystemExit('Desktop input marker not found')
workspace = workspace.replace(old_input, new_input, 1)
old_restart = '''        function restartStream() {
            if (!connected) return;
            streamGeneration += 1;
            hasCompleteFrame = false;
            snapshot.sequence = 0;
            var settings = effectiveProfile();
            input({ action: "streamProfile", maxWidth: settings.maxWidth, quality: settings.quality,
                targetKbps: settings.targetKbps, targetFps: settings.targetFps,
                frameMode: settings.frameMode, deltaScalePercent: settings.deltaScalePercent })
                .catch(function () {});
            startDesktopSocket(streamGeneration);
        }'''
new_restart = '''        function restartStream() {
            if (!connected) return;
            streamGeneration += 1;
            hasCompleteFrame = false;
            snapshot.sequence = 0;
            var settings = effectiveProfile();
            var streamProfile = { action: "streamProfile", maxWidth: settings.maxWidth,
                quality: settings.quality, targetKbps: settings.targetKbps,
                targetFps: settings.targetFps, frameMode: settings.frameMode,
                deltaScalePercent: settings.deltaScalePercent };
            if (usesHttpTunnel()) {
                input(streamProfile).then(function () { snapshot(streamGeneration); })
                    .catch(function (error) {
                        status.textContent = error.message || String(error);
                        status.classList.add("is-error");
                    });
                return;
            }
            startDesktopSocket(streamGeneration, streamProfile);
        }'''
if old_restart not in workspace:
    raise SystemExit('Desktop restart marker not found')
workspace = workspace.replace(old_restart, new_restart, 1)
old_socket_head = '''        function startDesktopSocket(generation) {
            if (desktopSocket) { try { desktopSocket.close(); } catch (error) {} }
            if (desktopInputSocket) { try { desktopInputSocket.close(); } catch (error) {} }
            var identityQuery = "tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId);
            var url = portalWebSocketUrl("/api/agent-desktop/stream?" + identityQuery +
                "&after=" + encodeURIComponent(snapshot.sequence || 0));
            var socket = new WebSocket(url);
            desktopSocket = socket;
            var inputSocket = new WebSocket(portalWebSocketUrl(
                "/api/agent-desktop/input-stream?" + identityQuery));
            desktopInputSocket = inputSocket;
            inputSocket.onmessage = handleInputSocketMessage;
            inputSocket.onclose = function () {
                if (generation !== streamGeneration || inputSocket !== desktopInputSocket) return;
                desktopInputSocket = null;
                rejectPendingInputs("Desktop input socket closed.");
            };
            inputSocket.onerror = function () { try { inputSocket.close(); } catch (error) {} };
            socket.binaryType = "arraybuffer";'''
new_socket_head = '''        function startDesktopSocket(generation, streamProfile) {
            if (desktopSocket) { try { desktopSocket.close(); } catch (error) {} }
            desktopInputSocket = null;
            var url = portalWebSocketUrl("/api/v1/desktop/stream?deviceId=" +
                encodeURIComponent(node.deviceId));
            var socket = new WebSocket(url);
            desktopSocket = socket;
            desktopInputSocket = socket;
            socket.binaryType = "arraybuffer";
            socket.onopen = function () {
                if (generation !== streamGeneration || socket !== desktopSocket) return;
                input(streamProfile).catch(function (error) {
                    status.textContent = error.message || String(error);
                    status.classList.add("is-error");
                });
            };'''
if old_socket_head not in workspace:
    raise SystemExit('Desktop socket header marker not found')
workspace = workspace.replace(old_socket_head, new_socket_head, 1)
workspace = workspace.replace(
'''                desktopSocket = null;
                setTimeout(function () { snapshot(generation); }, 250);
            };
            socket.onerror = function () { try { socket.close(); } catch (error) {} };''',
'''                desktopSocket = null;
                desktopInputSocket = null;
                if (connected) setTimeout(function () {
                    if (generation === streamGeneration) startDesktopSocket(generation, streamProfile);
                }, 1000);
            };
            socket.onerror = function () { try { socket.close(); } catch (error) {} };''', 1)
workspace_path.write_text(workspace, encoding='utf-8')

# 7. Force a new asset revision after deployment.
assets_path = Path('src/Sirk.Portal/Ui/PortalUiEndpoints.cs')
assets = assets_path.read_text(encoding='utf-8')
assets = re.sub(
    r'private const string AssetRevision = "[^"]+";',
    'private const string AssetRevision = "agent-remote-transport-20260804-1";',
    assets,
    count=1)
assets_path.write_text(assets, encoding='utf-8')
