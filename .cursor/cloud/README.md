# Cursor Cloud Agent environment

Lets a Cursor Cloud Agent run the same checks CI runs, on Cursor's VM instead
of a developer machine.

| File | Role |
| --- | --- |
| `provision.sh` | System toolchain and services: Go, Node, pnpm, Postgres 16, Redis 7, MinIO, Chromium libraries. Versions follow `.github/workflows/ci.yml`. Idempotent. |
| `install.sh` | Snapshot build: `provision.sh`, `.env`, `pnpm install`, Go modules and build, Playwright Chromium. Idempotent. |
| `start.sh` | Every agent boot: starts Postgres, Redis and MinIO, creates `uniwork`, `uniwork_test` and the `uniwork-test` bucket, runs `make migrate-up`. |
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

`tests.txt` holds one shell command per line (`#` comments), run from the
repository root. The report separates `stage_outcome` from `test_verdict`,
records the run's cost, and the logs come back from
`refs/test-results/<lane>/<sha>` beside the report. Exit codes: 0 pass,
1 tests failed, 2 blocked or runner error.
