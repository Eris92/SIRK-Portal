#!/usr/bin/env bash
set -euo pipefail

for path in \
  package.json package-lock.json server test scripts \
  tools/watchdog tools/enrollment tools/install \
  clean-install-managed.ps1 clean-install.ps1 install-v2.ps1 install-v3.ps1; do
  if [[ -e "$path" ]]; then
    echo "Forbidden Node/legacy path exists: $path" >&2
    exit 1
  fi
done

if grep -R --line-number -E 'node\.exe|npm(\.cmd)?|node-windows|package\.json|server/standalone|require\(' \
    src tests install.ps1 install-dotnet10.ps1 tools/installer Dockerfile; then
  echo 'Node.js runtime reference detected in server, installer or tests.' >&2
  exit 1
fi

pwsh -NoProfile -Command '
foreach ($path in @("install.ps1","install-dotnet10.ps1","tools/installer/Ensure-SirkUpdater.ps1")) {
  $source = Get-Content $path -Raw -Encoding UTF8
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors.Count) {
    $errors | ForEach-Object { Write-Error ("{0}: {1}" -f $path,$_.Message) }
    throw "PowerShell syntax validation failed: $path"
  }
}
$updater = Get-Content "tools/installer/Ensure-SirkUpdater.ps1" -Raw -Encoding UTF8
if ($updater -match "Get-CimInstance\s+Win32_Service") {
  throw "SIRK Updater integration must not depend on the Win32_Service CIM provider."
}
if (-not $updater.Contains("Get-Service -Name `$PortalServiceName")) {
  throw "Sandbox-safe SirkPortal service detection is missing."
}'

dotnet restore tests/Sirk.Portal.ProtocolTests/Sirk.Portal.ProtocolTests.csproj
dotnet build tests/Sirk.Portal.ProtocolTests/Sirk.Portal.ProtocolTests.csproj --configuration Release --no-restore
dotnet run --project tests/Sirk.Portal.ProtocolTests/Sirk.Portal.ProtocolTests.csproj --configuration Release --no-build

dotnet publish src/Sirk.Portal/Sirk.Portal.csproj --configuration Release --runtime win-x64 --self-contained false --output artifacts/win-x64 /p:DebugType=None /p:DebugSymbols=false
dotnet publish src/Sirk.Portal/Sirk.Portal.csproj --configuration Release --runtime linux-x64 --self-contained false --output artifacts/linux-x64 /p:DebugType=None /p:DebugSymbols=false

python3 - <<'PY'
from pathlib import Path
required = (
    'Sirk.Portal.dll',
    'Sirk.Portal.runtimeconfig.json',
    'public/portal/standalone/index.html',
    'public/portal/standalone/login.html',
    'public/portal/standalone/scripts/core.js',
    'public/portal/standalone/scripts/app.js',
    'public/portal/standalone/scripts/settings-native-v2.js',
    'public/portal/standalone/styles/base.css',
    'public/portal/standalone/styles/module-shell.css',
    'public/portal/settings.js',
    'public/portal/subfolder-icons.js',
    'public/shared/ui/shared-ui.css',
    'public/assets/icons/sirk-ui.svg',
)
forbidden_runtime_files = (
    'coreclr.dll',
    'hostfxr.dll',
    'hostpolicy.dll',
    'clrjit.dll',
    'System.Private.CoreLib.dll',
    'libcoreclr.so',
    'libhostfxr.so',
    'libhostpolicy.so',
)
roots = (Path('artifacts/win-x64'), Path('artifacts/linux-x64'))
missing = [str(root / item) for root in roots for item in required if not (root / item).is_file()]
if missing:
    raise SystemExit('Published frontend/runtime contract is incomplete: ' + ', '.join(missing))
bundled = [str(root / item) for root in roots for item in forbidden_runtime_files if (root / item).exists()]
if bundled:
    raise SystemExit('Framework-dependent publish contains private runtime files: ' + ', '.join(bundled))

index_html = Path('public/portal/standalone/index.html').read_text(encoding='utf-8')
if 'portal-module-shell.css' not in index_html:
    raise SystemExit('The loaded Portal shell stylesheet is missing from index.html.')

shell_css = Path('public/portal/standalone/styles/module-shell.css').read_text(encoding='utf-8')
for marker in (
    '[data-action="sidebar"] svg',
    '.sirk-standalone-nav button[data-view] > span > svg',
    'stroke: currentColor !important',
    'visibility: visible !important',
    'svg :is(path,rect,circle,line,polyline,polygon,ellipse)',
):
    if marker not in shell_css:
        raise SystemExit('Loaded sidebar icon rendering contract is missing: ' + marker)

for path in (Path('seed/Files/commands'), Path('seed/Files/management')):
    if not path.is_dir():
        raise SystemExit('Canonical script library path is missing: ' + str(path))

legacy_terms = ('myscripts', 'mycommands', 'approvalcenter', 'moverequests', 'myjira', 'defendertools')
legacy_classes = (
    'sirk-standalone-view-scroll',
    'sirk-toolbar sirk-toolbar-host',
    'sirk-layout sirk-layout-host',
    'sirk-tabs sirk-tabs-host',
)
text_extensions = {'.cs', '.js', '.css', '.html', '.json', '.py', '.ps1', '.md', '.yml', '.yaml'}
for path in Path('.').rglob('*'):
    if not path.is_file() or path.suffix.lower() not in text_extensions or any(part in {'.git', 'artifacts', 'bin', 'obj'} for part in path.parts):
        continue
    content = path.read_text(encoding='utf-8', errors='replace')
    lowered = content.lower()
    for term in legacy_terms:
        if term in lowered:
            raise SystemExit(f'Legacy module name {term!r} remains in {path}.')
    for value in legacy_classes:
        if value in content:
            raise SystemExit(f'Legacy/duplicated shell class {value!r} remains in {path}.')

component_markers = {
    Path('public/portal/standalone/scripts/app.js'): (
        'sirk-view-shell', 'sirk-toolbar-host', 'sirk-layout-host',
    ),
    Path('public/portal/standalone/scripts/settings-native-v2.js'): (
        'sirk-view-shell', 'sirk-toolbar-host', 'sirk-layout-host',
        'sirk-column-primary', 'sirk-column-secondary', 'sirk-column-details',
    ),
    Path('public/portal/management.js'): (
        'sirk-view-shell', 'sirk-toolbar-host', 'sirk-layout-host',
    ),
    Path('public/shared/ui/page.js'): (
        'sirk-view-shell', 'sirk-tabs-host', 'sirk-toolbar-host', 'sirk-layout-host',
    ),
    Path('public/shared/ui/layout.js'): (
        'sirk-layout-host', 'sirk-column-primary', 'sirk-column-secondary', 'sirk-column-details',
    ),
}
for path, markers in component_markers.items():
    content = path.read_text(encoding='utf-8')
    for marker in markers:
        if marker not in content:
            raise SystemExit(f'Unified view-shell marker {marker!r} is missing from {path}.')

management = Path('public/portal/management.js').read_text(encoding='utf-8')
for marker in ('core.api("management"', 'api("tree")', 'sirk-toolbar-host', 'sirk-layout-host'):
    if marker not in management:
        raise SystemExit('Management module contract is missing: ' + marker)
if 'api("scripts")' in management or 'post("refresh")' in management:
    raise SystemExit('Management still calls a removed module action.')

settings_ui = Path('public/portal/standalone/scripts/settings-native-v2.js').read_text(encoding='utf-8')
for marker in ('sirk-column-primary', 'sirk-column-secondary', 'sirk-column-details', 'data-portal-settings-native", "3', 'renderBreakGlass', 'break-glass/access-code/rotate', 'data-settings-toolbar-tab'):
    if marker not in settings_ui:
        raise SystemExit('Native Settings three-column contract is missing: ' + marker)

agent_installer = Path('src/Sirk.Portal/Agent/AgentInstallScriptEndpoint.cs').read_text(encoding='utf-8')
for marker in ('SIRK-Agent-Setup.exe.sha256', 'Get-FileHash', "'$GroupId + '.' + $EnrollmentToken'"):
    if marker.replace("'", "") not in agent_installer.replace("'", ""):
        raise SystemExit('Verified Agent install script contract is missing: ' + marker)

index_html = Path('public/portal/standalone/index.html').read_text(encoding='utf-8')
if '/portal/vendor/sirk-portal.css' in index_html or '/vendor/sirk-portal/sirk-portal.css' not in index_html:
    raise SystemExit('Canonical vendor stylesheet URL is invalid.')
portal_ui = Path('src/Sirk.Portal/Ui/PortalUiEndpoints.cs').read_text(encoding='utf-8')
for marker in ('system-updates.css', 'system-updates.js', '/maintenance.json'):
    if marker not in portal_ui:
        raise SystemExit('Native UI asset/maintenance bridge is missing: ' + marker)
script_store = Path('src/Sirk.Portal/Automation/ScriptStore.cs').read_text(encoding='utf-8')
filesystem_store = Path('src/Sirk.Portal/Automation/FileSystemScriptLibrary.cs').read_text(encoding='utf-8')
for marker in ('FileSystemScriptLibrary.Scan', 'FileSystemScriptLibrary.Write', 'FileSystemScriptLibrary.Delete'):
    if marker not in script_store:
        raise SystemExit('Filesystem script synchronization is missing: ' + marker)
for marker in ('VariableRequired', 'Files', 'ScriptStore.HashDefinition'):
    if marker not in filesystem_store:
        raise SystemExit('Filesystem script parser contract is missing: ' + marker)
PY

portal_dll='artifacts/linux-x64/Sirk.Portal.dll'
test -f "$portal_dll"
python3 .github/scripts/test-dotnet10-central-heartbeat.py "$portal_dll"
python3 .github/scripts/test-dotnet10-native-api.py "$portal_dll"
python3 .github/scripts/test-dotnet10-native-settings-v2.py "$portal_dll"
python3 .github/scripts/test-dotnet10-full-ui.py "$portal_dll"
python3 .github/scripts/test-dotnet10-modules-v2.py "$portal_dll"
python3 .github/scripts/test-dotnet10-agent-v1-compat.py "$portal_dll"

docker build --tag sirk-portal:dotnet10 .
docker run --detach --name sirk-portal-smoke \
  --health-interval 1s --health-timeout 5s --health-start-period 1s --health-retries 30 \
  sirk-portal:dotnet10
cleanup() {
  docker logs sirk-portal-smoke || true
  docker rm --force --volumes sirk-portal-smoke >/dev/null 2>&1 || true
}
trap cleanup EXIT
for attempt in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' sirk-portal-smoke)
  if [[ "$status" == healthy ]]; then
    cleanup
    trap - EXIT
    exit 0
  fi
  [[ "$status" == unhealthy ]] && exit 1
  sleep 1
done
exit 1
