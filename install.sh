#!/usr/bin/env bash
set -euo pipefail

url="https://raw.githubusercontent.com/Eris92/SIRK-Portal/main/install-linux.sh?nocache=$(date +%s%N)"
tmp="$(mktemp /tmp/sirk-portal-linux-router.XXXXXX.sh)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --location --retry 4 --retry-delay 2 --retry-all-errors "$url" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
else
  printf '[ERROR] curl or wget is required to bootstrap SIRK Portal.\n' >&2
  exit 1
fi

chmod 0700 "$tmp"
bash "$tmp" "$@"
