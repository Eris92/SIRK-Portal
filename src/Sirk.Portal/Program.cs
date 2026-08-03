using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Sirk.Portal;
using Sirk.Portal.Administration;
using Sirk.Portal.Agent;
using Sirk.Portal.Automation;
using Sirk.Portal.Central;
using Sirk.Portal.Maintenance;
using Sirk.Portal.Modules;
using Sirk.Portal.Security;
using Sirk.Portal.Settings;
using Sirk.Portal.Ui;
using Sirk.Portal.Workflows;

if (RuntimeHealthProbe.IsRequested(args))
{
    Environment.ExitCode = await RuntimeHealthProbe.RunAsync(args);
    return;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = "public"
});

builder.Host.UseWindowsService(options => options.ServiceName = "SIRK Portal");
builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 8 * 1024 * 1024;
});

var portalPaths = new PortalPaths(builder.Configuration);
var securityOptions = builder.Configuration
    .GetSection(PortalSecurityOptions.SectionName)
    .Get<PortalSecurityOptions>() ?? new PortalSecurityOptions();
var secureCookies = !builder.Environment.IsDevelopment();

builder.Services.AddProblemDetails();
builder.Services.AddSingleton(portalPaths);
builder.Services.Configure<PortalSecurityOptions>(
    builder.Configuration.GetSection(PortalSecurityOptions.SectionName));
builder.Services.AddDataProtection()
    .SetApplicationName("SIRK.Portal")
    .PersistKeysToFileSystem(new DirectoryInfo(portalPaths.DataProtectionDirectory));

builder.Services.AddSingleton<PortalRuntimeState>();
builder.Services.AddSingleton<PortalIdentityStore>();
builder.Services.AddSingleton<PortalAuditLog>();
builder.Services.AddSingleton<PortalSettingsStore>();
builder.Services.AddSingleton<PortalMaintenanceStore>();
builder.Services.AddSingleton<AgentStore>();
builder.Services.AddSingleton<AgentInstallerTicketStore>();
builder.Services.AddSingleton<AgentRequestAuthenticator>();
builder.Services.AddSingleton<AgentCommandStore>();
builder.Services.AddSingleton<AgentPolicyStore>();
builder.Services.AddSingleton<DesktopRelayHub>();
builder.Services.AddSingleton<ScriptStore>();
builder.Services.AddSingleton<ApprovalStore>();
builder.Services.AddSingleton<WorkflowExecutionService>();

builder.Services.AddSingleton<CentralConnectionState>();
builder.Services.AddSingleton<CentralConnectionResolver>();
builder.Services.AddSingleton<InternalTunnelCredential>();
builder.Services.Configure<CentralConnectionOptions>(
    builder.Configuration.GetSection(CentralConnectionOptions.SectionName));
builder.Services.Configure<CentralTunnelOptions>(
    builder.Configuration.GetSection(CentralTunnelOptions.SectionName));
builder.Services.AddHttpClient("SirkCentral")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.GZip |
                                 DecompressionMethods.Deflate |
                                 DecompressionMethods.Brotli,
        UseCookies = false
    });

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = PortalAuthenticationSchemes.Session;
    options.DefaultChallengeScheme = PortalAuthenticationSchemes.Session;
    options.DefaultForbidScheme = PortalAuthenticationSchemes.Session;
    options.DefaultSignInScheme = PortalAuthenticationSchemes.Session;
    options.DefaultSignOutScheme = PortalAuthenticationSchemes.Session;
}).AddCookie(PortalAuthenticationSchemes.Session, options =>
{
    options.Cookie.Name = secureCookies
        ? "__Host-SIRK-Portal-Session"
        : "SIRK-Portal-Session-Development";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.Path = "/";
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = secureCookies
        ? CookieSecurePolicy.Always
        : CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromMinutes(
        Math.Clamp(securityOptions.SessionMinutes, 5, 720));
    options.SlidingExpiration = false;
    options.Events = new CookieAuthenticationEvents
    {
        OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = context.Request.Path.Equals("/api/bootstrap")
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        },
        OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        },
        OnValidatePrincipal = async context =>
        {
            var userId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var role = context.Principal?.FindFirstValue(ClaimTypes.Role);
            var versionText = context.Principal?.FindFirstValue("sirk:session_version");
            var current = userId is not null && int.TryParse(versionText, out var version)
                ? context.HttpContext.RequestServices
                    .GetRequiredService<PortalIdentityStore>()
                    .ResolveSession(userId, version)
                : null;
            if (current is null || !string.Equals(current.Role, role, StringComparison.Ordinal))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(PortalAuthenticationSchemes.Session);
            }
        }
    };
});

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(
        PortalPolicies.PortalAdministration,
        policy => policy.RequireAuthenticatedUser()
            .RequireRole(PortalRoles.BreakGlass, PortalRoles.SecAdmin, PortalRoles.Admin))
    .AddPolicy(
        PortalPolicies.SecurityAdministration,
        policy => policy.RequireAuthenticatedUser()
            .RequireRole(PortalRoles.BreakGlass, PortalRoles.SecAdmin))
    .AddPolicy(
        PortalPolicies.DeviceRead,
        policy => policy.RequireAuthenticatedUser()
            .RequireRole(PortalRoles.All.ToArray()))
    .AddPolicy(
        PortalPolicies.DeviceOperate,
        policy => policy.RequireAuthenticatedUser()
            .RequireRole(
                PortalRoles.BreakGlass,
                PortalRoles.SecAdmin,
                PortalRoles.Admin,
                PortalRoles.OperatorL1,
                PortalRoles.SupportL2,
                PortalRoles.EngineerL3))
    .AddPolicy(
        PortalPolicies.AuditRead,
        policy => policy.RequireAuthenticatedUser()
            .RequireRole(PortalRoles.BreakGlass, PortalRoles.SecAdmin, PortalRoles.Auditor));

builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-SIRK-CSRF";
    options.Cookie.Name = secureCookies
        ? "__Host-SIRK-Portal-CSRF"
        : "SIRK-Portal-CSRF-Development";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.Path = "/";
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = secureCookies
        ? CookieSecurePolicy.Always
        : CookieSecurePolicy.SameAsRequest;
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(
        PortalEndpointNames.LoginRateLimit,
        context => RateLimitPartition.GetSlidingWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = Math.Clamp(
                    securityOptions.LoginAttemptsPerFiveMinutes,
                    1,
                    100),
                Window = TimeSpan.FromMinutes(5),
                SegmentsPerWindow = 5,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

builder.Services.AddHostedService<PortalLifecycleService>();
builder.Services.AddHostedService<CentralHeartbeatService>();
builder.Services.AddHostedService<CentralTunnelService>();
builder.Services.Configure<HostOptions>(options =>
{
    options.ShutdownTimeout = TimeSpan.FromSeconds(30);
    options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost;
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor |
                               ForwardedHeaders.XForwardedHost |
                               ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    if (builder.Configuration.GetValue<bool>("Sirk:ReverseProxy:TrustAll"))
    {
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
    }
});

var app = builder.Build();
var runtimeState = app.Services.GetRequiredService<PortalRuntimeState>();
var centralConnectionState = app.Services.GetRequiredService<CentralConnectionState>();

_ = app.Services.GetRequiredService<PortalIdentityStore>();
_ = app.Services.GetRequiredService<PortalSettingsStore>();
_ = app.Services.GetRequiredService<PortalMaintenanceStore>();
_ = app.Services.GetRequiredService<AgentStore>();
_ = app.Services.GetRequiredService<AgentInstallerTicketStore>();
_ = app.Services.GetRequiredService<AgentCommandStore>();
_ = app.Services.GetRequiredService<AgentPolicyStore>();
_ = app.Services.GetRequiredService<ScriptStore>();
_ = app.Services.GetRequiredService<ApprovalStore>();
_ = app.Services.GetRequiredService<PortalAuditLog>();

app.UseForwardedHeaders();
app.UseExceptionHandler();
if (!app.Environment.IsDevelopment()) app.UseHsts();

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers.TryAdd("X-Content-Type-Options", "nosniff");
        context.Response.Headers.TryAdd("X-Frame-Options", "SAMEORIGIN");
        context.Response.Headers.TryAdd("Referrer-Policy", "no-referrer");
        context.Response.Headers.TryAdd(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()");
        context.Response.Headers.TryAdd("Cross-Origin-Opener-Policy", "same-origin");
        context.Response.Headers.TryAdd("Cross-Origin-Resource-Policy", "same-origin");
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.Pragma = "no-cache";
        }
        return Task.CompletedTask;
    });
    await next();
});

app.UseRateLimiter();
app.UseMiddleware<AgentInstallerTicketMiddleware>();
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(20)
});
app.UseAuthentication();
app.UseMiddleware<InternalTunnelAuthenticationMiddleware>();
app.UseAuthorization();
app.UseStaticFiles();

app.MapPortalUi();

app.MapGet("/healthz", () => Results.Ok(new
{
    status = "healthy",
    service = "sirk-portal",
    utc = DateTimeOffset.UtcNow
}));
app.MapGet("/readyz", () => runtimeState.IsReady
    ? Results.Ok(new
    {
        status = "ready",
        service = "sirk-portal",
        utc = DateTimeOffset.UtcNow
    })
    : Results.Json(
        new
        {
            status = "starting",
            service = "sirk-portal",
            utc = DateTimeOffset.UtcNow
        },
        statusCode: StatusCodes.Status503ServiceUnavailable));
app.MapGet("/api/v1/portal/status", () => Results.Ok(new
{
    product = "SIRK Portal",
    runtime = ".NET 10",
    framework = AppContext.TargetFrameworkName,
    version = VersionInfo.Current,
    environment = app.Environment.EnvironmentName,
    ready = runtimeState.IsReady,
    startedAtUtc = runtimeState.StartedAtUtc,
    central = centralConnectionState.Snapshot()
})).AllowAnonymous();

app.MapPortalAuthentication();
app.MapPortalIdentity();
app.MapAgentEndpoints();
app.MapLegacyAgentCompatibility();
app.MapAgentInstallScript();
app.MapAgentInstallerPackages();
app.MapPortalModules();
app.MapPortalAdministration();
app.MapPortalMaintenance();

app.MapFallback(() => Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "Resource not found"));

app.Run();

namespace Sirk.Portal
{
    internal sealed class PortalRuntimeState
    {
        private int _ready;

        public DateTimeOffset StartedAtUtc { get; } = DateTimeOffset.UtcNow;
        public bool IsReady => Volatile.Read(ref _ready) == 1;
        public void MarkReady() => Interlocked.Exchange(ref _ready, 1);
        public void MarkStopping() => Interlocked.Exchange(ref _ready, 0);
    }

    internal sealed class PortalLifecycleService(
        PortalRuntimeState state,
        ILogger<PortalLifecycleService> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            state.MarkReady();
            logger.LogInformation("SIRK Portal .NET 10 runtime is ready.");
            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
            }
            finally
            {
                state.MarkStopping();
                logger.LogInformation("SIRK Portal runtime is stopping.");
            }
        }
    }
}