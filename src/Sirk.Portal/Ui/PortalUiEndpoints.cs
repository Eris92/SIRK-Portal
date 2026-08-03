using System.Text;
using Microsoft.AspNetCore.Authentication;
using Sirk.Portal.Security;

namespace Sirk.Portal.Ui;

internal static class PortalUiEndpoints
{
    private static readonly IReadOnlyDictionary<string, string> Assets = BuildAssets();

    public static IEndpointRouteBuilder MapPortalUi(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPortalUiCompatibility();
        endpoints.MapGet("/", PortalAsync).AllowAnonymous();
        endpoints.MapGet("/login", LoginAsync).AllowAnonymous();
        endpoints.MapGet("/assets/{**asset}", AssetAsync).AllowAnonymous();
        endpoints.MapGet("/auth/logout", (Delegate)LogoutAsync).AllowAnonymous();
        return endpoints;
    }

    private static async Task<IResult> PortalAsync(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        NoStore(context);
        if (context.User.Identity?.IsAuthenticated != true)
            return Results.Redirect("/login", permanent: false, preserveMethod: false);

        var path = Path.Combine(environment.WebRootPath, "portal", "standalone", "index.html");
        var html = await File.ReadAllTextAsync(path, Encoding.UTF8, context.RequestAborted);
        var version = VersionInfo.Current;
        html = html
            .Replace("__API_BASE_JSON__", "\"/api/v1\"", StringComparison.Ordinal)
            .Replace("__ASSET_BASE_JSON__", "\"/assets\"", StringComparison.Ordinal)
            .Replace("__NATIVE_URL_JSON__", "null", StringComparison.Ordinal)
            .Replace("__LOGOUT_URL_JSON__", "\"/auth/logout\"", StringComparison.Ordinal)
            .Replace("__USER_IMAGE_URL_JSON__", "\"/assets/icons/sirk-ui.svg\"", StringComparison.Ordinal)
            .Replace("__DEFAULT_USER_IMAGE_URL_JSON__", "\"/assets/icons/sirk-ui.svg\"", StringComparison.Ordinal)
            .Replace("__VERSION_JSON__", System.Text.Json.JsonSerializer.Serialize(version), StringComparison.Ordinal)
            .Replace("__ASSET_BASE__", "/assets", StringComparison.Ordinal)
            .Replace("__VERSION__", Uri.EscapeDataString(version), StringComparison.Ordinal);
        html = html.Replace(
            "</head>",
            $"<link rel=\"stylesheet\" href=\"/assets/portal-management-frame.css?v={Uri.EscapeDataString(version)}\"><link rel=\"stylesheet\" href=\"/assets/system-updates.css?v={Uri.EscapeDataString(version)}\"></head>",
            StringComparison.Ordinal);
        html = html.Replace(
            "</body>",
            $"<script src=\"/assets/system-updates.js?v={Uri.EscapeDataString(version)}\"></script></body>",
            StringComparison.Ordinal);
        return Results.Content(html, "text/html; charset=utf-8", Encoding.UTF8);
    }

    private static async Task<IResult> LoginAsync(
        HttpContext context,
        IWebHostEnvironment environment)
    {
        NoStore(context);
        if (context.User.Identity?.IsAuthenticated == true)
            return Results.Redirect("/", permanent: false, preserveMethod: false);

        var path = Path.Combine(environment.WebRootPath, "portal", "standalone", "login.html");
        var html = await File.ReadAllTextAsync(path, Encoding.UTF8, context.RequestAborted);
        var version = VersionInfo.Current;
        html = html
            .Replace("__ASSET_BASE_JSON__", "\"/assets\"", StringComparison.Ordinal)
            .Replace("__PORTAL_URL_JSON__", "\"/\"", StringComparison.Ordinal)
            .Replace("__VERSION_JSON__", System.Text.Json.JsonSerializer.Serialize(version), StringComparison.Ordinal)
            .Replace("__ASSET_BASE__", "/assets", StringComparison.Ordinal)
            .Replace("__VERSION__", Uri.EscapeDataString(version), StringComparison.Ordinal);
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
            ["portal-standalone-devices.css"] = "portal/standalone/styles/devices.css",
            ["portal-device-workspace.css"] = "portal/standalone/styles/device-workspace.css",
            ["portal-device-tabs.css"] = "portal/standalone/styles/device-tabs.css",
            ["portal-module-shell.css"] = "portal/standalone/styles/module-shell.css",
            ["portal-management-frame.css"] = "portal/standalone/styles/management-frame.css",
            ["portal-cleanup.css"] = "portal/standalone/styles/cleanup.css",
            ["system-updates.js"] = "portal/system-updates.js",
            ["system-updates.css"] = "portal/system-updates.css",
            ["settings.js"] = "portal/settings.js",
            ["main.css"] = "shared/styles/main.css",
            ["shared/icon-registry.js"] = "shared/icon-registry.js",
            ["myscripts.css"] = "modules/automation/style.css",
            ["shared-ui/shared-ui.css"] = "shared/ui/shared-ui.css",
            ["shared-ui/toolbar.css"] = "shared/ui/toolbar.css",
            ["module-shell.js"] = "shared/module-shell.js",
            ["portal-icon-data.js"] = "portal/icons.js",
            ["approvalcenter.js"] = "modules/approvals/index.js",
            ["moverequests.js"] = "modules/move-requests/index.js",
            ["mycommands.js"] = "modules/commands/index.js",
            ["myscripts.js"] = "portal/management.js",
            ["myjira.js"] = "modules/jira/index.js",
            ["defendertools.js"] = "modules/security/index.js",
            ["portal-management.js"] = "portal/management.js",
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
