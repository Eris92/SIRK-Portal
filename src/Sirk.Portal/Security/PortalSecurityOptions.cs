namespace Sirk.Portal.Security;

internal sealed class PortalSecurityOptions
{
    public const string SectionName = "Sirk:Security";

    public bool Enabled { get; init; } = true;
    public int SessionMinutes { get; init; } = 30;
    public int LoginAttemptsPerFiveMinutes { get; init; } = 8;
    public string BootstrapUserName { get; init; } = "admin";
    public string BootstrapDisplayName { get; init; } = "Administrator";
    public string BootstrapPasswordFile { get; init; } = string.Empty;
    public string BootstrapAccessCodeFile { get; init; } = string.Empty;
}

internal static class PortalRoles
{
    public const string BreakGlass = "Break-Glass";
    public const string SecAdmin = "SecAdmin";
    public const string Admin = "Admin";
    public const string Auditor = "Auditor";
    public const string OperatorL1 = "Operator L1";
    public const string SupportL2 = "Support L2";
    public const string EngineerL3 = "Engineer L3";

    public static readonly IReadOnlyList<string> All =
    [
        BreakGlass,
        SecAdmin,
        Admin,
        Auditor,
        OperatorL1,
        SupportL2,
        EngineerL3
    ];
}

internal static class PortalPolicies
{
    public const string PortalAdministration = "Sirk.Portal.Administration";
    public const string SecurityAdministration = "Sirk.Portal.SecurityAdministration";
    public const string DeviceRead = "Sirk.Portal.DeviceRead";
    public const string DeviceOperate = "Sirk.Portal.DeviceOperate";
    public const string AuditRead = "Sirk.Portal.AuditRead";
}

internal static class PortalAuthenticationSchemes
{
    public const string Session = "Sirk.Portal.Session";
}

internal static class PortalEndpointNames
{
    public const string LoginRateLimit = "Sirk.Portal.Login";
}
