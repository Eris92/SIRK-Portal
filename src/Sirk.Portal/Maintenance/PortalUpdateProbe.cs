using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Sirk.Portal.Central;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Maintenance;

internal sealed record PortalUpdateProbeResult(
    string AvailableVersion,
    string? InstalledCommit,
    string? RemoteCommit,
    bool UpdateAvailable,
    string? Error,
    DateTimeOffset CheckedAtUtc);

internal sealed record PreparedPortalUpdate(
    string Version,
    string Commit,
    string Sha256,
    long Size,
    string PackagePath);

internal sealed record PortalUpdateOffer(
    string ApplicationId,
    string Version,
    string Runtime,
    string Channel,
    long Size,
    string Sha256,
    PortalReleaseDescriptor Descriptor,
    string PackagePath);

internal sealed record PortalReleaseDescriptor(
    [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
    [property: JsonPropertyName("applicationId")] string ApplicationId,
    [property: JsonPropertyName("product")] string Product,
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("runtime")] string Runtime,
    [property: JsonPropertyName("channel")] string Channel,
    [property: JsonPropertyName("assetName")] string AssetName,
    [property: JsonPropertyName("size")] long Size,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("commit")] string Commit,
    [property: JsonPropertyName("publishedAtUtc")] DateTimeOffset PublishedAtUtc,
    [property: JsonPropertyName("signature")] PortalUpdateSignature Signature);

internal sealed record PortalUpdateSignature(
    [property: JsonPropertyName("algorithm")] string Algorithm,
    [property: JsonPropertyName("keyId")] string KeyId,
    [property: JsonPropertyName("value")] string Value);

internal sealed record PortalReleaseKeyDocument(
    [property: JsonPropertyName("keys")] IReadOnlyList<PortalReleaseKeyEntry> Keys);

internal sealed record PortalReleaseKeyEntry(
    [property: JsonPropertyName("keyId")] string KeyId,
    [property: JsonPropertyName("publicKeyPem")] string PublicKeyPem);

internal sealed class PortalUpdateClient
{
    private const long MaximumPackageBytes = 256L * 1024 * 1024;
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(1);
    private static readonly Regex VersionPattern = new(
        "^0\\.1\\.1\\.[0-9]+$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object _sync = new();
    private readonly CentralConnectionResolver _resolver;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PortalPaths _paths;
    private PortalUpdateProbeResult? _cachedProbe;
    private PortalUpdateOffer? _cachedOffer;

    public PortalUpdateClient(
        CentralConnectionResolver resolver,
        IHttpClientFactory httpClientFactory,
        PortalPaths paths)
    {
        _resolver = resolver;
        _httpClientFactory = httpClientFactory;
        _paths = paths;
    }

    public PortalUpdateProbeResult Probe(bool force = false)
    {
        if (!force)
        {
            lock (_sync)
            {
                if (_cachedProbe is not null &&
                    DateTimeOffset.UtcNow - _cachedProbe.CheckedAtUtc < CacheLifetime)
                    return _cachedProbe;
            }
        }

        var installedCommit = ReadInstalledCommit();
        try
        {
            var currentVersion = CurrentVersion();
            var target = PlatformTarget()
                         ?? throw new PlatformNotSupportedException(
                             "Portal updates are supported only on Windows x64 and Linux x64.");
            var (connection, baseUri) = ResolveCentral();
            var channel = NormalizeChannel(connection.UpdateChannel);
            var offer = FetchOfferAsync(
                    connection,
                    baseUri,
                    target,
                    channel,
                    currentVersion,
                    CancellationToken.None)
                .GetAwaiter()
                .GetResult();
            var result = offer is null
                ? new PortalUpdateProbeResult(
                    currentVersion,
                    installedCommit,
                    installedCommit,
                    false,
                    null,
                    DateTimeOffset.UtcNow)
                : new PortalUpdateProbeResult(
                    offer.Version,
                    installedCommit,
                    offer.Descriptor.Commit,
                    true,
                    null,
                    DateTimeOffset.UtcNow);
            lock (_sync)
            {
                _cachedOffer = offer;
                _cachedProbe = result;
            }
            return result;
        }
        catch (Exception error) when (
            error is HttpRequestException or TaskCanceledException or JsonException or
            InvalidDataException or IOException or CryptographicException or
            PlatformNotSupportedException or InvalidOperationException)
        {
            var result = new PortalUpdateProbeResult(
                CurrentVersionOrUnknown(),
                installedCommit,
                null,
                false,
                error.Message,
                DateTimeOffset.UtcNow);
            lock (_sync)
            {
                _cachedOffer = null;
                _cachedProbe = result;
            }
            return result;
        }
    }

    public PreparedPortalUpdate PrepareUpdate()
    {
        var probe = Probe(force: true);
        if (probe.Error is not null)
            throw new InvalidOperationException(
                "Unable to confirm a Portal update: " + probe.Error);
        if (!probe.UpdateAvailable)
            throw new InvalidOperationException("Portal is already current.");

        PortalUpdateOffer offer;
        lock (_sync)
            offer = _cachedOffer
                    ?? throw new InvalidOperationException(
                        "Central did not return a verified Portal update offer.");
        var target = PlatformTarget()
                     ?? throw new PlatformNotSupportedException(
                         "Portal updates are supported only on Windows x64 and Linux x64.");
        var (connection, baseUri) = ResolveCentral();
        var channel = NormalizeChannel(connection.UpdateChannel);
        if (offer.Runtime != target || offer.Channel != channel)
            throw new InvalidDataException("Cached Portal update scope changed.");

        var pendingRoot = Path.Combine(_paths.DataRoot, "Updates", "Pending");
        Directory.CreateDirectory(pendingRoot);
        AtomicJsonFile.SecureDirectory(pendingRoot);
        var final = Path.Combine(
            pendingRoot,
            offer.Version + "-" + offer.Sha256[..12].ToLowerInvariant() + ".zip");
        if (File.Exists(final))
        {
            VerifyPackageFile(final, offer.Size, offer.Sha256);
            return new PreparedPortalUpdate(
                offer.Version,
                offer.Descriptor.Commit,
                offer.Sha256,
                offer.Size,
                final);
        }

        var temporary = final + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            DownloadPackageAsync(
                    connection,
                    baseUri,
                    offer,
                    channel,
                    temporary,
                    CancellationToken.None)
                .GetAwaiter()
                .GetResult();
            VerifyPackageFile(temporary, offer.Size, offer.Sha256);
            File.Move(temporary, final, overwrite: false);
            AtomicJsonFile.SecureFile(final);
            return new PreparedPortalUpdate(
                offer.Version,
                offer.Descriptor.Commit,
                offer.Sha256,
                offer.Size,
                final);
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    internal static string? ReadInstalledCommit()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "release-manifest.json");
        if (!File.Exists(path)) return null;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            var applicationId = RequiredString(root, "applicationId");
            var commit = RequiredCommit(root, "commit");
            return applicationId == "sirk-portal" ? commit : null;
        }
        catch (Exception error) when (
            error is JsonException or InvalidDataException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task<PortalUpdateOffer?> FetchOfferAsync(
        CentralConnectionOptions connection,
        Uri baseUri,
        string runtime,
        string channel,
        string currentVersion,
        CancellationToken cancellationToken)
    {
        var uri = new Uri(
            baseUri,
            "/api/portal/v1/update/products/sirk-portal/latest" +
            $"?runtime={Uri.EscapeDataString(runtime)}" +
            $"&channel={Uri.EscapeDataString(channel)}" +
            $"&currentVersion={Uri.EscapeDataString(currentVersion)}");
        using var request = AuthenticatedGet(uri, connection);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(connection.RequestTimeoutSeconds, 5, 30)));
        using var response = await _httpClientFactory.CreateClient("SirkCentral").SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            timeout.Token);
        if (response.StatusCode == System.Net.HttpStatusCode.NoContent) return null;
        response.EnsureSuccessStatusCode();
        var bytes = await ReadBoundedAsync(response.Content, 256 * 1024, timeout.Token);
        var offer = JsonSerializer.Deserialize<PortalUpdateOffer>(bytes, Json)
                    ?? throw new InvalidDataException(
                        "Central Portal update response is invalid.");
        ValidateOffer(offer, runtime, channel, currentVersion);
        VerifyDescriptorSignature(offer.Descriptor);
        return offer;
    }

    private async Task DownloadPackageAsync(
        CentralConnectionOptions connection,
        Uri baseUri,
        PortalUpdateOffer offer,
        string channel,
        string destination,
        CancellationToken cancellationToken)
    {
        if (!offer.PackagePath.StartsWith(
                "/api/portal/v1/update/products/sirk-portal/",
                StringComparison.Ordinal) ||
            offer.PackagePath.Contains("..", StringComparison.Ordinal) ||
            offer.PackagePath.Contains('\\'))
            throw new InvalidDataException("Central Portal package path is invalid.");
        var uri = new Uri(
            baseUri,
            offer.PackagePath +
            $"?runtime={Uri.EscapeDataString(offer.Runtime)}" +
            $"&channel={Uri.EscapeDataString(channel)}");
        using var request = AuthenticatedGet(uri, connection);
        using var response = await _httpClientFactory.CreateClient("SirkCentral").SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is long length && length != offer.Size)
            throw new InvalidDataException(
                "Central Portal package size does not match signed metadata.");
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            128 * 1024,
            FileOptions.Asynchronous | FileOptions.WriteThrough);
        var buffer = new byte[128 * 1024];
        long total = 0;
        while (true)
        {
            var read = await input.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            total += read;
            if (total > offer.Size || total > MaximumPackageBytes)
                throw new InvalidDataException(
                    "Central Portal package exceeded signed size.");
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        await output.FlushAsync(cancellationToken);
        output.Flush(flushToDisk: true);
        if (total != offer.Size)
            throw new InvalidDataException("Central Portal package is truncated.");
    }

    private static HttpRequestMessage AuthenticatedGet(
        Uri uri,
        CentralConnectionOptions connection)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        var signed = PortalRequestSigner.Create(
            ReadOnlySpan<byte>.Empty,
            connection.PortalId,
            connection.PortalToken);
        request.Headers.TryAddWithoutValidation("Authorization", signed.Authorization);
        request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue
        {
            NoCache = true,
            NoStore = true
        };
        return request;
    }

    private (CentralConnectionOptions Connection, Uri BaseUri) ResolveCentral()
    {
        var resolved = _resolver.Resolve().Options;
        if (!resolved.Enabled ||
            string.IsNullOrWhiteSpace(resolved.PortalId) ||
            string.IsNullOrWhiteSpace(resolved.PortalToken) ||
            !Uri.TryCreate(resolved.BaseUrl, UriKind.Absolute, out var baseUri) ||
            !string.IsNullOrEmpty(baseUri.UserInfo) ||
            (baseUri.Scheme != Uri.UriSchemeHttps &&
             !(baseUri.Scheme == Uri.UriSchemeHttp && baseUri.IsLoopback)))
            throw new InvalidOperationException(
                "A protected SIRK Central connection is required for Portal updates.");
        return (resolved, baseUri);
    }

    private static void ValidateOffer(
        PortalUpdateOffer offer,
        string runtime,
        string channel,
        string currentVersion)
    {
        var descriptor = offer.Descriptor
                         ?? throw new InvalidDataException(
                             "Central Portal update descriptor is missing.");
        if (offer.ApplicationId != "sirk-portal" ||
            descriptor.SchemaVersion != 1 ||
            descriptor.ApplicationId != "sirk-portal" ||
            descriptor.Product != "SIRK Portal" ||
            offer.Version != descriptor.Version ||
            offer.Runtime != runtime || descriptor.Runtime != runtime ||
            offer.Channel != channel || descriptor.Channel != channel ||
            offer.Size != descriptor.Size ||
            offer.Size is <= 0 or > MaximumPackageBytes ||
            !IsSha256(offer.Sha256) ||
            !string.Equals(
                offer.Sha256,
                descriptor.Sha256,
                StringComparison.OrdinalIgnoreCase) ||
            descriptor.Commit.Length != 40 ||
            descriptor.Commit.Any(character => !Uri.IsHexDigit(character)) ||
            descriptor.AssetName != Path.GetFileName(descriptor.AssetName) ||
            !descriptor.AssetName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
            !VersionPattern.IsMatch(offer.Version) ||
            Version.Parse(offer.Version).CompareTo(Version.Parse(currentVersion)) <= 0)
            throw new InvalidDataException(
                "Central Portal update metadata is invalid or not newer than the installed version.");
    }

    private static void VerifyDescriptorSignature(PortalReleaseDescriptor descriptor)
    {
        var keyringPath = Path.Combine(AppContext.BaseDirectory, "release-trusted-keys.json");
        if (!File.Exists(keyringPath))
            throw new CryptographicException(
                "Portal release trust keyring is not installed.");
        var keyring = JsonSerializer.Deserialize<PortalReleaseKeyDocument>(
                          File.ReadAllBytes(keyringPath),
                          Json)
                      ?? throw new CryptographicException(
                          "Portal release trust keyring is invalid.");
        if (keyring.Keys is null || keyring.Keys.Count is <= 0 or > 32 ||
            descriptor.Signature is null ||
            descriptor.Signature.Algorithm != "ES256")
            throw new CryptographicException(
                "Portal release signature metadata is invalid.");
        var entry = keyring.Keys.SingleOrDefault(
                        item => item.KeyId == descriptor.Signature.KeyId)
                    ?? throw new CryptographicException(
                        "Portal release signing key is not trusted.");
        using var key = ECDsa.Create();
        key.ImportFromPem(entry.PublicKeyPem);
        if (key.KeySize != 256)
            throw new CryptographicException("Portal release signing key must be P-256.");
        var supplied = DecodeBase64Url(descriptor.Signature.Value);
        var canonical = CanonicalPortalUpdateJson.SerializeWithoutTopLevelSignature(descriptor);
        try
        {
            if (supplied.Length != 64 ||
                !key.VerifyData(
                    canonical,
                    supplied,
                    HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
                throw new CryptographicException(
                    "Portal release descriptor ES256 signature verification failed.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(supplied);
            CryptographicOperations.ZeroMemory(canonical);
        }
    }

    private static void VerifyPackageFile(string path, long size, string sha256)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length != size)
            throw new InvalidDataException("Portal update package size is invalid.");
        using var stream = File.OpenRead(path);
        var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!string.Equals(actual, sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Portal update package SHA256 is invalid.");
    }

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength > maximumBytes)
            throw new InvalidDataException("Central Portal update response is too large.");
        await using var input = await content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await input.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (output.Length + read > maximumBytes)
                throw new InvalidDataException(
                    "Central Portal update response is too large.");
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        return output.ToArray();
    }

    private static string CurrentVersion()
    {
        var value = VersionInfo.Current;
        var plus = value.IndexOf('+');
        if (plus > 0) value = value[..plus];
        if (!VersionPattern.IsMatch(value))
            throw new InvalidDataException(
                "Installed Portal version is outside the 0.1.1.X update line.");
        return value;
    }

    private static string CurrentVersionOrUnknown()
    {
        try { return CurrentVersion(); }
        catch (InvalidDataException) { return VersionInfo.Current; }
    }

    private static string NormalizeChannel(string value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "preview" => "preview",
            _ => "stable"
        };

    private static string? PlatformTarget()
    {
        if (OperatingSystem.IsWindows() && Environment.Is64BitOperatingSystem) return "win-x64";
        if (OperatingSystem.IsLinux() && Environment.Is64BitOperatingSystem) return "linux-x64";
        return null;
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(Uri.IsHexDigit);

    private static byte[] DecodeBase64Url(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }

    private static string RequiredString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) ||
            element.ValueKind != JsonValueKind.String)
            throw new InvalidDataException(
                "Portal release manifest is missing " + property + ".");
        var value = (element.GetString() ?? string.Empty).Trim();
        if (value.Length == 0)
            throw new InvalidDataException(
                "Portal release manifest contains an empty " + property + ".");
        return value;
    }

    private static string RequiredCommit(JsonElement root, string property)
    {
        var value = RequiredString(root, property).ToLowerInvariant();
        if (value.Length != 40 || value.Any(character => !Uri.IsHexDigit(character)))
            throw new InvalidDataException(
                "Portal release manifest contains an invalid commit SHA.");
        return value;
    }
}

internal static class CanonicalPortalUpdateJson
{
    public static byte[] SerializeWithoutTopLevelSignature<T>(T value)
    {
        var root = JsonSerializer.SerializeToElement(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output))
        {
            WriteObject(root, writer, topLevel: true);
            writer.Flush();
        }
        return output.ToArray();
    }

    private static void WriteObject(JsonElement root, Utf8JsonWriter writer, bool topLevel)
    {
        writer.WriteStartObject();
        foreach (var property in root.EnumerateObject()
                     .Where(property => !(topLevel && property.NameEquals("signature")))
                     .OrderBy(property => property.Name, StringComparer.Ordinal))
        {
            writer.WritePropertyName(property.Name);
            WriteElement(property.Value, writer);
        }
        writer.WriteEndObject();
    }

    private static void WriteElement(JsonElement element, Utf8JsonWriter writer)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                WriteObject(element, writer, topLevel: false);
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray()) WriteElement(item, writer);
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }
}
