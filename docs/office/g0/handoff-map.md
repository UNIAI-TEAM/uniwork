# HANDOFF MAP - DOC-006 plan items 6.5 and 6.6 (g119 r2)

> **Status:** candidate for M; canonical files and UniAI stay read-only. Issue UNI-670 (DOC-006), plan task 6.
> This is the **r2 refresh** of `../HANDOFF-MAP.md` (SHA-256 `8B17BDEB...`): the DOC-003 r2 port items
> (P1-P5), the Q7 blocker owner split and the DEC-RENDER-TOLERANCE user decision are now folded into the
> per-group tables. Every tracker statement below was read with `uniai issue get <KEY> --output json` on
> 2026-09-25; the raw JSON receipts are in `../receipts/uniai/` (`UNI-656.json`, `UNI-657.json`,
> `UNI-658.json`, `UNI-659.json`, `UNI-636.json`, `UNI-660.json`, `UNI-635.json`, `UNI-661.json`,
> `UNI-662.json`, `UNI-670.json`, `issue-list-project.json`). Nothing was written to UniAI from this slice.

The plan's acceptance line for task 6 is that a **new implementation group can receive the artifact, understand
scope and limits, re-run the evidence and plan G1-G7 without guessing decisions that do not exist**. This map
therefore gives, for each group: (1) the artifact it receives, (2) the acceptance criteria it will be judged by,
(3) the decisions that are still open and must not be guessed.

## 1. The mapping as it stands today (read from the tracker, not inferred)

| G | Issue | Title (as read) | State | Mapping written in the issue? |
| --- | --- | --- | --- | --- |
| G1 | UNI-657 | C-01: Documents foundation - data, API, library, versions and access | `todo` (urgent) | No - the text says "Planning group 2 from UNI-655" |
| G2 | UNI-658 | C-01: Shared Office engine and web/desktop adapter layer | `todo` (high) | No - "Planning group 3" |
| G3 | UNI-659 | C-01: Web editors for DOCX, XLSX, PPTX, PDF, Markdown and HTML | `todo` (high) | No - "Planning group 4" |
| G4 | UNI-636 | C-16 - Office Bridge: open a document with UniWork Office and save back a version | `todo` (high) | No - C-16 roadmap row |
| G5 | UNI-660 | C-01: Bidirectional Office sync, offline queue and conflict handling | `todo` (high) | No - "Planning group 6" |
| G6 | UNI-635 | C-15 - DOCX import and human-approved AI edits through the Office sidecar | `todo` (high) | No - C-15 roadmap row |
| G7 | UNI-661 | C-01: Multi-format integration verification and release evidence | `todo` (high) | No - "Planning group 8" |
| - | UNI-662 | C-01 advanced: Real-time multi-user document coauthoring | `todo` (medium) | Separateness is stated ("explicitly separate from device/file synchronization") |
| - | UNI-671 | QA-01: Real macOS browser/device fidelity checks | `backlog` | Deferral is stated in UNI-670's text |
| parent | UNI-656 | C-01: Multi-format architecture and six-format capability proof | `in_progress` | INT-01 and the branding decision are recorded there |

**OPEN-1 (coordinator readback, blocking this plan item's "Dat" line).** The G1-G7 mapping is *consistent* with
the plan and the issue texts, but it is **not confirmed in the tracker**: no issue carries a `G<n>` line, and
each of UNI-657/658/659/660/661 only records a UNI-655 planning-group number that does not equal its G number.
This slice cannot write to UniAI. Action for the Advisor/user: add one line per issue, for example
`G<n> of the G0 -> G1-G7 mapping (plan docs/superpowers/plans/2026-09-16-documents-office-g0.md Task 6.5)`, and
record the date/applier. The sibling slice's reconciliation (`.uniwork-dev/orca-recovery-g119/doc001-adr/COORDINATOR-SYNC.md`)
proposes the same lines plus two text corrections (UNI-635 still cites superseded ADR 0018 and a DOCX-only
scope; UNI-636 cites ADR 0018); those edits are compatibility, not decoration - without them G6 re-enters the
DOCX-only scope that G0 just opened.

**OPEN-2 (ADV-002 has no owning issue).** The capability inventory tags exactly four rows `ADV-002`
(`pptx-audit`, `file-parse-image-multimodal`, `mcp-agent-drive`, `cli-headless-convert`) with the vocabulary
entry "advanced scope extension with its own issue; not part of the M1 pilot hand-off". The project issue list
was read to exhaustion for this claim: `uniai issue list --project 57602a20-... --limit 100 --offset 0|100|200|300`
returned 100 + 100 + 100 + 13 = **313 of 313 issues** (`has_more: false` on the last page; receipts
`../receipts/uniai/issue-list-project-offset-{0,100,200,300}.json`), and a search of every returned title and
description finds **no** issue naming any of the four capability ids or `ADV-002`. Four issues mention "advanced"
(UNI-670, UNI-662, UNI-656, UNI-655); only UNI-662 is an advanced slice and it covers coauthoring alone.
Action: the Advisor/user names the owning issue (or records that the four rows stay unowned and out of scope)
before anyone plans them. (An earlier draft of this map claimed the same negative from a first page of 100 of
313 issues; the conclusion survived a complete read, and the receipts above are the ones to cite.)

## 2. What each group receives

### G1 - UNI-657 (Documents foundation: data, API, library, versions, access)

| Receives | Where |
| --- | --- |
| The version/save protocol: working revision vs checkpoint vs immutable blob, base revision + checksum + idempotency key, stale base keeps both versions | `docs/office/g0/login-sync-contract.md` sections 3, 3.1 |
| The change-feed contract: identity by account/org/workspace/document, cursor, pagination, retention, full resync, tombstone | same, section 5 |
| One error table for the client (`errorClass`, 422/409 kept) | same, section 4 and 4.1 |
| The mandatory-case evidence: 17 accepted cases, 4 of them with real durable draft bytes | register gate `G0-DOC005-MANDATORY`; `login-sync-contract.md` section 8 |
| Storage ownership: Go owns auth/ACL/quota/idempotency/version/audit/outbox commit and the orphan-object ledger; the engine owns no business table | `RUNTIME-CONCLUSION.md` section 1; `docs/office/g0/engine-contract.md` sections 9-11 |
| Rollout order steps 1-3 (errorClass, payload fingerprint migration, mismatch switch) | `login-sync-contract.md` section 9.1 |
| Provenance record shape for the Q7 conversion copy (source id + sha256 on the new OOXML file) - implemented in G1/G2, contract in DOC-005 | `doc003-evidence/r2/Q7-BLOCKER.md` owner section; plan 5.4 |

Acceptance criteria it must satisfy: migration rules of the repo (no FKs, concurrent indexes, `organization_id`,
append-only audit); idempotency keys are payload-fingerprinted so "same key, different payload" is a conflict,
not a hit; the version commit and the audit/outbox rows share one transaction; the orphan-object ledger has a
reconciler; nothing in the engine writes a business table. Open decisions: none are left open by G0 for G1 -
the ordering and the additive/flag-gated rollout are fixed in section 9.1; what remains is implementation.

### G2 - UNI-658 (shared engine, web/desktop adapters)

| Receives | Where |
| --- | --- |
| Per-operation runtime decisions with proof or blocker, and the INT-01 deviations that must not be hidden | `RUNTIME-CONCLUSION.md` sections 1-3; `CANDIDATE-module-runtime-map.g119.json` |
| Packaging matrix (web bundle / private engine service / desktop host / native sidecar) and version negotiation + rollback rules | `PACKAGING-AND-HANDOFF.md` sections 1-2 |
| Monorepo layout proposal, dependency direction, public entry rules, catalog conflict | same, section 4 |
| The clean-checkout proof and its **named** missing pieces (prepared pinned source with local esbuild; untracked `e2e/office-g0/lab/fixtures/g0-text.pdf`; runner temp/git discovery to pin) | same, section 5b |
| The six proven browser cycles as the acceptance baseline, plus CONTRACT-v1 (lab bridge protocol) as the adapter boundary | register `E-*-CYCLE` rows; `docs/office/g0/CONTRACT-v1.md` |
| Import-graph proof that no unguarded node/electron/native marker is in the six browser closures | `doc003-evidence/candidates/browser-proof.md`; `receipts/tester-b/import-graph.json` |
| **r2: the Q7 conversion engine work item** - a legacy/ODF -> OOXML conversion engine, service side, never in the browser bundle; none exists today (`xlsx-open` reads OOXML only, `.xls` answers `invalid Zip archive: Could not find EOCD`; no convert op in the lab allowlist or engine routes). The service choice lands in DOC-004's contract | `doc003-evidence/r2/Q7-BLOCKER.md`; `r2/ROOT-CAUSE.md` D6 |
| **r2: port item P5** - password-protected DOCX save: carry the password-intent state (set/clear/intent revision; `setDocPassword`/`docPasswordIntentRevision`/`discardDocPasswordIntents`) to a service that re-encrypts, or refuse save by policy; the lab stub is not a product answer; passwords never leave the client unencrypted | `doc003-evidence/r2/PORT-ITEMS.md` P5 |
| **r2: port item P3's adapter half** - a failed open must report its failure class to the shell so a Workspace file never looks like an empty version of itself | `doc003-evidence/r2/PORT-ITEMS.md` P3 |

Acceptance criteria: the ported engine builds from a clean checkout with no `../genoffice` and no private
registry; it builds against the UniWork catalog (React 19.2.3 / TipTap 3.30.6) without raising the product
catalog; the browser entry stays free of node/electron/native imports; the six DOC-003 cycles re-run on the
ported engine and the DOC-004 fault gate is closed with real-adapter rows (6 of 7 cases are unaccepted today);
no `/ee` path exists in the fork. Open decisions: how PDF existing-image editing is hosted (Node-safe decode
adapter vs desktop host); whether the PPTX shape gesture implements `host:slides-edit-transform` or refuses it;
where the XLSX sidecar process lives in deployment; how the catalog conflict is resolved; **r2 adds: which
conversion engine covers BIFF8/ODF/RTF/XLSB for Q7** (none exists - this is a build/choose decision, not a
port of existing behaviour).

### G3 - UNI-659 (web editors for the six formats)

| Receives | Where |
| --- | --- |
| Per-format required assertions (the acceptance contract of each editor) | `docs/office/g0/pilot-handoff.md` section 1.2 |
| The measured thresholds: measured open envelopes for **all six formats** (n = 3 cold + n = 3 warm each, two independent runs), the remaining `chua do` gaps (per-format saves, large-fixture opens, memory limits, XLSX warm definition), and the render-tolerance decision that is still open | `r2/THRESHOLDS.md` sections 3-6 |
| **r2: DEC-RENDER-TOLERANCE ownership** - G3 measures the per-format pixel diffs (edited region masked, fixed viewport/DPR, on `WIN-ORCA-1.4.209`); a named human reviewer then signs. Until signed, a row claims only what its part/object oracle proves | user decision 2026-09-25; `r2/THRESHOLDS.md` section 4 |
| **r2: the named upstream-behaviour port items P1-P4** - P1 named localized PDF parse error instead of the fixed "Failed to open file"; P2 missing-fonts check must count adopted embedded faces; P3 failed DOCX open keeps a named error state bound to the file id, never a blank document offered for Save; P4 sheets failed-select shows an error state, not a shell + status line | `doc003-evidence/r2/PORT-ITEMS.md` P1-P4 (closing tests named per item) |
| **r2: the Q7 warning/cancel/accept UI** - the dialog that lists what a conversion will change, creates nothing on cancel, and produces a copy with provenance on accept | `doc003-evidence/r2/Q7-BLOCKER.md` |
| The editor-shell requirements: resolve document type, permission and save state, then open the matching editor or a truthful unavailable/read-only state; no Electron IPC in the browser | issue UNI-659 text; plan task 1 FE spec |
| Brand rows for web: navigation entry, editor chrome, i18n parity, theme must not change authored bytes | `uniwork-office-integration-brand.md` B-12, B-16 and section 4 "theme" check |
| Known defects to fix, not discover: 375 px with the AI panel open collapses markdown/slides/html to a 0 px document; brand width 1280 px not measured; DOCX core row edits paragraph text only | `pilot-handoff.md` section 3 limits; brand doc section 3 |

Acceptance criteria: each format's required assertions pass in the real browser host; HTML preview stays
isolated and a session read is refused; the editor never depends on Electron IPC; the theme change does not
alter document bytes; accessibility and i18n rules of the repo hold. Open decisions: `DEC-RENDER-TOLERANCE`
is now decided in form - **OPEN, owned by G3, signed by a named human reviewer** (user decision 2026-09-25);
the per-format `chua do` list narrowed to saves / large fixtures / memory limits / the XLSX warm definition
(the open envelopes are measured); how the unavailable/read-only state is presented per format; the P1-P4
behaviours are work items, not decisions.

### G4 - UNI-636 (desktop: login, deep link, identity, brand, Office Bridge)

| Receives | Where |
| --- | --- |
| Desktop login contract (PKCE S256 BASE64URL, client owns verifier/state/pending attempt, callback must match; token in host secret store) | `login-sync-contract.md` section 2 and 2.1-2.2 |
| `device_sessions` + desktop exchange endpoint as a G4 item | same, section 9 rows 2 and 5; section 9.1 step 5 |
| The four mandatory bridge behaviours: idempotent complete, 409 on stale version, revocation mid-session refuses completion, cross-organization isolation with no metadata leak | issue UNI-636 text |
| Identity/brand values (proposed, none existing at the pinned commit): app id `com.uniwork.office`, executable `uniwork-office`, artifact `uniwork-office_<version>_<arch>`, scheme `uniwork-office` incl. `uniwork-office://auth/callback`, user-data namespace `uniwork-office`, UniWork-owned update feed | `PACKAGING-AND-HANDOFF.md` section 3; brand rows B-01..B-15, B-17 |
| Q8 draft behaviour that must survive logout/restart, and Q7 conversion-copy behaviour | `login-sync-contract.md` sections 6-7 |

Acceptance criteria: installs beside GenOffice with no shared app id, scheme, data dir or update feed; a
callback never opens the wrong application; the four bridge behaviours have automated tests; drafts survive
logout/restart and are protected per account; a desktop row records engine version and provenance. Open
decisions: the final values of every identity item (proposed, not decided); whether the desktop host also
carries the PDF image-edit path that is Electron-bound upstream; keychain/store choice.

### G5 - UNI-660 (sync, offline queue, conflict handling)

| Receives | Where |
| --- | --- |
| Change feed + cursor + retention + tombstone as real service behaviour, and the client's `change_cursor_expired` -> full resync path | `login-sync-contract.md` section 5, 9.1 step 4 |
| Draft namespace per account with `blocked`/`conflict` states, modelled on `drafts/cleanup-registry.ts` | same, sections 6, 9 row 4 |
| The no-silent-overwrite rule: a stale save is an actionable conflict that keeps local work and both versions | issue UNI-660 text; plan Q7-B |
| Q5-A: the full offline desktop library and durable queue exist **before** M2 | plan decision table; `pilot-handoff.md` section 5 |
| The E2E families to re-run at G5 (two-client conflict, logout/restart on a real binary, revoke between upload and commit, full resync after a long disconnect) | `login-sync-contract.md` section 9 |

Acceptance criteria: a long disconnect resyncs without resurrecting deleted files and without replaying into
another account; conflicts preserve both versions; offline queue retries are idempotent; device sign-out and
revocation are audited. Open decisions: retention window values and resync UX; library scale targets (the only
measured band today is the Q9 `[49 MiB, 50 MiB)` fixture, not a quota); how much of the queue is visible to
the user.

### G6 - UNI-635 (DOCX import + human-approved AI edits)

| Receives | Where |
| --- | --- |
| The per-part OOXML classification oracle (preserved / changed / added / removed, with hash evidence) that its acceptance text already demands | `doc003-evidence/oracle/docx-parts-diff.mjs` + the two accepted cycles |
| The stop-and-say-so rule when a patch cannot be applied safely, and "original is never overwritten" | issue UNI-635 text; plan 5.4/Q7 |
| Engine contract and the ownership boundary (bytes and versions live in Documents; engine never writes a business table) | `engine-contract.md` sections 9-11; `PACKAGING-AND-HANDOFF.md` section 1 |
| AI proposal -> human confirm -> execute, with the audit fields | repo `CLAUDE.md` (ADR 0010); `login-sync-contract.md` section 7.1 for provenance |

Acceptance criteria: real Vietnamese/bilingual fixture set through import -> AI proposal -> accept -> patch ->
new version -> download -> reopen in Word; per-part hash classification recorded; the original's checksum is
unchanged before and after; cross-organization isolation tests pass. Open decisions: the issue text still
points at superseded ADR 0018 and says "only DOCX; XLSX/PPTX/PDF are out of scope" while ADR 0021 opens all six
formats - the correction is proposed in `doc001-adr/COORDINATOR-SYNC.md` section 2 and needs the coordinator to
apply it (see OPEN-1).

### G7 - UNI-661 (integration verification and release evidence)

| Receives | Where |
| --- | --- |
| The register and its verifier command, with the GO decision and its limits | `docs/office/g0/evidence-register.json`; `pilot-handoff.md` sections 1, 3 |
| The measured thresholds and the explicit `chua do` list to close before publishing support/fidelity limits | `r2/THRESHOLDS.md` |
| The seven brand acceptance checks and the attribution allowlist | `uniwork-office-integration-brand.md` sections 3.1, 4 |
| The release rule: bumping a version is not a gate, re-running the fixtures and the fault harness is | `PACKAGING-AND-HANDOFF.md` section 2 |
| Residual items to clean up or record: the DOC-004 external temp tree `%LOCALAPPDATA%\Temp\office-g0-iQLGS5`, the 13-fixture regeneration drift, and **r2 adds fixture item F1** (an embedded-font fixture whose family is neither bundled by the renderer nor installed on the test host, with a glyph-advance oracle - owner DOC-002 UNI-666) | `PACKAGING-AND-HANDOFF.md` section 5b; `doc002-fixtures/REPORT.md` limits; `doc003-evidence/r2/PORT-ITEMS.md` F1 |
| The macOS/Safari deferral (UNI-671) that must be closed for full pilot platform acceptance | UNI-670 text; QA-01 |
| **r2: the named reproducibility finding to re-run** - the XLSX warm-state spread (~44% cross-run), closed by a larger-n first-reload vs steady-state separation run | `doc003-evidence/r2/receipts/tester-r2b/REPORT.md`; `r2/THRESHOLDS.md` section 5.3 |

Acceptance criteria: web edit -> cloud version/audit -> desktop open/edit -> cloud sync -> web receives the
version, on real installers; permissions/revocation, tenant isolation, migration compatibility, offline/retry,
conflict, accessibility and performance budgets all evidenced; published support/fidelity limits match the
register; packaging/update identity proven on a real binary. Open decisions: Mac device availability; pixel
tolerance (owned by G3's measurement + the named human reviewer signature - see G3); the per-format
save/large-fixture/memory budgets still `chua do`; whether the 13 drifted fixtures are re-pinned or annotated
per entry.

## 3. Brand integration criteria (plan item 6.6)

The brand hand-off is "what the receiving group must prove", not a colour decision:

1. **Targets that are still empty and must not be invented by a receiving group.** Every value below is a
   proposal in `PACKAGING-AND-HANDOFF.md` section 3 and `uniwork-office-integration-brand.md` section 3, and
   none exists at the pinned commit `09485f88`.

| Target | State today | Owner |
| --- | --- | --- |
| App / bundle id, executable name, installer artifact name | proposed (`com.uniwork.office`, `uniwork-office`, `uniwork-office_<version>_<arch>`), not decided | G4, G7 |
| Deep-link / URL scheme and internal schemes | proposed (`uniwork-office`, `uniwork-office-app`, `-preview`, `-asset`), not decided | G4, G5 (auth callback), G3/G4 (preview/asset) |
| User-data / cache / token-store namespace | proposed (`uniwork-office`), not decided | G4, G5 |
| Update feed | only the disqualifier is fixed (never the upstream GenOffice feed); the UniWork channel does not exist | G4, G7 |
| Brand 1280 px layout | **not measured** | G3 (with G7 verification) |
| Web navigation entry + editor chrome for Office (row B-16) | not built | G1 (route), G3 (chrome) |
| Icon/wordmark set from `packages/ui/brand/` in installers and UI | source is UniWork, not upstream; not yet applied to a binary | G3, G4 |

2. **Allowlist that is kept (not brand).** LICENSE (Apache-2.0), NOTICE + Mainfunc, Inc., the fork commit and
   engine provenance, internal `@genoffice` package/import names, engine names in technical metadata
   (A-01..A-05). Nothing else may show "GenOffice"/"Genspark" in UI, titles, menus, About, installers,
   shortcuts, icons, notifications or any user-visible string.
3. **Acceptance checks (each needs real evidence - a binary, a screenshot, a command log - not a grep).**
   No upstream brand outside the allowlist; GenOffice coexistence without collision; an update cycle that
   refuses upstream binaries; a theme change that does not alter authored document bytes; no `/ee` path in the
   fork (CI step); LICENSE/NOTICE intact; the same account/permissions/history across web and desktop.
4. **Separation to keep.** Coauthoring (UNI-662) is "explicitly separate from device/file synchronization" and
   must not be bundled into G5 or claimed to follow from versioned storage; the four ADV-002 capability rows
   are not part of the M1 pilot hand-off and need their own issue (OPEN-2).

## 4. What this map does not claim

- It does not claim the tracker mapping is confirmed (OPEN-1), that ADV-002 has an owner (OPEN-2), or that any
  proposed identity value has been chosen.
- It does not re-state the G0 GO; the register and `pilot-handoff.md` are the authority for that decision and
  its limits.
- It does not open G3/G4 work on unsettled assumptions: the per-capability runtime decisions and the ADR
  supersession are inputs G3/G4 consume, not decisions this document makes.
- It does not claim the r2 port items (P1-P5, Q7 engine, fixture item F1) are scheduled - they are named,
  owner-mapped work items only; scheduling is the receiving group's job.
