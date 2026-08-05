namespace Sirk.Portal.ProtocolTests;

internal static class DesktopCanvasContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",
            "scripts", "device-workspace.js"));

        Require(workspace.Contains("var imageFrame = /^image\\/(?:jpeg|png|webp)/i.test(value.contentType);",
                StringComparison.Ordinal),
            "HTTP desktop transport must distinguish image tile atlases from encoded video frames.");
        Require(workspace.Contains("nativeWidth = imageFrame ? sourceWidth", StringComparison.Ordinal),
            "Image tile atlases must render into a source-sized desktop canvas.");
        Require(workspace.Contains("positionLocalCursor", StringComparison.Ordinal),
            "Remote cursor positioning must account for the fitted canvas rectangle.");
        Require(workspace.Contains("max-height:calc(100vh - 360px)", StringComparison.Ordinal),
            "The desktop canvas must be fitted to the available viewport.");
        Require(!workspace.Contains(
                "nativeWidth = Number(data.width || 0);\n                nativeHeight = Number(data.height || 0);",
                StringComparison.Ordinal),
            "The HTTP desktop canvas must not use encoded atlas dimensions.");
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
