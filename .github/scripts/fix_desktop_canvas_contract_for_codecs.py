from pathlib import Path

path = Path('tests/Sirk.Portal.ProtocolTests/DesktopCanvasContract.cs')
value = path.read_text(encoding='utf-8-sig')
old = '''        Require(workspace.Contains("var jpegFrame = value.contentType.indexOf(\\"image/jpeg\\") === 0;",
                StringComparison.Ordinal),
            "HTTP desktop transport must distinguish JPEG tile atlases from encoded video frames.");
        Require(workspace.Contains("nativeWidth = jpegFrame ? sourceWidth", StringComparison.Ordinal),
            "JPEG tile atlases must render into a source-sized desktop canvas.");
'''
new = '''        Require(workspace.Contains("var imageFrame = /^image\\\\/(?:jpeg|png|webp)/i.test(value.contentType);",
                StringComparison.Ordinal),
            "HTTP desktop transport must distinguish image tile atlases from encoded video frames.");
        Require(workspace.Contains("nativeWidth = imageFrame ? sourceWidth", StringComparison.Ordinal),
            "Image tile atlases must render into a source-sized desktop canvas.");
'''
if value.count(old) != 1:
    raise RuntimeError('Expected legacy JPEG canvas contract was not found exactly once.')
value = value.replace(old, new, 1)
value = value.replace('"The HTTP desktop canvas must not use the JPEG atlas dimensions."',
                      '"The HTTP desktop canvas must not use encoded atlas dimensions."')
path.write_text(value, encoding='utf-8', newline='\n')
print('Desktop canvas contract updated for WebP, PNG and JPEG.')
