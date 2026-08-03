using System.Text.Json;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Workflows;

internal sealed record ApprovalDecision(
    int Level,
    string DecidedById,
    string DecidedByName,
    bool Approved,
    string Note,
    DateTimeOffset DecidedAtUtc);

internal sealed record ApprovalRequestRecord(
    string Id,
    string Type,
    string Title,
    string Summary,
    JsonElement Payload,
    string RequestedById,
    string RequestedByName,
    IReadOnlyList<int> RequiredLevels,
    IReadOnlyList<ApprovalDecision> Decisions,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    JsonElement? ExecutionResult,
    string? ExecutionError);

internal sealed record ApprovalDocument(
    int SchemaVersion,
    IReadOnlyList<ApprovalRequestRecord> Requests,
    DateTimeOffset UpdatedAtUtc);

internal sealed record ApprovalSubmitRequest(
    string Type,
    string Title,
    string Summary,
    JsonElement Payload,
    IReadOnlyList<int>? ApprovalLevels,
    string? Note);

internal sealed record ApprovalDecisionRequest(
    string RequestId,
    bool Approved,
    string? Note,
    int? Level);

internal sealed class ApprovalStore
{
    private const int SchemaVersion = 1;
    private const int MaximumRequests = 20_000;
    private readonly object _sync = new();
    private readonly string _path;
    private ApprovalDocument _document;

    public ApprovalStore(PortalPaths paths)
    {
        _path = Path.Combine(paths.DataRoot, "approvals.json");
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<ApprovalDocument>(_path))
            : new ApprovalDocument(SchemaVersion, [], DateTimeOffset.UtcNow);
    }

    public ApprovalRequestRecord Submit(
        ApprovalSubmitRequest request,
        string actorId,
        string actorName,
        bool allowNoApproval)
    {
        ArgumentNullException.ThrowIfNull(request);
        var type = NormalizeKey(request.Type, "Approval type");
        var title = NormalizeText(request.Title, "Approval title", 256);
        var summary = NormalizeOptionalText(request.Summary, "Approval summary", 2048);
        if (request.Payload.ValueKind is not JsonValueKind.Object)
            throw new InvalidDataException("Approval payload must be a JSON object.");
        if (request.Payload.GetRawText().Length > 1024 * 1024)
            throw new InvalidDataException("Approval payload is too large.");

        var levels = NormalizeLevels(request.ApprovalLevels);
        if (levels.Length == 0 && !allowNoApproval) levels = [1];
        var now = DateTimeOffset.UtcNow;
        var status = levels.Length == 0 ? "approved" : "pending";
        var value = new ApprovalRequestRecord(
            "apr-" + Guid.NewGuid().ToString("N"),
            type,
            title,
            summary,
            request.Payload.Clone(),
            actorId,
            actorName,
            levels,
            [],
            status,
            now,
            now,
            levels.Length == 0 ? now : null,
            null,
            null);
        lock (_sync)
        {
            var requests = _document.Requests
                .Append(value)
                .OrderBy(item => item.CreatedAtUtc)
                .TakeLast(MaximumRequests)
                .ToArray();
            Save(new ApprovalDocument(SchemaVersion, requests, now));
        }
        return value;
    }

    public ApprovalRequestRecord Decide(
        ApprovalDecisionRequest request,
        string actorId,
        string actorName,
        int actorLevel,
        bool privileged)
    {
        ArgumentNullException.ThrowIfNull(request);
        lock (_sync)
        {
            var requests = _document.Requests.ToArray();
            var index = Array.FindIndex(requests, item => item.Id == request.RequestId);
            if (index < 0) throw new KeyNotFoundException("Approval request was not found.");
            var current = requests[index];
            if (current.Status is not "pending")
                throw new InvalidOperationException("Approval request is no longer pending.");

            var nextLevel = current.RequiredLevels
                .FirstOrDefault(level => current.Decisions.All(decision => decision.Level != level));
            if (nextLevel == 0)
                throw new InvalidOperationException("Approval request has no pending decision level.");
            var requestedLevel = request.Level ?? nextLevel;
            if (requestedLevel != nextLevel)
                throw new InvalidDataException("Approval decisions must be processed in order.");
            if (!privileged && actorLevel < requestedLevel)
                throw new UnauthorizedAccessException("The current role cannot decide this approval level.");
            if (current.Decisions.Any(decision =>
                    decision.Level == requestedLevel && decision.DecidedById == actorId))
            {
                throw new InvalidOperationException("The current identity already decided this level.");
            }

            var now = DateTimeOffset.UtcNow;
            var decision = new ApprovalDecision(
                requestedLevel,
                actorId,
                actorName,
                request.Approved,
                NormalizeOptionalText(request.Note, "Decision note", 4096),
                now);
            var decisions = current.Decisions.Append(decision).ToArray();
            var allApproved = current.RequiredLevels.All(level =>
                decisions.Any(item => item.Level == level && item.Approved));
            var status = !request.Approved
                ? "rejected"
                : allApproved ? "approved" : "pending";
            var updated = current with
            {
                Decisions = decisions,
                Status = status,
                UpdatedAtUtc = now,
                CompletedAtUtc = status is "approved" or "rejected" ? now : null
            };
            requests[index] = updated;
            Save(new ApprovalDocument(SchemaVersion, requests, now));
            return updated;
        }
    }

    public ApprovalRequestRecord SetExecutionResult(
        string requestId,
        bool success,
        JsonElement? result,
        string? error)
    {
        lock (_sync)
        {
            var requests = _document.Requests.ToArray();
            var index = Array.FindIndex(requests, item => item.Id == requestId);
            if (index < 0) throw new KeyNotFoundException("Approval request was not found.");
            var current = requests[index];
            if (current.Status is not "approved")
                throw new InvalidOperationException("Only approved requests can be executed.");
            var now = DateTimeOffset.UtcNow;
            requests[index] = current with
            {
                Status = success ? "completed" : "failed",
                UpdatedAtUtc = now,
                CompletedAtUtc = now,
                ExecutionResult = result?.Clone(),
                ExecutionError = success ? null : NormalizeOptionalText(error, "Execution error", 16 * 1024)
            };
            Save(new ApprovalDocument(SchemaVersion, requests, now));
            return requests[index];
        }
    }

    public ApprovalRequestRecord? Get(string requestId)
    {
        lock (_sync)
        {
            return _document.Requests.FirstOrDefault(item => item.Id == requestId);
        }
    }

    public IReadOnlyList<ApprovalRequestRecord> List(
        string? type,
        string? status,
        string? actorId,
        int limit)
    {
        var normalizedType = string.IsNullOrWhiteSpace(type) ? null : type.Trim().ToLowerInvariant();
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? null : status.Trim().ToLowerInvariant();
        limit = Math.Clamp(limit, 1, 2000);
        lock (_sync)
        {
            return _document.Requests
                .Where(item => normalizedType is null || item.Type == normalizedType)
                .Where(item => normalizedStatus is null || item.Status == normalizedStatus)
                .Where(item => string.IsNullOrWhiteSpace(actorId) ||
                               item.RequestedById == actorId ||
                               item.Decisions.Any(decision => decision.DecidedById == actorId))
                .OrderByDescending(item => item.CreatedAtUtc)
                .Take(limit)
                .ToArray();
        }
    }

    public object Overview(string actorId)
    {
        lock (_sync)
        {
            return new
            {
                pending = _document.Requests.Count(item => item.Status == "pending"),
                approved = _document.Requests.Count(item => item.Status == "approved"),
                completed = _document.Requests.Count(item => item.Status == "completed"),
                rejected = _document.Requests.Count(item => item.Status == "rejected"),
                failed = _document.Requests.Count(item => item.Status == "failed"),
                mine = _document.Requests.Count(item => item.RequestedById == actorId),
                byProvider = _document.Requests
                    .GroupBy(item => item.Type, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => new
                        {
                            total = group.Count(),
                            pending = group.Count(item => item.Status == "pending")
                        },
                        StringComparer.Ordinal),
                generatedAtUtc = DateTimeOffset.UtcNow
            };
        }
    }

    public void PurgeOlderThan(DateTimeOffset threshold)
    {
        lock (_sync)
        {
            var requests = _document.Requests
                .Where(item => item.UpdatedAtUtc >= threshold || item.Status == "pending")
                .ToArray();
            if (requests.Length == _document.Requests.Count) return;
            Save(new ApprovalDocument(SchemaVersion, requests, DateTimeOffset.UtcNow));
        }
    }

    private void Save(ApprovalDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_path, _document);
    }

    private static ApprovalDocument Validate(ApprovalDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Approval schema is unsupported.");
        if (value.Requests.GroupBy(item => item.Id, StringComparer.Ordinal).Any(group => group.Count() > 1))
            throw new InvalidDataException("Approval store contains duplicate request IDs.");
        return value;
    }

    private static int[] NormalizeLevels(IReadOnlyList<int>? values) =>
        (values ?? [])
        .Where(level => level is >= 1 and <= 3)
        .Distinct()
        .OrderBy(level => level)
        .ToArray();

    private static string NormalizeKey(string? value, string field)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized.Length is < 1 or > 64 ||
            normalized.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
        {
            throw new InvalidDataException($"{field} is invalid.");
        }
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
        if (normalized.Length > maximum || normalized.Any(character => character is '\0'))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }
}
