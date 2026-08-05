from pathlib import Path

root = Path(__file__).resolve().parents[2]

bridge_path = root / 'src/Sirk.Portal/Agent/AgentInstallerEnrollmentBridge.cs'
bridge = bridge_path.read_text(encoding='utf-8-sig')
old = '''        if (context.Request.Path.Equals("/api/v1/agent/enroll"))
        {
            await InvokeCanonicalAsync(context);
            return;
        }

        if (context.Request.Path.Equals("/api/agent/v1/enroll"))
        {
            await InvokeSignedAgentV1Async(context);
            return;
        }
'''
new = '''        if (context.Request.Path.Equals("/api/v1/agent/enroll"))
        {
            await InvokeSignedAgentV1Async(context);
            return;
        }
'''
if bridge.count(old) != 1:
    raise RuntimeError(f'enrollment route block: expected one occurrence, found {bridge.count(old)}')
bridge = bridge.replace(old, new, 1)
start = bridge.index('    private async Task InvokeCanonicalAsync(HttpContext context)')
end = bridge.index('    private async Task InvokeSignedAgentV1Async(HttpContext context)', start)
bridge = bridge[:start] + bridge[end:]
if '/api/agent/v1/' in bridge:
    raise RuntimeError('legacy Agent enrollment route remains')
bridge_path.write_text(bridge, encoding='utf-8', newline='\n')

protocol_path = root / 'tests/Sirk.Portal.ProtocolTests/Program.cs'
protocol = protocol_path.read_text(encoding='utf-8-sig')
old_call = 'var compactLegacyMetadata = LegacyAgentCompatibilityEndpoints.Summarize(\n'
new_call = 'var compactAgentMetadata = AgentManagementV1Endpoints.Summarize(\n'
if protocol.count(old_call) != 1:
    raise RuntimeError(f'legacy protocol metadata call: expected one occurrence, found {protocol.count(old_call)}')
protocol = protocol.replace(old_call, new_call, 1)
protocol = protocol.replace('compactLegacyMetadata ==', 'compactAgentMetadata ==', 1)
protocol = protocol.replace('!compactLegacyMetadata.Any', '!compactAgentMetadata.Any', 1)
protocol = protocol.replace('Legacy Agent check-in metadata', 'Canonical Agent check-in metadata')
protocol_path.write_text(protocol, encoding='utf-8', newline='\n')

print('Installer enrollment bridge and protocol test use canonical Agent management v1.')
