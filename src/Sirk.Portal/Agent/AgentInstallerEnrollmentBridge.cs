using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sirk.Portal.Agent;

internal static class AgentInstallerTicketValidationScope
{
    private sealed record Validation(string GroupId, byte[] TokenHash);
    private static readonly AsyncLocal<Validation?> Current = new();

    public static IDisposable Enter(string groupId, string token)
    {
        var previous = Current.Value;
        Current.Value = new Validation(
            groupId.Trim().ToLowerInvariant(),
            SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim())));
        return new Scope(previous);
    }

    public static bool IsValidated(string groupId, string token)
    {
        var current = Current.Value;
        if (current is null ||
            !string.Equals(current.GroupId, groupId.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim()));
        try
        {
            return CryptographicOperations.FixedTimeEquals(current.TokenHash, actual);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(actual);
        }
    }

    private sealed class Scope(Validation? previous) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            var current = Current.Value;
            Current.Value = previous;
            if (current is not null)
                CryptographicOperations.ZeroMemory(current.TokenHash);
        }
    }
}

internal sealed class AgentInstallerTicketMiddleware(
    RequestDelegate next,
    AgentInstallerTicketStore tickets)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(HttpContext context)
    {
        if (!HttpMethods.IsPost(context.Request.Method) ||
            !context.Request.Path.Equals("/api/v1/agent/enroll"))
        {
            await next(context);
            return;
        }

        context.Request.EnableBuffering(64 * 1024, 256 * 1024);
        AgentEnrollmentRequest? request = null;
        try
        {
            request = await JsonSerializer.DeserializeAsync<AgentEnrollmentRequest>(
                context.Request.Body,
                JsonOptions,
                context.RequestAborted);
        }
        catch (JsonException)
        {
            // The canonical enrollment endpoint returns the final structured error.
        }
        finally
        {
            context.Request.Body.Position = 0;
        }

        if (request is null ||
            !tickets.TryConsume(request.GroupId, request.EnrollmentToken))
        {
            await next(context);
            return;
        }

        using var validation = AgentInstallerTicketValidationScope.Enter(
            request.GroupId,
            request.EnrollmentToken);
        await next(context);
    }
}

internal sealed partial class AgentStore
{
    public AgentDeviceIssue Enroll(
        AgentEnrollmentRequest request,
        string remoteAddress) =>
        Enroll(
            request,
            remoteAddress,
            AgentInstallerTicketValidationScope.IsValidated(
                request.GroupId,
                request.EnrollmentToken));
}
