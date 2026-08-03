using System.Text.Json;
using Sirk.Portal.Agent;

namespace Sirk.Portal.Workflows;

internal sealed class WorkflowExecutionService
{
    private readonly ApprovalStore _approvals;
    private readonly AgentCommandStore _commands;

    public WorkflowExecutionService(
        ApprovalStore approvals,
        AgentCommandStore commands)
    {
        _approvals = approvals;
        _commands = commands;
    }

    public ApprovalRequestRecord ExecuteIfApproved(
        ApprovalRequestRecord request,
        string actorId,
        string actorName)
    {
        if (request.Status != "approved") return request;
        try
        {
            var command = request.Type switch
            {
                "commands" or "management" => QueueScript(request.Payload, actorId, actorName),
                "move-requests" => QueueMove(request.Payload, actorId, actorName),
                _ => throw new InvalidOperationException(
                    $"Approval provider {request.Type} has no execution handler.")
            };
            var result = JsonSerializer.SerializeToElement(new
            {
                id = command.Id,
                commandId = command.Id,
                deviceId = command.DeviceId,
                status = command.Status,
                message = "Operation was queued for the Agent."
            });
            return _approvals.SetExecutionResult(
                request.Id,
                success: true,
                result,
                error: null);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or KeyNotFoundException)
        {
            return _approvals.SetExecutionResult(
                request.Id,
                success: false,
                result: null,
                error: exception.Message);
        }
    }

    private AgentCommandRecord QueueScript(
        JsonElement payload,
        string actorId,
        string actorName)
    {
        var deviceId = RequiredString(payload, "deviceId", "nodeId");
        var parameters = JsonSerializer.SerializeToElement(new
        {
            shell = RequiredString(payload, "shell"),
            command = RequiredString(payload, "command"),
            runAsUser = OptionalInt(payload, "runAsUser"),
            variables = OptionalObject(payload, "variables"),
            label = OptionalString(payload, "label"),
            scriptPath = OptionalString(payload, "scriptPath"),
            scriptHash = OptionalString(payload, "scriptHash")
        });
        return _commands.Queue(
            new AgentCommandQueueRequest(
                deviceId,
                "script.run",
                parameters,
                TimeoutSeconds: 3600),
            actorId,
            actorName);
    }

    private AgentCommandRecord QueueMove(
        JsonElement payload,
        string actorId,
        string actorName)
    {
        var deviceId = RequiredString(payload, "deviceId", "nodeId");
        var targetGroupId = RequiredString(payload, "targetGroupId");
        var parameters = JsonSerializer.SerializeToElement(new
        {
            action = "move-group",
            targetGroupId,
            sourceGroupId = OptionalString(payload, "sourceGroupId")
        });
        return _commands.Queue(
            new AgentCommandQueueRequest(
                deviceId,
                "script.run",
                parameters,
                TimeoutSeconds: 300),
            actorId,
            actorName);
    }

    private static string RequiredString(
        JsonElement source,
        string name,
        string? fallbackName = null)
    {
        var value = OptionalString(source, name);
        if (string.IsNullOrWhiteSpace(value) && fallbackName is not null)
            value = OptionalString(source, fallbackName);
        return !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidDataException($"Workflow payload is missing {name}.");
    }

    private static string OptionalString(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static int OptionalInt(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.TryGetInt32(out var result)
            ? result
            : 0;

    private static JsonElement OptionalObject(JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object &&
            source.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.Object)
        {
            return value.Clone();
        }
        return JsonSerializer.SerializeToElement(new Dictionary<string, string>());
    }
}
