using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sirk.Portal.Security;

namespace Sirk.Portal.Central;

internal sealed class PortalCentralIdentityMapper
{
    private static readonly object Sync = new();
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
            var snapshot = JsonSerializer.SerializeToElement(_identities.Snapshot());
            var existing = snapshot.GetProperty("users")
                .EnumerateArray()
                .FirstOrDefault(value => string.Equals(
                    value.GetProperty("userName").GetString(),
                    userName,
                    StringComparison.Ordinal));

            if (existing.ValueKind == JsonValueKind.Undefined)
            {
                return _identities.CreateUser(
                    userName,
                    normalizedDisplayName,
                    GenerateUnusablePassword(),
                    role);
            }

            var id = existing.GetProperty("id").GetString()
                     ?? throw new InvalidDataException("Mapped Central identity has no ID.");
            var currentRole = existing.GetProperty("role").GetString() ?? string.Empty;
            var currentDisplayName = existing.GetProperty("displayName").GetString() ?? string.Empty;
            var enabled = existing.GetProperty("enabled").GetBoolean();
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
                   ?? throw new InvalidDataException("Mapped Central identity could not be loaded.");
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

    private static string Normalize(string? value, int maximum, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is < 1 or > maximum ||
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
