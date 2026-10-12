# G7-01 app harness (UNI-1376, item C)

Brings up the three pieces of the smallest end-to-end acceptance case on a
Linux runner VM and records one evidence line through the G7-01 evidence runner.

| Piece | What runs | Where |
| --- | --- | --- |
| D server | this checkout's Go server (`server/bin/harness-server`) | a fresh free port, `127.0.0.1` |
| D web | `pnpm --filter @uniwork/web dev` (Next dev) | a fresh free port, `NEXT_PUBLIC_API_URL` on the command line |
| Fork app | the fork's Electron app, built from a pinned SHA, under `xvfb-run` | `UNIWORK_API_ORIGIN` points it at the D server |

Fresh ports matter: a warm cloud VM still holds `:3000`/`:8080` from an earlier
round, and a run that silently reuses them tests old code against new specs.
Nothing outside the run's own PID file is ever touched — `stop.sh` kills exactly
the PIDs `start.sh` started, never a process by name.

## Run it

```sh
bash scripts/office/g5g6g7/harness/start.sh          # up: server + web + fork app
OFFICE_FORK_SHA=0d03b18 \
  node scripts/office/g5g6g7/evidence.mjs run \
    --req G7-A05 --fixture fx-md-notes-vi --checker tester-cloud -- \
    node scripts/office/g5g6g7/harness/sample-ac.mjs
bash scripts/office/g5g6g7/harness/stop.sh           # down: only this run's PIDs
```

`start.sh` prints the exact evidence-runner command for the run it just brought
up (with the run dir and SHA filled in). Running `sample-ac.mjs` directly works
too and writes the same JSON line into the run dir; under the evidence runner it
defers to the runner's ledger so one check is never counted twice.

`HARNESS_DRY_RUN=1` (or `start.sh --dry-run`) picks the ports, checks the
preconditions and stops before starting anything. `HARNESS_SKIP_APP=1` runs the
server and the web only (useful while the fork build is being debugged).

Every artifact lands in `.harness-run/` (override with `HARNESS_RUN_DIR`, and
that directory is gitignored): `ports.env` (this run's ports, origins, SHAs,
`DISPLAY`), `pids`, `logs/`, `userdata/`, `sample-ac.json`, `blocked.json` when
a precondition was absent, and `evidence.jsonl` when run directly.

## Exit codes

`0` up / PASS, `1` a step failed or an assertion did not hold, `77` **BLOCKED** —
a precondition this VM does not meet (missing tool, no database, no fork
revision, no stack on this run's ports). BLOCKED is never a pass: `sample-ac.mjs`
records `result: "BLOCKED"` with the reason, and the evidence runner maps exit 77
to BLOCKED as well.

`sample-ac.mjs` separates the two: a piece that is **absent** is BLOCKED (nothing
was proven), while a piece that answers and says the **wrong thing** — another
API origin, a build with a stale `NEXT_PUBLIC_API_URL` — is a FAIL (the harness
ran, the claim was false).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENV_FILE` | `.env` | the VM's env file; `DATABASE_URL` and `REDIS_URL` come from it |
| `OFFICE_FORK_SHA` | `0d03b18` | the fork revision the app is built from |
| `OFFICE_FORK_REMOTE` | `https://github.com/UNIAI-TEAM/uniwork-office` | where the fork is cloned from |
| `OFFICE_FORK_CACHE` | `~/.cache/uniwork-office-harness` | one checkout per SHA, reused across runs |
| `HARNESS_RUN_DIR` | `<repo>/.harness-run` | run artifacts |
| `HARNESS_DRY_RUN` | `0` | `1` = ports and preconditions only |
| `HARNESS_SKIP_APP` | `0` | `1` = server + web only |

The harness never installs system packages and never resets the shared database:
`start.sh` reports what is missing and exits 77.

## Provision delta (needs the Advisor's permission — `provision.sh` is not ours)

The cloud runner's `uniwork` profile (`~/.cloud-runner/.cursor/cloud/provision.sh`)
already installs `xvfb`, `xauth` and `dbus-x11` for the desktop Linux proof, so
the harness can run under xvfb on a `uniwork` VM. What it does **not** install is
the Chromium/Electron runtime library set — the `office` profile gets those from
`npx playwright install-deps chromium` in `install-office.sh`, the `uniwork`
profile never does. The fork is also not fetched by any provision script; the
harness clones it itself at `OFFICE_FORK_SHA` into `OFFICE_FORK_CACHE`.

The proposed delta (one line, `install.sh`, after `pnpm install --frozen-lockfile`):

```diff
--- a/.cursor/cloud/install.sh
+++ b/.cursor/cloud/install.sh
@@ (after `pnpm install --frozen-lockfile`)
+# G7-01 app harness (UNI-1376): the Electron app the harness launches needs the
+# same shared libraries as Chromium. The office profile gets them from this in
+# install-office.sh; the uniwork profile never does.
+(cd /tmp && npx --yes --package="playwright@${PLAYWRIGHT_VERSION}" -- playwright install-deps chromium)
```

Until that lands, `start.sh` checks `ldconfig` for `libnss3.so`, `libatk-1.0.so.0`,
`libgbm.so.1`, `libasound.so.2` and `libcups.so.2` and fails BLOCKED (exit 77)
naming the missing libraries and the exact apt command, instead of letting the
Electron loader fail obscurely later.

## What is still open (item C follow-up)

- `sample-ac.mjs` step 4 reads `userData/app-settings.json`, which the app writes
  only after it reaches `app.whenReady` (fork `apps/shell/src/main/index.ts:5248`,
  `persistUniWorkApiOriginFromEnv` in `apps/shell/src/main/office-bridge-host.ts:84`).
  Driving a **document** through the bridge needs a signed-in session and an
  office launch ticket, and that path is not implemented here:
  `POST /api/v1/documents/{documentID}/office/sessions`
  (D `server/internal/handler/router/documents.go:90`) returns a
  `uniwork-office-dev://open?ticket=…` deep link
  (D `server/internal/handler/office_launch.go:44`); the fork's
  `handleOfficeLaunchUrl` (F `apps/shell/src/main/office-bridge-host.ts:104`)
  exchanges the ticket at `POST /api/v1/office/sessions/exchange`
  (D `server/internal/handler/router/office_launch.go:12`) with a **device**
  session bearer, then downloads and opens the document. TODO(item C follow-up):
  seed a user plus a device session and add that path as a second sample AC
  (G7-A01's "web edit-save → open in the app" half). The current case deliberately
  stops at "the three pieces run together and the app resolved the D server".
- The fork's `npm run build:all` is the slow step (several minutes on a fresh VM)
  and its Rust xlsx sidecar needs `cargo`; `HARNESS_SKIP_APP=1` isolates the
  server + web half while that is worked on.
