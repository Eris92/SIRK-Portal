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
    'public/portal/standalone/styles/management-frame.css',
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

shell_css = Path('public/portal/standalone/styles/management-frame.css').read_text(encoding='utf-8')
for marker in (
    '[data-action="sidebar"] svg',
    '.sirk-standalone-nav button > span > svg',
    'stroke: currentColor !important',
    'visibility: visible !important',
):
    if marker not in shell_css:
        raise SystemExit('Sidebar icon rendering contract is missing: ' + marker)
PY

portal_dll='artifacts/linux-x64/Sirk.Portal.dll'
test -f "$portal_dll"
python3 .github/scripts/test-dotnet10-central-heartbeat.py "$portal_dll"
python3 .github/scripts/test-dotnet10-native-api.py "$portal_dll"
python3 .github/scripts/test-dotnet10-native-settings-v2.py "$portal_dll"
python3 .github/scripts/test-dotnet10-full-ui.py "$portal_dll"

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
