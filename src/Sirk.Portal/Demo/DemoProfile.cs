using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Sirk.Portal.Agent;

namespace Sirk.Portal.Demo;

internal static class DemoAuthentication
{
    public const string Scheme = "SIRK-Demo";
}

internal sealed class DemoAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "demo-visitor"),
            new Claim(ClaimTypes.Name, "Demo Visitor"),
            new Claim(ClaimTypes.Role, "Admin"),
            new Claim("sirk:demo", "true")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, DemoAuthentication.Scheme));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, DemoAuthentication.Scheme)));
    }
}

internal sealed class DemoWriteGuardMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (context.User.HasClaim("sirk:demo", "true") &&
            context.Request.Path.StartsWithSegments("/api") &&
            !HttpMethods.IsGet(context.Request.Method) &&
            !HttpMethods.IsHead(context.Request.Method) &&
            !HttpMethods.IsOptions(context.Request.Method))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "about:blank",
                title = "Demo operation disabled",
                status = StatusCodes.Status403Forbidden,
                detail = "This operation is disabled in the isolated SIRK Portal Demo profile.",
                demo = true
            });
            return;
        }
        await next(context);
    }
}

internal static class DemoProfileSeeder
{
    public static void Seed(AgentStore store)
    {
        if (store.GetDevice("demo-win-01") is not null) return;

        var workstations = store.CreateGroup("demo-workstations", "Workstations", "Synthetic user endpoints");
        var servers = store.CreateGroup("demo-servers", "Servers", "Synthetic server estate");
        var linux = store.CreateGroup("demo-linux", "Linux", "Synthetic Linux estate");

        Add(store, workstations.Group.Id, "demo-win-01", "FIN-LT-023", "Windows", true,
            new Dictionary<string, string>
            {
                ["os"] = "Windows 11 Enterprise 24H2", ["department"] = "Finance", ["owner"] = "Anna Demo",
                ["ip"] = "10.20.10.23", ["cpu"] = "Intel Core i7", ["ramGb"] = "16", ["disk"] = "BitLocker",
                ["security"] = "healthy", ["risk"] = "low", ["patch"] = "2026-08"
            });
        Add(store, workstations.Group.Id, "demo-win-02", "ENG-WS-114", "Windows", true,
            new Dictionary<string, string>
            {
                ["os"] = "Windows 11 Enterprise 24H2", ["department"] = "Engineering", ["owner"] = "Piotr Demo",
                ["ip"] = "10.20.20.114", ["cpu"] = "AMD Ryzen 7", ["ramGb"] = "32", ["disk"] = "BitLocker",
                ["security"] = "warning", ["risk"] = "medium", ["patch"] = "2026-07"
            });
        Add(store, servers.Group.Id, "demo-win-srv-01", "DC-DEMO-01", "Windows Server", true,
            new Dictionary<string, string>
            {
                ["os"] = "Windows Server 2022", ["role"] = "Domain Controller", ["ip"] = "10.20.30.10",
                ["cpu"] = "4 vCPU", ["ramGb"] = "16", ["security"] = "healthy", ["risk"] = "low",
                ["patch"] = "2026-08"
            });
        Add(store, linux.Group.Id, "demo-linux-01", "web-demo-01", "Linux", true,
            new Dictionary<string, string>
            {
                ["os"] = "Ubuntu 24.04 LTS", ["role"] = "Web", ["ip"] = "10.20.40.21", ["cpu"] = "2 vCPU",
                ["ramGb"] = "8", ["security"] = "healthy", ["risk"] = "low", ["patch"] = "2026-08"
            });
        Add(store, linux.Group.Id, "demo-linux-02", "db-demo-02", "Linux", false,
            new Dictionary<string, string>
            {
                ["os"] = "Debian 13", ["role"] = "Database", ["ip"] = "10.20.40.32", ["cpu"] = "4 vCPU",
                ["ramGb"] = "16", ["security"] = "offline", ["risk"] = "unknown", ["patch"] = "2026-06"
            });
    }

    private static void Add(
        AgentStore store,
        string groupId,
        string deviceId,
        string hostName,
        string platform,
        bool online,
        IReadOnlyDictionary<string, string> metadata)
    {
        var request = new AgentEnrollmentRequest(
            groupId,
            string.Empty,
            deviceId,
            "demo-tenant",
            hostName,
            hostName,
            platform,
            "0.1.1.1",
            metadata);
        store.Enroll(request, "192.0.2.10", enrollmentTokenPrevalidated: true);
        if (!online) return;
        store.Heartbeat(deviceId,
            new AgentHeartbeatRequest(hostName, hostName, platform, "0.1.1.1", "healthy", metadata),
            "192.0.2.10");
    }
}
