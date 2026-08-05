from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_PATH = ROOT / "public/portal/standalone/scripts/device-workspace.js"
PROGRAM_PATH = ROOT / "tests/Sirk.Portal.ProtocolTests/Program.cs"
CONTRACT_PATH = ROOT / "tests/Sirk.Portal.ProtocolTests/DesktopCanvasContract.cs"


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}")
    return value.replace(old, new, 1)


workspace = WORKSPACE_PATH.read_text(encoding="utf-8-sig")
workspace = replace_once(
    workspace,
    '<div class="sirk-agent-desktop-stage" style="position:relative"><canvas data-agent-desktop-image aria-label="Zdalny pulpit" tabindex="0"></canvas>',
    '<div class="sirk-agent-desktop-stage" style="position:relative;display:flex;justify-content:center;align-items:center;overflow:hidden;min-height:240px"><canvas data-agent-desktop-image aria-label="Zdalny pulpit" tabindex="0" style="display:block;max-width:100%;max-height:calc(100vh - 360px);width:auto;height:auto;margin:0 auto;touch-action:none"></canvas>',
    "desktop stage sizing",
)
workspace = replace_once(
    workspace,
    '''        function setStreamStatus(message) {
            if (status.textContent !== message) status.textContent = message;
            if (status.classList.contains("is-error")) status.classList.remove("is-error");
        }
''',
    '''        function setStreamStatus(message) {
            if (status.textContent !== message) status.textContent = message;
            if (status.classList.contains("is-error")) status.classList.remove("is-error");
        }
        function positionLocalCursor(x, y, desktopWidth, desktopHeight) {
            if (!desktopWidth || !desktopHeight || !image.parentElement) return;
            var stageBounds = image.parentElement.getBoundingClientRect();
            var imageBounds = image.getBoundingClientRect();
            localCursor.style.display = "";
            localCursor.style.left = (imageBounds.left - stageBounds.left +
                Number(x || 0) / desktopWidth * imageBounds.width) + "px";
            localCursor.style.top = (imageBounds.top - stageBounds.top +
                Number(y || 0) / desktopHeight * imageBounds.height) + "px";
        }
''',
    "cursor positioning helper",
)

cursor_replacements = [
    (
        '''                localCursor.style.display = "";
                localCursor.style.left = (Number(data.cursorX || 0) / desktopWidth * 100) + "%";
                localCursor.style.top = (Number(data.cursorY || 0) / desktopHeight * 100) + "%";
''',
        '''                positionLocalCursor(data.cursorX, data.cursorY, desktopWidth, desktopHeight);
''',
        "direct JPEG cursor",
    ),
    (
        '''                    localCursor.style.display = "";
                    localCursor.style.left = (Number(data.cursorX || 0) / sourceWidth * 100) + "%";
                    localCursor.style.top = (Number(data.cursorY || 0) / sourceHeight * 100) + "%";
''',
        '''                    positionLocalCursor(data.cursorX, data.cursorY, sourceWidth, sourceHeight);
''',
        "cursor-only metadata",
    ),
    (
        '''                    localCursor.style.display = "";
                    localCursor.style.left = (Number(data.cursorX || 0) / nativeWidth * 100) + "%";
                    localCursor.style.top = (Number(data.cursorY || 0) / nativeHeight * 100) + "%";
''',
        '''                    positionLocalCursor(data.cursorX, data.cursorY, sourceWidth, sourceHeight);
''',
        "HTTP JPEG cursor",
    ),
    (
        '''                                localCursor.style.display = "";
                                localCursor.style.left = (Number(frameData.cursorX || 0) / sourceWidth * 100) + "%";
                                localCursor.style.top = (Number(frameData.cursorY || 0) / sourceHeight * 100) + "%";
''',
        '''                                positionLocalCursor(frameData.cursorX, frameData.cursorY,
                                    sourceWidth, sourceHeight);
''',
        "H264 cursor",
    ),
    (
        '''            localCursor.style.display = "";
            localCursor.style.left = (point.x / sourceWidth * 100) + "%";
            localCursor.style.top = (point.y / sourceHeight * 100) + "%";
''',
        '''            positionLocalCursor(point.x, point.y, sourceWidth, sourceHeight);
''',
        "local pointer cursor",
    ),
]
for old, new, label in cursor_replacements:
    workspace = replace_once(workspace, old, new, label)

workspace = replace_once(
    workspace,
    '''                nativeWidth = Number(data.width || 0);
                nativeHeight = Number(data.height || 0);
                sourceWidth = Number(data.sourceWidth || nativeWidth);
                sourceHeight = Number(data.sourceHeight || nativeHeight);
''',
    '''                var jpegFrame = value.contentType.indexOf("image/jpeg") === 0;
                sourceWidth = Number(data.sourceWidth || data.width || 0);
                sourceHeight = Number(data.sourceHeight || data.height || 0);
                nativeWidth = jpegFrame ? sourceWidth : Number(data.width || sourceWidth);
                nativeHeight = jpegFrame ? sourceHeight : Number(data.height || sourceHeight);
''',
    "HTTP frame dimensions",
)
workspace = replace_once(
    workspace,
    '''                    setStreamStatus("Połączono · tunel Central HTTP · " + nativeWidth + " × " + nativeHeight + " · profil " + profile.options[profile.selectedIndex].text);
''',
    '''                    var frameDescription = jpegFrame
                        ? sourceWidth + " × " + sourceHeight + " · atlas " +
                            Number(data.width || 0) + " × " + Number(data.height || 0)
                        : sourceWidth + " × " + sourceHeight + " → " +
                            nativeWidth + " × " + nativeHeight;
                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +
                        " · profil " + profile.options[profile.selectedIndex].text);
''',
    "HTTP frame status",
)

for forbidden in [
    "nativeWidth = Number(data.width || 0);\n                nativeHeight = Number(data.height || 0);",
    "localCursor.style.left = (Number(data.cursorX || 0) / nativeWidth * 100)",
]:
    if forbidden in workspace:
        raise RuntimeError(f"Legacy desktop canvas behavior remains: {forbidden}")

WORKSPACE_PATH.write_text(workspace, encoding="utf-8", newline="\n")

contract = '''namespace Sirk.Portal.ProtocolTests;

internal static class DesktopCanvasContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",
            "scripts", "device-workspace.js"));

        Require(workspace.Contains("var jpegFrame = value.contentType.indexOf(\\\"image/jpeg\\\") === 0;",
                StringComparison.Ordinal),
            "HTTP desktop transport must distinguish JPEG tile atlases from encoded video frames.");
        Require(workspace.Contains("nativeWidth = jpegFrame ? sourceWidth", StringComparison.Ordinal),
            "JPEG tile atlases must render into a source-sized desktop canvas.");
        Require(workspace.Contains("positionLocalCursor", StringComparison.Ordinal),
            "Remote cursor positioning must account for the fitted canvas rectangle.");
        Require(workspace.Contains("max-height:calc(100vh - 360px)", StringComparison.Ordinal),
            "The desktop canvas must be fitted to the available viewport.");
        Require(!workspace.Contains(
                "nativeWidth = Number(data.width || 0);\\n                nativeHeight = Number(data.height || 0);",
                StringComparison.Ordinal),
            "The HTTP desktop canvas must not use the JPEG atlas dimensions.");
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
CONTRACT_PATH.write_text(contract, encoding="utf-8", newline="\n")

program = PROGRAM_PATH.read_text(encoding="utf-8-sig")
program = replace_once(
    program,
    "CanonicalDesktopTransportContract.Run();\nCanonicalAgentManagementV1Contract.Run();\n",
    "CanonicalDesktopTransportContract.Run();\nCanonicalAgentManagementV1Contract.Run();\nDesktopCanvasContract.Run();\n",
    "desktop canvas contract invocation",
)
PROGRAM_PATH.write_text(program, encoding="utf-8", newline="\n")

print("Desktop canvas fix applied.")
