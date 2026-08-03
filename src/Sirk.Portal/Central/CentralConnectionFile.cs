using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Central;

internal sealed record CentralConnectionFileDocument(
    int SchemaVersion,
    string CentralUrl,
    string TunnelUrl,
    string PortalId,
    string PortalName,
    string PortalToken,
    string PublicUrl,
    DateTimeOffset UpdatedAtUtc);

internal sealed record RedactedCentralConnection(
    int SchemaVersion,
    string CentralUrl,
    string TunnelUrl,
    string PortalId,
    string PortalName,
    string PortalToken,
    string PublicUrl,
    DateTimeOffset UpdatedAtUtc);

internal sealed record ResolvedCentralConnection(
    CentralConnectionOptions Options,
    string Source,
    string SourcePath);

[JsonSerializable(typeof(CentralConnectionFileDocument))]
[JsonSerializable(typeof(RedactedCentralConnection))]
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, WriteIndented = true)]
internal sealed partial class CentralConnectionFileJsonContext : JsonSerializerContext;

internal sealed class CentralConnectionResolver
{
    private const long MaximumFileBytes = 32 * 1024;

    private static readonly UnixFileMode ForbiddenUnixModes =
        UnixFileMode.GroupRead |
        UnixFileMode.GroupWrite |
        UnixFileMode.GroupExecute |
        UnixFileMode.OtherRead |
        UnixFileMode.OtherWrite |
        UnixFileMode.OtherExecute;

    private readonly CentralConnectionOptions _configuredOptions;
    private readonly ILogger<CentralConnectionResolver> _logger;

    public CentralConnectionResolver(
        IOptions<CentralConnectionOptions> options,
        IHostEnvironment environment,
        ILogger<CentralConnectionResolver> logger)
    {
        ArgumentNullException.ThrowIfNull(environment);
        _configuredOptions = options.Value;
        _logger = logger;
    }

    public ResolvedCentralConnection Resolve()
    {
        var path = ResolveConnectionFilePath(_configuredOptions.ConnectionFile);
        if (!File.Exists(path))
        {
            return new ResolvedCentralConnection(
                Clone(_configuredOptions),
                "configuration",
                string.Empty);
        }

        var document = ReadProtectedDocument(path);
        var resolved = new CentralConnectionOptions
        {
            Enabled = true,
            BaseUrl = document.CentralUrl,
            PortalId = document.PortalId,
            PortalName = document.PortalName,
            PortalToken = document.PortalToken,
            PublicUrl = document.PublicUrl,
            UpdateChannel = _configuredOptions.UpdateChannel,
            HeartbeatIntervalSeconds = _configuredOptions.HeartbeatIntervalSeconds,
            RequestTimeoutSeconds = _configuredOptions.RequestTimeoutSeconds,
            ConnectionFile = path
        };

        _logger.LogInformation(
            "Loaded SIRK Central connection for Portal {PortalId} from protected configuration file {ConfigurationPath}.",
            resolved.PortalId,
            path);

        return new ResolvedCentralConnection(resolved, "protected-file", path);
    }

    internal static string ResolveConnectionFilePath(string? configuredPath)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            return Path.GetFullPath(
                Environment.ExpandEnvironmentVariables(configuredPath.Trim()));
        }

        if (OperatingSystem.IsWindows())
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "SIRK",
                "Portal",
                "central-connection.json");
        }

        return "/var/lib/sirk-portal/central-connection.json";
    }

    internal static CentralConnectionFileDocument ReadProtectedDocument(string path)
    {
        var resolved = ResolveConnectionFilePath(path);
        ValidateFileSecurity(resolved);
        var document = ReadDocument(resolved);
        ValidateDocument(document);
        ValidateTunnelOrigin(document.CentralUrl, document.TunnelUrl);
        return document;
    }

    internal static CentralConnectionFileDocument ImportProtectedDocument(
        string sourcePath,
        string destinationPath,
        bool consumeSource)
    {
        var source = Path.GetFullPath(
            Environment.ExpandEnvironmentVariables(
                (sourcePath ?? string.Empty).Trim()));
        if (!File.Exists(source))
            throw new FileNotFoundException("Central connection source file was not found.", source);
        ValidateFileSecurity(source);
        var document = ReadProtectedDocument(source);

        var destination = ResolveConnectionFilePath(destinationPath);
        if (string.Equals(source, destination, PathComparison()))
        {
            SecureFile(destination);
            return document;
        }

        var directory = Path.GetDirectoryName(destination)
                        ?? throw new InvalidOperationException(
                            "Central connection destination has no parent directory.");
        Directory.CreateDirectory(directory);
        AtomicJsonFile.SecureDirectory(directory);

        var temporary = $"{destination}.tmp-{Environment.ProcessId}-{Guid.NewGuid():N}";
        try
        {
            using (var stream = new FileStream(
                       temporary,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       16 * 1024,
                       FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(
                    stream,
                    document,
                    CentralConnectionFileJsonContext.Default.CentralConnectionFileDocument);
                stream.Flush(flushToDisk: true);
            }

            SecureFile(temporary);
            File.Move(temporary, destination, overwrite: true);
            SecureFile(destination);
        }
        finally
        {
            File.Delete(temporary);
        }

        if (consumeSource)
        {
            SecureDelete(source);
        }

        return document;
    }

    internal static CentralConnectionFileDocument SaveProtectedDocument(
        CentralConnectionFileDocument document,
        string? destinationPath)
    {
        ArgumentNullException.ThrowIfNull(document);
        ValidateDocument(document);
        ValidateTunnelOrigin(document.CentralUrl, document.TunnelUrl);
        var normalized = document with { UpdatedAtUtc = DateTimeOffset.UtcNow };
        var destination = ResolveConnectionFilePath(destinationPath);
        AtomicJsonFile.Write(destination, normalized);
        SecureFile(destination);
        return ReadProtectedDocument(destination);
    }

    internal static bool RemoveProtectedDocument(string path)
    {
        var resolved = ResolveConnectionFilePath(path);
        if (!File.Exists(resolved)) return false;
        ValidateFileSecurity(resolved);
        SecureDelete(resolved);
        return true;
    }

    internal static RedactedCentralConnection Redact(
        CentralConnectionFileDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var visible = document.PortalToken.Length <= 8
            ? "***"
            : document.PortalToken[..4] + "..." + document.PortalToken[^4..];
        return new RedactedCentralConnection(
            document.SchemaVersion,
            document.CentralUrl,
            document.TunnelUrl,
            document.PortalId,
            document.PortalName,
            visible,
            document.PublicUrl,
            document.UpdatedAtUtc);
    }

    private static CentralConnectionFileDocument ReadDocument(string path)
    {
        var file = new FileInfo(path);
        if (file.Length is <= 0 or > MaximumFileBytes)
        {
            throw new InvalidDataException(
                $"Central connection file must contain 1-{MaximumFileBytes} bytes.");
        }

        try
        {
            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                4096,
                FileOptions.SequentialScan);
            var document = JsonSerializer.Deserialize(
                stream,
                CentralConnectionFileJsonContext.Default.CentralConnectionFileDocument);
            return document
                   ?? throw new InvalidDataException(
                       "Central connection file is empty.");
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException(
                "Central connection file contains invalid JSON.",
                exception);
        }
    }

    private static void ValidateDocument(CentralConnectionFileDocument document)
    {
        if (document.SchemaVersion != 1)
        {
            throw new InvalidDataException(
                $"Central connection schema version {document.SchemaVersion} is unsupported.");
        }

        if (string.IsNullOrWhiteSpace(document.CentralUrl) ||
            string.IsNullOrWhiteSpace(document.TunnelUrl))
        {
            throw new InvalidDataException(
                "Central connection file must contain Central and tunnel URLs.");
        }

        if (!IsValidPortalId(document.PortalId))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid Portal ID.");
        }

        if (string.IsNullOrWhiteSpace(document.PortalName) ||
            document.PortalName.Length is < 2 or > 100 ||
            !string.Equals(
                document.PortalName,
                document.PortalName.Trim(),
                StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid Portal name.");
        }

        if (!IsValidBase64UrlSecret(document.PortalToken, 32, 512))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid Portal token.");
        }

        if (document.PublicUrl is null)
        {
            throw new InvalidDataException(
                "Central connection file must contain the publicUrl field.");
        }

        if (document.PublicUrl.Length > 0 &&
            (!Uri.TryCreate(document.PublicUrl, UriKind.Absolute, out var publicUrl) ||
             publicUrl is null ||
             publicUrl.Scheme != Uri.UriSchemeHttps ||
             !IsOriginOnly(publicUrl)))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid Portal public URL.");
        }
    }

    private static void ValidateFileSecurity(string path)
    {
        var file = new FileInfo(path);
        if (!file.Exists)
            throw new FileNotFoundException(
                "Central connection file was not found.",
                path);
        var attributes = file.Attributes;
        if ((attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(
                "Central connection file must not be a symbolic link or reparse point.");
        }

        if (!OperatingSystem.IsWindows())
        {
            var mode = File.GetUnixFileMode(path);
            if ((mode & ForbiddenUnixModes) != 0)
            {
                throw new InvalidDataException(
                    "Central connection file must not grant permissions to group or other users.");
            }
        }
    }

    private static void ValidateTunnelOrigin(string centralUrl, string tunnelUrl)
    {
        if (!Uri.TryCreate(centralUrl, UriKind.Absolute, out var central) ||
            central is null ||
            central.Scheme != Uri.UriSchemeHttps ||
            !IsOriginOnly(central))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid HTTPS Central origin URL.");
        }

        if (!Uri.TryCreate(tunnelUrl, UriKind.Absolute, out var tunnel) ||
            tunnel is null)
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid tunnel URL.");
        }

        if (!string.Equals(tunnel.Scheme, "wss", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(tunnel.Host, central.Host, StringComparison.OrdinalIgnoreCase) ||
            tunnel.Port != central.Port ||
            !string.Equals(tunnel.AbsolutePath, "/tunnel", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(tunnel.Query) ||
            !string.IsNullOrEmpty(tunnel.Fragment) ||
            !string.IsNullOrEmpty(tunnel.UserInfo))
        {
            throw new InvalidDataException(
                "Central tunnel URL must use the HTTPS Central origin and the /tunnel path.");
        }
    }

    private static void SecureFile(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    private static void SecureDelete(string path)
    {
        if (!File.Exists(path)) return;
        try
        {
            var length = new FileInfo(path).Length;
            if (length is > 0 and <= MaximumFileBytes)
            {
                using var stream = new FileStream(
                    path,
                    FileMode.Open,
                    FileAccess.Write,
                    FileShare.None,
                    4096,
                    FileOptions.WriteThrough);
                var zeros = new byte[Math.Min(length, 4096)];
                long remaining = length;
                while (remaining > 0)
                {
                    var count = (int)Math.Min(zeros.Length, remaining);
                    stream.Write(zeros, 0, count);
                    remaining -= count;
                }
                stream.Flush(flushToDisk: true);
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static bool IsOriginOnly(Uri uri) =>
        string.IsNullOrEmpty(uri.UserInfo) &&
        string.IsNullOrEmpty(uri.Query) &&
        string.IsNullOrEmpty(uri.Fragment) &&
        (uri.AbsolutePath.Length == 0 || uri.AbsolutePath == "/");

    private static bool IsValidPortalId(string? value)
    {
        if (value is null ||
            value.Length is < 3 or > 63 ||
            !IsLowercaseLetterOrDigit(value[0]))
        {
            return false;
        }

        foreach (var character in value)
        {
            if (!IsLowercaseLetterOrDigit(character) && character != '-')
                return false;
        }

        return true;
    }

    private static bool IsValidBase64UrlSecret(
        string? value,
        int minimum,
        int maximum)
    {
        if (value is null || value.Length < minimum || value.Length > maximum)
            return false;

        foreach (var character in value)
        {
            if (character is not (>= 'a' and <= 'z') and
                not (>= 'A' and <= 'Z') and
                not (>= '0' and <= '9') and
                not '-' and
                not '_')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowercaseLetterOrDigit(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';

    private static StringComparison PathComparison() =>
        OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

    private static CentralConnectionOptions Clone(CentralConnectionOptions source) =>
        new()
        {
            Enabled = source.Enabled,
            BaseUrl = source.BaseUrl,
            PortalId = source.PortalId,
            PortalName = source.PortalName,
            PortalToken = source.PortalToken,
            PublicUrl = source.PublicUrl,
            UpdateChannel = source.UpdateChannel,
            HeartbeatIntervalSeconds = source.HeartbeatIntervalSeconds,
            RequestTimeoutSeconds = source.RequestTimeoutSeconds,
            ConnectionFile = source.ConnectionFile
        };
}
