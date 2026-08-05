from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


relay = "src/Sirk.Portal/Agent/DesktopRelayHub.cs"
replace_once(
    relay,
    """    private const int MaximumFrameBytes = 8 * 1024 * 1024;
    private const int MaximumInputBytes = 64 * 1024;
    private static readonly TimeSpan HttpViewerLease = TimeSpan.FromSeconds(40);
""",
    """    private const int MaximumFrameBytes = 8 * 1024 * 1024;
    private const int MaximumInputBytes = 64 * 1024;
    private const int MaximumQueuedInputs = 256;
    private static readonly TimeSpan HttpViewerLease = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan QueuedInputLifetime = TimeSpan.FromSeconds(10);
""")

replace_once(
    relay,
    """    public async Task SendInputAsync(
        string deviceId,
        string message,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        TouchHttpViewer(session);
        var agent = session.Agent;
        if (agent?.State != WebSocketState.Open)
            throw new InvalidOperationException(\"Agent desktop stream is offline.\");
        var payload = Encoding.UTF8.GetBytes(message);
        if (payload.Length > MaximumInputBytes)
            throw new InvalidDataException(\"Desktop input is too large.\");
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
""",
    """    public async Task<string> SendOrQueueInputAsync(
        string deviceId,
        string message,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        TouchHttpViewer(session);
        var payload = ValidateInputPayload(message);
        var agent = session.Agent;
        if (agent?.State == WebSocketState.Open)
        {
            try
            {
                await SendInputPayloadAsync(session, agent, payload, cancellationToken);
                return \"direct\";
            }
            catch (Exception exception) when (
                exception is WebSocketException or InvalidOperationException)
            {
                // The Agent reconnects independently. Preserve short-lived input
                // for its authenticated HTTP control poll instead of returning 409.
            }
        }

        QueueInput(session, message);
        return \"queued\";
    }

    public async Task SendInputAsync(
        string deviceId,
        string message,
        CancellationToken cancellationToken)
    {
        var session = _sessions.GetOrAdd(deviceId, static id => new DesktopSession(id));
        TouchHttpViewer(session);
        var payload = ValidateInputPayload(message);
        var agent = session.Agent;
        if (agent?.State != WebSocketState.Open)
            throw new InvalidOperationException(\"Agent desktop stream is offline.\");
        await SendInputPayloadAsync(session, agent, payload, cancellationToken);
    }

    public IReadOnlyList<JsonElement> DrainQueuedInputs(
        string deviceId,
        int limit)
    {
        if (!_sessions.TryGetValue(deviceId, out var session))
            return Array.Empty<JsonElement>();

        var result = new List<JsonElement>();
        var maximum = Math.Clamp(limit, 1, MaximumQueuedInputs);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        while (result.Count < maximum && session.PendingInputs.TryDequeue(out var queued))
        {
            Interlocked.Decrement(ref session.PendingInputCount);
            if (queued.ExpiresAtUnixMilliseconds <= now) continue;
            try
            {
                using var document = JsonDocument.Parse(queued.Message);
                var root = document.RootElement;
                if (root.TryGetProperty(\"type\", out var type) &&
                    string.Equals(type.GetString(), \"input\", StringComparison.Ordinal) &&
                    root.TryGetProperty(\"input\", out var input) &&
                    input.ValueKind == JsonValueKind.Object)
                {
                    result.Add(input.Clone());
                }
            }
            catch (JsonException)
            {
                // Invalid queued input is discarded and never reaches the Agent.
            }
        }
        return result;
    }

    private static byte[] ValidateInputPayload(string message)
    {
        var payload = Encoding.UTF8.GetBytes(message);
        if (payload.Length > MaximumInputBytes)
            throw new InvalidDataException(\"Desktop input is too large.\");
        return payload;
    }

    private static async Task SendInputPayloadAsync(
        DesktopSession session,
        WebSocket agent,
        byte[] payload,
        CancellationToken cancellationToken)
    {
        await session.AgentSendLock.WaitAsync(cancellationToken);
        try
        {
            if (!ReferenceEquals(session.Agent, agent) || agent.State != WebSocketState.Open)
                throw new InvalidOperationException(\"Agent desktop stream is offline.\");
            await agent.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            session.AgentSendLock.Release();
        }
    }

    private static void QueueInput(DesktopSession session, string message)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(QueuedInputLifetime)
            .ToUnixTimeMilliseconds();
        session.PendingInputs.Enqueue(new QueuedDesktopInput(message, expiresAt));
        Interlocked.Increment(ref session.PendingInputCount);
        while (Volatile.Read(ref session.PendingInputCount) > MaximumQueuedInputs &&
               session.PendingInputs.TryDequeue(out _))
        {
            Interlocked.Decrement(ref session.PendingInputCount);
        }
    }
""")

replace_once(
    relay,
    """        if (!_sessions.TryGetValue(deviceId, out var session))
            return new { deviceId, agentConnected = false, viewerCount = 0, httpViewerActive = false };
        return new
        {
            deviceId,
            agentConnected = session.Agent?.State == WebSocketState.Open,
            viewerCount = session.Viewers.Values.Count(value => value.State == WebSocketState.Open),
            httpViewerActive = HttpViewerActive(session)
        };
""",
    """        if (!_sessions.TryGetValue(deviceId, out var session))
            return new
            {
                deviceId,
                agentConnected = false,
                viewerCount = 0,
                httpViewerActive = false,
                queuedInputs = 0
            };
        return new
        {
            deviceId,
            agentConnected = session.Agent?.State == WebSocketState.Open,
            viewerCount = session.Viewers.Values.Count(value => value.State == WebSocketState.Open),
            httpViewerActive = HttpViewerActive(session),
            queuedInputs = Math.Max(0, Volatile.Read(ref session.PendingInputCount))
        };
""")

replace_once(
    relay,
    """    private sealed class DesktopSession(string deviceId)
    {
""",
    """    private sealed record QueuedDesktopInput(
        string Message,
        long ExpiresAtUnixMilliseconds);

    private sealed class DesktopSession(string deviceId)
    {
""")

replace_once(
    relay,
    """        public SemaphoreSlim ViewerSignal { get; } = new(0, 1);
        public ConcurrentDictionary<Guid, WebSocket> Viewers { get; } = new();
""",
    """        public SemaphoreSlim ViewerSignal { get; } = new(0, 1);
        public ConcurrentQueue<QueuedDesktopInput> PendingInputs { get; } = new();
        public int PendingInputCount;
        public ConcurrentDictionary<Guid, WebSocket> Viewers { get; } = new();
""")

replace_once(
    "src/Sirk.Portal/Ui/PortalUiCompatibilityEndpoints.cs",
    """            await desktop.SendInputAsync(device.Id, message, context.RequestAborted);
            return Results.Ok(new { ok = true });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, \"AGENT_NOT_FOUND\", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return PortalAuthenticationEndpoints.Error(409, \"DESKTOP_STREAM_OFFLINE\", exception.Message);
        }
""",
    """            var delivery = await desktop.SendOrQueueInputAsync(
                device.Id,
                message,
                context.RequestAborted);
            return Results.Ok(new { ok = true, delivery });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, \"AGENT_NOT_FOUND\", exception.Message);
        }
""")

replace_once(
    "src/Sirk.Portal/Agent/LegacyAgentCompatibilityEndpoints.cs",
    """        var wait = TimeSpan.FromMilliseconds(Math.Clamp(request.WaitMilliseconds ?? 0, 0, 25_000));
        var viewerActive = await desktop.WaitForViewerAsync(device.Id, wait, context.RequestAborted);
        return Results.Ok(new
        {
            viewerActive,
            inputs = Array.Empty<object>()
        });
""",
    """        var wait = TimeSpan.FromMilliseconds(Math.Clamp(request.WaitMilliseconds ?? 0, 0, 25_000));
        var viewerActive = await desktop.WaitForViewerAsync(device.Id, wait, context.RequestAborted);
        var inputs = desktop.DrainQueuedInputs(device.Id, 128);
        return Results.Ok(new
        {
            viewerActive,
            inputs
        });
""")

relay_text = Path(relay).read_text(encoding="utf-8")
ui_text = Path("src/Sirk.Portal/Ui/PortalUiCompatibilityEndpoints.cs").read_text(encoding="utf-8")
legacy_text = Path("src/Sirk.Portal/Agent/LegacyAgentCompatibilityEndpoints.cs").read_text(encoding="utf-8")
for required in (
    "SendOrQueueInputAsync",
    "DrainQueuedInputs",
    "MaximumQueuedInputs = 256",
    "QueuedInputLifetime = TimeSpan.FromSeconds(10)",
    "ConcurrentQueue<QueuedDesktopInput>",
):
    if required not in relay_text:
        raise SystemExit(f"missing relay contract: {required}")
if "DESKTOP_STREAM_OFFLINE" in ui_text:
    raise SystemExit("HTTP desktop input still exposes the transient 409 contract")
if "var inputs = desktop.DrainQueuedInputs(device.Id, 128);" not in legacy_text:
    raise SystemExit("Agent control endpoint does not drain queued inputs")

Path(".github/workflows/apply-http-desktop-input-fallback.yml").unlink()
Path(".github/scripts/apply-http-desktop-input-fallback.py").unlink()
