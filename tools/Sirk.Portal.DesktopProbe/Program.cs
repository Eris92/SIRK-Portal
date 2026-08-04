using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

if (args.Length < 4)
{
    Console.Error.WriteLine(
        "Usage: dotnet run --project tools/Sirk.Portal.DesktopProbe -- " +
        "<portal> <seconds> <tenant> <device>");
    return 64;
}

var baseUri = new Uri(args[0], UriKind.Absolute);
var duration = TimeSpan.FromSeconds(Math.Clamp(int.Parse(args[1]), 5, 120));
var tenantId = args[2];
var deviceId = args[3];
var username = Environment.GetEnvironmentVariable("SIRK_TEST_PORTAL_USER");
var password = Environment.GetEnvironmentVariable("SIRK_TEST_PORTAL_PASSWORD");
if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
{
    Console.Error.WriteLine(
        "Set SIRK_TEST_PORTAL_USER and SIRK_TEST_PORTAL_PASSWORD.");
    return 64;
}

var cookies = new CookieContainer();
using var handler = new HttpClientHandler
{
    AllowAutoRedirect = false,
    CookieContainer = cookies,
    ServerCertificateCustomValidationCallback =
        HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
};
using var client = new HttpClient(handler)
{
    BaseAddress = baseUri,
    Timeout = TimeSpan.FromSeconds(45)
};

using (var login = await client.PostAsync(
           "/api/auth/login",
           new FormUrlEncodedContent(new Dictionary<string, string>
           {
               ["username"] = username,
               ["password"] = password
           })))
{
    if (!login.IsSuccessStatusCode)
    {
        Console.Error.WriteLine($"Login failed: HTTP {(int)login.StatusCode}");
        return 1;
    }
}

using var bootstrapResponse = await client.GetAsync("/api/bootstrap");
bootstrapResponse.EnsureSuccessStatusCode();
using var bootstrap = JsonDocument.Parse(
    await bootstrapResponse.Content.ReadAsByteArrayAsync());
var csrfToken = bootstrap.RootElement.GetProperty("csrfToken").GetString() ?? string.Empty;

using (var profile = new HttpRequestMessage(HttpMethod.Post, "/api/agent-desktop/input"))
{
    profile.Headers.TryAddWithoutValidation("X-SIRK-CSRF", csrfToken);
    profile.Content = JsonContent.Create(new
    {
        tenantId,
        deviceId,
        input = new
        {
            action = "streamProfile",
            sessionId = 2,
            monitorIndex = 0,
            maxWidth = 1280,
            quality = 72,
            targetKbps = 1000
        }
    });
    using var response = await client.SendAsync(profile);
    response.EnsureSuccessStatusCode();
}

var webSocketUri = new UriBuilder(baseUri)
{
    Scheme = baseUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase)
        ? "wss"
        : "ws",
    Path = "/api/agent-desktop/stream",
    Query = $"tenantId={Uri.EscapeDataString(tenantId)}&deviceId={Uri.EscapeDataString(deviceId)}"
}.Uri;

using var socket = new ClientWebSocket();
socket.Options.Cookies = cookies;
socket.Options.RemoteCertificateValidationCallback = (_, _, _, _) => true;
socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
await socket.ConnectAsync(webSocketUri, CancellationToken.None);

var stopwatch = Stopwatch.StartNew();
var inputSentAt = stopwatch.ElapsedMilliseconds;
await SendTextAsync(socket, JsonSerializer.Serialize(new
{
    type = "input",
    id = 1,
    input = new
    {
        action = "requestKeyframe",
        sessionId = 2,
        monitorIndex = 0
    }
}), CancellationToken.None);

using var lifetime = new CancellationTokenSource(duration);
var cursorTask = Environment.GetEnvironmentVariable("SIRK_TEST_CURSOR_MOTION") == "1"
    ? RunCursorMotionAsync(socket, lifetime.Token)
    : Task.CompletedTask;

var result = new ProbeResult();
try
{
    while (!lifetime.IsCancellationRequested && socket.State == WebSocketState.Open)
    {
        var message = await ReceiveMessageAsync(socket, lifetime.Token);
        if (message is null) break;
        if (message.Value.Type == WebSocketMessageType.Text)
        {
            using var document = JsonDocument.Parse(message.Value.Data);
            var root = document.RootElement;
            if (root.TryGetProperty("type", out var type) &&
                type.GetString() == "inputAck" &&
                root.TryGetProperty("id", out var id) &&
                id.GetInt32() == 1)
            {
                result.InputAckMilliseconds =
                    stopwatch.ElapsedMilliseconds - inputSentAt;
            }
            continue;
        }

        ParseFrame(message.Value.Data, result);
    }
}
catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
{
}
finally
{
    lifetime.Cancel();
    try { await cursorTask; } catch (OperationCanceledException) { }
    if (socket.State == WebSocketState.Open)
    {
        await socket.CloseAsync(
            WebSocketCloseStatus.NormalClosure,
            "Probe complete",
            CancellationToken.None);
    }
}

var elapsed = Math.Max(0.001, stopwatch.Elapsed.TotalSeconds);
Console.WriteLine(JsonSerializer.Serialize(new
{
    frames = result.Frames,
    cursorUpdates = result.CursorUpdates,
    fps = result.Frames / elapsed,
    mbps = result.Bytes * 8d / elapsed / 1_000_000d,
    firstSequence = result.FirstSequence,
    lastSequence = result.LastSequence,
    inputAckMilliseconds = result.InputAckMilliseconds,
    captureP50Ms = Percentile(result.CaptureSamples, 0.50),
    captureP95Ms = Percentile(result.CaptureSamples, 0.95),
    encodeP50Ms = Percentile(result.EncodeSamples, 0.50),
    encodeP95Ms = Percentile(result.EncodeSamples, 0.95),
    sessionP50Ms = Percentile(result.SessionSamples, 0.50),
    sessionP95Ms = Percentile(result.SessionSamples, 0.95),
    frameAgeP50Ms = Percentile(result.AgeSamples, 0.50),
    frameAgeP95Ms = Percentile(result.AgeSamples, 0.95),
    backends = result.Backends.Order(StringComparer.Ordinal).ToArray()
}, new JsonSerializerOptions { WriteIndented = true }));
return 0;

static async Task SendTextAsync(
    ClientWebSocket socket,
    string value,
    CancellationToken cancellationToken)
{
    var bytes = Encoding.UTF8.GetBytes(value);
    await socket.SendAsync(
        bytes,
        WebSocketMessageType.Text,
        endOfMessage: true,
        cancellationToken);
}

static async Task RunCursorMotionAsync(
    ClientWebSocket socket,
    CancellationToken cancellationToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(16));
    var step = 0;
    while (await timer.WaitForNextTickAsync(cancellationToken))
    {
        step += 1;
        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "input",
            id = 0,
            input = new
            {
                action = "move",
                sessionId = 2,
                monitorIndex = 0,
                x = 200 + step * 17 % 800,
                y = 200 + step * 11 % 400
            }
        }), cancellationToken);
    }
}

static async Task<SocketMessage?> ReceiveMessageAsync(
    ClientWebSocket socket,
    CancellationToken cancellationToken)
{
    using var stream = new MemoryStream();
    var buffer = new byte[64 * 1024];
    WebSocketReceiveResult receive;
    do
    {
        receive = await socket.ReceiveAsync(buffer, cancellationToken);
        if (receive.MessageType == WebSocketMessageType.Close) return null;
        await stream.WriteAsync(buffer.AsMemory(0, receive.Count), cancellationToken);
    }
    while (!receive.EndOfMessage);
    return new SocketMessage(receive.MessageType, stream.ToArray());
}

static void ParseFrame(byte[] packet, ProbeResult result)
{
    if (packet.Length < 4) return;
    var metadataLength = BinaryPrimitives.ReadUInt32BigEndian(packet.AsSpan(0, 4));
    if (metadataLength > packet.Length - 4) return;
    using var document = JsonDocument.Parse(packet.AsMemory(4, (int)metadataLength));
    var metadata = document.RootElement;
    var cursorOnly = GetBoolean(metadata, "cursorOnly");
    if (cursorOnly) result.CursorUpdates += 1;
    else result.Frames += 1;
    var sequence = GetInt64(metadata, "sequence");
    if (result.FirstSequence == 0) result.FirstSequence = sequence;
    result.LastSequence = sequence;
    result.Bytes += packet.Length - 4 - metadataLength;
    var backend = GetString(metadata, "captureBackend");
    if (!string.IsNullOrWhiteSpace(backend)) result.Backends.Add(backend);
    result.CaptureSamples.Add(GetDouble(metadata, "captureMilliseconds"));
    result.EncodeSamples.Add(GetDouble(metadata, "encodeMilliseconds"));
    result.SessionSamples.Add(GetDouble(metadata, "sessionMilliseconds"));
    var capturedAt = GetInt64(metadata, "capturedAtUnixMilliseconds");
    if (capturedAt > 0)
        result.AgeSamples.Add(Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - capturedAt));
}

static string GetString(JsonElement value, string name) =>
    value.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String
        ? item.GetString() ?? string.Empty
        : string.Empty;
static bool GetBoolean(JsonElement value, string name) =>
    value.TryGetProperty(name, out var item) &&
    item.ValueKind is JsonValueKind.True or JsonValueKind.False && item.GetBoolean();
static long GetInt64(JsonElement value, string name) =>
    value.TryGetProperty(name, out var item) && item.TryGetInt64(out var result) ? result : 0;
static double GetDouble(JsonElement value, string name) =>
    value.TryGetProperty(name, out var item) && item.TryGetDouble(out var result) ? result : 0;
static double Percentile(List<double> values, double fraction)
{
    if (values.Count == 0) return 0;
    values.Sort();
    return values[Math.Min(values.Count - 1, (int)Math.Floor(values.Count * fraction))];
}

internal readonly record struct SocketMessage(
    WebSocketMessageType Type,
    byte[] Data);
internal sealed class ProbeResult
{
    public long Frames { get; set; }
    public long CursorUpdates { get; set; }
    public long Bytes { get; set; }
    public long FirstSequence { get; set; }
    public long LastSequence { get; set; }
    public long InputAckMilliseconds { get; set; }
    public HashSet<string> Backends { get; } = new(StringComparer.Ordinal);
    public List<double> CaptureSamples { get; } = [];
    public List<double> EncodeSamples { get; } = [];
    public List<double> SessionSamples { get; } = [];
    public List<double> AgeSamples { get; } = [];
}
