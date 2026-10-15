# G8-19 cross-host rows: account, library, server rows and the cloud spec (UNI-1414)

Test tooling for the G8-A09 row ("after sign-in: organization choice, workspaces and roles,
shared documents, properties, create / rename / archive from the app, a deactivated member") and
for the AC rows held by Go and node checks (G8-A03, G8-A05, G8-A06, G8-A08), plus the cloud spec
that runs every row. Shared pieces (world, API, web, app, row runner) belong to T1; the contract
is `scripts/office/g5g6g7/harness/g8-contract.md` and the in-memory fake is `fake-world.mjs`.
Nothing here is product code.

## Files

| File | What it is |
| --- | --- |
| `account.mjs` | row module G8-A09: org picker, remembered org, deactivated member; runs `library.mjs`'s gather in the middle. Exports `decideG8A09Org`, `decideG8A09`, `runAccount`. |
| `library.mjs` | the library half of G8-A09. Exports `decideG8A09Docs`, `gatherLibrary`, `runLibrary`, `countWorkingCopies`. Also a CLI for debugging the half on its own. |
| `server-row.sh` | the Go / node commands of G8-A03/A05/A06/A08 (contract-collab.md section 12) with a no-passing-test guard and a SKIP guard; `--then <cmd>` chains a harness module. |
| `spec.test.mjs` | pins the cloud spec (below). |
| `a09-scenario.helper.mjs` | test kit: scripts the fake world so app, server and world agree, with fault knobs. Not a test file. |
| `*.test.mjs` | `node --test`, no server, no browser, no Electron. |

## Run a row module

```sh
node scripts/office/g5g6g7/g8-19/account.mjs --row G8-A09 --fixture fx-docx-report-vi --run-dir "$HARNESS_RUN_DIR"
```

Exit 0 PASS, 1 FAIL, 77 BLOCKED with a named blocker (`run-row.mjs`). The artifact is
`<run dir>/reports/g7-qa/g8-a09/fx-docx-report-vi.json`. In a round the module runs under
`evidence.mjs run`, which writes the ledger line; run alone it writes only the artifact.

## G8-A09 in order

M owns org Y (API) and is a member of org X and workspace W1 (raw SQL test seed behind
`G819_ALLOW_SQL_MEMBERSHIP=1`: ADR 0032 refuses a second active organization through every API).

1. `signIn:orgChoice`: sign M in. The picker must show, list X and Y, and the server log must hold
   zero org- or workspace-scoped requests from the start of the sign-in to the picker
   (`orgApiCallsBeforeChoice`; an unmeasurable count is a FAIL, not a pass).
2. `selectOrg:Y`, then `reSignIn:remembered`: sign out and in again; no picker, org Y is back.
3. `selectOrg:X`, then the library claims as M in X / W1 (`library.mjs`):
   `uniworkListWorkspaces` shows W1 with role `member`; A uploads a document to W2 (M is not in W2) and
   shares it with M, and `uniworkListSharedWithMe` lists it; `uniworkDocumentProperties` equals
   `GET /documents/{id}` (workspace, title, level, version, author ids; an absent server level reads as
   `view`); `uniworkCreateDocument` adds exactly one document (count +1, one title match, GET 200),
   `uniworkOpenDocument` opens it by id and exactly one working copy exists on disk for it
   (`countWorkingCopies` reads `<userData>/uniwork-documents/*/*/*`); `uniworkRenameDocument` is
   visible on GET; a web rename (PATCH `/documents/{id}` with the revision read first, the call the
   web library sends) reaches the desktop title after a focus, polled for at most 35 s; archive and
   restore are visible as `archived_at` on GET.
4. `deactivate`, last: A deactivates M in X. `uniworkListWorkspaces` and `uniworkCreateDocument` must
   answer `member_deactivated`. M is used by no other row, but the deactivation lasts for the run,
   so A09 is the last harness row in the spec and nothing may follow it for M.

Without the SQL seed the org steps and the deactivation are BLOCKED with the world's blocker
(`SQL_MEMBERSHIP_BLOCKER`), and the library half runs as A (shared by B from W2). The row is then
BLOCKED (77), never PASS.

Not covered here, on purpose: the S16-S18 screenshots and the lock message (tester_visual), the web
library UI, and any web-in-frame step. G8-A09 has none, so the web frame pin (05fd209, older than
fork G8-12..15) does not gate it; the rows that do (A02, A04, A07) are T2 and T3's and report BLOCKED
on that pin themselves.

## Server rows

```sh
bash scripts/office/g5g6g7/g8-19/server-row.sh G8-A03 --dry-run   # prints what would run
```

`G8-A03` service + handler comment tests and `./migrations`; `G8-A05` notification / service /
mentions; `G8-A06` notification; `G8-A08` isolation matrix, audit coverage and the node
events-catalogue / no-PII-log tests. A `go test` that matched no test, or a test named by `-run`
that was SKIPped (no database on the VM), is a FAIL. The spec chains the inbox module after the
server checks for A05 and A06 (`--then`), so each (row, fixture) has one ledger line.

## The cloud spec

`~/office-g5g6g7/reports/g7-qa/specs/cloud-g819-1.txt` (outside the repo; `G819_SPEC` points the test
at another). One command per line in the shape of `cloud-g710-8.txt`: unit tests, apt, frames,
the A03/A08 server rows, the A10 BLOCKED line (`G8-18 part F not on fork main 7d665a54`), one
keyring session that starts the stack, runs A01, A02, A04, A05, A06, A07 and A09 in that order and
verifies the ledger, collect lines, and the verdict awk last.

- One `evidence.mjs run` per (row, fixture) declared in `docs/office/g5g6g7/acceptance-rows.json` for
  G8-A01..A10; each is followed by `echo "G819_<row>_<fixture>_EXIT $?"` (`G819_SRV_<row>_<fixture>_EXIT`
  for the two server-only rows).
- The round FAILS if UNIT, APT, FRAMES, START, STOP, VERIFY, KEYRING_EXEC or any `G819_SRV_*` marker is
  not 0, if any other marker is not 0 or 77, or if UNIT, START or VERIFY never appeared. 77 needs a
  BLOCKED record with a blocker in the ledger, which `evidence.mjs verify` checks.
- The spec exports `OFFICE_FORK_SHA=7d665a54` (start.sh defaults to an older fork) and
  `G819_ALLOW_SQL_MEMBERSHIP=1`. `G819_DATABASE_URL` is read from the VM's `.env` inside the keyring
  session and is never printed. The world cache `g8-19-world.json` holds passwords and tokens (mode
  0600); the spec deletes it before `evidence.mjs verify`, and the collect lines name files, never `$R/*.json`.
- `spec.test.mjs` is a visible skip where the spec file is absent (the cloud VM) and runs in full with
  `G819_SPEC=<file>` or on the host that holds the default path.

## Tests

```sh
node --test scripts/office/g5g6g7/g8-19/account.test.mjs scripts/office/g5g6g7/g8-19/library.test.mjs \
  scripts/office/g5g6g7/g8-19/server-row.test.mjs
G819_SPEC=$HOME/office-g5g6g7/reports/g7-qa/specs/cloud-g819-1.txt node --test scripts/office/g5g6g7/g8-19/spec.test.mjs
```
