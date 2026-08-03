namespace Sirk.Portal.Security;

internal static class PortalPermissions
{
    private static readonly IReadOnlyDictionary<string, string[]> ByRole =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            [PortalRoles.BreakGlass] = ["*"],
            [PortalRoles.SecAdmin] =
            [
                "security.manage",
                "users.manage",
                "devices.read",
                "devices.operate",
                "agents.manage",
                "settings.read",
                "audit.read"
            ],
            [PortalRoles.Admin] =
            [
                "users.manage",
                "devices.read",
                "devices.operate",
                "agents.manage",
                "settings.read",
                "settings.manage",
                "updates.manage",
                "backup.manage"
            ],
            [PortalRoles.Auditor] =
            [
                "devices.read",
                "settings.read",
                "audit.read"
            ],
            [PortalRoles.OperatorL1] =
            [
                "devices.read",
                "devices.basic"
            ],
            [PortalRoles.SupportL2] =
            [
                "devices.read",
                "devices.basic",
                "devices.operate"
            ],
            [PortalRoles.EngineerL3] =
            [
                "devices.read",
                "devices.basic",
                "devices.operate",
                "agents.manage"
            ]
        };

    public static IReadOnlyList<string> ForRole(string role) =>
        ByRole.TryGetValue(role, out var permissions) ? permissions : [];

    public static bool Has(string role, string permission)
    {
        var permissions = ForRole(role);
        return permissions.Contains("*", StringComparer.Ordinal) ||
               permissions.Contains(permission, StringComparer.Ordinal);
    }
}
