using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Sirk.Portal.Central;

internal sealed record SignedPortalRequest(
    string Authorization,
    string Timestamp,
    string Nonce,
    string Signature);

internal static class PortalRequestSigner
{
    public static SignedPortalRequest Create(
        ReadOnlySpan<byte> body,
        string portalId,
        string portalToken,
        DateTimeOffset? timestamp = null)
    {
        if (string.IsNullOrWhiteSpace(portalId))
            throw new ArgumentException("Portal ID is required.", nameof(portalId));
        if (string.IsNullOrWhiteSpace(portalToken) || portalToken.Length < 32)
            throw new ArgumentException("Portal token is invalid.", nameof(portalToken));

        var timestampText = (timestamp ?? DateTimeOffset.UtcNow)
            .ToUnixTimeMilliseconds()
            .ToString(CultureInfo.InvariantCulture);
        var nonce = Base64Url(RandomNumberGenerator.GetBytes(18));
        var prefix = Encoding.UTF8.GetBytes($"{timestampText}\n{nonce}\n");
        var signedContent = new byte[prefix.Length + body.Length];
        prefix.CopyTo(signedContent, 0);
        body.CopyTo(signedContent.AsSpan(prefix.Length));
        var tokenBytes = Encoding.UTF8.GetBytes(portalToken);
        var signature = HMACSHA256.HashData(tokenBytes, signedContent);
        var credentials = Encoding.UTF8.GetBytes($"{portalId}:{portalToken}");
        try
        {
            return new SignedPortalRequest(
                "SIRK-Portal " + Base64Url(credentials),
                timestampText,
                nonce,
                Base64Url(signature));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(tokenBytes);
            CryptographicOperations.ZeroMemory(signedContent);
            CryptographicOperations.ZeroMemory(signature);
            CryptographicOperations.ZeroMemory(credentials);
        }
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
