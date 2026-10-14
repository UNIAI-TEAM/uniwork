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
| `HARNESS_DOC_WAIT_MS` | `60000` | how long `document-step.mjs` waits for the app's working copy |
| `HARNESS_HANDOFF_TIMEOUT_MS` | `30000` | how long the second Electron instance that carries the deep link may run before it is killed (as a process group) |
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

