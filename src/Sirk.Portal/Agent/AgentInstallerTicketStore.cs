using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Agent;

internal sealed record AgentInstallerTicketRecord(
    string Id,
    string GroupId,
    string TokenHashBase64,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    DateTimeOffset? UsedAtUtc);

internal sealed record AgentInstallerTicketDocument(
    int SchemaVersion,
    IReadOnlyList<AgentInstallerTicketRecord> Tickets,
    DateTimeOffset UpdatedAtUtc);

internal sealed record AgentInstallerTicketIssue(
    string Id,
    string GroupId,
    string EnrollmentTicket,
    DateTimeOffset ExpiresAtUtc);

internal sealed class AgentInstallerTicketStore
{
    private const int SchemaVersion = 1;
    private const int MaximumTickets = 2048;
    private static readonly Regex GroupIdPattern = new(
        "^[a-z0-9][a-z0-9._-]{2,127}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex TicketIdPattern = new(
        "^install-[a-f0-9]{20}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly object _sync = new();
    private readonly PortalPaths _paths;
    private AgentInstallerTicketDocument _document;

    public AgentInstallerTicketStore(PortalPaths paths)
    {
        _paths = paths;
        _document = File.Exists(paths.AgentInstallerTicketsFile)
            ? Validate(AtomicJsonFile.Read<AgentInstallerTicketDocument>(paths.AgentInstallerTicketsFile))
            : new AgentInstallerTicketDocument(SchemaVersion, [], DateTimeOffset.UtcNow);
    }

    public AgentInstallerTicketIssue Issue(string groupId, TimeSpan lifetime)
    {
        var normalizedGroupId = NormalizeGroupId(groupId);
        var boundedLifetime = TimeSpan.FromMinutes(Math.Clamp(lifetime.TotalMinutes, 5, 7 * 24 * 60));
        lock (_sync)
        {
            EnsureEnabledGroup(normalizedGroupId);
            var now = DateTimeOffset.UtcNow;
            var id = "install-" + Guid.NewGuid().ToString("N")[..20];
            var secret = Base64Url(RandomNumberGenerator.GetBytes(32));
            var token = id + "." + secret;
            var ticket = new AgentInstallerTicketRecord(
                id,
                normalizedGroupId,
                HashToken(token),
                now,
                now.Add(boundedLifetime),
                null);
            var tickets = Prune(_document.Tickets, now)
                .Append(ticket)
                .TakeLast(MaximumTickets)
                .ToArray();
            Save(new AgentInstallerTicketDocument(SchemaVersion, tickets, now));
            return new AgentInstallerTicketIssue(id, normalizedGroupId, token, ticket.ExpiresAtUtc);
        }
    }

    public bool TryConsume(string groupId, string token)
    {
        var normalizedGroupId = NormalizeGroupId(groupId);
        var normalizedToken = (token ?? string.Empty).Trim();
        var separator = normalizedToken.IndexOf('.');
        if (separator <= 0) return false;
        var id = normalizedToken[..separator];
        if (!TicketIdPattern.IsMatch(id)) return false;

        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            var tickets = Prune(_document.Tickets, now).ToArray();
            var index = Array.FindIndex(tickets, value =>
                value.Id == id &&
                value.GroupId == normalizedGroupId &&
                value.UsedAtUtc is null &&
                value.ExpiresAtUtc > now &&
                VerifyToken(normalizedToken, value.TokenHashBase64));
            if (index < 0)
            {
                if (tickets.Length != _document.Tickets.Count)
                    Save(new AgentInstallerTicketDocument(SchemaVersion, tickets, now));
                return false;
            }

            tickets[index] = tickets[index] with { UsedAtUtc = now };
            Save(new AgentInstallerTicketDocument(SchemaVersion, tickets, now));
            return true;
        }
    }

    public void Revoke(string ticketId)
    {
        var normalized = (ticketId ?? string.Empty).Trim().ToLowerInvariant();
        if (!TicketIdPattern.IsMatch(normalized)) return;
        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            Save(new AgentInstallerTicketDocument(
                SchemaVersion,
                Prune(_document.Tickets, now)
                    .Where(value => value.Id != normalized)
                    .ToArray(),
                now));
        }
    }

    public int ActiveCount(string groupId)
    {
        var normalized = NormalizeGroupId(groupId);
        lock (_sync)
        {
            var now = DateTimeOffset.UtcNow;
            return _document.Tickets.Count(value =>
                value.GroupId == normalized &&
                value.UsedAtUtc is null &&
                value.ExpiresAtUtc > now);
        }
    }

    private void EnsureEnabledGroup(string groupId)
    {
        if (!File.Exists(_paths.AgentsFile))
            throw new KeyNotFoundException("Agent group was not found.");
        var agents = AtomicJsonFile.Read<AgentDocument>(_paths.AgentsFile);
        if (!agents.Groups.Any(value => value.Id == groupId && value.Enabled))
            throw new KeyNotFoundException("Agent group was not found or is disabled.");
    }

    private void Save(AgentInstallerTicketDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_paths.AgentInstallerTicketsFile, _document);
    }

    private static AgentInstallerTicketDocument Validate(AgentInstallerTicketDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Agent installer ticket schema is unsupported.");
        if (value.Tickets.Count > MaximumTickets ||
            value.Tickets.GroupBy(ticket => ticket.Id, StringComparer.Ordinal).Any(group => group.Count() > 1) ||
            value.Tickets.Any(ticket =>
                !TicketIdPattern.IsMatch(ticket.Id) ||
                !GroupIdPattern.IsMatch(ticket.GroupId) ||
                ticket.ExpiresAtUtc <= ticket.CreatedAtUtc ||
                Convert.FromBase64String(ticket.TokenHashBase64).Length != 32))
        {
            throw new InvalidDataException("Agent installer ticket store is invalid.");
        }
        return value;
    }

    private static IReadOnlyList<AgentInstallerTicketRecord> Prune(
        IReadOnlyList<AgentInstallerTicketRecord> source,
        DateTimeOffset now) =>
        source.Where(ticket =>
                ticket.ExpiresAtUtc > now ||
                (ticket.UsedAtUtc is { } used && used > now.AddDays(-7)))
            .TakeLast(MaximumTickets)
            .ToArray();

    private static string NormalizeGroupId(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (!GroupIdPattern.IsMatch(normalized))
            throw new InvalidDataException("Agent group ID is invalid.");
        return normalized;
    }

    private static string HashToken(string token) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));

    private static bool VerifyToken(string token, string expectedBase64)
    {
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
