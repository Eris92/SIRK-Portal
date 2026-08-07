#!/usr/bin/env bash
set -euo pipefail

RELEASE_BASE="${SIRK_PORTAL_RELEASE_BASE:-https://github.com/Eris92/SIRK-Portal/releases/download/portal-main-latest}"
INSTALL_ROOT="${SIRK_PORTAL_INSTALL_ROOT:-/opt/sirk/portal}"
DATA_ROOT="${SIRK_PORTAL_DATA_ROOT:-/var/lib/sirk-portal}"
CONFIG_ROOT="${SIRK_PORTAL_CONFIG_ROOT:-/etc/sirk-portal}"
HELPER_ROOT="${SIRK_PORTAL_HELPER_ROOT:-/usr/lib/sirk-portal}"
SERVICE_NAME="sirk-portal.service"
PORTAL_USER="${SIRK_PORTAL_USER:-sirkportal}"
PORTAL_GROUP="${SIRK_PORTAL_GROUP:-sirkportal}"
PORTAL_FQDN="${SIRK_INSTALL_FQDN:-}"
HTTPS_PORT="${SIRK_INSTALL_HTTPS_PORT:-443}"
REMOVE_DATA=0
NON_INTERACTIVE=0
UPDATE_ONLY=0
TRUST_CERTIFICATE=1

log() { printf '[INFO] %s\n' "$*"; }
ok()  { printf '[OK] %s\n' "$*"; }
step(){ printf '\n=== %s ===\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo bash install.sh [options]
  --fqdn NAME            Portal DNS name
  --port PORT            HTTPS port (default 443)
  --remove-data          Delete existing Portal data (clean reinstall)
  --non-interactive      Do not prompt; use SIRK_INSTALL_BREAKGLASS_PASSWORD for clean install
  --update-only          Update an existing Linux Portal through SIRK Updater
  --no-trust-certificate Do not add generated certificate to local Linux trust store
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fqdn) [[ $# -ge 2 ]] || die "--fqdn requires a value"; PORTAL_FQDN="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port requires a value"; HTTPS_PORT="$2"; shift 2 ;;
    --remove-data) REMOVE_DATA=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --update-only) UPDATE_ONLY=1; NON_INTERACTIVE=1; shift ;;
    --no-trust-certificate) TRUST_CERTIFICATE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run as root."
[[ "$(uname -s)" == "Linux" ]] || die "This installer is for Linux."
[[ "$(uname -m)" == "x86_64" ]] || die "Only linux-x64 is currently supported."
command -v systemctl >/dev/null 2>&1 || die "systemd/systemctl is required."
[[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] && (( HTTPS_PORT >= 1 && HTTPS_PORT <= 65535 )) || die "Invalid HTTPS port."

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  os_like="${ID:-} ${ID_LIKE:-}"
  [[ "$os_like" == *debian* || "$os_like" == *ubuntu* ]] || die "Supported distributions: Debian/Ubuntu."
else
  die "/etc/os-release is missing."
fi

step "Ensuring installer dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip openssl python3 sudo >/dev/null
update-ca-certificates >/dev/null 2>&1 || true

ensure_dotnet_component() {
  local metadata_property="$1" runtime_name="$2" display_name="$3"
  if command -v dotnet >/dev/null 2>&1 && dotnet --list-runtimes 2>/dev/null | grep -Eq "^${runtime_name//./\\.} 10\\.0\\."; then
    ok "$display_name already installed."
    return
  fi

  local metadata="$WORK_ROOT/dotnet-releases.json"
  if [[ ! -f "$metadata" ]]; then
    curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors \
      'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json' -o "$metadata"
  fi
  readarray -t component < <(python3 - "$metadata" "$metadata_property" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as f: d=json.load(f)
latest=d.get('latest-release')
r=next((x for x in d.get('releases',[]) if x.get('release-version')==latest),None)
if not r: raise SystemExit('Latest .NET 10 release metadata not found.')
c=r.get(sys.argv[2]) or {}
a=next((x for x in c.get('files',[]) if x.get('rid')=='linux-x64' and (x.get('name') or '').endswith('.tar.gz')),None)
if not a: raise SystemExit('linux-x64 runtime archive not found.')
print(c.get('version') or latest)
print(a['url'])
print((a.get('hash') or '').lower())
PY
)
  [[ "${#component[@]}" -eq 3 ]] || die "Unable to resolve $display_name."
  local version="${component[0]}" url="${component[1]}" expected="${component[2]}"
  local archive="$WORK_ROOT/${metadata_property}-${version}.tar.gz"
  log "Downloading $display_name $version..."
  curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors "$url" -o "$archive"
  if [[ -n "$expected" ]]; then
    local actual; actual="$(sha512sum "$archive" | awk '{print tolower($1)}')"
    [[ "$actual" == "$expected" ]] || die "Invalid SHA-512 for $display_name."
  fi
  mkdir -p /opt/dotnet
  tar -xzf "$archive" -C /opt/dotnet
  ln -sfn /opt/dotnet/dotnet /usr/local/bin/dotnet
  ok "$display_name $version installed."
}

WORK_ROOT="$(mktemp -d /tmp/sirk-portal-install.XXXXXX)"
trap 'rm -rf "$WORK_ROOT"' EXIT

step "Ensuring shared .NET 10 runtimes"
ensure_dotnet_component runtime Microsoft.NETCore.App "Microsoft .NET Runtime 10 x64"
ensure_dotnet_component aspnetcore-runtime Microsoft.AspNetCore.App "Microsoft ASP.NET Core Runtime 10 x64"
command -v dotnet >/dev/null 2>&1 || die "dotnet command is unavailable after runtime installation."

download_portal_release() {
  step "Downloading verified Portal linux-x64 release"
  local metadata="$WORK_ROOT/portal-update-linux-x64.json"
  local package="$WORK_ROOT/sirk-portal-linux-x64.zip"
  curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --retry-all-errors \
    "$RELEASE_BASE/portal-update-linux-x64.json?nocache=$(date +%s%N)" -o "$metadata"

  readarray -t fields < <(python3 - "$metadata" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding='utf-8-sig') as f: d=json.load(f)
required={'schemaVersion':1,'applicationId':'sirk-portal','channel':'main','package':'sirk-portal-linux-x64.zip','architecture':'linux-x64','deploymentMode':'framework-dependent','targetFramework':'net10.0'}
for k,v in required.items():
    if d.get(k)!=v: raise SystemExit(f'Invalid release metadata: {k}')
commit=str(d.get('commit') or '')
sha=str(d.get('sha256') or '').lower()
size=int(d.get('sizeBytes') or 0)
if not re.fullmatch(r'[0-9a-fA-F]{40}',commit): raise SystemExit('Invalid release commit.')
if not re.fullmatch(r'[0-9a-f]{64}',sha): raise SystemExit('Invalid release SHA-256.')
if not 1024 <= size <= 268435456: raise SystemExit('Invalid release size.')
print(commit.lower()); print(sha); print(size)
PY
)
  [[ "${#fields[@]}" -eq 3 ]] || die "Invalid Portal release metadata."
  RELEASE_COMMIT="${fields[0]}"; RELEASE_SHA="${fields[1]}"; RELEASE_SIZE="${fields[2]}"

  curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --retry-all-errors \
    "$RELEASE_BASE/sirk-portal-linux-x64.zip?nocache=$(date +%s%N)" -o "$package"
  [[ "$(stat -c %s "$package")" == "$RELEASE_SIZE" ]] || die "Portal package size mismatch."
  local actual; actual="$(sha256sum "$package" | awk '{print tolower($1)}')"
  [[ "$actual" == "$RELEASE_SHA" ]] || die "Portal package SHA-256 mismatch."
  ok "Portal package SHA-256 verified: $actual"

  PAYLOAD_ROOT="$WORK_ROOT/payload"
  mkdir -p "$PAYLOAD_ROOT"
  unzip -q "$package" -d "$PAYLOAD_ROOT"
  for required in Sirk.Portal.dll Sirk.Portal.runtimeconfig.json public/portal/standalone/index.html public/portal/standalone/login.html release-manifest.json install-linux.sh; do
    [[ -f "$PAYLOAD_ROOT/$required" ]] || die "Portal release payload is incomplete: $required"
  done
  [[ ! -f "$PAYLOAD_ROOT/appsettings.Production.json" ]] || die "Public Portal release must not contain machine configuration."
  python3 - "$PAYLOAD_ROOT/release-manifest.json" "$RELEASE_COMMIT" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as f: d=json.load(f)
if d.get('applicationId')!='sirk-portal' or d.get('channel')!='main' or d.get('architecture')!='linux-x64' or d.get('targetFramework')!='net10.0' or d.get('commit')!=sys.argv[2]:
    raise SystemExit('Portal release manifest does not match metadata.')
PY
  PORTAL_PACKAGE="$package"
}

download_portal_release

ensure_updater() {
  if [[ -x /opt/sirk/updater/SirkUpdater ]] && systemctl is-active --quiet sirk-updater.service; then
    ok "SIRK Updater is already installed."
  else
    step "Installing SIRK Updater for Linux"
    local installer="$WORK_ROOT/install-updater.sh"
    curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors \
      "https://raw.githubusercontent.com/Eris92/SIRK-Updater/main/install-release-v2.sh?nocache=$(date +%s%N)" -o "$installer"
    chmod 0700 "$installer"
    bash "$installer"
  fi
}

register_updater_manifest() {
  local manifest="$WORK_ROOT/updater-portal-manifest.json"
  cat >"$manifest" <<JSON
{
  "schemaVersion": 2,
  "applicationId": "sirk-portal",
  "displayName": "SIRK Portal",
  "serviceName": "sirk-portal.service",
  "watchdogServiceName": null,
  "installRoot": "$INSTALL_ROOT",
  "dataRoot": "$DATA_ROOT",
  "healthUrl": "https://localhost:$HTTPS_PORT/readyz",
  "channel": "dev",
  "updateSource": "https://github.com/Eris92/SIRK-Portal",
  "packageSha256Url": null,
  "signatureRequired": false,
  "signatureVerifierPath": null,
  "signatureVerifierArguments": []
}
JSON
  /opt/sirk/updater/SirkUpdater register "$manifest"
}

if (( UPDATE_ONLY == 1 )); then
  [[ -f "$DATA_ROOT/identity.json" ]] || die "Existing Portal identity was not found. Use clean installation first."
  [[ -d "$INSTALL_ROOT" ]] || die "Existing Portal installation was not found."
  ensure_updater
  register_updater_manifest
  step "Applying transactional Portal update"
  /opt/sirk/updater/SirkUpdater update sirk-portal "$PORTAL_PACKAGE" "$RELEASE_SHA" "$RELEASE_COMMIT"
  systemctl is-active --quiet "$SERVICE_NAME" || die "Portal service is not running after update."
  curl --fail --silent --show-error --max-time 10 "https://localhost:$HTTPS_PORT/readyz" >/dev/null || die "Portal readiness check failed after update."
  printf 'SIRK_PORTAL_LINUX_UPDATE_OK\n'
  printf 'Release commit: %s\n' "$RELEASE_COMMIT"
  exit 0
fi

if [[ -f "$DATA_ROOT/identity.json" && "$REMOVE_DATA" -ne 1 ]]; then
  die "Existing Portal data detected. Use --update-only or --remove-data for a clean reinstall."
fi

if [[ -z "$PORTAL_FQDN" ]]; then
  PORTAL_FQDN="$(hostname -f 2>/dev/null || hostname)"
fi
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
if (( REMOVE_DATA == 1 )); then rm -rf "$DATA_ROOT"; fi
rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT" "$DATA_ROOT" "$CONFIG_ROOT" "$HELPER_ROOT"
cp -a "$PAYLOAD_ROOT/." "$INSTALL_ROOT/"
chmod 0755 "$INSTALL_ROOT/install-linux.sh"

if ! getent group "$PORTAL_GROUP" >/dev/null; then groupadd --system "$PORTAL_GROUP"; fi
if ! id "$PORTAL_USER" >/dev/null 2>&1; then
  useradd --system --gid "$PORTAL_GROUP" --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin "$PORTAL_USER"
fi

step "Creating Break-Glass bootstrap credentials"
security_root="$DATA_ROOT/security"
mkdir -p "$security_root"
printf '%s' "$plain_password" >"$security_root/break-glass-password.bootstrap"
access_code="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
printf '%s' "$access_code" >"$security_root/break-glass-access-code.txt"
unset plain_password

step "Creating HTTPS certificate"
tls_root="$DATA_ROOT/TLS"
mkdir -p "$tls_root"
pfx_password="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
host_short="$(hostname -s | tr '[:upper:]' '[:lower:]')"
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 1095 \
  -keyout "$tls_root/portal.key" -out "$tls_root/portal.crt" \
  -subj "/CN=$PORTAL_FQDN" \
  -addext "subjectAltName=DNS:$PORTAL_FQDN,DNS:$host_short,DNS:localhost,IP:127.0.0.1,IP:::1" \
  -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1
openssl pkcs12 -export -out "$tls_root/portal.pfx" -inkey "$tls_root/portal.key" -in "$tls_root/portal.crt" \
  -passout "pass:$pfx_password" >/dev/null 2>&1
rm -f "$tls_root/portal.key"
if (( TRUST_CERTIFICATE == 1 )); then
  cp "$tls_root/portal.crt" /usr/local/share/ca-certificates/sirk-portal.crt
  update-ca-certificates >/dev/null
fi
if ! grep -Eq "^[[:space:]]*127\.0\.0\.1[[:space:]].*\b${PORTAL_FQDN//./\\.}\b" /etc/hosts; then
  printf '\n127.0.0.1\t%s\t# SIRK Portal local health\n' "$PORTAL_FQDN" >>/etc/hosts
fi

step "Writing systemd configuration"
public_url="https://$PORTAL_FQDN"
[[ "$HTTPS_PORT" == "443" ]] || public_url="https://$PORTAL_FQDN:$HTTPS_PORT"
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
Sirk__Central__UpdateChannel=dev
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
Type=notify
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

step "Validating health and frontend"
deadline=$((SECONDS + 120))
until curl --fail --silent --show-error --max-time 5 "https://localhost:$HTTPS_PORT/healthz" | grep -q 'healthy'; do
  (( SECONDS < deadline )) || { journalctl -u "$SERVICE_NAME" -n 100 --no-pager >&2 || true; die "Portal did not pass health check."; }
  sleep 2
done
curl --fail --silent --show-error --max-time 10 "https://localhost:$HTTPS_PORT/readyz" | grep -q 'ready' || die "Portal did not pass readiness check."
curl --fail --silent --show-error --max-time 10 "https://localhost:$HTTPS_PORT/login" | grep -q 'sirk-login-page' || die "Portal login frontend is incomplete."
[[ -f "$DATA_ROOT/identity.json" ]] || die "Break-Glass identity was not initialized."
rm -f "$security_root/break-glass-password.bootstrap"

ensure_updater
register_updater_manifest

step "Installing narrow maintenance helpers"
systemctl_path="$(command -v systemctl)"
cat >"$HELPER_ROOT/update-helper" <<HELPER
#!/bin/sh
exec $INSTALL_ROOT/install-linux.sh --update-only --non-interactive
HELPER
cat >"$HELPER_ROOT/restart-helper" <<HELPER
#!/bin/sh
exec $systemctl_path restart $SERVICE_NAME
HELPER
chmod 0755 "$HELPER_ROOT/update-helper" "$HELPER_ROOT/restart-helper"
chown root:root "$HELPER_ROOT/update-helper" "$HELPER_ROOT/restart-helper"
cat >"/etc/sudoers.d/sirk-portal-maintenance" <<SUDOERS
$PORTAL_USER ALL=(root) NOPASSWD: $HELPER_ROOT/update-helper, $HELPER_ROOT/restart-helper
SUDOERS
chmod 0440 /etc/sudoers.d/sirk-portal-maintenance
visudo -cf /etc/sudoers.d/sirk-portal-maintenance >/dev/null

printf '\nSIRK_PORTAL_LINUX_BINARY_INSTALL_OK\n'
printf 'Release commit: %s\n' "$RELEASE_COMMIT"
printf 'URL: %s/login\n' "$public_url"
printf 'Access URL: %s/login#access=%s\n' "$public_url" "$access_code"
printf 'Access Code file: %s/security/break-glass-access-code.txt\n' "$DATA_ROOT"
printf 'Service: %s\n' "$SERVICE_NAME"
printf 'Install root: %s\n' "$INSTALL_ROOT"
printf 'Data root: %s\n' "$DATA_ROOT"
