# UniWork Office desktop packaging and updates (G4-07a/07b)

Status: unsigned development packaging and local update verification. This runbook covers the
reproducible Windows x64 ZIP and per-user NSIS installer, provenance inventory,
identity manifest, diagnostics contract, deployment-profile seam, and update
configuration validation, test-key signature verification, restart checkpoints,
and draft-format rollback. Production signed Windows/macOS artifacts,
notarization and install/upgrade/uninstall qualification remain 07c/G7 work.

## Source of truth and identity

`apps/office-desktop/identity.json` is the accepted G4-D1 manifest. Its
`status` is `accepted` and its `decision` is `G4-D1`; channel profiles in this
single file derive the app id, executable, product/shortcut name, artifact
prefix, callback/scheme, user-data and key namespaces. Beta and stable share
the `com.uniwork.office` / `uniwork-office` identity and therefore upgrade in
place; the dev profile uses `com.uniwork.office.dev`,
`uniwork-office-dev://auth/callback`, and `uniwork-office-dev` data. The build
projection is written to `dist/build-identity.json` and is consumed by the
packaged main graph, so a beta or dev package cannot accidentally run with the
stable source projection.

`UNIWORK_OFFICE_CHANNEL` selects `dev`, `beta`, or `stable` (default `dev` for
local development). `UNIWORK_OFFICE_BUILD_NUMBER` defaults to `0` and produces
`0.1.0-dev.N` or `0.1.0-beta.N`; stable uses `0.1.0` but is refused while
signing is disabled. The deployment values are deliberately download-time
configuration: `resolveDeploymentProfile()` first reads a strict installed
profile (`deploymentId`, `apiOrigin` using HTTPS, `clientId`, and matching
`channel`) beside the app or in user data, then permits the two build-time env
variables only for dev/local builds and tests. Otherwise it returns the typed
`no_deployment_profile` state so the UI can ask the user to download again from
the UniWork site; it never defaults to a production server.

The `desktop:diagnostics` IPC read is main-owned and schema-validated. It
returns the display name, app id/version, engine version, contract version,
protocol version, channel, build id, deployment id, and API origin host. It
never returns document content, paths, account data, tokens, signing material,
or other secrets.

## Packager and targets

The packager is **electron-builder 26.15.3** with **Electron 44.5.0**. Both
versions are pinned once in the root `pnpm-workspace.yaml` `catalog:` block and
are devDependencies of `@uniwork/office-desktop`; no production module imports
either package. `@electron/packager` and Electron Forge were considered and
rejected because electron-builder provides the required cross-platform target
declaration and release resource hooks in one reviewed configuration.

G4-D3 permits explicitly labelled unsigned dev/beta artifacts only. The
Windows x64 targets are a ZIP and an NSIS setup, for example
`uniwork-office-test_0.1.0-dev.42_unsigned_win32_x64.zip` and
`uniwork-office-test_0.1.0-dev.42_unsigned_win32_x64-setup.exe`.
`win.signAndEditExecutable: false`, `forceCodeSigning: false`, `publish: null`,
and no publisher/feed keep signing and auto-update disabled. The NSIS setup is
one-click, per-user (`perMachine: false`, no elevation), installs below
`%LOCALAPPDATA%\Programs\<userDataNamespace>` (the channel-derived manifest
namespace), creates the manifest-named Start Menu shortcut,
uninstaller, and Apps & features entry, and registers the manifest scheme for
the current user. The uninstaller removes that scheme; it preserves user data
and drafts unless the user explicitly confirms the delete-data option (silent
uninstall keeps data). Beta and stable use the same app id/executable/install
directory/GUID, so a stable setup replaces a beta setup and its shortcut rather
than creating a second installation.

The macOS arm64/x64 matrix builds one unsigned `.dmg` per architecture on a macOS host
(`identity: null`, `hardenedRuntime: false`, `LSMinimumSystemVersion` 13.0); the Linux x64 targets
are a `.deb` and an AppImage (UNI-920). Their build commands, install steps, wrong-machine guards
and limits are in `desktop-install-macos-ubuntu.md`. An ad-hoc beta-to-
signed-stable upgrade may lose keychain draft-key access, so 07c must migrate
keys or instruct users to save before upgrading.

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
$env:UNIWORK_OFFICE_CHANNEL = 'dev' # beta is also buildable; stable requires signing
$env:UNIWORK_OFFICE_BUILD_NUMBER = '42'
pnpm install --frozen-lockfile
pnpm --filter @uniwork/office-desktop typecheck
pnpm --filter @uniwork/office-desktop lint
pnpm --filter @uniwork/office-desktop test
pnpm --filter @uniwork/office-desktop package
pnpm --filter @uniwork/office-desktop smoke
pnpm --filter @uniwork/office-desktop smoke:installer
```

For dev/local smoke only, set `UNIWORK_OFFICE_DEPLOYMENT_ID` and
`UNIWORK_OFFICE_API_ORIGIN` (HTTPS; HTTP is accepted only for localhost in
dev). A beta build may omit them and resolve the installed/downloaded profile
later. A packaged build ignores runtime environment overrides for its user-data
directory and deployment origin; only an explicit `--office-desktop-smoke`
launch enables those local test seams. Invalid, partial, non-HTTPS, or
channel-mismatched profiles fail with a typed refusal; a missing beta/stable
profile is the `no_deployment_profile` state, never a production default.

`package.mjs` records an esbuild metafile and refuses every resolved input whose
real path escapes the checkout. This catches sibling `../genoffice` material,
private symlinks, and any other outside-repository import; the guard is tested
with both an in-repository and an escaping fixture. The asar contains only the
bundled `dist/**` payload, identity/build profiles, and dependency-free
`package.json`; raw `node_modules`, source maps, and test fixtures are excluded.
There is no upstream feed, authentication endpoint, telemetry module, or
signing secret in the package configuration.

`electron-main.ts` is the packaged Electron entry. It applies the selected
identity/AUMID and user-data namespace, acquires the single-instance lock,
registers the user scheme through the G4-05a seam, creates one secure
`BrowserWindow`, and wires the narrow IPC dispatcher. The launch smoke starts
the unpacked executable with a D: user-data directory, waits for
`ready-to-show`, checks diagnostics identity, and quits. The installer smoke
installs the setup into a D: per-user directory, launches it, verifies scheme
registration and diagnostics, uninstalls, verifies registry removal, and
checks that a drafts sentinel remains. Set
`OFFICE_DESKTOP_INSTALL_SMOKE_DEFAULT=1` for the companion disposable-profile
run without `/D=`; it asserts the default
`%LOCALAPPDATA%\Programs\<userDataNamespace>` directory and refuses to
overwrite an existing installation.

Unsigned Windows packages may trigger SmartScreen. Select **More info -> Run
anyway** for this local artifact. If Windows marks a downloaded setup with a
Mark-of-the-Web block, use `Unblock-File .\uniwork-office-*_setup.exe` (or the
file Properties **Unblock** checkbox). To upgrade, run the newer setup over the
existing beta/stable install; the shared GUID/app id replaces the old shortcut
and keeps user data. Uninstall removes the app and scheme but keeps drafts by
default; use the explicit delete-data choice only when that data is no longer
needed. A portable ZIP has no uninstaller, so deleting its directory does not
remove the current-user scheme registration; remove that registration manually
or use the NSIS uninstaller.

## Release inventory

Before electron-builder runs, `scripts/release-inventory.mjs` creates
`dist/release-inventory/` and copies `packages/office-upstream/LICENSE` and
`NOTICE`. It records the upstream pinned commit/tree and files digest from
`provenance.json`, SHA-256 digests for every patch in `patches/`, and font
redistribution rows from the fixture licence manifest. It runs a clean `ee/`
path scan and refuses packaging if any excluded Enterprise material is found.
Third-party notices are generated from the resolved production dependency graph
(`pnpm list`, depth 10) plus the embedded Electron runtime and include package
name, version, SPDX licence, and the package's LICENSE/NOTICE text. Private
workspace packages are explicitly allowlisted as internal; unknown licences for
third-party shipped packages fail inventory generation. The inventory, notices,
and scan are copied into the artifact at `resources/release-inventory/`.

## Update configuration

`apps/office-desktop/main/updates/config.ts` validates `{ enabled, feed,
publisher, channel }` with a strict schema. Missing input, malformed values,
and a channel different from the manifest are typed refusals. The only default
is disabled; every `enabled: true` configuration is refused with
`not-allowed-in-dev`. G4-07b tests inject a local HTTPS feed, fixture CA and
test publisher key into the main-only client; packaged code accepts none of
these from the renderer, environment or downloaded feed. G7 must supply and
approve production trust and release policy before enabling it. There is no `electron-updater` dependency and no unsigned
automatic update fallback.

## Evidence and cleanup

The acceptance packet records the final ZIP and setup names, SHA-256 checksums,
sizes, file listings, inventory report, launch smoke, and installer smoke. The
binary and unpacked output directories are deleted after those records are
captured; checksums, listings, and reports remain under the run report
destination. Electron/builder caches may remain on D: for reproducible
subsequent runs. Draft plaintext temps use the manifest's channel namespace and
encrypted draft keys use its key namespace; stable/beta data therefore shares
the intended upgrade namespace while dev data cannot collide.

## Required checks

The final revision must have passing results for desktop typecheck, lint,
Vitest (including IPC/diagnostics, deployment resolver, and update-config
tests), package/inventory tests, `node scripts/office/check-boundaries.mjs`,
`pnpm knip`, catalog and governance tests, and `pnpm audit --audit-level high`.
The accepted artifacts are unsigned dev/beta evidence only and must not be
described as a signed release or an enabled update channel.

## Update and rollback (G4-07b)

Configure `OFFICE_INSTALLER_DEV_URL`, `OFFICE_INSTALLER_BETA_URL`, and `OFFICE_INSTALLER_STABLE_URL` for the three deployment channels. The authenticated `GET /api/v1/office/desktop/download?organization_id=...&channel=...` route requires organization membership, returns the selected installer with the public API origin, channel, client id, and deployment id, and writes an audit row. The response contains no credentials, signing keys, or storage secrets. The web editor reuses the existing not-installed install prompt and fails closed when the selected channel has no installer.

The web **Download** action requests the same route with `bundle=true` using the current authenticated session. The server produces an `application/zip` containing `UniWork-Office-Setup` with the configured installer extension and `deployment-profile.json` (`deploymentId`, `apiOrigin`, `clientId`, `channel`). The installer fetch forwards no user credentials, refuses redirects and empty responses, and enforces a 512 MiB limit. Audit records download initiation before that fetch; they do not prove the client finished receiving or installed the bundle. Both responses use `Cache-Control: no-store`; the route is limited to ten requests per minute when the Redis limiter is configured.

Extract both files together before starting the Windows installer. NSIS copies the adjacent profile to installed resources; packaged Electron resolves it there. macOS profile delivery is still a sidecar: place the validated `deployment-profile.json` in the accepted userData namespace before launching, or let deployment tooling provision it there. Signing that profile and qualifying platform installation are 07c work. Missing, malformed or mismatched API profiles leave the Download flow unavailable; it does not fall back to a public URL for another channel.

Unsigned automatic update is disabled until a real feed and signing publisher are approved. Feed and artifact URLs must use verified HTTPS on the configured origin, without credentials or fragments; redirects are refused. The installed main-process policy pins the publisher key and an ordered list of accepted engine revisions. A feed cannot supply its own trust key. Ed25519 signatures bind artifact URL, SHA-256, size, publisher, app id, channel, engine version, contract version, protocol version and target draft format. Unknown or older engine revisions, incompatible contracts/protocols, wrong identity/publisher, invalid signatures and changed bytes are typed refusals. The local HTTPS fixture exercises acceptance, untrusted TLS, redirects and tampering without production keys.

Before restart-to-update, flush the local encrypted draft checkpoint and obtain explicit confirmation. Any checkpoint I/O failure aborts the restart. Draft checkpoints are local only and never auto-save to cloud or overwrite the original file. Migration and rollback preserve ciphertext, checksum, and key namespace; see `docs/office/g3g4/desktop-draft-format-support.md` for the v1/v2 matrix.

The native Help menu exposes **Kiểm tra cập nhật…**. Electron owns the client and the durable store under `userData/drafts`; document IPC and restart services must share the same store. Separate draft keys under `userData/draft-keys` are protected by OS `safeStorage`, with no plaintext fallback or replacement of corrupt keys. The updater drains pending checkpoints, migrates to the signed target draft format, seals writes, and shows a confirmation dialog whose default is Cancel. Cancel or an installer error reopens draft writes. After confirmation, verified installer bytes are written under `userData/updates`, flushed and hashed again before opening the Windows `.exe` or macOS `.pkg`/`.dmg`; only a successful OS open permits the app to quit. Opening a macOS disk image still requires the user to complete installation. The current unsigned build returns `auto_update_disabled` before network access; this menu does not enable the G7 signing/feed gate.

For an update incident, record the typed refusal and build/channel diagnostics, then check the configured origin, certificate, pinned publisher policy and artifact hash. For `checkpoint_failed`, restore writable storage and inspect retained encrypted envelopes before retrying; do not delete drafts or regenerate their keys. Cancellation and install-open failure leave the current application running and allow draft writes again.

Rollback of the draft format must happen while running a reader that supports both formats: `DesktopDraftStore.migrateFormat(1)` retains each source envelope and atomically writes v1 metadata before a v1-only reader can open it. A signed, compatible recovery release can request `draftFormat: 1` through the same checkpoint/confirmation path. This does not authorize an older engine: the ordinary updater still refuses engine downgrades. If no compatible recovery release is available, retain the existing build and encrypted backups for a controlled recovery; do not point an older binary at v2 or mixed rows. Verify document recovery with the existing OS keys before resuming normal work. `.keep` files are retained evidence, not automatically restored revisions; see the support matrix for interrupted migrations.
