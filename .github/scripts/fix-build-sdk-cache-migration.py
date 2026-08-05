from pathlib import Path

path = Path(__file__).with_name('apply-build-sdk-cache.py')
text = path.read_text(encoding='utf-8')

text = text.replace(
    r'SIRK\\Build Cache\\dotnet-sdk',
    r'SIRK\Build Cache\dotnet-sdk')

old_regex = r'''        return [bool]($installedSdks | Where-Object { $_ -match (\"^\" + $escapedVersion + \"\\\\s+\\\\[\") })'''
new_regex = r'''        return [bool]($installedSdks | Where-Object { $_ -match ("^" + $escapedVersion + "\s+\[") })'''
if old_regex not in text:
    raise SystemExit('Expected escaped SDK version regex was not found.')
text = text.replace(old_regex, new_regex, 1)

path.write_text(text, encoding='utf-8')
print('SDK cache migration escaping normalized.')
