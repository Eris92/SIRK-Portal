using Microsoft.AspNetCore.Antiforgery;

namespace Sirk.Portal.Security;

internal sealed record PortalIdentityMutation(
    string Action,
    string? Id,
    string? UserName,
    string? DisplayName,
    string? Password,
    string? Role,
    bool? Enabled,
    string? Name,
    string? Description,
    IReadOnlyList<string>? MemberIds);

internal static class PortalIdentityEndpoints
{
    public static IEndpointRouteBuilder MapPortalIdentity(
        this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/api/v1/admin/identity")
            .RequireAuthorization(PortalPolicies.PortalAdministration);

        group.MapGet("/", (PortalIdentityStore identities) =>
            Results.Ok(new { ok = true, value = identities.Snapshot() }));
        group.MapPost("/", MutateAsync);

        return endpoints;
    }

    private static async Task<IResult> MutateAsync(
        PortalIdentityMutation request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalAuditLog audit)
    {
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;

        var action = (request.Action ?? string.Empty).Trim().ToLowerInvariant();
        try
        {
            object? result = action switch
            {
                "create-user" => identities.CreateUser(
                    request.UserName,
                    request.DisplayName,
                    request.Password,
                    request.Role),
                "update-user" => identities.UpdateUser(
                    RequiredId(request.Id),
                    request.DisplayName,
                    request.Role,
                    request.Enabled,
                    PortalAuthenticationEndpoints.ActorId(context)),
                "delete-user" => DeleteUser(
                    identities,
                    RequiredId(request.Id),
                    PortalAuthenticationEndpoints.ActorId(context)),
                "save-group" => identities.SaveGroup(
                    request.Id,
                    request.Name,
                    request.Description,
                    request.MemberIds),
                "delete-group" => DeleteGroup(identities, RequiredId(request.Id)),
                _ => throw new InvalidDataException("Identity action is invalid.")
            };

            audit.Write(new PortalAuditEvent(
                PortalAuthenticationEndpoints.ActorId(context),
                PortalAuthenticationEndpoints.ActorName(context),
                "identity." + action,
                action.EndsWith("group", StringComparison.Ordinal) ? "group" : "user",
                request.Id ?? request.UserName ?? string.Empty,
                true,
                PortalAuthenticationEndpoints.RemoteAddress(context),
                context.TraceIdentifier));

            return Results.Ok(new
            {
                ok = true,
                result,
                value = identities.Snapshot()
            });
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

    private static object? DeleteUser(
        PortalIdentityStore identities,
        string userId,
        string actorId)
    {
        identities.DeleteUser(userId, actorId);
        return null;
    }

    private static object? DeleteGroup(
        PortalIdentityStore identities,
        string groupId)
    {
        identities.DeleteGroup(groupId);
        return null;
    }

    private static string RequiredId(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length > 0
            ? normalized
            : throw new InvalidDataException("Identity ID is required.");
    }
}
