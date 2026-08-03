#!/usr/bin/env python3
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


central_file = "src/Sirk.Portal/Central/CentralConnectionFile.cs"
central_marker = "    internal static bool RemoveProtectedDocument(string path)\n"
central_insertion = """    internal static CentralConnectionFileDocument SaveProtectedDocument(
        CentralConnectionFileDocument document,
        string? destinationPath)
    {
        ArgumentNullException.ThrowIfNull(document);
        ValidateDocument(document);
        ValidateTunnelOrigin(document.CentralUrl, document.TunnelUrl);
        var normalized = document with { UpdatedAtUtc = DateTimeOffset.UtcNow };
        var destination = ResolveConnectionFilePath(destinationPath);
        AtomicJsonFile.Write(destination, normalized);
        SecureFile(destination);
        return ReadProtectedDocument(destination);
    }

"""
replace_once(central_file, central_marker, central_insertion + central_marker)

admin_file = "src/Sirk.Portal/Administration/PortalAdministrationEndpoints.cs"
replace_once(
    admin_file,
    "using Microsoft.AspNetCore.Antiforgery;\n",
    "using System.Text.Json;\nusing Microsoft.AspNetCore.Antiforgery;\nusing Microsoft.Extensions.Options;\n",
)
replace_once(
    admin_file,
    "namespace Sirk.Portal.Administration;\n\ninternal static class PortalAdministrationEndpoints\n",
    """namespace Sirk.Portal.Administration;

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
""",
)
replace_once(
    admin_file,
    "        admin.MapGet(\"/runtime\", Runtime);\n        admin.MapPost(\"/maintenance/purge\", PurgeAsync);\n",
    """        admin.MapGet("/runtime", Runtime);
        admin.MapGet("/central", GetCentral);
        admin.MapPut("/central", SaveCentralAsync);
        admin.MapDelete("/central", RemoveCentralAsync);
        admin.MapGet("/computer-groups", GetComputerGroups);
        admin.MapPost("/computer-groups", CreateComputerGroupAsync);
        admin.MapPut("/computer-groups/{groupId}", UpdateComputerGroupAsync);
        admin.MapDelete("/computer-groups/{groupId}", DeleteComputerGroupAsync);
        admin.MapPost("/computer-groups/{groupId}/rotate-token", RotateComputerGroupTokenAsync);
        admin.MapPost("/maintenance/purge", PurgeAsync);
""",
)

methods_marker = "    private static async Task<IResult> PurgeAsync(\n"
methods = r'''    private static IResult GetCentral(
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

'''
replace_once(admin_file, methods_marker, methods + methods_marker)
