namespace Sirk.Portal.ProtocolTests;

internal static class CanonicalAgentManagementV1Contract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var program = Read(root, "src", "Sirk.Portal", "Program.cs");
        var endpoints = Read(root, "src", "Sirk.Portal", "Agent", "AgentManagementV1Endpoints.cs");
        var policies = Read(root, "src", "Sirk.Portal", "Agent", "AgentPolicyStore.cs");
        var signer = Read(root, "src", "Sirk.Portal", "Agent", "AgentPolicySigner.cs");
        var workspace = Read(root, "public", "portal", "standalone", "scripts", "device-workspace.js");

        Require(program.Contains("MapAgentManagementV1", StringComparison.Ordinal),
            "Canonical Agent management endpoint is not mapped.");
        Require(!program.Contains("MapLegacyAgentCompatibility", StringComparison.Ordinal),
            "Legacy Agent compatibility endpoint is still mapped.");
        Require(endpoints.Contains("/api/v1/agent/checkin", StringComparison.Ordinal) &&
                endpoints.Contains("/api/v1/agent/rotate-key", StringComparison.Ordinal) &&
                endpoints.Contains("/api/v1/agent/desktop/stream", StringComparison.Ordinal) &&
                endpoints.Contains("/api/v1/agent/desktop/control", StringComparison.Ordinal),
            "Canonical Agent v1 routes are incomplete.");
        Require(!Directory.EnumerateFiles(Path.Combine(root, "src"), "*.cs", SearchOption.AllDirectories)
                .Select(File.ReadAllText)
                .Any(value => value.Contains("/api/agent/v1/", StringComparison.Ordinal)),
            "Legacy /api/agent/v1 route remains in Portal source.");
        Require(policies.Contains("Revision", StringComparison.Ordinal) &&
                policies.Contains("EffectiveForDelivery", StringComparison.Ordinal),
            "Policy anti-rollback revision is missing.");
        Require(policies.Contains("remoteDesktopEnabled = false", StringComparison.Ordinal) &&
                policies.Contains("remoteTerminalEnabled = false", StringComparison.Ordinal) &&
                policies.Contains("remoteFilesEnabled = false", StringComparison.Ordinal),
            "Restrictive default Agent policy is missing.");
        Require(signer.Contains("ES256", StringComparison.Ordinal) &&
                signer.Contains("IDataProtector", StringComparison.Ordinal) &&
                signer.Contains("IeeeP1363FixedFieldConcatenation", StringComparison.Ordinal),
            "Protected ES256 policy signer is incomplete.");
        Require(endpoints.Contains("policySigner.Sign(", StringComparison.Ordinal) &&
                endpoints.Contains("trustedPolicyKeys = new[] { policySigner.TrustedKey() }", StringComparison.Ordinal),
            "Authenticated Agent check-in does not deliver the signed policy and trust anchor.");
        Require(workspace.Contains("Agent odrzucił pobranie sesji", StringComparison.Ordinal) &&
                workspace.Contains("scheduleReconnect", StringComparison.Ordinal) &&
                workspace.Contains("/api/v1/admin/agent-policies", StringComparison.Ordinal) &&
                workspace.Contains("sirk-agent-policy-action", StringComparison.Ordinal),
            "The standard Desktop must fail closed, retry safely and expose the canonical administrator policy action.");
    }

    private static string Read(string root, params string[] values) =>
        File.ReadAllText(values.Aggregate(root, Path.Combine));

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj")))
                return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
