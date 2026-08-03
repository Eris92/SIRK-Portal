using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Security;

internal sealed record PortalAuditEvent(
    string ActorId,
    string ActorName,
    string Action,
    string TargetType,
    string TargetId,
    bool Success,
    string RemoteAddress,
    string TraceId,
    IReadOnlyDictionary<string, string>? Details = null);

internal sealed record PortalAuditEntry(
    long Sequence,
    DateTimeOffset TimestampUtc,
    PortalAuditEvent Event,
    string PreviousHash,
    string Hash);

internal sealed class PortalAuditLog
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object _sync = new();
    private readonly string _path;
    private long _sequence;
    private string _lastHash = string.Empty;

    public PortalAuditLog(PortalPaths paths)
    {
        _path = paths.AuditFile;
        VerifyIntegrity();
    }

    public void Write(PortalAuditEvent value)
    {
        ArgumentNullException.ThrowIfNull(value);
        lock (_sync)
        {
            var sequence = checked(_sequence + 1);
            var timestamp = DateTimeOffset.UtcNow;
            var canonical = JsonSerializer.SerializeToUtf8Bytes(
                new
                {
                    sequence,
                    timestampUtc = timestamp,
                    value.ActorId,
                    value.ActorName,
                    value.Action,
                    value.TargetType,
                    value.TargetId,
                    value.Success,
                    value.RemoteAddress,
                    value.TraceId,
                    details = value.Details ?? new Dictionary<string, string>()
                },
                JsonOptions);
            var previous = Encoding.UTF8.GetBytes(_lastHash);
            var input = new byte[previous.Length + canonical.Length];
            previous.CopyTo(input, 0);
            canonical.CopyTo(input, previous.Length);
            var hash = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
            CryptographicOperations.ZeroMemory(input);

            var entry = new PortalAuditEntry(sequence, timestamp, value, _lastHash, hash);
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            using (var stream = new FileStream(
                       _path,
                       FileMode.Append,
                       FileAccess.Write,
                       FileShare.Read,
                       16 * 1024,
                       FileOptions.WriteThrough))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true))
            {
                writer.WriteLine(JsonSerializer.Serialize(entry, JsonOptions));
                writer.Flush();
                stream.Flush(flushToDisk: true);
            }
            AtomicJsonFile.SecureFile(_path);
            _sequence = sequence;
            _lastHash = hash;
        }
    }

    public IReadOnlyList<PortalAuditEntry> Read(int limit)
    {
        limit = Math.Clamp(limit, 1, 1000);
        lock (_sync)
        {
            if (!File.Exists(_path)) return [];
            return File.ReadLines(_path, Encoding.UTF8)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(line => JsonSerializer.Deserialize<PortalAuditEntry>(line, JsonOptions)
                                ?? throw new InvalidDataException("Audit entry is empty."))
                .TakeLast(limit)
                .ToArray();
        }
    }

    public void VerifyIntegrity()
    {
        lock (_sync)
        {
            _sequence = 0;
            _lastHash = string.Empty;
            if (!File.Exists(_path)) return;

            foreach (var line in File.ReadLines(_path, Encoding.UTF8))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var entry = JsonSerializer.Deserialize<PortalAuditEntry>(line, JsonOptions)
                            ?? throw new InvalidDataException("Audit entry is empty.");
                if (entry.Sequence != _sequence + 1 ||
                    !string.Equals(entry.PreviousHash, _lastHash, StringComparison.Ordinal))
                {
                    throw new InvalidDataException("Portal audit sequence is invalid.");
                }

                var canonical = JsonSerializer.SerializeToUtf8Bytes(
                    new
                    {
                        sequence = entry.Sequence,
                        timestampUtc = entry.TimestampUtc,
                        entry.Event.ActorId,
                        entry.Event.ActorName,
                        entry.Event.Action,
                        entry.Event.TargetType,
                        entry.Event.TargetId,
                        entry.Event.Success,
                        entry.Event.RemoteAddress,
                        entry.Event.TraceId,
                        details = entry.Event.Details ?? new Dictionary<string, string>()
                    },
                    JsonOptions);
                var previous = Encoding.UTF8.GetBytes(entry.PreviousHash);
                var input = new byte[previous.Length + canonical.Length];
                previous.CopyTo(input, 0);
                canonical.CopyTo(input, previous.Length);
                var expected = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
                CryptographicOperations.ZeroMemory(input);
                if (!CryptographicOperations.FixedTimeEquals(
                        Encoding.ASCII.GetBytes(expected),
                        Encoding.ASCII.GetBytes(entry.Hash)))
                {
                    throw new InvalidDataException("Portal audit hash chain is invalid.");
                }

                _sequence = entry.Sequence;
                _lastHash = entry.Hash;
            }
        }
    }
}
