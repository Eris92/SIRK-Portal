using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Sirk.Portal.Central;

internal sealed class CentralTunnelOptions
{
    public const string SectionName = "Sirk:CentralTunnel";

    public bool Enabled { get; init; } = true;
    public string LocalOrigin { get; init; } = "http://127.0.0.1:8080";
    public int PollIntervalMilliseconds { get; init; } = 100;
    public int MaximumConcurrency { get; init; } = 32;
    public int MaximumBodyBytes { get; init; } = 8 * 1024 * 1024;
}

internal sealed record CentralTunnelRequest(
    string Id,
    string PortalId,
    string Method,
    string Path,
    Dictionary<string, string> Headers,
    string BodyBase64,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc);

internal sealed record CentralTunnelPollResponse(
    IReadOnlyList<CentralTunnelRequest> Requests);

internal sealed record CentralTunnelResponseInput(
    int StatusCode,
    string ContentType,
    Dictionary<string, string[]> Headers,
    string BodyBase64);

internal sealed record PortalCsrfResponse(
    string HeaderName,
    string RequestToken);

internal sealed class CentralTunnelService : BackgroundService
{
    private const string ProxyPrefixHeader = "X-SIRK-Proxy-Prefix";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly CentralConnectionResolver _resolver;
    private readonly InternalTunnelCredential _internalCredential;
    private readonly CentralTunnelOptions _options;
    private readonly ILogger<CentralTunnelService> _logger;
    private readonly SemaphoreSlim _concurrency;
    private readonly Uri _localOrigin;
    private readonly HttpClient _localClient;

    public CentralTunnelService(
        IHttpClientFactory httpClientFactory,
        CentralConnectionResolver resolver,
        InternalTunnelCredential internalCredential,
        IOptions<CentralTunnelOptions> options,
        ILogger<CentralTunnelService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _resolver = resolver;
        _internalCredential = internalCredential;
        _options = options.Value;
        _logger = logger;
        _concurrency = new SemaphoreSlim(
            Math.Clamp(_options.MaximumConcurrency, 1, 32),
            Math.Clamp(_options.MaximumConcurrency, 1, 32));
        _localOrigin = _options.Enabled
            ? ValidateLocalOrigin(_options.LocalOrigin)
            : new Uri("http://127.0.0.1/", UriKind.Absolute);

        var localHandler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip |
                                     DecompressionMethods.Deflate |
                                     DecompressionMethods.Brotli,
            UseCookies = false,
            MaxConnectionsPerServer = 32,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            EnableMultipleHttp2Connections = true
        };
        _localClient = new HttpClient(localHandler, disposeHandler: true)
        {
            BaseAddress = _localOrigin,
            Timeout = TimeSpan.FromSeconds(45),
            DefaultRequestVersion = HttpVersion.Version20,
            DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower
        };
    }

    public override void Dispose()
    {
        _localClient.Dispose();
        base.Dispose();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = Math.Clamp(_options.PollIntervalMilliseconds, 50, 10_000);
            var shouldDelay = true;
            try
            {
                var resolved = _resolver.Resolve();
                if (!_options.Enabled || !resolved.Options.Enabled)
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(delay), stoppingToken);
                    continue;
                }

                var requests = await PollAsync(resolved.Options, stoppingToken);
                shouldDelay = requests.Count == 0;
                foreach (var request in requests)
                {
                    await _concurrency.WaitAsync(stoppingToken);
                    _ = ProcessAsync(resolved.Options, request, stoppingToken)
                        .ContinueWith(
                            static (_, state) => ((SemaphoreSlim)state!).Release(),
                            _concurrency,
                            CancellationToken.None,
                            TaskContinuationOptions.ExecuteSynchronously,
                            TaskScheduler.Default);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (
                exception is HttpRequestException or InvalidDataException or JsonException or TaskCanceledException)
            {
                _logger.LogWarning(exception, "SIRK Central tunnel polling failed.");
            }

            if (!shouldDelay) continue;

            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(delay), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task<IReadOnlyList<CentralTunnelRequest>> PollAsync(
        CentralConnectionOptions options,
        CancellationToken cancellationToken)
    {
        var client = _httpClientFactory.CreateClient("SirkCentral");
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            BuildCentralUri(options.BaseUrl, "/api/v1/portal-tunnel/poll"));
        ApplyPortalAuthentication(request, options, []);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(options.RequestTimeoutSeconds, 5, 60)));
        using var response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            timeout.Token);
        if (response.StatusCode == HttpStatusCode.NoContent) return [];
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Central tunnel poll returned HTTP {(int)response.StatusCode}.",
                null,
                response.StatusCode);
        }
        var body = await ReadLimitedAsync(
            response.Content,
            Math.Min(_options.MaximumBodyBytes, 1024 * 1024),
            timeout.Token);
        var value = JsonSerializer.Deserialize<CentralTunnelPollResponse>(body, JsonOptions)
                    ?? throw new JsonException("Central tunnel poll response is empty.");
        return value.Requests ?? [];
    }

    private async Task ProcessAsync(
        CentralConnectionOptions connection,
        CentralTunnelRequest request,
        CancellationToken cancellationToken)
    {
        CentralTunnelResponseInput response;
        try
        {
            response = await DispatchAsync(request, cancellationToken);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or InvalidDataException or JsonException or TaskCanceledException)
        {
            _logger.LogWarning(
                exception,
                "Central tunnel request {RequestId} failed.",
                request.Id);
            var body = JsonSerializer.SerializeToUtf8Bytes(new
            {
                ok = false,
                code = "PORTAL_TUNNEL_DISPATCH_FAILED",
                error = exception.Message
            });
            response = new CentralTunnelResponseInput(
                StatusCodes.Status502BadGateway,
                "application/json; charset=utf-8",
                new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase),
                Convert.ToBase64String(body));
        }

        await CompleteAsync(connection, request.Id, response, cancellationToken);
    }

    private async Task<CentralTunnelResponseInput> DispatchAsync(
        CentralTunnelRequest request,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        var actorId = Header(request.Headers, "x-sirk-actor-id");
        var actorName = Header(request.Headers, "x-sirk-actor-name");
        var actorRole = Header(request.Headers, "x-sirk-actor-role");
        if (string.IsNullOrWhiteSpace(actorId) ||
            string.IsNullOrWhiteSpace(actorName) ||
            string.IsNullOrWhiteSpace(actorRole))
        {
            throw new InvalidDataException("Central tunnel request is missing delegated identity headers.");
        }

        // The connect probe validates the signed Portal poll/response channel itself.
        // It must not depend on public ASP.NET compatibility routes, cookies or CSRF.
        if (request.Method == "GET" &&
            request.Path.Equals("/api/v1/system/info", StringComparison.Ordinal))
        {
            var handshakeBody = JsonSerializer.SerializeToUtf8Bytes(new
            {
                ok = true,
                product = "SIRK Portal",
                runtime = ".NET 10",
                version = VersionInfo.Current,
                delegated = true,
                portalId = request.PortalId,
                identity = new
                {
                    id = actorId,
                    name = actorName,
                    role = actorRole,
                    source = "central"
                }
            }, JsonOptions);
            return new CentralTunnelResponseInput(
                StatusCodes.Status200OK,
                "application/json; charset=utf-8",
                new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase),
                Convert.ToBase64String(handshakeBody));
        }

        var unsafeRequest = IsUnsafe(request.Method);
        HttpClient? disposableClient = null;
        var client = _localClient;
        if (unsafeRequest)
        {
            var handler = new HttpClientHandler
            {
                AllowAutoRedirect = false,
                AutomaticDecompression = DecompressionMethods.GZip |
                                         DecompressionMethods.Deflate |
                                         DecompressionMethods.Brotli,
                UseCookies = true,
                CookieContainer = new CookieContainer(),
                MaxConnectionsPerServer = 8
            };
            disposableClient = new HttpClient(handler)
            {
                BaseAddress = _localOrigin,
                Timeout = TimeSpan.FromSeconds(45),
                DefaultRequestVersion = HttpVersion.Version20,
                DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower
            };
            client = disposableClient;
        }

        try
        {
            PortalCsrfResponse? csrf = null;
            if (unsafeRequest)
            {
                using var csrfRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/csrf");
                ApplyDelegatedIdentity(csrfRequest, actorId, actorName, actorRole, request.PortalId);
                using var csrfResponse = await client.SendAsync(csrfRequest, cancellationToken);
                if (!csrfResponse.IsSuccessStatusCode)
                    throw new InvalidDataException("Portal CSRF token could not be issued for the delegated request.");
                var csrfBody = await ReadLimitedAsync(csrfResponse.Content, 64 * 1024, cancellationToken);
                csrf = JsonSerializer.Deserialize<PortalCsrfResponse>(csrfBody, JsonOptions)
                       ?? throw new JsonException("Portal CSRF response is empty.");
            }

            using var localRequest = new HttpRequestMessage(
                new HttpMethod(request.Method),
                request.Path);
            ApplyDelegatedIdentity(localRequest, actorId, actorName, actorRole, request.PortalId);
            CopyRequestHeaders(request.Headers, localRequest);
            if (csrf is not null)
                localRequest.Headers.TryAddWithoutValidation(csrf.HeaderName, csrf.RequestToken);

            var requestBody = DecodeBody(request.BodyBase64, _options.MaximumBodyBytes);
            if (requestBody.Length > 0 || unsafeRequest)
            {
                localRequest.Content = new ByteArrayContent(requestBody);
                var contentType = Header(request.Headers, "content-type");
                if (!string.IsNullOrWhiteSpace(contentType) &&
                    MediaTypeHeaderValue.TryParse(contentType, out var parsed))
                {
                    localRequest.Content.Headers.ContentType = parsed;
                }
            }

            using var localResponse = await client.SendAsync(
                localRequest,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            var responseBody = await ReadLimitedAsync(
                localResponse.Content,
                _options.MaximumBodyBytes,
                cancellationToken);
            var contentTypeValue = localResponse.Content.Headers.ContentType?.ToString()
                                   ?? "application/octet-stream";
            var headers = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
            AddResponseHeader(localResponse, headers, "location");
            AddResponseHeader(localResponse, headers, "etag");
            AddResponseHeader(localResponse, headers, "last-modified");
            return new CentralTunnelResponseInput(
                (int)localResponse.StatusCode,
                contentTypeValue,
                headers,
                Convert.ToBase64String(responseBody));
        }
        finally
        {
            disposableClient?.Dispose();
        }
    }

    private async Task CompleteAsync(
        CentralConnectionOptions options,
        string requestId,
        CentralTunnelResponseInput value,
        CancellationToken cancellationToken)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        var client = _httpClientFactory.CreateClient("SirkCentral");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            BuildCentralUri(
                options.BaseUrl,
                "/api/v1/portal-tunnel/responses/" + Uri.EscapeDataString(requestId)))
        {
            Content = new ByteArrayContent(body)
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        ApplyPortalAuthentication(request, options, body);
        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Central tunnel response returned HTTP {(int)response.StatusCode}.",
                null,
                response.StatusCode);
        }
    }

    private void ApplyDelegatedIdentity(
        HttpRequestMessage request,
        string actorId,
        string actorName,
        string actorRole,
        string portalId)
    {
        request.Headers.TryAddWithoutValidation(
            "X-SIRK-Internal-Tunnel",
            _internalCredential.HeaderValue);
        request.Headers.TryAddWithoutValidation("X-SIRK-Actor-Id", actorId);
        request.Headers.TryAddWithoutValidation("X-SIRK-Actor-Name", actorName);
        request.Headers.TryAddWithoutValidation("X-SIRK-Actor-Role", actorRole);
        request.Headers.TryAddWithoutValidation(ProxyPrefixHeader, ProxyPrefix(portalId));
    }

    private static void ApplyPortalAuthentication(
        HttpRequestMessage request,
        CentralConnectionOptions options,
        ReadOnlySpan<byte> body)
    {
        var signed = PortalRequestSigner.Create(
            body,
            options.PortalId,
            options.PortalToken);
        request.Headers.TryAddWithoutValidation("Authorization", signed.Authorization);
        request.Headers.TryAddWithoutValidation("X-SIRK-Timestamp", signed.Timestamp);
        request.Headers.TryAddWithoutValidation("X-SIRK-Nonce", signed.Nonce);
        request.Headers.TryAddWithoutValidation("X-SIRK-Signature", signed.Signature);
    }

    private static void CopyRequestHeaders(
        IReadOnlyDictionary<string, string> source,
        HttpRequestMessage target)
    {
        foreach (var name in new[] { "accept", "accept-language", "user-agent" })
        {
            var value = Header(source, name);
            if (!string.IsNullOrWhiteSpace(value))
                target.Headers.TryAddWithoutValidation(name, value);
        }
    }

    private static void AddResponseHeader(
        HttpResponseMessage response,
        IDictionary<string, string[]> target,
        string name)
    {
        if (response.Headers.TryGetValues(name, out var values))
            target[name] = values.Take(16).ToArray();
        else if (response.Content.Headers.TryGetValues(name, out values))
            target[name] = values.Take(16).ToArray();
    }

    private static void ValidateRequest(CentralTunnelRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Id) || request.Id.Length > 80)
            throw new InvalidDataException("Central tunnel request ID is invalid.");
        if (request.PortalId is null ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                request.PortalId,
                "^[a-z0-9][a-z0-9-]{2,62}$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant))
        {
            throw new InvalidDataException("Central tunnel portal ID is invalid.");
        }
        if (request.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            throw new InvalidDataException("Central tunnel request has expired.");
        if (request.Method is not ("GET" or "HEAD" or "POST" or "PUT" or "PATCH" or "DELETE" or "OPTIONS"))
            throw new InvalidDataException("Central tunnel method is invalid.");
        if (string.IsNullOrWhiteSpace(request.Path) ||
            !request.Path.StartsWith('/', StringComparison.Ordinal) ||
            request.Path.StartsWith("//", StringComparison.Ordinal) ||
            request.Path.Contains('\\') ||
            request.Path.Length > 8192 ||
            request.Path.Any(char.IsControl))
        {
            throw new InvalidDataException("Central tunnel path is invalid.");
        }
        if (request.Path.StartsWith("/api/v1/agent", StringComparison.Ordinal) ||
            request.Path.StartsWith("/healthz", StringComparison.Ordinal) ||
            request.Path.StartsWith("/readyz", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Central tunnel path is not permitted.");
        }
    }

    private static string ProxyPrefix(string portalId) =>
        "/connect/" + Uri.EscapeDataString(portalId);

    private static Uri ValidateLocalOrigin(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri is null)
            throw new InvalidDataException("Central tunnel local origin must be a loopback HTTP(S) origin.");

        var loopbackHost = uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                           (IPAddress.TryParse(uri.Host, out var address) && IPAddress.IsLoopback(address));
        if ((uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            !loopbackHost ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            uri.AbsolutePath != "/")
        {
            throw new InvalidDataException("Central tunnel local origin must be a loopback HTTP(S) origin.");
        }
        return uri;
    }

    private static Uri BuildCentralUri(string baseUrl, string path)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var origin) ||
            origin is null ||
            origin.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(origin.UserInfo) ||
            !string.IsNullOrEmpty(origin.Query) ||
            !string.IsNullOrEmpty(origin.Fragment))
        {
            throw new InvalidDataException("Central URL is invalid.");
        }
        return new Uri(origin.GetLeftPart(UriPartial.Authority) + path, UriKind.Absolute);
    }

    private static bool IsUnsafe(string method) =>
        method is "POST" or "PUT" or "PATCH" or "DELETE";

    private static string Header(IReadOnlyDictionary<string, string> source, string name) =>
        source.TryGetValue(name, out var value)
            ? value
            : source.FirstOrDefault(item => item.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).Value
              ?? string.Empty;

    private static byte[] DecodeBody(string value, int maximumBytes)
    {
        try
        {
            var result = Convert.FromBase64String(value ?? string.Empty);
            if (result.Length > maximumBytes)
                throw new InvalidDataException("Central tunnel request body is too large.");
            return result;
        }
        catch (FormatException exception)
        {
            throw new InvalidDataException("Central tunnel request body is invalid Base64.", exception);
        }
    }

    private static async Task<byte[]> ReadLimitedAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength > maximumBytes)
            throw new InvalidDataException("Central tunnel response body is too large.");
        await using var input = await content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var count = await input.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            if (output.Length + count > maximumBytes)
                throw new InvalidDataException("Central tunnel response body is too large.");
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }
}
