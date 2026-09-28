# UniWork Office engine service (G2-02). Build from the repository root:
#   docker build -f apps/office-engine/Dockerfile -t uniwork-office-engine .
# The image carries everything the service runs: the bundled service, the
# worker entry and (when G2-04/G2-05 land) the native sidecars those lanes add
# to the runtime stage. It never reaches an external Office/OCR service: a
# failed job is a typed error, not a fallback call.

FROM node:22.23.2-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /repo
# Manifests first so the dependency layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/office-engine/package.json apps/office-engine/
COPY packages/office-contracts/package.json packages/office-contracts/
COPY packages/office-engine/package.json packages/office-engine/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@uniwork/office-engine-app..." --filter uniwork
COPY packages/office-contracts packages/office-contracts
COPY packages/office-engine/src packages/office-engine/src
COPY packages/office-engine/assets packages/office-engine/assets
COPY packages/tsconfig packages/tsconfig
COPY apps/office-engine/src apps/office-engine/src
COPY apps/office-engine/scripts apps/office-engine/scripts
RUN node apps/office-engine/scripts/build.mjs
# G2-05 pdf assets: the bundle ships no node_modules, so the wasm files and the
# bundled OFL fonts are staged where UNIWORK_PDF_ASSETS points. Resolving the
# wasm through the installed packages (not a .pnpm path literal) keeps the pin
# honest — a bumped catalog version still resolves to the matching file.
RUN mkdir -p /repo/pdf-assets/fonts && \
    cp "$(node -p "require.resolve('@embedpdf/pdfium/pdfium.wasm', {paths:['/repo/packages/office-engine']})")" /repo/pdf-assets/pdfium.wasm && \
    cp "$(node -p "require('node:path').join(require('node:path').dirname(require.resolve('harfbuzzjs', {paths:['/repo/packages/office-engine']})), 'harfbuzz-subset.wasm')")" /repo/pdf-assets/harfbuzz-subset.wasm && \
    cp packages/office-engine/assets/fonts/NotoSans-Regular.ttf packages/office-engine/assets/fonts/NotoSans-Bold.ttf /repo/pdf-assets/fonts/

# ── G2-04 xlsx lane: vendored upstream → patched gateway bundle + Rust
# sidecar, both built from source under their own lockfiles (npm lock for the
# gateway, Cargo.lock for the sidecar). scripts/office/build-upstream.mjs runs
# provenance-check → patch → npm install → esbuild → cargo build --release and
# writes build-record.json with every artifact's sha256 — that record is the
# checksum evidence the lane must ship. Built once here, copied into the test
# and production stages; never fetched at runtime.
FROM node:22.23.2-bookworm-slim AS xlsx-src
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates build-essential && \
    rm -rf /var/lib/apt/lists/* && \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.88.0 && \
    corepack enable && corepack prepare pnpm@10.28.2 --activate
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /repo
# esbuild must resolve from the repo manifest (the build script pins it to the
# UniWork lockfile, never the upstream tree); installing just the root project
# keeps this stage off the full workspace graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --filter .
COPY scripts/office scripts/office
COPY scripts/office-g0 scripts/office-g0
COPY packages/office-upstream packages/office-upstream
COPY docs/office/g0/source-manifest.json docs/office/g0/source-manifest.json
RUN node scripts/office/build-upstream.mjs --with-native --out /xlsx-build --json > /xlsx-build-log.json && \
    test -f /xlsx-build/dist/xlsx-gateway.mjs && \
    test -x /xlsx-build/upstream/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar

# Test stage: the service suite on Linux, where the process-group, /proc and
# job-tag paths of process-tree.ts actually run. Not part of the image:
#   docker build -f apps/office-engine/Dockerfile --target test -t uniwork-office-engine:test .
#   docker run --rm --init uniwork-office-engine:test
FROM build AS test
COPY GATE_LEVEL ./
COPY scripts/coverage-gate.ts scripts/vitest-pool.ts scripts/
COPY apps/office-engine/test apps/office-engine/test
# The Go-signed grant parity fixture (grants.test.ts).
COPY server/internal/office/testdata server/internal/office/testdata
# G2-05 pdf fixtures (pipeline.test.ts / pdf-jobs.test.ts read these bytes).
COPY docs/office/g0/fixtures/files/pdf docs/office/g0/fixtures/files/pdf
# G2-04 xlsx fixtures + the real artifacts (gateway bundle + Rust sidecar) so
# the service suite exercises the real engine, not a stand-in.
COPY docs/office/g0/fixtures/files/sheets docs/office/g0/fixtures/files/sheets
COPY --from=xlsx-src /xlsx-build/dist/xlsx-gateway.mjs /repo/xlsx-test-assets/xlsx-gateway.mjs
COPY --from=xlsx-src /xlsx-build/upstream/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar /repo/xlsx-test-assets/xlsx-sidecar
COPY --from=xlsx-src /xlsx-build/build-record.json /repo/xlsx-build-record.json
ENV UNIWORK_XLSX_ASSETS=/repo/xlsx-test-assets
COPY apps/office-engine/vitest.config.ts apps/office-engine/tsconfig.json apps/office-engine/
WORKDIR /repo/apps/office-engine
ENV CI=1
CMD ["node", "/repo/apps/office-engine/node_modules/vitest/vitest.mjs", "run", "--coverage"]

# G2-04 acceptance evidence: the fixture replay exercises the real adapter
# seam against the real patched gateway + the Linux Rust sidecar, with jszip
# (the upstream lockfile's copy) as the independent oracle. It shares the
# service's Linux node_modules (esbuild) and the xlsx-src build tree, and is
# never part of the shipped image:
#   docker build -f apps/office-engine/Dockerfile --target xlsx-replay -t uniwork-office-engine:xlsx-replay .
#   docker run --rm -v <evidence-dir>:/tmp/xlsx-replay uniwork-office-engine:xlsx-replay
FROM build AS xlsx-replay
COPY packages/office-engine/test packages/office-engine/test
COPY packages/office-upstream/provenance.json packages/office-upstream/provenance.json
COPY docs/office/g0/fixtures/files/sheets docs/office/g0/fixtures/files/sheets
COPY --from=xlsx-src /xlsx-build /xlsx-build
WORKDIR /repo
CMD ["node", "packages/office-engine/test/replay/g2-04-replay.mjs", "--build-dir", "/xlsx-build", "--format", "xlsx", "--out", "/tmp/xlsx-replay"]

FROM node:22.23.2-bookworm-slim
ENV NODE_ENV=production \
    OFFICE_ENGINE_HOST=0.0.0.0 \
    OFFICE_ENGINE_PORT=8090 \
    OFFICE_ENGINE_TEMP_DIR=/tmp/uniwork-office-engine \
    OFFICE_ENGINE_SANDBOX=required \
    UNIWORK_PDF_ASSETS=/app/pdf-assets \
    UNIWORK_XLSX_ASSETS=/app/xlsx-assets
WORKDIR /app
COPY --from=build /repo/apps/office-engine/dist/ ./
COPY --from=build /repo/pdf-assets /app/pdf-assets
# Same image, supervisor-owned: the sidecar is spawned per job by the worker
# inside the job sandbox; the gateway bundle is imported, not executed.
COPY --from=xlsx-src /xlsx-build/dist/xlsx-gateway.mjs /app/xlsx-assets/xlsx-gateway.mjs
COPY --from=xlsx-src /xlsx-build/upstream/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar /app/xlsx-assets/xlsx-sidecar
COPY --from=xlsx-src /xlsx-build/build-record.json /app/xlsx-assets/build-record.json
# The supervisor runs as uid 0 so it can drop each job's worker to its own
# slot uid before the handler loads (G2-05 sandbox). Workers themselves are
# unprivileged and own nothing but their 0700 job dir; the compose profile
# strips every capability the supervisor does not need.
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.OFFICE_ENGINE_PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Exec form so SIGTERM reaches main.mjs, which drains and kills every worker
# tree before exiting. Run with an init (compose: init: true) to reap orphans.
CMD ["node", "main.mjs"]
