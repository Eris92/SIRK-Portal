using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Sirk.Portal.Agent;

internal sealed record AgentPrincipal(
    string DeviceId,
    AgentDeviceRecord Device,
    byte[] SigningKey) : IDisposable
{
    public void Dispose() => CryptographicOperations.ZeroMemory(SigningKey);
}

internal sealed record AgentResponseSignature(
    string Timestamp,
    string Nonce,
    string Signature);

internal sealed class AgentRequestAuthenticator
{
    private static readonly TimeSpan MaximumClockSkew = TimeSpan.FromMinutes(2);
    private readonly AgentStore _agents;
    private readonly ConcurrentDictionary<string, long> _nonces = new(StringComparer.Ordinal);
    private long _lastCleanup;

    public AgentRequestAuthenticator(AgentStore agents)
    {
        _agents = agents;
    }

    public AgentPrincipal? Authenticate(HttpRequest request, ReadOnlySpan<byte> body)
    {
        var authorization = request.Headers.Authorization.ToString();
        const string prefix = "SIRK-Agent ";
        if (!authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;

        string deviceId;
        try
        {
            deviceId = Encoding.UTF8.GetString(Base64UrlDecode(authorization[prefix.Length..].Trim()));
        }
        catch (Exception exception) when (exception is FormatException or DecoderFallbackException)
        {
            return null;
        }

        var device = _agents.GetDevice(deviceId);
        if (device is not { Enabled: true }) return null;

        var timestampText = request.Headers["X-SIRK-Timestamp"].ToString();
        var nonce = request.Headers["X-SIRK-Nonce"].ToString();
        var suppliedSignature = request.Headers["X-SIRK-Signature"].ToString();
        if (!long.TryParse(timestampText, NumberStyles.None, CultureInfo.InvariantCulture, out var timestamp))
            return null;
        var requestTime = DateTimeOffset.FromUnixTimeMilliseconds(timestamp);
        if ((DateTimeOffset.UtcNow - requestTime).Duration() > MaximumClockSkew) return null;

        byte[] nonceBytes;
        byte[] supplied;
        try
        {
            nonceBytes = Base64UrlDecode(nonce);
            supplied = Base64UrlDecode(suppliedSignature);
        }
        catch (FormatException)
        {
            return null;
        }
        if (nonceBytes.Length < 16 || supplied.Length != 32) return null;

        CleanupNonces(timestamp);
        var replayKey = deviceId + ":" + nonce;
        if (!_nonces.TryAdd(replayKey, timestamp)) return null;

        byte[] signingKey;
        try
        {
            signingKey = _agents.GetSigningKey(deviceId);
        }
        catch (Exception exception) when (
            exception is KeyNotFoundException or UnauthorizedAccessException or CryptographicException)
        {
            _nonces.TryRemove(replayKey, out _);
            return null;
        }

        var path = request.PathBase.Add(request.Path).ToString() + request.QueryString.Value;
        var canonical = CanonicalRequest(
            request.Method,
            path,
            timestampText,
            nonce,
            body);
        var expected = HMACSHA256.HashData(signingKey, canonical);
        var valid = CryptographicOperations.FixedTimeEquals(expected, supplied);
        CryptographicOperations.ZeroMemory(expected);
        CryptographicOperations.ZeroMemory(canonical);
        CryptographicOperations.ZeroMemory(nonceBytes);
        CryptographicOperations.ZeroMemory(supplied);
        if (!valid)
        {
            CryptographicOperations.ZeroMemory(signingKey);
            _nonces.TryRemove(replayKey, out _);
            return null;
        }

        return new AgentPrincipal(deviceId, device, signingKey);
    }

    public AgentResponseSignature SignResponse(
        AgentPrincipal principal,
        ReadOnlySpan<byte> body)
    {
        var timestamp = DateTimeOffset.UtcNow
            .ToUnixTimeMilliseconds()
            .ToString(CultureInfo.InvariantCulture);
        var nonce = Base64Url(RandomNumberGenerator.GetBytes(18));
        var bodyHash = Base64Url(SHA256.HashData(body));
        var canonical = Encoding.UTF8.GetBytes($"{timestamp}\n{nonce}\n{bodyHash}");
        var signature = HMACSHA256.HashData(principal.SigningKey, canonical);
        try
        {
            return new AgentResponseSignature(timestamp, nonce, Base64Url(signature));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(canonical);
            CryptographicOperations.ZeroMemory(signature);
        }
    }

    private static byte[] CanonicalRequest(
        string method,
        string path,
        string timestamp,
        string nonce,
        ReadOnlySpan<byte> body)
    {
        var bodyHash = Base64Url(SHA256.HashData(body));
        return Encoding.UTF8.GetBytes(
            $"{method.ToUpperInvariant()}\n{path}\n{timestamp}\n{nonce}\n{bodyHash}");
    }

    private void CleanupNonces(long currentTimestamp)
    {
        var previous = Interlocked.Read(ref _lastCleanup);
        if (currentTimestamp - previous < 60_000 ||
            Interlocked.CompareExchange(ref _lastCleanup, currentTimestamp, previous) != previous)
        {
            return;
        }

        var minimum = DateTimeOffset.UtcNow.Subtract(MaximumClockSkew)
            .ToUnixTimeMilliseconds();
        foreach (var item in _nonces)
        {
            if (item.Value < minimum)
                _nonces.TryRemove(item.Key, out _);
        }
    }

    internal static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    internal static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += new string('=', (4 - normalized.Length % 4) % 4);
        return Convert.FromBase64String(normalized);
    }
}
