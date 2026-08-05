from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT / "public/portal/standalone/scripts/device-workspace.js"
PROGRAM = ROOT / "tests/Sirk.Portal.ProtocolTests/Program.cs"
CONTRACT = ROOT / "tests/Sirk.Portal.ProtocolTests/DesktopImageCodecUiContract.cs"


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}")
    return value.replace(old, new, 1)


workspace = WORKSPACE.read_text(encoding="utf-8-sig")
workspace = replace_once(
    workspace,
    '<option value="minimum">Minimalny transfer</option></select></label><button type="button" data-agent-desktop-connect>',
    '<option value="minimum">Minimalny transfer</option></select></label>'
    '<label>Kodek<select data-agent-desktop-codec><option value="auto">Auto (profil)</option>'
    '<option value="webp">WebP</option><option value="png">PNG</option>'
    '<option value="jpeg">JPEG</option><option value="h264">H.264</option></select></label>'
    '<label>Jakość<select data-agent-desktop-quality><option value="auto">Auto (profil)</option>'
    '<option value="40">40%</option><option value="50">50%</option><option value="60">60%</option>'
    '<option value="70">70%</option><option value="80">80%</option><option value="85">85%</option>'
    '<option value="90">90%</option><option value="100">100%</option></select></label>'
    '<button type="button" data-agent-desktop-connect>',
    "codec and quality controls",
)
workspace = replace_once(
    workspace,
    '''        var profile = host.querySelector("[data-agent-desktop-profile]");
        var textInput = host.querySelector("[data-agent-desktop-text]");
''',
    '''        var profile = host.querySelector("[data-agent-desktop-profile]");
        var codec = host.querySelector("[data-agent-desktop-codec]");
        var quality = host.querySelector("[data-agent-desktop-quality]");
        var textInput = host.querySelector("[data-agent-desktop-text]");
''',
    "codec control references",
)
workspace = replace_once(
    workspace,
    '''        var profiles = {
            smooth: { maxWidth: 1920, quality: 72, targetKbps: 1000, targetFps: 120, frameMode: "tiles", deltaScalePercent: 25 },
            text: { maxWidth: 1920, quality: 80, targetKbps: 1000, targetFps: 60, frameMode: "tiles", deltaScalePercent: 50 },
            video: { maxWidth: 1920, quality: 72, targetKbps: 1000, targetFps: 60, frameMode: "h264", deltaScalePercent: 100 },
            weak: { maxWidth: 1600, quality: 65, targetKbps: 700, targetFps: 30, frameMode: "tiles", deltaScalePercent: 35 },
            minimum: { maxWidth: 1920, quality: 68, targetKbps: 550, targetFps: 15, frameMode: "tiles", deltaScalePercent: 50 }
        };
''',
    '''        var profiles = {
            smooth: { maxWidth: 1920, quality: 85, targetKbps: 2500, targetFps: 120,
                codec: "webp", deltaScalePercent: 100 },
            text: { maxWidth: 1920, quality: 100, targetKbps: 8000, targetFps: 30,
                codec: "png", deltaScalePercent: 100 },
            video: { maxWidth: 1920, quality: 85, targetKbps: 3000, targetFps: 60,
                codec: "h264", deltaScalePercent: 100 },
            weak: { maxWidth: 1600, quality: 60, targetKbps: 800, targetFps: 30,
                codec: "jpeg", deltaScalePercent: 60 },
            minimum: { maxWidth: 1280, quality: 40, targetKbps: 450, targetFps: 15,
                codec: "jpeg", deltaScalePercent: 35 }
        };
''',
    "readable desktop profiles",
)
workspace = replace_once(
    workspace,
    '''        function effectiveProfile() {
            if (profile.value !== "auto") return profiles[profile.value];
            return profiles[activeAutoProfile];
        }
''',
    '''        function effectiveProfile() {
            var base = profile.value !== "auto" ? profiles[profile.value] : profiles[activeAutoProfile];
            var requestedCodec = codec.value === "auto" ? base.codec : codec.value;
            var requestedQuality = quality.value === "auto" ? base.quality : Number(quality.value);
            return Object.assign({}, base, {
                codec: requestedCodec,
                imageEncoding: requestedCodec === "h264" ? "webp" : requestedCodec,
                frameMode: requestedCodec === "h264" ? "h264" : "tiles",
                quality: requestedCodec === "png" ? 100 : requestedQuality
            });
        }
        function updateCodecControls() {
            var settings = effectiveProfile();
            quality.disabled = settings.codec === "png" || settings.codec === "h264";
            quality.title = settings.codec === "png"
                ? "PNG jest bezstratny — jakość wynosi 100%."
                : settings.codec === "h264"
                    ? "Jakość H.264 jest sterowana limitem bitrate."
                    : "Jakość kompresji obrazu.";
        }
        function streamProfileParameters(settings) {
            return { action: "streamProfile", maxWidth: settings.maxWidth,
                quality: settings.quality, targetKbps: settings.targetKbps,
                targetFps: settings.targetFps, frameMode: settings.frameMode,
                imageEncoding: settings.imageEncoding,
                deltaScalePercent: settings.deltaScalePercent };
        }
''',
    "effective codec profile",
)
workspace = replace_once(
    workspace,
    '''                    var adaptive = profiles[nextProfile];
                    input({ action: "streamProfile", maxWidth: adaptive.maxWidth,
                        quality: adaptive.quality, targetKbps: adaptive.targetKbps,
                        targetFps: adaptive.targetFps, frameMode: adaptive.frameMode,
                        deltaScalePercent: adaptive.deltaScalePercent }).catch(function () {});
''',
    '''                    var adaptive = effectiveProfile();
                    updateCodecControls();
                    input(streamProfileParameters(adaptive)).catch(function () {});
''',
    "adaptive codec-aware profile",
)
workspace = replace_once(
    workspace,
    '''            var settings = effectiveProfile();
            var streamProfile = { action: "streamProfile", maxWidth: settings.maxWidth,
                quality: settings.quality, targetKbps: settings.targetKbps,
                targetFps: settings.targetFps, frameMode: settings.frameMode,
                deltaScalePercent: settings.deltaScalePercent };
''',
    '''            var settings = effectiveProfile();
            updateCodecControls();
            var streamProfile = streamProfileParameters(settings);
''',
    "restart codec-aware profile",
)
workspace = replace_once(
    workspace,
    '''        function renderJpegFrame(buffer, data, generation, requestStarted) {
''',
    '''        function renderImageFrame(buffer, data, generation, requestStarted) {
''',
    "generic image renderer name",
)
workspace = replace_once(
    workspace,
    '''            return createImageBitmap(new Blob([buffer], { type: "image/jpeg" })).then(function (decoded) {
''',
    '''            var contentType = String(data.contentType || "image/webp");
            return createImageBitmap(new Blob([buffer], { type: contentType })).then(function (decoded) {
''',
    "generic image blob content type",
)
workspace = replace_once(
    workspace,
    '''                setStreamStatus("Połączono · kafelki dirty-region · " + desktopWidth + " × " + desktopHeight +
                    " · atlas " + Number(data.width || 0) + " × " + Number(data.height || 0));
''',
    '''                setStreamStatus("Połączono · kafelki dirty-region · " + desktopWidth + " × " + desktopHeight +
                    " · atlas " + Number(data.width || 0) + " × " + Number(data.height || 0) +
                    " · " + String(data.encoding || contentType));
''',
    "image codec stream status",
)
workspace = replace_once(
    workspace,
    '''                if (data.contentType === "image/jpeg") {
''',
    '''                if (/^image\/(?:jpeg|png|webp)$/i.test(String(data.contentType || ""))) {
''',
    "generic websocket image content types",
)
workspace = replace_once(
    workspace,
    '''                    renderJpegFrame(packet.subarray(4 + metadataLength), data, generation, performance.now())
''',
    '''                    renderImageFrame(packet.subarray(4 + metadataLength), data, generation, performance.now())
''',
    "generic websocket image renderer call",
)
workspace = replace_once(
    workspace,
    '''                var jpegFrame = value.contentType.indexOf("image/jpeg") === 0;
                sourceWidth = Number(data.sourceWidth || data.width || 0);
                sourceHeight = Number(data.sourceHeight || data.height || 0);
                nativeWidth = jpegFrame ? sourceWidth : Number(data.width || sourceWidth);
                nativeHeight = jpegFrame ? sourceHeight : Number(data.height || sourceHeight);
''',
    '''                var imageFrame = /^image\/(?:jpeg|png|webp)/i.test(value.contentType);
                sourceWidth = Number(data.sourceWidth || data.width || 0);
                sourceHeight = Number(data.sourceHeight || data.height || 0);
                nativeWidth = imageFrame ? sourceWidth : Number(data.width || sourceWidth);
                nativeHeight = imageFrame ? sourceHeight : Number(data.height || sourceHeight);
''',
    "generic HTTP image dimensions",
)
workspace = replace_once(
    workspace,
    '''                    var frameDescription = jpegFrame
                        ? sourceWidth + " × " + sourceHeight + " · atlas " +
                            Number(data.width || 0) + " × " + Number(data.height || 0)
                        : sourceWidth + " × " + sourceHeight + " → " +
                            nativeWidth + " × " + nativeHeight;
''',
    '''                    var frameDescription = imageFrame
                        ? sourceWidth + " × " + sourceHeight + " · atlas " +
                            Number(data.width || 0) + " × " + Number(data.height || 0) +
                            " · " + String(data.encoding || value.contentType)
                        : sourceWidth + " × " + sourceHeight + " → " +
                            nativeWidth + " × " + nativeHeight;
''',
    "generic HTTP image status",
)
workspace = replace_once(
    workspace,
    '''        monitor.addEventListener("change", restartStream);
        profile.addEventListener("change", restartStream);
''',
    '''        monitor.addEventListener("change", restartStream);
        profile.addEventListener("change", function () {
            codec.value = "auto";
            quality.value = "auto";
            updateCodecControls();
            restartStream();
        });
        codec.addEventListener("change", function () {
            updateCodecControls();
            restartStream();
        });
        quality.addEventListener("change", restartStream);
        updateCodecControls();
''',
    "codec control event handlers",
)
for forbidden in [
    'data.contentType === "image/jpeg"',
    'function renderJpegFrame',
    'deltaScalePercent: 25',
    'deltaScalePercent: 50 },\n            video'
]:
    if forbidden in workspace:
        raise RuntimeError(f"Legacy unreadable desktop behavior remains: {forbidden}")
for required in [
    'data-agent-desktop-codec', 'data-agent-desktop-quality', 'imageEncoding: settings.imageEncoding',
    'codec: "webp", deltaScalePercent: 100', 'codec: "png", deltaScalePercent: 100',
    'image\\/(?:jpeg|png|webp)'
]:
    if required not in workspace:
        raise RuntimeError(f"Desktop codec UI marker missing: {required}")
WORKSPACE.write_text(workspace, encoding="utf-8", newline="\n")

contract = '''namespace Sirk.Portal.ProtocolTests;

internal static class DesktopImageCodecUiContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",
            "scripts", "device-workspace.js"));

        foreach (var marker in new[]
                 {
                     "data-agent-desktop-codec", "data-agent-desktop-quality",
                     "imageEncoding: settings.imageEncoding", "codec: \\\"webp\\\"",
                     "codec: \\\"png\\\"", "codec: \\\"jpeg\\\"",
                     "image\\\\/(?:jpeg|png|webp)", "Math"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Desktop codec UI marker is missing: " + marker);

        Require(workspace.Contains("deltaScalePercent: 100", StringComparison.Ordinal),
            "Readable WebP and PNG profiles must use full-resolution dirty regions.");
        Require(!workspace.Contains("data.contentType === \\\"image/jpeg\\\"", StringComparison.Ordinal),
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
'''
CONTRACT.write_text(contract, encoding="utf-8", newline="\n")

program = PROGRAM.read_text(encoding="utf-8-sig")
program = replace_once(
    program,
    "DesktopCanvasContract.Run();\n",
    "DesktopCanvasContract.Run();\nDesktopImageCodecUiContract.Run();\n",
    "desktop codec UI contract invocation",
)
PROGRAM.write_text(program, encoding="utf-8", newline="\n")

print("Desktop codec and quality controls applied.")
