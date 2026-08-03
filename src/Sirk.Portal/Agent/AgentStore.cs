using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Agent;

internal sealed record AgentGroupRecord(
    string Id,
    string Name,
    string Description,
    string EnrollmentTokenHashBase64,
    bool Enabled,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

internal sealed record AgentDeviceRecord(
    string Id,
    string GroupId,
    string TenantId,
    string Name,
    string HostName,
    string Platform,
    string AgentVersion,
    string ProtectedSigningKey,
    bool Enabled,
    string Status,
    string RemoteAddress,
    DateTimeOffset EnrolledAtUtc,
    DateTimeOffset? LastSeenAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyDictionary<string, string> Metadata);

internal sealed record AgentDocument(
    int SchemaVersion,
    IReadOnlyList<AgentGroupRecord> Groups,
    IReadOnlyList<AgentDeviceRecord> Devices,
    DateTimeOffset UpdatedAtUtc);

internal sealed record AgentGroupIssue(
    AgentGroupRecord Group,
    string EnrollmentToken);

internal sealed record AgentDeviceIssue(
    AgentDeviceRecord Device,
    string DeviceToken);

internal sealed record AgentEnrollmentRequest(
    string GroupId,
    string EnrollmentToken,
    string? DeviceId,
    string TenantId,
    string Name,
    string HostName,
    string Platform,
    string AgentVersion,
    IReadOnlyDictionary<string, string>? Metadata);

internal sealed record AgentHeartbeatRequest(
    string Name,
    string HostName,
    string Platform,
    string AgentVersion,
    string Status,
    IReadOnlyDictionary<string, string>? Metadata);

internal sealed partial class AgentStore
{
    private const int SchemaVersion = 1;
    private static readonly Regex IdPattern = new(
        "^[a-z0-9][a-z0-9._-]{2,127}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly object _sync = new();
    private readonly PortalPaths _paths;
    private readonly IDataProtector _protector;
    private AgentDocument _document;

    public AgentStore(
        PortalPaths paths,
        IDataProtectionProvider dataProtectionProvider)
    {
        _paths = paths;
        _protector = dataProtectionProvider.CreateProtector("SIRK.Portal.Agent.SigningKey.v1");
        _document = File.Exists(paths.AgentsFile)
            ? Validate(AtomicJsonFile.Read<AgentDocument>(paths.AgentsFile))
            : new AgentDocument(SchemaVersion, [], [], DateTimeOffset.UtcNow);
    }

    public AgentGroupIssue CreateGroup(
        string? id,
        string? name,
        string? description)
    {
        var normalizedId = NormalizeId(id, "Group ID");
        var normalizedName = NormalizeText(name, "Group name", 128);
        var normalizedDescription = NormalizeOptionalText(description, "Group description", 512);

        lock (_sync)
        {
            if (_document.Groups.Any(value => value.Id == normalizedId))
                throw new InvalidOperationException("Agent group already exists.");

            var token = Base64Url(RandomNumberGenerator.GetBytes(32));
            var now = DateTimeOffset.UtcNow;
            var group = new AgentGroupRecord(
                normalizedId,
                normalizedName,
                normalizedDescription,
                HashToken(token),
                true,
                now,
                now);
            Save(_document with
            {
                Groups = _document.Groups.Append(group).ToArray(),
                UpdatedAtUtc = now
            });
            return new AgentGroupIssue(group, token);
        }
    }

    public AgentGroupIssue RotateGroupToken(string groupId)
    {
        var normalized = NormalizeId(groupId, "Group ID");
        lock (_sync)
        {
            var groups = _document.Groups.ToArray();
            var index = Array.FindIndex(groups, value => value.Id == normalized);
            if (index < 0) throw new KeyNotFoundException("Agent group was not found.");

            var token = Base64Url(RandomNumberGenerator.GetBytes(32));
            var now = DateTimeOffset.UtcNow;
            groups[index] = groups[index] with
            {
                EnrollmentTokenHashBase64 = HashToken(token),
                UpdatedAtUtc = now
            };
            Save(_document with { Groups = groups, UpdatedAtUtc = now });
            return new AgentGroupIssue(groups[index], token);
        }
    }

    public AgentGroupRecord UpdateGroup(
        string groupId,
        string? name,
        string? description,
        bool? enabled)
    {
        var normalized = NormalizeId(groupId, "Group ID");
        lock (_sync)
        {
            var groups = _document.Groups.ToArray();
            var index = Array.FindIndex(groups, value => value.Id == normalized);
            if (index < 0) throw new KeyNotFoundException("Agent group was not found.");
            var current = groups[index];
            var now = DateTimeOffset.UtcNow;
            groups[index] = current with
            {
                Name = name is null ? current.Name : NormalizeText(name, "Group name", 128),
                Description = description is null
                    ? current.Description
                    : NormalizeOptionalText(description, "Group description", 512),
                Enabled = enabled ?? current.Enabled,
                UpdatedAtUtc = now
            };
            Save(_document with { Groups = groups, UpdatedAtUtc = now });
            return groups[index];
        }
    }

    public void DeleteGroup(string groupId)
    {
        var normalized = NormalizeId(groupId, "Group ID");
        lock (_sync)
        {
            if (_document.Devices.Any(value => value.GroupId == normalized))
                throw new InvalidOperationException("Agent group contains enrolled devices.");
            if (!_document.Groups.Any(value => value.Id == normalized))
                throw new KeyNotFoundException("Agent group was not found.");
            Save(_document with
            {
                Groups = _document.Groups.Where(value => value.Id != normalized).ToArray(),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });
        }
    }

    public AgentDeviceIssue Enroll(
        AgentEnrollmentRequest request,
        string remoteAddress,
        bool enrollmentTokenPrevalidated)
    {
        ArgumentNullException.ThrowIfNull(request);
        var groupId = NormalizeId(request.GroupId, "Group ID");
        var tenantId = NormalizeId(request.TenantId, "Tenant ID");
        var requestedDeviceId = string.IsNullOrWhiteSpace(request.DeviceId)
            ? "dev-" + Guid.NewGuid().ToString("N")
            : NormalizeId(request.DeviceId, "Device ID");

        lock (_sync)
        {
            var group = _document.Groups.FirstOrDefault(value => value.Id == groupId)
                        ?? throw new KeyNotFoundException("Agent group was not found.");
            if (!group.Enabled) throw new UnauthorizedAccessException("Agent group is disabled.");
            if (!enrollmentTokenPrevalidated &&
                !VerifyToken(request.EnrollmentToken, group.EnrollmentTokenHashBase64))
            {
                throw new UnauthorizedAccessException("Enrollment token is invalid.");
            }
            if (_document.Devices.Any(value => value.Id == requestedDeviceId))
                throw new InvalidOperationException("Device is already enrolled.");

            var deviceToken = Base64Url(RandomNumberGenerator.GetBytes(32));
            var signingKey = SHA256.HashData(Encoding.UTF8.GetBytes(deviceToken));
            string protectedKey;
            try
            {
                protectedKey = _protector.Protect(Convert.ToBase64String(signingKey));
            }
            finally
            {
                CryptographicOperations.ZeroMemory(signingKey);
            }

            var now = DateTimeOffset.UtcNow;
            var device = new AgentDeviceRecord(
                requestedDeviceId,
                groupId,
                tenantId,
                NormalizeText(request.Name, "Device name", 128),
                NormalizeText(request.HostName, "Host name", 255),
                NormalizeText(request.Platform, "Platform", 128),
                NormalizeText(request.AgentVersion, "Agent version", 64),
                protectedKey,
                true,
                "enrolled",
                NormalizeOptionalText(remoteAddress, "Remote address", 128),
                now,
                null,
                now,
                NormalizeMetadata(request.Metadata));
            Save(_document with
            {
                Devices = _document.Devices.Append(device).ToArray(),
                UpdatedAtUtc = now
            });
            return new AgentDeviceIssue(device, deviceToken);
        }
    }

    public AgentDeviceRecord Heartbeat(
        string deviceId,
        AgentHeartbeatRequest request,
        string remoteAddress)
    {
        lock (_sync)
        {
            var devices = _document.Devices.ToArray();
            var index = Array.FindIndex(devices, value => value.Id == deviceId);
            if (index < 0) throw new KeyNotFoundException("Device was not found.");
            var current = devices[index];
            if (!current.Enabled) throw new UnauthorizedAccessException("Device is disabled.");
            var now = DateTimeOffset.UtcNow;
            devices[index] = current with
            {
                Name = NormalizeText(request.Name, "Device name", 128),
                HostName = NormalizeText(request.HostName, "Host name", 255),
                Platform = NormalizeText(request.Platform, "Platform", 128),
                AgentVersion = NormalizeText(request.AgentVersion, "Agent version", 64),
                Status = NormalizeText(request.Status, "Status", 64).ToLowerInvariant(),
                RemoteAddress = NormalizeOptionalText(remoteAddress, "Remote address", 128),
                LastSeenAtUtc = now,
                UpdatedAtUtc = now,
                Metadata = NormalizeMetadata(request.Metadata)
            };
            Save(_document with { Devices = devices, UpdatedAtUtc = now });
            return devices[index];
        }
    }

    public AgentDeviceRecord UpdateDevice(
        string deviceId,
        string? groupId,
        string? name,
        bool? enabled)
    {
        var normalizedDeviceId = NormalizeId(deviceId, "Device ID");
        lock (_sync)
        {
            var devices = _document.Devices.ToArray();
            var index = Array.FindIndex(devices, value => value.Id == normalizedDeviceId);
            if (index < 0) throw new KeyNotFoundException("Device was not found.");
            var current = devices[index];
            var nextGroup = groupId is null ? current.GroupId : NormalizeId(groupId, "Group ID");
            if (!_document.Groups.Any(value => value.Id == nextGroup && value.Enabled))
                throw new InvalidDataException("Target agent group does not exist or is disabled.");
            var now = DateTimeOffset.UtcNow;
            devices[index] = current with
            {
                GroupId = nextGroup,
                Name = name is null ? current.Name : NormalizeText(name, "Device name", 128),
                Enabled = enabled ?? current.Enabled,
                UpdatedAtUtc = now
            };
            Save(_document with { Devices = devices, UpdatedAtUtc = now });
            return devices[index];
        }
    }

    public void DeleteDevice(string deviceId)
    {
        var normalized = NormalizeId(deviceId, "Device ID");
        lock (_sync)
        {
            if (!_document.Devices.Any(value => value.Id == normalized))
                throw new KeyNotFoundException("Device was not found.");
            Save(_document with
            {
                Devices = _document.Devices.Where(value => value.Id != normalized).ToArray(),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });
        }
    }

    public AgentDeviceRecord? GetDevice(string deviceId)
    {
        lock (_sync)
        {
            return _document.Devices.FirstOrDefault(value => value.Id == deviceId);
        }
    }

    public byte[] GetSigningKey(string deviceId)
    {
        lock (_sync)
        {
            var device = _document.Devices.FirstOrDefault(value => value.Id == deviceId)
                         ?? throw new KeyNotFoundException("Device was not found.");
            if (!device.Enabled) throw new UnauthorizedAccessException("Device is disabled.");
            var value = _protector.Unprotect(device.ProtectedSigningKey);
            return Convert.FromBase64String(value);
        }
    }

    public object Snapshot()
    {
        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            return new
            {
                groups = _document.Groups
                    .OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(value => new
                    {
                        value.Id,
                        value.Name,
                        value.Description,
                        value.Enabled,
                        deviceCount = _document.Devices.Count(device => device.GroupId == value.Id),
                        value.CreatedAtUtc,
                        value.UpdatedAtUtc
                    })
                    .ToArray(),
                devices = _document.Devices
                    .OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(value => PublicDevice(value, now))
                    .ToArray(),
                generatedAtUtc = now
            };
        }
    }

    public object PublicDevice(AgentDeviceRecord device) =>
        PublicDevice(device, DateTimeOffset.UtcNow);

    public string BootstrapScript(
        string groupId,
        string enrollmentToken,
        string portalOrigin,
        bool interactive)
    {
        _ = NormalizeId(groupId, "Group ID");
        if (!Uri.TryCreate(portalOrigin, UriKind.Absolute, out var origin) ||
            origin.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(origin.PathAndQuery.Trim('/')))
        {
            throw new InvalidDataException("Portal origin must be an absolute HTTPS origin.");
        }
        if (string.IsNullOrWhiteSpace(enrollmentToken))
            throw new InvalidDataException("Enrollment token is required.");

        var mode = interactive ? "Interactive" : "Silent";
        return $$"""
        #requires -Version 5.1
        $ErrorActionPreference = 'Stop'
        $PortalUrl = '{{origin.GetLeftPart(UriPartial.Authority)}}'
        $GroupId = '{{groupId.Replace("'", "''", StringComparison.Ordinal)}}'
        $EnrollmentToken = '{{enrollmentToken.Replace("'", "''", StringComparison.Ordinal)}}'
        $Mode = '{{mode}}'
        $Installer = Join-Path $env:TEMP ('Install-SirkAgent-' + [guid]::NewGuid().ToString('N') + '.ps1')
        try {
            Invoke-WebRequest -UseBasicParsing -Uri ($PortalUrl + '/api/v1/agent/install-script') -OutFile $Installer
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Installer -PortalUrl $PortalUrl -GroupId $GroupId -EnrollmentToken $EnrollmentToken -Mode $Mode
            if ($LASTEXITCODE -ne 0) { throw "SIRK Agent installer failed with exit code $LASTEXITCODE." }
        }
        finally {
            Remove-Item -LiteralPath $Installer -Force -ErrorAction SilentlyContinue
            Remove-Variable EnrollmentToken -ErrorAction SilentlyContinue
        }
        """;
    }

    private static object PublicDevice(AgentDeviceRecord device, DateTimeOffset now)
    {
        var online = device.Enabled &&
                     device.LastSeenAtUtc is { } lastSeen &&
                     now - lastSeen <= TimeSpan.FromMinutes(3);
        return new
        {
            device.Id,
            device.GroupId,
            device.TenantId,
            device.Name,
            device.HostName,
            device.Platform,
            device.AgentVersion,
            device.Enabled,
            status = online ? "online" : device.Status,
            online,
            device.RemoteAddress,
            device.EnrolledAtUtc,
            device.LastSeenAtUtc,
            device.UpdatedAtUtc,
            device.Metadata
        };
    }

    private void Save(AgentDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_paths.AgentsFile, _document);
    }

    private static AgentDocument Validate(AgentDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Agent store schema is unsupported.");
        if (value.Groups.GroupBy(group => group.Id, StringComparer.Ordinal).Any(group => group.Count() > 1) ||
            value.Devices.GroupBy(device => device.Id, StringComparer.Ordinal).Any(group => group.Count() > 1))
        {
            throw new InvalidDataException("Agent store contains duplicate identifiers.");
        }
        return value;
    }

    private static string NormalizeId(string? value, string field)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (!IdPattern.IsMatch(normalized))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }

    private static string NormalizeText(string? value, string field, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is < 1 || normalized.Length > maximum || normalized.Any(char.IsControl))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }

    private static string NormalizeOptionalText(string? value, string field, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length > maximum || normalized.Any(char.IsControl))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }

    private static IReadOnlyDictionary<string, string> NormalizeMetadata(
        IReadOnlyDictionary<string, string>? source)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in source ?? new Dictionary<string, string>())
        {
            var key = item.Key.Trim();
            var value = item.Value.Trim();
            if (key.Length is < 1 or > 64 || value.Length > 1024 ||
                key.Any(char.IsControl) || value.Any(char.IsControl))
            {
                throw new InvalidDataException("Device metadata is invalid.");
            }
            if (result.Count >= 64) throw new InvalidDataException("Device metadata contains too many items.");
            result[key] = value;
        }
        return result;
    }

    private static string HashToken(string token) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));

    private static bool VerifyToken(string token, string expectedBase64)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        byte[] expected;
        try
        {
            expected = Convert.FromBase64String(expectedBase64);
        }
        catch (FormatException)
        {
            return false;
        }
        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim()));
        try
        {
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(expected);
            CryptographicOperations.ZeroMemory(actual);
        }
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}