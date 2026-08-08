#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ -n "${GITHUB_TOKEN:-}" ]] || { echo 'GITHUB_TOKEN is required for CI release acquisition.' >&2; exit 2; }

INSTALL_ROOT=/opt/sirk/portal
DATA_ROOT=/var/lib/sirk-portal
CONFIG_FILE=/etc/sirk-portal/config/portal.env
REGISTRY=/var/lib/sirk-updater/applications/sirk-portal.json
UPDATER=/opt/sirk/updater/SirkUpdater
HELPER=/usr/lib/sirk-portal/update-helper
RUNNER=/usr/lib/sirk-portal/update-runner
PENDING="$DATA_ROOT/Updates/Pending"
LOG="$DATA_ROOT/Logs/gui-update-linux.log"
ROOT="$(mktemp -d /tmp/sirk-portal-signed-linux-e2e.XXXXXX)"
SERVER_PID=''
ORIGINAL_MANIFEST="$ROOT/sirk-portal-original.json"

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if [[ -s "$ORIGINAL_MANIFEST" ]]; then sudo "$UPDATER" register "$ORIGINAL_MANIFEST" >/dev/null 2>&1 || true; fi
  sudo rm -f "$INSTALL_ROOT/e2e-rollback-sentinel.txt" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

for path in "$INSTALL_ROOT/Sirk.Portal" "$INSTALL_ROOT/release-trusted-keys.json" "$CONFIG_FILE" "$REGISTRY" "$UPDATER" "$HELPER" "$RUNNER"; do
  [[ -e "$path" ]] || { echo "Required Linux Portal update E2E path is missing: $path" >&2; exit 3; }
done
sudo systemctl is-active --quiet sirk-portal.service
sudo systemctl is-active --quiet sirk-updater.service

manifest_json="$(sudo cat "$REGISTRY")"
jq -e '
  .applicationId == "sirk-portal" and
  .updateSource == "sirk-central-cache" and
  .signatureRequired == true and
  .signatureVerifierPath == "/opt/sirk/portal/Sirk.Portal" and
  (.signatureVerifierArguments | index("{payload}") != null) and
  (.signatureVerifierArguments | index("--verify-update-payload") != null) and
  (.signatureVerifierArguments | index("--trusted-keys") != null)
' <<<"$manifest_json" >/dev/null
printf '%s\n' "$manifest_json" >"$ORIGINAL_MANIFEST"

headers=(
  -H 'Accept: application/vnd.github+json'
  -H "Authorization: Bearer $GITHUB_TOKEN"
  -H 'X-GitHub-Api-Version: 2022-11-28'
  -H 'User-Agent: SIRK-Portal-Linux-Signed-Update-E2E'
)
curl --fail --silent --show-error --location "${headers[@]}" \
  'https://api.github.com/repos/Eris92/SIRK-Portal/releases?per_page=30' \
  -o "$ROOT/releases.json"

python3 - "$ROOT/releases.json" "$ROOT/selected.json" <<'PY'
import json,re,sys
releases=json.load(open(sys.argv[1],encoding='utf-8'))
candidates=[]
for release in releases:
    tag=str(release.get('tag_name') or '')
    if release.get('draft') or not release.get('prerelease') or not re.fullmatch(r'v0\.1\.1\.\d+',tag):
        continue
    version=tag[1:]
    descriptor=f'SIRK-Portal-{version}-linux-x64.update.json'
    package=f'SIRK-Portal-{version}-linux-x64.zip'
    assets={str(a.get('name') or ''):a for a in release.get('assets') or []}
    if descriptor in assets and package in assets:
        candidates.append((tuple(map(int,version.split('.'))),version,assets[descriptor],assets[package]))
if not candidates:
    raise SystemExit('No signed Portal preview linux-x64 release was found.')
_,version,descriptor,package=max(candidates,key=lambda x:x[0])
json.dump({'version':version,'descriptor':descriptor,'package':package},open(sys.argv[2],'w',encoding='utf-8'),separators=(',',':'))
PY

version="$(jq -r .version "$ROOT/selected.json")"
descriptor_api="$(jq -r .descriptor.url "$ROOT/selected.json")"
package_api="$(jq -r .package.url "$ROOT/selected.json")"
descriptor="$ROOT/SIRK-Portal-$version-linux-x64.update.json"
package="$ROOT/SIRK-Portal-$version-linux-x64.zip"
asset_headers=(
  -H 'Accept: application/octet-stream'
  -H "Authorization: Bearer $GITHUB_TOKEN"
  -H 'X-GitHub-Api-Version: 2022-11-28'
  -H 'User-Agent: SIRK-Portal-Linux-Signed-Update-E2E'
)
curl --fail --silent --show-error --location "${asset_headers[@]}" "$descriptor_api" -o "$descriptor"
curl --fail --silent --show-error --location "${asset_headers[@]}" "$package_api" -o "$package"

expected_name="SIRK-Portal-$version-linux-x64.zip"
jq -e --arg version "$version" --arg asset "$expected_name" '
  .schemaVersion == 1 and
  .applicationId == "sirk-portal" and
  .product == "SIRK Portal" and
  .version == $version and
  .runtime == "linux-x64" and
  .channel == "preview" and
  .assetName == $asset and
  (.sha256 | test("^[0-9a-fA-F]{64}$")) and
  .size > 0 and
  .signature.algorithm == "ES256" and
  .signature.keyId == "sirk-release-2026-08-v1" and
  (.signature.value | length) > 0
' "$descriptor" >/dev/null
sha="$(jq -r .sha256 "$descriptor" | tr '[:upper:]' '[:lower:]')"
size="$(jq -r .size "$descriptor")"
[[ "$(stat -c %s "$package")" == "$size" ]] || { echo 'Portal Linux signed package size mismatch.' >&2; exit 4; }
[[ "$(sha256sum "$package" | awk '{print tolower($1)}')" == "$sha" ]] || { echo 'Portal Linux signed package SHA mismatch.' >&2; exit 4; }

staged="$PENDING/signed-$version-linux-x64.zip"
sudo install -o sirkportal -g sirkportal -m 0600 "$package" "$staged"
config_before="$(sudo sha256sum "$CONFIG_FILE" | awk '{print $1}')"
identity_before="$(sudo sha256sum "$DATA_ROOT/identity.json" | awk '{print $1}')"
access_before="$(sudo sha256sum "$DATA_ROOT/security/break-glass-access-code.txt" | awk '{print $1}')"

sudo -u sirkportal sudo -n "$HELPER" "$staged" "$sha" "$version"
deadline=$((SECONDS + 120))
while true; do
  if sudo grep -Fq "SIRK_PORTAL_LINUX_UPDATE_OK version=$version" "$LOG" 2>/dev/null; then break; fi
  (( SECONDS < deadline )) || { echo 'Timed out waiting for positive Linux Portal update.' >&2; exit 5; }
  sleep 1
done
sudo systemctl is-active --quiet sirk-portal.service
curl --fail --silent --show-error https://localhost:8443/readyz | grep -q ready
sudo test ! -e "$DATA_ROOT/maintenance-update.lock"
sudo test ! -e "$DATA_ROOT/maintenance.lock"
sudo test -x "$INSTALL_ROOT/Sirk.Portal"
[[ "$(sudo sha256sum "$CONFIG_FILE" | awk '{print $1}')" == "$config_before" ]]
[[ "$(sudo sha256sum "$DATA_ROOT/identity.json" | awk '{print $1}')" == "$identity_before" ]]
[[ "$(sudo sha256sum "$DATA_ROOT/security/break-glass-access-code.txt" | awk '{print $1}')" == "$access_before" ]]
printf 'SIRK_PORTAL_LINUX_UPDATER_REAL_PACKAGE_E2E_OK version=%s\n' "$version"

sentinel="$INSTALL_ROOT/e2e-rollback-sentinel.txt"
sudo sh -c "printf rollback-sentinel > '$sentinel'"
port_file="$ROOT/health-port"
python3 - "$sentinel" "$port_file" <<'PY' &
import http.server,os,sys
sentinel,port_file=sys.argv[1:]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok=os.path.isfile(sentinel)
        body=b'healthy' if ok else b'update-active'
        self.send_response(200 if ok else 503)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
with open(port_file,'w',encoding='utf-8') as f:
    f.write(str(server.server_port));f.flush();os.fsync(f.fileno())
server.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 50); do [[ -s "$port_file" ]] && break; sleep .1; done
[[ -s "$port_file" ]] || { echo 'Rollback health server did not start.' >&2; exit 6; }
health_port="$(cat "$port_file")"
rollback_manifest="$ROOT/sirk-portal-rollback.json"
jq --arg url "http://127.0.0.1:$health_port/health" '.healthUrl=$url' "$ORIGINAL_MANIFEST" >"$rollback_manifest"
sudo "$UPDATER" register "$rollback_manifest" >/dev/null

set +e
sudo "$RUNNER" "$staged" "$sha" "$version"
rollback_code=$?
set -e
[[ "$rollback_code" -ne 0 ]] || { echo 'Forced Linux Portal rollback transaction unexpectedly succeeded.' >&2; exit 7; }
latest_state="$(sudo find /var/lib/sirk-updater/operations/sirk-portal -type f -name state.json -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$latest_state" ]] || { echo 'Linux Portal rollback state is missing.' >&2; exit 8; }
sudo jq -e '
  .phase == "failed" and
  (.message | test("rollback was attempted";"i")) and
  (.error | test("health check timed out|Health endpoint returned HTTP 503";"i"))
' "$latest_state" >/dev/null
sudo test -f "$sentinel"
sudo "$UPDATER" register "$ORIGINAL_MANIFEST" >/dev/null
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=''
sudo systemctl is-active --quiet sirk-portal.service
curl --fail --silent --show-error https://localhost:8443/readyz | grep -q ready
sudo test ! -e "$DATA_ROOT/maintenance-update.lock"
sudo test ! -e "$DATA_ROOT/maintenance.lock"
[[ "$(sudo sha256sum "$CONFIG_FILE" | awk '{print $1}')" == "$config_before" ]]
[[ "$(sudo sha256sum "$DATA_ROOT/identity.json" | awk '{print $1}')" == "$identity_before" ]]
[[ "$(sudo sha256sum "$DATA_ROOT/security/break-glass-access-code.txt" | awk '{print $1}')" == "$access_before" ]]
printf 'SIRK_PORTAL_LINUX_UPDATER_ROLLBACK_E2E_OK version=%s\n' "$version"
printf 'SIRK_PORTAL_LINUX_UPDATER_TRANSACTION_AND_ROLLBACK_E2E_OK\n'
