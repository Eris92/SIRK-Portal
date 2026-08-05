from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8", newline="\n")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}")
    return value.replace(old, new, 1)


# PortalPaths: persistent Data Protection-encrypted policy signing key.
paths_path = "src/Sirk.Portal/Infrastructure/PortalPaths.cs"
paths = read(paths_path)
paths = replace_once(
    paths,
    '        PoliciesFile = Path.Combine(DataRoot, "agent-policies.json");\n',
    '        PoliciesFile = Path.Combine(DataRoot, "agent-policies.json");\n'
    '        AgentPolicySigningKeyFile = Path.Combine(DataRoot, "agent-policy-signing-key.json");\n',
    "policy signing key path",
)
paths = replace_once(
    paths,
    '    public string PoliciesFile { get; }\n',
    '    public string PoliciesFile { get; }\n'
    '    public string AgentPolicySigningKeyFile { get; }\n',
    "policy signing key property",
)
write(paths_path, paths)

# Signed policy envelope generator. The private key is protected by ASP.NET Data Protection.
signer = r'''using System.Buffers;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Agent;

internal sealed record AgentTrustedPolicyKey(string KeyId, string PublicKeyPem);
internal sealed record AgentSignedPolicy(string PolicyId, JsonElement Envelope);
internal sealed record AgentPolicySigningKeyDocument(
    int SchemaVersion,
    string KeyId,
    long Epoch,
    string ProtectedPrivateKey,
    string PublicKeyPem,
    DateTimeOffset CreatedAtUtc);

internal sealed class AgentPolicySigner
{
    private const int SchemaVersion = 1;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object _sync = new();
    private readonly string _path;
    private readonly IDataProtector _protector;
    private AgentPolicySigningKeyDocument _document;

    public AgentPolicySigner(PortalPaths paths, IDataProtectionProvider protection)
    {
        _path = paths.AgentPolicySigningKeyFile;
        _protector = protection.CreateProtector("SIRK.Portal.AgentPolicySigningKey.v1");
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<AgentPolicySigningKeyDocument>(_path))
            : Create();
    }

    public AgentTrustedPolicyKey TrustedKey()
    {
        lock (_sync)
            return new AgentTrustedPolicyKey(_document.KeyId, _document.PublicKeyPem);
    }

    public AgentSignedPolicy Sign(
        string tenantId,
        string deviceId,
        long version,
        JsonElement settings)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tenantId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        if (version < 1) throw new ArgumentOutOfRangeException(nameof(version));
        if (settings.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Effective Agent policy settings must be a JSON object.");

        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            var policyId = $"portal:{deviceId}:{_document.Epoch}:{version}";
            var nonce = Base64Url(RandomNumberGenerator.GetBytes(24));
            var unsigned = Envelope(
                tenantId,
                deviceId,
                policyId,
                version,
                _document.Epoch,
                now.AddMinutes(-1),
                now.AddDays(3650),
                nonce,
                settings,
                "pending");
            var canonical = CanonicalWithoutSignature(unsigned);
            byte[] privateKey = [];
            byte[] signature = [];
            try
            {
                privateKey = Convert.FromBase64String(
                    _protector.Unprotect(_document.ProtectedPrivateKey));
                using var key = ECDsa.Create();
                key.ImportPkcs8PrivateKey(privateKey, out _);
                signature = key.SignData(
                    canonical,
                    HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
                return new AgentSignedPolicy(
                    policyId,
                    Envelope(
                        tenantId,
                        deviceId,
                        policyId,
                        version,
                        _document.Epoch,
                        now.AddMinutes(-1),
                        now.AddDays(3650),
                        nonce,
                        settings,
                        Base64Url(signature)));
            }
            finally
            {
                CryptographicOperations.ZeroMemory(privateKey);
                CryptographicOperations.ZeroMemory(signature);
                CryptographicOperations.ZeroMemory(canonical);
            }
        }
    }

    private AgentPolicySigningKeyDocument Create()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var privateKey = key.ExportPkcs8PrivateKey();
        try
        {
            var publicKey = key.ExportSubjectPublicKeyInfo();
            var keyId = "portal-policy-" + Convert.ToHexString(
                SHA256.HashData(publicKey))[..16].ToLowerInvariant();
            var document = new AgentPolicySigningKeyDocument(
                SchemaVersion,
                keyId,
                1,
                _protector.Protect(Convert.ToBase64String(privateKey)),
                key.ExportSubjectPublicKeyInfoPem(),
                DateTimeOffset.UtcNow);
            AtomicJsonFile.Write(_path, document);
            return document;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(privateKey);
        }
    }

    private static AgentPolicySigningKeyDocument Validate(AgentPolicySigningKeyDocument value)
    {
        if (value.SchemaVersion != SchemaVersion ||
            string.IsNullOrWhiteSpace(value.KeyId) ||
            value.Epoch < 1 ||
            string.IsNullOrWhiteSpace(value.ProtectedPrivateKey) ||
            string.IsNullOrWhiteSpace(value.PublicKeyPem))
        {
            throw new InvalidDataException("Agent policy signing key document is invalid.");
        }
        using var key = ECDsa.Create();
        key.ImportFromPem(value.PublicKeyPem);
        if (key.KeySize != 256)
            throw new InvalidDataException("Agent policy signing key must use ECDSA P-256.");
        return value;
    }

    private JsonElement Envelope(
        string tenantId,
        string deviceId,
        string policyId,
        long version,
        long epoch,
        DateTimeOffset notBeforeUtc,
        DateTimeOffset expiresAtUtc,
        string nonce,
        JsonElement settings,
        string signature)
    {
        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["tenantId"] = tenantId,
            ["deviceId"] = deviceId,
            ["policyId"] = policyId,
            ["caseId"] = null,
            ["authorization"] = null,
            ["version"] = version,
            ["epoch"] = epoch,
            ["notBeforeUtc"] = notBeforeUtc,
            ["expiresAtUtc"] = expiresAtUtc,
            ["nonce"] = nonce,
            ["mode"] = "Normal",
            ["settings"] = settings,
            ["signature"] = new
            {
                algorithm = "ES256",
                keyId = _document.KeyId,
                value = signature
            }
        }, Json);
    }

    private static byte[] CanonicalWithoutSignature(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Canonical signed payload must be an object.", nameof(root));
        var buffer = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false });
        writer.WriteStartObject();
        foreach (var property in root.EnumerateObject()
                     .Where(value => !string.Equals(value.Name, "signature", StringComparison.Ordinal))
                     .OrderBy(value => value.Name, StringComparer.Ordinal))
        {
            writer.WritePropertyName(property.Name);
            WriteElement(property.Value, writer);
        }
        writer.WriteEndObject();
        writer.Flush();
        return buffer.WrittenSpan.ToArray();
    }

    private static void WriteElement(JsonElement value, Utf8JsonWriter writer)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
            {
                writer.WritePropertyName(property.Name);
                WriteElement(property.Value, writer);
            }
            writer.WriteEndObject();
            return;
        }
        if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray()) WriteElement(item, writer);
            writer.WriteEndArray();
            return;
        }
        value.WriteTo(writer);
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
'''
write("src/Sirk.Portal/Agent/AgentPolicySigner.cs", signer)

# Policy store: a global monotonic revision feeds the Agent anti-rollback version.
policy_path = "src/Sirk.Portal/Agent/AgentPolicyStore.cs"
policy = read(policy_path)
policy = replace_once(
    policy,
    'internal sealed record AgentPolicyDocument(\n    int SchemaVersion,\n    IReadOnlyList<AgentPolicyRecord> Policies,\n    DateTimeOffset UpdatedAtUtc);\n',
    'internal sealed record AgentPolicyDocument(\n    int SchemaVersion,\n    long Revision,\n    IReadOnlyList<AgentPolicyRecord> Policies,\n    DateTimeOffset UpdatedAtUtc);\n\n'
    'internal sealed record AgentEffectivePolicy(long Revision, JsonElement Policy);\n',
    "policy revision document",
)
policy = replace_once(
    policy,
    ': new AgentPolicyDocument(SchemaVersion, [], DateTimeOffset.UtcNow);',
    ': new AgentPolicyDocument(SchemaVersion, 0, [], DateTimeOffset.UtcNow);',
    "empty policy document",
)
policy = replace_once(
    policy,
    '            Save(new AgentPolicyDocument(SchemaVersion, policies, now));\n',
    '            Save(new AgentPolicyDocument(\n'
    '                SchemaVersion, checked(_document.Revision + 1), policies, now));\n',
    "policy update revision",
)
policy = replace_once(
    policy,
    '                version = $"{group?.Version ?? 0}.{direct?.Version ?? 0}",\n',
    '                version = _document.Revision.ToString(\n'
    '                    System.Globalization.CultureInfo.InvariantCulture),\n',
    "effective policy version",
)
insert = '''\n    public AgentEffectivePolicy? EffectiveForDelivery(AgentDeviceRecord device)\n    {\n        lock (_sync)\n        {\n            var group = _document.Policies.FirstOrDefault(value =>\n                value.ScopeType == "group" && value.ScopeId == device.GroupId);\n            var direct = _document.Policies.FirstOrDefault(value =>\n                value.ScopeType == "device" && value.ScopeId == device.Id);\n            if (group is null && direct is null) return null;\n            return new AgentEffectivePolicy(\n                Math.Max(1, _document.Revision),\n                Merge(group?.Policy, direct?.Policy));\n        }\n    }\n\n'''
policy = replace_once(
    policy,
    '    public IReadOnlyList<AgentPolicyRecord> List()\n',
    insert + '    public IReadOnlyList<AgentPolicyRecord> List()\n',
    "effective delivery policy",
)
policy = replace_once(
    policy,
    '            Save(new AgentPolicyDocument(\n                SchemaVersion,\n                _document.Policies.Where(value =>\n                    value.ScopeType != normalizedType || value.ScopeId != normalizedId).ToArray(),\n                DateTimeOffset.UtcNow));\n',
    '            Save(new AgentPolicyDocument(\n'
    '                SchemaVersion,\n'
    '                checked(_document.Revision + 1),\n'
    '                _document.Policies.Where(value =>\n'
    '                    value.ScopeType != normalizedType || value.ScopeId != normalizedId).ToArray(),\n'
    '                DateTimeOffset.UtcNow));\n',
    "policy delete revision",
)
policy = replace_once(
    policy,
    '        return value;\n    }\n\n    private static JsonElement Merge',
    '        if (value.Revision < 0)\n'
    '            throw new InvalidDataException("Agent policy revision is invalid.");\n'
    '        var revision = value.Revision == 0 && value.Policies.Count > 0\n'
    '            ? Math.Max(1, value.Policies.Max(item => item.Version))\n'
    '            : value.Revision;\n'
    '        return value with { Revision = revision };\n'
    '    }\n\n    private static JsonElement Merge',
    "policy revision validation",
)
write(policy_path, policy)

# Convert the existing ECDSA compatibility implementation into the sole canonical v1 management endpoint.
legacy_path = ROOT / "src/Sirk.Portal/Agent/LegacyAgentCompatibilityEndpoints.cs"
management = legacy_path.read_text(encoding="utf-8-sig")
renames = {
    "LegacyAgentEnrollmentRequest": "AgentV1EnrollmentRequest",
    "LegacyAgentCheckInRequest": "AgentV1CheckInRequest",
    "LegacyAgentCommandResult": "AgentV1CommandResult",
    "LegacyDesktopControlRequest": "AgentV1DesktopControlRequest",
    "LegacyAgentCompatibilityEndpoints": "AgentManagementV1Endpoints",
    "MapLegacyAgentCompatibility": "MapAgentManagementV1",
    "LegacyDesktopStreamAsync": "AgentDesktopStreamAsync",
    "LegacyDesktopControlAsync": "AgentDesktopControlAsync",
    "LegacyCommandType": "AgentCommandType",
    "legacyResult": "canonicalResult",
    "legacyType": "canonicalType",
}
for old, new in renames.items():
    management = management.replace(old, new)
management = management.replace('/api/agent/v1/', '/api/v1/agent/')
management = replace_once(
    management,
    '        PortalAuditLog audit)\n',
    '        PortalAuditLog audit,\n        AgentPolicySigner policySigner)\n',
    "enrollment signer dependency",
)
management = replace_once(
    management,
    '                    checkInEndpoint = "/api/v1/agent/checkin",\n                    enrolledAtUtc = issued.Device.EnrolledAtUtc,\n                    trustedPolicyKeys = Array.Empty<object>()\n',
    '                    checkInEndpoint = "/api/v1/agent/checkin",\n'
    '                    enrolledAtUtc = issued.Device.EnrolledAtUtc,\n'
    '                    trustedPolicyKeys = new[] { policySigner.TrustedKey() }\n',
    "enrollment trusted policy key",
)
management = replace_once(
    management,
    '        AgentStore agents,\n        AgentCommandStore commands)\n',
    '        AgentStore agents,\n'
    '        AgentCommandStore commands,\n'
    '        AgentPolicyStore policies,\n'
    '        AgentPolicySigner policySigner)\n',
    "checkin policy dependencies",
)
old_response = '''            return Results.Ok(new\n            {\n                ok = true,\n                policies = Array.Empty<object>(),\n                commands = delivered\n            });'''
new_response = '''            var effective = policies.EffectiveForDelivery(device);\n            var deliveredPolicies = Array.Empty<JsonElement>();\n            if (effective is not null)\n            {\n                var signed = policySigner.Sign(\n                    device.TenantId, device.Id, effective.Revision, effective.Policy);\n                if (!(request.AcknowledgedPolicyIds ?? []).Contains(\n                        signed.PolicyId, StringComparer.Ordinal))\n                    deliveredPolicies = [signed.Envelope];\n            }\n\n            return Results.Ok(new\n            {\n                ok = true,\n                protocolVersion = 1,\n                trustedPolicyKeys = new[] { policySigner.TrustedKey() },\n                policies = deliveredPolicies,\n                commands = delivered\n            });'''
management = replace_once(management, old_response, new_response, "signed policy checkin response")
management = management.replace("legacy", "compatibility")
write("src/Sirk.Portal/Agent/AgentManagementV1Endpoints.cs", management)
legacy_path.unlink()

# Remove the unused HMAC Agent-facing route surface; admin/viewer routes remain.
endpoints_path = "src/Sirk.Portal/Agent/AgentEndpoints.cs"
endpoints = read(endpoints_path)
agent_route_block = '''        endpoints.MapPost("/api/v1/agent/enroll", EnrollAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapPost("/api/v1/agent/heartbeat", HeartbeatAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapGet("/api/v1/agent/commands", PollCommandsAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapPost("/api/v1/agent/commands/results", CompleteCommandAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapGet("/api/v1/agent/policy", GetPolicyAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n        endpoints.MapGet("/api/v1/agent/desktop/stream", AgentDesktopAsync)\n            .AllowAnonymous()\n            .DisableAntiforgery();\n\n'''
endpoints = replace_once(endpoints, agent_route_block, "", "remove HMAC Agent routes")
write(endpoints_path, endpoints)

# DI and endpoint mapping.
program_path = "src/Sirk.Portal/Program.cs"
program = read(program_path)
program = replace_once(
    program,
    'builder.Services.AddSingleton<AgentPolicyStore>();\n',
    'builder.Services.AddSingleton<AgentPolicyStore>();\n'
    'builder.Services.AddSingleton<AgentPolicySigner>();\n',
    "policy signer registration",
)
program = replace_once(
    program,
    '_ = app.Services.GetRequiredService<AgentPolicyStore>();\n',
    '_ = app.Services.GetRequiredService<AgentPolicyStore>();\n'
    '_ = app.Services.GetRequiredService<AgentPolicySigner>();\n',
    "policy signer startup validation",
)
program = replace_once(
    program,
    'app.MapAgentEndpoints();\napp.MapLegacyAgentCompatibility();\n',
    'app.MapAgentEndpoints();\napp.MapAgentManagementV1();\n',
    "canonical Agent management mapping",
)
write(program_path, program)

# Frontend: surface the actual policy rejection and provide an explicit admin action.
workspace_path = "public/portal/standalone/scripts/device-workspace.js"
workspace = read(workspace_path)
workspace = replace_once(
    workspace,
    '<pre data-agent-operation-status>Gotowy do natychmiastowego połączenia.</pre></div>\';\n',
    '<div class="sirk-agent-policy-action" data-agent-policy-action hidden><button type="button" data-agent-policy-enable>Włącz zdalny pulpit dla urządzenia</button></div><pre data-agent-operation-status>Gotowy do natychmiastowego połączenia.</pre></div>\';\n',
    "desktop policy action markup",
)
workspace = replace_once(
    workspace,
    '        var adminStart = host.querySelector("[data-agent-admin-start]");\n',
    '        var adminStart = host.querySelector("[data-agent-admin-start]");\n'
    '        var policyAction = host.querySelector("[data-agent-policy-action]");\n'
    '        var policyEnable = host.querySelector("[data-agent-policy-enable]");\n',
    "desktop policy controls",
)
old_sessions = '''        function loadSessions() {\n            return runAgentOperation(node, "desktop.sessions", {}, status).then(function (value) {\n                var sessions = value.result && value.result.data || [];\n                session.innerHTML = "";\n                sessions.forEach(function (item) {\n                    var option = document.createElement("option");\n                    option.value = String(item.sessionId);\n                    option.textContent = "Sesja " + item.sessionId + (item.active ? " · aktywna" : "");\n                    session.appendChild(option);\n                });\n                if (!sessions.length) throw new Error("Brak aktywnego brokera sesji użytkownika.");\n                return loadMonitors();\n            });\n        }'''
new_sessions = '''        function loadSessions() {\n            return runAgentOperation(node, "desktop.sessions", {}, status).then(function (value) {\n                var result = value.result || {};\n                if (value.status === "failed") {\n                    var code = String(result.code || "");\n                    var message = String(result.output || code || "Agent odrzucił pobranie sesji.");\n                    policyAction.hidden = code !== "OPERATION_NOT_ALLOWED";\n                    throw new Error(message);\n                }\n                policyAction.hidden = true;\n                var sessions = result.data || [];\n                session.innerHTML = "";\n                sessions.forEach(function (item) {\n                    var option = document.createElement("option");\n                    option.value = String(item.sessionId);\n                    option.textContent = "Sesja " + item.sessionId + (item.active ? " · aktywna" : "");\n                    session.appendChild(option);\n                });\n                if (!sessions.length) throw new Error("Agent nie zgłosił aktywnej sesji użytkownika.");\n                return loadMonitors();\n            });\n        }\n        policyEnable.addEventListener("click", function () {\n            var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;\n            var csrfToken = runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";\n            policyEnable.disabled = true;\n            status.textContent = "Zapisywanie podpisanej polityki zdalnego pulpitu…";\n            status.classList.remove("is-error");\n            fetch(portalHttpUrl("/api/v1/admin/agent-policies"), {\n                method: "PUT",\n                credentials: "same-origin",\n                headers: { "Content-Type": "application/json", "X-SIRK-CSRF": csrfToken },\n                body: JSON.stringify({\n                    scopeType: "device",\n                    scopeId: node.deviceId,\n                    policy: { remoteDesktopEnabled: true }\n                })\n            }).then(function (response) {\n                return response.json().then(function (value) {\n                    if (!response.ok || value.ok === false)\n                        throw new Error(value.error || value.title || "Nie udało się zapisać polityki.");\n                    return value;\n                });\n            }).then(function () {\n                status.textContent = "Polityka zapisana. Oczekiwanie na podpisany check-in Agenta…";\n                policyAction.hidden = true;\n                setTimeout(function retryPolicy() {\n                    loadSessions().catch(function (error) {\n                        status.textContent = error.message || String(error);\n                        status.classList.add("is-error");\n                    });\n                }, 3000);\n            }).catch(function (error) {\n                status.textContent = error.message || String(error);\n                status.classList.add("is-error");\n            }).then(function () { policyEnable.disabled = false; });\n        });'''
workspace = replace_once(workspace, old_sessions, new_sessions, "desktop policy error and enable flow")
write(workspace_path, workspace)

# Protocol contract.
contract = r'''namespace Sirk.Portal.ProtocolTests;

internal static class CanonicalAgentManagementV1Contract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var program = Read(root, "src", "Sirk.Portal", "Program.cs");
        var endpoints = Read(root, "src", "Sirk.Portal", "Agent", "AgentManagementV1Endpoints.cs");
        var policies = Read(root, "src", "Sirk.Portal", "Agent", "AgentPolicyStore.cs");
        var signer = Read(root, "src", "Sirk.Portal", "Agent", "AgentPolicySigner.cs");
        var workspace = Read(root, "public", "portal", "standalone", "scripts", "device-workspace.js");

        Require(program.Contains("MapAgentManagementV1", StringComparison.Ordinal),
            "Canonical Agent management endpoint is not mapped.");
        Require(!program.Contains("MapLegacyAgentCompatibility", StringComparison.Ordinal),
            "Legacy Agent compatibility endpoint is still mapped.");
        Require(endpoints.Contains("/api/v1/agent/checkin", StringComparison.Ordinal) &&
                endpoints.Contains("/api/v1/agent/desktop/stream", StringComparison.Ordinal) &&
                endpoints.Contains("/api/v1/agent/desktop/control", StringComparison.Ordinal),
            "Canonical Agent v1 routes are incomplete.");
        Require(!Directory.EnumerateFiles(Path.Combine(root, "src"), "*.cs", SearchOption.AllDirectories)
                .Select(File.ReadAllText)
                .Any(value => value.Contains("/api/agent/v1/", StringComparison.Ordinal)),
            "Legacy /api/agent/v1 route remains in Portal source.");
        Require(policies.Contains("Revision", StringComparison.Ordinal) &&
                policies.Contains("EffectiveForDelivery", StringComparison.Ordinal),
            "Policy anti-rollback revision is missing.");
        Require(signer.Contains("ES256", StringComparison.Ordinal) &&
                signer.Contains("IDataProtector", StringComparison.Ordinal) &&
                signer.Contains("IeeeP1363FixedFieldConcatenation", StringComparison.Ordinal),
            "Protected ES256 policy signer is incomplete.");
        Require(workspace.Contains("OPERATION_NOT_ALLOWED", StringComparison.Ordinal) &&
                workspace.Contains("/api/v1/admin/agent-policies", StringComparison.Ordinal),
            "Desktop workspace does not surface or remediate policy rejection.");
    }

    private static string Read(string root, params string[] values) =>
        File.ReadAllText(values.Aggregate(root, Path.Combine));

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
'''
write("tests/Sirk.Portal.ProtocolTests/CanonicalAgentManagementV1Contract.cs", contract)
protocol_path = "tests/Sirk.Portal.ProtocolTests/Program.cs"
protocol = read(protocol_path)
protocol = replace_once(
    protocol,
    'CanonicalDesktopTransportContract.Run();\n',
    'CanonicalDesktopTransportContract.Run();\nCanonicalAgentManagementV1Contract.Run();\n',
    "canonical Agent management contract invocation",
)
write(protocol_path, protocol)

# Product source must no longer contain the old route.
for path in (ROOT / "src").rglob("*.cs"):
    if "/api/agent/v1/" in path.read_text(encoding="utf-8-sig"):
        raise RuntimeError(f"legacy Agent route remains: {path.relative_to(ROOT)}")

print("Canonical Agent management v1 applied to Portal.")
