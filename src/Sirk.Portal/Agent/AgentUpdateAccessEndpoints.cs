using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Sirk.Portal.Central;

namespace Sirk.Portal.Agent;

internal sealed record CentralAgentUpdateTicketRequest(string DeviceId, string Runtime, string Channel, string CurrentVersion);

internal static class AgentUpdateAccessEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex VersionPattern = new("^0\\.1\\.1\\.[0-9]+$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static IEndpointRouteBuilder MapAgentUpdateAccess(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/agent/update-access", HandleAsync)
            .AllowAnonymous()
            .DisableAntiforgery();
        return endpoints;
    }

    private static async Task HandleAsync(
        HttpContext context,
        AgentRequestAuthenticator authenticator,
        CentralConnectionResolver resolver,
        IHttpClientFactory httpClientFactory)
    {
        context.Response.Headers.CacheControl = "no-store";
        using var principal = authenticator.Authenticate(context.Request, ReadOnlySpan<byte>.Empty);
        if (principal is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var runtime = context.Request.Query["runtime"].ToString();
        var channel = context.Request.Query["channel"].ToString();
        var currentVersion = NormalizeVersion(context.Request.Query["currentVersion"].ToString());
        if (runtime != "win-x64" || channel is not ("stable" or "preview") || currentVersion is null)
        {
            await WriteSignedAsync(context, authenticator, principal, StatusCodes.Status400BadRequest,
                new { ok = false, code = "AGENT_UPDATE_ACCESS_INVALID" });
            return;
        }

        ResolvedCentralConnection resolved;
        try { resolved = resolver.Resolve(); }
        catch
        {
            await WriteSignedAsync(context, authenticator, principal, StatusCodes.Status503ServiceUnavailable,
                new { ok = false, code = "CENTRAL_CONNECTION_UNAVAILABLE" });
            return;
        }
        var central = resolved.Options;
        if (!central.Enabled || string.IsNullOrWhiteSpace(central.BaseUrl) ||
            string.IsNullOrWhiteSpace(central.PortalId) || string.IsNullOrWhiteSpace(central.PortalToken) ||
            !Uri.TryCreate(central.BaseUrl, UriKind.Absolute, out var baseUri) ||
            baseUri.Scheme != Uri.UriSchemeHttps && (baseUri.Scheme != Uri.UriSchemeHttp || !baseUri.IsLoopback))
        {
            await WriteSignedAsync(context, authenticator, principal, StatusCodes.Status503ServiceUnavailable,
                new { ok = false, code = "CENTRAL_CONNECTION_UNAVAILABLE" });
            return;
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(central.RequestTimeoutSeconds, 5, 30)));
            var endpoint = new Uri(baseUri, "/api/portal/v1/update/agent/ticket");
            var body = JsonSerializer.SerializeToUtf8Bytes(
                new CentralAgentUpdateTicketRequest(principal.DeviceId, runtime, channel, currentVersion), Json);
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new ByteArrayContent(body)
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            var signed = PortalRequestSigner.Create(body, central.PortalId, central.PortalToken);
            request.Headers.TryAddWithoutValidation("Authorization", signed.Authorization);
            var client = httpClientFactory.CreateClient("SirkCentral");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                await WriteSignedAsync(context, authenticator, principal, StatusCodes.Status503ServiceUnavailable,
                    new { ok = false, code = "CENTRAL_UPDATE_TICKET_UNAVAILABLE" });
                return;
            }
            var responseBytes = await response.Content.ReadAsByteArrayAsync(timeout.Token);
            if (responseBytes.Length is <= 0 or > 64 * 1024)
                throw new InvalidDataException("Central update ticket response size is invalid.");
            using var document = JsonDocument.Parse(responseBytes);
            var root = document.RootElement;
            if (!root.TryGetProperty("centralBaseUrl", out var baseUrl) ||
                !root.TryGetProperty("ticket", out var ticket) ||
                !root.TryGetProperty("expiresAtUtc", out _) ||
                string.IsNullOrWhiteSpace(baseUrl.GetString()) || string.IsNullOrWhiteSpace(ticket.GetString()))
                throw new InvalidDataException("Central update ticket response is invalid.");
            await WriteSignedBytesAsync(context, authenticator, principal, StatusCodes.Status200OK, responseBytes);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException or JsonException or InvalidDataException)
        {
            await WriteSignedAsync(context, authenticator, principal, StatusCodes.Status503ServiceUnavailable,
                new { ok = false, code = "CENTRAL_UPDATE_TICKET_UNAVAILABLE", reason = exception.GetType().Name });
        }
    }

    private static string? NormalizeVersion(string raw)
    {
        var value = (raw ?? string.Empty).Trim();
        var plus = value.IndexOf('+');
        if (plus > 0) value = value[..plus];
        return VersionPattern.IsMatch(value) ? value : null;
    }

    private static Task WriteSignedAsync(
        HttpContext context,
        AgentRequestAuthenticator authenticator,
        AgentPrincipal principal,
        int statusCode,
        object body) =>
        WriteSignedBytesAsync(context, authenticator, principal, statusCode, JsonSerializer.SerializeToUtf8Bytes(body, Json));

    private static async Task WriteSignedBytesAsync(
        HttpContext context,
        AgentRequestAuthenticator authenticator,
        AgentPrincipal principal,
        int statusCode,
        byte[] body)
    {
        var signature = authenticator.SignResponse(principal, body);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers["X-SIRK-Response-Timestamp"] = signature.Timestamp;
        context.Response.Headers["X-SIRK-Response-Nonce"] = signature.Nonce;
        context.Response.Headers["X-SIRK-Response-Signature"] = signature.Signature;
        await context.Response.Body.WriteAsync(body, context.RequestAborted);
    }
}
