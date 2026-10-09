#!/usr/bin/env bash
# System toolchain for a cloud runner VM whose checkout is UNIAI-TEAM/uniwork-office
# (run-tests.sh --profile office), following that repository's
# .github/workflows/ci.yml: Node 22, Rust for the xlsx sidecar
# (apps/sheets/native/xlsx-engine), xmllint, the document fonts of the visual
# baselines, and xvfb plus the Electron/Chromium libraries for "E2E (Electron
# shell)". No Postgres, Redis or MinIO. Idempotent, like provision.sh.
# Runs as root or as a user with passwordless sudo.
set -euo pipefail

NODE_MAJOR=22
# CI uses the stable channel; the runner pins the toolchain the sidecar is known
# to build with (edition 2024), as provision.sh does for office-upstream.
RUST_VERSION=1.88.0

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

# libxml2-utils: xmllint for the OOXML tests. fonts-*: "Install document fonts".
# xvfb/xauth/dbus-x11: xvfb-run for the Electron e2e. The Chromium/Electron
# shared libraries come from `playwright install-deps` in install-office.sh.
packages=(ca-certificates curl git gnupg sudo make jq unzip xz-utils build-essential pkg-config
  tzdata procps lsof libxml2-utils xvfb xauth dbus-x11
  fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-cjk)
missing=()
for p in "${packages[@]}"; do dpkg -s "$p" > /dev/null 2>&1 || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then
  $SUDO apt-get update -q
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${missing[@]}"
fi

case "$(node --version 2>/dev/null)" in
  "v${NODE_MAJOR}."*) ;;
  *)
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs
    ;;
esac

export PATH=$HOME/.cargo/bin:$PATH
if ! rustc "+$RUST_VERSION" --version > /dev/null 2>&1; then
  if command -v rustup > /dev/null 2>&1; then
    rustup toolchain install "$RUST_VERSION" --profile minimal
  else
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION"
  fi
fi
rustup default "$RUST_VERSION" > /dev/null 2>&1 || true

echo "cloud provision (office): done (node $(node --version), npm $(npm --version), $(rustc --version))"
