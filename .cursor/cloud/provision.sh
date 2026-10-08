#!/usr/bin/env bash
# System toolchain and services for a Cursor cloud agent, matching
# .github/workflows/ci.yml. Shared by .cursor/Dockerfile and install.sh, so it
# is idempotent: each step checks what is already on disk and skips it.
# Runs as root or as a user with passwordless sudo.
set -euo pipefail

GO_VERSION=1.27.0
NODE_MAJOR=22
PNPM_VERSION=10.28.2
PLAYWRIGHT_VERSION=1.62.1
# The office-upstream xlsx sidecar (xlsx-engine crate, edition 2024).
RUST_VERSION=1.88.0
# MinIO is no longer downloadable from dl.min.io or Docker Hub's minio/minio;
# the binaries come from the frozen Bitnami build CI uses as its service.
MINIO_IMAGE=bitnamilegacy/minio
MINIO_TAG=2025.7.23

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"
MARKERS=/var/lib/uniwork-cloud
$SUDO mkdir -p "$MARKERS"

# Postgres 16 and Redis 7 are the noble packages (CI: postgres:16, redis:7).
# postgresql-contrib carries pg_trgm (migration 134).
# The desktop Linux proof (UNI-920) builds .deb/AppImage and runs them under
# Xvfb with a keyring: xvfb, dbus-x11, gnome-keyring, libsecret, xdg-utils,
# desktop-file-utils, fakeroot/dpkg-dev; libfuse2t64 is noble's libfuse2.
packages=(ca-certificates curl git gnupg sudo make jq unzip xz-utils build-essential
  tzdata procps lsof postgresql-16 postgresql-contrib redis-server
  xvfb xauth dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools xdg-utils desktop-file-utils
  fakeroot dpkg-dev libfuse2t64)
missing=()
for p in "${packages[@]}"; do dpkg -s "$p" > /dev/null 2>&1 || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then
  $SUDO apt-get update -q
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${missing[@]}"
fi

if [ "$(/usr/local/go/bin/go env GOVERSION 2>/dev/null)" != "go${GO_VERSION}" ]; then
  $SUDO rm -rf /usr/local/go
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | $SUDO tar -C /usr/local -xz
fi
echo 'export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH' | $SUDO tee /etc/profile.d/uniwork-go.sh > /dev/null
export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH

case "$(node --version 2>/dev/null)" in
  "v${NODE_MAJOR}."*) ;;
  *)
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs
    ;;
esac
[ "$(pnpm --version 2>/dev/null)" = "$PNPM_VERSION" ] || $SUDO npm install -g "pnpm@${PNPM_VERSION}"

if [ ! -f "$MARKERS/playwright-deps-$PLAYWRIGHT_VERSION" ]; then
  # npm 10 treats `npx pkg@version` as a shell command, and a checkout with
  # packageManager set makes `npm exec` look only at local bins. Run outside
  # the repo. install-deps escalates with sudo itself.
  (cd /tmp && npx --yes --package="playwright@${PLAYWRIGHT_VERSION}" -- playwright install-deps chromium)
  $SUDO touch "$MARKERS/playwright-deps-$PLAYWRIGHT_VERSION"
fi

if [ ! -f "$MARKERS/minio-$MINIO_TAG" ] || [ ! -x /usr/local/bin/minio ] || [ ! -x /usr/local/bin/mc ]; then
  accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
  token=$(curl -fsS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${MINIO_IMAGE}:pull" | jq -r .token)
  reg() { curl -fsSL -H "Authorization: Bearer $token" -H "Accept: $accept" "https://registry-1.docker.io/v2/${MINIO_IMAGE}/$1"; }
  digest=$(reg "manifests/$MINIO_TAG" | jq -r '.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest')
  tmp=$(mktemp -d)
  for layer in $(reg "manifests/$digest" | jq -r '.layers[].digest'); do
    reg "blobs/$layer" | tar -xz -C "$tmp" --wildcards 'opt/bitnami/minio/bin/minio' 'opt/bitnami/minio-client/bin/mc' 2> /dev/null || true
  done
  $SUDO install -m 0755 "$tmp/opt/bitnami/minio/bin/minio" /usr/local/bin/minio
  $SUDO install -m 0755 "$tmp/opt/bitnami/minio-client/bin/mc" /usr/local/bin/mc
  rm -rf "$tmp"
  $SUDO touch "$MARKERS/minio-$MINIO_TAG"
fi
$SUDO mkdir -p /var/lib/minio
$SUDO chown "$(id -un):$(id -gn)" /var/lib/minio

# Rust for the xlsx sidecar build and cargo tests (specs/rust-sidecar.txt): rustup, minimal
# profile, one pinned toolchain under $HOME, so CARGO_HOME/RUSTUP_HOME survive warm-VM rounds.
# The linker comes from build-essential above.
export PATH=$HOME/.cargo/bin:$PATH
if ! rustc "+$RUST_VERSION" --version > /dev/null 2>&1; then
  if command -v rustup > /dev/null 2>&1; then
    rustup toolchain install "$RUST_VERSION" --profile minimal
  else
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION"
  fi
fi
rustup default "$RUST_VERSION" > /dev/null 2>&1 || true

echo "cloud provision: done ($(go env GOVERSION), node $(node --version), pnpm $(pnpm --version), $(rustc --version))"
