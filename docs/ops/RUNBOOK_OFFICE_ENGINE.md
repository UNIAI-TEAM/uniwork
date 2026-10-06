# Runbook: Office engine service

> **Trạng thái:** shipped for the engine service (02a), the Go transport and job lifecycle (02b) and the
> G1-03 commit hand-off (02c); XLSX and PDF lanes extend this page. Deploy and rollback for the whole Office
> G3-G4 rollout: [`docs/office/g3g4/runbook.md`](../office/g3g4/runbook.md).

The Office engine service (`apps/office-engine`) is the private process that runs the Office engine operations
which must not run in the browser (ADR 0021). Go is its only caller. It owns no account, ACL, version store or
storage credential and never writes a business table: Go authorises, persists the job, and commits the result.

## What it is

| Piece | Where |
| --- | --- |
| HTTP service (private) | `apps/office-engine/src/server.ts` — `/healthz`, `/readyz`, `/metrics`, `/v1/capability`, `/v1/jobs`, `/v1/jobs/{id}`, `/v1/jobs/{id}/cancel` |
| Job manager: bounded pool + queue, state machine | `apps/office-engine/src/jobs.ts` |
| Worker supervisor, process-tree ownership | `apps/office-engine/src/supervisor.ts`, `src/process-tree.ts` |
| Per-job limits | `apps/office-engine/src/limits.ts`, defaults in `src/config.ts` |
| Per-job temp dirs and startup sweep | `apps/office-engine/src/cleanup.ts` |
| Grants (HMAC token, single use) | `apps/office-engine/src/grants.ts`; Go mirror `server/internal/office/grant.go` (02b) |
| Image | `apps/office-engine/Dockerfile` (build from repo root) |
| Compose (dev/on-prem) | `docker-compose.yml`, profile `office`, service `office-engine` |

Two secrets, never the same value (the service refuses to start otherwise):

- `OFFICE_ENGINE_SERVICE_TOKEN` — bearer credential on every request except `/healthz`. It says "this is Go".
- `OFFICE_ENGINE_GRANT_KEY` — HMAC key of the per-job grant. It says "Go authorised this job, on this input, with
  this output target, until this time". Holding the service token does not let anyone mint a grant.

Input bytes travel inside the job envelope and must match the checksum/length the grant binds. Output goes only to
the write target inside the signed grant (the FileService provider-output URL from `RegisterProviderOutput`), and
only to an origin listed in `OFFICE_ENGINE_OUTPUT_ORIGINS`. The service never fetches a URL or path a request names.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OFFICE_ENGINE_SERVICE_TOKEN` | — (required, ≥ 32 chars) | Service credential |
| `OFFICE_ENGINE_GRANT_KEY` | — (required, ≥ 32 chars, ≠ token) | Grant signing key, shared with Go |
| `OFFICE_ENGINE_OUTPUT_ORIGINS` | empty (no output allowed) | Comma list of bare origins of the object store |
| `OFFICE_ENGINE_HOST` / `OFFICE_ENGINE_PORT` | `0.0.0.0` / `8090` | Listen address |
| `OFFICE_ENGINE_MAX_WORKERS` | `2` | Worker processes at once (max 64) |
| `OFFICE_ENGINE_MAX_QUEUE` | `16` | Accepted jobs waiting for a worker; beyond it `503 engine_overloaded` |
| `OFFICE_ENGINE_MAX_JOB_MS` | `120000` | Wall-clock ceiling per job (contract max 600000) |
| `OFFICE_ENGINE_CPU_MS` | `60000` | CPU time per job tree |
| `OFFICE_ENGINE_MEMORY_MB` | `512` | RSS per job tree; the handler's V8 heap is capped at 75 % of it |
| `OFFICE_ENGINE_TEMP_MB` | `256` | Bytes a job may leave in its temp dir |
| `OFFICE_ENGINE_MAX_INPUT_BYTES` / `_MAX_OUTPUT_BYTES` | 50 MiB / 50 MiB | Byte bounds (DocumentFile caps a version at 50 MiB) |
| `OFFICE_ENGINE_TEMP_DIR` | `$TMPDIR/uniwork-office-engine` | Root of per-job temp dirs |
| `OFFICE_ENGINE_SAMPLE_MS` | `100` | Usage / temp sampling period |
| `OFFICE_ENGINE_RETENTION_MS` / `_MAX_RETAINED_JOBS` | 15 min / 1024 | How long a settled job answers status |
| `OFFICE_ENGINE_SHUTDOWN_GRACE_MS` | `10000` | Drain window on SIGTERM |
| `OFFICE_ENGINE_FAULT_OPERATIONS` | `0` | Test-only fault operations. Never `1` outside a test run |
| `OFFICE_ENGINE_SANDBOX` | `auto` (`required` in the image) | Per-job uid sandbox: `auto` engages on Linux + uid 0, `required` refuses to start without it, `off` is for dev debugging |
| `OFFICE_ENGINE_WORKER_UID_BASE` / `_GID_BASE` | `60100` | Start of the per-slot worker uid/gid pool (`maxWorkers` entries, 1000..65533) |
| `UNIWORK_PDF_ASSETS` | `/app/pdf-assets` in the image | Directory holding `pdfium.wasm`, `harfbuzz-subset.wasm` and `fonts/` (bundled OFL Noto Sans). Set by the Dockerfile; unset in dev, where assets resolve package-relative |
| `UNIWORK_XLSX_ASSETS` | `/app/xlsx-assets` in the image | Directory holding `xlsx-gateway.mjs` (patched upstream bundle) and `xlsx-sidecar` (the Rust recalculation binary) plus `build-record.json` checksums. Set by the Dockerfile; in dev point it at a dir staged from `node scripts/office/build-upstream.mjs --with-native` (gateway at `dist/xlsx-gateway.mjs`, binary at `upstream/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar`). Unset/unstaged is legal: `open:xlsx` and `serialize:xlsx` still run (gateway only), while `edit:xlsx` on a formula-bearing workbook fails `engine_incompatible` — it never falls back to stale cached values |

**Every limit default is provisional** (acceptance-thresholds T-2: not a budget until `n >= 5` on the target machine
class). Measured so far: see `reports/g2-02-engine-service/limits-measurement.md` in the run folder. XLSX (G2-04)
and PDF (G2-05) CPU/RAM are unmeasured; revisit the defaults when those lanes record envelopes.

## Run it

```sh
docker compose --profile office build office-engine
docker compose --profile office up -d office-engine
curl -s 127.0.0.1:${OFFICE_ENGINE_PORT:-8090}/healthz            # {"status":"ok"}
curl -s -H "Authorization: Bearer $OFFICE_ENGINE_SERVICE_TOKEN" 127.0.0.1:8090/readyz
docker compose --profile office stop office-engine
```

Without Docker: `pnpm --filter @uniwork/office-engine-app build && pnpm --filter @uniwork/office-engine-app start`
with the variables above exported (Node 22).

## Health and metrics

- `/healthz` — liveness only, no credential (container healthcheck).
- `/readyz` — `200 ready` after one worker process started and answered at boot; `503 starting|draining` otherwise.
  Go's engine readiness is separate from the main `/readyz`: an engine outage never fails the API's readiness and never
  blocks Documents list/download (02b).
- `/metrics` (credential): `office_engine_queue_depth`, `office_engine_running_jobs`,
  `office_engine_jobs_accepted_total{operation}`, `office_engine_jobs_total{operation,outcome}`,
  `office_engine_rejections_total{code}`, `office_engine_job_duration_seconds{operation}`.

## Go side: jobs, readiness, reconciler

- Config (server `.env.example`): `OFFICE_ENGINE_URL` (unset = no engine; office jobs answer
  `office.ErrNotConfigured`, nothing else changes), `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY` (the same
  two secrets the engine holds), `OFFICE_ENGINE_REQUEST_TIMEOUT_MS`, `OFFICE_JOB_MAX_DEADLINE_MS`,
  `OFFICE_JOB_RECONCILE_INTERVAL_MS`.
- `service.DocumentOfficeService` (`server/internal/service/document_office*.go`) persists the `office_jobs` row -
  actor, scope, operation, base, fingerprint, deadline, grant id and the output `file_id` from
  `RegisterProviderOutput` - **before** it dispatches. States `accepted -> running -> completed | failed | timed_out |
  cancelled`, each a compare-and-set. `completed` is not a Document version: the G1-03 commit claims it with
  `ClaimOfficeJobOutputInTx`; until then a cancel still wins and a cancelled job's output is never claimed.
- The reconciler (`RunReconciler`, in the `cmd/server` shutdown sequence) sweeps live jobs every interval: it applies
  engine outcomes, settles jobs the engine lost, and times out jobs past their deadline on Go's own clock.
- Engine readiness is `EngineReady` (metric `uniwork_office_engine_ready`), never part of the API's `/readyz`: an
  engine outage does not take the API, Documents list or download out of rotation.
- Go metrics: `uniwork_office_jobs_total{operation,outcome}`, `uniwork_office_job_duration_seconds{operation}`,
  `uniwork_office_engine_ready`, `uniwork_office_engine_queue_depth`.
- Today the real FileService keeps the `document_file` purpose disabled until G1-03 opens it, so a real deployment
  refuses office jobs at `RegisterProviderOutput` (`file_purpose_disabled`) until then.

## Job outcomes and what they mean

| State / code | Cause | Operator action |
| --- | --- | --- |
| `completed` | Output measured and PUT to the grant's target | none — Go verifies with `CompleteProviderOutput` and commits (G1-03) |
| `timed_out` / `engine_timeout` `deadline` or `cpu_limit` | job hit the deadline or its CPU budget; tree killed | a steady rate means a limit is too low for real files — measure before raising |
| `failed` / `engine_crashed` `memory_limit`, `temp_limit` | RSS/heap or temp budget exceeded; tree killed | same as above |
| `failed` / `upload_bounds` `output_limit` | output larger than the grant or service bound | check the grant's `max_bytes` (FileService policy) |
| `failed` / `engine_crashed` `output_write_*` | the write target refused or was unreachable | check `OFFICE_ENGINE_OUTPUT_ORIGINS` and the object store |
| `crashed` / `engine_crashed` | worker process died, or the service shut down (`reason: shutdown`) | retryable; Go reconciles from `office_jobs` |
| `cancelled` | Go cancelled before the job settled | none |
| `501 unsupported_operation` | operation not bound in this build; `convert` always (Q7) | expected until the format lane binds it |

The cpu budget counts the worker's whole tree from fork, including module
loading — a handler graph that is heavy to evaluate can `cpu_limit` a job
before the handler runs (UNI-688: the pdf import masked fault outcomes as
`timed_out`). `src/worker/handlers.ts` therefore lazy-imports
`@uniwork/office-engine/pdf` only for pdf ops, and limit errors carry
`measured_cpu_ms` / `measured_rss_bytes` / `measured_temp_bytes` so a masked
outcome shows what it actually consumed.

Stuck processes: every job's tree is killed on every exit path. On Linux (the image) that is the worker's process
group, every descendant found under `/proc/<pid>/task/*/children`, every process whose environment carries the
job's `UW_OFFICE_JOB_TAG`, and - under the sandbox - every process whose `/proc/*/status` carries the job's slot
uid. The uid sweep is the reliable one under sandboxing (environ of a different uid is ptrace-gated and a hostile
process could exec a scrubbed env; it cannot shed its uid); the tag scan still covers unsandboxed runs. CPU is
measured over the same set including reaped children (`cutime`/`cstime`). If `docker top` shows worker processes
with no job running, capture `/metrics` and the logs and restart the container; the service sweeps stale
`uw-office-job-*` temp dirs on start.

### Isolation limits (read before binding a native parser)

- **Windows dev hosts** have no tag scan: a descendant that breaks away from the worker's job object can outlive it,
  and CPU/RSS of native descendants is not measured there (only the worker's self-report). Production is the Linux
  image; the Linux suite runs with `docker build -f apps/office-engine/Dockerfile --target test -t
  uniwork-office-engine:test . && docker run --rm --init uniwork-office-engine:test`. CI does not run it yet (owner:
  the CI owner, G1-09); until it does, run it before merging any change under `apps/office-engine/src`.
- **The job tag is not a security boundary.** It catches descendants that inherit the environment; a descendant that
  execs with a scrubbed environment escapes it. It is enough for our own handlers, not for hostile native code.
  Scanning `/proc/*/environ` on every sample assumes the container's own PID namespace (a handful of processes); do
  not run the engine in the host PID namespace. The Helm pod sets `shareProcessNamespace: true` so the pause
  container is PID 1 and reaps orphans (compose uses `init: true`); the namespace is still the pod's own, and the
  engine is its only container, so the scan sees the same handful of processes. Nothing in `process-tree.ts`
  depends on the engine being PID 1.
- **Per-slot uid sandbox (G2-05).** On Linux as uid 0 - the image runs the supervisor as root for exactly this - every
  worker is forked under its own uid/gid from a fixed pool (`OFFICE_ENGINE_WORKER_UID_BASE`/`_GID_BASE` + worker slot,
  one uid per `OFFICE_ENGINE_MAX_WORKERS` slot), and the job's temp dir is chowned to that uid with mode `0700` before
  the spawn. The drop happens inside `fork()`, before Node or the handler loads. A compromised worker can then touch
  only its own job dir: a sibling job's dir is another uid's `0700` dir, the temp root is the service uid's, the root
  filesystem is read-only, and `no-new-privileges` blocks exec'ing a setuid helper. `OFFICE_ENGINE_SANDBOX=required`
  (the image default) refuses to start where the drop cannot run; `auto` (the source default) engages only on
  Linux + uid 0 and `off` exists for dev debugging. Windows dev hosts therefore run unsandboxed - cross-job reads are
  possible there; production evidence comes from the container test stage. Two rules the deployment must keep: the
  uid sweep in `killTree` assumes the pool is exclusive to one engine per kernel namespace (one engine per container;
  never run two engines with overlapping `OFFICE_ENGINE_WORKER_UID_BASE` ranges on one PID namespace or they kill
  each other's workers), and slot release is gated on the uid being dead - `release()` resweeps `/proc` and SIGKILLs
  stragglers before the slot returns to the pool; a uid that still owns processes is quarantined (never reissued,
  counted in `office_engine_quarantined_slots` on `/metrics`) rather than shared with the next job on that slot.
- **Output integrity.** The job dir belongs to the worker uid, so the supervisor treats `output.bin` as hostile:
  it opens it `O_NOFOLLOW` and requires a plain file with `nlink == 1` owned by the slot uid on the fd it streams —
  a worker that repoints the output (symlink to a host file, hard link into another job) fails the job with
  `engine_result_invalid` and nothing reaches the grant target.
- **Tmpfs bound.** The compose profile runs the root filesystem read-only with a 512 MiB
  tmpfs on `/tmp` (the job temp root; tmpfs pages count against `mem_limit`, so tmpfs + workers x job RSS + the service
  stay under the 2 GiB ceiling), so all jobs together cannot fill more than the tmpfs. In the Helm pod `/tmp` is a
  Memory `emptyDir`; it is created `0777` without the sticky bit, so an init container (`tmp-sticky`) runs
  `chmod 1777 /tmp` first, matching compose's `mode=1777`. Without it any worker uid could rename or delete the
  supervisor's `uniwork-office-engine` temp root.
- The submit path parses and hashes the envelope on the service's event loop; a large input stalls other requests
  briefly (measured in `reports/g2-02-engine-service/limits-measurement.md`).

### Restart and replay (Go side)

- The single-use grant ledger is in memory. After an engine restart Go never re-sends a grant for a job the engine
  had accepted: the engine answers `not_found` and Go settles from `office_jobs` plus the FileService provider-output
  intent (object written -> `completed`, nothing written -> `failed engine_lost_job`). Go re-dispatches only a job the
  engine never accepted (a retryable refusal: engine down or overloaded), under the same job and grant ids; if that
  first dispatch did reach an engine that then restarted, the second run writes the same output object again (same
  bytes, one file id).
- A retryable refusal at dispatch (engine down, overloaded, or refusing the service credential after a config change)
  leaves the job `accepted`; only a client retry with the **same** idempotency key dispatches it again. Without one
  the reconciler times it out (`never_dispatched`) at its deadline, and until then the same work under another key
  answers `in_flight`.
- The submit carries the base as base64 inside JSON; the client scales its request timeout with the payload
  (+250 ms per MiB over `OFFICE_ENGINE_REQUEST_TIMEOUT_MS`) because the engine's decode of a large envelope takes
  seconds (see the N5 measurement).
- A cancel or shutdown can land after the output PUT succeeded, so the object exists for a cancelled job. It is never
  claimed (`ClaimOfficeJobOutputInTx` requires `completed`), and FileService collects it after its claim window.
- `/v1/capability` needs only the service credential: it describes the build and touches no job, so there is no
  grant to present.

## PDF lane (G2-05)

- `edit:pdf` runs the real pipeline: `ops.json` (the envelope's validated `edits[]`, written by the service into the
  job dir) drives annotation deletes → text edits → text inserts → image ops → pdf-lib page ops (rotation, metadata,
  page delete/reorder) → save → read-back verification. A verify failure discards the output; the original bytes are
  never written to the output target.
- `serialize:pdf` validates committed bytes and passes them through unchanged (the Documents commit path);
  `open:pdf` returns a probe JSON (`pageCount`, `hasTextLayer`, per-page empties, feature map with `ocr: false` +
  reason). `convert`/`export` stay unbound; an `ocr` capability row answers `supported: false` (Q2-A).
- Typed refusals keep the original: `not_a_pdf`, `encrypted_pdf`, `corrupt_pdf`, `bad_op:*` map to
  `engine_result_invalid`; an op outside the bound vocabulary (annotation authoring, OCR, forms) is
  `unsupported_operation`. Stale text edits are `edit_skipped` warnings, not job failures.
- Assets are staged at build time into `/app/pdf-assets` (`pdfium.wasm`, `harfbuzz-subset.wasm`, OFL Noto fonts) and
  reached via `UNIWORK_PDF_ASSETS`; in dev the package resolves them from `node_modules` + `assets/fonts`.
- The pdfium wasm is a shared singleton with one linear heap: all pdfium access is serialized through a promise
  chain inside the handler thread.

## Q7 conversions

`convert` (BIFF8 `.xls`, ODF, RTF, XLSB → OOXML) answers `501 unsupported_operation` with
`reason: q7_blocker` before a grant is consumed or a job exists. No conversion engine is chosen
(`docs/office/g1g2/q7-blocker.md`); it stays a named M1 blocker. Choosing one is a decision for the Advisor/user,
not a deployment knob.

## XLSX lane (G2-04)

- Decision landed as recommended below: the Rust recalculation sidecar ships in the same image
  (`/app/xlsx-assets/xlsx-sidecar`, built from the vendored `apps/sheets/native/xlsx-engine` crate with its own
  `Cargo.lock`) and is spawned per job as a supervisor-owned child of the job's worker — inside the per-slot uid
  sandbox, with the workbook staged into the job's `0700` temp dir. `close()` on job end kills it; the killTree uid
  sweep is the backstop for a sidecar that escapes its parent.
- `open:xlsx` probes bytes into a document-model summary (`sheetCount`, `sheetNames`, `cellCount`,
  `formulaCellCount`, `preservedParts` — charts, pivots, VBA, ActiveX, external links, customXml, embeddings, form
  controls, comments). `serialize:xlsx` validates committed bytes and passes them through with a
  `parts_preserved_not_editable` warning when the package carries parts the serializer does not own.
  `edit:xlsx` runs `ops.json` `edits[]` (`set_cell`, `clear_cell`, `set_cells`) through the patched xlsx-gateway;
  when the workbook has formulas the worker first asks the sidecar for fresh cached values and writes both in one
  assemble pass — a formula cell keeps `<f>` and gets a verified `<v>`, never the other way round.
- The browser-safe half (`@uniwork/office-engine/xlsx`) parses, edits and serializes with jszip only. The native
  half (`@uniwork/office-engine/xlsx/native`) is Node-only; there is no WASM recalc path and none is claimed — a
  formula-bearing save without the sidecar answers `unsupported_operation` (adapter) or `engine_incompatible`
  (binary not staged), never stale values.
- Sidecar wire protocol is NDJSON v1 (`recalc_cells`/`cancel`, `requestId`-matched) with closed bounds: 10_000 edits
  and 20_000 summed read cells per request, 2 resident models, 256 cancelled ids. The client maps sidecar codes to
  contract codes (`cancelled`, `recalc_busy` → `engine_overloaded`, `unsupported_version` → `protocol_mismatch`).
- Every formula cell whose precedents were edited in the session gets a freshly recalculated `<v>` on save
  (recalc-on-serialize: the sidecar evaluates the edit set and the writer patches each covered `<f>` cell), so a
  save + reopen shows the correct total, never the file's stale cache (F7). Shared-formula followers
  (`<f t="shared" si="N"/>`, which the basic parse reads as literals) are found in the sheet XML and refreshed by
  coordinate like their master; their `<f/>` is never expanded (R3-1B).
- Known upstream engine gaps stay honest: cells the engine deliberately skips (`CELL("filename")`, the `RATE`
  `#NUM!` solver case) keep their file-cached `<v>` and the save reports a `formula_cache_kept` warning with a
  count - it does not fabricate a value. A structural (row/column) or sheet-identity (add/rename/remove/reorder)
  save cannot recalc the original bytes, so it assembles first, recalculates the PRODUCED package with zero edits
  (final coordinates and sheet names) and writes every formula cell's `<v>` in a values-only second assemble
  (R3-1); such a save without the sidecar is refused like any other formula-bearing save.
- Preservation is fail-closed: `assertOnlyTouchedEntriesChanged` sha256-verifies every package part outside the
  plan's touch set; a chart part, macro payload or unsupported OOXML entry that drifted fails the save instead of
  shipping a silently different package.
- Fixture-replay acceptance (AC-1) runs natively in Linux — the sidecar is an ELF binary and the independent
  oracle needs the upstream lockfile's jszip — via a dedicated Dockerfile stage that is never shipped:
  `docker build -f apps/office-engine/Dockerfile --target xlsx-replay -t uniwork-office-engine:xlsx-replay .`
  then `docker run --rm -v <evidence-dir>:/tmp/xlsx-replay uniwork-office-engine:xlsx-replay`. Exit 0 means every
  capability-matrix row (14 at R3-1) passed on the real engine; the result/extraction/version-manifest JSONs land in the
  mounted dir.

### Building the Windows xlsx sidecar for the packaged desktop app

The packaged desktop app opens a local `.xlsx` with the same two artifacts the engine image ships: the patched
`xlsx-gateway.mjs` (required) and the Rust `xlsx-sidecar` recalculation binary (optional; a formula-bearing save
fails closed without it). `apps/office-desktop/scripts/xlsx-assets.mjs` stages both from the
`node scripts/office/build-upstream.mjs --with-native --out .go-tmp/office-upstream-build` scratch tree into
`dist/xlsx-assets`, and `scripts/package.mjs` copies that dir to `resources/xlsx-assets`.

On Windows the native step needs the Rust toolchain and MSVC BuildTools:

1. Install rustup for the current user only (no machine-wide install, no PATH edit):
   `rustup-init.exe -y --default-toolchain 1.88.0 --profile minimal --default-host x86_64-pc-windows-msvc --no-modify-path`
   (`rustup-init.exe` from `https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe`), then put
   `%USERPROFILE%\.cargo\bin` first on PATH in the build shell. The crate is `edition = "2024"` and builds on 1.88.0
   (the engine Dockerfile pins the same version). MSVC 14.44 BuildTools is present on the packaging host.
2. Build the artifacts: `node scripts/office/build-upstream.mjs --with-native --out .go-tmp/office-upstream-build`.
   MSVC's `link.exe` enforces the legacy MAX_PATH (260 chars), and the crate's build-script output path under a deep
   worktree checkout exceeds it, so cargo fails with `LNK1104: cannot open file ...build_script_build-*.exe`. When
   that happens, run the native build with a short `CARGO_TARGET_DIR` (e.g. under `.uniwork-dev/` on `D:`; the
   installer workflow's Windows leg uses `C:\cargo-t` from the start) - the
   binary then lands at `<CARGO_TARGET_DIR>/release/xlsx-sidecar.exe`, which `xlsx-assets.mjs` also searches when
   `CARGO_TARGET_DIR` is set. Do not stub the binary or copy a Linux ELF.
3. Stage: `pnpm --filter @uniwork/office-desktop package` runs `stageXlsxAssets` and writes `staged-assets.json`
   (bytes + sha256) as the shipped evidence; the sha256 of the staged `xlsx-sidecar.exe` must equal the built one.

### XLSX sidecar — decided: same image, supervisor-owned subprocess (was: open question)

Settled with G2-04 on the runbook recommendation. The reasoning stands:

- ADR 0021 QĐ2 and the accepted `E-XLSX-CYCLE` put recalculation in a native process *inside* the internal service.
- The supervisor already owns what a native sidecar needs: per-job process tree kill, CPU/RSS sampling of native
  descendants from `/proc`, a private temp dir, and a deadline. A second container would need its own credential,
  grant check, limits and network path — a second boundary to keep equal to this one.
- One image keeps on-prem packaging to one runtime artifact (ADR 0021 "Hệ quả": the on-prem bundle must contain the
  chosen runtime, not only a Node sidecar).

Revisit only if a large-workbook measurement shows the sidecar needs a different scaling or isolation profile than
the rest of the engine (e.g. memory per workbook far above the per-job budget); then split it into its own container
reached only by this service. Owner of the decision: Advisor with G2-04.

## Kubernetes (Helm)

The `uniwork` chart (`deploy/app/uniwork`) deploys the engine behind **one switch**, `officeEngine.enabled` (default
`false`; off renders nothing of the engine and the BE refuses office jobs). Keep `OFFICE_ENGINE_URL` empty in
`deploy/app/env/uniwork-be.env`: with the switch on, the chart sets it on the BE container. What the pod does and
why (values in `deploy/app/uniwork/values.yaml`, template `deployment-office-engine.yaml`):

- Same limits and capability set as compose (drop `ALL`, add `CHOWN SETUID SETGID KILL DAC_OVERRIDE FOWNER`, no
  privilege escalation, read-only root filesystem, 512 Mi Memory `/tmp`, 2 Gi / 2 cpu). No `runAsNonRoot`: the
  supervisor is uid 0 by design (see the sandbox above).
- `shareProcessNamespace: true` (reaper, see Isolation limits) and the `tmp-sticky` init container (`/tmp` mode 1777).
- Probes use `/healthz`, the only route without the service credential. The Service is ClusterIP only; there is no
  edge route.
- NetworkPolicy: ingress only from `uniwork-be` pods on the engine port; egress to DNS plus
  `networkPolicy.officeEngineFileStore` CIDRs.
- Rollout: `ci/scripts/rollout-uniwork.sh` with `OFFICE_ENGINE_ENABLED=1`, `OFFICE_ENGINE_DIGEST`,
  `OFFICE_ENGINE_OUTPUT_ORIGINS` and an optional `OFFICE_ENGINE_VALUES_FILE`. Every later rollout must keep them or
  the engine is removed.

Per-environment values that cannot live in the chart (CIDRs, origins, the `uniwork-office-engine` Secret, the
kubelet `podPidsLimit`, public installer URLs, bucket CORS) are one list:
[`docs/ops/OFFICE_ENV_CHECKLIST.md`](OFFICE_ENV_CHECKLIST.md). Troubleshooting "Office job báo chưa cấu hình" on
Helm means `officeEngine.enabled` is off or the Secret is missing, not an empty URL to fill by hand.

## Per-format flags

The engine switch and the format switches are feature flags (`server/internal/featureflags/keys.go`, served by
`GET /api/v1/config`). Flags hide capability; they never grant it, and the engine switch still gates everything.

| Flag | Default | Effect |
| --- | --- | --- |
| `office_engine` | off | Master switch for Office editing; off = view / download / history only |
| `office_docx` `office_xlsx` `office_pptx` `office_pdf` `office_markdown` `office_html` | on | One format editable only when `office_engine` **and** its own flag are on |
| `office_html_visual_edit` | off | Visual HTML editing (no UI yet) |

Set a flag with `FF_<KEY>` (for example `FF_OFFICE_DOCX=false`), the `FEATURE_FLAGS_FILE`, or an override
(user > organization > global). Web reads the config for the document's organization, so an organization override
takes effect; the desktop reads it for the selected organization. A format that is off opens the view / download card
(web) or a read-only tab (desktop cloud documents) with the reason; local desktop files are not gated. While the
config is not readable yet the web card says "checking" or "could not check" (with Try again), never "turned off";
the desktop retries with growing back-off (up to 5 minutes), on window focus / network return and before each cloud
open.

Changes apply on the next config refresh (cached up to 5 minutes, refetched on focus). A refetch never unmounts a
live editor: a settled answer is kept while a refetch is in flight or fails, and only a settled "off" answer closes
the editor, through the leave guards, so a dirty editor offers Save / keep draft / discard first and keeps its draft.
Rollback steps and the user-facing wording: [`docs/office/g3g4/runbook.md`](../office/g3g4/runbook.md) 3.6 and 6.

## Follow-ups

- Helm: the chart exists (above). Still open per environment: the checklist items in
  [`OFFICE_ENV_CHECKLIST.md`](OFFICE_ENV_CHECKLIST.md) and the first real production rollout with the engine on.
- The engine's `/metrics` is not yet scraped by `deploy/prometheus.yml`; add it with the first alert rule
  (each alert needs a runbook in `docs/runbooks/`).
