using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Sirk.Portal.Infrastructure;
using Sirk.Portal.Security;

namespace Sirk.Portal.Settings;

internal sealed record PortalModuleSettings(
    bool Enabled,
    IReadOnlyList<string> AccessGroupIds,
    JsonElement Options);

internal sealed record PortalSettingsDocument(
    int SchemaVersion,
    JsonElement Portal,
    IReadOnlyDictionary<string, PortalModuleSettings> Modules,
    IReadOnlyDictionary<string, JsonElement> Integrations,
    IReadOnlyDictionary<string, string> ProtectedSecrets,
    DateTimeOffset UpdatedAtUtc);

internal sealed record PortalSettingsUpdateRequest(
    JsonElement? Portal,
    IReadOnlyDictionary<string, PortalModuleSettings>? Modules,
    IReadOnlyDictionary<string, JsonElement>? Integrations,
    IReadOnlyDictionary<string, string>? Secrets);

internal sealed class PortalSettingsStore
{
    private const int SchemaVersion = 1;
    private static readonly string[] ModuleKeys =
    [
        "portal",
        "approvalcenter",
        "moverequests",
        "mycommands",
        "myscripts",
        "myjira",
        "defendertools",
        "monitoring",
        "assets",
        "reports"
    ];

    private readonly object _sync = new();
    private readonly string _path;
    private readonly IDataProtector _protector;
    private PortalSettingsDocument _document;

    public PortalSettingsStore(
        PortalPaths paths,
        IDataProtectionProvider dataProtectionProvider)
    {
        _path = paths.SettingsFile;
        _protector = dataProtectionProvider.CreateProtector("SIRK.Portal.Settings.Secrets.v1");
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<PortalSettingsDocument>(_path))
            : Defaults();
        if (!File.Exists(_path)) Save(_document);
    }

    public object Bootstrap(
        PortalAuthenticatedIdentity identity,
        PortalIdentityStore identities)
    {
        lock (_sync)
        {
            var modules = _document.Modules.ToDictionary(
                item => item.Key,
                item => new
                {
                    enabled = item.Value.Enabled,
                    ready = true,
                    error = (string?)null,
                    config = PublicModuleConfig(item.Key, item.Value),
                    access = new
                    {
                        allowed = ModuleAllowed(identity, identities, item.Value),
                        siteAdmin = PortalPermissions.Has(identity.Role, "settings.manage")
                    }
                },
                StringComparer.Ordinal);
            return new
            {
                ok = true,
                version = VersionInfo.Current,
                user = new
                {
                    name = identity.DisplayName,
                    userName = identity.UserName,
                    role = identity.Role,
                    permissions = PortalPermissions.ForRole(identity.Role)
                },
                portal = _document.Portal,
                modules,
                generatedAtUtc = DateTimeOffset.UtcNow
            };
        }
    }

    public object AdminSnapshot(PortalIdentityStore identities)
    {
        lock (_sync)
        {
            return new
            {
                product = new
                {
                    name = "SIRK Portal",
                    runtime = ".NET 10",
                    version = VersionInfo.Current
                },
                portal = _document.Portal,
                modules = _document.Modules,
                integrations = _document.Integrations,
                configuredSecrets = _document.ProtectedSecrets.Keys
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToArray(),
                identity = identities.Snapshot(),
                updatedAtUtc = _document.UpdatedAtUtc
            };
        }
    }

    public object Update(
        PortalSettingsUpdateRequest request,
        PortalIdentityStore identities)
    {
        ArgumentNullException.ThrowIfNull(request);
        lock (_sync)
        {
            var portal = request.Portal is { ValueKind: JsonValueKind.Object } portalValue
                ? ValidatePortal(portalValue)
                : _document.Portal;
            var modules = _document.Modules.ToDictionary(
                item => item.Key,
                item => item.Value,
                StringComparer.Ordinal);
            foreach (var item in request.Modules ?? new Dictionary<string, PortalModuleSettings>())
            {
                if (!ModuleKeys.Contains(item.Key, StringComparer.Ordinal))
                    throw new InvalidDataException($"Unknown Portal module: {item.Key}");
                modules[item.Key] = NormalizeModule(item.Value, identities);
            }

            var integrations = _document.Integrations.ToDictionary(
                item => item.Key,
                item => item.Value,
                StringComparer.Ordinal);
            foreach (var item in request.Integrations ?? new Dictionary<string, JsonElement>())
            {
                var key = NormalizeKey(item.Key, "Integration key");
                if (item.Value.ValueKind is not JsonValueKind.Object)
                    throw new InvalidDataException("Integration settings must be a JSON object.");
                if (item.Value.GetRawText().Length > 256 * 1024)
                    throw new InvalidDataException("Integration settings are too large.");
                integrations[key] = item.Value.Clone();
            }

            var secrets = _document.ProtectedSecrets.ToDictionary(
                item => item.Key,
                item => item.Value,
                StringComparer.Ordinal);
            foreach (var item in request.Secrets ?? new Dictionary<string, string>())
            {
                var key = NormalizeKey(item.Key, "Secret key");
                if (string.IsNullOrEmpty(item.Value)) continue;
                if (item.Value.Length > 16 * 1024)
                    throw new InvalidDataException("Secret value is too large.");
                secrets[key] = _protector.Protect(item.Value);
            }

            var now = DateTimeOffset.UtcNow;
            Save(new PortalSettingsDocument(
                SchemaVersion,
                portal,
                modules,
                integrations,
                secrets,
                now));
            return AdminSnapshot(identities);
        }
    }

    public PortalModuleSettings Module(string key)
    {
        lock (_sync)
        {
            return _document.Modules.TryGetValue(key, out var value)
                ? value
                : throw new KeyNotFoundException("Portal module was not found.");
        }
    }

    public JsonElement Portal()
    {
        lock (_sync)
        {
            return _document.Portal.Clone();
        }
    }

    public JsonElement Integration(string key)
    {
        lock (_sync)
        {
            return _document.Integrations.TryGetValue(key, out var value)
                ? value.Clone()
                : EmptyObject();
        }
    }

    public string? Secret(string key)
    {
        lock (_sync)
        {
            return _document.ProtectedSecrets.TryGetValue(key, out var value)
                ? _protector.Unprotect(value)
                : null;
        }
    }

    public bool IsModuleAllowed(
        string key,
        PortalAuthenticatedIdentity identity,
        PortalIdentityStore identities)
    {
        lock (_sync)
        {
            return _document.Modules.TryGetValue(key, out var module) &&
                   module.Enabled &&
                   ModuleAllowed(identity, identities, module);
        }
    }

    private static bool ModuleAllowed(
        PortalAuthenticatedIdentity identity,
        PortalIdentityStore identities,
        PortalModuleSettings module)
    {
        if (PortalPermissions.Has(identity.Role, "settings.manage")) return true;
        if (module.AccessGroupIds.Count == 0) return true;
        var snapshot = JsonSerializer.SerializeToElement(identities.Snapshot());
        var groups = snapshot.GetProperty("groups");
        foreach (var group in groups.EnumerateArray())
        {
            if (!module.AccessGroupIds.Contains(
                    group.GetProperty("id").GetString() ?? string.Empty,
                    StringComparer.Ordinal))
            {
                continue;
            }
            if (group.GetProperty("memberIds").EnumerateArray().Any(member =>
                    string.Equals(member.GetString(), identity.Id, StringComparison.Ordinal)))
            {
                return true;
            }
        }
        return false;
    }

    private static object PublicModuleConfig(string key, PortalModuleSettings value)
    {
        var name = key switch
        {
            "approvalcenter" => "Approvals",
            "moverequests" => "Move Requests",
            "mycommands" => "Commands",
            "myscripts" => "Automation",
            "myjira" => "Jira",
            "defendertools" => "Security",
            "monitoring" => "Monitoring",
            "assets" => "Assets",
            "reports" => "Reports",
            _ => "Portal"
        };
        return new
        {
            key,
            name,
            script = key switch
            {
                "approvalcenter" => "approvalcenter.js",
                "moverequests" => "moverequests.js",
                "mycommands" => "mycommands.js",
                "myscripts" => "myscripts.js",
                "myjira" => "myjira.js",
                "defendertools" => "defendertools.js",
                _ => string.Empty
            },
            options = value.Options
        };
    }

    private static PortalModuleSettings NormalizeModule(
        PortalModuleSettings source,
        PortalIdentityStore identities)
    {
        var snapshot = JsonSerializer.SerializeToElement(identities.Snapshot());
        var knownGroups = snapshot.GetProperty("groups")
            .EnumerateArray()
            .Select(value => value.GetProperty("id").GetString() ?? string.Empty)
            .ToHashSet(StringComparer.Ordinal);
        var groups = (source.AccessGroupIds ?? [])
            .Select(value => value.Trim().ToLowerInvariant())
            .Where(knownGroups.Contains)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var options = source.Options.ValueKind == JsonValueKind.Object
            ? source.Options.Clone()
            : EmptyObject();
        if (options.GetRawText().Length > 256 * 1024)
            throw new InvalidDataException("Module settings are too large.");
        return new PortalModuleSettings(source.Enabled, groups, options);
    }

    private void Save(PortalSettingsDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_path, _document);
    }

    private static PortalSettingsDocument Validate(PortalSettingsDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Portal settings schema is unsupported.");
        if (value.Portal.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Portal settings document is invalid.");
        foreach (var key in ModuleKeys)
        {
            if (!value.Modules.ContainsKey(key))
                throw new InvalidDataException($"Portal settings are missing module: {key}");
        }
        return value;
    }

    private static JsonElement ValidatePortal(JsonElement value)
    {
        if (value.GetRawText().Length > 256 * 1024)
            throw new InvalidDataException("Portal settings are too large.");
        return value.Clone();
    }

    private static PortalSettingsDocument Defaults()
    {
        var modules = ModuleKeys.ToDictionary(
            key => key,
            key => new PortalModuleSettings(
                key is not ("myjira" or "defendertools"),
                [],
                JsonSerializer.SerializeToElement(key switch
                {
                    "approvalcenter" => new { retentionDays = 365 },
                    "moverequests" => new { hostButtonEnabled = true },
                    "mycommands" => new { showOnDevice = true, maxMultiHostNodes = 200, multiHostConcurrency = 8 },
                    _ => new { }
                })),
            StringComparer.Ordinal);
        var portal = JsonSerializer.SerializeToElement(new
        {
            enabled = true,
            defaultView = "overview",
            siteName = "SIRK Portal",
            siteIconUrl = string.Empty,
            showPasswordReset = true,
            passwordResetUrl = "https://passwordreset.microsoftonline.com/",
            banner = new
            {
                enabled = false,
                showOnPortal = true,
                showOnLogin = false
            },
            views = new
            {
                overview = new { enabled = true },
                devices = new { enabled = true },
                approvals = new { enabled = true },
                automation = new { enabled = true },
                monitoring = new { enabled = true },
                assets = new { enabled = true },
                management = new { enabled = true },
                reports = new { enabled = true },
                security = new { enabled = true },
                settings = new { enabled = true }
            }
        });
        return new PortalSettingsDocument(
            SchemaVersion,
            portal,
            modules,
            new Dictionary<string, JsonElement>(StringComparer.Ordinal),
            new Dictionary<string, string>(StringComparer.Ordinal),
            DateTimeOffset.UtcNow);
    }

    private static string NormalizeKey(string value, string field)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized.Length is < 1 or > 64 ||
            normalized.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '.' and not '-' and not '_'))
        {
            throw new InvalidDataException($"{field} is invalid.");
        }
        return normalized;
    }

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }
}
