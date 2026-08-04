using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Agent;
using Sirk.Portal.Security;
using Sirk.Portal.Settings;
using Sirk.Portal.Workflows;

namespace Sirk.Portal.Ui;

internal sealed record LegacyAgentGroupMutation(string? Id, string? Name, string? Description);
internal sealed record LegacyAgentOperationRequest(
    string? TenantId,
    string DeviceId,
    string Type,
    JsonElement Parameters);
internal sealed record LegacyDesktopInputRequest(
    string? TenantId,
    string DeviceId,
    JsonElement Input);
internal sealed record LegacyIdentityMutation(
    string? Action,
    string? Id,
    string? UserName,
    string? DisplayName,
    string? Password,
    string? Role,
    bool? Enabled,
    string? Name,
    string? Description,
    IReadOnlyList<string>? MemberIds);

internal static class PortalUiCompatibilityEndpoints
{
    private static readonly string[] ModuleKeys =
    [
        "portal", "approvals", "move-requests", "commands", "management",
        "jira", "security", "monitoring", "assets", "reports"
    ];

    public static IEndpointRouteBuilder MapPortalUiCompatibility(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/modules/portal/devices", DeviceInventory)
            .RequireAuthorization(PortalPolicies.DeviceRead);
        endpoints.MapGet("/api/v1/modules/portal/overview", Overview)
            .RequireAuthorization();

        endpoints.MapGet("/api/devices", (AgentStore agents) =>
            Results.Ok(new { ok = true, value = DeviceInventoryValue(agents) }))
            .RequireAuthorization(PortalPolicies.DeviceRead);
        endpoints.MapGet("/api/bootstrap", LegacyBootstrap)
            .RequireAuthorization();
        endpoints.MapPost("/api/agent-operations", LegacyAgentOperationCreateAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapGet("/api/agent-operations", LegacyAgentOperationStatusAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapGet("/api/agent-desktop/frame", LegacyDesktopFrameAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);
        endpoints.MapPost("/api/agent-desktop/input", LegacyDesktopInputAsync)
            .RequireAuthorization(PortalPolicies.DeviceOperate);

        endpoints.MapGet("/api/admin/agent-groups", LegacyAgentGroups)
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        endpoints.MapPost("/api/admin/agent-groups", LegacyAgentGroupCreateAsync)
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        endpoints.MapDelete("/api/admin/agent-groups", LegacyAgentGroupDeleteAsync)
            .RequireAuthorization(PortalPolicies.PortalAdministration);

        endpoints.MapGet("/api/admin/identity", (PortalIdentityStore identities) =>
            Results.Ok(new { ok = true, value = identities.Snapshot() }))
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        endpoints.MapPost("/api/admin/identity", LegacyIdentityMutationAsync)
            .RequireAuthorization(PortalPolicies.PortalAdministration);

        endpoints.MapGet("/api/admin/settings", LegacySettings)
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        endpoints.MapPost("/api/admin/settings", LegacySettingsUpdateAsync)
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        endpoints.MapGet("/api/admin/runtime", LegacyRuntime)
            .RequireAuthorization(PortalPolicies.PortalAdministration);

        endpoints.MapGet("/api/system/updates/status", UpdateStatus)
            .RequireAuthorization();
        endpoints.MapPost("/api/system/updates/{action}", UnsupportedUpdateAction)
            .RequireAuthorization(PortalPolicies.PortalAdministration);

        return endpoints;
    }


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

    private static IResult DeviceInventory(AgentStore agents) =>
        Results.Ok(DeviceInventoryValue(agents));

    private static object DeviceInventoryValue(AgentStore agents)
    {
        var snapshot = JsonSerializer.SerializeToElement(
            agents.Snapshot(),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var groups = snapshot.GetProperty("groups").EnumerateArray()
            .Select(group => new
            {
                id = group.GetProperty("id").GetString() ?? string.Empty,
                name = group.GetProperty("name").GetString() ?? string.Empty,
                description = group.GetProperty("description").GetString() ?? string.Empty,
                enabled = group.GetProperty("enabled").GetBoolean(),
                deviceCount = group.GetProperty("deviceCount").GetInt32()
            }).ToArray();
        var nodes = snapshot.GetProperty("devices").EnumerateArray()
            .Select(device => new
            {
                id = device.GetProperty("id").GetString() ?? string.Empty,
                nodeId = device.GetProperty("id").GetString() ?? string.Empty,
                deviceId = device.GetProperty("id").GetString() ?? string.Empty,
                tenantId = device.GetProperty("tenantId").GetString() ?? string.Empty,
                name = device.GetProperty("name").GetString() ?? string.Empty,
                hostname = device.GetProperty("hostName").GetString() ?? string.Empty,
                groupId = device.GetProperty("groupId").GetString() ?? string.Empty,
                conn = device.GetProperty("online").GetBoolean() ? 1 : 0,
                online = device.GetProperty("online").GetBoolean(),
                status = device.GetProperty("status").GetString() ?? string.Empty,
                osdesc = device.GetProperty("platform").GetString() ?? string.Empty,
                os = device.GetProperty("platform").GetString() ?? string.Empty,
                platform = device.GetProperty("platform").GetString() ?? string.Empty,
                ip = device.GetProperty("remoteAddress").GetString() ?? string.Empty,
                remoteAddress = device.GetProperty("remoteAddress").GetString() ?? string.Empty,
                lastSeen = device.TryGetProperty("lastSeenAtUtc", out var lastSeen) &&
                           lastSeen.ValueKind != JsonValueKind.Null
                    ? lastSeen.GetDateTimeOffset().ToUnixTimeMilliseconds()
                    : 0,
                lastSeenAtUtc = device.TryGetProperty("lastSeenAtUtc", out var timestamp) &&
                                timestamp.ValueKind != JsonValueKind.Null
                    ? timestamp.GetDateTimeOffset()
                    : (DateTimeOffset?)null,
                agentVersion = device.GetProperty("agentVersion").GetString() ?? string.Empty
            }).ToArray();
        return new { nodes, groups, generatedAtUtc = DateTimeOffset.UtcNow };
    }

    private static IResult Overview(
        ApprovalStore approvals,
        PortalSettingsStore settings)
    {
        var pending = approvals.List(null, "pending", null, 2000).Count;
        var integrations = new[] { "jira", "security", "monitoring" }
            .Select(key => new
            {
                key,
                configured = settings.Integration(key).ValueKind == JsonValueKind.Object &&
                             settings.Integration(key).EnumerateObject().Any()
            }).ToArray();
        return Results.Ok(new
        {
            ok = true,
            pendingApprovals = pending,
            integrations = new
            {
                status = "ok",
                issues = Array.Empty<string>(),
                values = integrations
            }
        });
    }

    private static IResult LegacyBootstrap(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalSettingsStore settings)
    {
        var identity = ResolveIdentity(context, identities);
        if (identity is null) return Results.Unauthorized();
        var bootstrap = JsonSerializer.SerializeToElement(settings.Bootstrap(identity, identities));
        var tokens = antiforgery.GetAndStoreTokens(context);
        return Results.Ok(new
        {
            ok = true,
            version = bootstrap.GetProperty("version"),
            user = bootstrap.GetProperty("user"),
            portal = bootstrap.GetProperty("portal"),
            modules = bootstrap.GetProperty("modules"),
            csrfToken = tokens.RequestToken ?? string.Empty,
            generatedAtUtc = DateTimeOffset.UtcNow
        });
    }

    private static IResult LegacyAgentGroups(AgentStore agents)
    {
        var snapshot = JsonSerializer.SerializeToElement(
            agents.Snapshot(),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return Results.Ok(new
        {
            ok = true,
            value = snapshot.GetProperty("groups")
        });
    }

    private static async Task<IResult> LegacyAgentGroupCreateAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var request = await context.Request.ReadFromJsonAsync<LegacyAgentGroupMutation>(context.RequestAborted)
                          ?? throw new InvalidDataException("Group request is required.");
            var id = string.IsNullOrWhiteSpace(request.Id)
                ? Slug(request.Name) + "-" + Guid.NewGuid().ToString("N")[..8]
                : request.Id;
            var issue = agents.CreateGroup(id, request.Name, request.Description);
            return Results.Ok(new
            {
                ok = true,
                value = issue.Group,
                enrollmentToken = issue.EnrollmentToken,
                shownOnce = true
            });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_GROUP_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> LegacyAgentGroupDeleteAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var request = await context.Request.ReadFromJsonAsync<LegacyAgentGroupMutation>(context.RequestAborted)
                          ?? throw new InvalidDataException("Group request is required.");
            agents.DeleteGroup(Required(request.Id, "Group ID"));
            return Results.Ok(new { ok = true });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_GROUP_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "AGENT_GROUP_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> LegacyIdentityMutationAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var request = await context.Request.ReadFromJsonAsync<LegacyIdentityMutation>(context.RequestAborted)
                          ?? throw new InvalidDataException("Identity request is required.");
            var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
            object? result = action switch
            {
                "create-user" => identities.CreateUser(
                    request.UserName, request.DisplayName, request.Password, request.Role),
                "update-user" => identities.UpdateUser(
                    Required(request.Id, "User ID"), request.DisplayName, request.Role,
                    request.Enabled, PortalAuthenticationEndpoints.ActorId(context)),
                "delete-user" => DeleteUser(
                    identities, Required(request.Id, "User ID"),
                    PortalAuthenticationEndpoints.ActorId(context)),
                "save-group" => identities.SaveGroup(
                    request.Id, request.Name, request.Description, request.MemberIds),
                "delete-group" => DeleteIdentityGroup(
                    identities, Required(request.Id, "Group ID")),
                _ => throw new InvalidDataException("Identity action is invalid.")
            };
            return Results.Ok(new { ok = true, result, value = identities.Snapshot() });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "IDENTITY_NOT_FOUND", exception.Message);
        }
        catch (UnauthorizedAccessException exception)
        {
            return PortalAuthenticationEndpoints.Error(403, "IDENTITY_ACCESS_DENIED", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "IDENTITY_VALIDATION_FAILED", exception.Message);
        }
    }

    private static IResult LegacySettings(
        PortalIdentityStore identities,
        PortalSettingsStore settings) =>
        Results.Ok(new { ok = true, value = LegacySettingsValue(identities, settings) });

    private static async Task<IResult> LegacySettingsUpdateAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalSettingsStore settings)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var raw = form["payload"].ToString();
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
            var payload = document.RootElement;
            var currentModules = ModuleKeys.ToDictionary(
                key => key,
                key => settings.Module(key),
                StringComparer.Ordinal);
            var modules = new Dictionary<string, PortalModuleSettings>(StringComparer.Ordinal);
            foreach (var key in ModuleKeys)
            {
                var current = currentModules[key];
                var enabled = payload.TryGetProperty("modules", out var enabledMap) &&
                              enabledMap.ValueKind == JsonValueKind.Object &&
                              enabledMap.TryGetProperty(key, out var enabledValue)
                    ? enabledValue.ValueKind == JsonValueKind.True
                    : current.Enabled;
                var options = payload.TryGetProperty("moduleOptions", out var optionMap) &&
                              optionMap.ValueKind == JsonValueKind.Object &&
                              optionMap.TryGetProperty(key, out var optionValue) &&
                              optionValue.ValueKind == JsonValueKind.Object
                    ? optionValue.Clone()
                    : current.Options;
                modules[key] = current with { Enabled = enabled, Options = options };
            }
            var portal = payload.TryGetProperty("portal", out var portalValue) &&
                         portalValue.ValueKind == JsonValueKind.Object
                ? portalValue.Clone()
                : settings.Portal();
            var integrations = ReadObjectMap(payload, "integrations");
            var secrets = ReadStringMap(payload, "secrets");
            settings.Update(
                new PortalSettingsUpdateRequest(portal, modules, integrations, secrets),
                identities);
            return Results.Ok(new { ok = true, value = LegacySettingsValue(identities, settings) });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "SETTINGS_VALIDATION_FAILED", exception.Message);
        }
    }

    private static object LegacySettingsValue(
        PortalIdentityStore identities,
        PortalSettingsStore settings)
    {
        var modules = ModuleKeys.Select(key =>
        {
            var value = settings.Module(key);
            return new
            {
                key,
                name = key,
                enabled = value.Enabled,
                ready = true,
                accessGroupIds = value.AccessGroupIds
            };
        }).ToArray();
        var moduleSettings = ModuleKeys.ToDictionary(
            key => key,
            key => settings.Module(key).Options,
            StringComparer.Ordinal);
        moduleSettings["portal"] = settings.Portal();
        var integrations = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var key in new[] { "jira", "security", "monitoring", "entra", "zabbix" })
            integrations[key] = settings.Integration(key);
        return new
        {
            plugin = new { name = "SIRK Portal", runtime = ".NET 10", version = VersionInfo.Current },
            portal = settings.Portal(),
            modules,
            moduleSettings,
            integrations = new { values = integrations },
            identity = identities.Snapshot(),
            diagnostics = new { logs = string.Empty, errors = string.Empty },
            migration = new { completed = true, runtime = ".NET 10" },
            generatedAt = DateTimeOffset.UtcNow
        };
    }

    private static IResult LegacyRuntime(
        HttpContext context,
        PortalRuntimeState runtime,
        PortalPaths paths)
    {
        var action = context.Request.Query["action"].ToString();
        return Results.Ok(new
        {
            ok = true,
            action,
            service = new
            {
                name = "SirkPortal",
                displayName = "SIRK Portal",
                status = runtime.IsReady ? "Running" : "Starting",
                ready = runtime.IsReady,
                startType = "Automatic",
                processId = Environment.ProcessId,
                startedAtUtc = runtime.StartedAtUtc
            },
            storage = new { paths.DataRoot, writable = Directory.Exists(paths.DataRoot) },
            generatedAtUtc = DateTimeOffset.UtcNow
        });
    }

    private static IResult UpdateStatus() => Results.Ok(new
    {
        ok = true,
        value = new
        {
            current = new
            {
                version = VersionInfo.Current,
                channel = "dev",
                branch = "rewrite/dotnet10-clean"
            },
            remote = new
            {
                availableVersion = VersionInfo.Current,
                updateAvailable = false,
                error = (string?)null
            },
            jobs = new Dictionary<string, object>(),
            backups = Array.Empty<object>(),
            history = Array.Empty<object>()
        }
    });

    private static IResult UnsupportedUpdateAction(string action) =>
        PortalAuthenticationEndpoints.Error(
            501,
            "UPDATE_ACTION_NOT_IMPLEMENTED",
            $"Update action '{action}' is not available in the native test build.");

    private static PortalAuthenticatedIdentity? ResolveIdentity(
        HttpContext context,
        PortalIdentityStore identities)
    {
        var id = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var versionText = context.User.FindFirst("sirk:session_version")?.Value;
        return id is not null && int.TryParse(versionText, out var version)
            ? identities.ResolveSession(id, version)
            : null;
    }

    private static Dictionary<string, JsonElement>? ReadObjectMap(JsonElement payload, string name)
    {
        if (!payload.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object)
            return null;
        return value.EnumerateObject().ToDictionary(
            property => property.Name,
            property => property.Value.Clone(),
            StringComparer.Ordinal);
    }

    private static Dictionary<string, string>? ReadStringMap(JsonElement payload, string name)
    {
        if (!payload.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object)
            return null;
        return value.EnumerateObject().ToDictionary(
            property => property.Name,
            property => property.Value.ValueKind == JsonValueKind.String
                ? property.Value.GetString() ?? string.Empty
                : string.Empty,
            StringComparer.Ordinal);
    }

    private static object? DeleteUser(
        PortalIdentityStore identities,
        string id,
        string actorId)
    {
        identities.DeleteUser(id, actorId);
        return null;
    }

    private static object? DeleteIdentityGroup(PortalIdentityStore identities, string id)
    {
        identities.DeleteGroup(id);
        return null;
    }

    private static string Required(string? value, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length > 0
            ? normalized
            : throw new InvalidDataException(field + " is required.");
    }

    private static string Slug(string? value)
    {
        var normalized = new string((value ?? "group")
            .Trim()
            .ToLowerInvariant()
            .Select(character => char.IsAsciiLetterOrDigit(character) ? character : '-')
            .ToArray());
        normalized = string.Join('-', normalized.Split('-', StringSplitOptions.RemoveEmptyEntries));
        if (normalized.Length < 3) normalized = "group";
        return normalized[..Math.Min(normalized.Length, 96)];
    }
}
