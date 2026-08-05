from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'src/Sirk.Portal/Agent/AgentPolicyStore.cs'
text = path.read_text(encoding='utf-8-sig')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one occurrence, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    ': new AgentPolicyDocument(SchemaVersion, 0, [], DateTimeOffset.UtcNow);',
    ': new AgentPolicyDocument(SchemaVersion, 1, [], DateTimeOffset.UtcNow);',
    'initial policy revision')

old_effective = '''            var group = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "group" && value.ScopeId == device.GroupId);
            var direct = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "device" && value.ScopeId == device.Id);
            if (group is null && direct is null) return null;
            return new AgentEffectivePolicy(
                Math.Max(1, _document.Revision),
                Merge(group?.Policy, direct?.Policy));
'''
new_effective = '''            var group = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "group" && value.ScopeId == device.GroupId);
            var direct = _document.Policies.FirstOrDefault(value =>
                value.ScopeType == "device" && value.ScopeId == device.Id);
            var restricted = JsonSerializer.SerializeToElement(new
            {
                remoteDesktopEnabled = false,
                remoteAdministrativeDesktopEnabled = false,
                remoteTerminalEnabled = false,
                remoteFilesEnabled = false
            });
            var effective = Merge(restricted, group?.Policy);
            effective = Merge(effective, direct?.Policy);
            return new AgentEffectivePolicy(
                Math.Max(1, _document.Revision),
                effective);
'''
replace_once(old_effective, new_effective, 'restrictive effective policy')

old_revision = '''        var revision = value.Revision == 0 && value.Policies.Count > 0
            ? Math.Max(1, value.Policies.Max(item => item.Version))
            : value.Revision;
'''
new_revision = '''        var revision = value.Revision <= 0
            ? value.Policies.Count > 0
                ? Math.Max(1, value.Policies.Max(item => item.Version))
                : 1
            : value.Revision;
'''
replace_once(old_revision, new_revision, 'migrated policy revision')

path.write_text(text, encoding='utf-8', newline='\n')

contract_path = root / 'tests/Sirk.Portal.ProtocolTests/CanonicalAgentManagementV1Contract.cs'
contract = contract_path.read_text(encoding='utf-8-sig')
old = '''        Require(policies.Contains("Revision", StringComparison.Ordinal) &&
                policies.Contains("EffectiveForDelivery", StringComparison.Ordinal),
            "Policy anti-rollback revision is missing.");
'''
new = '''        Require(policies.Contains("Revision", StringComparison.Ordinal) &&
                policies.Contains("EffectiveForDelivery", StringComparison.Ordinal),
            "Policy anti-rollback revision is missing.");
        Require(policies.Contains("remoteDesktopEnabled = false", StringComparison.Ordinal) &&
                policies.Contains("remoteTerminalEnabled = false", StringComparison.Ordinal) &&
                policies.Contains("remoteFilesEnabled = false", StringComparison.Ordinal),
            "Restrictive default Agent policy is missing.");
'''
if contract.count(old) != 1:
    raise RuntimeError(f'policy contract block: expected one occurrence, found {contract.count(old)}')
contract = contract.replace(old, new, 1)
contract_path.write_text(contract, encoding='utf-8', newline='\n')

print('Restrictive default Agent policy and monotonic baseline revision applied.')
