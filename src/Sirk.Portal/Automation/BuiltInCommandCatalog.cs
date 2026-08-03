namespace Sirk.Portal.Automation;

internal sealed record BuiltInCommandVariable(
    string Name,
    string Label,
    bool Required,
    string Control,
    string DefaultValue,
    IReadOnlyList<ScriptVariableOption> Options);

internal sealed record BuiltInCommand(
    string Id,
    string Label,
    string Description,
    string Shell,
    string Command,
    int RunAsUser,
    bool ConfirmExecution,
    IReadOnlyList<int> ApprovalLevels,
    IReadOnlyList<BuiltInCommandVariable> Variables);

internal sealed record BuiltInCommandCategory(
    string Key,
    string Title,
    string Icon,
    IReadOnlyList<BuiltInCommand> Commands);

internal static class BuiltInCommandCatalog
{
    public static IReadOnlyList<BuiltInCommandCategory> All { get; } =
    [
        new(
            "network",
            "Network",
            "network",
            [
                Command("flushdns", "Flush DNS", "Clear the DNS client cache.", "cmd", "ipconfig /flushdns"),
                Command(
                    "dns",
                    "Check DNS",
                    "Resolve a DNS name.",
                    "powershell",
                    "Resolve-DnsName -Name $name | Format-Table -AutoSize",
                    variables:
                    [
                        Variable("name", "DNS name", required: true)
                    ]),
                Command(
                    "port",
                    "Check port",
                    "Test a TCP port.",
                    "powershell",
                    "Test-NetConnection -ComputerName $hostName -Port ([int]$port) -InformationLevel Detailed",
                    variables:
                    [
                        Variable("hostName", "Host name or IP", required: true),
                        Variable("port", "Port", required: true, defaultValue: "443")
                    ]),
                Command("netstat", "Open ports", "Show listening ports and active connections.", "cmd", "netstat -ano"),
                Command(
                    "netstat-port",
                    "Filter by port",
                    "Filter netstat output by port.",
                    "cmd",
                    "netstat -ano | findstr /R /C:\":%port%[ ]\"",
                    variables:
                    [
                        Variable("port", "Port", required: true, defaultValue: "443")
                    ])
            ]),
        new(
            "system",
            "System",
            "system",
            [
                Command("powershell", "Open PowerShell", "Open PowerShell for the interactive user.", "cmd", "start \"\" powershell.exe -NoExit", runAsUser: 2),
                Command("cmd", "Open CMD", "Open Command Prompt for the interactive user.", "cmd", "start \"\" cmd.exe", runAsUser: 2),
                Command("regedit", "Registry Editor", "Open Registry Editor.", "cmd", "start \"\" regedit.exe", runAsUser: 2, confirm: true),
                Command("secpol", "Local Security Policy", "Open secpol.msc.", "cmd", "start \"\" secpol.msc", runAsUser: 2),
                Command("firewall", "Windows Firewall", "Open Windows Firewall management.", "cmd", "start \"\" mmc.exe wf.msc", runAsUser: 2),
                Command("mmc", "MMC", "Open Microsoft Management Console.", "cmd", "start \"\" mmc.exe", runAsUser: 2),
                Command("services", "Services", "Open Services management.", "cmd", "start \"\" mmc.exe services.msc", runAsUser: 2),
                Command("devices", "Device Manager", "Open Device Manager.", "cmd", "start \"\" mmc.exe devmgmt.msc", runAsUser: 2),
                Command("events", "Event Viewer", "Open Event Viewer.", "cmd", "start \"\" mmc.exe eventvwr.msc", runAsUser: 2),
                Command("taskmgr", "Task Manager", "Open Task Manager.", "cmd", "start \"\" taskmgr.exe", runAsUser: 2)
            ]),
        new(
            "other",
            "Other",
            "other",
            [
                Command("printers", "Printer Management", "Open printer management.", "cmd", "start \"\" printmanagement.msc", runAsUser: 2),
                Command("certlm", "Certificates (computer)", "Open local computer certificates.", "cmd", "start \"\" certlm.msc", runAsUser: 2),
                Command("certcu", "Certificates (user)", "Open current user certificates.", "cmd", "start \"\" certmgr.msc", runAsUser: 2),
                Command("indexing", "Indexing Options", "Open Indexing Options.", "cmd", "start \"\" control.exe /name Microsoft.IndexingOptions", runAsUser: 2),
                Command("cleanup", "Disk Cleanup", "Open Disk Cleanup.", "cmd", "start \"\" cleanmgr.exe", runAsUser: 2)
            ])
    ];

    public static BuiltInCommand? Find(string? id) =>
        All.SelectMany(category => category.Commands)
            .FirstOrDefault(command => string.Equals(command.Id, id, StringComparison.Ordinal));

    private static BuiltInCommand Command(
        string id,
        string label,
        string description,
        string shell,
        string command,
        int runAsUser = 0,
        bool confirm = false,
        IReadOnlyList<int>? approvalLevels = null,
        IReadOnlyList<BuiltInCommandVariable>? variables = null) =>
        new(
            id,
            label,
            description,
            shell,
            command,
            runAsUser,
            confirm,
            approvalLevels ?? [1],
            variables ?? []);

    private static BuiltInCommandVariable Variable(
        string name,
        string label,
        bool required = false,
        string control = "text",
        string defaultValue = "",
        IReadOnlyList<ScriptVariableOption>? options = null) =>
        new(name, label, required, control, defaultValue, options ?? []);
}
