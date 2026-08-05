from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


short_root = """$commonDataRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
if ([string]::IsNullOrWhiteSpace($commonDataRoot)) {
    throw 'Nie można ustalić systemowego katalogu ProgramData.'
}
$installerWorkBase = Join-Path $commonDataRoot 'SIRK\\Temp'
New-Item -ItemType Directory -Path $installerWorkBase -Force | Out-Null
"""

replace_once(
    "install.ps1",
    "$workRoot = Join-Path $env:TEMP ('SIRK-Portal-Bootstrap-' + [guid]::NewGuid().ToString('N'))",
    short_root + "$workRoot = Join-Path $installerWorkBase ('Bootstrap-' + [guid]::NewGuid().ToString('N'))",
)

replace_once(
    "install-dotnet10.ps1",
    "$workRoot = Join-Path $env:TEMP ('SIRK-Portal-DotNet10-' + [guid]::NewGuid().ToString('N'))",
    short_root + "$workRoot = Join-Path $installerWorkBase ('Portal-' + [guid]::NewGuid().ToString('N'))",
)

setup_marker = "$env:SIRK_INSTALL_TRUST_CERTIFICATE = 'true'\n"
setup_block = setup_marker + """
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$longTempName = 'SIRK-CI-' + ('LongTempSegment0123456789-' * 5)
$longTemp = Join-Path $env:SystemDrive $longTempName
New-Item -ItemType Directory -Path $longTemp -Force | Out-Null
$env:TEMP = $longTemp
$env:TMP = $longTemp
"""
replace_once(
    ".github/scripts/Test-NodeFreeWindowsInstall.ps1",
    setup_marker,
    setup_block,
)

finally_marker = """finally {
    Remove-TestService SirkPortal
"""
finally_block = """finally {
    $env:TEMP = $originalTemp
    $env:TMP = $originalTmp
    Remove-Item -LiteralPath $longTemp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-TestService SirkPortal
"""
replace_once(
    ".github/scripts/Test-NodeFreeWindowsInstall.ps1",
    finally_marker,
    finally_block,
)

for path in ("install.ps1", "install-dotnet10.ps1"):
    text = Path(path).read_text(encoding="utf-8")
    if "CommonApplicationData" not in text:
        raise SystemExit(f"{path}: short ProgramData work root was not applied")
    if "Join-Path $env:TEMP ('SIRK-Portal-" in text:
        raise SystemExit(f"{path}: legacy profile TEMP work root remains")

print("Short installer work root and long TEMP regression test applied.")
