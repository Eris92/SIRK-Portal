using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Sirk.Portal.Security;

namespace Sirk.Portal.Ui;

internal static class PortalUiEndpoints
{
    private const string AssetRevision = "group-bound-agent-installer-20260803-1";
    private const string ProxyPrefixHeader = "X-SIRK-Proxy-Prefix";
    private static readonly IReadOnlyDictionary<string, string> Assets = BuildAssets();

    public static IEndpointRouteBuilder MapPortalUi(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPortalUiCompatibility();
        endpoints.MapGet("/", PortalAsync).AllowAnonymous();
        endpoints.MapGet("/login", LoginAsync).AllowAnonymous();
        endpoints.MapGet("/assets/{**asset}", AssetAsync).AllowAnonymous();
        endpoints.MapGet("/auth/logout", (Delegate)LogoutAsync).AllowAnonymous();
        endpoints.MapGet("/maintenance.json", (HttpContext context) =>
        {
            var prefix = ResolveProxyPrefix(context);
            return Results.Json(new
            {
                enabled = false,
                native = true,
                api = WithPrefix(prefix, "/api/v1/admin/maintenance/status")
            });
        }).AllowAnonymous();
        endpoints.MapGet("/api/v1/system/info", SystemInfo)
            .AllowAnonymous();
        return endpoints;
    }

    private static IResult SystemInfo(HttpContext context)
    {
        NoStore(context);
        var delegated = context.Items["Sirk.InternalTunnel"] is true;
        var authenticated = context.User.Identity?.IsAuthenticated == true;
        var source = context.User.FindFirstValue("sirk:identity_source") ?? string.Empty;
        if (!delegated || !authenticated || !source.Equals("central", StringComparison.Ordinal))
        {
            return Results.Json(
                new
                {
                    ok = false,
                    code = "DELEGATED_TUNNEL_REQUIRED",
                    error = "A verified delegated Central tunnel identity is required."
                },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        return Results.Ok(new
        {
            product = "SIRK Portal",
            runtime = ".NET 10",
            version = VersionInfo.Current,
            delegated = true,
            identity = new
            {
                id = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty,
                name = context.User.Identity?.Name ?? string.Empty,
                role = context.User.FindFirstValue(ClaimTypes.Role) ?? string.Empty,
                source
            }
        });
    }

    private static async Task<IResult> PortalAsync(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        NoStore(context);
        var prefix = ResolveProxyPrefix(context);
        if (context.User.Identity?.IsAuthenticated != true)
            return Results.Redirect("/login", permanent: false, preserveMethod: false);

        var path = Path.Combine(environment.WebRootPath, "portal", "standalone", "index.html");
        var html = await File.ReadAllTextAsync(path, Encoding.UTF8, context.RequestAborted);
        var version = VersionInfo.Current;
        var assetVersion = ResolveAssetVersion(version);
        var apiBase = WithPrefix(prefix, "/api/v1");
        var assetBase = WithPrefix(prefix, "/assets");
        var logoutUrl = WithPrefix(prefix, "/auth/logout");
        var userImageUrl = WithPrefix(prefix, "/assets/icons/sirk-ui.svg");
        html = html
            .Replace("__API_BASE_JSON__", System.Text.Json.JsonSerializer.Serialize(apiBase), StringComparison.Ordinal)
            .Replace("__ASSET_BASE_JSON__", System.Text.Json.JsonSerializer.Serialize(assetBase), StringComparison.Ordinal)
            .Replace("__NATIVE_URL_JSON__", "null", StringComparison.Ordinal)
            .Replace("__LOGOUT_URL_JSON__", System.Text.Json.JsonSerializer.Serialize(logoutUrl), StringComparison.Ordinal)
            .Replace("__USER_IMAGE_URL_JSON__", System.Text.Json.JsonSerializer.Serialize(userImageUrl), StringComparison.Ordinal)
            .Replace("__DEFAULT_USER_IMAGE_URL_JSON__", System.Text.Json.JsonSerializer.Serialize(userImageUrl), StringComparison.Ordinal)
            .Replace("__VERSION_JSON__", System.Text.Json.JsonSerializer.Serialize(assetVersion), StringComparison.Ordinal)
            .Replace("__ASSET_BASE__", assetBase, StringComparison.Ordinal)
            .Replace("__VERSION__", Uri.EscapeDataString(assetVersion), StringComparison.Ordinal);
        html = html.Replace(
            "</head>",
            $"<link rel=\"stylesheet\" href=\"{assetBase}/portal-management-frame.css?v={Uri.EscapeDataString(assetVersion)}\"></head>",
            StringComparison.Ordinal);
        html = html.Replace(
            "</body>",
            $"<script src=\"{assetBase}/agent-installer-ui.js?v={Uri.EscapeDataString(assetVersion)}\"></script></body>",
            StringComparison.Ordinal);
        return Results.Content(html, "text/html; charset=utf-8", Encoding.UTF8);
    }

    private static async Task<IResult> LoginAsync(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        NoStore(context);
        var prefix = ResolveProxyPrefix(context);
        if (context.User.Identity?.IsAuthenticated == true)
            return Results.Redirect("/", permanent: false, preserveMethod: false);

        var path = Path.Combine(environment.WebRootPath, "portal", "standalone", "login.html");
        var html = await File.ReadAllTextAsync(path, Encoding.UTF8, context.RequestAborted);
        var version = VersionInfo.Current;
        var assetVersion = ResolveAssetVersion(version);
        var assetBase = WithPrefix(prefix, "/assets");
        var portalUrl = WithPrefix(prefix, "/");
        html = html
            .Replace("__ASSET_BASE_JSON__", System.Text.Json.JsonSerializer.Serialize(assetBase), StringComparison.Ordinal)
            .Replace("__PORTAL_URL_JSON__", System.Text.Json.JsonSerializer.Serialize(portalUrl), StringComparison.Ordinal)
            .Replace("__VERSION_JSON__", System.Text.Json.JsonSerializer.Serialize(assetVersion), StringComparison.Ordinal)
            .Replace("__ASSET_BASE__", assetBase, StringComparison.Ordinal)
            .Replace("__VERSION__", Uri.EscapeDataString(assetVersion), StringComparison.Ordinal);
        return Results.Content(html, "text/html; charset=utf-8", Encoding.UTF8);
    }

    private static IResult AssetAsync(
        string? asset,
        HttpContext context,
        IWebHostEnvironment environment)
    {
        NoStore(context);
        var normalized = (asset ?? string.Empty).Replace('\\', '/').TrimStart('/');
        if (!Assets.TryGetValue(normalized, out var relativePath))
            return Results.NotFound();

        var webRoot = Path.GetFullPath(environment.WebRootPath);
        var filePath = Path.GetFullPath(Path.Combine(webRoot, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!filePath.StartsWith(webRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(filePath))
        {
            return Results.NotFound();
        }
        return Results.File(filePath, ContentType(normalized), enableRangeProcessing: false);
    }

    private static async Task<IResult> LogoutAsync(HttpContext context)
    {
        NoStore(context);
        if (context.User.Identity?.IsAuthenticated == true)
            await context.SignOutAsync(PortalAuthenticationSchemes.Session);
        return Results.Redirect("/login", permanent: false, preserveMethod: false);
    }

    private static string ResolveProxyPrefix(HttpContext context)
    {
        if (context.Items["Sirk.InternalTunnel"] is not true) return string.Empty;
        var value = context.Request.Headers[ProxyPrefixHeader].ToString().Trim();
        return Regex.IsMatch(
            value,
            "^/connect/[a-z0-9][a-z0-9-]{2,62}$",
            RegexOptions.CultureInvariant)
            ? value
            : string.Empty;
    }

    private static string WithPrefix(string prefix, string path) =>
        string.IsNullOrEmpty(prefix) ? path : prefix + path;

    private static string ResolveAssetVersion(string productVersion) =>
        productVersion + "-" + AssetRevision;

    private static IReadOnlyDictionary<string, string> BuildAssets()
    {
        var assets = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["icons/sirk-ui.svg"] = "assets/icons/sirk-ui.svg",
            ["standalone-core.js"] = "portal/standalone/scripts/core.js",
            ["portal-standalone.js"] = "portal/standalone/scripts/app.js",
            ["portal-standalone-nav.js"] = "portal/standalone/scripts/navigation.js",
            ["portal-device-workspace.js"] = "portal/standalone/scripts/device-workspace.js",
            ["portal-device-tabs.js"] = "portal/standalone/scripts/device-tabs.js",
            ["portal-view-mode.js"] = "portal/standalone/scripts/view-mode.js",
            ["portal-cleanup.js"] = "portal/standalone/scripts/cleanup.js",
            ["portal-terminal-connect.js"] = "portal/standalone/scripts/terminal-connect.js",
            ["portal-branding.js"] = "portal/standalone/scripts/branding.js",
            ["portal-branding.json"] = "portal/standalone/branding.json",
            ["portal-login.js"] = "portal/standalone/scripts/login.js",
            ["portal-login.css"] = "portal/standalone/styles/login.css",
            ["portal-standalone.css"] = "portal/standalone/styles/base.css",
            ["portal.css"] = "portal/portal.css",
            ["settings.css"] = "portal/settings.css",
            ["system-updates.css"] = "portal/system-updates.css",
            ["system-updates.js"] = "portal/system-updates.js",
            ["agent-installer-ui.js"] = "portal/standalone/scripts/agent-installer-ui.js",
            ["portal-standalone-devices.css"] = "portal/standalone/styles/devices.css",
            ["portal-device-workspace.css"] = "portal/standalone/styles/device-workspace.css",
            ["portal-device-tabs.css"] = "portal/standalone/styles/device-tabs.css",
            ["portal-module-shell.css"] = "portal/standalone/styles/module-shell.css",
            ["portal-management-frame.css"] = "portal/standalone/styles/management-frame.css",
            ["portal-cleanup.css"] = "portal/standalone/styles/cleanup.css",
            ["settings.js"] = "portal/standalone/scripts/settings-native-v2.js",
            ["main.css"] = "shared/styles/main.css",
            ["shared/icon-registry.js"] = "shared/icon-registry.js",
            ["management.css"] = "modules/management/style.css",
            ["shared-ui/shared-ui.css"] = "shared/ui/shared-ui.css",
            ["shared-ui/toolbar.css"] = "shared/ui/toolbar.css",
            ["module-shell.js"] = "shared/module-shell.js",
            ["portal-icon-data.js"] = "portal/icons.js",
            ["approvals.js"] = "modules/approvals/index.js",
            ["move-requests.js"] = "modules/move-requests/index.js",
            ["commands.js"] = "modules/commands/index.js",
            ["management.js"] = "portal/management.js",
            ["jira.js"] = "modules/jira/index.js",
            ["security.js"] = "modules/security/index.js",
            ["portal-subfolder-icons.js"] = "portal/subfolder-icons.js",
            ["portal-folder-collapse.js"] = "portal/folder-collapse.js",
            ["vendor/sirk-portal/sirk-portal.css"] = "portal/vendor/sirk-portal.css",
            ["vendor/sirk-portal/portal-ui-contract.css"] = "portal/vendor/portal-ui-contract.css",
            ["vendor/sirk-portal/portal-ui-contract.js"] = "portal/vendor/portal-ui-contract.js",
            ["vendor/sirk-portal/settings-structure.js"] = "portal/vendor/settings-structure.js"
        };

        foreach (var name in new[]
                 {
                     "toolbar-config.js", "toolbar-api.js", "toolbar.js", "tabs.js", "layout.js",
                     "settings.js", "status-nav.js", "page.js", "tree.js", "catalog.js",
                     "results.js", "result-layout.js", "script-tools.js", "script-definition-form.js",
                     "confirm-execution-form.js", "script-edit-actions.js", "system-credentials-form.js"
                 })
        {
            assets["shared-ui/" + name] = "shared/ui/" + name;
        }
        return assets;
    }

    private static string ContentType(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream"
    };

    private static void NoStore(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
        context.Response.Headers.Pragma = "no-cache";
        context.Response.Headers.Expires = "0";
    }
}
