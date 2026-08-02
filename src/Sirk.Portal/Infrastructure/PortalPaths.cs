namespace Sirk.Portal.Infrastructure;

internal sealed class PortalPaths
{
    public PortalPaths(IConfiguration configuration)
    {
        DataRoot = AtomicJsonFile.ResolveDataRoot(configuration);
        Directory.CreateDirectory(DataRoot);
        AtomicJsonFile.SecureDirectory(DataRoot);

        IdentityFile = Path.Combine(DataRoot, "identity.json");
        SettingsFile = Path.Combine(DataRoot, "settings.json");
        AgentsFile = Path.Combine(DataRoot, "agents.json");
        CommandsFile = Path.Combine(DataRoot, "agent-commands.json");
        PoliciesFile = Path.Combine(DataRoot, "agent-policies.json");
        AuditFile = Path.Combine(DataRoot, "audit.jsonl");
        DataProtectionDirectory = Path.Combine(DataRoot, "data-protection");
        Directory.CreateDirectory(DataProtectionDirectory);
        AtomicJsonFile.SecureDirectory(DataProtectionDirectory);
    }

    public string DataRoot { get; }
    public string IdentityFile { get; }
    public string SettingsFile { get; }
    public string AgentsFile { get; }
    public string CommandsFile { get; }
    public string PoliciesFile { get; }
    public string AuditFile { get; }
    public string DataProtectionDirectory { get; }
}
