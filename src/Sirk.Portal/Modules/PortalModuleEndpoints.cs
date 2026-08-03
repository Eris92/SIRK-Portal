using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Sirk.Portal.Agent;
using Sirk.Portal.Automation;
using Sirk.Portal.Security;
using Sirk.Portal.Settings;
using Sirk.Portal.Workflows;

namespace Sirk.Portal.Modules;

internal sealed record ModuleExecutionRequest(
    string? DeviceId,
    string? NodeId,
    string? NodeName,
    string? CommandId,
    string? ScriptPath,
    string? ScriptHash,
    string? Command,
    string? Shell,
    string? Label,
    int? RunAsUser,
    IReadOnlyDictionary<string, string>? VariableValues,
    IReadOnlyList<int>? ApprovalLevels,
    bool? ConfirmedExecution,
    string? Note);

internal sealed record ScriptDeleteRequest(string Path);

internal static class PortalModuleEndpoints
{
    public static IEndpointRouteBuilder MapPortalModules(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/bootstrap", Bootstrap)
            .RequireAuthorization();
        endpoints.MapGet("/api/v1/devices", Devices)
            .RequireAuthorization(PortalPolicies.DeviceRead);

        var modules = endpoints
            .MapGroup("/api/v1/modules")
            .RequireAuthorization();
        modules.MapGet("/{module}/{action}", GetModuleAsync);
        modules.MapPost("/{module}/{action}", PostModuleAsync);

        return endpoints;
    }

    private static IResult Bootstrap(
        HttpContext context,
        PortalIdentityStore identities,
        PortalSettingsStore settings)
    {
        var identity = CurrentIdentity(context, identities);
        return identity is null
            ? Results.Unauthorized()
            : Results.Ok(settings.Bootstrap(identity, identities));
    }

    private static IResult Devices(AgentStore agents) =>
        Results.Ok(new { ok = true, value = agents.Snapshot() });

    private static async Task<IResult> GetModuleAsync(
        string module,
        string action,
        HttpContext context,
        PortalIdentityStore identities,
        PortalSettingsStore settings,
        AgentStore agents,
        AgentCommandStore commands,
        ScriptStore scripts,
        ApprovalStore approvals)
    {
        var identity = CurrentIdentity(context, identities);
        if (identity is null) return Results.Unauthorized();
        module = NormalizeKey(module);
        action = NormalizeKey(action);
        if (!settings.IsModuleAllowed(module, identity, identities))
            return PortalAuthenticationEndpoints.Error(403, "MODULE_ACCESS_DENIED", "Module access is denied.");

        try
        {
            return (module, action) switch
            {
                ("approvals", "providers") => Results.Ok(new
                {
                    ok = true,
                    providers = new[]
                    {
                        Provider("move-requests", "Move Requests"),
                        Provider("commands", "Commands"),
                        Provider("management", "Management")
                    }
                }),
                ("approvals", "overview") => Results.Ok(new
                {
                    ok = true,
                    cards = approvals.Overview(identity.Id)
                }),
                ("approvals", "requests") => Results.Ok(new
                {
                    ok = true,
                    requests = approvals.List(
                        context.Request.Query["type"].ToString(),
                        context.Request.Query["status"].ToString(),
                        CanReviewAll(identity.Role) ? null : identity.Id,
                        ParseLimit(context, 500))
                }),
                ("approvals", "request") => ApprovalRequest(
                    approvals,
                    context.Request.Query["id"].ToString()),
                ("approvals", "settings") => Results.Ok(new
                {
                    ok = true,
                    settings = settings.Module("approvals").Options
                }),
                ("move-requests", "groups") => Results.Ok(new
                {
                    ok = true,
                    groups = JsonSerializer.SerializeToElement(agents.Snapshot())
                        .GetProperty("groups")
                }),
                ("move-requests", "requests") => Results.Ok(new
                {
                    ok = true,
                    requests = approvals.List(
                        "move-requests",
                        context.Request.Query["status"].ToString(),
                        CanReviewAll(identity.Role) ? null : identity.Id,
                        ParseLimit(context, 500))
                }),
                ("move-requests", "settings") => RequireAdminResult(identity, () => Results.Ok(new
                {
                    ok = true,
                    settings = settings.Module("move-requests").Options,
                    groups = JsonSerializer.SerializeToElement(agents.Snapshot())
                        .GetProperty("groups")
                })),
                ("commands", "catalog") => Results.Ok(new
                {
                    ok = true,
                    catalog = BuiltInCommandCatalog.All
                }),
                ("commands", "tree") or ("management", "tree") => Results.Ok(new
                {
                    ok = true,
                    tree = scripts.Tree(module)
                }),
                ("commands", "script") or ("management", "script") => ScriptResult(
                    scripts,
                    module,
                    context.Request.Query["path"].ToString()),
                ("commands", "output") or ("management", "output") => OutputResult(
                    commands,
                    context.Request.Query["id"].ToString()),
                ("commands", "results") or ("management", "results") => Results.Ok(new
                {
                    ok = true,
                    rows = commands.List(
                        context.Request.Query["deviceId"].ToString(),
                        ParseLimit(context, 500))
                }),
                ("commands", "settings") or ("management", "settings") => Results.Ok(new
                {
                    ok = true,
                    settings = settings.Module(module).Options
                }),
                ("jira", _) or ("security", _) or ("monitoring", _) or
                ("assets", _) or ("reports", _) => Results.Ok(new
                {
                    ok = true,
                    module,
                    action,
                    settings = settings.Integration(module),
                    configured = settings.Secret(module + ".token") is not null
                }),
                _ => PortalAuthenticationEndpoints.Error(
                    404,
                    "MODULE_ACTION_NOT_FOUND",
                    "Module action was not found.")
            };
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "MODULE_RESOURCE_NOT_FOUND", exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return PortalAuthenticationEndpoints.Error(400, "MODULE_REQUEST_INVALID", exception.Message);
        }
    }

    private static async Task<IResult> PostModuleAsync(
        string module,
        string action,
        HttpContext context,
        IAntiforgery antiforgery,
        PortalIdentityStore identities,
        PortalSettingsStore settings,
        AgentStore agents,
        AgentCommandStore commands,
        ScriptStore scripts,
        ApprovalStore approvals,
        WorkflowExecutionService workflow,
        PortalAuditLog audit)
    {
        var identity = CurrentIdentity(context, identities);
        if (identity is null) return Results.Unauthorized();
        module = NormalizeKey(module);
        action = NormalizeKey(action);
        if (!settings.IsModuleAllowed(module, identity, identities))
            return PortalAuthenticationEndpoints.Error(403, "MODULE_ACCESS_DENIED", "Module access is denied.");
        var csrf = await PortalAuthenticationEndpoints.ValidateCsrfAsync(context, antiforgery);
        if (csrf is not null) return csrf;

        try
        {
            IResult result;
            if (module == "approvals" && action == "decide")
            {
                var request = await ReadJsonAsync<ApprovalDecisionRequest>(context);
                var decided = approvals.Decide(
                    request,
                    identity.Id,
                    identity.UserName,
                    ApprovalLevel(identity.Role),
                    CanReviewAll(identity.Role));
                decided = workflow.ExecuteIfApproved(decided, identity.Id, identity.UserName);
                Audit(audit, context, identity, "approval.decide", "approval", decided.Id, request.Approved);
                result = Results.Ok(new { ok = true, request = decided });
            }
            else if (module == "move-requests" && action == "submit")
            {
                var payload = await ReadJsonElementAsync(context);
                var request = approvals.Submit(
                    new ApprovalSubmitRequest(
                        "move-requests",
                        "Move " + ReadString(payload, "nodeName", "device"),
                        ReadString(payload, "sourceGroupName", "Current group") + " -> " +
                        ReadString(payload, "targetGroupName", ReadString(payload, "targetGroupId", string.Empty)),
                        payload,
                        ReadLevels(payload),
                        ReadString(payload, "note", string.Empty)),
                    identity.Id,
                    identity.UserName,
                    AllowNoApproval(settings.Module("move-requests")));
                request = workflow.ExecuteIfApproved(request, identity.Id, identity.UserName);
                Audit(audit, context, identity, "move-request.submit", "approval", request.Id, true);
                result = Results.Ok(new { ok = true, request });
            }
            else if (module is "commands" or "management" && action == "execute")
            {
                var request = await ReadJsonAsync<ModuleExecutionRequest>(context);
                var approval = SubmitExecution(
                    module,
                    request,
                    identity,
                    settings,
                    scripts,
                    approvals);
                approval = workflow.ExecuteIfApproved(approval, identity.Id, identity.UserName);
                Audit(audit, context, identity, "script.execute", "approval", approval.Id, true);
                result = Results.Ok(new { ok = true, request = approval });
            }
            else if (module is "commands" or "management" && action == "save")
            {
                RequireSettingsManage(identity);
                var request = await ReadJsonAsync<ScriptSaveRequest>(context);
                var script = scripts.Save(module, request);
                Audit(audit, context, identity, "script.save", "script", script.Path, true);
                result = Results.Ok(new { ok = true, script, tree = scripts.Tree(module) });
            }
            else if (module is "commands" or "management" && action == "delete")
            {
                RequireSettingsManage(identity);
                var request = await ReadJsonAsync<ScriptDeleteRequest>(context);
                scripts.Delete(module, request.Path);
                Audit(audit, context, identity, "script.delete", "script", request.Path, true);
                result = Results.Ok(new { ok = true, tree = scripts.Tree(module) });
            }
            else if (action == "settings")
            {
                RequireSettingsManage(identity);
                var payload = await ReadJsonElementAsync(context);
                var moduleSettings = settings.Module(module);
                var modules = new Dictionary<string, PortalModuleSettings>(StringComparer.Ordinal)
                {
                    [module] = moduleSettings with { Options = payload.Clone() }
                };
                var value = settings.Update(
                    new PortalSettingsUpdateRequest(null, modules, null, null),
                    identities);
                Audit(audit, context, identity, "module.settings.update", "module", module, true);
                result = Results.Ok(new { ok = true, value });
            }
            else
            {
                result = PortalAuthenticationEndpoints.Error(
                    404,
                    "MODULE_ACTION_NOT_FOUND",
                    "Module action was not found.");
            }
            return result;
        }
        catch (KeyNotFoundException exception)
        {
            return PortalAuthenticationEndpoints.Error(404, "MODULE_RESOURCE_NOT_FOUND", exception.Message);
        }
        catch (UnauthorizedAccessException exception)
        {
            return PortalAuthenticationEndpoints.Error(403, "MODULE_ACCESS_DENIED", exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or InvalidOperationException or JsonException)
        {
            return PortalAuthenticationEndpoints.Error(400, "MODULE_REQUEST_INVALID", exception.Message);
        }
    }

    private static ApprovalRequestRecord SubmitExecution(
        string module,
        ModuleExecutionRequest request,
        PortalAuthenticatedIdentity identity,
        PortalSettingsStore settings,
        ScriptStore scripts,
        ApprovalStore approvals)
    {
        var deviceId = FirstNotEmpty(request.DeviceId, request.NodeId)
                       ?? throw new InvalidDataException("Device ID is required.");
        string label;
        string shell;
        string command;
        int runAsUser;
        string scriptPath;
        string scriptHash;
        IReadOnlyList<int> levels;
        IReadOnlyDictionary<string, string> variables;

        if (!string.IsNullOrWhiteSpace(request.ScriptPath))
        {
            var script = scripts.Get(module, request.ScriptPath)
                         ?? throw new KeyNotFoundException("Script was not found.");
            if (!string.IsNullOrWhiteSpace(request.ScriptHash) &&
                !string.Equals(request.ScriptHash, script.Hash, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("The script changed after it was selected.");
            }
            if (script.ConfirmExecution && request.ConfirmedExecution != true)
                throw new InvalidDataException("Execution confirmation is required.");
            label = script.Label;
            shell = script.Shell;
            runAsUser = script.RunAsUser;
            scriptPath = script.Path;
            scriptHash = script.Hash;
            levels = request.ApprovalLevels ?? script.ApprovalLevels;
            variables = ScriptStore.ValidateValues(script, request.VariableValues);
            command = InjectVariables(script.Body, shell, variables);
        }
        else if (!string.IsNullOrWhiteSpace(request.CommandId))
        {
            var definition = BuiltInCommandCatalog.Find(request.CommandId)
                             ?? throw new KeyNotFoundException("Command preset was not found.");
            if (definition.ConfirmExecution && request.ConfirmedExecution != true)
                throw new InvalidDataException("Execution confirmation is required.");
            label = definition.Label;
            shell = definition.Shell;
            runAsUser = definition.RunAsUser;
            scriptPath = string.Empty;
            scriptHash = string.Empty;
            levels = request.ApprovalLevels ?? definition.ApprovalLevels;
            variables = ValidateCommandValues(definition, request.VariableValues);
            command = InjectVariables(definition.Command, shell, variables);
        }
        else
        {
            RequireSettingsManage(identity);
            label = string.IsNullOrWhiteSpace(request.Label) ? "Custom command" : request.Label.Trim();
            shell = NormalizeShell(request.Shell);
            command = request.Command ?? string.Empty;
            if (command.Length is < 1 or > 1024 * 1024 || command.Contains('\0'))
                throw new InvalidDataException("Command is invalid.");
            runAsUser = Math.Clamp(request.RunAsUser ?? 0, 0, 2);
            scriptPath = string.Empty;
            scriptHash = string.Empty;
            levels = request.ApprovalLevels ?? [1];
            variables = request.VariableValues ?? new Dictionary<string, string>();
        }

        var payload = JsonSerializer.SerializeToElement(new
        {
            deviceId,
            nodeId = deviceId,
            nodeName = request.NodeName ?? string.Empty,
            label,
            shell,
            command,
            runAsUser,
            variables,
            scriptPath,
            scriptHash,
            approvalLevels = levels
        });
        return approvals.Submit(
            new ApprovalSubmitRequest(
                module,
                label,
                "Execute on " + (request.NodeName ?? deviceId),
                payload,
                levels,
                request.Note),
            identity.Id,
            identity.UserName,
            AllowNoApproval(settings.Module(module)));
    }

    private static IReadOnlyDictionary<string, string> ValidateCommandValues(
        BuiltInCommand command,
        IReadOnlyDictionary<string, string>? supplied)
    {
        var source = supplied ?? new Dictionary<string, string>();
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var variable in command.Variables)
        {
            var value = source.TryGetValue(variable.Name, out var suppliedValue)
                ? suppliedValue
                : variable.DefaultValue;
            if (variable.Required && string.IsNullOrWhiteSpace(value))
                throw new InvalidDataException($"{variable.Label} is required.");
            if (value.Length > 16 * 1024 || value.Contains('\0'))
                throw new InvalidDataException($"{variable.Label} is invalid.");
            if (variable.Control == "select" && variable.Options.Count > 0 &&
                !variable.Options.Any(option => option.Value == value))
            {
                throw new InvalidDataException($"{variable.Label} has an invalid value.");
            }
            result[variable.Name] = value;
        }
        return result;
    }

    private static string InjectVariables(
        string command,
        string shell,
        IReadOnlyDictionary<string, string> values)
    {
        if (values.Count == 0) return command;
        if (shell == "powershell")
        {
            var prefix = string.Join(
                ";",
                values.Select(item =>
                    "$" + item.Key + "='" + item.Value.Replace("'", "''", StringComparison.Ordinal) + "'"));
            return prefix + ";" + command;
        }
        if (shell == "cmd")
        {
            var prefix = string.Join(
                "\r\n",
                values.Select(item =>
                    "set \"" + item.Key + "=" + EscapeCmd(item.Value) + "\""));
            return "@echo off\r\n" + prefix + "\r\n" + command;
        }
        var bashPrefix = string.Join(
            " ",
            values.Select(item =>
                item.Key + "='" + item.Value.Replace("'", "'\\''", StringComparison.Ordinal) + "'"));
        return bashPrefix + " " + command;
    }

    private static string EscapeCmd(string value) =>
        value.Replace("\r", " ", StringComparison.Ordinal)
            .Replace("\n", " ", StringComparison.Ordinal)
            .Replace("%", "%%", StringComparison.Ordinal)
            .Replace("^", "^^", StringComparison.Ordinal)
            .Replace("!", "^^!", StringComparison.Ordinal)
            .Replace("\"", "^\"", StringComparison.Ordinal);

    private static IResult ApprovalRequest(ApprovalStore approvals, string requestId)
    {
        var value = approvals.Get(requestId);
        return value is null
            ? PortalAuthenticationEndpoints.Error(404, "APPROVAL_NOT_FOUND", "Approval request was not found.")
            : Results.Ok(new { ok = true, request = value });
    }

    private static IResult ScriptResult(ScriptStore scripts, string library, string path)
    {
        var value = scripts.Get(library, path);
        return value is null
            ? PortalAuthenticationEndpoints.Error(404, "SCRIPT_NOT_FOUND", "Script was not found.")
            : Results.Ok(new { ok = true, script = value });
    }

    private static IResult OutputResult(AgentCommandStore commands, string commandId)
    {
        var command = commands.Get(commandId);
        if (command is null)
            return Results.Ok(new { ok = true, ready = false });
        var ready = command.Status is "completed" or "failed" or "expired";
        var output = command.Result?.ToString() ?? command.Error ?? string.Empty;
        return Results.Ok(new
        {
            ok = true,
            ready,
            status = command.Status,
            output,
            command
        });
    }

    private static PortalAuthenticatedIdentity? CurrentIdentity(
        HttpContext context,
        PortalIdentityStore identities)
    {
        var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var versionText = context.User.FindFirstValue("sirk:session_version");
        return id is not null && int.TryParse(versionText, out var version)
            ? identities.ResolveSession(id, version)
            : null;
    }

    private static object Provider(string type, string title) =>
        new
        {
            type,
            title,
            tabTitle = title,
            enabled = true,
            showTab = true,
            showOverview = true
        };

    private static IResult RequireAdminResult(
        PortalAuthenticatedIdentity identity,
        Func<IResult> factory) =>
        PortalPermissions.Has(identity.Role, "settings.manage")
            ? factory()
            : PortalAuthenticationEndpoints.Error(403, "ADMIN_REQUIRED", "Administrator permission is required.");

    private static void RequireSettingsManage(PortalAuthenticatedIdentity identity)
    {
        if (!PortalPermissions.Has(identity.Role, "settings.manage"))
            throw new UnauthorizedAccessException("Administrator permission is required.");
    }

    private static bool CanReviewAll(string role) =>
        role is PortalRoles.BreakGlass or PortalRoles.SecAdmin or PortalRoles.Admin or PortalRoles.EngineerL3;

    private static int ApprovalLevel(string role) =>
        role switch
        {
            PortalRoles.BreakGlass or PortalRoles.SecAdmin or PortalRoles.Admin => 3,
            PortalRoles.EngineerL3 => 3,
            PortalRoles.SupportL2 => 2,
            PortalRoles.OperatorL1 => 1,
            _ => 0
        };

    private static bool AllowNoApproval(PortalModuleSettings settings)
    {
        if (settings.Options.ValueKind != JsonValueKind.Object ||
            !settings.Options.TryGetProperty("allowNoApproval", out var value))
        {
            return false;
        }
        return value.ValueKind == JsonValueKind.True;
    }

    private static IReadOnlyList<int> ReadLevels(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("approvalLevels", out var levels) ||
            levels.ValueKind != JsonValueKind.Array)
        {
            return [1];
        }
        return levels.EnumerateArray()
            .Where(value => value.TryGetInt32(out _))
            .Select(value => value.GetInt32())
            .Where(value => value is >= 1 and <= 3)
            .Distinct()
            .OrderBy(value => value)
            .ToArray();
    }

    private static string ReadString(
        JsonElement payload,
        string name,
        string fallback)
    {
        if (payload.ValueKind == JsonValueKind.Object &&
            payload.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.String)
        {
            return value.GetString() ?? fallback;
        }
        return fallback;
    }

    private static int ParseLimit(HttpContext context, int fallback) =>
        int.TryParse(context.Request.Query["limit"], out var value)
            ? Math.Clamp(value, 1, 2000)
            : fallback;

    private static string NormalizeKey(string value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant();

    private static string NormalizeShell(string? value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "powershell" or "pwsh" => "powershell",
            "cmd" or "batch" => "cmd",
            "bash" => "bash",
            _ => throw new InvalidDataException("Command shell is invalid.")
        };

    private static string? FirstNotEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim().ToLowerInvariant();

    private static async Task<T> ReadJsonAsync<T>(HttpContext context) =>
        await context.Request.ReadFromJsonAsync<T>(cancellationToken: context.RequestAborted)
        ?? throw new JsonException("Request JSON body is empty.");

    private static async Task<JsonElement> ReadJsonElementAsync(HttpContext context)
    {
        var value = await context.Request.ReadFromJsonAsync<JsonElement>(cancellationToken: context.RequestAborted);
        if (value.ValueKind != JsonValueKind.Object)
            throw new JsonException("Request JSON body must be an object.");
        return value;
    }

    private static void Audit(
        PortalAuditLog audit,
        HttpContext context,
        PortalAuthenticatedIdentity identity,
        string action,
        string targetType,
        string targetId,
        bool success)
    {
        audit.Write(new PortalAuditEvent(
            identity.Id,
            identity.UserName,
            action,
            targetType,
            targetId,
            success,
            PortalAuthenticationEndpoints.RemoteAddress(context),
            context.TraceIdentifier));
    }
}
