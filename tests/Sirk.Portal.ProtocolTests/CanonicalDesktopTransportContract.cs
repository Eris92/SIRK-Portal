namespace Sirk.Portal.ProtocolTests;

internal static class CanonicalDesktopTransportContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var agent = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Agent", "AgentEndpoints.cs"));
        var compatibility = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Ui", "PortalUiCompatibilityEndpoints.cs"));
        var tunnel = File.ReadAllText(Path.Combine(root, "src", "Sirk.Portal", "Central", "CentralTunnelService.cs"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));

        Require(agent.Contains("/api/v1/desktop/frame", StringComparison.Ordinal),
            "Canonical desktop frame endpoint is missing.");
        Require(agent.Contains("/api/v1/desktop/input", StringComparison.Ordinal),
            "Canonical desktop input endpoint is missing.");
        Require(!compatibility.Contains("/api/agent-desktop/", StringComparison.Ordinal),
            "Legacy desktop compatibility endpoints must not be mapped.");
        Require(workspace.Contains("/api/v1/desktop/frame", StringComparison.Ordinal) &&
                workspace.Contains("/api/v1/desktop/input", StringComparison.Ordinal),
            "Desktop workspace must use canonical v1 endpoints.");
        Require(!workspace.Contains("/api/agent-desktop/", StringComparison.Ordinal),
            "Desktop workspace still references legacy compatibility endpoints.");
        Require(tunnel.Contains("AddResponseHeader(localResponse, headers, \"x-sirk-sequence\")", StringComparison.Ordinal) &&
                tunnel.Contains("AddResponseHeader(localResponse, headers, \"x-sirk-metadata\")", StringComparison.Ordinal),
            "Central tunnel must preserve desktop sequence and metadata headers.");
    }

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
