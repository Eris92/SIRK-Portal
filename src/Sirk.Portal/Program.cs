using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWindowsService(options => options.ServiceName = "SIRK Portal");
builder.WebHost.UseWebRoot("public");
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

builder.Services.AddProblemDetails();
builder.Services.AddSingleton<PortalRuntimeState>();
builder.Services.AddHostedService<PortalLifecycleService>();
builder.Services.Configure<HostOptions>(options =>
{
    options.ShutdownTimeout = TimeSpan.FromSeconds(20);
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor |
                               ForwardedHeaders.XForwardedHost |
                               ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;

    if (builder.Configuration.GetValue<bool>("Sirk:ReverseProxy:TrustAll"))
    {
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
    }
});

var app = builder.Build();
var runtimeState = app.Services.GetRequiredService<PortalRuntimeState>();

app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers.TryAdd("X-Content-Type-Options", "nosniff");
        context.Response.Headers.TryAdd("X-Frame-Options", "SAMEORIGIN");
        context.Response.Headers.TryAdd("Referrer-Policy", "no-referrer");
        context.Response.Headers.TryAdd(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
        return Task.CompletedTask;
    });

    await next();
});

app.UseStaticFiles();

app.MapGet("/", () => Results.Content(
    """
    <!doctype html>
    <html lang="pl">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>SIRK Portal</title>
    </head>
    <body>
      <main>
        <h1>SIRK Portal</h1>
        <p>Runtime ASP.NET Core 10 jest uruchomiony.</p>
      </main>
    </body>
    </html>
    """,
    "text/html; charset=utf-8"));

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
    startedAtUtc = runtimeState.StartedAtUtc
}));

app.MapFallback(() => Results.Problem(
    statusCode: StatusCodes.Status404NotFound,
    title: "Resource not found"));

app.Run();

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
            // Normal service shutdown.
        }
        finally
        {
            state.MarkStopping();
            logger.LogInformation("SIRK Portal runtime is stopping.");
        }
    }
}

internal static class VersionInfo
{
    public static string Current { get; } = Resolve();

    private static string Resolve()
    {
        var assembly = Assembly.GetExecutingAssembly();
        return assembly
                   .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                   ?.InformationalVersion
               ?? assembly.GetName().Version?.ToString()
               ?? "unknown";
    }
}
