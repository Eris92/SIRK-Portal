using System.Buffers;
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
