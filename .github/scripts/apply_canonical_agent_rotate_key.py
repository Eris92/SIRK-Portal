from pathlib import Path

root = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (root / path).read_text(encoding='utf-8-sig')


def write(path: str, value: str) -> None:
    (root / path).write_text(value, encoding='utf-8', newline='\n')


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one occurrence, found {count}')
    return value.replace(old, new, 1)

store_path = 'src/Sirk.Portal/Agent/AgentStore.cs'
store = read(store_path)
method = '''    public AgentDeviceRecord RotateDevicePublicKey(string deviceId, string publicKeySpki)\n    {\n        var normalized = NormalizeId(deviceId, "Device ID");\n        if (string.IsNullOrWhiteSpace(publicKeySpki) || publicKeySpki.Length > 1024)\n            throw new InvalidDataException("Agent public key is invalid.");\n\n        lock (_sync)\n        {\n            var devices = _document.Devices.ToArray();\n            var index = Array.FindIndex(devices, value => value.Id == normalized);\n            if (index < 0) throw new KeyNotFoundException("Device was not found.");\n            var current = devices[index];\n            if (!current.Enabled) throw new UnauthorizedAccessException("Device is disabled.");\n            var metadata = new Dictionary<string, string>(current.Metadata, StringComparer.Ordinal)\n            {\n                ["publicKeySpki"] = publicKeySpki,\n                ["protocol"] = "agent-v1-ecdsa"\n            };\n            var now = DateTimeOffset.UtcNow;\n            devices[index] = current with\n            {\n                Metadata = NormalizeMetadata(metadata),\n                UpdatedAtUtc = now\n            };\n            Save(_document with { Devices = devices, UpdatedAtUtc = now });\n            return devices[index];\n        }\n    }\n\n'''
store = replace_once(store, '    public AgentDeviceRecord UpdateDevice(\n', method + '    public AgentDeviceRecord UpdateDevice(\n', 'AgentStore key rotation')
write(store_path, store)

endpoint_path = 'src/Sirk.Portal/Agent/AgentManagementV1Endpoints.cs'
endpoint = read(endpoint_path)
endpoint = replace_once(
    endpoint,
    '''internal sealed record AgentV1DesktopControlRequest(\n    string TenantId,\n    string DeviceId,\n    int? WaitMilliseconds);\n''',
    '''internal sealed record AgentV1DesktopControlRequest(\n    string TenantId,\n    string DeviceId,\n    int? WaitMilliseconds);\n\ninternal sealed record AgentV1RotateKeyRequest(\n    string TenantId,\n    string DeviceId,\n    string PublicKeySpki);\n''',
    'rotate key request')
endpoint = replace_once(
    endpoint,
    '''        endpoints.MapPost("/api/v1/agent/checkin", CheckInAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n''',
    '''        endpoints.MapPost("/api/v1/agent/checkin", CheckInAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapPost("/api/v1/agent/rotate-key", RotateKeyAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n''',
    'rotate key mapping')
rotate_method = '''\n    private static async Task<IResult> RotateKeyAsync(\n        HttpContext context,\n        AgentStore agents,\n        PortalAuditLog audit)\n    {\n        var body = await ReadBodyAsync(context.Request, 64 * 1024, context.RequestAborted);\n        AgentV1RotateKeyRequest request;\n        try\n        {\n            request = Deserialize<AgentV1RotateKeyRequest>(body);\n            ValidatePublicKey(request.PublicKeySpki);\n        }\n        catch (Exception exception) when (\n            exception is InvalidDataException or JsonException or CryptographicException)\n        {\n            return PortalAuthenticationEndpoints.Error(400, "AGENT_ROTATE_KEY_INVALID", exception.Message);\n        }\n\n        var device = agents.GetDevice(request.DeviceId);\n        if (device is not { Enabled: true } ||\n            !string.Equals(device.TenantId, request.TenantId, StringComparison.Ordinal) ||\n            !Authenticate(context.Request, body, device, agents))\n        {\n            return Unauthorized("AGENT_AUTHENTICATION_FAILED", "Agent authentication failed.");\n        }\n\n        try\n        {\n            var updated = agents.RotateDevicePublicKey(device.Id, request.PublicKeySpki);\n            audit.Write(new PortalAuditEvent(\n                updated.Id,\n                updated.Name,\n                "agent.rotate-key.v1",\n                "device",\n                updated.Id,\n                true,\n                PortalAuthenticationEndpoints.RemoteAddress(context),\n                context.TraceIdentifier,\n                new Dictionary<string, string>\n                {\n                    ["tenantId"] = updated.TenantId,\n                    ["protocol"] = "agent-v1-ecdsa"\n                }));\n            return Results.Ok(new\n            {\n                ok = true,\n                tenantId = updated.TenantId,\n                deviceId = updated.Id,\n                rotatedAtUtc = updated.UpdatedAtUtc\n            });\n        }\n        catch (Exception exception) when (\n            exception is KeyNotFoundException or UnauthorizedAccessException or InvalidDataException)\n        {\n            return PortalAuthenticationEndpoints.Error(400, "AGENT_ROTATE_KEY_FAILED", exception.Message);\n        }\n    }\n\n'''
endpoint = replace_once(endpoint, '\n\n    private static async Task AgentDesktopStreamAsync(\n', '\n' + rotate_method + '    private static async Task AgentDesktopStreamAsync(\n', 'rotate key implementation')
write(endpoint_path, endpoint)

contract_path = 'tests/Sirk.Portal.ProtocolTests/CanonicalAgentManagementV1Contract.cs'
contract = read(contract_path)
contract = replace_once(
    contract,
    '''        Require(endpoints.Contains("/api/v1/agent/checkin", StringComparison.Ordinal) &&\n                endpoints.Contains("/api/v1/agent/desktop/stream", StringComparison.Ordinal) &&\n''',
    '''        Require(endpoints.Contains("/api/v1/agent/checkin", StringComparison.Ordinal) &&\n                endpoints.Contains("/api/v1/agent/rotate-key", StringComparison.Ordinal) &&\n                endpoints.Contains("/api/v1/agent/desktop/stream", StringComparison.Ordinal) &&\n''',
    'rotate key protocol contract')
write(contract_path, contract)

print('Canonical ECDSA device key rotation applied to Portal.')
