# Cursor Cloud Agent environment

Lets a Cursor Cloud Agent run the same checks CI runs, on Cursor's VM instead
of a developer machine.

| File | Role |
| --- | --- |
| `provision.sh` | System toolchain and services: Go, Node, pnpm, Postgres 16, Redis 7.4.2 (built from source into `/usr/local/bin`), MinIO, Chromium libraries. Versions follow `.github/workflows/ci.yml`. Idempotent. |
| `install.sh` | Snapshot build: `provision.sh`, `.env`, `pnpm install`, Go modules and build, Playwright Chromium. Idempotent. |
| `start.sh` | Every agent boot: starts Postgres, Redis (7.4 only: replaces a running older server, fails loudly below 7.4) and MinIO, creates `uniwork`, `uniwork_test` and the `uniwork-test` bucket, runs `make migrate-up`. |
| `write-env.sh` | Writes `.env` = `.env.example` + `cloud.env`, readable by both `make` and `. .env`. |
| `cloud.env` | CI-equivalent values. No secrets. |
| `../Dockerfile`, `../environment.json` | The same setup as a repository-level environment. Cursor reads that file from the default branch only, so it applies once this lands on `main`. |

All scripts act on the current git checkout, so they work on any branch,
including branches that do not contain this directory.

## Saved environment (any branch)

Until the files are on `main`, use a personal saved environment in Cursor
with these two scripts. The install step copies this directory from
`test/cursor-cloud-env` to `~/.uniwork-cloud`, so lane branches without it
still boot.

Install:

```bash
git fetch -q origin test/cursor-cloud-env && rm -rf ~/.uniwork-cloud && mkdir -p ~/.uniwork-cloud && git archive FETCH_HEAD .cursor/cloud | tar -x -C ~/.uniwork-cloud && bash ~/.uniwork-cloud/.cursor/cloud/install.sh
```

Start:

```bash
bash ~/.uniwork-cloud/.cursor/cloud/start.sh
```

The setup run saw a fresh agent boot without the start script having run, so
a test runner calls `bash ~/.uniwork-cloud/.cursor/cloud/start.sh` itself
before its first command; it is idempotent.

After start, the usual commands work: `make test-go`, `make migrate-up`,
`bash scripts/test-go.sh`, `pnpm test`, `pnpm --filter <pkg> test`, and the
e2e flow from the `e2e` job in `ci.yml`.

## Updating the snapshot

A branch that needs more stack edits `provision.sh` or `install.sh` here,
pushes `test/cursor-cloud-env`, and rebuilds the environment in Cursor.

## Test runner per worktree

`cloud-runner.mjs` gives each worktree its own cloud agent (one VM) through
the Cloud Agents API v1. It needs `CURSOR_API_KEY` (env var; on Windows the
User or Machine scope is read too). Saved environments do not apply to
API-launched agents, so a new runner provisions itself from this branch on
its first run (about 10 minutes); later runs are follow-ups on the same VM.

```bash
git push origin HEAD                      # the runner tests what origin has
node <this dir>/cloud-runner.mjs ensure   # optional: provision ahead of time
node <this dir>/cloud-runner.mjs test --spec tests.txt [--lane slug] [--out reports/<lane>/x.md]
node <this dir>/cloud-runner.mjs status
node <this dir>/cloud-runner.mjs close    # deletes the agent and its results refs
```

A worktree can run several VMs at once. `--shard <name>` on `test`/`ensure`/`close`
selects a separate agent (state `cloud-runner.<name>.json`, results under
`refs/test-results/<lane>-<name>/`). `suite` starts one shard per spec file in
parallel and writes `cloud-suite-<sha>.md` with the worst verdict:

```bash
node <this dir>/cloud-runner.mjs suite --specs ts.txt,go.txt,e2e.txt --lane g3g4-root --out-dir reports/root
node <this dir>/cloud-runner.mjs close --all yes --lane g3g4-root
```

`tests.txt` holds one shell command per line (`#` comments), run from the
repository root. The report separates `stage_outcome` from `test_verdict`,
records the run's cost, and the logs come back from
`refs/test-results/<lane>/<sha>` beside the report. Exit codes: 0 pass,
1 tests failed, 2 blocked or runner error.

### Surviving a local shutdown

The cloud run does not depend on this machine. `test` records the round as
`pending` in the state file before it waits, so if the local process dies
(shutdown, crash, closed terminal) the round keeps running on the VM and
`collect` finishes the job later from the same worktree: it waits if the run is
still going, pulls the logs and writes the same report to the same `--out`.
`--detach yes` on `test` or `suite` starts the round(s) and exits at once.
`test` refuses to start while that shard still has an uncollected run.

```bash
node <this dir>/cloud-runner.mjs suite --specs ts.txt,go.txt --lane g3g4-root --out-dir reports/root --detach yes
# ... machine off and on again ...
node <this dir>/cloud-runner.mjs collect --all yes   # or --shard <name>; exit code = worst shard
```

`collect` writes each shard's report but not the suite summary. The run's
`--timeout` still counts from its start; `collect --timeout s` gives a fresh
wait instead.

### Rust sidecar shard

`provision.sh` installs Rust 1.88.0 (rustup, minimal profile, under `$HOME`;
`run-tests.sh` puts `~/.cargo/bin` on `PATH`). `specs/rust-sidecar.txt` builds
office-upstream with the native sidecar (`build-upstream.mjs --with-native`,
which applies the patch series to `.go-tmp/office-upstream-build/upstream`) and
runs `cargo test --locked` for the xlsx-engine crate in that patched copy.
`CARGO_TARGET_DIR` is `~/.cache/uniwork-cargo-target`, outside the checkout, so
the per-round `git clean` leaves compiled dependencies warm.

```bash
node <this dir>/cloud-runner.mjs test --spec <this dir>/specs/rust-sidecar.txt --lane <slug> --shard rust --out reports/<lane>/rust.md
```

## Other repositories (`--repo`)

The runner also drives a VM for `UNIAI-TEAM/uniwork-office` (the genoffice
fork). Every command takes `--repo uniwork|uniwork-office` (or one of their
GitHub URLs); without it the repository is the one the cwd's `origin` points
at, else `uniwork`. So a lane in a fork worktree just runs the runner from
there:

```bash
cd <uniwork-office worktree> && git push origin HEAD
node <dev-uniwork test-cursor-cloud-env checkout>/.cursor/cloud/cloud-runner.mjs test --spec tests.txt --lane <slug> --out reports/<lane>/x.md
node <same>/cloud-runner.mjs close        # when the lane is done
```

- `uniwork` stays the default and behaves as before: same state file names,
  same prompt, same profile.
- Another repository keeps its own state, `cloud-runner@<repo>[.<shard>].json`
  in the worktree's git dir, and its own agent and VM (the agent is named
  `runner <repo> <branch>`). `test`, `suite`, `--shard`, `ensure`, `collect`,
  `status` and `close` act on the selected repository's runners; `pending`
  records the repository, and spec refs (`refs/test-specs/...`), results refs
  and log pulls go to that repository.
- The runner scripts are never added to the fork. The fork VM fetches this
  directory from `test/cursor-cloud-env` of the uniwork repository into a bare
  side repository (`~/.uniwork-cloud/env.git`, shallow), with the VM's git
  credentials, falling back to `GH_TOKEN` through a credential helper so the
  token is never on a command line or in a log.
- If Cursor cannot open the repository (its GitHub app has no access:
  `POST /agents` answers 400 "Failed to verify existence of branch"), the
  runner falls back on its own: the agent boots on `test/cursor-cloud-env` of
  uniwork and `run-tests.sh --repo-url <url>` clones the repository into
  `~/work/<name>` once per VM and runs the round there. Spec refs are read
  from that repository. Results refs go to it with the VM's credentials, else
  with any personal GitHub token among the VM secrets (`ghp_`/`github_pat_`,
  through a credential helper with no global git config; Cursor's own
  `GH_TOKEN` can be its app token). When neither may write there (the trial:
  the app has no access and the PAT's account gets 403), the logs go to the
  uniwork repository as `refs/test-results/<repo>/<lane>/<sha>`; the report
  names it in `log_repo`, the runner fetches from it, and `close` deletes
  those refs too. Notes are scrubbed like logs. The state records
  `via: "clone"` (or `"direct"`), and follow-ups keep that mode; once the app
  has access, `close` and the next round goes direct.
- `run-tests.sh --profile office` selects the fork's profile:

| | `uniwork` | `office` (uniwork-office) |
| --- | --- | --- |
| provision | `provision.sh`: Go, Node 22, pnpm, Postgres, Redis 7.4.2 (source build), Rust 1.88, desktop libs | `provision-office.sh`: Node 22, Rust 1.88, xmllint, document fonts (Carlito, Caladea, Noto CJK), xvfb |
| install | `install.sh`: `.env`, `pnpm install`, Go build, Playwright Chromium | `install-office.sh`: `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, Playwright Chromium + its system libs |
| start | `start.sh`: services, databases, migrations | `start-office.sh`: allows unprivileged user namespaces for Electron (best effort) |
| dependency refresh | `pnpm-lock.yaml`, `server/go.sum` | `package-lock.json`, `apps/sheets/native/xlsx-engine/Cargo.lock` (`npm ci`) |
| kept across the per-round `git clean` | `node_modules` | `node_modules`, `apps/sheets/native/xlsx-engine/target` |
| failures extracted | Go `--- FAIL`, vitest `FAIL`/`×` | the same plus Playwright `✘ ... ›`, node:test `✖`, TAP `not ok` |

  A fork spec that mentions `test:e2e` or `electron` gets the Electron binary
  downloaded before its commands run. Run the shell e2e under xvfb as CI does:
  `xvfb-run --auto-servernum -- npm run test:e2e`. CI's `cargo-deny` license
  step is not installed on the VM.

Cost per round (Grok 4.6 high, measured 2026-10-09): fork, fresh VM in clone
mode (clone + provision + `npm ci` + Playwright, 117 s) 11.4 cents, warm round
about 20 s and 5.2-5.6 cents; uniwork unchanged, fresh VM 12.3 cents (150 s),
warm 5.2 cents (25 s).

## Fork CI replica

`specs/office-ci-test.txt` and `specs/office-ci-e2e.txt` replay the `test` and
`e2e` jobs of `UNIAI-TEAM/uniwork-office` `.github/workflows/ci.yml` on two
parallel VMs, so lanes need no GitHub Actions run. From a fork worktree whose
branch is pushed:

```bash
R=<dev-uniwork test-cursor-cloud-env checkout>/.cursor/cloud
git push origin HEAD
node $R/cloud-runner.mjs suite --specs $R/specs/office-ci-test.txt,$R/specs/office-ci-e2e.txt --lane <slug> --out-dir reports/<slug>
node $R/cloud-runner.mjs close --all yes --lane <slug>      # when the lane is done
```

Exit 0 = both shards pass. The `format`, `theme-colors`, `skill-version` and
`public-hygiene` steps diff against `HEAD^1` on main and the merge-base with
`origin/main` on any other branch (the PR merge-commit logic of CI, adapted).
Measured 2026-10-09 on main 854dc163, both shards PASS: test 20/20 steps (about
14 min with the sidecar rebuilt), e2e 7/7 steps (12-17 min incl. the build; all but
2 of the e2e tests), roughly 17-25 cents per shard round.

Not replicated: `cargo-deny` (not installed on the VM) and the setup/cache
steps (the `office` profile does them). Differences from CI's image, handled
in the specs: the `test` shard removes `fonts-noto-cjk` before `npm test`
(font-metrics expects no font to map U+0378; ubuntu-latest has none) and
deletes the kept sidecar `target/` (the cli tests skip their sidecar cases on a
fresh CI checkout); the office profile installs the NodeSource Node and puts
`/usr/bin` first, because the agent image's Node 22.14 lacks FTS5 in `node:sqlite`; the
`e2e` shard reduces the VM (Ubuntu 24.04, ~50 extra font packages) to CI's
font stack and 22.04 font package versions so the docs pixel baselines match.
Two e2e tests still differ on the VM and are excluded with `--grep-invert`:
docs-visual `kitchen-sink` (math fallback font of the CI image) and
`docs-table-float-click`; run them where the CI image is available.

Linux hosts (the VPS) run the runner the same way: `CURSOR_API_KEY` comes from
the environment, and every path the runner writes is built with `node:path`.
