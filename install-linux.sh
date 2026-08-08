#!/usr/bin/env bash
set -euo pipefail

# Public GitHub access in this script is bootstrap-only. Installed runtime updates
# are prepared by SIRK Portal from the SIRK Central verified cache and handed to
# SIRK Updater.
REPOSITORY="Eris92/SIRK-Portal"
RELEASE_KEY_ID="sirk-release-2026-08-v1"
RELEASE_KEY_SHA256="3dad6ad58afe0e56c3f6f3a4b55a922017450cfb7e12ab6718bd86a237e48562"
CHANNEL="${SIRK_INSTALL_CHANNEL:-preview}"
INSTALL_ROOT="${SIRK_PORTAL_INSTALL_ROOT:-/opt/sirk/portal}"
DATA_ROOT="${SIRK_PORTAL_DATA_ROOT:-/var/lib/sirk-portal}"
CONFIG_ROOT="${SIRK_PORTAL_CONFIG_ROOT:-/etc/sirk-portal}"
HELPER_ROOT="${SIRK_PORTAL_HELPER_ROOT:-/usr/lib/sirk-portal}"
SERVICE_NAME="sirk-portal.service"
UPDATER_SERVICE="sirk-updater.service"
PORTAL_USER="${SIRK_PORTAL_USER:-sirkportal}"
PORTAL_GROUP="${SIRK_PORTAL_GROUP:-sirkportal}"
PORTAL_FQDN="${SIRK_INSTALL_FQDN:-}"
HTTPS_PORT="${SIRK_INSTALL_HTTPS_PORT:-443}"
REMOVE_DATA=0
NON_INTERACTIVE=0

log()  { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK] %s\n' "$*"; }
step() { printf '\n=== %s ===\n' "$*"; }
die()  { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo bash install-linux.sh [options]
  --fqdn NAME            Portal DNS name
  --port PORT            HTTPS port (default 443)
  --channel preview|stable
  --remove-data          Delete existing Portal data and create a fresh identity
  --non-interactive      Do not prompt; clean install requires SIRK_INSTALL_BREAKGLASS_PASSWORD

Installed Portal updates are not performed by this bootstrap installer.
Use Portal maintenance; it obtains a signed package from SIRK Central and hands
it to SIRK Updater transactionally.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fqdn) [[ $# -ge 2 ]] || die "--fqdn requires a value"; PORTAL_FQDN="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port requires a value"; HTTPS_PORT="$2"; shift 2 ;;
    --channel) [[ $# -ge 2 ]] || die "--channel requires a value"; CHANNEL="$2"; shift 2 ;;
    --remove-data) REMOVE_DATA=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "$CHANNEL" == "preview" || "$CHANNEL" == "stable" ]] || die "Channel must be preview or stable."
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run as root."
[[ "$(uname -s)" == "Linux" ]] || die "This installer is for Linux."
[[ "$(uname -m)" == "x86_64" ]] || die "Only linux-x64 is supported."
command -v systemctl >/dev/null 2>&1 || die "systemd/systemctl is required."
command -v systemd-run >/dev/null 2>&1 || die "systemd-run is required."
[[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] && (( HTTPS_PORT >= 1 && HTTPS_PORT <= 65535 )) || die "Invalid HTTPS port."

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  os_family="${ID:-} ${ID_LIKE:-}"
  [[ "$os_family" == *debian* || "$os_family" == *ubuntu* ]] || die "Supported distributions: Debian/Ubuntu."
else
  die "/etc/os-release is missing."
fi

missing=()
for cmd in curl unzip openssl python3 sudo sha256sum sha512sum readlink; do
  command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if (( ${#missing[@]} > 0 )); then
  step "Installing Linux dependencies"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl unzip openssl python3 sudo coreutils >/dev/null
fi
command -v update-ca-certificates >/dev/null 2>&1 || die "ca-certificates is required."

WORK_ROOT="$(mktemp -d /tmp/sirk-portal-install.XXXXXX)"
trap 'rm -rf "$WORK_ROOT"' EXIT

install_dotnet10_runtime_set() {
  step "Ensuring shared .NET 10 runtimes"
  if command -v dotnet >/dev/null 2>&1 && \
     dotnet --list-runtimes 2>/dev/null | grep -Eq '^Microsoft\.NETCore\.App 10\.0\.' && \
     dotnet --list-runtimes 2>/dev/null | grep -Eq '^Microsoft\.AspNetCore\.App 10\.0\.'; then
    local existing
    existing="$(readlink -f "$(command -v dotnet)")"
    ln -sfn "$existing" /usr/local/bin/dotnet
    ok ".NET 10 and ASP.NET Core 10 runtimes already installed."
    return
  fi

  local metadata="$WORK_ROOT/dotnet-releases.json"
  curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors \
    'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json' -o "$metadata"
  readarray -t assets < <(python3 - "$metadata" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as f:d=json.load(f)
latest=d.get('latest-release')
r=next((x for x in d.get('releases',[]) if x.get('release-version')==latest),None)
if not r: raise SystemExit('Latest .NET 10 release metadata not found.')
for key in ('runtime','aspnetcore-runtime'):
    c=r.get(key) or {}
    a=next((x for x in c.get('files',[]) if x.get('rid')=='linux-x64' and (x.get('name') or '').endswith('.tar.gz')),None)
    if not a: raise SystemExit(f'linux-x64 {key} archive not found.')
    print(key); print(c.get('version') or latest); print(a['url']); print((a.get('hash') or '').lower())
PY
)
  [[ "${#assets[@]}" -eq 8 ]] || die "Unable to resolve Microsoft .NET 10 linux-x64 runtime assets."

  rm -rf /opt/dotnet.new
  mkdir -p /opt/dotnet.new
  for offset in 0 4; do
    key="${assets[$offset]}"; version="${assets[$((offset+1))]}"; url="${assets[$((offset+2))]}"; expected="${assets[$((offset+3))]}"
    archive="$WORK_ROOT/$key-$version.tar.gz"
    curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors "$url" -o "$archive"
    actual="$(sha512sum "$archive" | awk '{print tolower($1)}')"
    [[ -z "$expected" || "$actual" == "$expected" ]] || die "Invalid SHA-512 for $key $version."
    tar -xzf "$archive" -C /opt/dotnet.new
  done
  rm -rf /opt/dotnet.old
  [[ ! -d /opt/dotnet ]] || mv /opt/dotnet /opt/dotnet.old
  mv /opt/dotnet.new /opt/dotnet
  rm -rf /opt/dotnet.old
  ln -sfn /opt/dotnet/dotnet /usr/local/bin/dotnet
  /usr/local/bin/dotnet --list-runtimes | grep -Eq '^Microsoft\.NETCore\.App 10\.0\.' || die "Microsoft.NETCore.App 10 was not installed."
  /usr/local/bin/dotnet --list-runtimes | grep -Eq '^Microsoft\.AspNetCore\.App 10\.0\.' || die "Microsoft.AspNetCore.App 10 was not installed."
  ok "Shared .NET 10 runtime set installed."
}

install_dotnet10_runtime_set

download_portal_bootstrap_release() {
  step "Downloading immutable signed Portal linux-x64 bootstrap release"
  local releases="$WORK_ROOT/releases.json"
  local selected="$WORK_ROOT/selected.json"
  curl --fail --silent --show-error --location --retry 6 --retry-delay 2 --retry-all-errors \
    -H 'Accept: application/vnd.github+json' -H 'User-Agent: SIRK-Portal-Bootstrap' \
    "https://api.github.com/repos/$REPOSITORY/releases?per_page=50" -o "$releases"
  python3 - "$releases" "$CHANNEL" "$selected" <<'PY'
import json,re,sys
src,channel,out=sys.argv[1:]
releases=json.load(open(src,encoding='utf-8'))
c=[]
for r in releases:
    if r.get('draft'): continue
    if channel=='preview' and not r.get('prerelease'): continue
    if channel=='stable' and r.get('prerelease'): continue
    m=re.fullmatch(r'v(0\.1\.1\.\d+)',str(r.get('tag_name') or ''))
    if not m: continue
    v=m.group(1); names={a.get('name') for a in r.get('assets',[])}
    d=f'SIRK-Portal-{v}-linux-x64.update.json'; p=f'SIRK-Portal-{v}-linux-x64.zip'
    if {d,p,'release-trusted-keys.json'} <= names:
        c.append((tuple(map(int,v.split('.'))),v,d,p,r))
if not c: raise SystemExit(f'No immutable signed Portal {channel} linux-x64 release found.')
_,v,d,p,r=max(c,key=lambda x:x[0])
json.dump({'version':v,'descriptor':d,'package':p,'release':r},open(out,'w',encoding='utf-8'),separators=(',',':'))
PY

  readarray -t fields < <(python3 - "$selected" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding='utf-8'))
assets={a['name']:a['browser_download_url'] for a in x['release']['assets']}
print(x['version']);print(x['descriptor']);print(x['package']);print(assets[x['descriptor']]);print(assets[x['package']]);print(assets['release-trusted-keys.json'])
PY
)
  [[ "${#fields[@]}" -eq 6 ]] || die "Invalid selected Portal release metadata."
  RELEASE_VERSION="${fields[0]}"; descriptor_name="${fields[1]}"; package_name="${fields[2]}"
  descriptor="$WORK_ROOT/$descriptor_name"; package="$WORK_ROOT/$package_name"; keyring="$WORK_ROOT/release-trusted-keys.json"
  curl --fail --silent --show-error --location --retry 6 --retry-delay 2 --retry-all-errors "${fields[3]}" -o "$descriptor"
  curl --fail --silent --show-error --location --retry 6 --retry-delay 2 --retry-all-errors "${fields[4]}" -o "$package"
  curl --fail --silent --show-error --location --retry 6 --retry-delay 2 --retry-all-errors "${fields[5]}" -o "$keyring"

  readarray -t verified < <(python3 - "$descriptor" "$keyring" "$CHANNEL" "$RELEASE_VERSION" "$package_name" "$RELEASE_KEY_ID" "$RELEASE_KEY_SHA256" <<'PY'
import hashlib,json,re,sys
path,keyring_path,channel,version,package_name,key_id,key_sha=sys.argv[1:]
k=json.load(open(keyring_path,encoding='utf-8'))
keys=k.get('keys') or []
if len(keys)!=1 or keys[0].get('keyId')!=key_id or 'BEGIN PUBLIC KEY' not in str(keys[0].get('publicKeyPem') or ''): raise SystemExit('Invalid Portal bootstrap trust root.')
pem=str(keys[0]['publicKeyPem']).replace('\r\n','\n').strip()+'\n'
if hashlib.sha256(pem.encode()).hexdigest()!=key_sha: raise SystemExit('Portal bootstrap trust root fingerprint is not pinned.')
d=json.load(open(path,encoding='utf-8'))
expected={'schemaVersion':1,'applicationId':'sirk-portal','product':'SIRK Portal','version':version,'runtime':'linux-x64','channel':channel,'assetName':package_name}
for k,v in expected.items():
    if d.get(k)!=v: raise SystemExit(f'Invalid signed Portal descriptor: {k}')
sha=str(d.get('sha256') or '').lower(); commit=str(d.get('commit') or '').lower(); size=int(d.get('size') or 0); sig=d.get('signature') or {}
if not re.fullmatch(r'[0-9a-f]{64}',sha) or not re.fullmatch(r'[0-9a-f]{40}',commit) or not 1024 <= size <= 268435456: raise SystemExit('Invalid signed Portal descriptor integrity metadata.')
if sig.get('algorithm')!='ES256' or sig.get('keyId')!=key_id or not sig.get('value'): raise SystemExit('Invalid signed Portal descriptor signature metadata.')
print(commit);print(sha);print(size)
PY
)
  [[ "${#verified[@]}" -eq 3 ]] || die "Invalid signed Portal release descriptor."
  RELEASE_COMMIT="${verified[0]}"; RELEASE_SHA="${verified[1]}"; RELEASE_SIZE="${verified[2]}"
  [[ "$(stat -c %s "$package")" == "$RELEASE_SIZE" ]] || die "Portal bootstrap package size mismatch."
  actual="$(sha256sum "$package" | awk '{print tolower($1)}')"
  [[ "$actual" == "$RELEASE_SHA" ]] || die "Portal bootstrap package SHA-256 mismatch."

  PAYLOAD_ROOT="$WORK_ROOT/payload"
  mkdir -p "$PAYLOAD_ROOT"
  unzip -q "$package" -d "$PAYLOAD_ROOT"
  [[ -x "$PAYLOAD_ROOT/Sirk.Portal" || -f "$PAYLOAD_ROOT/Sirk.Portal" ]] || die "Portal bootstrap verifier is missing."
  chmod 0755 "$PAYLOAD_ROOT/Sirk.Portal"
  "$PAYLOAD_ROOT/Sirk.Portal" --verify-update-payload "$PAYLOAD_ROOT" --trusted-keys "$keyring" || die "Signed Portal bootstrap payload verification failed."
  [[ ! -f "$PAYLOAD_ROOT/appsettings.Production.json" ]] || die "Public Portal package contains machine configuration."
  python3 - "$PAYLOAD_ROOT/release-manifest.json" "$RELEASE_COMMIT" "$RELEASE_VERSION" <<'PY'
import json,sys
with open(sys.argv[1],encoding='utf-8-sig') as f:d=json.load(f)
if d.get('applicationId')!='sirk-portal' or d.get('version')!=sys.argv[3] or d.get('runtime')!='linux-x64' or d.get('commit')!=sys.argv[2]:
    raise SystemExit('Portal bootstrap manifest does not match signed release descriptor.')
PY
}

download_portal_bootstrap_release

ensure_updater_bootstrap() {
  if [[ -x /opt/sirk/updater/SirkUpdater ]] && systemctl is-active --quiet "$UPDATER_SERVICE"; then
    ok "SIRK Updater is already installed."
    return
  fi
  step "Installing SIRK Updater bootstrap for Linux"
  local bootstrap="$WORK_ROOT/install-updater.sh"
  curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --retry-all-errors \
    "https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.sh?nocache=$(date +%s%N)" -o "$bootstrap"
  chmod 0700 "$bootstrap"
  bash "$bootstrap"
  systemctl is-active --quiet "$UPDATER_SERVICE" || die "SIRK Updater service is not running."
}

register_updater_manifest() {
  local manifest="$WORK_ROOT/sirk-portal-updater.json"
  cat >"$manifest" <<JSON
{
  "schemaVersion": 1,
  "applicationId": "sirk-portal",
  "displayName": "SIRK Portal",
  "serviceName": "$SERVICE_NAME",
  "watchdogServiceName": null,
  "installRoot": "$INSTALL_ROOT",
  "dataRoot": "$DATA_ROOT",
  "healthUrl": "https://127.0.0.1:$HTTPS_PORT/readyz",
  "channel": "$CHANNEL",
  "updateSource": "sirk-central-cache",
  "packageSha256Url": null,
  "signatureRequired": true,
  "signatureVerifierPath": "$INSTALL_ROOT/Sirk.Portal",
  "signatureVerifierArguments": ["--verify-update-payload","{payload}","--trusted-keys","$INSTALL_ROOT/release-trusted-keys.json"]
}
JSON
  /opt/sirk/updater/SirkUpdater register "$manifest" >/dev/null
}

if [[ -f "$DATA_ROOT/identity.json" && "$REMOVE_DATA" -ne 1 ]]; then
  die "Existing Portal data detected. Installed Portal must be updated through SIRK Central. Use --remove-data only for a clean reinstall."
fi

if [[ -z "$PORTAL_FQDN" ]]; then PORTAL_FQDN="$(hostname -f 2>/dev/null || hostname)"; fi
PORTAL_FQDN="$(printf '%s' "$PORTAL_FQDN" | tr '[:upper:]' '[:lower:]')"
[[ "$PORTAL_FQDN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Invalid Portal DNS name."

plain_password="${SIRK_INSTALL_BREAKGLASS_PASSWORD:-}"
if [[ -z "$plain_password" ]]; then
  (( NON_INTERACTIVE == 0 )) || die "Set SIRK_INSTALL_BREAKGLASS_PASSWORD in non-interactive clean install mode."
  read -r -s -p 'Break-Glass administrator password (minimum 14 characters): ' p1; printf '\n'
  read -r -s -p 'Repeat password: ' p2; printf '\n'
  [[ "$p1" == "$p2" ]] || die "Passwords do not match."
  plain_password="$p1"; unset p1 p2
fi
(( ${#plain_password} >= 14 )) || die "Break-Glass password must contain at least 14 characters."
unset SIRK_INSTALL_BREAKGLASS_PASSWORD || true

step "Installing Portal program files"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
(( REMOVE_DATA == 0 )) || rm -rf "$DATA_ROOT"
rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$HELPER_ROOT"
cp -a "$PAYLOAD_ROOT/." "$INSTALL_ROOT/"
chmod 0755 "$INSTALL_ROOT/Sirk.Portal"

getent group "$PORTAL_GROUP" >/dev/null || groupadd --system "$PORTAL_GROUP"
id "$PORTAL_USER" >/dev/null 2>&1 || useradd --system --gid "$PORTAL_GROUP" --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin "$PORTAL_USER"

step "Creating Break-Glass bootstrap credentials"
security_root="$DATA_ROOT/security"; mkdir -p "$security_root"
printf '%s' "$plain_password" >"$security_root/break-glass-password.bootstrap"; unset plain_password
access_code="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
printf '%s' "$access_code" >"$security_root/break-glass-access-code.txt"

step "Creating HTTPS certificate"
tls_root="$DATA_ROOT/TLS"; mkdir -p "$tls_root"
pfx_password="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
host_short="$(hostname -s | tr '[:upper:]' '[:lower:]')"
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 1095 -keyout "$tls_root/portal.key" -out "$tls_root/portal.crt" -subj "/CN=$PORTAL_FQDN" -addext "subjectAltName=DNS:$PORTAL_FQDN,DNS:$host_short,DNS:localhost,IP:127.0.0.1,IP:::1" -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1
openssl pkcs12 -export -out "$tls_root/portal.pfx" -inkey "$tls_root/portal.key" -in "$tls_root/portal.crt" -passout "pass:$pfx_password" >/dev/null 2>&1
rm -f "$tls_root/portal.key"
cp "$tls_root/portal.crt" /usr/local/share/ca-certificates/sirk-portal.crt
update-ca-certificates >/dev/null
if ! grep -Fq " $PORTAL_FQDN" /etc/hosts; then printf '\n127.0.0.1\t%s\t# SIRK Portal local health\n' "$PORTAL_FQDN" >>/etc/hosts; fi

step "Writing systemd configuration"
public_url="https://$PORTAL_FQDN"; [[ "$HTTPS_PORT" == "443" ]] || public_url="https://$PORTAL_FQDN:$HTTPS_PORT"
local_origin="https://localhost:$HTTPS_PORT/"
env_file="$CONFIG_ROOT/portal.env"
cat >"$env_file" <<ENV
ASPNETCORE_ENVIRONMENT=Production
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_NOLOGO=1
Kestrel__Endpoints__Https__Url=https://0.0.0.0:$HTTPS_PORT
Kestrel__Endpoints__Https__Certificate__Path=$DATA_ROOT/TLS/portal.pfx
Kestrel__Endpoints__Https__Certificate__Password=$pfx_password
Sirk__DataRoot=$DATA_ROOT
Sirk__Security__Enabled=true
Sirk__Security__SessionMinutes=30
Sirk__Security__LoginAttemptsPerFiveMinutes=8
Sirk__Security__BootstrapUserName=admin
Sirk__Security__BootstrapDisplayName=Administrator
Sirk__Security__BootstrapPasswordFile=$DATA_ROOT/security/break-glass-password.bootstrap
Sirk__Security__BootstrapAccessCodeFile=$DATA_ROOT/security/break-glass-access-code.txt
Sirk__Central__Enabled=false
Sirk__Central__PublicUrl=$public_url
Sirk__Central__UpdateChannel=$CHANNEL
Sirk__Central__HeartbeatIntervalSeconds=60
Sirk__Central__RequestTimeoutSeconds=15
Sirk__Central__ConnectionFile=$DATA_ROOT/central-connection.json
Sirk__CentralTunnel__Enabled=true
Sirk__CentralTunnel__LocalOrigin=$local_origin
Sirk__CentralTunnel__PollIntervalMilliseconds=750
Sirk__CentralTunnel__MaximumConcurrency=8
Sirk__CentralTunnel__MaximumBodyBytes=8388608
ENV
chmod 0600 "$env_file"

chown -R "$PORTAL_USER:$PORTAL_GROUP" "$DATA_ROOT"
chmod 0700 "$DATA_ROOT" "$security_root" "$tls_root"
chmod 0600 "$security_root"/* "$tls_root/portal.pfx" "$tls_root/portal.crt"
chown -R root:root "$INSTALL_ROOT" "$CONFIG_ROOT" "$HELPER_ROOT"
chmod -R go-w "$INSTALL_ROOT" "$CONFIG_ROOT" "$HELPER_ROOT"

cat >"/etc/systemd/system/$SERVICE_NAME" <<UNIT
[Unit]
Description=SIRK Portal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PORTAL_USER
Group=$PORTAL_GROUP
WorkingDirectory=$INSTALL_ROOT
EnvironmentFile=$env_file
ExecStart=/usr/local/bin/dotnet $INSTALL_ROOT/Sirk.Portal.dll
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA_ROOT

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

step "Validating Portal health and frontend"
deadline=$((SECONDS + 120))
until curl --fail --silent --show-error --max-time 5 "https://127.0.0.1:$HTTPS_PORT/healthz" | grep -q 'healthy'; do
  (( SECONDS < deadline )) || { journalctl -u "$SERVICE_NAME" -n 120 --no-pager >&2 || true; die "Portal did not pass health check."; }
  sleep 2
done
curl --fail --silent --show-error --max-time 10 "https://127.0.0.1:$HTTPS_PORT/readyz" | grep -q 'ready' || die "Portal did not pass readiness check."
curl --fail --silent --show-error --max-time 10 "https://127.0.0.1:$HTTPS_PORT/login" | grep -q 'sirk-login-page' || die "Portal login frontend is incomplete."
[[ -f "$DATA_ROOT/identity.json" ]] || die "Break-Glass identity was not initialized."
rm -f "$security_root/break-glass-password.bootstrap"

ensure_updater_bootstrap
register_updater_manifest

step "Installing narrow Linux maintenance helpers"
systemctl_path="$(command -v systemctl)"; systemd_run_path="$(command -v systemd-run)"
mkdir -p "$DATA_ROOT/Logs" "$DATA_ROOT/Updates/Pending"
chown -R "$PORTAL_USER:$PORTAL_GROUP" "$DATA_ROOT/Logs" "$DATA_ROOT/Updates"
chmod 0700 "$DATA_ROOT/Logs" "$DATA_ROOT/Updates" "$DATA_ROOT/Updates/Pending"

cat >"$HELPER_ROOT/update-runner" <<RUNNER
#!/bin/sh
set -eu
lock='$DATA_ROOT/maintenance-update.lock'; log='$DATA_ROOT/Logs/gui-update-linux.log'; pending='$DATA_ROOT/Updates/Pending/'
cleanup() { rm -f "\$lock"; }
trap cleanup EXIT INT TERM
if [ "\$#" -ne 3 ]; then echo 'Usage: update-runner <package.zip> <sha256> <0.1.1.X>' >&2; exit 64; fi
package="\$1"; sha="\$2"; version="\$3"
resolved="\$(readlink -f -- "\$package")" || { echo 'Invalid package path.' >&2; exit 65; }
case "\$resolved" in "\$pending"*) ;; *) echo 'Update package must be staged below Portal Updates/Pending.' >&2; exit 65 ;; esac
[ -f "\$resolved" ] || { echo 'Update package is missing.' >&2; exit 66; }
[ "\${#sha}" -eq 64 ] || { echo 'Invalid SHA-256 length.' >&2; exit 65; }
case "\$sha" in *[!0-9A-Fa-f]*) echo 'Invalid SHA-256.' >&2; exit 65 ;; esac
printf '%s\n' "\$version" | grep -Eq '^0\.1\.1\.[0-9]+$' || { echo 'Invalid pre-1.0 update version.' >&2; exit 65; }
sleep 2
printf '\nStart Central-cached Linux update: %s version=%s\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" "\$version" >>"\$log"
if ! /opt/sirk/updater/SirkUpdater update sirk-portal "\$resolved" "\$sha" "\$version" >>"\$log" 2>&1; then
  printf '\nLatest SIRK Updater state after failure:\n' >>"\$log"
  latest_state="\$(find /var/lib/sirk-updater/operations/sirk-portal -type f -name state.json -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
  if [ -n "\$latest_state" ] && [ -f "\$latest_state" ]; then cat "\$latest_state" >>"\$log"; fi
  exit 1
fi
printf 'SIRK_PORTAL_LINUX_UPDATE_OK version=%s\n' "\$version" >>"\$log"
RUNNER

cat >"$HELPER_ROOT/update-helper" <<HELPER
#!/bin/sh
set -eu
[ "\$#" -eq 3 ] || { echo 'Usage: update-helper <package.zip> <sha256> <0.1.1.X>' >&2; exit 64; }
unit="sirk-portal-update-\$(date +%s%N)"
exec '$systemd_run_path' --quiet --collect --no-block --unit="\$unit" '$HELPER_ROOT/update-runner' "\$1" "\$2" "\$3"
HELPER
cat >"$HELPER_ROOT/restart-helper" <<HELPER
#!/bin/sh
set -eu
[ "\$#" -eq 0 ] || exit 64
unit="sirk-portal-restart-\$(date +%s%N)"
exec '$systemd_run_path' --quiet --collect --no-block --unit="\$unit" /bin/sh -c "sleep 2; exec '$systemctl_path' restart '$SERVICE_NAME'"
HELPER
chmod 0755 "$HELPER_ROOT/update-runner" "$HELPER_ROOT/update-helper" "$HELPER_ROOT/restart-helper"
chown root:root "$HELPER_ROOT/update-runner" "$HELPER_ROOT/update-helper" "$HELPER_ROOT/restart-helper"
cat >"/etc/sudoers.d/sirk-portal-maintenance" <<SUDOERS
$PORTAL_USER ALL=(root) NOPASSWD: $HELPER_ROOT/update-helper, $HELPER_ROOT/restart-helper
SUDOERS
chmod 0440 /etc/sudoers.d/sirk-portal-maintenance
visudo -cf /etc/sudoers.d/sirk-portal-maintenance >/dev/null

printf '\nSIRK_PORTAL_LINUX_BINARY_INSTALL_OK\n'
printf 'Release version: %s\n' "$RELEASE_VERSION"
printf 'Release commit: %s\n' "$RELEASE_COMMIT"
printf 'URL: %s/login\n' "$public_url"
printf 'Access URL: %s/login#access=%s\n' "$public_url" "$access_code"
printf 'Access Code file: %s/security/break-glass-access-code.txt\n' "$DATA_ROOT"
printf 'Service: %s\n' "$SERVICE_NAME"
printf 'Install root: %s\n' "$INSTALL_ROOT"
printf 'Data root: %s\n' "$DATA_ROOT"
