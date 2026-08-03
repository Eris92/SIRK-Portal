using System.Collections.Concurrent;
using System.Net.WebSockets;

namespace Sirk.Portal.Agent;

internal sealed class DesktopRelayHub
{
    private const int MaximumFrameBytes = 8 * 1024 * 1024;
    private const int MaximumInputBytes = 64 * 1024;
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
            await SafeCloseAsync(previous, WebSocketCloseStatus.PolicyViolation, "Agent stream replaced.", cancellationToken);
        }

        try
        {
            await ReceiveAgentFramesAsync(session, socket, cancellationToken);
        }
        finally
        {
            Interlocked.CompareExchange(ref session.Agent, null, socket);
            await CloseViewersAsync(session, "Agent stream closed.", cancellationToken);
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
        try
        {
            await ReceiveViewerInputAsync(session, socket, cancellationToken);
        }
        finally
        {
            session.Viewers.TryRemove(viewerId, out _);
            RemoveIfEmpty(session);
        }
    }

    public object Status(string deviceId)
    {
        if (!_sessions.TryGetValue(deviceId, out var session))
            return new { deviceId, agentConnected = false, viewerCount = 0 };
        return new
        {
            deviceId,
            agentConnected = session.Agent?.State == WebSocketState.Open,
            viewerCount = session.Viewers.Values.Count(value => value.State == WebSocketState.Open)
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
                await SafeCloseAsync(agent, WebSocketCloseStatus.InvalidMessageType, "Binary desktop frame required.", cancellationToken);
                break;
            }

            message.Write(buffer, 0, result.Count);
            if (message.Length > MaximumFrameBytes)
            {
                await SafeCloseAsync(agent, WebSocketCloseStatus.MessageTooBig, "Desktop frame is too large.", cancellationToken);
                break;
            }
            if (!result.EndOfMessage) continue;

            var frame = message.ToArray();
            message.SetLength(0);
            var viewers = session.Viewers.ToArray();
            foreach (var viewer in viewers)
            {
                if (viewer.Value.State != WebSocketState.Open)
                {
                    session.Viewers.TryRemove(viewer.Key, out _);
                    continue;
                }
                try
                {
                    await viewer.Value.SendAsync(
                        frame,
                        WebSocketMessageType.Binary,
                        endOfMessage: true,
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
                await SafeCloseAsync(viewer, WebSocketCloseStatus.InvalidMessageType, "Text input message required.", cancellationToken);
                break;
            }

            message.Write(buffer, 0, result.Count);
            if (message.Length > MaximumInputBytes)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.MessageTooBig, "Desktop input is too large.", cancellationToken);
                break;
            }
            if (!result.EndOfMessage) continue;

            var input = message.ToArray();
            message.SetLength(0);
            var agent = session.Agent;
            if (agent?.State != WebSocketState.Open)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.EndpointUnavailable, "Agent desktop stream is offline.", cancellationToken);
                break;
            }

            try
            {
                await agent.SendAsync(
                    input,
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    cancellationToken);
            }
            catch (WebSocketException)
            {
                await SafeCloseAsync(viewer, WebSocketCloseStatus.EndpointUnavailable, "Agent desktop stream failed.", cancellationToken);
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
            await SafeCloseAsync(
                viewer.Value,
                WebSocketCloseStatus.EndpointUnavailable,
                reason,
                cancellationToken);
        }
    }

    private void RemoveIfEmpty(DesktopSession session)
    {
        if (session.Agent is null && session.Viewers.IsEmpty)
            _sessions.TryRemove(new KeyValuePair<string, DesktopSession>(session.DeviceId, session));
    }

    private static async Task SafeCloseAsync(
        WebSocket socket,
        WebSocketCloseStatus status,
        string reason,
        CancellationToken cancellationToken)
    {
        if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived)) return;
        try
        {
            await socket.CloseAsync(status, reason, cancellationToken);
        }
        catch (Exception exception) when (
            exception is WebSocketException or OperationCanceledException)
        {
        }
    }

    private sealed class DesktopSession(string deviceId)
    {
        public string DeviceId { get; } = deviceId;
        public WebSocket? Agent;
        public ConcurrentDictionary<Guid, WebSocket> Viewers { get; } = new();
    }
}
