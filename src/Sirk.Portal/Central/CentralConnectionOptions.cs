namespace Sirk.Portal.Central;

internal sealed class CentralConnectionOptions
{
    public const string SectionName = "Sirk:Central";

    public bool Enabled { get; set; }

    public string BaseUrl { get; set; } = string.Empty;

    public string PortalId { get; set; } = string.Empty;

    public string PortalName { get; set; } = string.Empty;

    public string PortalToken { get; set; } = string.Empty;

    public string PublicUrl { get; set; } = string.Empty;

    public string UpdateChannel { get; set; } = "dev";

    public int HeartbeatIntervalSeconds { get; set; } = 60;

    public int RequestTimeoutSeconds { get; set; } = 15;

    public string ConnectionFile { get; set; } = string.Empty;
}
