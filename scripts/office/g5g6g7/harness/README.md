# G7-01 app harness (UNI-1376, item C)

Brings up the three pieces of the smallest end-to-end acceptance case on a
Linux runner VM and records one evidence line:

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
xvfb-run -a node scripts/office/g5g6g7/harness/sample-ac.mjs
bash scripts/office/g5g6g7/harness/stop.sh           # down: only this run's PIDs
```

`start.sh --dry-run` (or `HARNESS_DRY_RUN=1`) picks the ports, checks the
preconditions and stops before starting anything. `HARNESS_SKIP_APP=1` runs the
server and the web only (useful while the fork build is being debugged).

Every artifact lands in `.harness-run/` (override with `HARNESS_RUN_DIR`):
`ports.env` (this run's ports, origins, SHAs, `DISPLAY`), `pids`, `logs/`,
`userdata/`, `sample-ac.json`, `evidence.jsonl`.

## Exit codes

`0` up / PASS, `1` a step failed, `77` **BLOCKED** — a precondition this VM does
not meet (missing tool, no database, no fork revision). BLOCKED is never a pass:
`sample-ac.mjs` records `result: "BLOCKED"` with the reason, and a run where the
app or the fork is missing cannot come out PASS.

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
the harness can run under xvfb on a `uniwork` VM. What it does **not** install
is the Chromium/Electron runtime library set that the *office* profile gets from
`install-office.sh` (`npx playwright install-deps chromium`), and it does not
fetch the fork. The exact delta proposed to the Advisor:

```diff
--- a/.cursor/cloud/provision.sh
+++ b/.cursor/cloud/provision.sh
@@ (in install.sh, after `pnpm install --frozen-lockfile`)
+# G7-01 app harness (UNI-1376): the Electron app the harness launches needs the
+# same shared libraries as Chromium; install-office.sh gets them from this, the
+# uniwork profile does not.
+(cd /tmp && npx --yes --package="playwright@${PLAYWRIGHT_VERSION}" -- playwright install-deps chromium)
```

Until that lands, `start.sh` detects `xvfb-run` and fails BLOCKED (exit 77) with
the apt line to run, instead of failing obscurely.

## What is still open

- `sample-ac.mjs` step 4 reads `userData/app-settings.json`, which the app writes
  only after it reaches `app.whenReady` (`fork apps/shell/src/main/index.ts:5248`).
  Driving a *document* through the bridge needs a real login session and an
  office launch ticket: `POST /api/v1/documents/{documentID}/office/sessions`
  (D `server/internal/handler/router/documents.go:90`) → the `uniwork-office-dev://open?ticket=`
  deep link (D `server/internal/handler/office_launch.go:44`) → the fork's
  `handleOfficeLaunchUrl` (F `apps/shell/src/main/office-bridge-host.ts:104`),
  which exchanges the ticket at `POST /api/v1/office/sessions/exchange`
  (D `server/internal/handler/router/office_launch.go:12`) with a **device**
  session bearer. TODO(item C follow-up): seed a user + device session and add
  that path as a second sample AC; the current case deliberately stops at
  "the three pieces run together and the app resolved the D server".
- The fork's `npm run build:all` is the slow step (several minutes on a fresh VM)
  and its Rust xlsx sidecar needs `cargo`; `HARNESS_SKIP_APP=1` isolates the
  server+web half while that is worked on.
