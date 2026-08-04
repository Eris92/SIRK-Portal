using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sirk.Portal.Security;

namespace Sirk.Portal.Central;

internal sealed class PortalCentralIdentityMapper
{
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions SnapshotJsonOptions =
        new(JsonSerializerDefaults.Web);
    private static readonly IReadOnlyDictionary<string, string> CentralRoleMap =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["BreakGlass"] = PortalRoles.SecAdmin,
            ["SecAdmin"] = PortalRoles.SecAdmin,
            ["Admin"] = PortalRoles.Admin,
            ["Auditor"] = PortalRoles.Auditor,
            ["OperatorL1"] = PortalRoles.OperatorL1,
            ["SupportL2"] = PortalRoles.SupportL2,
            ["EngineerL3"] = PortalRoles.EngineerL3
        };

    private readonly PortalIdentityStore _identities;

    public PortalCentralIdentityMapper(PortalIdentityStore identities)
    {
        _identities = identities;
    }

    public PortalAuthenticatedIdentity Resolve(
        string centralActorId,
        string displayName,
        string centralRole)
    {
        var normalizedActorId = Normalize(centralActorId, 160, "Central actor ID");
        var normalizedDisplayName = Normalize(displayName, 128, "Central actor name");
        var role = MapRole(centralRole);
        var userName = "c-" + Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(normalizedActorId)))[..30]
            .ToLowerInvariant();

        lock (Sync)
        {
            var snapshot = JsonSerializer.SerializeToElement(
                _identities.Snapshot(),
                SnapshotJsonOptions);
            if (!snapshot.TryGetProperty("users", out var users) ||
                users.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidDataException(
                    "Portal identity snapshot does not contain a valid users array.");
            }

            var existing = users
                .EnumerateArray()
                .FirstOrDefault(value =>
                    TryReadString(value, "userName", out var existingUserName) &&
                    string.Equals(existingUserName, userName, StringComparison.Ordinal));

            if (existing.ValueKind == JsonValueKind.Undefined)
            {
                return _identities.CreateUser(
                    userName,
                    normalizedDisplayName,
                    GenerateUnusablePassword(),
                    role);
            }

            var id = ReadRequiredString(existing, "id", "Mapped Central identity has no ID.");
            var currentRole = ReadRequiredString(
                existing,
                "role",
                "Mapped Central identity has no role.");
            var currentDisplayName = ReadRequiredString(
                existing,
                "displayName",
                "Mapped Central identity has no display name.");
            var enabled = ReadRequiredBoolean(
                existing,
                "enabled",
                "Mapped Central identity has no enabled state.");
            if (!enabled ||
                !string.Equals(currentRole, role, StringComparison.Ordinal) ||
                !string.Equals(currentDisplayName, normalizedDisplayName, StringComparison.Ordinal))
            {
                return _identities.UpdateUser(
                    id,
                    normalizedDisplayName,
                    role,
                    enabled: true,
                    actorId: "central-identity-sync");
            }

            return _identities.Get(id)
                   ?? throw new InvalidDataException(
                       "Mapped Central identity could not be loaded.");
        }
    }

    internal static string MapRole(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        return CentralRoleMap.TryGetValue(normalized, out var mapped)
            ? mapped
            : throw new UnauthorizedAccessException(
                "Central role is not supported by this Portal.");
    }

    private static bool TryReadString(
        JsonElement value,
        string propertyName,
        out string result)
    {
        result = string.Empty;
        if (!value.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        result = property.GetString() ?? string.Empty;
        return true;
    }

    private static string ReadRequiredString(
        JsonElement value,
        string propertyName,
        string error)
    {
        if (!TryReadString(value, propertyName, out var result) ||
            string.IsNullOrWhiteSpace(result))
        {
            throw new InvalidDataException(error);
        }

        return result;
    }

    private static bool ReadRequiredBoolean(
        JsonElement value,
        string propertyName,
        string error)
    {
        if (!value.TryGetProperty(propertyName, out var property) ||
            property.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException(error);
        }

        return property.GetBoolean();
    }

    private static string Normalize(string? value, int maximum, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length < 1 ||
            normalized.Length > maximum ||
            normalized.Any(character => character is '\r' or '\n' or '\0'))
        {
            throw new InvalidDataException($"{field} is invalid.");
        }
        return normalized;
    }

    private static string GenerateUnusablePassword()
    {
        var random = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        return "A!9z" + random;
    }
}
