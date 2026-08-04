using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Security;

namespace Sirk.Portal.Agent;

internal sealed record AgentGroupAdminRequest(
    string Action,
    string? Id,
    string? Name,
    string? Description,
    bool? Enabled,
    string? PortalOrigin,
    bool? Interactive);

internal sealed record AgentDeviceAdminRequest(
    string Action,
    string DeviceId,
    string? GroupId,
    string? Name,
    bool? Enabled);

internal static class AgentEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapAgentEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/agent/enroll", EnrollAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/v1/agent/heartbeat", HeartbeatAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapGet("/api/v1/agent/commands", PollCommandsAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapPost("/api/v1/agent/commands/results", CompleteCommandAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapGet("/api/v1/agent/policy", GetPolicyAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        endpoints.MapGet("/api/v1/agent/desktop/stream", AgentDesktopAsync)
            .AllowAnonymous()
            .DisableAntiforgery();

        var admin = endpoints
            .MapGroup("/api/v1/admin")
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        admin.MapGet("/agents", ListAgents);
        admin.MapPost("/agents", MutateAgentAsync);
        admin.MapGet("/agent-groups", ListGroups);
        admin.MapPost("/agent-groups", MutateGroupAsync);
        admin.MapGet("/agent-commands", ListCommands);
        admin.MapPost("/agent-commands", QueueCommandAsync);
        admin.MapGet("/agent-commands/{commandId}", GetCommandAsync);
        admin.MapGet("/agent-policies", ListPolicies);
        admin.MapPut("/agent-policies", UpdatePolicyAsync);
        admin.MapDelete("/agent-policies/{scopeType}/{scopeId}", DeletePolicyAsync);

        endpoints.MapGet("/api/v1/desktop/stream", ViewerDesktopAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapGet("/api/v1/desktop/status/{deviceId}", (
                string deviceId,
                DesktopRelayHub desktop) => Results.Ok(desktop.Status(deviceId)))
            .RequireAuthorization(PortalPolicies.DeviceRead);

        return endpoints;
    }

    private static async Task<IResult> EnrollAsync(
        HttpContext context,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var body = await ReadBodyAsync(context.Request, 256 * 1024, context.RequestAborted);
        AgentEnrollmentRequest request;
        try
        {
            request = Deserialize<AgentEnrollmentRequest>(body);
            var issued = agents.Enroll(
                request,
                PortalAuthenticationEndpoints.RemoteAddress(context));
            audit.Write(new PortalAuditEvent(
                issued.Device.Id,
                issued.Device.Name,
                "agent.enroll",
                "device",
                issued.Device.Id,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string>
                {
                    ["groupId"] = issued.Device.GroupId,
                    ["tenantId"] = issued.Device.TenantId
                }));
            return Results.Json(new
            {
                ok = true,
                device = agents.PublicDevice(issued.Device),
                credential = new
                {
                    deviceId = issued.Device.Id,
                    deviceToken = issued.DeviceToken,
                    signingAlgorithm = "HMAC-SHA256",
                    shownOnce = true
                }
            }, statusCode: StatusCodes.Status201Created);
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_GROUP_NOT_FOUND", exception.Message);
        }
        catch (UnauthorizedAccessException exception)
        {
            return PortalAuthenticationEndpoints.Error(401, "AGENT_ENROLLMENT_DENIED", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_ENROLLMENT_FAILED", exception.Message);
        }
    }

    private static async Task<IResult> HeartbeatAsync(
        HttpContext context,
        AgentStore agents,
        AgentRequestAuthenticator authenticator)
    {
        var body = await ReadBodyAsync(context.Request, 256 * 1024, context.RequestAborted);
        using var principal = authenticator.Authenticate(context.Request, body);
        if (principal is null) return UnauthorizedAgent();

        try
        {
            var heartbeat = Deserialize<AgentHeartbeatRequest>(body);
            var device = agents.Heartbeat(
                principal.DeviceId,
                heartbeat,
                PortalAuthenticationEndpoints.RemoteAddress(context));
            return SignedJson(
                context,
                authenticator,
                principal,
                new
                {
                    ok = true,
                    acceptedAtUtc = DateTimeOffset.UtcNow,
                    nextHeartbeatSeconds = 30,
                    device = agents.PublicDevice(device)
                });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or KeyNotFoundException or UnauthorizedAccessException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_HEARTBEAT_FAILED", exception.Message);
        }
    }

    private static async Task<IResult> PollCommandsAsync(
        HttpContext context,
        AgentCommandStore commands,
        AgentRequestAuthenticator authenticator)
    {
        using var principal = authenticator.Authenticate(context.Request, []);
        if (principal is null) return UnauthorizedAgent();
        var limit = int.TryParse(context.Request.Query["limit"], out var parsed) ? parsed : 8;
        var values = commands.Poll(principal.DeviceId, limit);
        return SignedJson(
            context,
            authenticator,
            principal,
            new
            {
                ok = true,
                commands = values.Select(value => new
                {
                    value.Id,
                    value.Type,
                    value.Parameters,
                    value.CreatedAtUtc,
                    value.ExpiresAtUtc
                }),
                serverTimeUtc = DateTimeOffset.UtcNow
            });
    }

    private static async Task<IResult> CompleteCommandAsync(
        HttpContext context,
        AgentCommandStore commands,
        AgentRequestAuthenticator authenticator,
        PortalAuditLog audit)
    {
        var body = await ReadBodyAsync(context.Request, 4 * 1024 * 1024, context.RequestAborted);
        using var principal = authenticator.Authenticate(context.Request, body);
        if (principal is null) return UnauthorizedAgent();

        try
        {
            var request = Deserialize<AgentCommandResultRequest>(body);
            var command = commands.Complete(principal.DeviceId, request);
            audit.Write(new PortalAuditEvent(
                principal.DeviceId,
                principal.Device.Name,
                "agent.command.complete",
                "agent-command",
                command.Id,
                request.Success,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string> { ["type"] = command.Type }));
            return SignedJson(
                context,
                authenticator,
                principal,
                new { ok = true, command });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_COMMAND_NOT_FOUND", exception.Message);
        }
        catch (JsonException exception)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_COMMAND_RESULT_INVALID", exception.Message);
        }
    }

    private static Task<IResult> GetPolicyAsync(
        HttpContext context,
        AgentPolicyStore policies,
        AgentRequestAuthenticator authenticator)
    {
        using var principal = authenticator.Authenticate(context.Request, []);
        if (principal is null) return Task.FromResult(UnauthorizedAgent());
        return Task.FromResult(SignedJson(
            context,
            authenticator,
            principal,
            new
            {
                ok = true,
                value = policies.EffectiveFor(principal.Device)
            }));
    }

    private static async Task AgentDesktopAsync(
        HttpContext context,
        AgentRequestAuthenticator authenticator,
        DesktopRelayHub desktop)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        using var principal = authenticator.Authenticate(context.Request, []);
        if (principal is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        await desktop.AttachAgentAsync(principal.DeviceId, socket, context.RequestAborted);
    }

    private static IResult ListAgents(AgentStore agents) =>
        Results.Ok(new { ok = true, value = agents.Snapshot() });

    private static async Task<IResult> MutateAgentAsync(
        AgentDeviceAdminRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            object? value;
            var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
            if (action == "update")
            {
                value = agents.UpdateDevice(
                    request.DeviceId,
                    request.GroupId,
                    request.Name,
                    request.Enabled);
            }
            else if (action == "delete")
            {
                agents.DeleteDevice(request.DeviceId);
                value = null;
            }
            else
            {
                throw new InvalidDataException("Agent action is invalid.");
            }
            AuditAdmin(audit, context, "agent." + action, "device", request.DeviceId);
            return Results.Ok(new { ok = true, result = value, value = agents.Snapshot() });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_MUTATION_FAILED", exception.Message);
        }
    }

    private static IResult ListGroups(AgentStore agents) =>
        Results.Ok(new { ok = true, value = agents.Snapshot() });

    private static async Task<IResult> MutateGroupAsync(
        AgentGroupAdminRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
            object? value;
            string? enrollmentToken = null;
            string? bootstrapScript = null;
            if (action == "create")
            {
                var issued = agents.CreateGroup(request.Id, request.Name, request.Description);
                value = issued.Group;
                enrollmentToken = issued.EnrollmentToken;
                bootstrapScript = BuildScript(agents, request, issued.Group.Id, issued.EnrollmentToken);
            }
            else if (action == "rotate-token")
            {
                var issued = agents.RotateGroupToken(Required(request.Id, "Group ID"));
                value = issued.Group;
                enrollmentToken = issued.EnrollmentToken;
                bootstrapScript = BuildScript(agents, request, issued.Group.Id, issued.EnrollmentToken);
            }
            else if (action == "update")
            {
                value = agents.UpdateGroup(
                    Required(request.Id, "Group ID"),
                    request.Name,
                    request.Description,
                    request.Enabled);
            }
            else if (action == "delete")
            {
                agents.DeleteGroup(Required(request.Id, "Group ID"));
                value = null;
            }
            else
            {
                throw new InvalidDataException("Agent group action is invalid.");
            }

            AuditAdmin(audit, context, "agent-group." + action, "agent-group", request.Id ?? string.Empty);
            return Results.Ok(new
            {
                ok = true,
                result = value,
                credential = enrollmentToken is null
                    ? null
                    : new { enrollmentToken, shownOnce = true },
                bootstrapScript,
                value = agents.Snapshot()
            });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_GROUP_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_GROUP_MUTATION_FAILED", exception.Message);
        }
    }

    private static IResult ListCommands(
        HttpContext context,
        AgentCommandStore commands)
    {
        var deviceId = context.Request.Query["deviceId"].ToString();
        var limit = int.TryParse(context.Request.Query["limit"], out var parsed) ? parsed : 100;
        return Results.Ok(new
        {
            ok = true,
            value = commands.List(deviceId, limit)
        });
    }

    private static async Task<IResult> QueueCommandAsync(
        AgentCommandQueueRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentCommandStore commands,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var command = commands.Queue(
                request,
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context));
            AuditAdmin(audit, context, "agent.command.queue", "agent-command", command.Id);
            return Results.Json(new { ok = true, value = command }, statusCode: StatusCodes.Status202Accepted);
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_COMMAND_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> GetCommandAsync(
        string commandId,
        HttpContext context,
        AgentCommandStore commands)
    {
        var wait = int.TryParse(context.Request.Query["waitMilliseconds"], out var parsed)
            ? Math.Clamp(parsed, 0, 25_000)
            : 0;
        var value = wait > 0
            ? await commands.WaitAsync(commandId, TimeSpan.FromMilliseconds(wait), context.RequestAborted)
            : commands.Get(commandId);
        return value is null
            ? PortalAuthenticationEndpoints.Error(404, "AGENT_COMMAND_NOT_FOUND", "Agent command was not found.")
            : Results.Ok(new { ok = true, value });
    }

    private static IResult ListPolicies(AgentPolicyStore policies) =>
        Results.Ok(new { ok = true, value = policies.List() });

    private static async Task<IResult> UpdatePolicyAsync(
        AgentPolicyUpdateRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentPolicyStore policies,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var value = policies.Update(
                request,
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context));
            AuditAdmin(audit, context, "agent.policy.update", "agent-policy", request.ScopeType + ":" + request.ScopeId);
            return Results.Ok(new { ok = true, value });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_POLICY_SCOPE_NOT_FOUND", exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_POLICY_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> DeletePolicyAsync(
        string scopeType,
        string scopeId,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentPolicyStore policies,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            policies.Delete(scopeType, scopeId);
            AuditAdmin(audit, context, "agent.policy.delete", "agent-policy", scopeType + ":" + scopeId);
            return Results.Ok(new { ok = true });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_POLICY_NOT_FOUND", exception.Message);
        }
    }

    private static async Task ViewerDesktopAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        if (!context.WebSockets.IsWebSocketRequest ||
            (!ValidSameOrigin(context) && context.Items["Sirk.InternalTunnel"] is not true))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        var deviceId = context.Request.Query["deviceId"].ToString().Trim().ToLowerInvariant();
        if (agents.GetDevice(deviceId) is not { Enabled: true })
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        await desktop.AttachViewerAsync(deviceId, socket, context.RequestAborted);
    }

    private static IResult SignedJson(
        HttpContext context,
        AgentRequestAuthenticator authenticator,
        AgentPrincipal principal,
        object value)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        var signature = authenticator.SignResponse(principal, body);
        context.Response.Headers["X-SIRK-Timestamp"] = signature.Timestamp;
        context.Response.Headers["X-SIRK-Nonce"] = signature.Nonce;
        context.Response.Headers["X-SIRK-Signature"] = signature.Signature;
        context.Response.Headers.CacheControl = "no-store";
        return Results.Bytes(body, "application/json; charset=utf-8");
    }

    private static IResult UnauthorizedAgent() =>
        PortalAuthenticationEndpoints.Error(401, "AGENT_AUTHENTICATION_FAILED", "Agent authentication failed.");

    private static async Task<byte[]> ReadBodyAsync(
        HttpRequest request,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength > maximumBytes)
            throw new InvalidDataException("Request body is too large.");
        using var memory = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var count = await request.Body.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            if (memory.Length + count > maximumBytes)
                throw new InvalidDataException("Request body is too large.");
            memory.Write(buffer, 0, count);
        }
        return memory.ToArray();
    }

    private static T Deserialize<T>(byte[] body) =>
        JsonSerializer.Deserialize<T>(body, JsonOptions)
        ?? throw new JsonException("Request JSON body is empty.");

    private static string BuildScript(
        AgentStore agents,
        AgentGroupAdminRequest request,
        string groupId,
        string token)
    {
        var origin = Required(request.PortalOrigin, "Portal origin");
        return agents.BootstrapScript(groupId, token, origin, request.Interactive == true);
    }

    private static string Required(string? value, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length > 0
            ? normalized
            : throw new InvalidDataException($"{field} is required.");
    }

    private static void AuditAdmin(
        PortalAuditLog audit,
        HttpContext context,
        string action,
        string targetType,
        string targetId)
    {
        audit.Write(new PortalAuditEvent(
            PortalAuthenticationEndpoints.ActorId(context),
            PortalAuthenticationEndpoints.ActorName(context),
            action,
            targetType,
            targetId,
            true,
            PortalAuthenticationEndpoints.RemoteAddress(context),
            context.TraceIdentifier));
    }

    private static bool ValidSameOrigin(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrWhiteSpace(origin)) return false;
        return Uri.TryCreate(origin, UriKind.Absolute, out var value) &&
               string.Equals(value.Scheme, context.Request.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(value.Authority, context.Request.Host.Value, StringComparison.OrdinalIgnoreCase);
    }
}
