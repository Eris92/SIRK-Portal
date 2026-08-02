using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
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
        InternalTunnelCredential credential)
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

        var actorId = Normalize(context.Request.Headers[ActorIdHeader], 160);
        var actorName = Normalize(context.Request.Headers[ActorNameHeader], 160);
        var role = Normalize(context.Request.Headers[ActorRoleHeader], 64);
        if (string.IsNullOrWhiteSpace(actorId) ||
            string.IsNullOrWhiteSpace(actorName) ||
            !PortalRoles.All.Contains(role, StringComparer.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, actorId),
            new(ClaimTypes.Name, actorName),
            new(ClaimTypes.Role, role),
            new("sirk:user_name", actorName),
            new("sirk:session_version", "0"),
            new("sirk:identity_source", "central"),
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

    private static bool IsLoopback(IPAddress? address) =>
        address is not null && IPAddress.IsLoopback(address);

    private static string Normalize(string? value, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length > maximum || normalized.Any(character => character is '\r' or '\n' or '\0'))
            return string.Empty;
        return normalized;
    }
}
