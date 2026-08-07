using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace Sirk.Portal.ProtocolTests;

internal static class StandaloneUiCssContract
{
    [ModuleInitializer]
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var baseCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "base.css"));
        var index = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "index.html"));

        Require(Regex.Matches(baseCss, @"(?m)^\.sirk-standalone-header\s*\{").Count == 1,
            "Standalone header must have one canonical CSS rule.");
        Require(!baseCss.Contains(".sirk-standalone-content.sirk-unified-content > .sirk-view-shell,\n.sirk-standalone-content.sirk-unified-content > .sirk-view-shell", StringComparison.Ordinal),
            "Unified view-shell selector must not be duplicated in one rule group.");
        Require(!baseCss.Contains(".sirk-portal-view-host > .sirk-view-shell,\n.sirk-portal-view-host > .sirk-view-shell", StringComparison.Ordinal),
            "Portal view-host child selector must not be duplicated.");

        var shared = index.IndexOf("shared-ui/shared-ui.css", StringComparison.Ordinal);
        var standalone = index.IndexOf("portal-standalone.css", StringComparison.Ordinal);
        Require(shared >= 0 && standalone > shared,
            "Shared UI CSS must load before the standalone override layer.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj")))
                return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
