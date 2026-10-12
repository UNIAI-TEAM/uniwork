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
Nothing outside the run's own PID file is ever touched — `stop.sh` signals
exactly the process groups `start.sh` recorded, never a process by name. Each
piece starts with `setsid`, so the recorded PID is its group leader and one
signal reaches its children too (that is what takes down the `Xvfb` this run's
`xvfb-run` started, and leaves every other display alone).

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

The harness fills the gap the VM's profile left, as the Advisor's rule requires:
it installs `xvfb`/`xauth`/`dbus-x11` and the Electron runtime libraries itself
when they are missing (`apt-get`, or `sudo -n` when that works; `playwright
install-deps chromium` first for the library set), and exits 77 BLOCKED with the
exact reason when it may not install. It never resets the shared database.

## Provision delta (proposed to the Advisor — `provision.sh` is not ours)

The harness installs its own gap, so it does not depend on this landing. It is
still worth doing once per VM instead of once per round, and it is the only
change any provision script would need:

- `provision.sh` (uniwork profile) already installs `xvfb`, `xauth` and
  `dbus-x11` for the desktop Linux proof — nothing to add there.
- The **Electron runtime libraries** only reach the *office* profile, from
  `npx playwright install-deps chromium` in `install-office.sh`. The `uniwork`
  profile never installs them, so `start.sh` does it per VM (once; the packages
  survive). Proposed delta, one line in `install.sh` after
  `pnpm install --frozen-lockfile`:

```diff
--- a/.cursor/cloud/install.sh
+++ b/.cursor/cloud/install.sh
@@ (after `pnpm install --frozen-lockfile`)
+# G7-01 app harness (UNI-1376): the Electron app the harness launches needs the
+# same shared libraries as Chromium. The office profile gets them from this in
+# install-office.sh; the uniwork profile never does.
+(cd /tmp && npx --yes --package="playwright@${PLAYWRIGHT_VERSION}" -- playwright install-deps chromium)
```

- The fork is not fetched by any provision script. The harness clones it at
  `OFFICE_FORK_SHA` into `OFFICE_FORK_CACHE` (~2 minutes once per SHA). A
  provision step could pre-clone it, but that is optional.

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
