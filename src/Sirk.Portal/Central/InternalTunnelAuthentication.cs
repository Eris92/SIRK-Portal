using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Sirk.Portal.Security;

namespace Sirk.Portal.Central;

internal sealed class InternalTunnelCredential : IDisposable
{
    private readonly byte[] _secret = RandomNumberGenerator.GetBytes(48);

    public string HeaderValue => Convert.ToBase64String(_secret);

    public bool Verify(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        byte[] supplied;
        try
        {
            supplied = Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            return false;
        }

        try
        {
            return supplied.Length == _secret.Length &&
                   CryptographicOperations.FixedTimeEquals(_secret, supplied);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(supplied);
        }
    }

    public void Dispose() => CryptographicOperations.ZeroMemory(_secret);
}

internal sealed class InternalTunnelAuthenticationMiddleware
{
    private const string CredentialHeader = "X-SIRK-Internal-Tunnel";
    private const string ActorIdHeader = "X-SIRK-Actor-Id";
    private const string ActorNameHeader = "X-SIRK-Actor-Name";
    private const string ActorRoleHeader = "X-SIRK-Actor-Role";

    private readonly RequestDelegate _next;

    public InternalTunnelAuthenticationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(
        HttpContext context,
        InternalTunnelCredential credential,
        PortalIdentityStore identities)
    {
        var supplied = context.Request.Headers[CredentialHeader].ToString();
        if (string.IsNullOrEmpty(supplied))
        {
            await _next(context);
            return;
        }

        if (!IsLoopback(context.Connection.RemoteIpAddress) || !credential.Verify(supplied))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var centralActorId = Normalize(context.Request.Headers[ActorIdHeader], 160);
        var actorName = Normalize(context.Request.Headers[ActorNameHeader], 128);
        var centralRole = Normalize(context.Request.Headers[ActorRoleHeader], 64);
        if (string.IsNullOrWhiteSpace(centralActorId) ||
            string.IsNullOrWhiteSpace(actorName) ||
            string.IsNullOrWhiteSpace(centralRole))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        PortalAuthenticatedIdentity mapped;
        try
        {
            mapped = new PortalCentralIdentityMapper(identities)
                .Resolve(centralActorId, actorName, centralRole);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or UnauthorizedAccessException)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                ok = false,
                code = "CENTRAL_IDENTITY_MAPPING_FAILED",
                error = exception.Message
            });
            return;
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, mapped.Id),
            new(ClaimTypes.Name, mapped.DisplayName),
            new(ClaimTypes.Role, mapped.Role),
            new("sirk:user_name", mapped.UserName),
            new("sirk:session_version", mapped.SessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture)),
            new("sirk:identity_source", "central"),
            new("sirk:central_actor_id", centralActorId),
            new("sirk:central_actor_role", centralRole),
            new("amr", "delegated")
        };
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            claims,
            "Sirk.Central.Tunnel",
            ClaimTypes.Name,
            ClaimTypes.Role));
        context.Items["Sirk.InternalTunnel"] = true;
        await _next(context);
    }

    private static bool IsLoopback(IPAddress? address)
    {
        if (address is null) return false;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        return IPAddress.IsLoopback(address);
    }

    private static string Normalize(string? value, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length > maximum || normalized.Any(character => character is '\r' or '\n' or '\0'))
            return string.Empty;
        return normalized;
    }
}
