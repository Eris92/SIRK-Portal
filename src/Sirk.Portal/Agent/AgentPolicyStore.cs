using System.Text.Json;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Agent;

internal sealed record AgentPolicyRecord(
    string ScopeType,
    string ScopeId,
    long Version,
    JsonElement Policy,
    DateTimeOffset UpdatedAtUtc,
    string UpdatedById,
    string UpdatedByName);

internal sealed record AgentPolicyDocument(
    int SchemaVersion,
    long Revision,
    IReadOnlyList<AgentPolicyRecord> Policies,
    DateTimeOffset UpdatedAtUtc);

internal sealed record AgentEffectivePolicy(long Revision, JsonElement Policy);

internal sealed record AgentPolicyUpdateRequest(
    string ScopeType,
    string ScopeId,
    JsonElement Policy);

internal sealed class AgentPolicyStore
{
    private const int SchemaVersion = 1;
    private readonly object _sync = new();
    private readonly string _path;
    private readonly AgentStore _agents;
    private AgentPolicyDocument _document;

    public AgentPolicyStore(PortalPaths paths, AgentStore agents)
    {
        _path = paths.PoliciesFile;
        _agents = agents;
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<AgentPolicyDocument>(_path))
            : new AgentPolicyDocument(SchemaVersion, 0, [], DateTimeOffset.UtcNow);
    }

    public AgentPolicyRecord Update(
        AgentPolicyUpdateRequest request,
        string actorId,
        string actorName)
    {
        ArgumentNullException.ThrowIfNull(request);
        var scopeType = (request.ScopeType ?? string.Empty).Trim().ToLowerInvariant();
        if (scopeType is not ("group" or "device"))
            throw new InvalidDataException("Policy scope type must be group or device.");
        var scopeId = (request.ScopeId ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(scopeId))
            throw new InvalidDataException("Policy scope ID is required.");
        if (scopeType == "device" && _agents.GetDevice(scopeId) is null)
            throw new KeyNotFoundException("Device was not found.");
        if (request.Policy.ValueKind is not JsonValueKind.Object)
            throw new InvalidDataException("Agent policy must be a JSON object.");
        if (request.Policy.GetRawText().Length > 256 * 1024)
            throw new InvalidDataException("Agent policy is too large.");

        lock (_sync)
        {
            var policies = _document.Policies.ToList();
            var index = policies.FindIndex(value =>
                value.ScopeType == scopeType && value.ScopeId == scopeId);
            var now = DateTimeOffset.UtcNow;
            var version = index < 0 ? 1 : checked(policies[index].Version + 1);
            var value = new AgentPolicyRecord(
                scopeType,
                scopeId,
                version,
                request.Policy.Clone(),
                now,
                actorId,
                actorName);
            if (index < 0) policies.Add(value);
            else policies[index] = value;
            Save(new AgentPolicyDocument(
                SchemaVersion, checked(_document.Revision + 1), policies, now));
            return value;
        }
    }

    public object EffectiveFor(AgentDeviceRecord device)
    {
        lock (_sync)
        {
            var group = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "group" && value.ScopeId == device.GroupId);
            var direct = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "device" && value.ScopeId == device.Id);
            var merged = Merge(group?.Policy, direct?.Policy);
            return new
            {
                deviceId = device.Id,
                groupId = device.GroupId,
                version = _document.Revision.ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
                policy = merged,
                generatedAtUtc = DateTimeOffset.UtcNow
            };
        }
    }


    public AgentEffectivePolicy? EffectiveForDelivery(AgentDeviceRecord device)
    {
        lock (_sync)
        {
            var group = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "group" && value.ScopeId == device.GroupId);
            var direct = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "device" && value.ScopeId == device.Id);
            if (group is null && direct is null) return null;
            return new AgentEffectivePolicy(
                Math.Max(1, _document.Revision),
                Merge(group?.Policy, direct?.Policy));
        }
    }

    public IReadOnlyList<AgentPolicyRecord> List()
    {
        lock (_sync)
        {
            return _document.Policies
                .OrderBy(value => value.ScopeType, StringComparer.Ordinal)
                .ThenBy(value => value.ScopeId, StringComparer.Ordinal)
                .ToArray();
        }
    }

    public void Delete(string scopeType, string scopeId)
    {
        var normalizedType = (scopeType ?? string.Empty).Trim().ToLowerInvariant();
        var normalizedId = (scopeId ?? string.Empty).Trim().ToLowerInvariant();
        lock (_sync)
        {
            if (!_document.Policies.Any(value =>
                    value.ScopeType == normalizedType && value.ScopeId == normalizedId))
            {
                throw new KeyNotFoundException("Agent policy was not found.");
            }
            Save(new AgentPolicyDocument(
                SchemaVersion,
                checked(_document.Revision + 1),
                _document.Policies.Where(value =>
                    value.ScopeType != normalizedType || value.ScopeId != normalizedId).ToArray(),
                DateTimeOffset.UtcNow));
        }
    }

    private void Save(AgentPolicyDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_path, _document);
    }

    private static AgentPolicyDocument Validate(AgentPolicyDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Agent policy schema is unsupported.");
        if (value.Policies.GroupBy(
                item => item.ScopeType + ":" + item.ScopeId,
                StringComparer.Ordinal).Any(group => group.Count() > 1))
        {
            throw new InvalidDataException("Agent policy store contains duplicate scopes.");
        }
        if (value.Revision < 0)
            throw new InvalidDataException("Agent policy revision is invalid.");
        var revision = value.Revision == 0 && value.Policies.Count > 0
            ? Math.Max(1, value.Policies.Max(item => item.Version))
            : value.Revision;
        return value with { Revision = revision };
    }

    private static JsonElement Merge(JsonElement? group, JsonElement? direct)
    {
        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (group is { ValueKind: JsonValueKind.Object } groupValue)
        {
            foreach (var property in groupValue.EnumerateObject())
                values[property.Name] = property.Value.Clone();
        }
        if (direct is { ValueKind: JsonValueKind.Object } directValue)
        {
            foreach (var property in directValue.EnumerateObject())
                values[property.Name] = property.Value.Clone();
        }
        return JsonSerializer.SerializeToElement(values);
    }
}
