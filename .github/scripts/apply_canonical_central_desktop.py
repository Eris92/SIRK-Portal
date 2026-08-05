from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8", newline="\n")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}")
    return value.replace(old, new, 1)


agent_path = "src/Sirk.Portal/Agent/AgentEndpoints.cs"
agent = read(agent_path)
agent = replace_once(
    agent,
    "internal sealed record AgentDeviceAdminRequest(\n    string Action,\n    string DeviceId,\n    string? GroupId,\n    string? Name,\n    bool? Enabled);\n",
    "internal sealed record AgentDeviceAdminRequest(\n    string Action,\n    string DeviceId,\n    string? GroupId,\n    string? Name,\n    bool? Enabled);\n\ninternal sealed record DesktopInputRequest(\n    string? TenantId,\n    string DeviceId,\n    JsonElement Input);\n",
    "canonical desktop input contract",
)
agent = replace_once(
    agent,
    "        endpoints.MapGet(\"/api/v1/desktop/status/{deviceId}\", (\n                string deviceId,\n                DesktopRelayHub desktop) => Results.Ok(desktop.Status(deviceId)))\n            .RequireAuthorization(PortalPolicies.DeviceRead);\n\n        return endpoints;",
    "        endpoints.MapGet(\"/api/v1/desktop/status/{deviceId}\", (\n                string deviceId,\n                DesktopRelayHub desktop) => Results.Ok(desktop.Status(deviceId)))\n            .RequireAuthorization(PortalPolicies.DeviceRead);\n        endpoints.MapGet(\"/api/v1/desktop/frame\", ViewerDesktopFrameAsync)\n            .RequireAuthorization(PortalPolicies.DeviceOperate);\n        endpoints.MapPost(\"/api/v1/desktop/input\", ViewerDesktopInputAsync)\n            .RequireAuthorization(PortalPolicies.DeviceOperate);\n\n        return endpoints;",
    "canonical desktop endpoint mappings",
)
canonical_methods = r'''
    private static async Task<IResult> ViewerDesktopFrameAsync(
        HttpContext context,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        var deviceId = context.Request.Query["deviceId"].ToString().Trim().ToLowerInvariant();
        var device = agents.GetDevice(deviceId);
        if (device is not { Enabled: true })
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", "Device was not found.");

        var after = long.TryParse(context.Request.Query["after"], out var parsedAfter)
            ? Math.Max(0, parsedAfter)
            : 0;
        var wait = int.TryParse(context.Request.Query["waitMilliseconds"], out var parsedWait)
            ? Math.Clamp(parsedWait, 0, 25_000)
            : 0;
        var frame = await desktop.WaitForFrameAsync(
            device.Id,
            after,
            TimeSpan.FromMilliseconds(wait),
            context.RequestAborted);
        if (frame is null) return Results.NoContent();

        context.Response.Headers["X-SIRK-Sequence"] = frame.Sequence.ToString(
            System.Globalization.CultureInfo.InvariantCulture);
        context.Response.Headers["X-SIRK-Metadata"] = frame.MetadataBase64;
        context.Response.Headers.CacheControl = "no-store";
        return Results.Bytes(frame.Payload, frame.ContentType);
    }

    private static async Task<IResult> ViewerDesktopInputAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        AgentStore agents,
        DesktopRelayHub desktop)
    {
        if (context.Items["Sirk.InternalTunnel"] is not true)
        {
            var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
            if (csrf is not null) return csrf;
        }

        try
        {
            var request = await context.Request.ReadFromJsonAsync<DesktopInputRequest>(
                              cancellationToken: context.RequestAborted)
                          ?? throw new InvalidDataException("Desktop input is required.");
            var device = agents.GetDevice(request.DeviceId)
                         ?? throw new KeyNotFoundException("Device was not found.");
            if (!string.IsNullOrWhiteSpace(request.TenantId) &&
                !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal))
            {
                throw new InvalidDataException("Agent tenant does not match the device.");
            }

            var message = JsonSerializer.Serialize(new
            {
                type = "input",
                id = 0,
                input = request.Input
            }, JsonOptions);
            var delivery = await desktop.SendOrQueueInputAsync(
                device.Id,
                message,
                context.RequestAborted);
            return Results.Ok(new { ok = true, delivery });
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "AGENT_NOT_FOUND", exception.Message);
        }
        catch (Exception exception) when (exception is InvalidDataException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "DESKTOP_INPUT_INVALID", exception.Message);
        }
    }

'''
agent = replace_once(
    agent,
    "    private static IResult SignedJson(\n",
    canonical_methods + "    private static IResult SignedJson(\n",
    "canonical desktop endpoint implementations",
)
write(agent_path, agent)

compat_path = "src/Sirk.Portal/Ui/PortalUiCompatibilityEndpoints.cs"
compat = read(compat_path)
compat = replace_once(
    compat,
    "internal sealed record LegacyDesktopInputRequest(\n    string? TenantId,\n    string DeviceId,\n    JsonElement Input);\n",
    "",
    "legacy desktop input contract removal",
)
compat = replace_once(
    compat,
    "        endpoints.MapGet(\"/api/agent-desktop/frame\", LegacyDesktopFrameAsync)\n            .RequireAuthorization(PortalPolicies.DeviceOperate);\n        endpoints.MapPost(\"/api/agent-desktop/input\", LegacyDesktopInputAsync)\n            .RequireAuthorization(PortalPolicies.DeviceOperate);\n",
    "",
    "legacy desktop mappings removal",
)
compat, count = re.subn(
    r"\n    private static async Task<IResult> LegacyDesktopFrameAsync\([\s\S]*?\n    private static string CanonicalOperationType",
    "\n    private static string CanonicalOperationType",
    compat,
    count=1,
)
if count != 1:
    raise RuntimeError(f"legacy desktop implementation removal: expected one block, found {count}")
if "/api/agent-desktop/" in compat:
    raise RuntimeError("legacy desktop compatibility route remains")
write(compat_path, compat)

tunnel_path = "src/Sirk.Portal/Central/CentralTunnelService.cs"
tunnel = read(tunnel_path)
tunnel = replace_once(
    tunnel,
    "            AddResponseHeader(localResponse, headers, \"last-modified\");\n            return new CentralTunnelResponseInput(",
    "            AddResponseHeader(localResponse, headers, \"last-modified\");\n            AddResponseHeader(localResponse, headers, \"x-sirk-sequence\");\n            AddResponseHeader(localResponse, headers, \"x-sirk-metadata\");\n            return new CentralTunnelResponseInput(",
    "desktop metadata relay headers",
)
write(tunnel_path, tunnel)

workspace_path = "public/portal/standalone/scripts/device-workspace.js"
workspace = read(workspace_path)
for old, new, label in [
    ("/api/agent-desktop/input", "/api/v1/desktop/input", "canonical desktop input URL"),
    ("/api/agent-desktop/frame", "/api/v1/desktop/frame", "canonical desktop frame URL"),
    ("Połączono · strumień bezpośredni · ", "Połączono · tunel Central HTTP · ", "tunnel status label"),
]:
    workspace = replace_once(workspace, old, new, label)
if "/api/agent-desktop/" in workspace:
    raise RuntimeError("frontend still references legacy desktop compatibility routes")
write(workspace_path, workspace)

contract_path = ROOT / "tests/Sirk.Portal.ProtocolTests/CanonicalDesktopTransportContract.cs"
contract_path.write_text(
    '''namespace Sirk.Portal.ProtocolTests;\n\ninternal static class CanonicalDesktopTransportContract\n{\n    public static void Run()\n    {\n        var root = FindRepositoryRoot();\n        var agent = File.ReadAllText(Path.Combine(root, \"src\", \"Sirk.Portal\", \"Agent\", \"AgentEndpoints.cs\"));\n        var compatibility = File.ReadAllText(Path.Combine(root, \"src\", \"Sirk.Portal\", \"Ui\", \"PortalUiCompatibilityEndpoints.cs\"));\n        var tunnel = File.ReadAllText(Path.Combine(root, \"src\", \"Sirk.Portal\", \"Central\", \"CentralTunnelService.cs\"));\n        var workspace = File.ReadAllText(Path.Combine(root, \"public\", \"portal\", \"standalone\", \"scripts\", \"device-workspace.js\"));\n\n        Require(agent.Contains(\"/api/v1/desktop/frame\", StringComparison.Ordinal),\n            \"Canonical desktop frame endpoint is missing.\");\n        Require(agent.Contains(\"/api/v1/desktop/input\", StringComparison.Ordinal),\n            \"Canonical desktop input endpoint is missing.\");\n        Require(!compatibility.Contains(\"/api/agent-desktop/\", StringComparison.Ordinal),\n            \"Legacy desktop compatibility endpoints must not be mapped.\");\n        Require(workspace.Contains(\"/api/v1/desktop/frame\", StringComparison.Ordinal) &&\n                workspace.Contains(\"/api/v1/desktop/input\", StringComparison.Ordinal),\n            \"Desktop workspace must use canonical v1 endpoints.\");\n        Require(!workspace.Contains(\"/api/agent-desktop/\", StringComparison.Ordinal),\n            \"Desktop workspace still references legacy compatibility endpoints.\");\n        Require(tunnel.Contains(\"AddResponseHeader(localResponse, headers, \\\"x-sirk-sequence\\\")\", StringComparison.Ordinal) &&\n                tunnel.Contains(\"AddResponseHeader(localResponse, headers, \\\"x-sirk-metadata\\\")\", StringComparison.Ordinal),\n            \"Central tunnel must preserve desktop sequence and metadata headers.\");\n    }\n\n    private static string FindRepositoryRoot()\n    {\n        var current = new DirectoryInfo(Directory.GetCurrentDirectory());\n        while (current is not null)\n        {\n            if (File.Exists(Path.Combine(current.FullName, \"src\", \"Sirk.Portal\", \"Sirk.Portal.csproj\")))\n                return current.FullName;\n            current = current.Parent;\n        }\n        throw new DirectoryNotFoundException(\"SIRK Portal repository root was not found.\");\n    }\n\n    private static void Require(bool condition, string message)\n    {\n        if (!condition) throw new InvalidOperationException(message);\n    }\n}\n''',
    encoding="utf-8",
    newline="\n",
)

program_path = "tests/Sirk.Portal.ProtocolTests/Program.cs"
program = read(program_path)
program = replace_once(
    program,
    "using Microsoft.Extensions.Configuration;\n\nconst string portalId",
    "using Microsoft.Extensions.Configuration;\nusing Sirk.Portal.ProtocolTests;\n\nCanonicalDesktopTransportContract.Run();\n\nconst string portalId",
    "canonical transport test invocation",
)
write(program_path, program)

for relative in [agent_path, compat_path, tunnel_path, workspace_path, program_path]:
    if not (ROOT / relative).is_file():
        raise RuntimeError(f"missing modified file: {relative}")

print("Canonical Central desktop transport applied.")
