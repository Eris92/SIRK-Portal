using System.Text.Json;

namespace Sirk.Portal.Maintenance;

internal sealed record PortalUpdateProbeResult(
    string AvailableVersion,
    string? InstalledCommit,
    string? RemoteCommit,
    bool UpdateAvailable,
    string? Error,
    DateTimeOffset CheckedAtUtc);

internal static class PortalUpdateProbe
{
    private const string ApplicationId = "sirk-portal";
    private const string Channel = "main";
    private const string ReleaseBase =
        "https://github.com/Eris92/SIRK-Portal/releases/download/portal-main-latest/";

    private static readonly object Sync = new();
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(1);
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private static PortalUpdateProbeResult? _cached;

    public static PortalUpdateProbeResult Probe(bool force = false)
    {
        if (!force)
        {
            lock (Sync)
            {
                if (_cached is not null &&
                    DateTimeOffset.UtcNow - _cached.CheckedAtUtc < CacheLifetime)
                {
                    return _cached;
                }
            }
        }

        var result = ProbeCore();
        lock (Sync) _cached = result;
        return result;
    }

    private static PortalUpdateProbeResult ProbeCore()
    {
        var installedCommit = ReadInstalledCommit();
        var target = PlatformTarget();
        if (target is null)
        {
            return new PortalUpdateProbeResult(
                "main/latest",
                installedCommit,
                null,
                false,
                "Aktualizacje main/latest są obsługiwane tylko na Windows x64 i Linux x64.",
                DateTimeOffset.UtcNow);
        }

        try
        {
            var metadataUrl = ReleaseBase + target.Value.Metadata + "?nocache=" + Guid.NewGuid().ToString("N");
            var json = Client.GetStringAsync(metadataUrl).GetAwaiter().GetResult();
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            var applicationId = RequiredString(root, "applicationId");
            var channel = RequiredString(root, "channel");
            var package = RequiredString(root, "package");
            var architecture = RequiredString(root, "architecture");
            var remoteCommit = RequiredCommit(root, "commit");
            var sha256 = RequiredString(root, "sha256");

            if (!string.Equals(applicationId, ApplicationId, StringComparison.Ordinal) ||
                !string.Equals(channel, Channel, StringComparison.Ordinal) ||
                !string.Equals(package, target.Value.Package, StringComparison.Ordinal) ||
                !string.Equals(architecture, target.Value.Architecture, StringComparison.Ordinal) ||
                sha256.Length != 64 || !sha256.All(Uri.IsHexDigit))
            {
                throw new InvalidDataException("Portal release metadata is invalid.");
            }

            var updateAvailable = installedCommit is null ||
                                  !string.Equals(
                                      installedCommit,
                                      remoteCommit,
                                      StringComparison.OrdinalIgnoreCase);

            return new PortalUpdateProbeResult(
                "main/latest",
                installedCommit,
                remoteCommit,
                updateAvailable,
                null,
                DateTimeOffset.UtcNow);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException or
            JsonException or InvalidDataException or IOException)
        {
            return new PortalUpdateProbeResult(
                "main/latest",
                installedCommit,
                null,
                false,
                exception.Message,
                DateTimeOffset.UtcNow);
        }
    }

    private static (string Metadata, string Package, string Architecture)? PlatformTarget()
    {
        if (OperatingSystem.IsWindows() && Environment.Is64BitOperatingSystem)
            return ("portal-update.json", "sirk-portal-win-x64.zip", "win-x64");
        if (OperatingSystem.IsLinux() && Environment.Is64BitOperatingSystem)
            return ("portal-update-linux-x64.json", "sirk-portal-linux-x64.zip", "linux-x64");
        return null;
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
            var channel = RequiredString(root, "channel");
            var commit = RequiredCommit(root, "commit");
            if (!string.Equals(applicationId, ApplicationId, StringComparison.Ordinal) ||
                !string.Equals(channel, Channel, StringComparison.Ordinal))
            {
                return null;
            }
            return commit;
        }
        catch (Exception exception) when (
            exception is JsonException or InvalidDataException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string RequiredString(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var element) ||
            element.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("Portal release metadata is missing " + property + ".");
        }
        var value = (element.GetString() ?? string.Empty).Trim();
        if (value.Length == 0)
            throw new InvalidDataException("Portal release metadata contains an empty " + property + ".");
        return value;
    }

    private static string RequiredCommit(JsonElement root, string property)
    {
        var value = RequiredString(root, property);
        if (value.Length != 40 || !value.All(Uri.IsHexDigit))
            throw new InvalidDataException("Portal release metadata contains an invalid commit SHA.");
        return value.ToLowerInvariant();
    }
}
