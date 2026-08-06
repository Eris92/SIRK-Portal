namespace Sirk.Portal.ProtocolTests;

internal static class DesktopImageCodecUiContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",
            "scripts", "device-workspace.js"));

        foreach (var marker in new[]
                 {
                     "function effectiveProfile()", "imageEncoding: settings.imageEncoding",
                     "codec: \"webp\"", "codec: \"png\"", "codec: \"jpeg\"",
                     "image\\/(?:jpeg|png|webp)", "activeAutoProfile"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Desktop automatic codec marker is missing: " + marker);

        Require(!workspace.Contains("data-agent-desktop-codec", StringComparison.Ordinal) &&
                !workspace.Contains("data-agent-desktop-quality", StringComparison.Ordinal),
            "The screen-only desktop must not expose codec or quality controls.");

        Require(workspace.Contains("deltaScalePercent: 100", StringComparison.Ordinal),
            "Readable WebP and PNG profiles must use full-resolution dirty regions.");
        Require(!workspace.Contains("data.contentType === \"image/jpeg\"", StringComparison.Ordinal),
            "Desktop viewer must not be restricted to JPEG image frames.");
        Require(!workspace.Contains("function renderJpegFrame", StringComparison.Ordinal),
            "Desktop viewer must use a generic image-frame renderer.");
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
