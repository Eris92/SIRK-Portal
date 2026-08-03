using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Security;

namespace Sirk.Portal.Agent;

internal sealed record AgentInstallerRequest(
    int? ValidMinutes,
    string? Channel);

internal static class AgentInstallerEndpoints
{
    public static IEndpointRouteBuilder MapAgentInstallerPackages(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
                "/api/v1/admin/agent-groups/{groupId}/installer",
                GenerateAsync)
            .RequireAuthorization(PortalPolicies.PortalAdministration);
        return endpoints;
    }

    private static async Task<IResult> GenerateAsync(
        string groupId,
        AgentInstallerRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        AgentInstallerTicketStore tickets,
        PortalAuditLog audit,
        CancellationToken cancellationToken)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(
            context,
            antiforgery);
        if (csrf is not null) return csrf;

        var validMinutes = Math.Clamp(
            request.ValidMinutes ?? 24 * 60,
            5,
            7 * 24 * 60);
        var channel = (request.Channel ?? "stable").Trim().ToLowerInvariant();
        if (channel is not ("stable" or "dev"))
        {
            return PortalAuthenticationEndpoints.Error(
                400,
                "AGENT_INSTALLER_CHANNEL_INVALID",
                "Agent installer channel must be stable or dev.");
        }

        AgentInstallerTicketIssue issue;
        try
        {
            issue = tickets.Issue(
                groupId,
                TimeSpan.FromMinutes(validMinutes));
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(
                404,
                "AGENT_GROUP_NOT_FOUND",
                exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return PortalAuthenticationEndpoints.Error(
                400,
                "AGENT_INSTALLER_REQUEST_INVALID",
                exception.Message);
        }

        try
        {
            var origin = $"{context.Request.Scheme}://{context.Request.Host.Value}";
            var package = await AgentInstallerPackageBuilder.BuildAsync(
                origin,
                issue.GroupId,
                issue.EnrollmentTicket,
                channel,
                cancellationToken);

            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "agent-group.generate-installer",
                "agent-group",
                issue.GroupId,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string>
                {
                    ["ticketId"] = issue.Id,
                    ["expiresAtUtc"] = issue.ExpiresAtUtc.ToString("O"),
                    ["channel"] = channel,
                    ["singleUse"] = "true"
                }));

            context.Response.Headers.CacheControl = "no-store, max-age=0";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers["X-SIRK-Installer-Expires-At"] =
                issue.ExpiresAtUtc.ToString("O");
            context.Response.Headers["X-SIRK-Enrollment-Mode"] = "single-use";
            return Results.File(
                package.Content,
                "application/vnd.microsoft.portable-executable",
                package.FileName,
                enableRangeProcessing: false);
        }
        catch (Exception exception) when (
            exception is PlatformNotSupportedException or
            FileNotFoundException or
            InvalidDataException or
            InvalidOperationException or
            IOException)
        {
            tickets.Revoke(issue.Id);
            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "agent-group.generate-installer",
                "agent-group",
                issue.GroupId,
                false,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string>
                {
                    ["ticketId"] = issue.Id,
                    ["reason"] = exception.GetType().Name
                }));
            return PortalAuthenticationEndpoints.Error(
                StatusCodes.Status503ServiceUnavailable,
                "AGENT_INSTALLER_GENERATION_FAILED",
                exception.Message);
        }
    }
}
