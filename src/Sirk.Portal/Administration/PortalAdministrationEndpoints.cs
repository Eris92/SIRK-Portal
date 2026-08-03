using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Extensions.Options;
using Sirk.Portal.Agent;
using Sirk.Portal.Central;
using Sirk.Portal.Security;
using Sirk.Portal.Settings;
using Sirk.Portal.Workflows;

namespace Sirk.Portal.Administration;

internal sealed record CentralConnectionAdminRequest(
    int? SchemaVersion,
    string? CentralUrl,
    string? TunnelUrl,
    string? PortalId,
    string? PortalName,
    string? PortalToken,
    string? PublicUrl);

internal sealed record ComputerGroupAdminRequest(
    string? Id,
    string? Name,
    string? Description,
    bool? Enabled);

internal static class PortalAdministrationEndpoints
{
    public static IEndpointRouteBuilder MapPortalAdministration(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/system/info", SystemInfo)
            .AllowAnonymous();

        var admin = endpoints
            .MapGroup("/api/v1/admin")
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        admin.MapGet("/settings", GetSettings);
        admin.MapPut("/settings", UpdateSettingsAsync);
        admin.MapGet("/runtime", Runtime);
        admin.MapGet("/central", GetCentral);
        admin.MapPut("/central", SaveCentralAsync);
        admin.MapDelete("/central", RemoveCentralAsync);
        admin.MapGet("/computer-groups", GetComputerGroups);
        admin.MapPost("/computer-groups", CreateComputerGroupAsync);
        admin.MapPut("/computer-groups/{groupId}", UpdateComputerGroupAsync);
        admin.MapDelete("/computer-groups/{groupId}", DeleteComputerGroupAsync);
        admin.MapPost("/computer-groups/{groupId}/rotate-token", RotateComputerGroupTokenAsync);
        admin.MapPost("/maintenance/purge", PurgeAsync);

        endpoints.MapGet("/api/v1/audit", Audit)
            .RequireAuthorization(PortalPolicies.AuditRead);

        return endpoints;
    }

    private static IResult SystemInfo(
        PortalRuntimeState runtime,
        CentralConnectionState central,
        PortalIdentityStore identities,
        AgentStore agents) =>
        Results.Ok(new
        {
            ok = true,
            product = "SIRK Portal",
            runtime = ".NET 10",
            framework = AppContext.TargetFrameworkName,
            version = VersionInfo.Current,
            ready = runtime.IsReady,
            startedAtUtc = runtime.StartedAtUtc,
            initialized = identities.IsInitialized,
            central = central.Snapshot(),
            agents = agents.Snapshot(),
            capabilities = new[]
            {
                "identity-rbac",
                "signed-agent-channel",
                "agent-enrollment",
                "agent-policy",
                "agent-command-ack",
                "desktop-websocket-relay",
                "approval-workflows",
                "automation",
                "central-heartbeat",
                "central-tunnel"
            }
        });

    private static IResult GetSettings(
        PortalIdentityStore identities,
        PortalSettingsStore settings) =>
        Results.Ok(new
        {
            ok = true,
            value = settings.AdminSnapshot(identities)
        });

    private static async Task<IResult> UpdateSettingsAsync(
        PortalSettingsUpdateRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalSettingsStore settings,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var value = settings.Update(request, identities);
            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "portal.settings.update",
                "settings",
                "portal",
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier));
            return Results.Ok(new { ok = true, value });
        }
        catch (InvalidDataException exception)
        {
            return PortalAuthenticationEndpoints.Error(
                400,
                "SETTINGS_VALIDATION_FAILED",
                exception.Message);
        }
    }

    private static IResult Runtime(
        PortalRuntimeState runtime,
        CentralConnectionState central,
        PortalPaths paths) =>
        Results.Ok(new
        {
            ok = true,
            service = new
            {
                name = "SIRK Portal",
                ready = runtime.IsReady,
                runtime.StartedAtUtc,
                processId = Environment.ProcessId,
                workingSetBytes = Environment.WorkingSet,
                gcMemoryBytes = GC.GetTotalMemory(forceFullCollection: false),
                framework = AppContext.TargetFrameworkName,
                version = VersionInfo.Current
            },
            storage = new
            {
                paths.DataRoot,
                paths.FilesDirectory,
                paths.CommandsDirectory,
                paths.ManagementDirectory,
                writable = Directory.Exists(paths.DataRoot)
            },
            central = central.Snapshot(),
            generatedAtUtc = DateTimeOffset.UtcNow
        });

    private static IResult GetCentral(
        CentralConnectionState state,
        IOptions<CentralConnectionOptions> options)
    {
        var path = CentralConnectionResolver.ResolveConnectionFilePath(options.Value.ConnectionFile);
        RedactedCentralConnection? configuration = null;
        string? error = null;
        if (File.Exists(path))
        {
            try
            {
                configuration = CentralConnectionResolver.Redact(
                    CentralConnectionResolver.ReadProtectedDocument(path));
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException or InvalidDataException or JsonException)
            {
                error = exception.Message;
            }
        }

        return Results.Ok(new
        {
            ok = true,
            value = new
            {
                configured = configuration is not null,
                state = state.Snapshot(),
                configuration,
                path,
                error,
                restartRequired = false
            }
        });
    }

    private static async Task<IResult> SaveCentralAsync(
        CentralConnectionAdminRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        IOptions<CentralConnectionOptions> options,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var document = new CentralConnectionFileDocument(
                request.SchemaVersion ?? 1,
                Required(request.CentralUrl, "Central URL"),
                Required(request.TunnelUrl, "Tunnel URL"),
                Required(request.PortalId, "Portal ID"),
                Required(request.PortalName, "Portal name"),
                Required(request.PortalToken, "Portal token"),
                (request.PublicUrl ?? string.Empty).Trim(),
                DateTimeOffset.UtcNow);
            var saved = CentralConnectionResolver.SaveProtectedDocument(
                document,
                options.Value.ConnectionFile);
            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "central.connection.save",
                "central",
                saved.PortalId,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier));
            return Results.Ok(new
            {
                ok = true,
                value = new
                {
                    configured = true,
                    configuration = CentralConnectionResolver.Redact(saved),
                    path = CentralConnectionResolver.ResolveConnectionFilePath(options.Value.ConnectionFile),
                    restartRequired = true
                }
            });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return PortalAuthenticationEndpoints.Error(
                400,
                "CENTRAL_CONFIGURATION_INVALID",
                exception.Message);
        }
    }

    private static async Task<IResult> RemoveCentralAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        IOptions<CentralConnectionOptions> options,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var path = CentralConnectionResolver.ResolveConnectionFilePath(options.Value.ConnectionFile);
            var removed = CentralConnectionResolver.RemoveProtectedDocument(path);
            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "central.connection.remove",
                "central",
                "portal",
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier));
            return Results.Ok(new
            {
                ok = true,
                value = new
                {
                    configured = false,
                    removed,
                    path,
                    restartRequired = removed
                }
            });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            return PortalAuthenticationEndpoints.Error(
                400,
                "CENTRAL_CONFIGURATION_REMOVE_FAILED",
                exception.Message);
        }
    }

    private static IResult GetComputerGroups(AgentStore agents) =>
        Results.Ok(new { ok = true, value = agents.Snapshot() });

    private static async Task<IResult> CreateComputerGroupAsync(
        ComputerGroupAdminRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var issue = agents.CreateGroup(request.Id, request.Name, request.Description);
            WriteGroupAudit(audit, context, "computer-group.create", issue.Group.Id);
            return Results.Ok(new
            {
                ok = true,
                value = agents.Snapshot(),
                enrollmentToken = issue.EnrollmentToken,
                groupId = issue.Group.Id,
                shownOnce = true
            });
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "COMPUTER_GROUP_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> UpdateComputerGroupAsync(
        string groupId,
        ComputerGroupAdminRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var group = agents.UpdateGroup(groupId, request.Name, request.Description, request.Enabled);
            WriteGroupAudit(audit, context, "computer-group.update", group.Id);
            return Results.Ok(new { ok = true, value = agents.Snapshot(), group });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "COMPUTER_GROUP_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException)
        {
            return PortalAuthenticationEndpoints.Error(400, "COMPUTER_GROUP_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> RotateComputerGroupTokenAsync(
        string groupId,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            var issue = agents.RotateGroupToken(groupId);
            WriteGroupAudit(audit, context, "computer-group.rotate-token", issue.Group.Id);
            return Results.Ok(new
            {
                ok = true,
                value = agents.Snapshot(),
                enrollmentToken = issue.EnrollmentToken,
                groupId = issue.Group.Id,
                shownOnce = true
            });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "COMPUTER_GROUP_NOT_FOUND", exception.Message);
        }
    }

    private static async Task<IResult> DeleteComputerGroupAsync(
        string groupId,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        try
        {
            agents.DeleteGroup(groupId);
            WriteGroupAudit(audit, context, "computer-group.delete", groupId);
            return Results.Ok(new { ok = true, value = agents.Snapshot() });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "COMPUTER_GROUP_NOT_FOUND", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return PortalAuthenticationEndpoints.Error(409, "COMPUTER_GROUP_NOT_EMPTY", exception.Message);
        }
    }

    private static void WriteGroupAudit(
        PortalAuditLog audit,
        HttpContext context,
        string action,
        string groupId) =>
        audit.Write(new PortalAuditEvent(
            PortalAuthenticationEndpoints.ActorId(context),
            PortalAuthenticationEndpoints.ActorName(context),
            action,
            "computer-group",
            groupId,
            true,
            PortalAuthenticationEndpoints.RemoteAddress(context),
            context.TraceIdentifier));

    private static string Required(string? value, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length > 0
            ? normalized
            : throw new InvalidDataException(field + " is required.");
    }

    private static async Task<IResult> PurgeAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        ApprovalStore approvals,
        PortalSettingsStore settings,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;
        var retention = 365;
        var module = settings.Module("approvals");
        if (module.Options.ValueKind == System.Text.Json.JsonValueKind.Object &&
            module.Options.TryGetProperty("retentionDays", out var value) &&
            value.TryGetInt32(out var configured))
        {
            retention = Math.Clamp(configured, 1, 3650);
        }
        approvals.PurgeOlderThan(DateTimeOffset.UtcNow.AddDays(-retention));
        audit.Write(new PortalAuditEvent(
            PortalAuthenticationEndpoints.ActorId(context),
            PortalAuthenticationEndpoints.ActorName(context),
            "portal.maintenance.purge",
            "storage",
            "approvals",
            true,
            PortalAuthenticationEndpoints.RemoteAddress(context),
            context.TraceIdentifier,
            new Dictionary<string, string> { ["retentionDays"] = retention.ToString(System.Globalization.CultureInfo.InvariantCulture) }));
        return Results.Ok(new { ok = true, retentionDays = retention });
    }

    private static IResult Audit(
        HttpContext context,
        PortalAuditLog audit)
    {
        var limit = int.TryParse(context.Request.Query["limit"], out var value)
            ? Math.Clamp(value, 1, 1000)
            : 200;
        return Results.Ok(new
        {
            ok = true,
            entries = audit.Read(limit)
        });
    }
}
