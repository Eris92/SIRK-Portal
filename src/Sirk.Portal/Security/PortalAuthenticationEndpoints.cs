using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Sirk.Portal.Security;

internal sealed record PortalLoginRequest(
    string UserName,
    string Password,
    string? AccessCode);

internal sealed record PortalPasswordChangeRequest(
    string CurrentPassword,
    string NewPassword);

internal sealed record PortalAccessRotateRequest(string CurrentPassword);

internal static class PortalAuthenticationEndpoints
{
    private static readonly JsonSerializerOptions IdentityJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public static IEndpointRouteBuilder MapPortalAuthentication(
        this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/api/v1/auth");

        auth.MapGet("/local-access", ValidateLocalAccessAsync)
            .AllowAnonymous()
            .RequireRateLimiting(PortalEndpointNames.LoginRateLimit);
        auth.MapPost("/login", LoginAsync)
            .AllowAnonymous()
            .DisableAntiforgery()
            .RequireRateLimiting(PortalEndpointNames.LoginRateLimit);
        auth.MapGet("/session", Session)
            .RequireAuthorization();
        auth.MapGet("/csrf", IssueCsrfToken)
            .RequireAuthorization();
        auth.MapPost("/logout", LogoutAsync)
            .RequireAuthorization();
        auth.MapPost("/password", ChangePasswordAsync)
            .RequireAuthorization();
        auth.MapPost("/break-glass/access-code/rotate", RotateAccessCodeAsync)
            .RequireAuthorization(policy => policy.RequireRole(PortalRoles.BreakGlass));

        endpoints.MapGet("/api/v1/setup/status", (PortalIdentityStore identities) =>
            Results.Ok(new
            {
                initialized = identities.IsInitialized,
                authentication = "cookie",
                apiVersion = "v1"
            })).AllowAnonymous();

        return endpoints;
    }

    private static async Task<IResult> ValidateLocalAccessAsync(
        HttpContext context,
        PortalPaths paths)
    {
        NoStore(context);
        var accessCode = BearerCredential(context);
        if (!await VerifyLocalAccessCodeAsync(
                paths.IdentityFile,
                accessCode,
                context.RequestAborted))
        {
            await ApplyFailureDelayAsync(context.RequestAborted);
            return Error(404, "NOT_FOUND", "Not found.");
        }

        return Results.Ok(new { ok = true });
    }

    private static async Task<IResult> LoginAsync(
        PortalLoginRequest request,
        HttpContext context,
        PortalIdentityStore identities,
        PortalPaths paths,
        PortalAuditLog audit,
        IOptions<PortalSecurityOptions> options)
    {
        NoStore(context);
        if (!options.Value.Enabled)
            return Error(503, "SECURITY_DISABLED", "Portal security is disabled by configuration.");
        if (!identities.IsInitialized)
            return Error(503, "PORTAL_NOT_INITIALIZED", "Portal identity is not initialized.");

        var accessCode = BearerCredential(context);
        if (!await VerifyLocalAccessCodeAsync(
                paths.IdentityFile,
                accessCode,
                context.RequestAborted))
        {
            await ApplyFailureDelayAsync(context.RequestAborted);
            return Error(404, "NOT_FOUND", "Not found.");
        }

        var identity = identities.Authenticate(
            request.UserName,
            request.Password,
            accessCode);
        if (identity is null)
        {
            audit.Write(new PortalAuditEvent(
                "anonymous",
                NormalizeAuditName(request.UserName),
                "authentication.login",
                "session",
                string.Empty,
                false,
                RemoteAddress(context),
                context.TraceIdentifier,
                new Dictionary<string, string> { ["reason"] = "invalid-credentials" }));
            await ApplyFailureDelayAsync(context.RequestAborted);
            return Error(401, "AUTHENTICATION_FAILED", "Authentication failed.");
        }

        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(
            Math.Clamp(options.Value.SessionMinutes, 5, 720));
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, identity.Id),
            new(ClaimTypes.Name, identity.DisplayName),
            new(ClaimTypes.Role, identity.Role),
            new("sirk:user_name", identity.UserName),
            new("sirk:session_version", identity.SessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            new("sirk:identity_source", "local"),
            new("sirk:expires_at_utc", expiresAt.ToString("O")),
            new("amr", "pwd")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            claims,
            PortalAuthenticationSchemes.Session,
            ClaimTypes.Name,
            ClaimTypes.Role));
        await context.SignInAsync(
            PortalAuthenticationSchemes.Session,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = false,
                AllowRefresh = false,
                ExpiresUtc = expiresAt
            });

        audit.Write(new PortalAuditEvent(
            identity.Id,
            identity.UserName,
            "authentication.login",
            "session",
            identity.Id,
            true,
            RemoteAddress(context),
            context.TraceIdentifier,
            new Dictionary<string, string>
            {
                ["role"] = identity.Role,
                ["expiresAtUtc"] = expiresAt.ToString("O")
            }));

        return Results.Ok(new
        {
            ok = true,
            authenticated = true,
            user = ToUser(identity),
            expiresAtUtc = expiresAt
        });
    }

    private static IResult Session(HttpContext context)
    {
        NoStore(context);
        var role = context.User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;
        var expiresAt = DateTimeOffset.TryParse(
            context.User.FindFirstValue("sirk:expires_at_utc"),
            out var parsed)
            ? parsed
            : (DateTimeOffset?)null;
        return Results.Ok(new
        {
            authenticated = context.User.Identity?.IsAuthenticated == true,
            user = new
            {
                id = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty,
                userName = context.User.FindFirstValue("sirk:user_name") ?? string.Empty,
                displayName = context.User.Identity?.Name ?? string.Empty,
                role,
                permissions = PortalPermissions.ForRole(role),
                source = context.User.FindFirstValue("sirk:identity_source") ?? string.Empty
            },
            expiresAtUtc = expiresAt
        });
    }

    private static IResult IssueCsrfToken(
        HttpContext context,
        IAntiforgery antiforgery)
    {
        NoStore(context);
        var tokens = antiforgery.GetAndStoreTokens(context);
        if (string.IsNullOrWhiteSpace(tokens.RequestToken))
            return Error(503, "CSRF_UNAVAILABLE", "CSRF token could not be issued.");
        return Results.Ok(new
        {
            headerName = tokens.HeaderName,
            requestToken = tokens.RequestToken
        });
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PortalAuditLog audit)
    {
        var validation = await ValidateCsrfAsync(context, antiforgery);
        if (validation is not null) return validation;

        audit.Write(new PortalAuditEvent(
            ActorId(context),
            ActorName(context),
            "authentication.logout",
            "session",
            ActorId(context),
            true,
            RemoteAddress(context),
            context.TraceIdentifier));
        await context.SignOutAsync(PortalAuthenticationSchemes.Session);
        return Results.Ok(new { ok = true });
    }

    private static async Task<IResult> ChangePasswordAsync(
        PortalPasswordChangeRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalAuditLog audit)
    {
        var validation = await ValidateCsrfAsync(context, antiforgery);
        if (validation is not null) return validation;

        try
        {
            identities.ChangePassword(
                ActorId(context),
                request.CurrentPassword,
                request.NewPassword);
            audit.Write(new PortalAuditEvent(
                ActorId(context),
                ActorName(context),
                "identity.password.change",
                "user",
                ActorId(context),
                true,
                RemoteAddress(context),
                context.TraceIdentifier));
            await context.SignOutAsync(PortalAuthenticationSchemes.Session);
            return Results.Ok(new { ok = true, reauthenticationRequired = true });
        }
        catch (UnauthorizedAccessException exception)
        {
            return Error(401, "CURRENT_PASSWORD_INVALID", exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return Error(400, "VALIDATION_FAILED", exception.Message);
        }
    }

    private static async Task<IResult> RotateAccessCodeAsync(
        PortalAccessRotateRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalAuditLog audit)
    {
        var validation = await ValidateCsrfAsync(context, antiforgery);
        if (validation is not null) return validation;

        try
        {
            var accessCode = identities.RotateAccessCode(
                ActorId(context),
                request.CurrentPassword);
            audit.Write(new PortalAuditEvent(
                ActorId(context),
                ActorName(context),
                "identity.break-glass.access-code.rotate",
                "user",
                ActorId(context),
                true,
                RemoteAddress(context),
                context.TraceIdentifier));
            return Results.Ok(new
            {
                ok = true,
                accessCode,
                shownOnce = true
            });
        }
        catch (UnauthorizedAccessException exception)
        {
            return Error(401, "CURRENT_PASSWORD_INVALID", exception.Message);
        }
    }

    internal static async Task<IResult?> ValidateCsrfAsync(
        HttpContext context,
        IAntiforgery antiforgery)
    {
        try
        {
            await antiforgery.ValidateRequestAsync(context);
            return null;
        }
        catch (AntiforgeryValidationException)
        {
            return Error(400, "CSRF_VALIDATION_FAILED", "CSRF validation failed.");
        }
    }

    internal static string ActorId(HttpContext context) =>
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";

    internal static string ActorName(HttpContext context) =>
        context.User.FindFirstValue("sirk:user_name")
        ?? context.User.Identity?.Name
        ?? "unknown";

    internal static string RemoteAddress(HttpContext context)
    {
        var value = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return value[..Math.Min(value.Length, 128)];
    }

    internal static IResult Error(int status, string code, string message) =>
        Results.Json(
            new { ok = false, code, error = message },
            statusCode: status);

    private static object ToUser(PortalAuthenticatedIdentity identity) =>
        new
        {
            id = identity.Id,
            userName = identity.UserName,
            displayName = identity.DisplayName,
            role = identity.Role,
            permissions = PortalPermissions.ForRole(identity.Role),
            source = "local"
        };

    private static void NoStore(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }

    private static string BearerCredential(HttpContext context)
    {
        const string prefix = "Bearer ";
        var authorization = context.Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return string.Empty;

        var value = authorization[prefix.Length..].Trim();
        return value.Length is >= 32 and <= 256 &&
               value.All(character =>
                   char.IsAsciiLetterOrDigit(character) || character is '-' or '_')
            ? value
            : string.Empty;
    }

    private static async Task<bool> VerifyLocalAccessCodeAsync(
        string identityFile,
        string accessCode,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(accessCode) || !File.Exists(identityFile))
            return false;

        byte[]? expected = null;
        byte[]? actual = null;
        try
        {
            var json = await File.ReadAllTextAsync(
                identityFile,
                Encoding.UTF8,
                cancellationToken);
            var document = JsonSerializer.Deserialize<PortalIdentityDocument>(
                json,
                IdentityJsonOptions);
            if (document is null || string.IsNullOrWhiteSpace(document.AccessCodeHashBase64))
                return false;

            expected = Convert.FromBase64String(document.AccessCodeHashBase64);
            actual = SHA256.HashData(Encoding.UTF8.GetBytes(accessCode));
            return expected.Length == actual.Length &&
                   CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch (Exception exception) when (
            exception is IOException or
            UnauthorizedAccessException or
            JsonException or
            FormatException)
        {
            return false;
        }
        finally
        {
            if (actual is not null) CryptographicOperations.ZeroMemory(actual);
            if (expected is not null) CryptographicOperations.ZeroMemory(expected);
        }
    }

    private static string NormalizeAuditName(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return normalized.Length is > 0 and <= 64 &&
               normalized.All(character =>
                   char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-')
            ? normalized
            : "unknown";
    }

    private static async Task ApplyFailureDelayAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(Random.Shared.Next(175, 376), cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }
}
