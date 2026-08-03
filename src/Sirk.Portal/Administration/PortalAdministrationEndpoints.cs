using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Agent;
using Sirk.Portal.Central;
using Sirk.Portal.Security;
using Sirk.Portal.Settings;
using Sirk.Portal.Workflows;

namespace Sirk.Portal.Administration;

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
