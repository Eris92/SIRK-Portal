using System.Net;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Options;

namespace Sirk.Portal.Central;

internal sealed class CentralHeartbeatService(
    IHttpClientFactory httpClientFactory,
    IOptions<CentralConnectionOptions> options,
    CentralConnectionState connectionState,
    IHostEnvironment environment,
    global::PortalRuntimeState runtimeState,
    ILogger<CentralHeartbeatService> logger) : BackgroundService
{
    private readonly CentralConnectionOptions _options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            connectionState.MarkDisabled("disabled");
            logger.LogInformation("SIRK Central connection is disabled.");
            return;
        }

        if (!TryValidateConfiguration(_options, environment, out var centralUrl, out var error))
        {
            connectionState.MarkDisabled("configuration-invalid");
            logger.LogError("SIRK Central connection configuration is invalid: {Error}", error);
            return;
        }

        connectionState.MarkConfigured(centralUrl, _options.PortalId);
        var consecutiveFailures = 0;

        while (!stoppingToken.IsCancellationRequested)
        {
            var succeeded = await SendHeartbeatAsync(centralUrl, stoppingToken);
            consecutiveFailures = succeeded ? 0 : consecutiveFailures + 1;

            var delay = succeeded
                ? TimeSpan.FromSeconds(_options.HeartbeatIntervalSeconds)
                : CalculateRetryDelay(consecutiveFailures, _options.HeartbeatIntervalSeconds);

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task<bool> SendHeartbeatAsync(Uri centralUrl, CancellationToken stoppingToken)
    {
        var payload = new PortalHeartbeatPayload(
            1,
            global::VersionInfo.Current,
            Environment.GetEnvironmentVariable("SIRK_BUILD_COMMIT") ?? string.Empty,
            RuntimeInformation.RuntimeIdentifier,
            Dns.GetHostName(),
            _options.PublicUrl.Trim(),
            runtimeState.IsReady ? "ok" : "warning",
            0,
            0,
            _options.UpdateChannel.Trim(),
            global::VersionInfo.Current,
            [
                "dotnet10-runtime",
                "signed-heartbeat",
                "central-config-v1"
            ]);

        var signed = PortalHeartbeatSigner.Create(
            payload,
            _options.PortalId,
            _options.PortalToken);
        var endpoint = new Uri(centralUrl, "/api/portal/v1/heartbeat");

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.TryAddWithoutValidation("Authorization", signed.Authorization);
        request.Headers.TryAddWithoutValidation("X-SIRK-Timestamp", signed.Timestamp);
        request.Headers.TryAddWithoutValidation("X-SIRK-Nonce", signed.Nonce);
        request.Headers.TryAddWithoutValidation("X-SIRK-Signature", signed.Signature);
        request.Content = new ByteArrayContent(signed.Body);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json")
        {
            CharSet = "utf-8"
        };

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.RequestTimeoutSeconds));

        try
        {
            var client = httpClientFactory.CreateClient("SirkCentral");
            using var response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);

            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                connectionState.MarkSuccess(
                    centralUrl,
                    _options.PortalId,
                    (int)response.StatusCode);
                logger.LogDebug("Portal heartbeat accepted by SIRK Central.");
                return true;
            }

            var error = $"Central returned HTTP {(int)response.StatusCode} {response.ReasonPhrase}.";
            connectionState.MarkFailure(
                centralUrl,
                _options.PortalId,
                (int)response.StatusCode,
                error);
            logger.LogWarning(
                "Portal heartbeat was rejected by SIRK Central with HTTP {StatusCode}.",
                (int)response.StatusCode);
            return false;
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            const string error = "Central heartbeat request timed out.";
            connectionState.MarkFailure(centralUrl, _options.PortalId, null, error);
            logger.LogWarning("{Error}", error);
            return false;
        }
        catch (HttpRequestException exception)
        {
            connectionState.MarkFailure(
                centralUrl,
                _options.PortalId,
                exception.StatusCode is null ? null : (int)exception.StatusCode.Value,
                exception.Message);
            logger.LogWarning(
                exception,
                "Portal heartbeat transport to SIRK Central failed.");
            return false;
        }
    }

    private static TimeSpan CalculateRetryDelay(int consecutiveFailures, int heartbeatIntervalSeconds)
    {
        var exponent = Math.Min(consecutiveFailures - 1, 5);
        var seconds = 15 * (1 << Math.Max(exponent, 0));
        return TimeSpan.FromSeconds(Math.Min(seconds, Math.Max(heartbeatIntervalSeconds, 15)));
    }

    private static bool TryValidateConfiguration(
        CentralConnectionOptions options,
        IHostEnvironment environment,
        out Uri centralUrl,
        out string error)
    {
        centralUrl = null!;
        error = string.Empty;

        if (!Uri.TryCreate(options.BaseUrl.Trim(), UriKind.Absolute, out var parsedCentralUrl) ||
            parsedCentralUrl is null ||
            !string.IsNullOrEmpty(parsedCentralUrl.UserInfo) ||
            !string.IsNullOrEmpty(parsedCentralUrl.Query) ||
            !string.IsNullOrEmpty(parsedCentralUrl.Fragment))
        {
            error = "BaseUrl must be an absolute URL without credentials, query or fragment.";
            return false;
        }

        centralUrl = parsedCentralUrl;
        var secure = centralUrl.Scheme == Uri.UriSchemeHttps;
        var localDevelopment = environment.IsDevelopment() &&
                               centralUrl.Scheme == Uri.UriSchemeHttp &&
                               centralUrl.IsLoopback;
        if (!secure && !localDevelopment)
        {
            error = "BaseUrl must use HTTPS outside local Development mode.";
            return false;
        }

        if (!IsValidPortalId(options.PortalId))
        {
            error = "PortalId must contain 3-63 lowercase letters, digits or hyphens.";
            return false;
        }

        if (options.PortalName.Trim().Length is < 2 or > 100)
        {
            error = "PortalName must contain 2-100 characters.";
            return false;
        }

        if (options.PortalToken.Length is < 32 or > 512)
        {
            error = "PortalToken must contain 32-512 characters.";
            return false;
        }

        if (options.HeartbeatIntervalSeconds is < 30 or > 3600)
        {
            error = "HeartbeatIntervalSeconds must be between 30 and 3600.";
            return false;
        }

        if (options.RequestTimeoutSeconds is < 5 or > 120)
        {
            error = "RequestTimeoutSeconds must be between 5 and 120.";
            return false;
        }

        if (options.PublicUrl.Length > 0 &&
            (!Uri.TryCreate(options.PublicUrl, UriKind.Absolute, out var publicUrl) ||
             publicUrl is null ||
             publicUrl.Scheme != Uri.UriSchemeHttps ||
             !string.IsNullOrEmpty(publicUrl.UserInfo)))
        {
            error = "PublicUrl must be an HTTPS URL without credentials.";
            return false;
        }

        return true;
    }

    private static bool IsValidPortalId(string value)
    {
        if (value.Length is < 3 or > 63 || !IsLowercaseLetterOrDigit(value[0]))
        {
            return false;
        }

        foreach (var character in value)
        {
            if (!IsLowercaseLetterOrDigit(character) && character != '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowercaseLetterOrDigit(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
