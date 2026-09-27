# Runbook: Office engine service

> **Trạng thái:** in-progress (G2-02 / UNI-685, 2026-09-27). Service half (02a) landed; the Go transport and
> job lifecycle (02b) and the G1-03 commit hand-off (02c) extend this page.

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

Stuck processes: every job's tree is killed on every exit path (POSIX process group + `/proc` walk; Windows
`taskkill /T`). If `docker top` shows worker processes with no job running, capture `/metrics` and the logs and
restart the container; the service sweeps stale `uw-office-job-*` temp dirs on start.

## Q7 conversions

`convert` (BIFF8 `.xls`, ODF, RTF, XLSB → OOXML) answers `501 unsupported_operation` with
`reason: q7_blocker` before a grant is consumed or a job exists. No conversion engine is chosen
(`docs/office/g1g2/q7-blocker.md`); it stays a named M1 blocker. Choosing one is a decision for the Advisor/user,
not a deployment knob.

## Open question: XLSX sidecar — own container or the same service?

Not decided here (handoff-map G2). **Recommendation: same image, supervisor-owned subprocess.**

- ADR 0021 QĐ2 and the accepted `E-XLSX-CYCLE` put recalculation in a native process *inside* the internal service.
- The supervisor already owns what a native sidecar needs: per-job process tree kill, CPU/RSS sampling of native
  descendants from `/proc`, a private temp dir, and a deadline. A second container would need its own credential,
  grant check, limits and network path — a second boundary to keep equal to this one.
- One image keeps on-prem packaging to one runtime artifact (ADR 0021 "Hệ quả": the on-prem bundle must contain the
  chosen runtime, not only a Node sidecar).

Revisit if G2-04's large-workbook measurement shows the sidecar needs a different scaling or isolation profile than
the rest of the engine (e.g. memory per workbook far above the per-job budget); then split it into its own container
reached only by this service. Owner of the decision: Advisor with G2-04.

## Follow-ups

- Helm: the repo has no chart. ADR 0021 E-01 asks for the runtime in compose **and** Helm; the chart is a follow-up
  for the deployment owner (plan G2-02 checkbox stays open for Helm).
- The engine's `/metrics` is not yet scraped by `deploy/prometheus.yml`; add it with the first alert rule
  (each alert needs a runbook in `docs/runbooks/`).
