# UniWork Office desktop packaging (G4-07a)

Status: G4-07a unsigned development packaging. This runbook covers the
reproducible Windows x64 development archive, provenance inventory, identity
manifest, diagnostics contract, and update configuration validation. Signed
installers, update verification, rollback, notarization, and install/upgrade
coexistence are 07b/07c work and are deliberately not enabled here.

## Source of truth and identity

`apps/office-desktop/identity.json` is the accepted G4-D1 manifest. Its
`status` is `accepted` and its `decision` is `G4-D1`; app id, executable,
artifact prefix, user callback and internal schemes, user/dev/key namespaces,
channels, engine contract/protocol versions, and build id are read from this
file. `apps/office-desktop/shared/identity.ts` validates the complete manifest
with a strict schema and exposes the typed projection used by main, deep links,
navigation and diagnostics. `scripts/build.mjs` and `scripts/package.mjs` read
the same JSON, so a build cannot silently acquire a second identity.

The `desktop:diagnostics` IPC read is main-owned and schema-validated. It
returns only app id/version, engine version, contract version, protocol version,
channel, and build id. It never returns document content, paths, account data,
tokens, signing material, or other secrets.

## Packager and targets

The packager is **electron-builder 26.15.3** with **Electron 44.5.0**. Both
versions are pinned once in the root `pnpm-workspace.yaml` `catalog:` block and
are devDependencies of `@uniwork/office-desktop`; no production module imports
either package. `@electron/packager` and Electron Forge were considered and
rejected because electron-builder provides the required cross-platform target
declaration and release resource hooks in one reviewed configuration.

G4-D3 permits an unsigned, explicitly labelled development artifact only. The
Windows target is a ZIP archive for x64, named
`uniwork-office_<version>_unsigned-dev_win32_x64.zip`. ZIP is used instead of
an installer so this slice does not imply a signed installer or update path;
installer targets are owned by 07c. The macOS target matrix is present in the
configuration for arm64 and x64 and is checked by tests only on the Windows
host; no macOS binary is built here. `publish: null`, no publisher, no feed, and
`update.enabled: false` prevent accidental upstream or unsigned auto-update.

## Build from a clean checkout

Use Node 22.23.2 and keep all Electron/builder caches and outputs on D: (the
example paths assume this worktree):

```powershell
$env:PATH = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\tools\node-v22.23.2-win-x64;' + $env:PATH
$env:ELECTRON_CACHE = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\electron-cache'
$env:electron_config_cache = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\electron-config'
$env:ELECTRON_BUILDER_CACHE = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\electron-builder-cache'
$env:OFFICE_DESKTOP_CACHE = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\office-desktop-cache'
$env:OFFICE_DESKTOP_OUTPUT = 'D:\.Vietants_Project\uniwork-workspace\.uniwork-dev\office-desktop-artifacts'
pnpm install --frozen-lockfile
pnpm --filter @uniwork/office-desktop typecheck
pnpm --filter @uniwork/office-desktop lint
pnpm --filter @uniwork/office-desktop test
pnpm --filter @uniwork/office-desktop package
```

`package.mjs` refuses a sibling `../genoffice` source before packaging. The
build only bundles tracked in-repository sources and the resolved workspace
dependencies. There is no private symlink, upstream feed, authentication
endpoint, telemetry module, or signing secret in the package configuration.

The macOS declaration can be checked without a macOS runner:

```powershell
node --test apps/office-desktop/scripts/package.test.mjs
```

## Release inventory

Before electron-builder runs, `scripts/release-inventory.mjs` creates
`dist/release-inventory/` and copies `packages/office-upstream/LICENSE` and
`NOTICE`. It records the upstream pinned commit/tree and files digest from
`provenance.json`, SHA-256 digests for every patch in `patches/`, and font
redistribution rows from the fixture licence manifest. It runs a clean `ee/`
path scan and refuses packaging if any excluded Enterprise material is found.
Third-party notices are generated from both production and development
resolved dependency graphs (`pnpm list`, depth 10) and include package name,
version, and licence. The inventory, notices, and scan are copied into the
artifact at `resources/release-inventory/`.

The inventory test is part of the desktop package test command and proves the
source pin, patch rows, resolved Electron dependency, font rows, copied
licences, and empty `ee/` scan. Do not hand-edit generated inventory files.

## Update configuration

`apps/office-desktop/main/updates/config.ts` validates `{ enabled, feed,
publisher, channel }` with a strict schema. Missing input, malformed values,
and a channel different from the manifest are typed refusals. The only default
is `{ enabled: false, feed: null, publisher: null, channel: "dev" }`; enabling
requires both a feed and publisher and is outside G4-07a. There is no
`electron-updater` dependency and no unsigned automatic update fallback.

## Evidence and cleanup

One Windows x64 run on the pinned Node 22 toolchain produced:

```text
Artifact: uniwork-office_0.0.0_unsigned-dev_win32_x64.zip
SHA-256: 404d2288d718ca2f8d21c12bbf7f0923691ae316bd5aa2deee8f704331b45454
Size: 424302782 bytes
```

The archive listing contains `resources/release-inventory/LICENSE`,
`NOTICE`, `THIRD-PARTY-NOTICES.txt`, `source-and-patches.json`, and
`EE-SCAN.json`; the application bundle contains the generated build metadata
and identity manifest. The binary itself is kept only until the checksum and
listing are recorded in the acceptance packet. Then delete the artifact and
unpacked output directories, retaining the checksum, listing, and inventory
report under the run report destination. Electron/builder caches may remain on
D: for reproducible subsequent runs.

## Required checks

The final revision must have passing results for the desktop typecheck, lint,
Vitest suite (including IPC/diagnostics and update-config tests), package
script tests, `node scripts/office/check-boundaries.mjs`, `pnpm knip`, catalog
and governance tests, and `pnpm audit --audit-level high`. The accepted
artifact is unsigned development evidence only and must not be described as a
release installer or an enabled update channel.
