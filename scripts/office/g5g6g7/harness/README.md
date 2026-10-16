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
exactly the process groups `start.sh` recorded, never a process by name; `start.sh`
uses that same logic on an earlier start's recorded groups before it starts
anything (see "A warm run dir is cleaned before anything starts" below). Each
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
OFFICE_FORK_SHA=0d03b18 \
  node scripts/office/g5g6g7/evidence.mjs run \
    --req G7-A01 --fixture fx-docx-report-vi --checker tester-cloud -- \
    node scripts/office/g5g6g7/harness/document-step.mjs
bash scripts/office/g5g6g7/harness/stop.sh           # down: only this run's PIDs
```

`start.sh` prints the exact evidence-runner commands for the run it just brought
up (with the run dir and SHA filled in). Running either script directly works
too and writes the same JSON line into the run dir; under the evidence runner
each defers to the runner's ledger so one check is never counted twice.

Flags (each has an environment form too, for the spec line):

| Flag | Env | Effect |
| --- | --- | --- |
| `--dry-run` | `HARNESS_DRY_RUN=1` | pick the ports, check the preconditions, stop before starting anything |
| `--skip-app` | `HARNESS_SKIP_APP=1` | server + web only (useful while the fork build is being debugged) |
| `--desktop` | `HARNESS_DESKTOP=1` | open the app on this session's own `DISPLAY` instead of under Xvfb, so a person can sign in to it (BLOCKED without a `DISPLAY`) |

`--dry-run` works in a scratch run dir that it removes: it never touches the
`pids`, `ports.env` or logs of a run that is up.

Every artifact lands in `.harness-run/` (override with `HARNESS_RUN_DIR`, and
that directory is gitignored): `ports.env` (this run's ports, origins, SHAs,
`DISPLAY` and, under Xvfb, its `XAUTHORITY` (the run's own `xauthority` file, so the document step's second Electron instance can connect to the same X server), and the app's launch inputs — `UNIWORK_USER_DATA`, `ELECTRON_BIN`,
`SHELL_APP_DIR`, `OFFICE_FORK_DIR`, `HARNESS_DEPLOYMENT_ID`), `pids`, `logs/`,
`userdata/`, `sample-ac.json`, `document-step.json`, `blocked.json` when a
precondition was absent, and `evidence.jsonl` when run directly. The layout
itself comes from `harnessPaths` in `lib.mjs`, so a rename cannot split the
writer from the reader.

Every component writes its own log under `logs/` (`server-build.log`,
`migrate.log`, `server.log`, `web.log`, `app.log`, plus `lib.log` for the last
`lib.mjs` call). On any exit that is not `0` and not BLOCKED, `start.sh` prints
the tail of each of those logs before it returns, so a cloud round can read the
failure from the round log alone — the r1 round ended on a bare
`usage: lib.mjs --write <runDir>` with nothing saying which step produced it.
`HARNESS_LOG_TAIL_LINES` (default `40`) sets the length.

`lib.mjs` has four CLI modes and `start.sh` calls them directly (never through
`node -e`): `node lib.mjs --write <runDir>` writes a run's ports and env,
`node lib.mjs --fork-dir <cacheRoot> <sha>` prints the fork checkout path,
`node lib.mjs --app-env <apiOrigin> <userDataDir>` writes NUL-delimited allow-listed
environment variables for the Electron app, and
`node lib.mjs --app-proxy <runDir> <listenPort> <targetPort>` runs the harness-local
TCP proxy between the Electron app and the D server. A failed call names its step
and the exact command in `start.sh`'s output.

## What start.sh records, and what it hands to the processes it starts

* `start-status.json` (`{"state":"starting|up|failed|blocked","reason":…}`) is
  start.sh's own outcome. `sample-ac.mjs` and `document-step.mjs` read it first: a
  start that **failed** (or never finished) makes them **FAIL** (exit 1), and only
  a precondition start.sh itself reported as missing (**blocked**) makes them
  BLOCKED (77). Cloud round 4 had start.sh exit 1 and both later steps record
  BLOCKED, which read as "the VM cannot do it" for a harness bug.
* The D server runs in a directory of its own, three levels deep in the run dir
  (`server-cwd/a/b/c`), with a copy of the VM's `.env` that lacks every key the
  run sets. The server reads a local `.env` for any key that is **empty or
  unset** in its environment (`server/cmd/server/envfile.go`), so clearing
  `DESKTOP_AUTH_CLIENT_ID` in `server.env` was undone by the checkout's `.env`
  and the server died with `set either DESKTOP_AUTH_CLIENTS or
  DESKTOP_AUTH_CLIENT_ID/DESKTOP_AUTH_REDIRECT_URIS, not both` (cloud round 4).
* The Electron app (and the second instance that carries a deep link) gets an
  **allow-listed** environment (`appEnv` in `lib.mjs`): the process basics, the
  locale, the display/session and keyring bus, the D origin, the userData dir and
  the fork's few switches. start.sh sources the VM's `.env`, and none of it
  (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, any `*_KEY`/`*_SECRET`/`*_TOKEN`/
  `*PASSWORD`) reaches the app; `appEnv` throws on such a name.
* `writeRunEnv` also allocates `APP_PROXY_PORT` and `APP_CDP_PORT` in `ports.env`,
  writes `userdata/deployment-profile.json` (`apiOrigin: http://127.0.0.1:<APP_PROXY_PORT>`),
  and initializes `app-proxy.state` (`online`). `start.sh` launches the harness-local
  TCP proxy (`lib.mjs --app-proxy`) forwarding `APP_PROXY_PORT` to `API_PORT` and passes
  `--remote-debugging-port=<APP_CDP_PORT>` to the Electron app. Toggling `app-proxy.state`
  to `offline` (`setAppApiProxyOnline(runDir, false)`) severs the app's link to the D
  server for offline-save testing (G7-10 Loop 3) while keeping the D server up for the
  web UI and the test.
* The deep-link instance is recorded in `pids` as `handoff` while it lives
  (stop.sh stops it too) and killed as a group if it outlives its timeout.
* `stop.sh` also removes the run's `uploads/` and `server-cwd/` by exact path.
* **A warm run dir is cleaned before anything starts.** If the run dir still holds
  a `pids` file, `start.sh` runs `stop.sh` for it — the same PID-file logic, never
  a process by name — and a stop that cannot finish is a **FAIL** with the reason,
  not a second stack on one run dir. The earlier start's `userdata/` is then moved
  to `userdata.previous-<utc stamp>` (kept, never deleted) and this start's app
  gets a fresh `userdata/`: `session.bin`, the sync store and Electron's
  single-instance lock all live in there, so a second app instance can never hand
  off to a stale one. Cloud round r3 shared one run dir between two starts whose
  harness was never stopped; the rerun's app lost the single-instance lock to the
  stale app, quit, and every loop read the missing app as BLOCKED.
* **The app must still be alive once its DevTools endpoint answers.** The display
  file start.sh waits for is written *before* Electron starts, so "the wrapper
  ran" is not evidence of an app: an app that is already gone (or whose endpoint
  never answers within `HARNESS_APP_CDP_WAIT_SECONDS`) makes the start **FAIL**
  with the reason, instead of an "up" that the loops then cannot use. An app that
  was started and is then missing at a loop start is a FAIL there too, never
  BLOCKED — see the tracer's `decideAppSignInOutcome`.
* **Every app-side CDP call and every tracer loop is bounded.** Each CDP `connect`
  or `page.evaluate` call into `window.aiOffice.*` (`uniworkSave`, `accountStatus`,
  `accountRetry`, `accountLogin`) and `aiOfficeTabs.close` races against
  `HARNESS_APP_STEP_TIMEOUT_MS` (default `90000` ms). On timeout the step is
  **FAIL** (exit `1`, never `77` BLOCKED) with `<call> did not settle within <n> s`,
  and the loop JSON records the call name, elapsed ms, `binding.json` state at
  that moment, and the redacted last 40 lines of `logs/app.log`. Before closing an
  open docs tab via `aiOfficeTabs.close`, the tracer also waits (bounded by
  `HARNESS_APP_STEP_TIMEOUT_MS`) on the docs `WebContentsView` target until its
  close-check bridge (`window.desktop.onCloseCheck` / `reportCloseCheck`) and
  loaded document control (`window.__genofficeControl` / `window.__aidocs.editor`,
  with `.start-booting` gone) are ready, and then settles for
  `HARNESS_DOCS_CLOSE_SETTLE_MS` (default `2500` ms, longer than the fork's 2 s
  `docsQueryDirty` timer) with the renderer still ready without calling
  `reportCloseCheck` itself — waiting out any pre-mount close-check query so
  `docsQueryDirty`'s 2 s no-reply timeout does not open a headless native
  `dialog.showMessageBox` (`closeNoReplyMsg`); if the docs tab never becomes ready
  within the bound, the step **FAIL**s with `docs tab not ready to close within <n> s`
  (recording `targetUrl`, `elapsedMs`, `bindingState`, redacted `appLogTail`, and
  `owner: "g5-client"`). An outer per-loop
  watchdog (`HARNESS_LOOP_TIMEOUT_MS`, default `600000` ms) bounds each tracer
  loop as a whole: if exceeded, it writes `tracer-loop-<N>.json` with status
  `FAIL` and reason `"loop watchdog"` and exits `1`.

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
| `HARNESS_LOG_TAIL_LINES` | `40` | lines of each component log printed on failure |
| `HARNESS_APP_CDP_WAIT_SECONDS` | `60` | how long the app's DevTools endpoint may take to answer before the start FAILs |
| `HARNESS_APP_SETTLE_SECONDS` | `2` | how long the app must stay alive after DevTools answered before the start calls the run up |
| `HARNESS_DOC_WAIT_MS` | `60000` | how long `document-step.mjs` waits for the app's working copy |
| `HARNESS_HANDOFF_TIMEOUT_MS` | `30000` | how long the second Electron instance that carries the deep link may run before it is killed (as a process group) |
| `HARNESS_APP_STEP_TIMEOUT_MS` | `90000` | per-call timeout (ms) for app-side CDP calls (`connect`, `page.evaluate` of `aiOffice.*` / `aiOfficeTabs.close`, and the docs tab close-readiness wait before `aiOfficeTabs.close`); timeout is a FAIL (`<call> did not settle within <n> s` or `docs tab not ready to close within <n> s`) |
| `HARNESS_DOCS_CLOSE_SETTLE_MS` | `2500` | post-readiness settle window (ms) with the docs renderer still ready before `aiOfficeTabs.close` is called, waiting out any pre-mount 2 s `docsQueryDirty` query without calling `reportCloseCheck` from the harness |
| `HARNESS_LOOP_TIMEOUT_MS` | `600000` | per-loop watchdog timeout (ms) for `g7-10/tracer.mjs`; timeout writes `tracer-loop-<N>.json` with `status: "FAIL"`, `reason: "loop watchdog"` and exits `1` |
| `HARNESS_DOC_EMAIL` / `HARNESS_DOC_PASSWORD` | unset | document step, desktop mode: reuse this existing account instead of seeding one (both or neither) |

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

## The document step (priority 2)

`document-step.mjs` drives one **document** through the launch link and records
its own evidence line (separate from the G7-A05 runtime-manifest sample above; it
serves the G7-A01 row the contract assigns to the document open). The two ends
agree on the fork's launch deep link `uniwork-office[-dev]://open?ticket=<ticket>`
(fork `apps/shell/src/main/uniwork-auth/callback.ts`: `isOfficeLaunchUrl` /
`extractOfficeLaunchFromArgv`, `routing.ts` `startLaunch`, bound at
`index.ts:6443`). The older `uniwork://office/open?token=` parser is a fallback
and is **not** used here. The dev build registers `uniwork-office-dev`
(`deployment.ts`: `callbackSchemeForChannel`), so the harness asks the D server
for the dev client's link and the deep link is addressed to the dev scheme.

What it does, in order:

1. seed a user, an organization and a workspace through the H1 API,
2. upload the fixture as a **file** document (the launch service refuses page
   and folder documents: `service/office_launch.go` `refuseFolder` / `Kind !=
   DocumentFile`),
3. mint a launch session for it (`POST /api/v1/documents/{id}/office/sessions`)
   with `client_id=uniwork-office-dev` and the deployment the app claims
   (`HARNESS_DEPLOYMENT_ID`, default `default` — the id the fork's dev build
   derives from `UNIWORK_API_ORIGIN` when no `UNIWORK_DEPLOYMENT_ID` is set),
4. hand the deep link to the running app as a **second instance with the URL in
   argv**, the way the fork's own suite does (`e2e/helpers.ts`
   `handoffUrlToRunningApp`; the fork reads argv in
   `createAuthCallbackRouter(process.argv)` and `extractOfficeLaunchFromArgv`),
5. read the app's **own** record that it opened the document: the working copy
   and `binding.json` under `<userData>/uniwork-documents/<deployment>/…`
   (fork `uniwork-docs/binding-store.ts`) — never a screenshot.

The decision is `documentStepOutcome` in `lib.mjs`, pinned by a test:

| What is seen | Result |
| --- | --- |
| no ticket / no deep link from the D server | **FAIL** — the harness ran, the claim "D issues a ticket" is false |
| a ticket, a desktop session, no working copy for the document | **FAIL** — the app was handed the link and did not open it |
| a ticket, **no** desktop session (no OS keyring on the VM) | **BLOCKED** — the same precondition the fork's own suite skips on (`hasOsKeyring`, `NO_KEYRING_SKIP`) |
| a working copy whose `binding.json` names the fixture document | **PASS** |

A harness bug (a bad path, a wrong client id, a link the app cannot parse) is a
FAIL, never BLOCKED. Exit codes are the same as everywhere: `0` PASS, `1` FAIL,
`77` BLOCKED.

The link the server builds is checked against `officeDeepLink(clientId, ticket)`
before it is delivered, and the ticket is read out of the server's own
`launch_url` rather than assumed — so a link-shape drift is a named FAIL, not a
silent no-op.

The fork's `npm run build:all` is the slow step (several minutes on a fresh VM)
and its Rust xlsx sidecar needs `cargo`; `--skip-app` isolates the server + web
half while that is worked on.

## Run it on a signed-in desktop (G7-A01)

On the cloud VM the document step is **BLOCKED**: the app is not signed in (the
harness does not automate the sign-in) and a Linux VM without an OS keyring
cannot keep a desktop session. G7-A01 is therefore run on a desktop whose app can
sign in — a graphical Linux session with an unlocked Secret Service (GNOME
keyring / KWallet). The step then needs the **app's** sign-in to be the account
that owns the document, so it either reuses your account or seeds one you sign in
as. `UNIWORK_CHECKOUT` in the block below is the absolute path of the checkout
you are running the round in; set it once and the block is a script, not a
template (the block must stay valid bash — `bash -n`).

```sh
# 1. from a terminal of the desktop session, in the checkout (the same SHA the round tests):
#    UNIWORK_CHECKOUT is the absolute path of that checkout
export UNIWORK_CHECKOUT='/path/to/uniwork'
cd "$UNIWORK_CHECKOUT"
export OFFICE_FORK_SHA=0d03b18
bash scripts/office/g5g6g7/harness/start.sh --desktop      # server + web + the app, on this DISPLAY

# 2. your own account: read the password without echo or history, then run the step
export HARNESS_DOC_EMAIL='you@example.com'
read -rs HARNESS_DOC_PASSWORD && export HARNESS_DOC_PASSWORD
node scripts/office/g5g6g7/evidence.mjs run \
  --req G7-A01 --fixture fx-docx-report-vi --checker advisor -- \
  node scripts/office/g5g6g7/harness/document-step.mjs --wait-signin 300

# 3. while it waits it prints the account and the steps: in the app window choose
#    Sign in, sign in at the web page it opens (the harness web, printed by
#    start.sh) as that account, approve the desktop consent. Nothing else to type.
#    (The runner captures the step's output, so the step also writes these
#    instructions straight to your terminal.)

# 4. tear down, and check the line
bash scripts/office/g5g6g7/harness/stop.sh
node scripts/office/g5g6g7/evidence.mjs verify
```

Without `HARNESS_DOC_EMAIL`/`HARNESS_DOC_PASSWORD` the step seeds a throwaway
account instead, and `--wait-signin` prints its email; its random password is in
`.harness-run/doc-user.json` (mode 0600, removed with the account when the step
ends), never in the output. A reused account's password is read from the
environment only and is never printed or written; no token, ticket or password
reaches the output, `document-step.json` or the ledger. The step creates its own
organization, workspace and document under the account, through the calls
tabulated in `api-contract.mjs` (`api-contract.test.mjs` pins every path, method,
path-param kind and body key against the server's router, handlers and SDI
structs; `POST /orgs/{org}/workspaces` takes the organization **id**, not its
slug). Cleanup: a **seeded** organization gets its deletion requested by id
(the server erases it asynchronously, after 5 days); the seeded account is still
that organization's owner, so the server refuses its deletion (`409`) and the
step does not try: it is listed with the organization under `cleanup.leftovers`
in `document-step.json` (id, email, reason; never a secret) and printed as
`cleanup left`. A seeded account without an organization is deleted at once. A
cleanup that fails or is deferred never changes the result. A **reused** account
is never cleaned up.

**Expected PASS.** `document step: PASS`, exit `0`, a G7-A01 line with
`"result":"PASS"` in `test-results/office-g5g6g7-evidence/evidence.jsonl`, and
these checks in the output: `the server lists a live desktop session for the
account` (the server's own device list shows a live `uniwork-office-dev` session
for this deployment), `the D server minted a dev-channel launch link`, `the app
received the deep link as a second instance`, and `the app opened the fixture
document` — the app's own working copy and `binding.json` for the fixture
document under `.harness-run/userdata/uniwork-documents/default/<account>/<doc>/`.
`evidence.mjs verify` reports nothing about that line.

Other outcomes: `BLOCKED` (77) with `no live uniwork-office-dev desktop session
for <email>` when nobody signed in within the wait (or the app is signed in as a
different account); `FAIL` (1) when the app was signed in and handed the link but
left no working copy, or when the server refused to mint the link, or when a
seeding call failed. A FAIL says why on stdout and stderr (`FAILED: <check> —
<reason> [request <METHOD> <path> -> <status>]`, never a token or ticket), in
`failures` of `document-step.json`, and `evidence.mjs run` echoes the tail of a
FAIL or BLOCKED command's output to stderr so it reaches the cloud round log.

## Headless keyring (Linux)

A signed-in desktop row needs the app to keep its session, and the fork's
credential store (`apps/shell/src/main/uniwork-auth/credentials.ts`,
`createCredentialStore`) refuses to write one without a real OS keyring: Electron's
`safeStorage` on Linux must select `gnome_libsecret` (or KWallet), never
`basic_text`. A cloud VM has no desktop session, so this spike proves a headless
setup: a private D-Bus session, `gnome-keyring-daemon` unlocked with a throwaway
password, and the app's own credential module run against it. Nothing here starts
the D stack.

Include it in a cloud round (the branch must be pushed: the VM runs the scripts
from it). Standalone, or appended to a bigger spec:

```sh
node "$RUNNER/cloud-runner.mjs" test --spec scripts/office/g5g6g7/harness/keyring.spec.txt --lane "$LANE" --out "$REPORT"
cat my-spec.txt scripts/office/g5g6g7/harness/keyring.spec.txt > spec.txt
```

| Piece | What it is |
| --- | --- |
| `keyring.spec.txt` | the spec fragment: four lines, one exit marker each, `; true` on all but the last |
| `keyring-fork.sh` | clone the fork at `OFFICE_FORK_SHA` into `OFFICE_FORK_CACHE` (the same dir `start.sh` uses), `npm ci --ignore-scripts`, the Electron binary, esbuild, the Electron runtime libraries; no build |
| `keyring-session.sh` | inside `dbus-run-session`: unlock the daemon, then `KEYRING_RT` and the `SAFESTORAGE*` probes (or, with `--exec <cmd...>`, enter a private `dbus-run-session`, unlock the daemon, run `<cmd...>` and pass its exit code through); stops the daemon by PID, removes its scratch dir |
| `keyring-probe.mjs` | bundles the fork's `credentials.ts` with the fork's esbuild, runs it in the fork's Electron (`keyring-probe-main.mjs`, logic in `keyring-probe-core.mjs`) and prints one JSON line |

To wrap `start.sh`, the evidence runs and `stop.sh` inside one headless keyring session (so the app launched by `start.sh` inherits `DBUS_SESSION_BUS_ADDRESS`, `XDG_DATA_HOME` and `XDG_RUNTIME_DIR`):

```sh
bash scripts/office/g5g6g7/harness/keyring-session.sh --exec bash -c '
  bash scripts/office/g5g6g7/harness/start.sh || exit $?
  OFFICE_FORK_SHA="${OFFICE_FORK_SHA:-ab12238f}" \
    node scripts/office/g5g6g7/evidence.mjs run --req G7-A01 --fixture fx-docx-report-vi --checker tester-cloud -- \
    node scripts/office/g5g6g7/g7-10/tracer.mjs --loop 1
  rc=$?
  bash scripts/office/g5g6g7/harness/stop.sh || true
  exit $rc
'
```

What each marker means (every probe line is JSON with `label`, `backend`,
`encryptionAvailable`, `canStore`, `roundTrip`, `status`; only booleans, a coarse
error code and a byte count, never a secret value):

| Marker | Expected | It proves |
| --- | --- | --- |
| `KEYRING_APT_EXIT=0` | 0 | `gnome-keyring dbus-x11 xvfb libsecret-tools` installed (sudo when the user is not root); non-zero = packages missing, the next lines say BLOCKED |
| `KEYRING_FORK_EXIT=0` + `KEYRING_FORK dir=… sha=…` | 0 | the fork checkout, Electron and esbuild are ready |
| `KEYRING_DAEMON secrets=yes unlocked=yes` | yes / yes | the daemon owns `org.freedesktop.secrets` and its default collection is unlocked |
| `KEYRING_RT match=yes` | yes | a random value stored with `secret-tool store` comes back from `secret-tool lookup` unchanged (the value is never printed) |
| `SAFESTORAGE {…}` | `gnome_libsecret`, `roundTrip:"ok"`, `status:"ready"` | the app's own credential store saves and loads a credential through the real keyring; the file holds no plaintext token (`plaintextInFile:false`) |
| `SAFESTORAGE_NODESKTOP {…}` | informational | the same probe with the harness app's environment as it is today: `appEnv` (`lib.mjs`) does not pass `XDG_CURRENT_DESKTOP`, and Chromium picks the keyring from it |
| `SAFESTORAGE_FORCED {…}` | informational | the same without a desktop name but with `--password-store=gnome-libsecret`: the other way to get the keyring |
| `NO_KEYRING {…}` | `status:"keyring_unavailable"` | negative control: `DBUS_SESSION_BUS_ADDRESS` points at a bus that does not exist (no daemon, nothing to activate) and the app refuses to store (no plaintext fallback); the backend may still read `gnome_libsecret`, the refusal is `encryptionAvailable:false` |
| `*_EXIT=n` | 0 | the command's own exit code; `KEYRING_SESSION_EXIT=77` is BLOCKED (a tool missing), never a pass |

Things that decide whether the app (not only the probe) gets the keyring:

* The password lives in one shell variable and one pipe inside `keyring-session.sh`:
  it is generated per run from `/dev/urandom`, never echoed, never in a spec line,
  a file or a process argument. The keyring's storage and control socket are in a
  scratch dir of the run, so a warm VM's older keyring is neither used nor touched.
* The app reaches the keyring through `DBUS_SESSION_BUS_ADDRESS`, which `appEnv`
  passes. Whatever starts the app must run inside the same `dbus-run-session`
  (and, under `xvfb-run`, the session is inherited, not replaced).
* `XDG_CURRENT_DESKTOP` is not in `APP_ENV_PASSTHROUGH`: without it the probe
  falls to `basic_text` (`SAFESTORAGE_NODESKTOP`). `start.sh` therefore passes
  `--password-store=gnome-libsecret` to the app's Electron explicitly (not by
  sniffing the desktop), and `appEnv` stays as it is.
* A locked or absent daemon is `keyring_unavailable`, the same status the document
  step turns into BLOCKED.

Local dry run (a host that already has the daemon, `xvfb-run` and a fork checkout):
`OFFICE_FORK_DIR=<fork checkout> dbus-run-session -- bash scripts/office/g5g6g7/harness/keyring-session.sh`;
`OFFICE_FORK_DIR=<fork checkout> node --test scripts/office/g5g6g7/harness/keyring-probe.test.mjs`
also runs the fork's real credential module against a fake `safeStorage`.


## G7-04 cross-host loop (UNI-1386)

`g7-04/cross-host.mjs` chains the whole cross-host loop on ONE seeded document
per fixture and records the rows `G7-A01` and `G5-A03` (`acceptance.md` l.87 /
l.61): a web edit + Save in the web frame, opening the app from web (deep link),
a desktop offline edit + Save under the harness proxy cut, the reconnect the web
frame observes (the D host's own `doc.remoteVersion` notice and the frame's
reload), an AI turn (zero versions) plus its Save (one version), the three-way
sha256 at the end, and the running version tally (one per user Save, zero per AI
turn). The dirty editor belongs to G5-A03.3 only (D1-04): that chain drives the
app's own editor (CDP) to make the document dirty, lands a web Save on top of it
and requires the app to keep its local bytes; G7-A01 runs no dirty-edit step at
all, so a fork whose editor control never becomes ready cannot block it.

Reuse, not copies (BE-704-05): the driver imports `harness/app.mjs` (CDP),
`harness/web.mjs` (Playwright), the `g7-10/tracer.mjs` fixture/seed/HTTP helpers,
the G8-19 desktop editor action and its plans (`g8-19/anchors.mjs` `runEditPlan` +
`EDIT_DRIVERS`) and its only redactor is `redactSignInError`
(`harness/app-steps.mjs`). What stays local is the plan NAMES the record prints
(`DIRTY_EDIT_PLANS`: insert-row / split-block) and the driver's own record fields.
Exit codes are the harness's everywhere: `0` PASS, `1` FAIL, `77` BLOCKED.

One invocation writes one evidence line, so run one (row, fixture) per command:

```sh
for row in G7-A01 G5-A03; do
  for fixture in fx-xlsx-revenue-xyz fx-docx-report-vi; do
    OFFICE_FORK_SHA="$OFFICE_FORK_SHA" \
      node scripts/office/g5g6g7/evidence.mjs run \
        --req "$row" --fixture "$fixture" --checker tester-cloud -- \
        node scripts/office/g5g6g7/g7-04/cross-host.mjs --row "$row" --fixture "$fixture"
  done
done
```

| Flag / env | Effect |
| --- | --- |
| `--row G7-A01\|G5-A03` | the row whose chain and evidence this run records (required) |
| `--fixture <id>\|all` | one fixture, or both (refused under the evidence runner: one line per fixture) |
| `--run-dir <dir>` | the run dir start.sh wrote (`HARNESS_RUN_DIR` by default) |
| `--timeout-ms <ms>` | per-step bound (else `HARNESS_APP_STEP_TIMEOUT_MS`, else 90000) |
| `--dry-run` | the start gate and ports.env only: prints the plan, starts nothing, writes no artifact |
| `HARNESS_ALLOW_REAL_AI_UPSTREAM` | `1` lets the AI step PASS on a real upstream; without it, and under `AI_PROVIDER=fake` or a 503 `ai_disabled`, G7-A01.5 is BLOCKED with `real-AI upstream required, acceptance.md l.87` — never PASS |
| `HARNESS_LOOP_TIMEOUT_MS` | the row watchdog (default 600000; expiry is FAIL `row watchdog`) |

Rows and what each step proves: `G5-A03.1` web Save → app binding version id +
working-copy sha256 = the server checksum; `G5-A03.3` a dirty app keeps its local
bytes and shows the S6 new-version bar while a web Save lands (a reload there is
a FAIL), then the bar's reload action discards the edit; `G5-A03.2`/`G7-A01.4`
the desktop's reconnect commit is announced to the web frame and reloaded (the
announced version id must be the desktop's); `G7-A01.3` the offline Save holds an
intent with zero server versions (the step polls for the app's own receipt — a
`.rec` intent file or an `offline`/`paused_offline` binding — within the step
bound, because the fork writes it only after the module's own Save lands, so a
read straight after `aiOffice.uniworkSave` can still be empty); `G7-A01.5` the AI
turn creates zero versions and the Save after it exactly one (polled the same way,
until the server head and the app binding agree); `G7-A01.6` the three checksums
agree and the tally is one version per user Save.

Which edits a run really drove through the editor UI is on the row: `uiEdits`
(record and artifact) carries `dirty`, `offlineSave` and `aiSave`, each `real`
(the app's own editor made that edit) or `standin` (the harness wrote the
format's deterministic bytes into the working copy — a working-copy write, never
claimed as a UI edit — or the step did not run, which drives no UI edit either).
A stand-in offline edit stays allowed and stays visible: the artifact also says so
in `steps["app-offline-save"].editSource` and in `notes`. The AI turn is the
document-route protocol call (`contract-p0.md` A10) and the Save after it stores
the format's deterministic stand-in bytes for the AI edit, so `uiEdits.aiSave` is
`standin` — this harness does not drive the fork's AI panel.

Steps that cannot run are BLOCKED with a named blocker, never folded into a PASS:
the app's editor cannot be driven (the dirty-edit plans of `DIRTY_EDIT_PLANS`,
whose actions are `EDIT_DRIVERS`), the S6 reload action cannot be driven, the web
frame never reaches `data-state="ready"` (owner `lead-f`; the pinned bundle must
be installed in the web build), or the app cannot sign in (no OS keyring). A
BLOCKED step stops only the later steps that consume its result — they are
recorded `SKIPPED`, not failed — and a BLOCKED step with no named blocker is a
FAIL. In the `G5-A03` chain a BLOCKED dirty step therefore skips
`web-save-2`/`dirty-kept`/`app-reload` while the independent desktop half
(`app-offline-save` → `app-reconnect` → `web-sees`) and `final-shas` still run,
and the row ends BLOCKED (77) with that blocker; a FAIL always stops the chain and
wins over BLOCKED. Artifacts:
`<runDir>/reports/g7-qa/<row lower-case>/<fixture>.json`; version ids, counts and
the three checksums are in the record the command prints (the evidence artifact
log) and in that JSON.


## G7-04 revoke (UNI-1386, row G7-A02.1)

`g7-04/revoke.mjs` proves one thing on the running harness stack: a revocation
between two UniWork AI turns refuses the NEXT turn on both hosts, refuses the
revoked user's Save, and leaves the version count unchanged with no committed
commit intent. The helpers it names are imported, never copied: ports.env / the
start gate / the fixture loader (`harness/lib.mjs`, `harness/fixture-files.mjs`),
`evidence.mjs`, and the G7-10 tracer's `classifyAiResponse` /
`interpretCommitIntentLookup`; its own HTTP transport wraps the shared
`harness/api-contract.mjs` `G8_API_CALLS` table and answers `{ status, ok, body }`
(the commit-intent lookup hands the tracer helper that body as `data`, the shape
it reads).

```sh
node scripts/office/g5g6g7/evidence.mjs run \
  --req G7-A02 --fixture fx-docx-report-vi --checker tester-cloud -- \
  node scripts/office/g5g6g7/g7-04/revoke.mjs --case deactivate --fixture fx-docx-report-vi --run-dir "$HARNESS_RUN_DIR"
node scripts/office/g5g6g7/evidence.mjs verify
```

CLI: `--fixture fx-docx-report-vi|fx-xlsx-revenue-xyz|all`, `--case
deactivate|downgrade|remove|all`, `--run-dir <dir>`, `--dry-run`. One evidence
line per (case, fixture) for G7-A02; the artifact log under `logs/` carries every
status code, both version counts and the file:line reason behind each expected
answer. Exit `0` PASS / `1` FAIL / `77` BLOCKED.

Every (case, fixture) run seeds its OWN world (owner, editor member, organization,
workspace, document): a run must never inherit an earlier run's revoke and be
handed a member a previous case already revoked (D1-01). There is no world cache
— nothing but the artifact text is written to the run dir, and a cache file an
earlier driver version left there is deleted, never read back, so no bearer token
survives on disk (BE-704-04). The version counts and the commit-intent lookup are
read with the **owner's** token, which keeps read access in every case: a revoked
member's own reads are refused (403/404) and would turn the count itself into a
failure before the "+0 versions" assertion is evaluated (BE-704-02).

The driver opens the document on both hosts (the member's desktop session route
and a frame token the member mints) and runs AI turn 1. Then it revokes and runs
AI turn 2, a Save attempt and a commit-intent lookup. What each case does, and
what the server really answers — read from the Go code, never assumed, and
asserted per route (the two hosts do not always answer the same code):

| `--case` | revoke step | AI turn 2 | the member's Save | version |
| --- | --- | --- | --- | --- |
| `deactivate` (primary) | `POST /api/v1/orgs/{org}/members/{userID}/deactivate` (`router/organizations.go:89`) | session **403 `member_deactivated`** (`service/organization.go:155-156` → `service/errors.go:53-57`); frame **401 `unauthorized`**, `error_class=session` — the frame actor resolver forwards only `ErrNotFound`/`ErrForbidden` and rewrites the same CodedError as a generic 401 (`handler/ai_mount.go:101-106`; class from `handler/dto/sdo/error_class.go:64`) | 403 `member_deactivated` | +0 |
| `downgrade` | `PATCH /documents/{id}` `visibility=restricted` + `POST /documents/{id}/shares` `level=view` (the FQ-50 path) | **200 on both** — the AI turn needs view only and view-only AI is allowed by design (G6-05u, Advisor; `handler/office_frame_ai.go:26-35`, `service/ai_uniwork.go:391`) | upload **403 `forbidden`** (the edit gate, `service/document_files.go:132-134`); commit **404 `not_found`** (`resolveUpload` runs before the edit gate, `service/document_commit.go:277` vs `:296`) | +0 |
| `remove` | `DELETE /api/v1/workspaces/{ws}/members/{user}` (`router/workspaces.go:65`) — answers **204** | **404 `not_found` on both** (a non-member holds no level: `service/document_permissions.go` `decideDocumentAccess:290-293`, the product rule a non-member never learns an id exists) | 404 `not_found` | +0 |

The `downgrade` row is the one to read twice: its AI turn keeps answering 200
because it only ever needed view, so the driver asserts exactly that and does NOT
fake a 403 on it. The refusal that proves the edit right is gone is the UPLOAD's
403 `forbidden` (the edit gate); the commit's 404 `not_found` is the route's own
answer, not an edit refusal — its order is `preflightDocument` (view) →
`resolveUpload` → the edit gate, and the refused upload left no resolvable id, so
the commit is refused before the edit check is reached. Both are asserted as the
code answers them and neither is widened to "any 4xx".

The `deactivate` row refuses the next turn on both routes with two different
codes, and both are the code's: the session route passes the
`member_deactivated` CodedError through as 403, while the frame route's actor
resolver swallows it into a generic 401 `unauthorized` `error_class=session` —
the 401 is not frame-token auth (the token is stateless and still verifies) and
not a session revocation; it is that resolver's default branch.

The commit-intent lookup is read with the owner's token — the revoke never
refuses that read — and the intent the route answers for is the CALLER's own
(`service/document_commit_intent.go:380-384`, enforced at `:429`): the owner's
read is the owner's own answer, a revoked member's own read is refused 403/404,
and the write path is refused before any intent is claimed
(`service/document_commit.go:296` → `:305-309`), so no intent can appear after
the revoke in the first place. The rule that a committed intent FAILs the row is
pinned by the unit test (the fake's committed-answer mutation), and the artifact
records both the read and the reason with its file:line. A 200 on the next turn
where a case expects a refusal, any new version, or a committed commit intent is
a **FAIL**, never a PASS. Under `AI_PROVIDER=fake` the turn-1 content claim
cannot be proven: that step is **BLOCKED** (`no real upstream on this runner;
contract-p0 §8`, owner `g7-qa`, exit 77) while the revoke assertion still runs,
and a broken revoke assertion wins over the BLOCKED.

**G7-A02.2 (a late AI result not applied to a newer base) is not implemented
here.** It belongs to G7-03a (FQ-28/29/32); G7-04 records the cross-reference
only and runs no duplicate.

Local tests: `node --test scripts/office/g5g6g7/g7-04/revoke.test.mjs` (the
state-driven fake stack: it refuses a revoked member's own reads, resolves
`upload_id` before the access gate, answers the frame route's 401 and pins the
`{ status, ok, body }` lookup shape the driver's own `call()` returns; the real
harness is Linux-only).
## G8-19 cross-host rows (UNI-1414)

The G8 rows (`g8-19/<module>.mjs`, one file per module) share one harness. The
contract they code against is `harness/g8-contract.md`; `g8-19/fake-world.mjs`
implements it in memory, so a row module can be written and tested before a
live run exists.

| Module | What it gives a row |
| --- | --- |
| `harness/world.mjs` | the seeded world: users A, B, C (organization X, workspaces W1/W2, B and C invited into W2) and M (organization Y, workspace WY); cached 0600 at `$HARNESS_RUN_DIR/g8-19-world.json`, every user re-logged in on reuse; `world.refreshTokens()` re-logs in on demand (access tokens live 15 min); `cleanup()` reports leftovers and never deletes by SQL |
| `harness/api.mjs` | `session(user)` / `createApi(origin)`: one bearer session per user over the rows in `api-contract.mjs`, which are checked against the Go router and SDI structs |
| `harness/app.mjs` | the desktop driver over CDP: sign-in with the org choice, editor pages, the comments/discussion bridges, tabs focus |
| `harness/web.mjs` | one Playwright context per user on the D web; `openDocument` reads the Inbox state and comment-panel markers |
| `g8-19/run-row.mjs` | `runRowModule` / `rowMain`: the start gate, `ports.env`, the step ctx, the watchdog and the exit mapping |

A row module ends with:

```sh
# inside g8-19/<module>.mjs (JavaScript, shown here for the entry line only):
#   if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("comments", run));
node scripts/office/g5g6g7/g8-19/comments.mjs --row G8-A01 --fixture fx-docx-report-vi --run-dir "$HARNESS_RUN_DIR"
```

Exit codes: `0` PASS, `1` FAIL, `77` BLOCKED with a named blocker and owner
(`ctx.block(blocker, owner)`); a BLOCKED without a named blocker is rewritten to
FAIL. The artifact is `<runDir>/reports/g7-qa/<g8-aXX>/<fixture>.json`, truncated
at the start of every run and redacted (bearer tokens, tickets, secrets).

| Variable | Default | Meaning |
| --- | --- | --- |
| `OFFICE_FORK_SHA` | — | the spec must export `7d665a54` for G8 runs; the start default (`0d03b18`) predates the comment bridges |
| `G819_ALLOW_SQL_MEMBERSHIP` | unset | `1` lets the seed add M to X/W1 by a direct SQL insert (no API can create a multi-organization account since ADR 0032); otherwise the multi-org rows are BLOCKED with that reason |
| `G819_DATABASE_URL` / `DATABASE_URL` | unset | the database the SQL membership insert uses |
| `G819_ROW_TIMEOUT_MS` | `600000` | row watchdog; the running step and the row FAIL with `row watchdog` |
| `G819_WRITE_EVIDENCE` | unset | `1` makes `rowMain` append its own `evidence.jsonl` line when no `OFFICE_EVIDENCE_ID` wrapper writes one |
