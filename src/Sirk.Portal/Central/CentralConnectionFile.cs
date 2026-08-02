using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

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

internal sealed record ResolvedCentralConnection(
    CentralConnectionOptions Options,
    string Source,
    string SourcePath);

[JsonSerializable(typeof(CentralConnectionFileDocument))]
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
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
            return new ResolvedCentralConnection(Clone(_configuredOptions), "configuration", string.Empty);
        }

        ValidateFileSecurity(path);
        var document = ReadDocument(path);
        ValidateDocument(document);
        ValidateTunnelOrigin(document.CentralUrl, document.TunnelUrl);

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

            if (document is null)
            {
                throw new InvalidDataException("Central connection file is empty.");
            }

            if (document.SchemaVersion != 1)
            {
                throw new InvalidDataException(
                    $"Central connection schema version {document.SchemaVersion} is unsupported.");
            }

            return document;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Central connection file contains invalid JSON.", exception);
        }
    }

    private static void ValidateDocument(CentralConnectionFileDocument document)
    {
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
            !string.Equals(document.PortalName, document.PortalName.Trim(), StringComparison.Ordinal))
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
        var attributes = File.GetAttributes(path);
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

    private static string ResolveConnectionFilePath(string configuredPath)
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

    private static void ValidateTunnelOrigin(string centralUrl, string tunnelUrl)
    {
        if (!Uri.TryCreate(centralUrl, UriKind.Absolute, out var central) ||
            central is null ||
            !IsOriginOnly(central))
        {
            throw new InvalidDataException(
                "Central connection file contains an invalid Central origin URL.");
        }

        if (!Uri.TryCreate(tunnelUrl, UriKind.Absolute, out var tunnel) || tunnel is null)
        {
            throw new InvalidDataException("Central connection file contains an invalid tunnel URL.");
        }

        var expectedScheme = central.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        if (!string.Equals(tunnel.Scheme, expectedScheme, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(tunnel.Host, central.Host, StringComparison.OrdinalIgnoreCase) ||
            tunnel.Port != central.Port ||
            !string.Equals(tunnel.AbsolutePath, "/tunnel", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(tunnel.Query) ||
            !string.IsNullOrEmpty(tunnel.Fragment) ||
            !string.IsNullOrEmpty(tunnel.UserInfo))
        {
            throw new InvalidDataException(
                "Central tunnel URL must use the Central origin and the /tunnel path.");
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
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsValidBase64UrlSecret(string? value, int minimum, int maximum)
    {
        if (value is null || value.Length < minimum || value.Length > maximum)
        {
            return false;
        }

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
