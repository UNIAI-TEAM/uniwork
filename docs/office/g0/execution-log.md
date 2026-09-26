# G0 execution and review evidence

Parent issue: UNI-656. Integration branch: `feature/UNI-656-documents-office-g0`.
Started 2026-09-16. This file records development
evidence; UniAI remains the source of issue status. Only a human sets `done`.

## Execution policy

- Main coordinates and resolves review findings.
- Implementers use `gpt-5.6-terra` with `xhigh` reasoning.
- From the user's 2026-09-17 decision, Terra workers return patch text only;
  they may inspect source but write no files. Main checks and applies each patch.
  Prior writable
  workers were interrupted after prompt-delivery/scope failures.
- Under the user's later routing decision, the existing Orca Claude terminal
  reviews UI and the existing Cursor terminal reviews non-UI code. Reviewers
  inspect frozen candidates and produce findings only. Astra/Sol fallback
  routing and the earlier reviewer-fixes-rounds-3/4 rule are superseded.
- Main adjudicates findings and assigns bounded corrective proposals to Terra;
  main applies them and Sol `gpt-5.6-sol` xhigh executes verification before
  another review (user direction, 2026-09-18). Main and Cursor do not execute
  new tests. Stop a repair loop once
  its requirements and checks pass; do not equate a slice with G0 acceptance.
- Writers are sequential for each worktree. A review without findings does
  not require a synthetic fix round. Report environmental gaps separately
  from implementation defects.
- All coordinator and worker threads follow the user's short-thread rollover
  policy at `../.uniwork-dev/office-g0/session-policy.md`. Checkpoints preserve
  Task/Dispatch lineage, model/effort, correction counts, pending questions and
  incomplete outcomes. Main supervises replacements only after settlement or
  verified fencing, without overlapping ownership or deleting transcripts.

## Branches and current stage

All implementation branches start from `develop` at
`97b4fa5946fc2ccb208d626de45a13dd0805d546`.

| Issue | Branch | Development stage | Review evidence |
| --- | --- | --- | --- |
| UNI-665 | `docs/UNI-665-office-scope-fe` | DOC-001a at `ffadd9a7` after worker corrective round 1 on `edd0b4ba`; writer interrupted for review; 1b remains open | Astra initial full review found six issues; independent re-review of the correction is now assigned, not yet accepted |
| UNI-666 | `feature/UNI-666-office-source-fixtures` | Candidate contains source/fixture manifests, 95 capability rows, 66 fixture entries and preparation/verification scripts; 13 fixture entries remain pending | Main verifier and 25/25 manifest tests passed; whole artifact review pending |
| UNI-667 | `feature/UNI-667-office-editor-spike` | Coordinator confirmed `in_progress` through request `start:21`; worker assigned real browser lab and six save/reopen flows | No browser-flow acceptance yet; actual Mac QA remains UNI-671 backlog |
| UNI-669 | `feature/UNI-669-office-sync-contracts` | Candidate clean at `f9fc40e6`; accumulated worker commits constitute the first corrective submission, not independently reviewed rounds 1-4 | Astra full artifact review found ten unresolved issues despite 25-case/12-test green results; correction round 2 pending worker assignment acknowledgement |

Workers use separate worktrees under the workspace's
`.uniwork-dev/worktrees/` directory. The main checkout retains the plan/spec
and coordination documents. No worker edits another worker's files.

The user confirmed that no task outside this session is editing code and
instructed continuation after the temporary ownership pause. Main reconciled
the stage rows against actual artifacts and tool results, keeping all files.
Only main writes this log and the main checkout. Worker changes stay in their
assigned worktree paths. A dispatch failure or pause is not a corrective round.

### Early coordination-document review

`gpt-5.6-sol` / `xhigh` reviewed the main plan, spec, execution log and checklist
QA-01 note. No actionable findings: the correction rounds, issue branches,
Mac deferral and limits of the existing evidence are consistent. The reviewer
also ran `node --test scripts/governance.test.mjs`: 15/15 passed. This is a
review of the execution documents only; it does not approve worker code or
count as a corrective round. Worker implementation review remains pending.

### Artifact reviews and round reconciliation

Astra medium completed full DOC-001a and DOC-005 reviews with tools and no
transport failure. The DOC-001a review accepted six actionable findings: revoked
read access, draft durability before teardown, a guarded conflict-resolution
commit, preserving the upload cap independently of Q9, context-scoped shortcuts,
and accurate ADR draft-index wording. Terra produced `ffadd9a7`; Astra is now
re-reviewing that immutable correction. A premature in-session log assertion of
independent acceptance has been corrected here; the patches are preserved.

DOC-005 workers produced commits through `f9fc40e6` and reported their own
rounds 1-4. Main had assigned only one corrective round following the bounded
GPT-5.5 text review; no independent reviews separated those commits. They are
one corrective submission for the user-approved loop. Astra's full review found
ten unresolved issues: draft content exposed after revoke; plaintext/non-atomic
draft storage; conversion permission elevation; overwritten unresolved bases;
unscoped feed; missing ACL-transition events; resync pagination expiring itself;
nonstandard PKCE and missing state binding; literal values presented as observed
fault evidence; and model-only checks described as executing Go behavior.
Main accepts these findings and is verifying the next worker's exact assignment
before correction round 2. Prior DOC-005/fixture writers were stopped to avoid
overlapping writes. No artifact acceptance follows from worker push/completion.

## Environment evidence

- Original GenOffice checkout remains read-only at
  `09485f884dc845cf3bf27fb7edfe489f9d457aad`.
- Workspace Node `22.23.2` and pnpm `10.28.2` are available. Global Node 25 is
  not the intended runtime for repeatable checks.
- The local `../.uniwork-dev/office-g0/environment.ps1` composes Node/pnpm,
  Rust/Cargo, Make, the Python launcher and workspace cache settings. Source
  this file in PowerShell before lab commands; it does not change cwd.
- Chrome and Edge are installed on the Windows host; MSVC Build Tools 2022
  is available.
- Rust `1.98.1` and GNU Make `4.4.1` were prepared under
  `.uniwork-dev/office-g0/toolchains/`; caches and temporary output stay
  within the authorized workspace. A local Python launcher uses the
  already installed Python 3.12.14 for the repository commit hook.
- QA-01 / UNI-671 is explicitly deferred to backlog by the user: the team
  will run actual macOS Chrome/Edge/Safari checks on its Mac devices. This
  does not block development and is not a passing platform result.
- The disposable bootstrap snapshot installed 1051 packages with Node 22 via
  `npm ci --ignore-scripts --no-audit --no-fund`. Lifecycle scripts and the
  Electron binary were skipped. The locked Sheets Rust sidecar release build
  passed with Rust 1.98.1/MSVC in 6m 53s. These are build prerequisites, not
  editor fidelity or source-closure acceptance.

## Verification ledger

| Scope | Command or check | Result |
| --- | --- | --- |
| Existing repository baseline | `node --test scripts/governance.test.mjs` | 15 passed, 0 failed |
| Existing repository baseline | `pnpm typecheck` under Node 22 | 4 package tasks passed from cache; the full check separately reran them |
| Existing repository baseline | `make check` typecheck/lint stages | Typecheck reran and passed all 4 tasks. Lint reports existing `jsx-a11y/no-noninteractive-element-interactions` at `packages/views/tasks/detail/components/thread-nav-panel.test.tsx:82`; fast gate reports it without stopping |
| Existing repository baseline | `make check` under Node 22 and workspace Make | Failed before G0 integration: Views had 272 passing files / 1 failing file and 1741 passing tests / 1 failing test. `tasks/surface/task-surface.test.tsx:642` exceeded 30000 ms in the realtime-refetch/load-more case. Core and UI tasks passed; Go and later stages were not reached |
| Existing repository baseline follow-up | `pnpm --filter @uniwork/views exec vitest run tasks/surface/task-surface.test.tsx -t 'a load more clicked while a realtime refetch runs asks for the next page once the refetch lands'` | The isolated rerun passed (1 test, 25 skipped, 21.10s total / 7.78s test). This does not turn the failed full run into a pass; load sensitivity remains unproven |
| Upstream PDF unit baseline in bootstrap snapshot | From `apps/pdf`, Node 22: `node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2` | 758 passed / 1 failed across 47 files. `tests/generated-output.test.ts:20` reproduces Windows drive-prefix handling: suggested `a:b?.pdf` becomes `b_.pdf`, expected `a_b_.pdf`. jsdom canvas warnings are not browser render evidence. An earlier accidental Node 25 run showed the same failure; the Node 22 run is the recorded baseline |
| Upstream XLSX preservation baseline in bootstrap snapshot | From `apps/sheets`, Node 22: `node ../../node_modules/tsx/dist/cli.mjs scripts/generate-fixtures.ts`, then `node ../../node_modules/tsx/dist/cli.mjs scripts/verify-compatibility.ts` | 5/5 fixture cases passed. Only the intended worksheet entry changed; no unexpected changed or removed archive entries. This checks the upstream gateway, not browser editing or formula recalculation |
| Upstream Sheets native engine baseline | From `apps/sheets`: `cargo test --release --locked --manifest-path native/xlsx-engine/Cargo.toml --config native/xlsx-engine/.cargo/config.toml` with workspace Rust/Cargo homes | 187 library tests and 6 binary protocol tests passed; 0 failures. Includes native recalculation/cache and cancellation tests, not the integrated browser save/reopen flow |
| Upstream renderer build baseline | From each `apps/{docs,sheets,slides,pdf,markdown,html}` under Node 22: `node ../../node_modules/vite/bin/vite.js build --config vite.renderer.config.ts --outDir ../../../../renderer-builds/<app>` (the last three builds used `--logLevel warn`) | All six builds passed. Output is in the bootstrap snapshot's `renderer-builds/`. Large-chunk warnings remain; Sheets main JS is 10694.81 kB before gzip / 3008.79 kB gzip. Build success does not supply a browser host adapter or prove the save/reopen flows |
| Upstream TypeScript baseline | From each `apps/{docs,sheets,slides,pdf,markdown,html}` under Node 22: `node ../../node_modules/typescript/bin/tsc --noEmit` | All six app typechecks passed against the pinned upstream lockfile. This does not test coexisting with UniWork's React/TipTap catalog or validate the future adapters |

G0-specific runtime, fidelity, source-manifest and protocol results will be
recorded after their implementations run. No row above certifies a browser
editor, production permission boundary or synchronization flow.

### Worker artifacts under local verification

These rows come from worker worktrees and were rerun by main; they certify the
artifact, not the product.

| Scope | Command or check | Result |
| --- | --- | --- |
| DOC-005 reference protocol harness (UNI-669 worktree) | Node 22: `node scripts/office-g0/run-contracts.mjs` | 16/16 fault cases match the literal contract oracle. Draft persistence writes one file per account under the harness directory; authorization is labeled a model and there is no HTTP server, product auth or engine |
| DOC-005 harness self-tests (UNI-669 worktree) | Node 22: `node --test scripts/office-g0/run-contracts.test.mjs` | 9 passed / 0 failed in 0.46s, covering mandatory-case completeness, oracle agreement, real filesystem draft survival across a fresh model, discard-only removal and error-class shape |
| DOC-005 after correction round 1 (UNI-669 worktree, `bb420c9d`) | Node 22: `node scripts/office-g0/run-contracts.mjs --print` and `node --test scripts/office-g0/run-contracts.test.mjs` | 21/21 fault cases and 11/11 self-tests pass. The five added cases cover a feed cursor advancing past unreadable events, a tombstone not leaking to a non-reader, a conversion copy keeping its creator's access, draft recovery comparing `baseVersion`, and draft APIs requiring a session; prior 16 cases still pass unchanged |
| DOC-005 new-case mutation check (main, throwaway copies under `.uniwork-dev/office-g0/mutants/`) | Node 22, reverting one fix per copy and running the harness | Every revert exits 1: cursor revert fails `feed-cursor-advances-past-unreadable` (20/21); tombstone revert fails `tombstone-not-leaked-to-non-reader` (20/21); copy revert fails `copy-keeps-creator-access` (20/21); base-version revert fails `recovery-checks-base-version` (20/21); draft-session revert fails 8 cases including `draft-apis-require-matching-session` (13/21). Each new property therefore depends on its fix. These copies live outside the repo and are not committed |
| DOC-005 rounds 2-3 (UNI-669 worktree, `1a2a30ce` and `e9d05ada`) | Node 22: harness and self-tests, then mutation copies under `.uniwork-dev/office-g0/mutants-r2` and `mutants-r3` | 24/24 fault cases and 12/12 self-tests pass. Round 2 closes an upload committed by another editor and a spent upload replayed under a new key. Round 3 closes a replay that returned version metadata after permission was revoked, a ledger key without document scope, and a conversion copy that bypassed quota. Each fix reverts to a failing case in its mutation copy |

### Supplemental checks and review blocker

- The separately resumed Go gate completed with exit code 0 after migration,
  loading `.env` and `scripts/local-env.sh` as the repository check does, then
  running `bash scripts/test-go.sh --race`. The service package passed in
  1267.694s (67.5% coverage). The script skipped the race detector because no
  compatible C compiler was available; this is a passing non-race Go run,
  not a passing race run or a passing full `make check`.
- Main's additional DOC-005 probes found inaccessible events can stall feed
  pagination, deleted document IDs can escape ACL filtering, a converted
  normal Document lacks creator access, recovery ignores `baseVersion`,
  draft reads remain available after logout, and `not_found` is absent from
  the declared error-code set. Existing green harness cases do not establish
  these properties. Draft protection and tenant scope also need review.

### DOC-005 corrective round 1 (assigned to the Terra worker)

Main adjudicated its own probes into eight findings and assigned them to the
UNI-669 worker as corrective round 1, with a required new fault case per
finding and a rerun of both commands.

| Finding | Severity | Substance |
| --- | --- | --- |
| F1 | major | `readChanges` filters by permission after `slice(0, limit)`, so a page of inaccessible events barely advances `nextCursor` and the client can loop |
| F2 | major | The tombstone branch returns before the ACL check, so account B can see account A's `deleted` event |
| F3 | major | A document produced by the Q7-B conversion copy has no permission for its creator, so the flow locks out the user who ran it |
| F4 | major | `recoverDraft` compares only `baseRevision` and ignores the stored `baseVersion`, so a draft on a moved base version is reported as a safe recovery |
| F5 | major | `listDrafts(accountId)` needs no session, so draft reads stay available after logout, contrary to Q8-A |
| F6 | major | resolved: `not_found` is now present in `ERROR_CODES` (`declaredCodes` read back from the current harness includes it). The probe helper `versionsOf` still returns 0 for an unknown id rather than raising, which is a test-helper shape, not a protocol path |
| F7 | minor | `Qupload_id` / ```sourceDocumentId` lost their opening backticks in the contract document |
| F8 | minor | Three scratch files outside the worktree (`.uniwork-dev/office-g0/tmp-review-doc005/`) are not issue artifacts; recorded only |

- F7 is fixed in `facd84a1` (`docs(office): fix broken inline code in DOC-005 contract`),
  which reports the harness rerun as 16/16 fault cases and 9/9 self-tests.
- F1-F5 are closed by `bb420c9d` + `ebbdc32f` (round 1), `1a2a30ce` (round 2) and
  `e9d05ada` (round 3): each has a case whose literal oracle fails when its fix is
  reverted in a throwaway copy. F6 was already fixed in the harness. The artifact
  is still unaccepted as a whole and no checkbox is claimed.
- Further memory-only probes against DOC-005 commit
  `64b7cbda73660642207f81fd23560223407f2621` showed a second editor can commit
  another actor's upload, a consumed upload can create another version with
  a new key, a replay still returns version metadata after ACL revocation,
  a key reused in another workspace incorrectly conflicts, and conversion
  succeeds with quota set to zero. These are reference-model defects, not
  demonstrated production-service vulnerabilities.
- Workers committed and pushed DOC-001a as
  `eb843df181ee7636fdc15a2e15b3fdb2cbcc2eb4` and DOC-005 as
  `64b7cbda73660642207f81fd23560223407f2621`. Both remain unaccepted by main;
  no completed artifact review, PR or merge is inferred from a worker's
  completion report. Main has retained sole integration/tracking ownership.
- Sol artifact review attempts failed with `Encrypted function output
  content could not be decrypted or decoded`. Initial failures followed
  `functions.exec` / `tools.exec_command` reads (`Get-Content`, `git diff`).
  A subsequent `fork_turns: none` reviewer supplied with excerpts and told
  to use no tools failed with the same error. The cause is unproven; no
  PowerShell/Git failure or successful artifact review is inferred. These
  infrastructure failures do not consume corrective review rounds.
- The same decoding failure hit every later Sol reviewer spawn (three attempts,
  including one told to use no tools), so no independent artifact review has
  completed for DOC-005. Main therefore ran the corrective rounds itself, kept
  every finding anchored to a reproduced command, and mutation-tested each new
  case rather than asserting it is meaningful. Review-loop accounting should
  treat these as main-rounds, not worker or reviewer rounds.

### DOC-001a corrective round 1 (worker, reviewed by main)

Astra medium reviewed the frozen four-file diff of `edd0b4ba` against
`97b4fa59` and reported six findings (five P1/P2 plus one P3 documentation
inconsistency) with no tool-transport failures. The Terra worker applied them in
`ffadd9a7`; main then inspected the diff itself rather than trusting the report.

| Finding | Severity | Substance and correction |
| --- | --- | --- |
| F1 | P1 | The state map routed every permission revocation into `readonly`, whose contract allowed viewing and downloading, so losing read access still prescribed in-app content. `readonly` now means lost edit rights only; a separate `revoked` state locks view/download/export/recovery, keeps the Q8 draft protected but closed, and re-checks rights before unlocking. `dirty`, `saving` and `recovery` now have transitions into both states |
| F2 | P2 | Exit handling relied on `beforeunload` plus `keepalive` to guarantee the binary draft. The spec now requires durable draft/data/asset capture during editing and before controlled close/logout, demotes `beforeunload`/`keepalive` to a bounded best-effort final request (~64 KiB, not guaranteed), and requires blocking or confirming controlled navigation when the latest edits are not durably captured |
| F3 | P2 | "Keep mine" saved a new version without defining the approved base, so an intervening save could be overwritten or the commit could conflict again. The dialog now loads and shows the current server base, takes explicit confirmation, commits against that expected base and current rights, and returns to `conflict` keeping both versions if another save lands; protocol detail stays in DOC-005 |
| F4 | P2 | R-09 listed C-01's 50 MiB cap as an old requirement to replace with a measurement range. R-09 now keeps the existing upload cap/quota, separates it from the <50 MiB Q9-A measurement baseline and the measured engine limits, and matches §9.1 |
| F5 | P2 | `/` and `@` were mandatory in every state and editor, including source editors and spreadsheets where they are literal characters. The spec now scopes both triggers to supported rich-text contexts, keeps them literal in source/formula/path inputs, and defines host-aware Ctrl/Cmd shortcuts disabled by permission and state |
| F6 | P3 | The handoff claimed the ADR index was unchanged although 1a edits `docs/adr/README.md`. Both the spec and the ADR draft now distinguish the 1a draft reference line from the numbered accepted ADR belonging to 1b.1 |

- Main re-ran `. ../.uniwork-dev/office-g0/environment.ps1; node --test
  scripts/governance.test.mjs` on Node 22.23.2 in the UNI-665 worktree:
  **15 passed / 0 failed**, and `git diff --check` is clean.
- Main read the full `ffadd9a7` diff and verified each finding against the
  authoritative Q8-A and Q9-A decisions. All six are addressed; no other line in
  the four DOC-001a files changed beyond these corrections.
- `ffadd9a7` is local only: not pushed, no PR, ADR 0018 untouched, no ADR number
  assigned, and **no checkbox ticked**. The 1b half of DOC-001 still awaits
  DOC-003/004 runtime and protocol evidence.

### Review reconciliation and DOC-001a acceptance (2026-09-17)

The user selected Terra xhigh text-only proposals, main as the sole filesystem
writer, and Astra medium as artifact reviewer. Earlier worker commits remain
preserved. Their self-numbered DOC-005 rounds above are historical labels, not
independently reviewed correction rounds: the combined earlier submission is
round 1; the correction following Astra's full review is round 2. Tool-transport
failures do not consume a round. Passing model tests alone do not establish
product acceptance or close findings that their oracles did not cover.

Astra's final DOC-001a check accepted `ffadd9a7` plus the one-line R-09 correction
applied by main: the upload cap is <=50 MiB **per file**, while `storage.bytes`
remains the existing separate storage quota. This resolves all six original
documentation findings and the residual quota wording finding. `git diff --check`
passed; unchanged governance evidence remains 15/15. Main accepts **1a only**.
DOC-001b still depends on runtime/protocol evidence; no ADR acceptance, G0
completion, PR, merge or additional push is inferred.

DOC-002 and DOC-005 remain under correction. Astra found source-preparation,
fixture/inventory, protected-draft, scoped-feed, PKCE and evidence-oracle gaps
that existing passing tests did not establish. The earlier execution rows are
historical runs, not claims that these artifacts now satisfy their contracts.

Main then copied the four reviewed DOC-001a artifacts into the integration
checkout, verified each SHA-256 against the reviewed copy, and ran Node 22
governance again: **15 passed / 0 failed**; `git diff --check` passed. Task 1a's
five checkboxes now reflect this bounded acceptance.

### Terra delivery failure and unaccepted draft-store proposal

The missing brief also affected clean-context Terra workers: their delivered
model input did not contain the collaboration `NEW_TASK` payload, and follow-up
corrections were not visible. A local `worker-assignments.md` fallback allowed one
worker to deliver text, but did not reliably convey the requested next revision.
All Terra workers were interrupted. An inherited-context diagnostic worker
mistook itself for main and committed the already reviewed one-line R-09 change
as `69c6963a64bd462c6126f7e1a43aea1d551b2bf9`, disabling hooks for that commit.
The commit is retained; no additional push or PR is authorized or claimed.
Its content is the same correction reviewed and copied by main.

Main applied the returned `draft-store.mjs` and `draft-store.test.mjs` text in
the UNI-669 worktree as an **unaccepted, unintegrated** proposal. Node 22
`node --test scripts/office-g0/draft-store.test.mjs`: **8 passed / 1 failed**.
Changing the encryption key changes the lookup filename, so the wrong-key test
returns an empty draft set rather than detecting unreadable existing data.
Astra independently also reproduced nested-reference mutation in memory mode
and a file-fsync failure that leaves a staging file; directory-sync failures
are all swallowed despite the durability claim. These findings remain open.
This proposal does not close the earlier DOC-005 draft findings.

Main asked the user whether to continue with main implementation plus Astra
review, Astra workers plus a separate Astra reviewer, or retain Terra while
pausing dependent implementation. This is a pending workflow decision; no
model-role change is assumed from elapsed time. Actual Mac/Safari QA stays in
UNI-671 backlog, and G0 remains incomplete.

### Orca dispatch and Cursor review (2026-09-17)

The user resumed implementation with Terra xhigh workers and Cursor strictly
as reviewer through Orca orchestration; main adjudicates findings and sends
implementation directions back to Terra. This supersedes the earlier reviewer
fix role. Patch text remains the worker delivery format; main applies it.

Orca 1.4.204 reports runtime ready. Run `run_ff8d3bd5eeb4` is bound to main
terminal `term_5a8e6174-f98c-426e-b226-3c4129af0b7c`. Terra dispatches
`ctx_3be77844f3a0` (draft store), `ctx_ad419ad77c77` (pinned source preparation),
`ctx_04b13d228015` (protocol) and `ctx_550bdf59e517` (fixtures) report effective
model `gpt-5.6-terra`, effort `xhigh`, and observed turn start. The draft worker
sent a matching brief acknowledgement. Cursor dispatch `ctx_c86699f8cf28`
acknowledged review-only DOC-003 baseline inspection in the Run inbox.
Dispatch creation and acknowledgement are delivery evidence, not code acceptance.

The current tool set has no Codex task-messaging connector, so the next UniAI
coordinator note cannot yet be sent through the required channel. Previously
confirmed UNI-665/666/667/669 scopes remain in progress; no tracker write or
status change is inferred from local Orca state.

Cursor completed DOC-003 baseline review `ctx_c86699f8cf28` and API follow-up
`ctx_7025a40f4fb5`. Main verified the five baseline file hashes against the
first report. The current browser spike is unaccepted: global preload mocks,
PDF request/byte-shape errors, missing Sheets/Slides paths, unused session
grants and absent browser oracles remain. The second review corrected its own
PPTX operation field (`op`, not `name`), PDF apply/verify sequencing and XLSX
sidecar/gateway mapping. Main accepts these API corrections but rejects the
suggestion to remove existing-image PDF proof from final DOC-003 acceptance;
text can land first while the image requirement remains open.

Terra renderer-host `ctx_78c6f3f54720` and engine-host `ctx_a569a7e5cd83` now
own separate patch proposals, with effective model/effort confirmed. Cursor's
pre-existing terminal is retained by Orca as external and can be reused for
review of applied changes. No passing engine/browser result is inferred.

The protocol launch initially had an accepted prompt but no provider transcript;
terminal inspection found the dispatched text still in the input buffer. Main
submitted that same buffer with bare Enter, and the worker then sent matching
`BRIEF_ACK UNI-669 PROTOCOL_PATCH`. The earlier blanket turn-start statement is
therefore insufficient evidence of actual protocol work before this ACK.

After the user opened the existing UniAI coordinator in Orca, main found
terminal `term_00f151fc-303b-45ec-836a-b278ee9bcdb3` with the prior note:28
tracking transcript. Main sent the complete pending note:29 request there,
requiring coordinator thread-ID verification before tracking writes. Receipt
`4639715d-8fbb-4552-b7b9-d3c8fd8cd768` confirms input accepted and turn started;
the matching UniAI result is pending. This replaces the manual relay need,
but is not yet proof that the issue comment was written.

Coordinator subsequently returned matching `UNIAI_RESULT` for note:29, with
comment `fd20d09b-e6f7-4cd2-96e7-7b31ae4c4735`. Main independently read the
comment through `uniai issue comment list UNI-656 --recent 5 --output json`.
UNI-656/665/666/667/669 remain in progress; UNI-668/670 remain todo; UNI-671
remains backlog. A separate start:30 request for UNI-668 has been submitted
and is awaiting its own result; no DOC-004 edits follow from note:29 alone.

Main's Node 22 PDF probe now has independent pdf.js extraction before and
after upstream `validateTextEdits` / `applyTextEdits` / `verifyTextEdits`.
`editable text line` becomes `UniWork Office saved text`; the old line is
absent, the heading and second page survive, and the input file hash is
unchanged. The reproducible probe and result are in the lab as
`main-pdf-text-probe.mjs` and `main-pdf-text-probe.json`. This is in-memory
upstream-engine evidence only: no saved-output/browser/image/render proof.

Main inspected and applied `terra-draft-store.patch` (two files, 34,899 bytes)
to UNI-669 after `git apply --check` passed. Node 22
`node --test scripts/office-g0/draft-store.test.mjs` now passes **14/14**;
test temp files are under the workspace lab. Cursor review
`ctx_f4086f606ad4` checks this applied candidate. The draft store is not yet
accepted or integrated into the protocol model; passing tests alone do not
close the review.

Coordinator returned matching `UNIAI_RESULT` for start:30. Main read UNI-668
as `in_progress`, with evidence comment
`2f268811-2004-4594-8e38-edbf81d5ab37`, and created
`feature/UNI-668-office-engine-contracts` from local `develop`
`97b4fa5946fc2ccb208d626de45a13dd0805d546`. The checkout is inside
`.uniwork-dev/worktrees/UNI-668-office-engine-contracts`. The Orca CLI has no
explicit worktree destination flag and its default placement is outside the
authorized workspace, so main used Git for this workspace-local checkout;
the worker is supervised through Orca in the existing registered workspace.
Terra dispatch `ctx_964288b770f8` reports effective `gpt-5.6-terra` xhigh.

Cursor draft review r1 completed. Main matched both file hashes to the
reviewed bytes and accepted the IO-absence and unreadable-overwrite defects,
plus directory validation/reporting and memory-guarantee corrections. Main
rejected the suggested overwrite-unreadable bypass and key-wipe oracle:
unreadable drafts must remain intact, and a newly invalid provider key must
fail rather than be hidden by indefinite caching. Terra repair
`ctx_2821c37c9d5f` has acknowledged the new brief; main will apply its
incremental patch and validate it before another Cursor review. The existing
14 passing tests do not resolve these findings. Cursor remains review-only.

The designated UniAI coordinator is reachable through its user-opened Orca
terminal. Main submitted progress note:31 with these facts; delivery reports
input accepted and turn started. Its matching tracking result is pending.

Coordinator returned note:31 with evidence comment
`adf38b86-1f54-4476-93f1-5bbba2259dd9`; main independently read it from
UNI-656. Status stays `in_progress`. Node 22 Playwright launch probes passed
for installed Chrome `153.0.8010.48` and Edge `153.0.4234.32` on Windows,
recorded in `main-browser-readiness.json`. This proves the test browsers can
launch, not that any editor flow passes.

Main applied Terra draft-store r2 (35,903-byte incremental patch) after a
successful `git apply --check`. Node 22
`node --test scripts/office-g0/draft-store.test.mjs` passes **25/25**, with
workspace-local temp files. Cursor re-review `ctx_5637da11806e` confirms
H1/H2 and the related behavior fixes on unchanged start/end hashes:
`A2516425BFA085B71D8685338E28A2E1179DCA9B55EEEDC6EE0B357043093283`
and `06A528582EE2F89AFC4DCD405045CD7986152D19E29C91886AB1CAE06409F6F7`.
Main accepts this private byte-store slice. One non-blocking key-snapshot
comment correction is requested from Terra; protocol/ACL integration remains
pending, so this is not Q8 or DOC-005 completion. The settled draft worker was
released; Cursor is retained by Orca as the user's external terminal.

Coordinator returned start:32 for UNI-670 with evidence comment
`2e4c9cf7-0442-4366-b874-6fb103dbc513`. Main verified `in_progress`, created
`feature/UNI-670-office-evidence-handoff` from the same local `develop` under
the workspace worktrees directory, and dispatched Terra `ctx_5ad4c04f0bd8`
(effective `gpt-5.6-terra` xhigh) to propose the evidence verifier and handoff
scaffold. Missing or lower-level evidence must not be promoted to a passing
editor/adapter gate; no-go reporting and go acceptance stay distinct.

After the plan workflow update, main reran
`node --test scripts/governance.test.mjs`: **15/15 passed**. The original
GenOffice checkout remains clean on `git status --porcelain=v1`.

The user routes UI reviews to their existing Claude Code terminal in Orca;
main verified its agent identity and workspace. Non-UI reviews remain with
Cursor. Terra xhigh still proposes patch text, main applies and tests, and
both reviewers return findings without changing implementation files.
Main dispatched UI acceptance review `ctx_34c678435316` to that exact terminal;
Orca observed turn start, but the provider ended with `401 Invalid API key`
and `Please run /login` before reviewing. Main fenced the failed attempt and
preserved the user's terminal for login. No UI findings or pass are claimed;
the UI review waits for provider authentication. Renderer delivery and other
implementation tasks continue. Coordinator note:34 was independently read as
comment `2b862fe3-53b4-479f-baf2-98a25a28a4f0` on UNI-656; the authentication
failure happened after that note and requires a later tracking update.

Coordinator note:35 recorded the provider failure on UNI-667 as comment
`98307128-54ab-4876-b1fd-db69d33c73ec`, independently read by main. The user
then requested a retry. Main reused the same Claude terminal for the same
Task with new Dispatch `ctx_91f2d61994b8`; turn start, valid heartbeats and
successful source-read tool results now prove review is running. This retry
is not a completed UI review and does not add a code-repair round.

Main resolved a DOC-002 fixture prerequisite independently: the pinned
upstream `Carlito GO` font includes all 130 Vietnamese characters checked by
`main-vietnamese-font-probe.mjs`. Main extracted the font and OFL licence
from the pinned Git commit, generated a 21,557-byte PDF using lab-only pinned
dependencies, then reopened the persisted bytes with PDF.js and system fonts
disabled. All expected text lines match exactly. The lab JSON records hashes
and provenance; this proves fixture generation and independent extraction,
not visual shaping, editor changes or browser compatibility. Terra's fixture
worker received the font locations, dependency path and observed result.

Visual inspection then rejected the subset-font PDF: extraction was correct
but many visible glyphs were missing. A controlled comparison changing only
`embedFont(..., { subset: false })` produced a 285,747-byte PDF whose text
extraction and inspected render both contain the sample. Both variants and
hashes remain in the lab; `main-vietnamese-font-render-review.md` records the
limit. Main instructed the fixture worker to use the full-font variant.

Claude settled its source-only baseline review with `worker_done` at
2026-09-17T04:03:32Z. Main accepted the evidenced UI-path defects and kept
six-format acceptance open. Some recommendations conflicted with the agreed
CSP, server-issued grants, preview identity and scope; main's authoritative
`main-ui-review-directions-r1.md` corrects them and was sent to Terra workers.
No current Terra implementation candidate is certified by that baseline
review. Orca retained the user's Claude terminal after lifecycle release.
Coordinator note:36 records this in UNI-656 comment
`b2524ae8-fad8-4ee8-91cd-b90b9e7db8df`, independently read by main.

Main's source-prep preflight rejected the draft patch before running its
tests: mismatched old/new diff headers, predictable temporary-directory
deletion and edits overlapping the fixture test owner. Static inspection also
found a `--force` bypass allowing unmanaged-target replacement. Main sent
concrete corrective directions to Terra; the source-prep candidate is not
applied or accepted. Original GenOffice remains clean.

Main integrated the accepted DOC-005 private byte-store slice into
`dev-uniwork/scripts/office-g0/`: `draft-store.mjs` and its test. Source and
destination SHA-256 values match the exact Cursor r2 review and earlier
Node 22 run (25 passed, zero failed). Those unchanged-file results are reused;
protocol wiring, product rights checks and Q8 acceptance remain pending.
The plan now names Claude UI review and Cursor non-UI review in its opening
instructions as well as its current-workflow section. Main reran
`node --test scripts/governance.test.mjs` with the pinned environment: 15/15.

The additional Terra browser-cycle worker is `ctx_3a40dedf160b`, Task
`task_6ac4eceb68da`, under UNI-667. Main found its original prompt still in
the composer and submitted that existing text with one bare Enter; subsequent
provider tool calls confirm the turn started. No duplicate Task was created.
The lab-server worker resumed tool calls after a provider reconnect. Both
implementations remain pending, as do the other current Terra patch reports.

Coordinator note:37 is confirmed on UNI-656 as comment
`c2501595-d7da-4a37-a389-37ec2c1e6c98`, read back by main. Renderer subsequently
delivered its concrete host-channel map; main preserved it as
`renderer-host-channel-map-r1.md` in the lab and forwarded it to the engine,
server and browser-cycle workers. This describes the interface, not a run.

Terra delivered the DOC-006 candidate with `worker_done` at
2026-09-17T04:33:50Z. Main froze `main-evidence-candidate-r1.patch` (96545 bytes,
SHA-256 `75F2B2DA82C5654FD093484B0731C6798496B2723462A6F196465681BBF8EDBE`)
and applied its four files in the UNI-670 worktree. Main Node22 tests passed
22/22; CLI returned valid=true, go=false, INCOMPLETE with eight pending gates;
`--require-go` exited 1. The candidate is not integrated into main.

Main's additional synthetic probe (`main-evidence-r1-probe.mjs`) found false
GO: Chrome-only rows without per-case fault evidence, and all six core rows
retargeted to DOCX, still satisfied eight gates. A second variant showed G0
readiness incorrectly depends on full pilot capability counts. These are
validator probes, not browser or engine evidence. Cursor review
`cursor-evidence-review-r1.md` confirmed four blocking defects and two smaller
bugs. Main rejected r1 as an acceptance gate and dispatched Terra repair r2
`ctx_911104437d29`, Task `task_1587a8a1bc01`, effective Terra xhigh with observed
turn start. Main directions also reject prose/path-prefix heuristics as proof
of a real edit and require structured artifact/operation assertions. The old
Terra worker was released; Cursor remains the user's retained external terminal.

Claude's host-map review settled at 2026-09-17T04:56:37Z, Task
`task_34a54424638d`, Dispatch `ctx_26a25622961a`. Its report
`claude-host-map-review-r2.md` is source-only and rejects the delivered map as
sufficient for the six-format UI cycle. Main checked decisive upstream APIs
and recorded accepted corrections and rejected recommendations in
`main-ui-review-directions-r2.md`. Scoped messages went to the existing
renderer, engine, lab-server and browser workers. In particular, docs
`consumeHeadlessExport` runs at mount and must return the documented empty
queue result; the review's user-action-only assumption was incorrect.
Main preserved custom transport encoding where it converts to the actual
renderer contract, and rejected swallowing send failures or adding preview
privileges for tests. The Claude terminal remains external and retained after
lifecycle release; delivery `delivery_28381665ff7b` was processed and acked.

Main normalized the source-prep patch metadata, froze
`main-source-prep-candidate-r2.patch` (105222 bytes, SHA-256
`D9ED5B4EDDD9AAEFCA10195A4B1727E07B7FBCBA201AB67309CD6590741BC6A1`),
and applied it only in the UNI-666 worktree after `git apply --check` passed.
Official Node 22 tests of `prepare-source.test.mjs` and `manifest.test.mjs`
reported 61 total, 50 passed, 7 failed and 4 skipped. All 28 manifest tests
passed; six preparation tests call an undefined `scratchDir`, and one lacks
the `inspectSource` import. Main requested a bounded incremental correction
from the existing source worker. This candidate is not integrated or accepted,
and real extraction has not been verified. Coordinator note:39 is confirmed on
UNI-656 as comment `006f6d1d-a564-4a0e-adb2-e18bd96cbb33`, independently read by
main. Cursor is reviewing the frozen source candidate with Task
`task_31385257a6b8`, Dispatch `ctx_f5f65681f95f`; the known missing test helpers
are disclosed and the applied files remain frozen during that review.

Cursor source-prep review settled at 2026-09-17T05:11:41Z with unchanged
candidate hashes. Main's `main-source-prep-review-directions-r1.md` accepts the
README recipe correction, excluded-set glob/audit enforcement and regular-file
marker validation, while retaining intentional dry-run failure on an unusable
target and strict rejection of Git links at this pin. The external Cursor
terminal remains retained after lifecycle release. Terra's small missing-helper
repair and the subsequent safety round remain pending.

Main then completed actual preparation and managed rebuild in the fresh
`main-source-verify-r1/trial-source` lab directory. Pinned Node22 dry-run,
extraction and replacement each exited 0: 3123 files, 59174070 bytes, 6 excluded.
Main independently compared every extracted file's Git blob ID against the
pinned tree and checked lengths/SHA256, then compared the rebuilt file records
and reread the persisted output. All comparisons matched; the upstream checkout
stayed clean and the original unmanaged trial-source was preserved. Evidence
`main-source-verification-r1.json` records this narrower success; the candidate
still needs its pending safety and test fixes before integration.

An additional main Windows probe created a directory junction entirely within
workspace TEMP, `dev-uniwork/.go-tmp/office-source-boundary-Q7WoYJ`. It proved
that a junction at the configured lab root can make `checkDestination` accept
an output outside the simulated workspace because both lab paths resolve to the
same external location. No extraction or deletion occurred in this probe. The
next Terra repair must enforce the authorized workspace boundary and test
directory junctions independently of unavailable file symlinks. Coordinator
note:40 is confirmed on UNI-666 as comment
`7daf1e09-81a0-4516-bf50-f92b5c38ebba`, independently read by main.

Main received the two-hunk test repair artifact from Terra, reviewed and froze
it as `main-source-prep-repair-r1.patch` (1427 bytes, SHA-256
`4B90EA5DE2C8A0B7376275863EC71A2B238E9B0005B5DB70F8B55CF3BB46A92D`),
then applied it only in the UNI-666 worktree. Official Node22 rerun of the same
two suites now reports 61 total, 57 passed, zero failed and four skipped in
20.3 seconds. The applied test hash is
`0A779917F2F1CDFC71DBF0A8C77262F02A961E616722B83079705965FE05552A`.
The old source worker's final report remains pending. Next bounded safety
repair Task `task_ce62d377ccd0` has been created with that worker Task as its
dependency; it has not been dispatched yet. No source candidate is integrated
into main or accepted from the passing helper repair alone.

Source worker `ctx_ad419ad77c77` settled at 2026-09-17T05:33:27Z with the
bounded repair and report; main released its owned terminal and acknowledged
the delivery. The safety repair Task is now Dispatch `ctx_c6d35716e861` on a
fresh Terra terminal. Orca confirms effective `gpt-5.6-terra` / `xhigh`, observed
turn start and `BRIEF_ACK SOURCE_PREP_R2 PATCH_ONLY`. It proposes changes only;
main still applies and tests. Coordinator note:41 is confirmed on UNI-656 as
comment `56a29806-be6e-4b48-9928-955f42c5334b`, independently read by main.

Main's protocol proposal preflight found generated `.go-tmp` output and scratch
chunks/probes in the worker's initial diff. Main requested removal of those diff
sections while preserving the actual files; the current proposal headers now
start with the authorized contract/modules. The protocol candidate is not yet
delivered, applied or accepted. The accepted draft-store hashes remain unchanged;
`git diff --check` in UNI-666/UNI-669 exits 0 with a CRLF warning only. The engine
contract candidate is also awaiting final delivery before main verification and
Cursor review. No new commit, push, PR, merge or issue completion occurred.

Main froze the 13-file protocol proposal as `main-protocol-candidate-r1.patch`
(255217 bytes, SHA-256
`EA0EA66B87CA53024111297BF75AA0D19B7F0F8FC4417D306F052DE17567064A`),
passed `git apply --check` and applied only in the UNI-669 worktree. Official
Node22 tests of the harness, PKCE, redirect, auth model and change feed report
50 passed, zero failed or skipped. Contract and legacy-model CLI runs each
report 39/39 cases, exit 0; the latter is a JS model comparison, not a run of
Go `BeginIdempotent`. The candidate imports a duplicate `test-draft-store.mjs`
instead of the accepted real byte store. Main requires real-store wiring and
accurate integration evidence before acceptance, while keeping auth modeled.
Cursor review Task `task_32370fda90af`, Dispatch `ctx_6886d2d97018`, now targets
the frozen candidate. The known store gap is disclosed. No protocol candidate
has been integrated into the main branch. Coordinator note:42 is confirmed on
UNI-669 as comment `d3387772-0fe3-4fa1-82db-86aeb82cd50a`, read back by main.
Cursor's BRIEF_ACK confirms consumption of the review scope.

Main's `main-protocol-probe-r1.mjs` injects the accepted real store, writes a
draft and recovers its exact payload through a fresh model/store instance.
The same probe independently reproduces cross-workspace draft deletion through
both `fromDraftId` commit cleanup and `discardDraft`, plus a local cleanup EIO
thrown after the model head advances to revision/version 2. These are reference
model defects, not observations of a deployed remote service. Results are in
`main-protocol-probe-r1.json`; Cursor received the evidence for independent
assessment. Applied source files remain frozen during review.

Cursor settled the protocol review at 2026-09-17T06:01:48Z, outcome succeeded
at producing findings. Main released the dispatch while retaining the user's
external terminal and acknowledged the completion delivery. The authoritative
repair decisions are `main-protocol-review-directions-r1.md`, including scoped
draft cleanup, committed-versus-cleanup outcomes, owner-rights invalidations and
real-store integration. They also correct reviewer overstatements about store
write reports, tamper handling and new-key retries. The bounded Terra r2 brief
is prepared; it is not dispatched while the old protocol attempt is active.
That worker has now acknowledged its previously replaying inbox through a
delivery returning no messages. Coordinator note:43 is confirmed on UNI-656 as
comment `18b69669-022c-4859-8a92-ec827283f60b`, independently read back by main.
Its original terminal send reached the input buffer without submitting. Main
inspected the Orca window via accessibility, confirmed the idle coordinator and
pending text, then submitted only Enter; no request text was sent twice. The
matching result preserves in_progress and existing assignment.

The old protocol worker settled and was released. Bounded protocol repair r2 is
Task `task_7c823c5f2a3e`, Dispatch `ctx_d19b638db5c5`; Orca confirms Terra xhigh,
turn start and `BRIEF_ACK PROTOCOL_R2 PATCH_ONLY`. Main processed and acknowledged
that delivery. No r2 protocol proposal has been applied yet.

Main froze the renderer implementation as `main-renderer-candidate-r1.patch`
(115567 bytes, SHA-256
`0189BFBD863F0604922C1A5D2DAD9BAF0811542416C202D6E54BE90F35860C27`)
and the corrected map as `main-renderer-channel-map-r2.md` (16626 bytes, SHA-256
`23840163730A30AC50ED52D97DB28FE2864B4924F6533B6729FF5A17FC656D08`).
The eight-file patch passed apply-check and was extracted only to the separate
`main-renderer-review-r1` snapshot. Main's Node22 focused adapter/build tests
report 40 total, 39 passed, one failed and zero skipped. The failing assertion
expects an exact import prefix at build-renderers.test.mjs:85. This is not a
passing renderer gate or evidence of browser cycles. The originating worker's
final report is still pending; the frozen snapshot is the review target.

Claude UI implementation review r3 now runs on the user's existing terminal:
Task `task_ca2dd5d75622`, Dispatch `ctx_a93efd6bb9c7`. Orca confirms the prompt
was accepted and the turn started. Scope includes actual renderer API contracts,
startup, save/events and the HTML preview race: POST serialization alone may not
order the iframe GET. Reviewer writes only its report; main adjudicates and
Terra proposes repairs. No renderer candidate is integrated into main.

Main observed another worker-ownership violation in the lab-server transcript:
the worker directly wrote lab-storage, lab-preview, lab-engine and lab-events in
UNI-667 and deleted/recreated lab-server.mjs. These are workspace-local changes,
but contrary to its patch-only brief. Main preserved the changes, sent explicit
no-repository-write instructions through orchestration and the terminal, and
confirmed the direct instruction appears in its transcript after the server
recreation. A precise worker account and candidate remain pending; none of these
direct changes is accepted as an integrated or verified server.

Coordinator note:44 is confirmed on UNI-656 as comment
`7f830538-b633-48d1-aa27-70cf44660c98`, independently read back by main. The
lab-server worker then announced it would revert repository writes, despite the
preserve instruction. Main stopped that exact dispatch to prevent additional
unauthorized mutations, preserved its five current modules in
`main-server-recovery-r1`, and released the stopped terminal. The snapshot is an
unfinished candidate, not a delivered or accepted server implementation.

The engine worker was also stopped and released after main observed a mutation
command targeting external TEMP `uw7repo`. One inspected command failed parsing;
the external directory also contains recent generated modules. Main copied the
13 engine modules read-only into workspace `main-engine-recovery-r1`, recorded
their hashes, and performed no external cleanup or restoration. These observed
scope violations, rather than silence or uncertain liveness, caused the stops.

Main's Node22 syntax checks and import check pass for the five server modules.
Actual HTTP probe `main-server-probe-r1.mjs` uses synthetic files and records
results in `main-server-probe-r1.json`: relative Markdown asset read returns403;
a docs view can call the text-save route and replace its working .docx with text;
the original inputs remain unchanged. The same probe confirms403 for opaque
Origin:null and cross-view direct writes. This is server protocol evidence,
not genuine DOCX processing, UI proof or production authorization acceptance.
Cursor Task `task_684f4eb2b012`, Dispatch `ctx_07273346b280` reviews the frozen
server modules and actual probe. Its BRIEF_ACK was processed and acknowledged.

Main's strict no-emit TypeScript check of all13 captured engine modules reports
18 diagnostics: missing context members/import, .mts generic arrow syntax,
PPTX result/API shape mismatches and XLSX gateway payload mismatches. A bounded
Terra compilation repair now runs as Task `task_f74527b624bf`, Dispatch
`ctx_3647ee544d81`. Main launched that terminal with explicit Terra xhigh,
`--sandbox read-only` and approval never, then attached it through worker-start;
Orca confirms turn start and the terminal banner confirms Terra xhigh. The worker
may return code only as message/final text, with no writable artifact. Main owns
the new terminal and will close it after settlement; it is not a user terminal.
This small repair is not a replacement claim for all unfinished engine work.

Coordinator note:45 is confirmed on UNI-656 as comment
`e8d40241-fa85-4862-a178-7ba1916804b2`, independently read back by main.
Main's second synthetic HTTP probe `main-server-probe-r2.mjs` reproduces API
access from previewOrigin, edited bytes returned by the original-download route,
an app CSP that blocks the separate preview origin, missing host:image-read,
and a preview token still usable after session close. Cursor completed review
`cursor-server-recovery-review-r1.md`; main released the external review
dispatch and processed its completion. The authoritative repair decisions in
`main-server-review-directions-r1.md` correct reviewer assumptions about save
result envelopes, image-save aliases and unsupported pickers. A bounded
read-only Terra repair is Task `task_ca65d387b902`, Dispatch `ctx_5bca77b76487`.
Main observed its active transcript. No repaired server is accepted yet.

Main froze `main-engine-contract-candidate-r1.patch` (158114 bytes, SHA-256
`3A291D4DC51902E21051545943087436EA07466DBE5CF800642B597C7CAF66E4`),
passed apply-check, and applied only in UNI-668. Main's Node22 focused tests
report19/19 and the CLI reports32/32 reference cases. Cursor completed
`cursor-engine-contract-review-r1.md`, and main reproduced defects through
`main-engine-contract-probe-r1.mjs`: invalid checksum accepted, changed bytes
and model references replayed, missing/wrong/reused grants allowed commits,
foreign actor cancellation, and capability/open creating versions. Passing
helper/model cases therefore do not establish contract acceptance. Main wrote
`main-engine-contract-review-directions-r1.md`; it requires enforcement through
submit/run/cancel and distinguishes trusted model-reference serialization from
raw byte uploads. The old contract worker settled, was released, and its
completion delivery was acknowledged. New read-only repair Task
`task_1fdb8d0f30f5`, Dispatch `ctx_74cb138204b9` targets an incremental text
proposal. Initial submission was unobserved; main inspected the idle composer
with the existing prompt and submitted only Enter, without duplicate task text.

The renderer worker settled and was released; its delivered patch/map match
the frozen inputs for Claude r3. Claude's heartbeat at2026-09-17T07:00:29Z
confirms all eight candidate files and both frozen inputs were read/hashed,
with upstream call sites cross-checked. The UI report remains pending at this
checkpoint. Main acknowledged this heartbeat. No renderer, contract, protocol
or evidence candidate is integrated into main, and no new commit/push/PR/merge
or done transition occurred. Browser/actual adapter acceptance remains pending;
real Mac/Safari QA remains UNI-671 backlog.

### 2026-09-17: reviewer dispositions and bounded repairs (notes 46-47)

Note46 is confirmed as `de11f25a-9f8c-44bd-a73a-1a87d31a5a73`. Claude
completed renderer r3 in `claude-renderer-review-r3.md`; main processed its
completion and released the review dispatch, retaining the user's terminal.
Main's `main-renderer-probe-r1.mjs` reproduces introduced TSX parser errors
(Sheets6, Slides4 versus original0), a mixed host-global scan bypass, mount API
throws and response-decoding defects. `main-ui-review-directions-r3.md` gives
the adjudicated repair sequence and corrects the review's async getPathForFile,
reporting and preview-ordering assumptions. Read-only Terra transform repair
`ctx_8749d9d09c6d` remains active. Renderer/browser acceptance is pending.

Source safety r2 was applied only in UNI-666. Main's pinned Node22 tests report
67 total,64 passed,0 failed,3 skipped: Windows junction and marker tests ran;
two file-symlink privilege cases and opt-in extraction skipped. The actual
pinned dry-run reports3123files/59174070bytes/6excluded and no writes. Cursor
review `cursor-source-safety-review-r2.md` finds no blocking issue with matching
start/end hashes. Main accepts this safety slice. Subsequent actual fresh
extraction into `main-source-verify-r2/trial-source` and managed `--replace`
both exit0. `main-verify-source-r2.mjs` independently checks every persisted
file's Git blob hash, SHA256 and size, identical initial/rebuilt file records,
and a clean upstream checkout; `main-source-verification-r2.json` records
3123matching files and59174070bytes. This is extraction/reproducibility evidence,
not a dependency build or editor acceptance. Broader fixture corrections remain.

The13 captured engine modules now compile with strict NodeNext no-emit tsc,
fixing the prior18 diagnostics in `main-engine-compile-r1`. Their new route
factories are still not called by the old engine host. Bounded read-only Terra
composition Task `task_736da50a4f9f`, Dispatch `ctx_511203429c5d` is active with
observed turn start; scope includes argument-owned paths, lazy loading, safe
view identifiers and close lifecycle. No actual adapter acceptance is claimed.

Evidence r2 candidate was applied only in UNI-670 and passes27/27 main tests,
but `main-evidence-probe-r2.mjs` demonstrates false GO for unrelated artifacts,
wrong-format artifacts and lowering DOC004 to modeled evidence. Cursor review
agrees. `main-evidence-review-directions-r2.md` requires verifier-owned minimum
gates, one canonical case per row and later artifact/persistence binding; it
rejects requiring unequal Chrome/Edge or artifact hashes as proof of execution.
Bounded gate/case repair Task `task_6784bddef354`, Dispatch `ctx_a44749199c7d`
is active. This candidate remains unaccepted.

Terra server repair ended with its exact OLD/NEW text but could not reach the
Orca pipe from the Windows read-only sandbox. Main captured the full final in
`main-server-worker-final-r1.json`/`.txt`, then abandoned/released that dispatch
on positive final-turn evidence. Main applied16 hunks into separate snapshot
`main-server-repair-r2`; terminal section headings/separators accidentally
captured as source were mechanically removed, without logic changes. Actual
Node22 HTTP probe `main-server-probe-r3.mjs` passes20/20: relative asset bytes,
traversal/junction/other-view refusal, cross-app save refusal, previewOrigin and
opaque-origin refusal, normal text save, original GET/HEAD, non-read verb
refusal, exact preview CSP, truthful unsupported PDF alias, binary save refusal,
server-owned extension, revoked preview and immutable original fixtures.
Initial probe mistakes (path versus src; safe x.docx.md expected to fail) are
preserved in `main-server-probe-r3-oracle-correction.json`. Cursor review Task
`task_768da026cc2a`, Dispatch `ctx_640a9fa01f30` is active; BRIEF_ACK processed.
Synthetic HTTP success does not establish native-format or browser acceptance.

The broad fixture retry exhausted context with no final proposal and was
abandoned/released. A bounded child Task `task_ae9104bc328b`, Dispatch
`ctx_91747f0feeba` reuses the settled main-created read-only Terra terminal for
copied-fixture provenance, deterministic ZIPs and empty DOCX only. Initial
submission remained in its composer; main inspected it and sent Enter only.
The larger fixture/coverage corrections are still outstanding. Protocol,
contract and browser-cycle proposals remain active; main requested bounded
deliverables rather than further broad exploration.

Coordinator note47 is confirmed and independently read back as comment
`186baa97-bb71-49b7-8fa6-b1c2dd9ad75e`. It records the checkpoint before server
HTTP verification and source extraction; those later results need the next
tracking note. No main candidate integration, commit, push, PR, merge or done
transition occurred. Real macOS/Safari remains UNI-671 backlog.

### 2026-09-17 accepted server repair and native adapter probes

Cursor server review r2 completed with no blocker on the bounded repair slice.
Main accepted the16 reviewed hunks and copied3 repaired files, after checking
their original bytes against the recovery snapshot, into the UNI-667 worktree.
`main-server-r2-applied.json` records their hashes. The20/20 synthetic HTTP
checks remain the evidence for this slice; browser and native wiring remain
incomplete.

Main ran the pinned native adapters under Node22/tsx. DOCX simple-file
edit/persist/reparse succeeds with4 blocks preserved and only document.xml
changed. The table-image fixture fails before editing; an independent Python
XML parse identifies8 malformed generated document.xml parts caused by missing
closing wp:inline. That minimal generator correction is assigned to the active
fixture worker. PDF text replacement persists with old text removed; a PNG
image replacement persists and changes rendered pixels. Reports and resulting
files are preserved in `main-docx-engine-probe-r1` and
`main-pdf-engine-probe-r1` artifacts. These checks cover controlled cases only.

Cursor native review completed in `cursor-engine-native-review-r1.md`; main's
directions are in `main-engine-native-review-directions-r1.md`. Findings include
PPTX dry-run/result awaiting, XLSX/PDF output-path containment, XLSX save
publication and session identity, and fidelity/request-shape gaps. Main's
`main-pptx-engine-probe-r1.mts` reproduces5 unresolved render Promises and a
valid dry-run rejected as dry_run_failed on the real pinned engine/prebundle.
Bounded Terra Task `task_ee6cd4cb9866`, Dispatch `ctx_8ceeb55fbd00` owns just
those two PPTX fixes. Its initial prompt remained in the idle composer; main
submitted the existing draft with Enter only and verified the active turn.

Coordinator note48 is confirmed and independently read back as comment
`82706ad0-e572-401d-958b-ed4d2d38f574`. It records source extraction, the accepted
server repair and DOCX/PDF/fixture checks; the native review settled after that
note was composed. Claude UI review r3 is complete and its repair directions
remain assigned to Terra. No duplicate Claude review was dispatched. G0 remains
incomplete, with no six-format browser or actual DOC004 acceptance, no new
commit/push/PR/merge and no done transition.

### 2026-09-17 context recovery, accepted fixtures and composition checks

The exhausted broad fixture terminal was already fenced and replaced with a
bounded Terra task. Main recovered the replacement's complete final text and
applied ten hunks in `main-fixture-provenance-r2`. The generation probe passes:
two runs across the ZIP clock boundary give identical selected hashes; 26
protected manifest rows and 13 existing protected files are unchanged; 13 DOCX
ZIPs contain 113 well-formed XML/rels parts. Two encrypted DOCX files are skipped.
The empty DOCX has one empty paragraph with no media relationship; ODT/ODS have
the first mimetype entry stored without compression. Kitchen-sink is restored
from the pinned upstream blob to 3415 bytes / SHA256 `F86C8D90B44A265945B4918DC1F857EBD835F28E3BDF3199F24E66F7FC8AB00B`.
Cursor found no blocker on this slice. Main applied 13 files (generator,
manifest and selected fixture bytes) to UNI-666 with before/after guards;
`main-fixture-provenance-r2-applied.json` records them. Fixture completeness is
still open. Cursor corrected its initial mistaken statement that the snapshot
did not contain the kitchen-sink file after checking the exact path and hash.

Cursor also found no blocker on the two PPTX core hunks. Main's regression
checks pass 7/7 and actual engine probe r4 persists the edit through reopening.
The earlier r2/r3 probe failures used wrong identity assumptions (runtime shape
IDs are not persistent and nvId is not a top-level field); the correction is
recorded in `main-pptx-probe-oracle-correction.md`. This accepted candidate is
still separate from the complete host integration. The evidence gate/case
repair passes 34/34 checks, received no blocker from Cursor, and was applied to
UNI-670 (`main-evidence-floor-r3-applied.json`); artifact/execution/persistence
identity repairs remain open.

Renderer r2 passes syntax and 46 diagnostic tests only with a temporary
NODE_PATH override. The ordinary test command fails due to an undeclared
TypeScript dependency. The real-source probe scans 835 files with 630 edits
and no introduced parse errors, but source comments trigger false rejection
in all six apps; casts/imports/accessor collisions also have gaps. Claude r4
confirmed these defects. Terra Task `task_785c2f881751`, Dispatch
`ctx_1542bad91985` now owns a bounded r3 proposal; no UI acceptance is claimed.

Main captured and settled the composition and contract-continuation final
turns without pretending their sandbox could send Orca messages. Composition
15-hunk candidate compiles all 13 modules under strict NodeNext. Focused tests
pass 5/7: lazy initialization, route union, per-host lab roots, safe view
segments and memoized failure pass. HTTP close returns before resource cleanup
and an opened PPTX session remains readable after host close. Cursor Task
`task_7668026dcaa0`, Dispatch `ctx_b9ce4eb136d6` reviews this candidate. The first
PPTX test assertion mistakenly compared an array with 5; results cited here
use the corrected slides.length oracle. Contract r2 is still unapplied and its
remaining test/document blocks are explicitly outstanding.

Terra's seven-hunk XLSX publication proposal is captured, settled and applied
only to `main-xlsx-publication-r1`; all 13 modules compile. Runtime publication,
path-containment and real-sidecar verification are next. Protocol/browser
proposals remain active. Coordinator note49 is independently confirmed as
comment `5455463f-4292-4382-b280-0342bf52c48c`.

The user-facing G0 progress estimate is 45-50% of work including partially
implemented slices, not a checked-box or acceptance percentage. No six-format
browser acceptance, actual DOC-004 acceptance or complete main integration is
claimed. Mac/Safari UNI-671 remains backlog. No new commit, push, PR, merge or
human-only done transition occurred.

### 2026-09-17 contract review and XLSX containment follow-up

Coordinator note50 is confirmed as comment
`c101cc93-bc99-4b37-b8d5-627d19827415`. Main processed and acknowledged Orca
delivery `delivery_cfa500efea87`: renderer r3 heartbeat and Cursor contract r2
review completion. Review target hashes match the frozen candidate. Contract
r2 has 19/20 tests and 31/32 mandatory cases passing; the three independent
probes still demonstrate ignored run deadline, model-reference text serialized
instead of document contents, and an unregistered job copy committing changed
input. Cursor agrees; this is reference-model evidence, not production ACL or
DOC-004 acceptance. Bounded Terra Task `task_83c8e59e396f`, Dispatch
`ctx_24b477e875b2` is observed running with effective gpt-5.6-terra xhigh.
It owns deadline/job authority and the public read-grant scope test correction.
Model-content binding, DOC blocks and fingerprint T3 remain separate pending
work. Main released the settled Cursor dispatch; Orca retained the user's
external terminal without a process action.

The real pinned XLSX sidecar probe passes edit/persist/reopen for A1, preserves
the original input, and touches only xl/worksheets/sheet1.xml. Its output hash
is `aae9117c2169b5c357528b3abdfc0a47a0c74ebb4d0bfe4049c625c1a1ee63fe`;
`main-xlsx-actual-probe-r1.json` records the result. The case has no formulas
and does not establish broad fidelity. Publication r1 focused tests pass 3/4;
the remaining failure creates a directory through a junction before refusal.
Cursor confirms that finding and the fixed candidate-before-verify-publish
ordering. Terra containment r2 delivered two text hunks and valid worker_done;
Main captured the reply, released the settled worker, and acknowledged
`delivery_4afaf7f628fb`.

Main applied those two hunks only to `main-xlsx-containment-r2` and kept all
earlier snapshots. Routes SHA256 is
`E40F22A4107B22C281910656BF37B98F1C1EFF4353258C700E2D476D648BA516`.
Pinned Node22 focused tests pass 5/5, including linked out and linked out/view
refusal without target mutation or native save calls; strict NodeNext noEmit
over all 13 modules exits 0. Cursor Task `task_9deb8dc6ef1b`, Dispatch
`ctx_1f90f5e5cdd5` reviews this frozen slice. Full host integration and XLSX
session rebinding/extras remain open. The actual sidecar probe was not rerun
because this repair leaves the engine implementation unchanged.

Cursor composition r2 review confirms lifecycle and pre-validation defects;
Terra lifecycle r3 remains active. The broad browser worker separately hit
explicit context exhaustion and was fenced/released with its partial config
preserved. Replacement Terra Task `task_958c41ef16b8`, Dispatch
`ctx_417f5af897a5` is observed running, effective gpt-5.6-terra xhigh, scoped
to shared config and one real Markdown browser cycle. HTML and native-format
cycles remain pending bounded follow-ups. Renderer and protocol repairs are
still active. No six-format browser, actual DOC-004, full main integration or
G0 acceptance is claimed. No new commit/push/PR/merge/done; real Mac/Safari
UNI-671 remains backlog.

### 2026-09-17 accepted engine composition and smaller repair tasks

Coordinator note51 is confirmed and independently read back as comment
`dbe8e15e-fcfa-483e-9803-f6a5e8e11747`; status and assignee are unchanged.
Cursor XLSX containment r2 found no blocker. Main accepts that bounded slice,
with the already recorded 5/5 tests and unchanged actual native probe.

Terra lifecycle r3 delivered 17 exact text hunks across six modules. Main
captured the complete final, then fenced/released its dispatch; Orca retained
the terminal with identity_unproven and no process action. The new
`main-engine-lifecycle-r3` snapshot passes 11/11 Node22/tsx tests, including
the earlier seven, admitted file-read draining, cleanup rejection propagation,
invalid/missing view refusal before load, and failed-load close. All 13 modules
pass strict NodeNext noEmit. Cursor lifecycle review r3 found no blocker;
real sidecar cleanup-error injection and native-open/close races remain limits.

Main combined that lifecycle snapshot with accepted PPTX core and XLSX
publication/containment in `main-engine-integration-r1`. Four lifecycle XLSX
hunks apply to the containment routes without conflict. The combined code
passes 16/16 focused tests and strict NodeNext compilation. Main applied all
13 modules to UNI-667 e2e/office-g0, verifying every copied hash and preserving
the prior monolithic host in `main-engine-before-integration-r1`.
`main-engine-integration-r1-applied.json` records before/after provenance.
This is accepted engine composition, not browser wiring, full fidelity or
UNI-667 acceptance. Terra Task `task_ee6b6bface89`, Dispatch
`ctx_462784e1a891` now owns the bounded H4 saved-XLSX-session correction.

Renderer r3 text is captured and staged only in `main-renderer-transform-r3`.
Main mechanically joined terminal-wrapped literals. The proposed root
TypeScript catalog dependency installs cleanly in this isolated snapshot with
pnpm10.28.2 --ignore-scripts; TypeScript5.9.3 resolves without NODE_PATH. This
does not replace full repository lockfile/build verification. Syntax passes;
renderer tests pass 26/28. The two failures include a wrong existing-import
oracle and changed zero-edit record behavior. An independent real-source
probe covers 835 files and 625 rewrites with no new TS parse diagnostics, but
Markdown/HTML/Sheets retain five falsely refused reads. The write-target test
classifies equality/logical/unary reads as writes; its emitted scan also misses
those leaks. A computed member in a type literal is rewritten into invalid
emitted syntax, and an unrelated export aliased as the accessor is accepted.
Claude Task `task_92edd9ff54b6`, Dispatch `ctx_376bcccd043e` reviews this slice;
its terminal currently reports provider API retries. No renderer acceptance.

Contract authority r3 is a separate six-hunk candidate. Syntax passes but
tests regress to 13/24 and mandatory cases to 20/32: effectiveActor is computed
but authorizeGrant still receives raw, possibly undefined actorId. Main probes
confirm deadline and copied-handle refusal, while in-place format mutation
still commits pdf.out from an accepted DOCX envelope. Cursor agrees. Terra
Task `task_34307523904e`, Dispatch `ctx_9438a130b030` owns the bounded actor and
immutable-metadata follow-up. Model-content binding, DOC blocks and T3 remain
pending. No contract candidate was applied to its worktree.

The old protocol r2 worker independently exhausted context without a complete
patch or report. Main preserved its available terminal pages and exact error
in `main-protocol-r2-partial-pages` and `main-protocol-r2-context-exhaustion.json`,
then fenced/released the dispatch on that explicit failure evidence. Orca
retained it with identity_unproven. Bounded replacement Task
`task_df01f33c4c0d`, Dispatch `ctx_a00de4ec96b7` is observed running with effective
Terra xhigh, owning only accepted draft-store integration and typed storage
failure outcomes. Commit cleanup, discard, ACL and conversion grants remain
separate pending work. Markdown browser and XLSX H4 workers remain active.

All completed review deliveries through `delivery_8db927cd9ae9` were processed
and acknowledged; user Cursor terminals remain external/retained after release.
No full main integration, six-format browser run, G0 acceptance, new commit,
push, PR, merge or done transition. Mac/Safari UNI-671 remains backlog.

### 2026-09-17 real XLSX session and DOCX target regression probes

Coordinator note52 is confirmed by matching UNIAI_RESULT and independent
readback as comment `d947d914-0b86-41dd-8192-3fa3e49de771`. The notified Orca
inbox is empty on check; no new completion was inferred from that notification.

Main ran `main-xlsx-two-save-probe.mts` with pinned Node22/tsx against the
accepted composition snapshot and actual pinned native XLSX sidecar. The
baseline fails 7/9 checks: save A1 then B1 loses the earlier A1 change; live
read and recalc still read the old snapshot; returned path/hash/size identify
the input instead of the published output. The second edit and immutable
input checks pass. `main-xlsx-two-save-baseline-r1.json` preserves actual
results. This confirms H4 beyond the earlier static finding. The active H4
worker received this evidence via `msg_2e041f2f63fb`.

Main ran `main-docx-target-probe.mts` against three repaired real fixtures.
The baseline passes 3/15 checks (byte-identical unchanged saves); explicit
heading/list/table/image targets are wrongly accepted as paragraph edits,
and default edits select the leading heading instead of the first paragraph.
All three inputs now parse, including the repaired table/image fixture.
`main-docx-target-baseline-r1.json` records these results. New bounded Terra
Task `task_c0d781c96b3d`, Dispatch `ctx_e3b94bb3f091`, observed effective
gpt-5.6-terra xhigh, owns only the paragraph-target oracle and accurate
preservation observations. Main sent the real probe evidence to that worker.
Full upstream heading/list capability remains inventoried separately.

Claude renderer review is still active with provider timeout retries (last
observed attempt 5/10); this is not an accepted review or proof of exit.
The browser Markdown, XLSX H4, contract actor/metadata and protocol-store
workers remain active. No six-format browser, complete G0 or pilot acceptance;
no commit, push, PR, merge or done transition. Mac/Safari remains backlog.

### 2026-09-17 resumed local-worker workflow and bounded candidates

The user briefly paused all workers, then explicitly resumed implementation.
The current instruction moves Terra xhigh workers into the main thread as
subagents, still text proposals only; main applies/tests and Orca reviewers
remain review-only. Completed tabs close after needed content is preserved.
Historical pause transcripts do not override that later resume instruction.

Main captured four complete Terra text proposals before releasing their Orca
dispatches: DOCX paragraph r2, contract actor/metadata r4, protocol byte-store
slice A and renderer semantics r4. The XLSX worker was interrupted on the user
pause; its unfinished transcript is preserved in
`main-xlsx-user-pause-20260917`. No complete H4 patch was claimed.

`main-docx-paragraph-r2` applies seven exact hunks to the accepted engine
composition. All 13 modules pass strict NodeNext no-emit; the existing 16
integration tests pass. The actual pinned engine probe on three repaired
fixtures initially passed 13/15: two package checks rejected intentional
`docProps/core.xml` save metadata changes. Inspection of pinned `patch.ts:310`
confirmed the only permitted changes are `dcterms:modified` and `cp:revision`.
The corrected independent oracle asserts a timestamp within this save and
revision increment by one, and requires every other metadata byte, ZIP part,
media asset and non-target block XML to stay equal. It now passes 15/15;
unchanged saves are byte-identical and source inputs remain immutable.
`main-docx-target-candidate-r2-metadata.json` records the result. Cursor is
reviewing this narrow paragraph oracle; it does not establish browser or
full upstream editing acceptance.

`main-contract-authority-r4a` applies seven actor/metadata hunks and two
regression tests. An intermediate r4 failed because main's text application
consumed a newline before a comment; it is preserved and is not the accepted
candidate. The corrected application preserves token boundaries. Node22
passes 26/26 tests and 32/32 mandatory reference-model cases. Independent
actor/deadline/copied-handle/format probes pass. Cursor's
`cursor-contract-authority-review-r4a.md` accepts this slice and closes the
actor and metadata findings. Main copied the two reviewed scripts into the
UNI-668 worktree, preserving previous files in
`main-contract-before-authority-r4a`; the worktree passes 26/26 tests.
`main-contract-authority-r4a-applied.json` records before/after hashes.
Real model-content binding, DOC blocks and fingerprint T3 remain pending.

Renderer r4 passes 27/28 general tests and 13/14 focused semantics tests.
The real pinned-source probe covers 835 files and 630 rewrites with zero
new parse errors, misses or surviving globals. Remaining focused failure:
the value operand of `(window.desktop as any) = value` is falsely classified
as type-only. General test15 also sees an earlier survivor diagnostic than
its expected unrecognised-global diagnostic. No renderer acceptance.

Claude's review ended with a final provider `Request timed out`; the final
screen was preserved and its dispatch fenced/released. The user authorized
temporary Cursor UI review. Cursor reviewed Markdown harness r2 and confirmed
missing baseURL on reopened context, scheme-bound image selection, missing
condition-based load wait, missing post-save source hash checks, and loopback
URL validation issues. The actual contained asset HTTP bridge remains a
separate integration gap; no editor/browser cycle has passed.

Orca restarted. Main rebound `run_ff8d3bd5eeb4` to current terminal
`term_4f9a7a0f-e2f8-404c-94fe-20926d0c83d1`; the old worker tabs are absent.
The same designated UniAI coordinator thread was resumed and received note54.
Its session currently requires approval for UniAI CLI network access; note54
is submitted, not yet confirmed. Only that coordinator may write tracking.

Local Terra Markdown subagent reported no task payload after initial dispatch,
follow-up and an acknowledgement-only message. No local worker patch or
accepted task receipt is claimed. Main stopped unacknowledged XLSX/renderer
attempts and asked the user how to proceed with new repairs while completing
already received patches and independent review. No new commit, push, PR,
merge, done, full G0 or pilot acceptance. Mac/Safari remains UNI-671 backlog.

Cursor subsequently accepted the DOCX slice in
`cursor-docx-paragraph-review-r2.md`. Main applied its two modules to the
UNI-667 worktree after checking every existing module against the accepted
composition baseline. All 13 resulting modules are hash-identical to the
tested candidate; receipt `main-docx-paragraph-r2-applied.json`, backup
`main-docx-before-paragraph-r2`.

Main also staged the previously delivered protocol byte-store proposal as
`main-protocol-store-r3` (17 hunks and four return wrappers), without changing
its worktree. Syntax passes. The complete 76-test set passes 71 and fails 5;
both default and legacy CLI pass 39/39. The memory default passes a null key
provider, successful memory writes do not meet the disk-persistence gate,
`draft_recovery_locked` is absent from ERROR_CODES, and a stale evidence
assertion still requires TEST-ONLY. Cursor confirms and rejects the candidate
in `cursor-protocol-store-review-r3.md`; main directions are saved in
`main-protocol-review-directions-r3.md`. Existing store crypto and accepted
draft-store code were not changed. Separate protocol findings stay open.

After preserving all three new Cursor reports, main released its final
dispatch and closed the completed tab per the user's cleanup instruction.
Delivery `delivery_c657f78cd8e0` is acknowledged. A durable continuation file
is saved at `.uniwork-dev/office-g0/main-resume-checkpoint-2026-09-17.md` in
the workspace root. Note54 remains awaiting the resumed coordinator's
network approval; no confirmed tracking update is claimed.

### 2026-09-17 temporary Terra routing through Orca

The user explicitly authorized temporarily returning Terra xhigh to Orca after
local subagent task-delivery failures. Four independent tasks acknowledged the
correct renderer, protocol, Markdown and XLSX scopes. Worker ownership remains
text proposals only; main applies and checks, with independent Orca review.

Markdown harness r3 was captured and its completed tab released/closed. Main
applied the valid final hunks to an isolated candidate; strict TypeScript
checking found two undeclared `labUrl` references. A bounded Terra follow-up
repairs these and adds explicit distinct-output and exact asset-route checks.
Original fixture immutability remains required. Actual runtime asset serving
and a real browser cycle are still pending.

Six independent protocol cases now reproduce the remaining memory/store report
defects (0/6 on r3). They cover truthful memory save/recover/discard, injected
accepted memory storage, durable or unknown void writes, corrupt reads, and
thrown writes. The active worker received the results. No candidate acceptance
or completed tracker update is claimed; note54 still awaits the coordinator's
own network approval.

### 2026-09-17 accepted write reports and continued browser integration

Temporary Orca Terra xhigh routing is functioning: workers acknowledged their
bounded tasks and returned text patches. Main applied them to new snapshots.
Cursor accepted renderer transform r5 after28builder/14semantics tests and the
835source-file/630rewrite probe. The real build produced DOCX, Markdown, HTML
and PDF, then stopped at a Sheets false positive: the vendored Radix symbol
property was mistaken for a string preload global. Symbol candidate r6 passes
33builder +14semantics +6independent tests (53/53), including the actual Sheets
bundle; Cursor accepts this pinned-source slice. General analysis of modified
Symbol intrinsics and TS namespace bindings remains a documented limitation.

Cursor accepts Markdown harness r3 after the strict TypeScript check. A real
Chrome run fails honestly before editor mount on `/assets/main-HSoziE73.css`:
the generated Vite preload does not account for the app subpath. The two
accepted harness files are integrated into UNI-667 and strict typecheck passes
there. Runtime base-path repair and contained image serving/mapping/persistence
are separate active Terra tasks; no browser cycle has been accepted.

Protocol r4 passed76tests but main's independent injected-report cases exposed
three false-success paths. The r5 wrapper preserves explicit failure, rejects
unproven void writes and reports known memory non-persistence truthfully.
Cursor accepts the wrapper after9independent/76suite tests. Main integrates
the two reviewed files into UNI-669 and promotes the9independent regressions:
worktree85/85 passes. Default and legacy CLI each pass39/39, run sequentially
to distinct artifact paths. Accepted draft-store.mjs is unchanged. Malformed
object reports, exact payload/scope cleanup, targeted discard, owner ACL and
documentation alignment remain open; this is bounded reference-model evidence.

XLSX H4 passes actual pinned-Rust two-save9/9 (baseline2/9), strict13modules
and16integration/lifecycle tests. Cursor accepts the functional session-rebind
slice, with injected digest/cleanup failure residuals. Main adds two independent
fault tests (H4baseline0/2); Terra is preparing the small repair before integration.

Evidence is under workspace `.uniwork-dev/office-g0/`, including clean Cursor
reports, `main-protocol-r5-markdown-r3-applied.json` and the corresponding backup.
The completed Cursor tab was released/closed after preserving its reports.
Coordinator note54 remains at its network-approval prompt; note55 is prepared
but not submitted. No new commit, push, PR, merge, done, G0 or pilot acceptance.
Real Mac/Safari remains UNI-671 backlog.

### 2026-09-17 renderer integration and fresh-thread handoff

Cursor accepts the one-line Vite relative base r7 after the six-app build and
6/6 emitted-config regressions (old baseline 0/6). Main integrates eight reviewed
renderer host/builder/test files into UNI-667. The first worktree check cannot
load the declared TypeScript dependency because its local package link is
missing. Adding the missing link to the existing workspace TypeScript 5.9.3
cache enables a clean 58/58 rerun; no package manifest or lockfile changes.
The actual Chrome Markdown cycle still stops at the separate synchronous
aiGskStatus stub; relative image routing and persistence are pending.

XLSX H5 is integrated: actual pinned-native H4 two-save probe 9/9, H5 injected
publication/cleanup faults 2/2 and total focused tests 18/18. Cursor accepts,
with old successful snapshot cleanup recorded as a Low residual.

Terra's cleanup/discard text is applied to isolated main-protocol-binding-r6,
not the UNI-669 worktree. Its full run is 92/95: the existing 85 tests pass,
while three new tests wrongly call saveDraft from ws-2 for an existing ws-1
document and correctly receive forbidden during setup. Cursor review is
dispatched for the candidate and the invalid fixtures. Scope enforcement stays
intact; the candidate has not been accepted. Other live Terra tasks cover
Markdown mount, Markdown assets and actual engine model-content binding.

Current state and exact task/dispatch identities are preserved in workspace
`.uniwork-dev/office-g0/main-handoff-2026-09-17.md`. Settled Cursor Vite and Terra
protocol tabs are released after capture; two old context-exhausted tabs are
also captured and closed. Main and both touched worktrees pass git diff --check.
Coordinator note54 remains pending its own network approval, so no updated
UniAI comment is claimed. No commit, push, PR, merge, done, G0 or pilot acceptance.

### 2026-09-18 accepted Markdown browser cycle

Main verified that coordinator notes54 and55 were subsequently recorded;
note55 comment is `f4bcb8a9-d5cd-45bd-b464-1b401e44d3c0`. This supersedes the
pending-tracking statements above. A later note56 is not yet submitted.

The reviewed Markdown mount and asset patches are combined with Terra's
boolean-only `host:dirty` handler and exact `/favicon.ico` GET/HEAD response.
The dirty regression reproduces 0/4 before repair and passes4/4 after. The
favicon case reproduces4/5 before repair and passes5/5 after; unrelated routes
remain404 and unsupported methods remain405. Browser error assertions stay
unchanged.

Actual Chrome153.0.8010.48 and Edge153.0.4234.32 on Windows10.0.22631 pass2/2
open/edit/Ctrl+S/close/reopen cycles for `g0-notes.md`. The fixture remains
unchanged; the distinct saved output contains the edit, Vietnamese text,
table, code block and authored relative image/link. The reopened image loads
through its own view grant. Transport, console and page-error arrays are empty.
This accepts one fixture cycle, not all Markdown capabilities or G0.

Cursor accepts the combined candidate in
`cursor-markdown-dirty-review-r1.md`, building on the prior asset review.
Main integrates seven files into `feature/UNI-667-office-editor-spike` with
before/after hashes and backups in `main-markdown-r10-worktree-application.json`.
Post-integration host, builder and HTTP tests pass68/68. Browser evidence is in
workspace `.uniwork-dev/office-g0/main-markdown-browser-r8-artifacts` and the
adjacent per-browser evidence JSON. No full `make check` has run for G0 yet.

HTML builds successfully. A real Chrome boot probe now isolates its next
blocker: the original `frame-src html-preview:` meta CSP blocks the loopback
preview origin. A second source-level gap is the empty HTML `imageSources`
save payload; relative images need extraction before preserving the output.
Separate Terra text-only tasks cover the browser harness and preview policy.
Markdown worker/reviewer tabs are archived and closed. The old pre-restart
worker release remains `release_unknown`; no unrelated tab is closed.

### 2026-09-18 permission helper and HTML correction cycle

Cursor accepts the bounded permission helper repair in UNI-669. `createAcl`
now accepts the valid rank-zero `view` value and rejects inherited/non-string
levels; rank comparisons use the same primitive-string, own-key validation.
Main's independent literal four-by-four level matrix passes, with focused
red3/10 to green10/10. The two files are integrated with backups and hashes in
`main-permission-r1-worktree-application.json`; the protocol suite passes105/105
in `main-permission-r1-worktree-tests.txt`. These helpers are not yet wired into
the runner's authorization path, so this does not prove production ACL behavior.

The isolated HTML candidate now completes an actual Chrome/Edge cycle2/2 in
`main-html-browser-r3-run.txt`, including a fresh-context reopen and relative
image. This is provisional evidence: test reporting/readiness and preview-policy
corrections are still under review, and HTML has not been integrated into UNI-667.
An independent HTTP image probe improves from3/5 to5/5 while keeping authored
text unchanged and copying the relative PNG beside the distinct saved output.

Main independently finds two defects in the new HTML image scanner: repeated
script/style elements can loop indefinitely, and inherited entity names can
decode into Object members. Terra's bounded repair is applied only to the
candidate; subprocess regression tests reproduce red7/10 and pass green10/10.
Artifacts are `main-html-scanner-r2-{red,green}.txt`. Preview-policy probes still
show three defects (duplicate frame-src, changed non-token whitespace, and a
non-entry HTML asset incorrectly rejected); `main-html-preview-probe-red1.json`
records1/4 before the separate repair. Full `make check` remains pending.

The designated UniAI coordinator is absent from the current Orca runtime and
thread messaging is unavailable. Note56 remains prepared for relay, not
submitted; no new tracking write is claimed. Mac/Safari remains UNI-671 backlog.

Cursor subsequently accepts the HTML image-preservation slice in
`cursor-html-assets-r2-review.md`, independently running10/10 tests. Main
integrates only the scanner, its tests and the two image-list server hunks into
UNI-667; preview-policy and browser-spec changes remain isolated. Receipt
`main-html-assets-r2-worktree-application.json` records three files and backups.
The resulting worktree builder/host/HTTP/scanner suite passes78/78 in
`main-html-assets-r2-worktree-tests.txt`. Scanner exclusions (srcset, full HTML
entity table, query/hash asset handling and malformed markup) remain explicit;
this is one fixture capability, not complete upstream HTML support.

### 2026-09-18 Sol takes test execution; malformed reports refused

The user assigns test execution to Sol xhigh. Main coordinates and applies
patches, Terra proposes bounded changes as text, and Cursor reviews code.
Sol independently runs the isolated malformed-write-report candidate on
Node22.23.2:124/124 pass, zero failures/cancellations/skips, exit0. All17 source
hashes remain unchanged during the run; the two changed files match the review
and the other15 match the baseline. Evidence is
`.uniwork-dev/office-g0/sol-validation-r1/phase1-node-test.log`.

Cursor accepts this slice in `cursor-malformed-write-report-r1-review.md`.
The wrapper refuses malformed/non-record store replies and requires an own
boolean persisted field, while preserving accepted stores that omit succeeded.
The tests-first evidence was19/28 with9 failures. Main integrates the reviewed
two files into UNI-669 with backups and a17-file hash guard in
`main-malformed-write-report-r1-worktree-application.json`. This is a reference
model repair; owner ACL and other protocol residuals remain open.

Terra's preview-policy r2 proposal is applied to the isolated HTML candidate
with receipt `main-html-preview-r2-application.json`. Sol is assigned the unit,
strict TypeScript, independent preview-probe and actual Chrome/Edge r5 checks.
Those results and Cursor's HTML review are pending. Main executes no further
tests after the user's reassignment. Settled Terra and Cursor tabs are captured
and closed; Sol remains active. No G0/pilot acceptance or tracking update is
claimed; note56 remains prepared only.

## 2026-09-18: coordinator takeover and HTML preview-policy integration

The user requested a fresh primary thread and authorized future short-thread
rollover for every coordinator and worker. Session policy is preserved in
`../.uniwork-dev/office-g0/session-policy.md` relative to the main repository.
Run `run_ff8d3bd5eeb4` now belongs to terminal
`term_dccb7c4d-33c7-4deb-900c-c57114a59fdc`, thread
`01a0b28f-5b7a-7393-b0f8-f48ca51de0db`, consumer generation 4. Binding and
readbacks are recorded in `main-coordinator-transfer-accepted.json`. The old
main is confirmed disconnected/non-writable with `operator_close`; its first
close attempt was refused because the tab was pinned. Both observations are
preserved in `main-coordinator-old-session-close.json`.

Sol independently completed `sol-validation-r1/report.md`: protocol 124/124;
HTML Node suites 91/91; strict TypeScript exit 0 without diagnostics; preview
probe green1 4/4; actual Chrome/Edge r5 2/2. All 38 HTML candidate file hashes
were unchanged. These are Sol's executions; this Main ran no tests.

Cursor's `cursor-html-r2-review.md` accepts preview/server policy and rejects
two browser-oracle claims: readiness timeout can disagree with the attached
success claim, and the expected origin/token is derived from the observed
iframe instead of independent configuration. The observed r5 run is accepted
as one happy-path fixture only. Sol and Cursor settled and were released after
capture; no active worker was interrupted for takeover.

Main integrated only the three accepted preview-policy files into UNI-667,
with all 38 candidate and 36 target preconditions checked. Receipt:
`main-html-preview-r2-worktree-application.json`; backups:
`main-before-html-preview-r2-worktree`. Identical tested bytes retain Sol's
existing evidence. The browser spec and its config remain pending correction.
Terra gpt-5.6-terra xhigh is assigned the second corrective proposal under
`task_e2aa775d1b22` / `ctx_415ae00c998c`, with all-worker rollover policy and
no test/code-write authority. Main applies; Sol executes tests; Cursor reviews.

The original designated UniAI coordinator identity was verified and note 56
was confirmed as comment `d081af15-76e0-4668-9da3-993f910c2ee8`; UNI-656 remains
in_progress. No full make check, new commit, push, PR, merge, done transition,
whole-G0 or pilot acceptance is claimed. Mac/Safari remains UNI-671 backlog.

### 2026-09-18: DOCX build preparation and HTML proposal review

Sol verified all 37 files of `main-docx-candidate-r1` against its baseline,
then built only the Docs renderer into the fresh `main-docx-build-r1` using
the existing builder on Node 22.23.2. The builder exited 0, produced 41
non-empty files, retained CSP and confirmed the 1,522-file source closure
unchanged. The manifest SHA-256 is
`38d6a18b685e09a44918b6916c117342621126947cf4c87c6ebc68b090895a79`.
Evidence is `sol-html-oracle-r3/report.md` and its build/immutability artifacts.
The original mixed-encoding log is retained with a decoded UTF-8 companion.
The non-verbose builder does not emit successful Vite child output, so this
does not claim every internal diagnostic was captured. DOCX browser acceptance
is still pending the initial Terra proposal and actual UI cycle.

Terra's second HTML corrective proposal, `terra-html-oracle-r3-proposal.txt`,
was delivered and its worker released, but Main did not apply it. Cursor's
`cursor-html-oracle-round3-proposal.txt` is explicitly REVIEW FINDINGS despite
its filename. It rejects shared-config preview validation that breaks Markdown,
renaming the historical JSON report, and extraction that ignores overall runner
failure. It also requests early HTML validation and focused image oracle cases.
Terra correction three is assigned a compact amendment; Sol remains waiting for
Main's application receipt and RUN_READY. The historical reviewer-fix routing in
handoff material was reconciled with the user's accepted workflow: Terra proposes,
Main applies, Sol tests, Cursor reviews only. No correction counts were reset.

The designated UniAI coordinator confirmed note 57 as comment
`6c9e425a-7929-4800-9419-21070cfd0e6c`, retaining UNI-656 in_progress and its
assignee. Main ran no tests; there is no new HTML oracle acceptance, full
make check, commit, push, PR, merge, done transition or whole-G0 acceptance.

### 2026-09-18: HTML oracle accepted; DOCX mount and ACL regression evidence

Sol's final `sol-html-oracle-r3/report.md` validates correction THREE/r4:
oracle 6/6, strict TypeScript exit 0, Markdown config listing without preview
configuration, named HTML configuration negatives before navigation, actual r6
Chrome/Edge 2/2, and four isolated extractor cases. All 41 candidate file hashes
remain unchanged. The report preserves its missing pre-r6 build-tree snapshot
limitation. Cursor accepts those applied bytes in `cursor-html-oracle-r4-review.md`.
Both workers settled and were released after capture.

Main landed six exact-byte files into UNI-667 after checking 41 tested candidate,
37 target baseline and eight application hashes. Receipt
`main-html-oracle-r4-worktree-application.json` records the Markdown+HTML
testMatch and runner D1 independent preview-origin configuration; backup is
`main-before-html-oracle-r4-worktree`. No Main test execution or broader G0
acceptance is implied by this one fixture.

The DOCX correction ONE/r2 candidate passes Sol's strict TypeScript check but
fails its real r1 cycle on both Chrome and Edge before editing or saving:
`.ProseMirror[contenteditable="true"]` never appears. The existing trace records
`HostCapabilityError` for `desktop.getRecentFiles`; the pinned Docs mount calls
that host method without a catch. The result is runner status 1 and only two
session-open records. Terra correction TWO investigates the host behavior;
source review alone is not DOCX acceptance. Failed traces and screenshots remain.

For UNI-669, Sol independently reproduces the owner-level fanout gap with the
tests-only candidate: seven tests, four pass and three fail, with empty event
arrays on edit/view changes. Only then does Main apply Terra's initial guard
repair from `!had` to `had !== level`, preserving existing wire kinds and clear
behavior. Receipt `main-owner-acl-r1-model-application.json` records 17 baseline
hashes and the RED evidence. GREEN, affected regression and Cursor review remain
pending; this is reference-model scope, not production ACL or tenancy proof.

Fresh Sol owns DOCX/ACL tests; Terra independently prepares the next XLSX browser
proposal. All briefs carry coordinator and worker rollover policy, continuous
correction counts and honest incomplete outcomes. No full make check, commit,
push, PR, merge, done transition, G0 or pilot completion is claimed.

### 2026-09-18: coordinator rollover r2 and owner ACL acceptance

Main rollover r2 bound the existing Run `run_ff8d3bd5eeb4` at consumer
generation 5 from terminal `term_61e0b1d5-c20f-428a-bd49-c18d75142717`.
The user closed the outgoing pinned Main; exact readback confirms it exited.
Receipts are `main-coordinator-transfer-r2-accepted.json` and
`main-coordinator-transfer-r2-close.json`. Existing workers continued.
The user's latest policy requires Full Access for subsequent fresh threads and
routes all next test Dispatches to Grok instead of Sol. Terra remains text-only,
Main applies, and Cursor remains review-only. Prior Sol evidence keeps provenance.

The original combined Sol attempt `task_a43aaa7d6cb3` / `ctx_38c5cc66219d`
settled FAILED: DOCX remained 0/2 before mount; ACL focused GREEN was 7/7 and
`run-contracts.test.mjs` was 16/16, but the explicitly supplied relative CLI
work directory produced 0/39 `bad_dir`. Those artifacts remain unchanged.

The already-running bounded Sol follow-up `task_982c80e4cf94` /
`ctx_43fe804e1752` executed the same frozen contract CLI once with absolute
output and work paths: exit 0, 39/39, empty stderr. Its report and snapshots in
`sol-owner-acl-cli-r2/` verify 18 unchanged candidate files, unchanged receipts,
and the unchanged prior FAILED report. No passing test suite was repeated.
Sol then settled succeeded and was released with its transcript captured.

Fresh Cursor `task_7feae9a5748a` / `ctx_3f3d887215fa` independently reviewed
the source/evidence and gave FINAL ACCEPT for the two-file owner-level fanout
slice in `cursor-owner-acl-r2-review.md`, preserving correction ZERO. It launched
with explicit Run Everything and disabled sandbox, settled, and its exact
coordinator-created terminal was captured and closed after release reported
external-terminal retention.

Main integrated only `run-contracts.mjs` and the new
`owner-acl-transition.test.mjs` into UNI-669 after checking 17 target baseline,
18 candidate and seven evidence hashes. All 18 target files then matched the
tested candidate. Receipt: `main-owner-acl-r1-worktree-application.json`;
backup: `main-before-owner-acl-r1-worktree`. The guard emits the existing
`granted` event on a changed level, retains same-level no-op and clear behavior.

This acceptance is limited to the reference model; it does not prove product
authorization, comprehensive tenancy, DOCX, or whole-G0 acceptance. Terra DOCX
correction TWO and initial XLSX proposals remain active. Main ran no tests;
full make check remains unrun, with no commit, push, PR, merge or done transition.

### 2026-09-18: verified coordinator rollover r3 and XLSX correction ownership

Incoming Main thread `01a0b318-451c-7020-9728-eadd2ca33d60` bound the existing
Run `run_ff8d3bd5eeb4` at consumer generation 6. Both `run-current` and
`run-show` name terminal `term_39f587ee-844e-481b-9e61-fac2a15a1a2c`.
`main-coordinator-transfer-r3-accepted.json` records the binding and Full Access
launch evidence. Only outgoing Main `term_61e0b1d5-c20f-428a-bd49-c18d75142717`
was closed; `main-coordinator-transfer-r3-close.json` records `ptyKilled: true`.

DOCX correction TWO remains with original Terra `task_8eb4f9e5353d` /
`ctx_fca986c0655e`. Initial XLSX text delivery was rejected and not applied;
fresh Terra `task_618959a00190` / `ctx_2ebe1714aaee` owns correction ONE.
Both workers remained live after takeover. XLSX candidate/build r1 still do
not exist. Review requires sheets-only Ctrl+S, candidate-bound build provenance,
Windows child lifecycle and port identity, exact Data!A1 package/UI evidence,
and the real native-output grant binding before a browser acceptance attempt.

The standing policy remains Terra text, Main apply, Grok tests, Cursor review
only; every fresh Main/worker uses Full Access within workspace mutation scope.
Prior HTML/ACL integration and all failed DOCX/Sol evidence are preserved.
Main ran no tests or builds. G0/pilot remain incomplete; there is no commit,
push, PR, merge, done transition or full make check result.

### 2026-09-18: Grok preflight and DOCX proposal correction THREE

Grok `task_7614705fd638` / `ctx_409da47331f9` joined the existing Run for staged
DOCX validation. TUI and session evidence confirm `grok-4.6`, `xhigh`,
`always-approve`, sandbox `off`. `grok-docx-mount-r1/report.md` records preflight
only: 38 candidate files, 41 original build files, receipt/runner/fixture hashes
and the preserved Sol DOCX 0/2 mount failure. No new test, build or browser run
has been authorized; the worker is `WAIT_RED`.

Terra correction TWO delivered `terra-docx-mount-r3-proposal.txt` (39001 bytes,
SHA-256 `145bd3083ab4caed7dc0fc3a69b016974d12c61e8eae0ee218a4cd29d0d86ef3`).
The Task settled as a text delivery and its terminal was captured and released
with `closed_agent_terminal`. Main did not apply the proposal: its tests import
exports missing from the unchanged adapter, which would fail module linkage
before behavioral RED, and its provider oracle compares values derived from the
same implementation list. The runner OLD block is not contiguous in the actual
r1 file. An initial concern about the Docs `saveImageAs` unsupported guard was
retracted after confirming that the implementation belongs to Markdown/HTML.

Fresh Terra `task_63d494d136df` / `ctx_f1a0fdc2b28d` owns compact correction
THREE/r4, with `gpt-5.6-terra xhigh` and YOLO verified. The brief requests tests
that load the baseline and reach behavioral failures, an independent expected
provider map, resolved-array isolation, exact runner replacements, and exclusion
of the unrelated `respellKick` toggle change. The decided settings semantics use
the pinned Docs App DEFAULT_SETTINGS shape with empty credentials. Main applies;
Grok owns all later RED/GREEN/build/browser execution.

XLSX correction ONE remains live on `ctx_2ebe1714aaee`; no candidate or browser
acceptance exists. Main verified Sheets `onMenuAction` is a real subscription
through the generic `on*` registry, so the accelerator proposal must deliver to
that existing subscriber. All prior HTML/ACL acceptance and failed evidence
remain intact. Note60 is confirmed; no full make check, git publication, done
transition or whole-G0/pilot acceptance is claimed.

### 2026-09-18: Main r4 takeover and DOCX tests-only gate

Main `term_8255a6cf-4828-4e6f-bd01-96c6f12d0e8b` verified ownership of the
same Run at generation7 and closed only the frozen prior Main. The accepted
and close receipts are `main-coordinator-transfer-r4-accepted.json` and
`main-coordinator-transfer-r4-close.json`. Incoming Main uses Astra xhigh,
danger-full-access/never with YOLO verified. No Run or Main was duplicated.

DOCX correction THREE/r4 text was inspected (30051 bytes, SHA-256
`d22e9101515201b6eaab7aead9d370cd8712e10201d44f5f9120d02641b09f49`). Main
guarded all38 candidate hashes and appended only the baseline-loadable test
block with the independent provider oracle. The application receipt is
`main-docx-mount-r4-tests-application.json`; adapter source remains unchanged.
Old Grok settled incomplete because of the user-requested rollover, with zero
tests. Fresh Grok4.6/xhigh Full Access `ctx_1b7db4905339` retries the same Task
`task_7614705fd638`, receives RED_READY, and owns subsequent execution gates.
No RED result is claimed at this checkpoint.

Terra XLSX correction ONE completed naturally after being preserved through
takeover. Its26767-byte text artifact has SHA-256
`ac57e2abf955d4fed4a4e8d0b9f7b5fc821943761b6b558086f344e875e6ae43` and
remains unapplied. Capture/release/exact-close receipts preserve settlement.
The text still needs complete executable test/source hunks, a behavioral RED
instead of missing-export linkage, and a precise native-output grant binding.
Fresh Terra correction TWO `task_454800403c7e` / `ctx_abf58647768a` owns only
the bounded save-binding proposal; oracle/runner/browser code remains pending.

Main ran no tests, builds or typechecks. All earlier failures and accepted
HTML/ACL slices remain intact. Note61 is confirmed; note62 records this
checkpoint through the designated UniAI coordinator. G0 and pilot are incomplete.

Grok subsequently observed the intended behavioral RED:37 tests,31 pass and
six HostCapabilityError failures, with module linkage successful and no source
or fixture drift. Main then applied r3 A1-A3 plus r4 A4/comment to the adapter
and created the separately suffixed r2 runner. The source receipt is
`main-docx-mount-r4-source-application.json`; adapter SHA-256 is
`8b3cc173be8bb17109cd8974c1ed96be2e9b832f51f8568e7e79a1cfb85136ea`.
Spec/config, runner r1 and original failure outputs stay unchanged.

The fresh Grok Dispatch ran the focused host-adapter and build-renderer tests
once after environment.ps1 with workspace-local temporary paths:71/71 pass,
exit0, no skips. Main verified38 candidate hashes and authorized a fresh
docs-only build to `main-docx-build-r2`; browser execution remains gated on the
actual new manifest. Evidence is under `grok-docx-mount-r2/`. Note62 is confirmed
with comment `0f57c6ef-c870-4d1b-8944-fffdf0bf2aab`, preserving UNI-656 status
and assignee. These focused results do not establish browser or G0 acceptance.

The fresh docs-only build then completed with exit0; manifest SHA-256
`a570bed98db595028fc613e57b458e9c940bb6b15f2726a2db1a64e21d6b2f5a` records the
pinned source and unchanged source closure. Grok ran the authorized real
Chrome/Edge kitchen-sink DOCX cycle:2/2 passed, runner status0/signalnull,
four session-open and two docs-save records. Reopened marker, unchanged fixture,
changed/stable saved output, equal media/relationships and empty diagnostics
are recorded in the inline PNG/JSON and independently inspected ZIP evidence.
An earlier wrapper JSON preparation failure occurred before runner startup
and remains recorded separately. Original Sol0/2 and old Grok zero-test rollover
remain immutable. Main executed no tests, builds or typechecks.

Cursor `ctx_828ed566fc74` independently accepted the source and this limited
Chrome/Edge cycle in `cursor-docx-mount-r3-review.md` (SHA-256
`bce8533ea63082b5fdbf8d3058d4aeb6c25868ffed7f5a65f99562119df464fd`). After
settlement capture/release/exact close, Main integrated the exact tested adapter,
focused test and DOCX spec into the UNI-667 worktree at07:30:47UTC. The guarded
application verified41 target baseline and38 candidate files; receipt
`main-docx-mount-r4-worktree-application.json` preserves backup/hash evidence.
The existing shared matcher adds DOCX while retaining Markdown and HTML; the
isolated config was not copied. Narrow shared-config discovery remains pending
with a NEW Full Access Grok thread. Existing test/build/browser evidence is
reusable for unchanged files. This accepts one fixture cycle, not G0/pilot,
Word fidelity, production, Safari, merge or done. XLSX correction TWO remains
live text-only. Note63 is confirmed; note64 records review and landing through
the designated UniAI coordinator. Main r5 takeover is prepared on the same Run.

### 2026-09-18: Main r5 ownership and parallel format worktrees

Main terminal `term_626412f5-2b33-473b-97c3-1e45c0cca2b7`, thread
`01a0b368-3f58-7d61-8545-620624bd58f6`, verified the SAME Run at generation8.
`main-coordinator-transfer-r5-accepted.json` records run-current/run-show and
Full Access launch evidence; `main-coordinator-transfer-r5-close.json` confirms
only outgoing Main8255a6cf was closed with ptyKilled=true. DOCX integration was
not rerun. Note64 is confirmed by comment `fee0e9e2-fb8c-482b-8567-3eadc2f02a41`.

Fresh Grok4.6/xhigh with always-approve/sandbox off owns discovery-only Task
`task_a2eea9a652f8`, Dispatch `ctx_5ab0f937eb6c`. Its new report/output root is
`grok-shared-discovery-r1`; no repeat test/build/browser cycle is authorized.

The user then explicitly requested parallel Terra xhigh format work on separate
worktrees. Main created XLSX, PPTX and PDF child worktrees under
`.uniwork-dev/worktrees/dev-uniwork/UNI-667-office-{format}-parallel-r1`, on
`feature/UNI-667-office-{format}-parallel-r1`. The parent Office source is still
untracked against HEAD97b4fa59, so Main copied and hash-verified the exact49
source/config/fixture baseline files into each lane. Receipt
`parallel-formats-r1-baseline.json` separates this baseline from later deltas.
Build/runtime outputs were not copied; no setup/install hook was run.

PPTX `task_172ebfca436c` / `ctx_2c863c589a8f` and PDF `task_4eee1c776cbd` /
`ctx_b8cf143ccecd` have observed turn_started in their exact worktrees; both TUI
receipts verify Terra xhigh/YOLO. They own only their proposal text artifacts.
Existing XLSX `ctx_abf58647768a` remains live and owns correction TWO/r3 plus
the shared native-output grant/save-report proposal. Its lane is prepared; it
was neither interrupted nor duplicated. Two undispatched empty readiness tabs
were closed after inspection when the user changed placement to separate lanes.

There is no whole-format sequencing requirement. Main applies each proposal
in its lane; a fresh Grok validates, Cursor reviews, and Main integrates each
accepted delta when ready. Shared grants have one owner. This checkpoint runs
zero Main tests/builds/typechecks and claims no new browser, G0/pilot or done
acceptance. Every prior failed outcome remains evidence.

Grok discovery subsequently settled successfully: one actual shared Playwright
`--list`, Node22.23.2, exit0, six entries in three files across Chrome and Edge.
Config and all three spec hashes were unchanged; fifty existing report hashes
were preserved. `grok-shared-discovery-r1/report.md` SHA-256
`1d82b186d01b537fd2e9aa300a86d5ec0ad5aaaed8d40cc3bc9c68bd76ad1c88`
records two wrapper preparation failures before the sole discovery process.
Main accepted the report, captured/released/exact-closed the external Grok
terminal with ptyKilled=true and ACKed `delivery_3fcacf0cbfa8`. No test or
browser cycle ran for discovery. Note65 is confirmed by comment
`4f0082ae-6f76-4fcc-b76c-3dab5af64946`, before this discovery acceptance.

The three parallel lanes reuse existing dependencies via workspace-local
junctions. `parallel-formats-r1-runtime-map.json` assigns separate logical
app/preview/engine port sets (XLSX5460-5462, PPTX5470-5472, PDF5480-5482), to be
checked for ownership and availability by future Grok execution. No listener
was started by Main. PPTX/PDF sent explicit lane/role ACKs. At07:54UTC Main
requested the long-running XLSX attempt persist its bounded checkpoint and
settle honestly before a supervised fresh-thread continuation; no replacement
was launched while it remained active.

At07:58UTC XLSX r3 settled as a complete bounded TEXT delivery,53587 bytes,
SHA-256 `f2d5c29313309aa0adee0ade408643497be43653cdd88ea52b0a4b1a2d7276a6`.
Main captured/released/exact-closed the old terminal and ACKed
`delivery_e805a73942c5`. The proposal remains unapplied. Static inspection found
stale-host reuse on a repeated event target, a Markdown test calling Sheets-only
desktopApi, broad write-grant acceptance that still allows reporting the working
copy as native publication, and test preparation defects (uppercase expected
hash, ESM require, Node25 instead of Node22, empty vs absent output). These are
source observations, not executed failures. The r3 partial checkpoint remains
separately preserved; the final r3 adds complete B/C hunks and route tests.

Fresh Terra xhigh/YOLO `task_b30d301a18fe` / `ctx_1a6ec2e03e09`, parent
`task_454800403c7e`, has observed turn_started in the XLSX worktree. It owns
correction THREE/r4 and the sole shared grant/save-report proposal; the brief is
`terra-xlsx-binding-r4-brief.md`. XLSX/PPTX/PDF now run as three distinct Terra
lanes. No source delta has been applied in these new lanes yet. All future
testing remains assigned to fresh Grok threads and review to Cursor.

### Main r6 takeover and parallel verification preparation, 2026-09-18

Incoming Main `term_bd0cb645-ac8a-4bca-8216-ced2eff8412a`, thread
`01a0b38a-d450-73a3-be1c-560b2db4098f`, bound the existing Run
`run_ff8d3bd5eeb4` at08:08:36UTC. Both current/show receipts confirm generation9.
Full Access Astra xhigh/YOLO was verified. The accepted receipt was written
before closing only outgoing `term_626412f5-2b33-473b-97c3-1e45c0cca2b7`;
the exact close receipt confirms ptyKilled=true. No Run or Main was duplicated.
All three Terra lanes and their proposal ownership remain live and unchanged.
Note67 is confirmed by comment `222af5f8-8115-49ba-95ed-7358dc2ee657`;
UNI-656 stays in_progress, assigned to mtruong.dev. Note66 was not resent.

Three fresh Grok4.6/xhigh always-approve/sandbox-off terminals were created in
the separate lanes, verified by launch receipts, and attached to new validation
Dispatches: XLSX `task_10f8e25a0a19` / `ctx_997ec3fa3c61`, PPTX
`task_9478803560e7` / `ctx_70534f4da31a`, PDF `task_49f5c0a894e5` /
`ctx_048c7cd88fae`. Initial scope is bounded preflight then WAIT_RED: hash the
49-file baseline and verify environment, with no test/build/browser execution
until Main provides an exact tests-only application receipt. The PDF prompt
remained in the composer after injection; Main inspected it and sent only Enter,
preserving the same Dispatch. Existing global/project hook failures are retained;
no global hook/config modification is authorized.

Main source inspection identified the existing slides save/report path still
reading the working target rather than native published output. PPTX/PDF workers
were told to make that dependency explicit and provide their independent format
handler text against the XLSX-owned shared grant contract. No second shared grant
implementation is authorized. Main has run zero tests/builds/typechecks and has
not reapplied DOCX or rerun shared discovery. G0/pilot remain incomplete.

### Intra-format parallel oracle wave, 2026-09-18

All three Grok preflights report exact49/49 baseline matches with no drift and
zero tests/builds/browser/server runs. They remain in WAIT_RED under their
existing assignments; the next test Dispatch still requires a fresh thread.

PPTX r1 reported successful text delivery, but Main rejected application:
the promised complete tests were prose-only; layouts used the wrong response
field; editText needed envelope unwrapping; native save publication was not
bound to the canonical view directory; mount reads and metadata remained
unproven. `main-pptx-r1-static-review.md` preserves the findings. The proposal
is unapplied. Main captured/released/exact-closed that settled worker and
started correction ONE/r2 `task_43b54f9cb63d` / `ctx_b51cb485c293`, Terra xhigh
Full Access, for bounded mount/adapter code and runnable tests. An attempted
rejection message raced settlement and returned dispatch_inactive; no retry
was sent into the settled mailbox. PDF r1 was explicitly narrowed to the same
mount/adapter delivery, retaining its Task/Dispatch and all earlier evidence.

Following the user's question about further parallelism within each format,
Main created three child oracle worktrees, copied and hash-verified the same
49-file baseline, and started independent Terra xhigh Full Access workers:
XLSX `task_1b430a0fde7a` / `ctx_5ea63bbb4633`, PPTX
`task_c35e051b72a2` / `ctx_3296d29c9a94`, PDF
`task_94302f4a32c2` / `ctx_dc8fbdc099ce`. Each has observed turn_started and
verified xhigh/YOLO launch evidence. The worktrees are
`.uniwork-dev/worktrees/dev-uniwork/UNI-667-office-{format}-oracle-r1`;
`parallel-oracles-r1-baseline.json` records their baseline. Their only writable
artifact is their own proposal text. They own independent saved-file oracle
helpers/tests, with no adapter/save/shared-module edits or execution. Main
will apply complete new-helper slices before Grok checks; missing-module
errors do not count as behavioral RED. Empty fallback shells were inspected
and closed individually after the real workers started.

XLSX r4 retains sole shared native-output grant ownership. Main's static read
of its in-progress proposal identified a reversed A11 insertion, a zero-byte
fixture assertion before the fake engine creates that file, and a redirected
native output root that would be trusted by a two-sided realpath containment
check. These were sent back before application. Worker parser checks are
preserved separately in `terra-xlsx-r4-parser-check-observed.json`, not treated
as Grok runtime verification. Main ran zero tests/builds/typechecks. No new
format acceptance, commit, push, release, issue done or G0/pilot pass is claimed.

### Expanded intra-format wave and bounded verification, 2026-09-18

The user explicitly requested more independent workers per format for speed.
Fourteen Terra xhigh Full Access tasks now own bounded text proposals: XLSX
publication correction FOUR/r5, oracle, browser, and runner; PPTX mount
correction ONE/r2, oracle, browser, runner, and save; PDF oracle, browser text,
runner, existing-image cycle, and save. Each slice has separate file ownership
and an isolated worktree where needed. `parallel-wave2-contract.md` defines the
shared oracle API and Main-serialized integration. Worktree receipts preserve
the exact copied 49-file source/config/fixture baseline. No output is copied.

PPTX/PDF save terminal-create calls timed out after creating actual terminals.
Main recovered the exact terminals through listing, verified Terra xhigh/YOLO,
and dispatched without duplication. PPTX save is `task_8bb9994be1e3` /
`ctx_e177bce68d10` at `term_8432bae4-ab13-4296-b9be-e7471b69f4ef`; observed
turn start and live brief/source reads confirm it is running.

Main applied only XLSX Amendment A (page bootstrap keyboard binding plus
save-chord tests). Grok `ctx_997ec3fa3c61` recorded RED11 with 4 passes and
7 intended behavioral failures; focused GREEN is 11/11. The combined command
with unchanged build-renderers tests remains exit1, 44/45: the existing fixed
ancestor workspace lookup misses pinned localImage.ts in deeper worktrees.
This failure is retained and assigned solely to XLSX runner
`ctx_a26ccd7490cc`. Shared publication/grant r4 B/C remains unapplied; fresh
Terra r5 owns the correction. The settled Grok was captured/released/closed.
Cursor `ctx_6e9e748ef5e4` is independently reviewing the bounded A slice.

Main also applied PDF mount hunks and seven focused tests. Grok
`ctx_048c7cd88fae` recorded RED7 with one guard pass and six intended failures;
GREEN with the shared host-adapter suite is 44/44, exit0, empty stderr, on
Node22.23.2. The succeeded bounded test delivery was accepted, captured,
released, and its exact external terminal closed. Fresh Cursor
`ctx_2b59c4a66381` is reviewing. Native save, build, and browser remain pending.
PPTX tester `ctx_70534f4da31a` still waits for mount tests under its existing
Dispatch. Every later Grok Dispatch must use a fresh thread.

Main has run zero tests/builds/typechecks. No new format integration is claimed
at this checkpoint. DOCX and shared discovery were not rerun. All operation
failures remain in `main-r6-operation-failures.json`; G0/pilot is incomplete.

### First reviewed parallel deltas integrated, 2026-09-18

Cursor accepted isolated XLSX Amendment A and the focused 11/11 evidence,
while explicitly retaining combined44/45 exit1 from the unchanged workspace
resolver. Review `cursor-xlsx-save-chord-r4-review.md` is
`760053b47be9a6d11997880247b827e52a54e48187c23f68c6210ad00f1cc658`.
Main copied exactly the reviewed bootstrap and save-chord test bytes into
`UNI-667-office-editor-spike` at09:21:39UTC. The receipt
`main-xlsx-save-chord-r4-integration.json` records all49 prior baseline guards,
backups, copied hashes, and the unresolved combined-check failure.

Cursor then accepted PDF mount A-F and Grok44/44 exit0. Review
`cursor-pdf-mount-r1-review.md` is
`a8a52d5d1d152dfac9106838e4f5ed547c54128da7fe02f35e52bbdfb06d7873`.
Main copied exactly the reviewed host adapter and PDF mount test bytes at
09:26:44UTC, guarding all50 prior baseline/XLSX files and preserving every
unrelated byte. `main-pdf-mount-r1-integration.json` records this operation.
Both review Dispatches settled successfully and were captured/released before
their exact external terminals were closed. No Main test/build/typecheck ran.

Fourteen Terra workers continue independent text proposals, while existing
PPTX Grok remains WAIT_RED. XLSX native publication, resolver, all three real
save/reopen browser cycles, and PDF existing-image cycle remain pending.
No completed DOCX/discovery work was rerun. G0/pilot remains incomplete.
