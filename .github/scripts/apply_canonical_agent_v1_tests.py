from pathlib import Path

root = Path(__file__).resolve().parents[2]

native_path = root / '.github/scripts/test-dotnet10-native-api.py'
native = native_path.read_text(encoding='utf-8-sig')

# Remove the obsolete HMAC Agent helper layer from the general Portal API smoke.
start = native.index('def b64url(value: bytes) -> str:')
end = native.index('\n\nclass Client:', start)
native = native[:start] + native[end + 2:]
start = native.index('def signed_agent_headers(')
end = native.index('\n\ndef main() -> int:', start)
native = native[:start] + native[end + 2:]

for unused_import in (
    'import base64\n',
    'import hashlib\n',
    'import hmac\n',
    'import secrets\n',
    'import urllib.parse\n',
):
    native = native.replace(unused_import, '')

block_start = native.index('            group_result, _, _ = client.request(')
block_end = native.index('            bootstrap, _, _ = client.request("GET", "/api/v1/bootstrap")', block_start)
replacement = '''            group_result, _, _ = client.request(
                "POST",
                "/api/v1/admin/agent-groups",
                {
                    "action": "create",
                    "id": "test-group",
                    "name": "Test Group",
                    "description": "Native API acceptance group",
                    "portalOrigin": "https://portal.example",
                    "interactive": False,
                },
            )
            enrollment_token = group_result["credential"]["enrollmentToken"]
            if not enrollment_token or "SIRK Agent" not in group_result["bootstrapScript"]:
                raise RuntimeError("Agent group credential or bootstrap script is missing.")

            updated_policy, _, _ = client.request(
                "PUT",
                "/api/v1/admin/agent-policies",
                {
                    "scopeType": "group",
                    "scopeId": "test-group",
                    "policy": {"remoteDesktopEnabled": True},
                },
            )
            if updated_policy.get("value", {}).get("version") != 1:
                raise RuntimeError("Agent policy revision was not created.")
            listed_policies, _, _ = client.request(
                "GET", "/api/v1/admin/agent-policies"
            )
            matching = [
                value
                for value in listed_policies.get("value", [])
                if value.get("scopeType") == "group"
                and value.get("scopeId") == "test-group"
            ]
            if len(matching) != 1 or matching[0].get("policy", {}).get(
                "remoteDesktopEnabled"
            ) is not True:
                raise RuntimeError("Agent policy administration is invalid.")

            client.request(
                "DELETE", "/api/v1/admin/agent-policies/group/test-group"
            )
            policies_after_delete, _, _ = client.request(
                "GET", "/api/v1/admin/agent-policies"
            )
            if any(
                value.get("scopeType") == "group"
                and value.get("scopeId") == "test-group"
                for value in policies_after_delete.get("value", [])
            ):
                raise RuntimeError("Deleted Agent policy is still listed.")

'''
native = native[:block_start] + replacement + native[block_end:]

old_actions = '''            required_actions = {
                "authentication.login",
                "agent.enroll",
                "agent.command.queue",
                "agent.command.complete",
            }
'''
new_actions = '''            required_actions = {
                "authentication.login",
                "agent-group.create",
                "agent.policy.update",
                "agent.policy.delete",
            }
'''
if native.count(old_actions) != 1:
    raise RuntimeError(f'audit actions block: expected one occurrence, found {native.count(old_actions)}')
native = native.replace(old_actions, new_actions, 1)

for forbidden in (
    'signed_agent_headers',
    'verify_agent_response',
    '/api/v1/agent/heartbeat',
    '/api/v1/agent/policy',
    '/api/v1/agent/commands',
):
    if forbidden in native:
        raise RuntimeError(f'obsolete HMAC Agent smoke remains: {forbidden}')
native_path.write_text(native, encoding='utf-8', newline='\n')

validate_path = root / '.github/scripts/validate-node-free-dotnet10.sh'
validate = validate_path.read_text(encoding='utf-8-sig')
old_call = 'python3 .github/scripts/test-dotnet10-agent-v1-compat.py "$portal_dll"'
new_call = 'python3 .github/scripts/test-dotnet10-agent-v1.py "$portal_dll"'
if validate.count(old_call) != 1:
    raise RuntimeError(f'canonical Agent smoke invocation: expected one occurrence, found {validate.count(old_call)}')
validate = validate.replace(old_call, new_call, 1)
validate_path.write_text(validate, encoding='utf-8', newline='\n')

legacy_path = root / '.github/scripts/test-dotnet10-agent-v1-compat.py'
if not legacy_path.is_file():
    raise RuntimeError('legacy Agent compatibility smoke file was not found')
legacy_path.unlink()

for path in (root / '.github/scripts').glob('*'):
    if not path.is_file() or path.suffix not in {'.py', '.sh'}:
        continue
    content = path.read_text(encoding='utf-8', errors='replace')
    if '/api/agent/v1/' in content:
        raise RuntimeError(f'legacy Agent route remains in test source: {path.name}')

print('Portal tests now use only canonical ECDSA Agent management v1.')
