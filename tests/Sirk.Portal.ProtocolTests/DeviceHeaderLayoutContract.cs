namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHeaderLayoutContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var app = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "app.js"));
        var tabs = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var css = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));

        Require(app.Contains("function applyHeaderView(view)", StringComparison.Ordinal),
            "Devices must have an explicit header layout state.");
        Require(app.Contains("title.hidden = devices", StringComparison.Ordinal) &&
                app.Contains("is-devices-view", StringComparison.Ordinal),
            "The Devices header title must be hidden without affecting other views.");
        Require(tabs.Contains("header.insertBefore(state.bar, anchor || null)", StringComparison.Ordinal),
            "Device tabs must be mounted inside the main header.");
        Require(!tabs.Contains("main.insertBefore(state.bar, content)", StringComparison.Ordinal),
            "Device tabs must not create a separate row above content.");
        Require(viewMode.Contains("header.insertBefore(host, userMenu || null)", StringComparison.Ordinal),
            "The view-mode button must be immediately before the user control.");
        Require(!viewMode.Contains("bar.appendChild(host)", StringComparison.Ordinal),
            "The view-mode button must not remain inside the tab strip.");
        Require(css.Contains(".sirk-standalone-header.is-devices-view #sirkUserName{display:none!important}", StringComparison.Ordinal),
            "Only Devices must hide the user name.");
        Require(css.Contains(".sirk-device-tabs-standalone{flex:1 1 auto", StringComparison.Ordinal),
            "Device tabs must fill the former title area.");
        Require(!css.Contains(".sirk-device-tabs-standalone:not([hidden]) + #sirkStandaloneContent", StringComparison.Ordinal),
            "The legacy standalone tab row contract must be removed.");
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
