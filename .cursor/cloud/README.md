# Cursor Cloud Agent environment

Lets a Cursor Cloud Agent run the same checks CI runs, on Cursor's VM instead
of a developer machine.

| File | Role |
| --- | --- |
| `.cursor/Dockerfile` | Base image: Go, Node, pnpm, Postgres 16, Redis 7, MinIO, Chromium libraries. Versions follow `.github/workflows/ci.yml`. |
| `.cursor/environment.json` | Points Cursor at the Dockerfile and the two scripts below. |
| `install.sh` | Snapshot build: writes `.env`, `pnpm install`, Go modules and build, Playwright Chromium. Idempotent. |
| `start.sh` | Every agent boot: starts Postgres, Redis and MinIO, creates `uniwork`, `uniwork_test` and the `uniwork-test` bucket, runs migrations. |
| `cloud.env` | CI-equivalent values appended to `.env.example` to form `.env`. No secrets. |
| `write-env.sh` | Builds that `.env` so both `make` and `. .env` can read it. |

After `start.sh`, the usual commands work: `make test-go`, `make migrate-up`,
`bash scripts/test-go.sh`, `pnpm test`, `pnpm --filter <pkg> test`, and the
e2e flow from the `e2e` job in `ci.yml`.

## Updating the snapshot

A branch that needs more stack (system packages, another toolchain) edits the
Dockerfile or `install.sh` on this branch, pushes, and rebuilds the
environment from the Cursor dashboard. Unchanged Dockerfile layers are reused.
Keep versions in step with `ci.yml`.
