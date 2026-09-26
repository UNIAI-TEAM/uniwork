> **Bản sao vào git (2026-09-26, UNI-657).** Nguồn: `.uniwork-dev/orca-recovery-g119/doc004-runtime/PACKAGING-AND-HANDOFF.md` trong checkout `dev-uniwork`, sha256 `1fc9197694f4e157f5c292b7c1731633cf43cce4dcab55f2e6573393170c05fa`. Nội dung bên dưới giữ nguyên văn; đường dẫn tương đối (`r2/...`, `receipts/...`, `work/...`) và các ký hiệu `B`/`M`/`S`/`E` trỏ tới thư mục chạy G0 ngoài git. Bản đồ tên file và phần đã lỗi thời: [README](README.md).

# Packaging, version negotiation and the G1/G2 hand-off (plan 4.5 / 4.6 / 4.7)

Slice `doc004-runtime`, g119, UNI-668 / DOC-004. Candidate for M; canonical files stay read-only.
Sources read: `docs/office/g0/engine-contract.md` sections 9-11, `docs/office/g0/module-runtime-map.json`
(`packaging_and_namespace`, `versioning_and_rollout`, `g1_g2_handoff`, `ownership_map`), `CLAUDE.md`, `docs/api-sdi-sdo.md`.

## 1. Packaging matrix (4.5)

| Surface | What ships | Build / how it is produced | Auth and exposure | Resource limits | Health and metrics |
| --- | --- | --- | --- | --- | --- |
| **Web (browser host)** | The editor bundle only: `views` + `core` + injected host adapter. No engine module, no Node/Electron import, no native handle. | Built by the normal monorepo pipeline from pinned in-repo source (target: no `../genoffice`, see section 4). | No engine credential ever. The browser reaches Go through the existing UniWork API surface. | Input/output byte caps and operation allowlists are enforced server-side; the bundle carries no quota logic. | n/a (static asset); the editor reports its version through the handshake. |
| **Server (private Office Engine Service)** | The engine module + the per-format adapters, as its own process/container. | Pinned upstream commit `09485f884dc845cf3bf27fb7edfe489f9d457aad` + the reviewed patch series; built inside the monorepo, never from a private registry. | Only Go calls it, over a private transport, with a scoped expiring grant. The client never gets the origin or a credential. File bytes never leave UniWork infrastructure (Q4-A: no third-party Office/OCR service). | Input/output byte caps, bounded worker count, per-operation deadline, queue with backpressure answering `engine_overloaded` (503). | `/healthz` liveness plus metrics: jobs by operation, duration, orphan-delete failures, backpressure. Required before G7. |
| **Desktop host** | The same editor and adapters plus the desktop shell, packaging and update feed. | G4 packaging pipeline; identity values in section 3. | Local filesystem and native handles stay in the desktop host and never appear in the web API. Login uses the desktop flow owned by DOC-005. | Same operation limits; native sidecar processes are per-user, not per-request. | App-level health/telemetry as today; installer and update feed owned by G4/G7. |
| **Native sidecar (XLSX recalculation)** | The Rust `xlsx-sidecar` binary (`PROTOCOL_VERSION = 1`). | Built with Cargo (edition 2024) inside the pinned source tree; shipped beside the service, not inside the browser bundle. | Reached only by the service/host that owns the workbook session. | Per-call deadline; the accepted cycle recalculated one small sheet - no large-workbook envelope is proven yet. | Sidecar liveness is part of the service health; failures must surface as typed engine errors, never as a silent stale value. |

Fonts and licences: a font substitution must surface as the fidelity warning `fonts_substituted` with the concrete
substitution (`engine-contract.md` 4.3 example), never as a silent reflow, and an embedded-font export carries the
`options.embed_fonts` flag on the convert/export request (4.5). The pinned source's licence and attribution rows
(`Apache-2.0`, copyright holder, LICENSE/NOTICE and the fork commit) live in `docs/office/g0/source-manifest.json`, and
every release regenerates and packages third-party notices (owner G7 UNI-661). Any bundled font must be attributable
and redistributable - that check belongs to the release gate, not to this contract.

## 2. Version negotiation, rolling update and rollback (4.5)

| Unit | Where it lives | Rule |
| --- | --- | --- |
| `contract_version` | engine contract | `uniwork-office-engine-contract/1` today. A schema mismatch is `ContractViolation` at the exact field, **before** any job is created. |
| `protocol_version` | engine contract | `1` today. Same rule as above. |
| `engine_version` | engine build string (`genoffice@<pin>+uniwork-office.<n>`) | Shadowed onto every immutable version row, so a reader can tell which build produced which bytes. |
| `client_engine_version` | envelope | Outside `TRUSTED_ENGINE_VERSIONS` -> `engine_incompatible` (409), a `BoundaryError`. No silent downgrade. |

- **Negotiation order (fixed):** Go compares the client's versions and engine build against the document's recorded
  `engine_*` metadata **before** creating a job. Version fields are rejected at the schema layer first, so
  `contract_mismatch` / `protocol_mismatch` remain in the Go error table but are not the codes emitted on this path.
- **Rolling update:** an older engine keeps serving documents whose recorded engine version it can still read; the new
  build arrives behind a disabled-by-default flag with an explicit support matrix.
- **Rollback:** the previous build must still read every committed version **and** every draft. Drafts live in the
  per-account draft store, independent of the engine build (DOC-005), so a rollback does not lose a draft; a base
  revision mismatch on recovery is `conflict`, never a silent overwrite.
- **Gate:** bumping a version is **not** a gate; re-running the DOC-003 fixtures and the fault harness **is**.
  Owner: G7 UNI-661 (release), G2 UNI-658 (build/adapter), G1 UNI-657 (version rows).

## 3. Identity and namespace (4.6)

Every value below is a **proposed G0 output** (BRAND-01). None of these resources exists at the pinned commit; the
"owner" column is who must create and prove it. Detailed rows live in `module-runtime-map.json` ->
`packaging_and_namespace`, all with `evidence_level: pending`.

| Surface | Proposed value | Owner | Check that proves it |
| --- | --- | --- | --- |
| App / bundle id | `com.uniwork.office` | G4 UNI-636 | install beside GenOffice: both apps survive, neither overwrites the other |
| Executable | `uniwork-office` (keep the X11 desktop-name <-> `StartupWMClass` pairing) | G4 | taskbar grouping and two installed products |
| Installer artifact | `uniwork-office_<version>_<arch>` (`deb`, `rpm`, `nsis`, `dmg`) | G4/G7 | produced installers from the release pipeline |
| User-facing scheme | `uniwork-office` (+ `uniwork-office://auth/callback`) | G4/G5 | DOC-005 desktop login with GenOffice installed (no wrong-app callback) |
| Internal schemes | `uniwork-office-app`, `uniwork-office-preview`, `uniwork-office-asset` | G3/G4 | the HTML preview isolation boundary (see the accepted E-HTML-CYCLE run for the browser half) |
| User-data / cache / token store | namespace `uniwork-office` | G4/G5 | two products, two data directories, no shared control channel |
| Update feed | a UniWork-owned channel; never the upstream GenOffice feed (`GENOFFICE_UPDATE_URL`, `publish.url` must not survive) | G4/G7 | a release that refuses upstream binaries |
| Coexistence | no shared app id, scheme, data dir, control channel or update feed with GenOffice | G4 | the checks above, on one machine |
| Licence / attribution | LICENSE, NOTICE and the fork commit stay in the fork; every release regenerates third-party notices | G2/G7 | a release-time notices scan |
| Theme rule | rebranding changes editor chrome only; it must never change authored document bytes | G3/G7 | byte comparison before/after a theme change and a save, on the theme fixture `F-DOCX-THEME` - not by reading tokens |

## 4. Monorepo hand-off (4.7)

- **Source pinning:** pin the upstream commit and the source-manifest hashes; store the reviewed patch series as the
  source of truth for the port. Build from a clean checkout needs **no** `../genoffice`, no symlink to a user checkout
  and no private registry. Verified from a fresh copy of this phase root - see section 6.
- **Proposed layout** (owner G2 UNI-658): separate packages for the shared engine core, the per-format engines, the
  ops layer and the render layer, with browser-safe and Node/native entry points separated at the package boundary,
  plus a private Go service package and the native sidecar binary.
- **Public entry:** export only typed document operations and the versioned protocol contracts. No path, no file
  handle, no desktop object crosses the browser boundary.
- **Dependency direction:** `views -> core + ui`; the web platform injects the adapter; the Go document service owns
  the private engine call. The engine package must not import product code and must not reach a business table.
- **Catalog conflict (not waived at G0):** UniWork carries React `19.2.3` / TipTap `3.30.6` while the docs app declares
  React `19.2.4` / TipTap `3.31.0`. The port must build against the UniWork catalog; the product catalog is **not**
  raised to make a spike run. G2/G3 must prove the ported engine on `3.30.6` in a real browser.
- **Private service API:** the Go service defines the internal API, per-job rights, resource limits, cleanup and the
  service install for host/on-premise deployment. No private library release and no production service are built at G0.
- **Upgrade:** new engine build behind a flag; fixtures re-run per engine/adapter/protocol version; rollback keeps the
  previous build able to read committed versions and drafts (section 2).
- **Split of the remaining work:** G2 (module port, layout, service, sidecar, Go adapter), G3 (editor integration, host
  adapters, chrome/theme), G4 (desktop host, login, packaging, namespace, update feed), G7 (release, real-binary brand
  scan, fixture replay), G1 (store, commit transaction, audit/outbox, orphan ledger and reconciler). Migration order is
  the dependency order: store and ledger exist before the engine writes; the adapter exists before the editor consumes
  it; the desktop host exists before packaging; release last.
## 5b. Clean-checkout build proof (plan 4.7 / brief item 4)

The independent Tester (codex `gpt-6-luna`, task `task_ee796e768696` / dispatch `ctx_cb2c01b82576`, 45-minute box)
ran the phase root from a fresh copy on the pinned node v22.23.2. Report:
`work/tester-clean-checkout/REPORT.md` (sha256 `a9fbc84d2f4609b67e774451bca6b7c35dd60da39ddd8da36b1e1cf07261d166`).

**Verdict: FAIL-DEFERRAL.** What the run does prove, and what it does not:

- **Proven from a clean copy** (no `genoffice` anywhere): the copy holds exactly the 3,810 tracked paths of HEAD
  `232634fce6d71b18d88be14aad2d67d4d460c28b`, zero missing and zero extra, with all seven exercised lab/adapter
  files byte-identical to the canonical ones. The contained contract run
  (`scripts/office-g0/run-contracts.mjs`, case scratch and `GIT_CEILING_DIRECTORIES` pinned inside the copy) passed
  **41/41** with `gitHead: "unknown"`, i.e. without reaching M's repository or the OS temp dir.
- **Not proven - the exact missing pieces**: the engine bundle and the fixture generators need the prepared
  `genoffice` source (`ws/genoffice`, e.g. `packages/docx-engine/tests/helpers/build-docx.ts`) and its local
  `esbuild`; `make-fixtures.mts` and `prebundle-engine.mjs` both fail with that absence. The tracked phase root also
  lacks `e2e/office-g0/lab/fixtures/g0-text.pdf` (expected sha256
  `30860ead33d51b02e451c101f9c34f2ca644a135d578292533374cd5f8d82592`), so nine PDF publication tests fail from a
  clean copy (`e2e/office-g0/pdf-save-report.test.mjs`), 43/52 in the serial run.
- **Independence finding worth fixing in G2**: `scripts/office-g0/run-contracts.mjs` defaults its case scratch to
  `os.tmpdir()` and runs `git rev-parse HEAD`, which - in a copy without `.git` - walks up to the parent checkout and
  records its HEAD. The contained invocation fixes both; the default should not need fencing for a clean build to be
  reproducible.
- The Tester stopped every process it started (Node PIDs listed in its report), confirmed no listener remained on its
  port, and states that nothing it started is still running. Its cleanup of the 55.6 MB archive and the full copy was
  refused by the CLI's own deletion policy, so those two scratch items stayed in the slice and were removed by the lead
  after the report was read (see REPORT.md section 7). One external temp tree
  (`%LOCALAPPDATA%\Temp\office-g0-iQLGS5`, 41 case directories) sits outside the workspace and was deliberately left
  untouched; it is recorded here as residual junk for the user/Advisor to remove.

**Deferral wording for the plan item.** "A clean-checkout build of the lab and adapter contracts is proven on the
tracked tree (41/41 contained run). A clean-checkout build of the *engine* remains deferred with two named missing
pieces: the prepared pinned source with its local `esbuild` (owner UNI-658 G2, port), and the untracked PDF fixture
`e2e/office-g0/lab/fixtures/g0-text.pdf` (owner UNI-667/UNI-658, fixtures), plus the runner's default temp/git
discovery which should be pinned (owner UNI-658 G2)."
