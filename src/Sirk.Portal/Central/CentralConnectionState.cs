namespace Sirk.Portal.Central;

internal sealed record CentralConnectionSnapshot(
    bool Configured,
    bool Connected,
    string Status,
    string ConfigurationSource,
    string CentralUrl,
    string PortalId,
    DateTimeOffset? LastAttemptAtUtc,
    DateTimeOffset? LastSuccessAtUtc,
    int? LastStatusCode,
    string LastError,
    int ConsecutiveFailures);

internal sealed class CentralConnectionState
{
    private readonly Lock _sync = new();
    private CentralConnectionSnapshot _snapshot = new(
        false,
        false,
        "disabled",
        "none",
        string.Empty,
        string.Empty,
        null,
        null,
        null,
        string.Empty,
        0);

    public CentralConnectionSnapshot Snapshot()
    {
        lock (_sync)
        {
            return _snapshot;
        }
    }

    public void MarkDisabled(string status, string configurationSource = "none")
    {
        lock (_sync)
        {
            _snapshot = new CentralConnectionSnapshot(
                false,
                false,
                status,
                configurationSource,
                string.Empty,
                string.Empty,
                DateTimeOffset.UtcNow,
                null,
                null,
                string.Empty,
                0);
        }
    }

    public void MarkConfigured(Uri centralUrl, string portalId, string configurationSource)
    {
        lock (_sync)
        {
            _snapshot = _snapshot with
            {
                Configured = true,
                Status = "configured",
                ConfigurationSource = configurationSource,
                CentralUrl = centralUrl.GetLeftPart(UriPartial.Authority),
                PortalId = portalId
            };
        }
    }

    public void MarkSuccess(
        Uri centralUrl,
        string portalId,
        string configurationSource,
        int statusCode)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_sync)
        {
            _snapshot = new CentralConnectionSnapshot(
                true,
                true,
                "connected",
                configurationSource,
                centralUrl.GetLeftPart(UriPartial.Authority),
                portalId,
                now,
                now,
                statusCode,
                string.Empty,
                0);
        }
    }

    public void MarkFailure(
        Uri centralUrl,
        string portalId,
        string configurationSource,
        int? statusCode,
        string error)
    {
        lock (_sync)
        {
            _snapshot = _snapshot with
            {
                Configured = true,
                Connected = false,
                Status = "warning",
                ConfigurationSource = configurationSource,
                CentralUrl = centralUrl.GetLeftPart(UriPartial.Authority),
                PortalId = portalId,
                LastAttemptAtUtc = DateTimeOffset.UtcNow,
                LastStatusCode = statusCode,
                LastError = error.Length <= 512 ? error : error[..512],
                ConsecutiveFailures = _snapshot.ConsecutiveFailures + 1
            };
        }
    }
}
