using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sirk.Portal.Central;

const string portalId = "portal-test";
const string portalToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
var timestamp = DateTimeOffset.Parse("2026-08-02T12:00:00.000Z");
var nonceBytes = Enumerable.Range(1, 18).Select(value => (byte)value).ToArray();

var payload = new PortalHeartbeatPayload(
    1,
    "3.0.0-dev.1",
    "abcdef0123456789",
    "linux-x64",
    "portal-test",
    "https://portal.example",
    "ok",
    10,
    8,
    "dev",
    "3.0.0-dev.1",
    ["dotnet10-runtime", "signed-heartbeat", "central-config-v1"]);

var signed = PortalHeartbeatSigner.Create(
    payload,
    portalId,
    portalToken,
    timestamp,
    nonceBytes);

Assert(
    signed.Timestamp == timestamp.ToUnixTimeMilliseconds().ToString(),
    "Heartbeat timestamp must use Unix milliseconds.");
Assert(
    Encoding.UTF8.GetString(signed.Body).Contains("\"protocolVersion\":1", StringComparison.Ordinal),
    "Heartbeat body must use the web JSON contract.");
Assert(
    !Encoding.UTF8.GetString(signed.Body).Contains(portalToken, StringComparison.Ordinal),
    "Heartbeat body must not contain the Portal token.");

var parsed = JsonSerializer.Deserialize(
    signed.Body,
    PortalClientJsonContext.Default.PortalHeartbeatPayload);
Assert(parsed?.PortalVersion == payload.PortalVersion, "Signed heartbeat body must deserialize.");
Assert(parsed?.Capabilities.SequenceEqual(payload.Capabilities) == true, "Capabilities must round-trip.");

const string scheme = "SIRK-Portal ";
Assert(signed.Authorization.StartsWith(scheme, StringComparison.Ordinal), "Authorization scheme is invalid.");
var decodedCredential = Encoding.UTF8.GetString(Base64UrlDecode(signed.Authorization[scheme.Length..]));
Assert(decodedCredential == $"{portalId}:{portalToken}", "Authorization credential encoding is invalid.");

var prefix = Encoding.UTF8.GetBytes($"{signed.Timestamp}\n{signed.Nonce}\n");
var content = new byte[prefix.Length + signed.Body.Length];
prefix.CopyTo(content, 0);
signed.Body.CopyTo(content, prefix.Length);
var expectedSignature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(portalToken), content);
var actualSignature = Base64UrlDecode(signed.Signature);
Assert(
    CryptographicOperations.FixedTimeEquals(expectedSignature, actualSignature),
    "Heartbeat HMAC-SHA256 signature does not match the protocol contract.");

var second = PortalHeartbeatSigner.Create(
    payload,
    portalId,
    portalToken,
    timestamp,
    nonceBytes.Select(value => (byte)(value + 1)).ToArray());
Assert(second.Nonce != signed.Nonce, "Heartbeat nonces must be unique.");
Assert(second.Signature != signed.Signature, "Changing the nonce must change the signature.");

var stateProperties = typeof(CentralConnectionSnapshot)
    .GetProperties()
    .Select(property => property.Name)
    .ToArray();
Assert(
    !stateProperties.Contains("PortalToken", StringComparer.Ordinal),
    "Portal connection status must never expose the Portal token.");

var configurationRoot = Path.Combine(
    Path.GetTempPath(),
    $"sirk-portal-central-config-{Guid.NewGuid():N}");
Directory.CreateDirectory(configurationRoot);
try
{
    var configurationPath = Path.Combine(configurationRoot, "central-connection.json");
    var document = new CentralConnectionFileDocument(
        1,
        "https://central.example",
        "wss://central.example/tunnel",
        portalId,
        "Portal Test",
        portalToken,
        "https://portal.example",
        timestamp);
    File.WriteAllText(
        configurationPath,
        JsonSerializer.Serialize(
            document,
            CentralConnectionFileJsonContext.Default.CentralConnectionFileDocument),
        Encoding.UTF8);
    if (!OperatingSystem.IsWindows())
    {
        File.SetUnixFileMode(
            configurationPath,
            UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    var resolver = new CentralConnectionResolver(
        Options.Create(new CentralConnectionOptions
        {
            ConnectionFile = configurationPath,
            UpdateChannel = "dev",
            HeartbeatIntervalSeconds = 60,
            RequestTimeoutSeconds = 15
        }),
        new TestHostEnvironment(),
        NullLogger<CentralConnectionResolver>.Instance);
    var resolved = resolver.Resolve();
    Assert(resolved.Source == "protected-file", "Protected Central configuration source is invalid.");
    Assert(resolved.SourcePath == configurationPath, "Protected Central configuration path is invalid.");
    Assert(resolved.Options.Enabled, "Protected Central configuration must enable the connection.");
    Assert(resolved.Options.PortalId == portalId, "Protected Portal ID is invalid.");
    Assert(resolved.Options.PortalToken == portalToken, "Protected Portal token was not loaded.");
    Assert(resolved.Options.BaseUrl == "https://central.example", "Protected Central URL is invalid.");

    if (!OperatingSystem.IsWindows())
    {
        File.SetUnixFileMode(
            configurationPath,
            UnixFileMode.UserRead |
            UnixFileMode.UserWrite |
            UnixFileMode.GroupRead);
        AssertThrows<InvalidDataException>(
            () => resolver.Resolve(),
            "Protected Central configuration with group permissions must be rejected.");
    }
}
finally
{
    Directory.Delete(configurationRoot, recursive: true);
}

Console.WriteLine("SIRK Portal signed heartbeat and protected config contracts: OK");

static byte[] Base64UrlDecode(string value)
{
    var normalized = value.Replace('-', '+').Replace('_', '/');
    normalized += (normalized.Length % 4) switch
    {
        0 => string.Empty,
        2 => "==",
        3 => "=",
        _ => throw new FormatException("Invalid Base64URL length.")
    };
    return Convert.FromBase64String(normalized);
}

static void AssertThrows<TException>(Action action, string message)
    where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException(message);
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

internal sealed class TestHostEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Development;

    public string ApplicationName { get; set; } = "Sirk.Portal.ProtocolTests";

    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
