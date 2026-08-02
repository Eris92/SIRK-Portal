using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Security;

internal sealed record PortalPasswordHash(
    string Algorithm,
    int Iterations,
    string SaltBase64,
    string HashBase64);

internal sealed record PortalUserRecord(
    string Id,
    string UserName,
    string DisplayName,
    string Role,
    bool Enabled,
    int SessionVersion,
    PortalPasswordHash Password,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

internal sealed record PortalGroupRecord(
    string Id,
    string Name,
    string Description,
    IReadOnlyList<string> MemberIds,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

internal sealed record PortalIdentityDocument(
    int SchemaVersion,
    string AccessCodeHashBase64,
    IReadOnlyList<PortalUserRecord> Users,
    IReadOnlyList<PortalGroupRecord> Groups,
    DateTimeOffset UpdatedAtUtc);

internal sealed record PortalAuthenticatedIdentity(
    string Id,
    string UserName,
    string DisplayName,
    string Role,
    int SessionVersion);

internal sealed class PortalIdentityStore
{
    private const int SchemaVersion = 1;
    private const int PasswordIterations = 600_000;
    private const int SaltBytes = 32;
    private const int HashBytes = 64;

    private static readonly Regex UserNamePattern = new(
        "^[a-z0-9][a-z0-9._-]{2,63}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex GroupIdPattern = new(
        "^[a-z0-9][a-z0-9-]{2,62}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly object _sync = new();
    private readonly PortalPaths _paths;
    private readonly PortalSecurityOptions _options;
    private PortalIdentityDocument _document;

    public PortalIdentityStore(
        PortalPaths paths,
        IOptions<PortalSecurityOptions> options,
        ILogger<PortalIdentityStore> logger)
    {
        _paths = paths;
        _options = options.Value;
        _document = File.Exists(paths.IdentityFile)
            ? Validate(AtomicJsonFile.Read<PortalIdentityDocument>(paths.IdentityFile))
            : Empty();

        if (_document.Users.Count == 0)
        {
            TryBootstrap(logger);
        }
    }

    public bool IsInitialized
    {
        get
        {
            lock (_sync)
            {
                return _document.Users.Count > 0;
            }
        }
    }

    public IReadOnlyList<string> Roles => PortalRoles.All;

    public PortalAuthenticatedIdentity? Authenticate(
        string? userName,
        string? password,
        string? accessCode)
    {
        var normalized = NormalizeUserName(userName, throwOnInvalid: false);
        if (normalized is null || string.IsNullOrEmpty(password)) return null;

        lock (_sync)
        {
            var user = _document.Users.FirstOrDefault(value =>
                value.Enabled &&
                string.Equals(value.UserName, normalized, StringComparison.Ordinal));
            if (user is null || !VerifyPassword(password, user.Password)) return null;

            if (string.Equals(user.Role, PortalRoles.BreakGlass, StringComparison.Ordinal) &&
                !VerifyAccessCode(accessCode))
            {
                return null;
            }

            return ToAuthenticated(user);
        }
    }

    public PortalAuthenticatedIdentity? ResolveSession(
        string userId,
        int sessionVersion)
    {
        lock (_sync)
        {
            var user = _document.Users.FirstOrDefault(value =>
                value.Enabled &&
                value.SessionVersion == sessionVersion &&
                string.Equals(value.Id, userId, StringComparison.Ordinal));
            return user is null ? null : ToAuthenticated(user);
        }
    }

    public PortalAuthenticatedIdentity? Get(string userId)
    {
        lock (_sync)
        {
            var user = _document.Users.FirstOrDefault(value =>
                string.Equals(value.Id, userId, StringComparison.Ordinal));
            return user is null ? null : ToAuthenticated(user);
        }
    }

    public object Snapshot()
    {
        lock (_sync)
        {
            return new
            {
                initialized = _document.Users.Count > 0,
                users = _document.Users
                    .OrderBy(value => value.UserName, StringComparer.Ordinal)
                    .Select(value => new
                    {
                        value.Id,
                        value.UserName,
                        value.DisplayName,
                        value.Role,
                        value.Enabled,
                        value.SessionVersion,
                        value.CreatedAtUtc,
                        value.UpdatedAtUtc
                    })
                    .ToArray(),
                groups = _document.Groups
                    .OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(value => new
                    {
                        value.Id,
                        value.Name,
                        value.Description,
                        value.MemberIds,
                        value.CreatedAtUtc,
                        value.UpdatedAtUtc
                    })
                    .ToArray(),
                roles = PortalRoles.All
            };
        }
    }

    public PortalAuthenticatedIdentity CreateUser(
        string? userName,
        string? displayName,
        string? password,
        string? role)
    {
        var normalized = NormalizeUserName(userName, throwOnInvalid: true)!;
        var normalizedDisplayName = NormalizeDisplayName(displayName);
        var normalizedRole = NormalizeRole(role);
        ValidatePassword(password);

        lock (_sync)
        {
            if (_document.Users.Any(value =>
                    string.Equals(value.UserName, normalized, StringComparison.Ordinal)))
            {
                throw new InvalidDataException("A user with this name already exists.");
            }

            var now = DateTimeOffset.UtcNow;
            var user = new PortalUserRecord(
                "usr-" + Guid.NewGuid().ToString("N"),
                normalized,
                normalizedDisplayName,
                normalizedRole,
                true,
                1,
                HashPassword(password!),
                now,
                now);
            Save(_document with
            {
                Users = _document.Users.Append(user).ToArray(),
                UpdatedAtUtc = now
            });
            return ToAuthenticated(user);
        }
    }

    public PortalAuthenticatedIdentity UpdateUser(
        string userId,
        string? displayName,
        string? role,
        bool? enabled,
        string actorId)
    {
        lock (_sync)
        {
            var users = _document.Users.ToArray();
            var index = Array.FindIndex(users, value =>
                string.Equals(value.Id, userId, StringComparison.Ordinal));
            if (index < 0) throw new KeyNotFoundException("User was not found.");

            var current = users[index];
            var nextRole = role is null ? current.Role : NormalizeRole(role);
            var nextEnabled = enabled ?? current.Enabled;
            if (string.Equals(current.Id, actorId, StringComparison.Ordinal) && !nextEnabled)
            {
                throw new InvalidOperationException("The current account cannot disable itself.");
            }

            if (string.Equals(current.Role, PortalRoles.BreakGlass, StringComparison.Ordinal) &&
                !string.Equals(nextRole, PortalRoles.BreakGlass, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("The Break-Glass role cannot be removed from the built-in account.");
            }

            var now = DateTimeOffset.UtcNow;
            users[index] = current with
            {
                DisplayName = displayName is null
                    ? current.DisplayName
                    : NormalizeDisplayName(displayName),
                Role = nextRole,
                Enabled = nextEnabled,
                SessionVersion = current.SessionVersion + 1,
                UpdatedAtUtc = now
            };
            Save(_document with { Users = users, UpdatedAtUtc = now });
            return ToAuthenticated(users[index]);
        }
    }

    public void DeleteUser(string userId, string actorId)
    {
        lock (_sync)
        {
            var user = _document.Users.FirstOrDefault(value =>
                string.Equals(value.Id, userId, StringComparison.Ordinal))
                ?? throw new KeyNotFoundException("User was not found.");
            if (string.Equals(user.Id, actorId, StringComparison.Ordinal))
                throw new InvalidOperationException("The current account cannot delete itself.");
            if (string.Equals(user.Role, PortalRoles.BreakGlass, StringComparison.Ordinal))
                throw new InvalidOperationException("The built-in Break-Glass account cannot be deleted.");

            var now = DateTimeOffset.UtcNow;
            Save(_document with
            {
                Users = _document.Users.Where(value => value.Id != userId).ToArray(),
                Groups = _document.Groups.Select(group => group with
                {
                    MemberIds = group.MemberIds.Where(id => id != userId).ToArray(),
                    UpdatedAtUtc = group.MemberIds.Contains(userId, StringComparer.Ordinal)
                        ? now
                        : group.UpdatedAtUtc
                }).ToArray(),
                UpdatedAtUtc = now
            });
        }
    }

    public void ChangePassword(
        string userId,
        string currentPassword,
        string newPassword)
    {
        ValidatePassword(newPassword);
        lock (_sync)
        {
            var users = _document.Users.ToArray();
            var index = Array.FindIndex(users, value => value.Id == userId);
            if (index < 0) throw new KeyNotFoundException("User was not found.");
            if (!VerifyPassword(currentPassword, users[index].Password))
                throw new UnauthorizedAccessException("The current password is invalid.");

            var now = DateTimeOffset.UtcNow;
            users[index] = users[index] with
            {
                Password = HashPassword(newPassword),
                SessionVersion = users[index].SessionVersion + 1,
                UpdatedAtUtc = now
            };
            Save(_document with { Users = users, UpdatedAtUtc = now });
        }
    }

    public string RotateAccessCode(string actorId, string currentPassword)
    {
        lock (_sync)
        {
            var actor = _document.Users.FirstOrDefault(value => value.Id == actorId)
                        ?? throw new KeyNotFoundException("User was not found.");
            if (!string.Equals(actor.Role, PortalRoles.BreakGlass, StringComparison.Ordinal))
                throw new UnauthorizedAccessException("Only Break-Glass can rotate the access code.");
            if (!VerifyPassword(currentPassword, actor.Password))
                throw new UnauthorizedAccessException("The current password is invalid.");

            var accessCode = Base64Url(RandomNumberGenerator.GetBytes(32));
            Save(_document with
            {
                AccessCodeHashBase64 = HashAccessCode(accessCode),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });
            return accessCode;
        }
    }

    public PortalGroupRecord SaveGroup(
        string? id,
        string? name,
        string? description,
        IReadOnlyList<string>? memberIds)
    {
        var normalizedId = NormalizeGroupId(id);
        var normalizedName = NormalizeDisplayName(name);
        var normalizedDescription = (description ?? string.Empty).Trim();
        if (normalizedDescription.Length > 512)
            throw new InvalidDataException("Group description is too long.");

        lock (_sync)
        {
            var members = (memberIds ?? [])
                .Select(value => value.Trim())
                .Where(value => _document.Users.Any(user => user.Id == value))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            var groups = _document.Groups.ToList();
            var index = groups.FindIndex(value => value.Id == normalizedId);
            var now = DateTimeOffset.UtcNow;
            var value = index < 0
                ? new PortalGroupRecord(
                    normalizedId,
                    normalizedName,
                    normalizedDescription,
                    members,
                    now,
                    now)
                : groups[index] with
                {
                    Name = normalizedName,
                    Description = normalizedDescription,
                    MemberIds = members,
                    UpdatedAtUtc = now
                };
            if (index < 0) groups.Add(value);
            else groups[index] = value;
            Save(_document with { Groups = groups, UpdatedAtUtc = now });
            return value;
        }
    }

    public void DeleteGroup(string groupId)
    {
        var normalized = NormalizeGroupId(groupId);
        lock (_sync)
        {
            if (!_document.Groups.Any(value => value.Id == normalized))
                throw new KeyNotFoundException("Group was not found.");
            Save(_document with
            {
                Groups = _document.Groups.Where(value => value.Id != normalized).ToArray(),
                UpdatedAtUtc = DateTimeOffset.UtcNow
            });
        }
    }

    private void TryBootstrap(ILogger logger)
    {
        var password = ReadSecret(
            _options.BootstrapPasswordFile,
            "SIRK_BOOTSTRAP_PASSWORD_FILE",
            "SIRK_BOOTSTRAP_PASSWORD");
        if (string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning(
                "SIRK Portal identity is not initialized. Provide SIRK_BOOTSTRAP_PASSWORD_FILE during installation.");
            return;
        }

        ValidatePassword(password);
        var accessCode = ReadSecret(
            _options.BootstrapAccessCodeFile,
            "SIRK_BOOTSTRAP_ACCESS_CODE_FILE",
            "SIRK_BOOTSTRAP_ACCESS_CODE");
        var generatedAccessCode = string.IsNullOrWhiteSpace(accessCode);
        accessCode = generatedAccessCode
            ? Base64Url(RandomNumberGenerator.GetBytes(32))
            : accessCode.Trim();

        var now = DateTimeOffset.UtcNow;
        var user = new PortalUserRecord(
            "usr-" + Guid.NewGuid().ToString("N"),
            NormalizeUserName(_options.BootstrapUserName, throwOnInvalid: true)!,
            NormalizeDisplayName(_options.BootstrapDisplayName),
            PortalRoles.BreakGlass,
            true,
            1,
            HashPassword(password),
            now,
            now);
        Save(new PortalIdentityDocument(
            SchemaVersion,
            HashAccessCode(accessCode),
            [user],
            [],
            now));

        if (generatedAccessCode)
        {
            var output = Path.Combine(_paths.DataRoot, "break-glass-access-code.txt");
            File.WriteAllText(output, accessCode + Environment.NewLine, new UTF8Encoding(false));
            AtomicJsonFile.SecureFile(output);
            logger.LogWarning(
                "A one-time Break-Glass access code was generated in {AccessCodeFile}. Remove the file after secure retrieval.",
                output);
        }

        logger.LogInformation("SIRK Portal Break-Glass identity was initialized.");
    }

    private static string? ReadSecret(
        string configuredFile,
        string environmentFileName,
        string environmentValueName)
    {
        var file = string.IsNullOrWhiteSpace(configuredFile)
            ? Environment.GetEnvironmentVariable(environmentFileName)
            : configuredFile;
        if (!string.IsNullOrWhiteSpace(file) && File.Exists(file))
        {
            return File.ReadAllText(file, Encoding.UTF8).Trim();
        }

        return Environment.GetEnvironmentVariable(environmentValueName)?.Trim();
    }

    private bool VerifyAccessCode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            string.IsNullOrWhiteSpace(_document.AccessCodeHashBase64))
        {
            return false;
        }

        byte[] expected;
        try
        {
            expected = Convert.FromBase64String(_document.AccessCodeHashBase64);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(value.Trim()));
        try
        {
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(actual);
            CryptographicOperations.ZeroMemory(expected);
        }
    }

    private void Save(PortalIdentityDocument document)
    {
        _document = Validate(document);
        AtomicJsonFile.Write(_paths.IdentityFile, _document);
    }

    private static PortalIdentityDocument Empty() =>
        new(SchemaVersion, string.Empty, [], [], DateTimeOffset.UtcNow);

    private static PortalIdentityDocument Validate(PortalIdentityDocument document)
    {
        if (document.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Portal identity schema is unsupported.");
        if (document.Users.GroupBy(value => value.Id, StringComparer.Ordinal).Any(group => group.Count() > 1) ||
            document.Users.GroupBy(value => value.UserName, StringComparer.Ordinal).Any(group => group.Count() > 1))
        {
            throw new InvalidDataException("Portal identity store contains duplicate users.");
        }
        if (document.Groups.GroupBy(value => value.Id, StringComparer.Ordinal).Any(group => group.Count() > 1))
            throw new InvalidDataException("Portal identity store contains duplicate groups.");
        return document;
    }

    private static PortalAuthenticatedIdentity ToAuthenticated(PortalUserRecord user) =>
        new(user.Id, user.UserName, user.DisplayName, user.Role, user.SessionVersion);

    private static PortalPasswordHash HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            PasswordIterations,
            HashAlgorithmName.SHA512,
            HashBytes);
        try
        {
            return new PortalPasswordHash(
                "PBKDF2-SHA512",
                PasswordIterations,
                Convert.ToBase64String(salt),
                Convert.ToBase64String(hash));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(salt);
            CryptographicOperations.ZeroMemory(hash);
        }
    }

    private static bool VerifyPassword(string password, PortalPasswordHash value)
    {
        if (!string.Equals(value.Algorithm, "PBKDF2-SHA512", StringComparison.Ordinal) ||
            value.Iterations < 210_000)
        {
            return false;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(value.SaltBase64);
            expected = Convert.FromBase64String(value.HashBase64);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            value.Iterations,
            HashAlgorithmName.SHA512,
            expected.Length);
        try
        {
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(salt);
            CryptographicOperations.ZeroMemory(expected);
            CryptographicOperations.ZeroMemory(actual);
        }
    }

    private static string HashAccessCode(string value) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static void ValidatePassword(string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 14 || password.Length > 256)
            throw new InvalidDataException("Password must contain between 14 and 256 characters.");
        if (!password.Any(char.IsUpper) ||
            !password.Any(char.IsLower) ||
            !password.Any(char.IsDigit) ||
            !password.Any(character => !char.IsLetterOrDigit(character)))
        {
            throw new InvalidDataException(
                "Password must contain uppercase, lowercase, numeric and special characters.");
        }
    }

    private static string? NormalizeUserName(string? value, bool throwOnInvalid)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (UserNamePattern.IsMatch(normalized)) return normalized;
        if (throwOnInvalid)
            throw new InvalidDataException("User name is invalid.");
        return null;
    }

    private static string NormalizeDisplayName(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is < 1 or > 128 || normalized.Any(char.IsControl))
            throw new InvalidDataException("Display name is invalid.");
        return normalized;
    }

    private static string NormalizeRole(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (!PortalRoles.All.Contains(normalized, StringComparer.Ordinal))
            throw new InvalidDataException("Role is invalid.");
        return normalized;
    }

    private static string NormalizeGroupId(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (!GroupIdPattern.IsMatch(normalized))
            throw new InvalidDataException("Group ID is invalid.");
        return normalized;
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
