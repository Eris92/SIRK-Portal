from pathlib import Path
import runpy


patch_path = Path(".github/scripts/workspace-layout-v2.py")
source = patch_path.read_text(encoding="utf-8")
start = source.index("new_layout = r'''")
end = source.index("\n'''\npattern = re.compile", start)
source = source[:start] + source[start:end].replace('\\"', '"') + source[end:]
source = source.replace(
    "pattern.subn(new_layout, workspace, count=1)",
    "pattern.subn(lambda _match: new_layout, workspace, count=1)")
patch_path.write_text(source, encoding="utf-8")

runpy.run_path(str(patch_path), run_name="__main__")
runpy.run_path(".github/scripts/workspace-layout-v2-post.py", run_name="__main__")
