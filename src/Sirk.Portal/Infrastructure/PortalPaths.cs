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
        AgentInstallerTicketsFile = Path.Combine(DataRoot, "agent-installer-tickets.json");
        AgentCommandsFile = Path.Combine(DataRoot, "agent-commands.json");
        PoliciesFile = Path.Combine(DataRoot, "agent-policies.json");
        AuditFile = Path.Combine(DataRoot, "audit.jsonl");

        FilesDirectory = Path.Combine(DataRoot, "Files");
        CommandsDirectory = Path.Combine(FilesDirectory, "commands");
        ManagementDirectory = Path.Combine(FilesDirectory, "management");
        foreach (var directory in new[] { FilesDirectory, CommandsDirectory, ManagementDirectory })
        {
            Directory.CreateDirectory(directory);
            AtomicJsonFile.SecureDirectory(directory);
        }

        DataProtectionDirectory = Path.Combine(DataRoot, "data-protection");
        Directory.CreateDirectory(DataProtectionDirectory);
        AtomicJsonFile.SecureDirectory(DataProtectionDirectory);
    }

    public string DataRoot { get; }
    public string IdentityFile { get; }
    public string SettingsFile { get; }
    public string AgentsFile { get; }
    public string AgentInstallerTicketsFile { get; }
    public string AgentCommandsFile { get; }
    public string PoliciesFile { get; }
    public string AuditFile { get; }
    public string FilesDirectory { get; }
    public string CommandsDirectory { get; }
    public string ManagementDirectory { get; }
    public string DataProtectionDirectory { get; }
}
