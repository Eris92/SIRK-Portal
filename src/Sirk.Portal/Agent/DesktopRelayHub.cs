using System.Buffers.Binary;
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
    private const int MaximumQueuedInputs = 256;
    private static readonly TimeSpan HttpViewerLease = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan QueuedInputLifetime = TimeSpan.FromSeconds(10);
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

    public async Task<string> SendOrQueueInputAsync(
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
                return "direct";
            }
            catch (Exception exception) when (
                exception is WebSocketException or InvalidOperationException)
            {
                // The Agent reconnects independently. Preserve short-lived input
                // for its authenticated HTTP control poll instead of returning 409.
            }
        }

        QueueInput(session, message);
        return "queued";
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
            throw new InvalidOperationException("Agent desktop stream is offline.");
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
                if (root.TryGetProperty("type", out var type) &&
                    string.Equals(type.GetString(), "input", StringComparison.Ordinal) &&
                    root.TryGetProperty("input", out var input) &&
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
            throw new InvalidDataException("Desktop input is too large.");
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
                throw new InvalidOperationException("Agent desktop stream is offline.");
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

    public object Status(string deviceId)
    {
        if (!_sessions.TryGetValue(deviceId, out var session))
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

    private async Task ReceiveViewerInputAsync(
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

    private sealed record QueuedDesktopInput(
        string Message,
        long ExpiresAtUnixMilliseconds);

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
        public ConcurrentQueue<QueuedDesktopInput> PendingInputs { get; } = new();
        public int PendingInputCount;
        public ConcurrentDictionary<Guid, WebSocket> Viewers { get; } = new();
    }
}
