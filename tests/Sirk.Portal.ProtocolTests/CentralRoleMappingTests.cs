using System.Runtime.CompilerServices;
using Sirk.Portal.Central;
using Sirk.Portal.Security;

namespace Sirk.Portal.ProtocolTests;

internal static class CentralRoleMappingTests
{
    [ModuleInitializer]
    internal static void Run()
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["BreakGlass"] = PortalRoles.SecAdmin,
            ["SecAdmin"] = PortalRoles.SecAdmin,
            ["Admin"] = PortalRoles.Admin,
            ["Auditor"] = PortalRoles.Auditor,
            ["OperatorL1"] = PortalRoles.OperatorL1,
            ["SupportL2"] = PortalRoles.SupportL2,
            ["EngineerL3"] = PortalRoles.EngineerL3
        };

        foreach (var item in expected)
        {
            var mapped = PortalCentralIdentityMapper.MapRole(item.Key);
            if (!string.Equals(mapped, item.Value, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Central role {item.Key} mapped to {mapped}, expected {item.Value}.");
            }
        }

        foreach (var unsupported in new[]
                 {
                     string.Empty,
                     "Break-Glass",
                     "Operator L1",
                     "UnknownRole"
                 })
        {
            try
            {
                _ = PortalCentralIdentityMapper.MapRole(unsupported);
                throw new InvalidOperationException(
                    $"Unsupported Central role was accepted: {unsupported}");
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        Console.WriteLine("SIRK Central to Portal canonical RBAC role mapping: OK");
    }
}
