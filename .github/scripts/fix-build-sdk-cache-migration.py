from pathlib import Path

path = Path(__file__).with_name('apply-build-sdk-cache.py')
text = path.read_text(encoding='utf-8')

old_read = '    text = path.read_text(encoding="utf-8")'
new_read = '''    encoding = "utf-8-sig" if path.suffix.lower() == ".ps1" else "utf-8"
    text = path.read_text(encoding=encoding)'''
if old_read not in text:
    raise SystemExit('Migration read encoding hook was not found.')
text = text.replace(old_read, new_read, 1)

old_write = '    path.write_text(text.replace(old, new, 1), encoding="utf-8")'
new_write = '    path.write_text(text.replace(old, new, 1), encoding=encoding)'
if old_write not in text:
    raise SystemExit('Migration write encoding hook was not found.')
text = text.replace(old_write, new_write, 1)

lines = text.splitlines()
regex_indexes = [
    index for index, line in enumerate(lines)
    if 'return [bool]($installedSdks | Where-Object' in line
]
if len(regex_indexes) != 1:
    raise SystemExit(f'Expected exactly one SDK regex line, found {len(regex_indexes)}.')
lines[regex_indexes[0]] = r'''        return [bool]($installedSdks | Where-Object { $_ -match ("^" + $escapedVersion + "\s+\[") })'''

path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('SDK cache migration normalized and PowerShell BOM preservation enabled.')
