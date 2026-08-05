using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sirk.Portal.Security;

namespace Sirk.Portal.Agent;

internal sealed record AgentV1EnrollmentRequest(
    int ProtocolVersion,
    string TenantId,
    string DeviceId,
    string MachineName,
    string PublicKeySpki);

internal sealed record AgentV1CheckInRequest(
    int ProtocolVersion,
    string TenantId,
    string DeviceId,
    string MachineName,
    string? AgentVersion,
    JsonElement? Heartbeat,
    JsonElement? Management,
    JsonElement? RuntimeHealth,
    JsonElement? Watchdog,
    JsonElement? Network,
    JsonElement? Security,
    JsonElement? Quarantine,
    JsonElement? Endurance,
    JsonElement? Activity,
    JsonElement? BrowserActivity,
    JsonElement? Risk,
    JsonElement? Tamper,
    JsonElement? PortalStatus,
    JsonElement? TelemetryQueue,
    IReadOnlyList<string>? AcknowledgedPolicyIds,
    IReadOnlyList<AgentV1CommandResult>? CommandResults,
    int? WaitMilliseconds,
    IReadOnlyList<JsonElement>? Events);

internal sealed record AgentV1CommandResult(
    string CommandId,
    bool Ok,
    string? Code,
    string? Output,
    JsonElement? Data);

internal sealed record AgentV1DesktopControlRequest(
    string TenantId,
    string DeviceId,
    int? WaitMilliseconds);

internal sealed record AgentV1RotateKeyRequest(
    string TenantId,
    string DeviceId,
    string PublicKeySpki);

internal static class AgentManagementV1Endpoints
{
    private const int MaximumBodyBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan MaximumClockSkew = TimeSpan.FromMinutes(2);
    private static readonly ConcurrentDictionary<string, long> Nonces = new(StringComparer.Ordinal);
    private static long _lastNonceCleanup;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapAgentManagementV1(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/agent/enroll", EnrollAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/v1/agent/checkin", CheckInAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/v1/agent/rotate-key", RotateKeyAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapGet("/api/v1/agent/desktop/stream", AgentDesktopStreamAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/v1/agent/desktop/control", AgentDesktopControlAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        return endpoints;
    }

    private static async Task<IResult> EnrollAsync(
        HttpContext context,
        AgentStore agents,
        PortalAuditLog audit,
        AgentPolicySigner policySigner)
    {
        try
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                return Unauthorized("AGENT_ENROLLMENT_TOKEN_MISSING", "Enrollment token is required.");

            var compoundToken = authorization[7..].Trim();
            var separator = compoundToken.IndexOf('.');
            if (separator is < 3 || separator == compoundToken.Length - 1)
            {
                return Unauthorized(
                    "AGENT_ENROLLMENT_TOKEN_INVALID",
                    "Enrollment token must contain the computer group identifier.");
            }

            var groupId = compoundToken[..separator].Trim().ToLowerInvariant();
            var enrollmentToken = compoundToken[(separator + 1)..].Trim();
            var body = await ReadBodyAsync(context.Request, MaximumBodyBytes, context.RequestAborted);
            var request = Deserialize<AgentV1EnrollmentRequest>(body);
            if (request.ProtocolVersion != 1)
                throw new InvalidDataException("Unsupported Agent enrollment protocol version.");

            ValidatePublicKey(request.PublicKeySpki);
            var issued = agents.Enroll(
                new AgentEnrollmentRequest(
                    groupId,
                    enrollmentToken,
                    request.DeviceId,
                    request.TenantId,
                    request.MachineName,
                    request.MachineName,
                    "Windows",
                    "setup-v1",
                    new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["protocol"] = "agent-v1-ecdsa",
                        ["publicKeySpki"] = request.PublicKeySpki
                    }),
                PortalAuthenticationEndpoints.RemoteAddress(context));

            audit.Write(new PortalAuditEvent(
                issued.Device.Id,
                issued.Device.Name,
                "agent.enroll.v1",
                "device",
                issued.Device.Id,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string>
                {
                    ["groupId"] = issued.Device.GroupId,
                    ["tenantId"] = issued.Device.TenantId,
                    ["protocol"] = "agent-v1-ecdsa"
                }));

            return Results.Json(
                new
                {
                    ok = true,
                    tenantId = issued.Device.TenantId,
                    deviceId = issued.Device.Id,
                    deviceToken = issued.DeviceToken,
                    checkInEndpoint = "/api/v1/agent/checkin",
                    enrolledAtUtc = issued.Device.EnrolledAtUtc,
                    trustedPolicyKeys = new[] { policySigner.TrustedKey() }
                },
                statusCode: StatusCodes.Status201Created);
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_GROUP_NOT_FOUND", exception.Message);
        }
        catch (UnauthorizedAccessException exception)
        {
            return Unauthorized("AGENT_ENROLLMENT_DENIED", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or JsonException or CryptographicException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_ENROLLMENT_FAILED", exception.Message);
        }
    }

    private static async Task<IResult> CheckInAsync(
        HttpContext context,
        AgentStore agents,
        AgentCommandStore commands,
        AgentPolicyStore policies,
        AgentPolicySigner policySigner)
    {
        var body = await ReadBodyAsync(context.Request, MaximumBodyBytes, context.RequestAborted);
        AgentV1CheckInRequest request;
        try
        {
            request = Deserialize<AgentV1CheckInRequest>(body);
        }
        catch (Exception exception) when (exception is InvalidDataException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_CHECKIN_INVALID", exception.Message);
        }

        if (request.ProtocolVersion != 1)
            return PortalAuthenticationEndpoints.Error(400, "AGENT_PROTOCOL_UNSUPPORTED", "Unsupported Agent protocol version.");

        var device = agents.GetDevice(request.DeviceId);
        if (device is not { Enabled: true } ||
            !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal))
        {
            return Unauthorized("AGENT_AUTHENTICATION_FAILED", "Device is unknown or disabled.");
        }

        if (!Authenticate(context.Request, body, device, agents))
            return Unauthorized("AGENT_AUTHENTICATION_FAILED", "Agent authentication failed.");

        try
        {
            var metadata = new Dictionary<string, string>(device.Metadata, StringComparer.Ordinal)
            {
                ["protocol"] = "agent-v1-ecdsa",
                ["heartbeat"] = Summarize(request.Heartbeat),
                ["management"] = Summarize(request.Management),
                ["runtimeHealth"] = Summarize(request.RuntimeHealth),
                ["security"] = Summarize(request.Security),
                ["quarantine"] = Summarize(request.Quarantine),
                ["risk"] = Summarize(request.Risk)
            };
            _ = agents.Heartbeat(
                device.Id,
                new AgentHeartbeatRequest(
                    string.IsNullOrWhiteSpace(request.MachineName) ? device.Name : request.MachineName,
                    string.IsNullOrWhiteSpace(request.MachineName) ? device.HostName : request.MachineName,
                    "Windows",
                    string.IsNullOrWhiteSpace(request.AgentVersion) ? device.AgentVersion : request.AgentVersion,
                    "online",
                    metadata),
                PortalAuthenticationEndpoints.RemoteAddress(context));

            foreach (var result in request.CommandResults ?? [])
            {
                try
                {
                    var canonicalResult = JsonSerializer.SerializeToElement(new
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
                            canonicalResult,
                            result.Ok
                                ? null
                                : NormalizeError(result.Code, result.Output)));
                }
                catch (KeyNotFoundException)
                {
                    // A stale result can be safely ignored after command retention cleanup.
                }
            }

            var delivered = new List<object>();
            foreach (var command in commands.Poll(device.Id, 8))
            {
                var canonicalType = AgentCommandType(command.Type);
                if (canonicalType is null)
                {
                    commands.Complete(
                        device.Id,
                        new AgentCommandResultRequest(
                            command.Id,
                            false,
                            null,
                            "Command type is not supported by Agent protocol v1."));
                    continue;
                }

                delivered.Add(new
                {
                    commandId = command.Id,
                    type = canonicalType,
                    parameters = command.Parameters,
                    command.CreatedAtUtc,
                    command.ExpiresAtUtc
                });
            }

            var effective = policies.EffectiveForDelivery(device);
            var deliveredPolicies = Array.Empty<JsonElement>();
            if (effective is not null)
            {
                var signed = policySigner.Sign(
                    device.TenantId, device.Id, effective.Revision, effective.Policy);
                if (!(request.AcknowledgedPolicyIds ?? []).Contains(
                        signed.PolicyId, StringComparer.Ordinal))
                    deliveredPolicies = [signed.Envelope];
            }

            return Results.Ok(new
            {
                ok = true,
                protocolVersion = 1,
                trustedPolicyKeys = new[] { policySigner.TrustedKey() },
                policies = deliveredPolicies,
                commands = delivered
            });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or CryptographicException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_CHECKIN_FAILED", exception.Message);
        }
    }


    private static async Task<IResult> RotateKeyAsync(
        HttpContext context,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var body = await ReadBodyAsync(context.Request, 64 * 1024, context.RequestAborted);
        AgentV1RotateKeyRequest request;
        try
        {
            request = Deserialize<AgentV1RotateKeyRequest>(body);
            ValidatePublicKey(request.PublicKeySpki);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or JsonException or CryptographicException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_ROTATE_KEY_INVALID", exception.Message);
        }

        var device = agents.GetDevice(request.DeviceId);
        if (device is not { Enabled: true } ||
            !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal) ||
            !Authenticate(context.Request, body, device, agents))
        {
            return Unauthorized("AGENT_AUTHENTICATION_FAILED", "Agent authentication failed.");
        }

        try
        {
            var updated = agents.RotateDevicePublicKey(device.Id, request.PublicKeySpki);
            audit.Write(new PortalAuditEvent(
                updated.Id,
                updated.Name,
                "agent.rotate-key.v1",
                "device",
                updated.Id,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string>
                {
                    ["tenantId"] = updated.TenantId,
                    ["protocol"] = "agent-v1-ecdsa"
                }));
            return Results.Ok(new
            {
                ok = true,
                tenantId = updated.TenantId,
                deviceId = updated.Id,
                rotatedAtUtc = updated.UpdatedAtUtc
            });
        }
        catch (Exception exception) when (
            exception is KeyNotFoundException or UnauthorizedAccessException or InvalidDataException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_ROTATE_KEY_FAILED", exception.Message);
        }
    }

    private static async Task AgentDesktopStreamAsync(
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

    private static async Task<IResult> AgentDesktopControlAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        var body = await ReadBodyAsync(context.Request, 64 * 1024, context.RequestAborted);
        AgentV1DesktopControlRequest request;
        try { request = Deserialize<AgentV1DesktopControlRequest>(body); }
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
        var inputs = desktop.DrainQueuedInputs(device.Id, 128);
        return Results.Ok(new
        {
            viewerActive,
            inputs
        });
    }

    private static bool Authenticate(
        HttpRequest request,
        ReadOnlySpan<byte> body,
        AgentDeviceRecord device,
        AgentStore agents)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
        var deviceToken = authorization[7..].Trim();
        if (string.IsNullOrWhiteSpace(deviceToken)) return false;

        byte[] expectedTokenHash;
        try
        {
            expectedTokenHash = agents.GetSigningKey(device.Id);
        }
        catch (Exception exception) when (
            exception is KeyNotFoundException or UnauthorizedAccessException or CryptographicException)
        {
            return false;
        }

        var suppliedTokenHash = SHA256.HashData(Encoding.UTF8.GetBytes(deviceToken));
        try
        {
            if (!CryptographicOperations.FixedTimeEquals(expectedTokenHash, suppliedTokenHash))
                return false;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(expectedTokenHash);
            CryptographicOperations.ZeroMemory(suppliedTokenHash);
        }

        var timestampText = request.Headers["X-SIRK-Timestamp"].ToString();
        var nonce = request.Headers["X-SIRK-Nonce"].ToString();
        var signatureText = request.Headers["X-SIRK-Signature"].ToString();
        if (!long.TryParse(timestampText, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds))
            return false;
        DateTimeOffset requestTime;
        try
        {
            requestTime = DateTimeOffset.FromUnixTimeSeconds(seconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
        if ((DateTimeOffset.UtcNow - requestTime).Duration() > MaximumClockSkew) return false;
        if (nonce.Length is < 16 or > 128 || nonce.Any(character => !char.IsAsciiLetterOrDigit(character)))
            return false;

        CleanupNonces(seconds);
        var replayKey = device.Id + ":" + nonce;
        if (!Nonces.TryAdd(replayKey, seconds)) return false;

        if (!device.Metadata.TryGetValue("publicKeySpki", out var publicKeyBase64))
        {
            Nonces.TryRemove(replayKey, out _);
            return false;
        }

        try
        {
            var signature = Convert.FromBase64String(signatureText);
            var prefix = Encoding.UTF8.GetBytes(timestampText + "\n" + nonce + "\n");
            var signed = new byte[prefix.Length + body.Length];
            Buffer.BlockCopy(prefix, 0, signed, 0, prefix.Length);
            body.CopyTo(signed.AsSpan(prefix.Length));
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKeyBase64), out _);
            var valid = key.KeySize == 256 && key.VerifyData(
                signed,
                signature,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
            if (!valid) Nonces.TryRemove(replayKey, out _);
            return valid;
        }
        catch (Exception exception) when (
            exception is FormatException or CryptographicException)
        {
            Nonces.TryRemove(replayKey, out _);
            return false;
        }
    }

    private static void ValidatePublicKey(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1024)
            throw new InvalidDataException("Agent public key is invalid.");
        using var key = ECDsa.Create();
        key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(value), out _);
        if (key.KeySize != 256)
            throw new InvalidDataException("Agent public key must use ECDSA P-256.");
    }

    private static string? AgentCommandType(string type) => type switch
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
    };

    private static string NormalizeError(string? code, string? output)
    {
        var value = string.Join(": ", new[] { code, output }
            .Where(item => !string.IsNullOrWhiteSpace(item)));
        if (string.IsNullOrWhiteSpace(value)) value = "Agent command failed.";
        return value.Length <= 4096 ? value : value[..4096];
    }

    internal static string Summarize(JsonElement? value)
    {
        if (value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return string.Empty;
        var text = JsonSerializer.Serialize(value.Value, JsonOptions);
        return text.Length <= 1000 ? text : text[..1000];
    }

    private static async Task<byte[]> ReadBodyAsync(
        HttpRequest request,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength is { } contentLength && contentLength > maximumBytes)
            throw new InvalidDataException("Request body is too large.");
        await using var memory = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (memory.Length + read > maximumBytes)
                throw new InvalidDataException("Request body is too large.");
            await memory.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        return memory.ToArray();
    }

    private static T Deserialize<T>(ReadOnlySpan<byte> body)
    {
        if (body.IsEmpty) throw new InvalidDataException("Request body is required.");
        return JsonSerializer.Deserialize<T>(body, JsonOptions)
               ?? throw new InvalidDataException("Request body is invalid.");
    }

    private static IResult Unauthorized(string code, string message) =>
        PortalAuthenticationEndpoints.Error(401, code, message);

    private static void CleanupNonces(long currentTimestamp)
    {
        var previous = Interlocked.Read(ref _lastNonceCleanup);
        if (currentTimestamp - previous < 60 ||
            Interlocked.CompareExchange(ref _lastNonceCleanup, currentTimestamp, previous) != previous)
        {
            return;
        }

        var minimum = DateTimeOffset.UtcNow.Subtract(MaximumClockSkew).ToUnixTimeSeconds();
        foreach (var item in Nonces)
        {
            if (item.Value < minimum)
                Nonces.TryRemove(item.Key, out _);
        }
    }
}
