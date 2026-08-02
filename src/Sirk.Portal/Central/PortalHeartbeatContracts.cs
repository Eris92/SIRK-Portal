using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sirk.Portal.Central;

internal sealed record PortalHeartbeatPayload(
    int ProtocolVersion,
    string PortalVersion,
    string BuildCommit,
    string Platform,
    string Hostname,
    string PublicUrl,
    string Health,
    int AgentCount,
    int OnlineAgents,
    string UpdateChannel,
    string AvailableVersion,
    IReadOnlyList<string> Capabilities);

[JsonSerializable(typeof(PortalHeartbeatPayload))]
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
internal sealed partial class PortalClientJsonContext : JsonSerializerContext;
