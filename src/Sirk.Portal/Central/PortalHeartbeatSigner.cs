using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sirk.Portal.Central;

internal sealed record SignedPortalHeartbeat(
    byte[] Body,
    string Authorization,
    string Timestamp,
    string Nonce,
    string Signature);

internal static class PortalHeartbeatSigner
{
    public static SignedPortalHeartbeat Create(
        PortalHeartbeatPayload payload,
        string portalId,
        string portalToken,
        DateTimeOffset? timestamp = null,
        byte[]? nonceBytes = null)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (string.IsNullOrWhiteSpace(portalId))
        {
            throw new ArgumentException("Portal ID is required.", nameof(portalId));
        }

        if (portalToken.Length < 32)
        {
            throw new ArgumentException("Portal token must contain at least 32 characters.", nameof(portalToken));
        }

        var body = JsonSerializer.SerializeToUtf8Bytes(
            payload,
            PortalClientJsonContext.Default.PortalHeartbeatPayload);
        var timestampText = (timestamp ?? DateTimeOffset.UtcNow)
            .ToUnixTimeMilliseconds()
            .ToString(CultureInfo.InvariantCulture);
        var nonce = Base64Url(nonceBytes ?? RandomNumberGenerator.GetBytes(18));
        var prefix = Encoding.UTF8.GetBytes($"{timestampText}\n{nonce}\n");
        var signedContent = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signedContent, 0);
        body.CopyTo(signedContent, prefix.Length);

        var tokenBytes = Encoding.UTF8.GetBytes(portalToken);
        byte[] signature;
        try
        {
            signature = HMACSHA256.HashData(tokenBytes, signedContent);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(tokenBytes);
            CryptographicOperations.ZeroMemory(signedContent);
        }

        var credentialBytes = Encoding.UTF8.GetBytes($"{portalId}:{portalToken}");
        try
        {
            return new SignedPortalHeartbeat(
                body,
                $"SIRK-Portal {Base64Url(credentialBytes)}",
                timestampText,
                nonce,
                Base64Url(signature));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(credentialBytes);
            CryptographicOperations.ZeroMemory(signature);
        }
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
