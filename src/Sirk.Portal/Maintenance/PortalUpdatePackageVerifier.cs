using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sirk.Portal.Maintenance;

internal sealed record PortalPackageManifest(
    [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
    [property: JsonPropertyName("applicationId")] string ApplicationId,
    [property: JsonPropertyName("product")] string Product,
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("runtime")] string Runtime,
    [property: JsonPropertyName("files")] IReadOnlyList<PortalPackageManifestFile> Files,
    [property: JsonPropertyName("signature")] PortalUpdateSignature Signature);

internal sealed record PortalPackageManifestFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("size")] long Size,
    [property: JsonPropertyName("sha256")] string Sha256);

internal static class PortalUpdatePackageVerifier
{
    private const int MaximumFiles = 8192;
    private const long MaximumFileBytes = 256L * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static bool IsRequested(string[] args) =>
        args.Length > 0 &&
        string.Equals(args[0], "--verify-update-payload", StringComparison.Ordinal);

    public static Task<int> RunAsync(string[] args)
    {
        try
        {
            if (args.Length != 4 ||
                !string.Equals(args[0], "--verify-update-payload", StringComparison.Ordinal) ||
                !string.Equals(args[2], "--trusted-keys", StringComparison.Ordinal))
                throw new InvalidDataException(
                    "Usage: --verify-update-payload <payload-root> --trusted-keys <keyring.json>");

            Verify(Path.GetFullPath(args[1]), Path.GetFullPath(args[3]));
            Console.WriteLine("SIRK_PORTAL_UPDATE_PAYLOAD_VERIFIED");
            return Task.FromResult(0);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or JsonException or
            InvalidDataException or CryptographicException)
        {
            Console.Error.WriteLine(error.Message);
            return Task.FromResult(1);
        }
    }

    internal static void Verify(string payloadRoot, string keyringPath)
    {
        if (!Directory.Exists(payloadRoot))
            throw new DirectoryNotFoundException("Portal update payload root is missing.");
        var manifestPath = Path.Combine(payloadRoot, "update-manifest.json");
        if (!File.Exists(manifestPath))
            throw new InvalidDataException("Portal update-manifest.json is missing.");
        if (!File.Exists(keyringPath))
            throw new CryptographicException("Portal release trust keyring is missing.");

        var manifest = JsonSerializer.Deserialize<PortalPackageManifest>(
                           File.ReadAllBytes(manifestPath),
                           Json)
                       ?? throw new InvalidDataException("Portal update manifest is invalid.");
        var expectedRuntime = OperatingSystem.IsWindows()
            ? "win-x64"
            : OperatingSystem.IsLinux()
                ? "linux-x64"
                : throw new PlatformNotSupportedException(
                    "Portal update verification is supported only on Windows and Linux.");
        if (manifest.SchemaVersion != 1 ||
            manifest.ApplicationId != "sirk-portal" ||
            manifest.Product != "SIRK Portal" ||
            manifest.Runtime != expectedRuntime ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                manifest.Version,
                "^0\\.1\\.1\\.[0-9]+$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
            manifest.Files is null || manifest.Files.Count is <= 0 or > MaximumFiles ||
            manifest.Signature is null || manifest.Signature.Algorithm != "ES256")
            throw new InvalidDataException("Portal signed update manifest metadata is invalid.");

        VerifySignature(manifest, keyringPath);
        var root = Path.TrimEndingDirectorySeparator(payloadRoot);
        var prefix = root + Path.DirectorySeparatorChar;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            var relative = NormalizeRelativePath(file.Path);
            if (!seen.Add(relative) || file.Size < 0 || file.Size > MaximumFileBytes ||
                !IsSha256(file.Sha256))
                throw new InvalidDataException(
                    "Portal signed update manifest contains an invalid file entry.");
            var target = Path.GetFullPath(Path.Combine(
                root,
                relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(target))
                throw new InvalidDataException("Portal signed update file is missing: " + relative);
            var info = new FileInfo(target);
            if (info.Length != file.Size)
                throw new InvalidDataException("Portal signed update file size mismatch: " + relative);
            using var stream = File.OpenRead(target);
            var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (!string.Equals(actual, file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new CryptographicException("Portal signed update file hash mismatch: " + relative);
        }

        foreach (var required in RequiredFiles(expectedRuntime))
            if (!seen.Contains(required))
                throw new InvalidDataException(
                    "Portal signed update payload is missing required file: " + required);
    }

    private static void VerifySignature(PortalPackageManifest manifest, string keyringPath)
    {
        var keyring = JsonSerializer.Deserialize<PortalReleaseKeyDocument>(
                          File.ReadAllBytes(keyringPath),
                          Json)
                      ?? throw new CryptographicException("Portal release trust keyring is invalid.");
        if (keyring.Keys is null || keyring.Keys.Count is <= 0 or > 32)
            throw new CryptographicException("Portal release trust keyring has no usable keys.");
        var entry = keyring.Keys.SingleOrDefault(
                        item => item.KeyId == manifest.Signature.KeyId)
                    ?? throw new CryptographicException("Portal update signing key is not trusted.");
        using var key = ECDsa.Create();
        key.ImportFromPem(entry.PublicKeyPem);
        if (key.KeySize != 256)
            throw new CryptographicException("Portal update signing key must be P-256.");
        var supplied = DecodeBase64Url(manifest.Signature.Value);
        var canonical = CanonicalPortalUpdateJson.SerializeWithoutTopLevelSignature(manifest);
        try
        {
            if (supplied.Length != 64 ||
                !key.VerifyData(
                    canonical,
                    supplied,
                    HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
                throw new CryptographicException(
                    "Portal update manifest ES256 signature verification failed.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(supplied);
            CryptographicOperations.ZeroMemory(canonical);
        }
    }

    private static IReadOnlyList<string> RequiredFiles(string runtime) =>
        runtime == "win-x64"
            ? ["Sirk.Portal.exe", "Sirk.Portal.dll", "Sirk.Portal.runtimeconfig.json"]
            : ["Sirk.Portal", "Sirk.Portal.dll", "Sirk.Portal.runtimeconfig.json"];

    private static string NormalizeRelativePath(string value)
    {
        var path = (value ?? string.Empty).Replace('\\', '/');
        if (path.Length is <= 0 or > 512 ||
            path.StartsWith('/') || path.Contains(':') || Path.IsPathRooted(path) ||
            path.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(part => part == ".."))
            throw new InvalidDataException("Portal update manifest contains an unsafe path.");
        return path;
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(Uri.IsHexDigit);

    private static byte[] DecodeBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }
}
