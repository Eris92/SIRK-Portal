using System.Runtime.CompilerServices;
using Sirk.Portal.Agent;

internal static class AgentInstallerBuilderContract
{
    [ModuleInitializer]
    internal static void Run()
    {
        if (!OperatingSystem.IsWindows()) return;

        var ticket = "install-0123456789abcdef0123." +
                     "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        var package = AgentInstallerPackageBuilder.BuildAsync(
                "https://portal.test.local",
                "installer-group",
                ticket,
                "stable",
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        if (package.Content.Length < 4096 ||
            package.Content[0] != (byte)'M' ||
            package.Content[1] != (byte)'Z')
        {
            throw new InvalidOperationException(
                "Generated group-bound Agent package is not a valid Windows executable.");
        }
        if (package.FileName != "SIRK-Agent-installer-group-Installer.exe")
        {
            throw new InvalidOperationException(
                "Generated group-bound Agent package has an invalid file name.");
        }
    }
}
