# UniWork Office - G0 pilot hand-off (G0 decision: GO, pilot not accepted)

> **Status (2026-09-25): the G0 gate decision is GO** - recorded by the user on the
> integrated register (section 3). This is a G0 feasibility result, **not** pilot
> acceptance and **not** whole-task acceptance of DOC-001..006 (see the ledger
> reconciliation in section 3). This file started as the DOC-006 worker's hand-off
> scaffold (UNI-670); the g119 slice delivers DOC-006 6.2/6.3/6.5/6.6 in three companion files (r2 refresh,
> 2026-09-26): the measured thresholds and the still-open render-tolerance decision in
> [acceptance-thresholds.md](acceptance-thresholds.md),
> the costed M1/M2 estimate in [m1-m2-estimate.md](m1-m2-estimate.md) (it replaces section 4 below), and the
> per-group receive/acceptance/open-decision map in [handoff-map.md](handoff-map.md). Subordinate acceptances are pinned below;
> Advisor integrates this packet and the human reviewer decides full acceptance. Product display name is **UniWork Office**; the technical
> slug is **uniwork-office**. GenOffice stays an upstream source name only.

**Issue:** UNI-670 (DOC-006) - **Parent:** UNI-656 - **Roadmap:** C-01.
**Spec:** [Documents + Office G0](../../superpowers/specs/2026-09-16-documents-office-g0-design.md).
**Plan:** [G0 implementation plan](../../superpowers/plans/2026-09-16-documents-office-g0.md) task 6.
**Register:** [evidence-register.json](evidence-register.json) - **Verifier:** scripts/office-g0/verify-evidence.mjs.

## 1. Reproducible acceptance command

The register is machine-checked. Every evidence row names its own command, cwd
and structured artifacts; this section only describes how the register itself is
verified.

From this worktree or main, on pinned Node 22.23.2, with the explicit current
central-evidence and owned portable-copy roots:

    node scripts/office-g0/verify-evidence.mjs --registry docs/office/g0/evidence-register.json --root . --artifacts "D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/office-g0" --artifacts ".uniwork-dev"

The previous 33 PPTX/checksum artifacts are already integrated in E. The new XLSX
proposal uses P/.uniwork-dev/xlsx-evidence-reconciliation-g48/artifacts; after Advisor
applies this guarded evidence package to E, the extra .uniwork-dev root can be omitted.

Exit codes and the separate decisions:

- **valid** - the register is internally consistent. Duplicate row or gate ids,
  an unknown status or level, a row whose declared evidence class is stronger
  than its own operation evidence, an impossible platform deferral, a missing
  required gate or core format, a required gate that does not enumerate its
  canonical cases, unknown or conflicting provenance, a retargeted or
  identity-sharing artifact, an unlabeled modeled-authorization claim, and an
  absent, tampered, out-of-role or out-of-root artifact all make the register
  invalid. A **coverage shortfall** - a missing required assertion, case,
  artifact or required browser pair - is a warning that keeps the register valid and
  the gate unsatisfied, so an honest incomplete register stays a valid NO-GO.
- **go** - every required G0 gate is satisfied by accepted rows at or above the
  gate's evidence level, operation evidence, required assertions and the
  required browser pair (the Orca embedded browser on Windows, per the G0 decision
  of 2026-09-25; installed Windows Chrome/Edge and macOS/Safari are deferred and
  never substitute), with every required case covered. Adding --require-go makes
  the process exit non-zero while that is not true.
- **q1bSatisfied** - Q1-B pilot capability coverage. **pilotReady** - a
  separate human pilot decision. Both are reported. Neither gates the G0 go,
  and no count alone implies pilot readiness.

There is deliberately **no** --require-pilot shortcut: pilot acceptance needs
deferred Mac device QA, product integration and the advanced port, which are not
G0 gates, so a flag here would be misleading.

An honest, complete **NO-GO** report is a **valid** register. The reportStatus
field reports COMPLETE once every required gate reached a terminal state
(satisfied, failed or deferred) and INCOMPLETE while a required gate is still
pending. Evidence completeness is therefore independent from go/no-go.

### 1.1 Evidence classes and structured artifacts

Levels, weakest first: source-read, fixture-generation, modeled, harness,
engine-round-trip, browser-real, product-e2e. Operation evidence is separated
in the same way: source-inspection, fixture-generated-operation,
modeled-operation, byte-verified-operation, real-adapter-operation.

A browser editor cycle requires level browser-real or above, a real adapter, a
real editor UI kind, byte-verified operation evidence, a real OS and browser
family with a version, runtime provenance, engine name and version, and the
protocol version. A browser **launch** row can never satisfy an editor-cycle
gate. A source read, a generated fixture, a model or a contract harness can
never satisfy a browser, real-adapter or product-E2E requirement.

Every accepted row carries **structured artifacts**. Each artifact has a
**role** (report, transcript, immutable-input, persisted-output,
reopened-output (scoped PPTX/XLSX), render-evidence, extraction-evidence, or the
pre/post-edit extraction and render roles), a path, a byte size and a sha256, and a **ref**. For a
core-cycle row the ref must equal `fixture/format/operationId`, and the row
needs an immutable input, the persisted output, a report or transcript, and
independent render/extraction evidence as **separate artifact identities**:
one file never stands in for two roles, and one artifact file belongs to one
accepted row, so two browsers or two formats cannot attest one set of files.
Identical bytes in two distinct files stay valid - two deterministic runs may
publish the same content - so the verifier binds identity, not hash inequality.
The verifier byte-checks every artifact; a hash of the registry JSON itself is
not cycle evidence. The recorded provenance is an **attested test record**: the
verifier checks the record's internal consistency, but it does not attempt to
prove that a human actually ran the named command.

### 1.2 Required assertions per format

Rows may group assertions from one real UI cycle, but every required assertion
must be present and passed. The required groups come from the plan task 3
minimum table:

| Format | Required assertions |
| --- | --- |
| DOCX | text change, table preserved, image preserved, fresh-session reopen |
| XLSX | cell value change, formula recalculated to a numeric value, expected formula value, sheet structure preserved, fresh-session reopen |
| PPTX | text, image and shape change, objects preserved, fresh-session reopen |
| PDF | existing text change, image change, independent pre/post extraction and pre/post render, annotation not substituted, page structure preserved |
| Markdown | source change, assets resolve, unrendered table preserved, fresh-session reopen |
| HTML | source change, assets resolve, preview isolated, session read refused, fresh-session reopen |

The measured envelopes behind these assertions (per format and per machine, with sample counts - r2 adds the
XLSX/PPTX/PDF/Markdown/HTML cold+warm open envelopes and the independent tester-r2b check) and the list of
values that are still `chua do` live in [acceptance-thresholds.md](acceptance-thresholds.md). A format whose
budget is not measured yet may pass its correctness assertions; it may not claim a performance or fidelity
threshold.

## 2. What G0 requires, and what it does not

> **G0 browser scope (user decision, 2026-09-25).** For G0 every core-cycle
> gate is satisfied by rows run in the **Orca embedded browser (Chromium) on
> Windows**; each row records the exact Orca version and embedded Chromium
> version, the versioned engine/adapter protocol string on the browser save
> path, the manifest fixture identity and the engine identity. Installed
> Windows Chrome/Edge and macOS/Safari are **not** required at G0 and are
> recorded as a later-phase deferral; the accepted scoped rows stay valid as
> non-gate rows. The verifier enforces the Orca-only pair for the six
> G0-CORE-* gates; a register that still declares the installed-browser pair
> for a required core gate is reported as a stale scope warning.

Required gates (all must be satisfied for GO):

| Gate | Kind | Level | What satisfies it |
| --- | --- | --- | --- |
| G0-CORE-DOCX/XLSX/PPTX/PDF/MD/HTML | core-cycle | browser-real | Accepted **Orca embedded browser (Windows)** rows of that format, each an open-edit-save-reopen cycle with a real editor, the required assertions and structured output/extraction artifacts. Every row records its Orca version, its embedded Chromium version, the versioned lab protocol string and the engine identity it ran with (the 2026-09-25 decision below) |
| (not a gate) E-DOCX-TABLE-SCOPED-*, E-PDF-TEXT-SCOPED-CHROMIUM, E-PPTX-IMAGE-SCOPED-* | scoped-browser-cycle | browser-real | Accepted **scoped** cycles recorded for the record, not referenced by any required gate: the DOCX table cycle (installed Windows Chrome 153.0.8010.50 + Edge 153.0.4234.48), the PDF text cycle (Orca embedded Chromium 150.0.7871.250), and the PPTX existing-image cycle (installed Windows Chrome 153.0.8010.50 + Edge 153.0.4234.48). They close no gate: see section 3 |
| G0-DOC004-FAULT | doc004-fault | harness | The real spike-adapter fault cases: type/version mismatch, malformed result, checksum mismatch, timeout, cancel-vs-complete race, crash/restart, and metadata/original access with the engine down. **Status: blocked** - malformed-result is accepted on the real adapter; the other six lack accepted canonical real-adapter coverage; checksum reference acceptance is scoped separately |
| G0-DOC005-MANDATORY | doc005-mandatory | harness | The mandatory login/sync/version/draft cases, each with an expected state, permission outcome and recovery path; the draft-persistence cases additionally need a real local-store persisted-output artifact and a passed fresh-store recovery assertion. **Status: satisfied** - all seventeen cases have an accepted, case-bound row |

The DOC-004 fault cases use the **real spike adapter**; a modeled harness alone
does not close that gate. The DOC-005 gate carries two honest halves: the
**draft-persistence** cases (logout/restart with drafts, account B unable to
read or send A's draft, A losing rights, failed commit preserving the head) run
against a real durable local draft store and need a real persisted-output
artifact plus a passed `draft-recovered-from-fresh-store` assertion, while the
remaining cases stay an explicitly labeled modeled reference for remote
authorization, version and commit semantics. G0 does not claim a real product
authorization backend. Neither gate may be closed by a single bundle PASS:
every required case needs its own accepted row and artifact identity. A missing
or failed case is a **warning** that keeps the register valid and the gate
unsatisfied; a row that bundles several case ids, reuses an artifact file, or
labels its authorization provenance untruthfully is an **error**.

The required DOC-005 cases cover the full plan list: same-base saves, retry with
the same payload, same key with a different payload, lost commit reply, failed
commit preserving the head, logout/restart with drafts, account B unable to
read or send A's draft, A losing rights, A's base changed, quota exhaustion,
revoke during upload/commit, Work Product copy/rights, tombstone, expired
cursor, client/engine mismatch, and expired or reused token/code. All seventeen
now have an accepted, case-bound row. Four of them - logout-restart-drafts,
account-b-cannot-read-or-send-a-draft, a-loses-rights and
failed-commit-preserves-head - carry real durable draft bytes and a passed
draft-recovered-from-fresh-store assertion executed over those bytes. Three of
those four (logout-restart-drafts, account-b-cannot-read-or-send-a-draft,
a-loses-rights) preserve byte-identical copies of the drafts the R9 run left on
disk; the fourth, failed-commit-preserves-head, is written by its own real
byte-store execution because the R9 run exercises that case in memory and leaves
no durable file, and its row cites that tool as its command. The remaining
thirteen stay an explicitly labeled reference model (adapter "model",
authMode "modeled").

Explicitly **not** required at G0:

- the G3 advanced full port (the whole upstream capability matrix implemented);
- the G7 product end-to-end run (web-server-desktop across installers).
  A required gate that demands product-E2E evidence is rejected as a G0 scope
  violation. Optional gates may still carry it without failing validation.

Q1-B remains a **pilot** requirement, tracked in registry.q1b: every
inventoried upstream capability must be verified on both web and desktop before
pilot acceptance. The six basic cycles alone never satisfy Q1-B. Pilot
readiness is recorded separately in registry.pilot and is **not assessed** in
this scaffold; full pilot acceptance additionally needs the deferred real Mac QA
(UNI-671), product integration and the advanced port.

macOS/Safari rows stay optional and never satisfy a required Windows gate. The
UNI-671 deferral is parsed order-independently, so listing Safari before macOS
is still valid. Installed Windows Chrome and installed Windows Edge rows are
likewise optional at G0: under the 2026-09-25 decision only an
Orca-embedded row can satisfy a required core-cycle gate, and installing,
driving and re-recording the installed-browser matrix (plus the deferred real
macOS/Safari device) is later-phase work. The already accepted scoped
Chrome/Edge/Chromium rows keep their recorded validity as non-gate rows: they
are re-read as historical scoped evidence, not promoted and not deleted.

## 3. Current status: GO (2026-09-25)

The Advisor integrated the six accepted core-cycle slices into this checkout on
2026-09-25 (receipt `.uniwork-dev/orca-recovery-g50/integration-g118/REPORT-integration-g118.md`),
and the user recorded the G0 decision **GO** in `evidence-register.json` (`decision`;
the previous NO-GO is kept in `decisionHistory`). The verifier command of section 1
with `--require-go` exits 0:

- valid, report COMPLETE, computed decision GO; 38 rows (37 accepted, 1 pending:
  the launch probe); **8/8 required gates satisfied**;
- the six core gates DOCX, XLSX, PPTX, PDF, MD, HTML are each satisfied by one real
  open-edit-save-reopen cycle in the Orca embedded browser (Chromium) on Windows,
  with an independent Tester, bound to its manifest fixture and the
  `uniwork-office-lab-bridge@1` save receipts (CONTRACT-v1, `CONTRACT-v1.md`);
- core Windows coverage 6/6; 194 artifacts byte-checked; `G0-DOC004-FAULT` and
  `G0-DOC005-MANDATORY` satisfied.

Limits that stay true under GO (also in `decision.limits`):

1. Not pilot acceptance: Q1-B coverage is 0/95 on web and desktop; pilot readiness is
   not assessed; macOS/Safari and installed Chrome/Edge are later-phase work (UNI-671).
2. DOC-004 fault cases run on the real lab host; Go storage/ACL/commit are modeled.
3. The brand r8 product patch and the engine changes are frozen candidates until the
   office source/engine is ported into the repo.
4. Open follow-ups: g118-N1 (375 px with the AI panel open leaves markdown/slides/html
   a 0 px document), brand 1280 px width not measured, PDF annotation-delete
   (`excludeAnnots`) end-to-end path, DOCX core row edits paragraph text only.

What may start (plan 6.4): G1 (UNI-657) and G2 (UNI-658) may start independently on the
contracts that are stable - the DOC-005 login/sync/draft protocol once DOC-005 is
accepted, and the engine contract (`engine-contract.md`) plus CONTRACT-v1 for the
adapter boundary. G3 (UNI-659) and G4 (UNI-636) are **not** opened on unsettled
assumptions: the per-capability runtime choice (DOC-004 4.1) and the final ADR
(DOC-001 1b) are still open.

Whole-task status (ledger reconciliation 2026-09-25,
`.uniwork-dev/orca-recovery-g50/integration-g118/LEDGER-RECONCILIATION-g118.md`):
0 of 6 original plan tasks meets its whole acceptance line yet; the G0 GO is a gate
result.

### 3.0 History: NO-GO as of 2026-09-22 (superseded by section 3)

> The four reasons below were written while installed Windows Chrome + Edge
> were still the required pair. The 2026-09-25 decision (section 2) replaces
> that requirement with the Orca embedded browser; the findings themselves are
> retained unchanged, and no historical result is relabelled.

As of 2026-09-22 the honest register decision is NO-GO, and the register is
valid. The reasons are recorded in the register and repeated here:

1. No required core browser-cycle gate is satisfied. Four accepted **scoped** feature cycles
   exist as six non-gate browser rows, and none closes its core gate:
   the DOCX table cycle (r7, installed Windows Chrome 153.0.8010.50 and Edge
   153.0.4234.48) ran `lab/fixtures/g0-kitchen-sink.docx`, which is **not**
   byte-equal to this register's `F-DOCX-KITCHEN` (`docs/docx-kitchen-sink.docx`;
   same size and identical `word/document.xml`, different package bytes), and its
   browser save path traverses no versioned engine/adapter protocol, so a gate-bound
   fixture identity and protocol version cannot be recorded without inventing them;
   the PDF text cycle is Orca **embedded Chromium 150** only - not the required
   installed Windows Chrome plus installed Windows Edge pair - and its oracle
   records `imageEvidence` null with `renderFidelityClaimed` false, so
   `image-changed` and the independent pre/post render assertions have no artifact.
   The PPTX cycle replaces one existing image, saves and reopens in distinct
   installed Windows Chrome/Edge views, but does not cover text and shape edits
   or full object fidelity. XLSX has a scoped native Orca input cycle with local integration accepted;
   Markdown and HTML have no accepted cycle. All six core scaffold rows stay
   pending, and the DOC-003 spike is unaccepted.
2. The DOC-004 fault-case gate is blocked: one canonical case (malformed-result)
   is accepted against the real spike adapter, and the other six - type/version
   mismatch, checksum mismatch, timeout, cancel-vs-complete race, crash/restart
   and metadata/original access with the engine down - lack accepted canonical coverage
   and stay blocked with a precise missing-artifact note. A modeled contract
   case cannot close a real-adapter gate. The DOC-005 mandatory gate is
   **satisfied** by accepted case rows, as described below.
3. Q1-B coverage is 0 of 95 on both web and desktop (pilot, reported).
4. macOS/Safari real-device QA is deferred to backlog (UNI-671).

Distinct evidence classes that exist today, and what they do **not** prove:

| Evidence that exists | Class | What it does not prove |
| --- | --- | --- |
| DOC-004 real spike-adapter run, 11/11 loopback cases | real-adapter-operation | One canonical fault case only; the other six fault cases lack accepted canonical coverage; checksum has a separate modeled-boundary result |
| DOCX table cycle r7 (non-gate scoped row): one pre-existing top-level cell, real keyboard edit, Ctrl+S, distinct-view reopen; installed Windows Chrome 153.0.8010.50 and Edge 153.0.4234.48; 28 unit tests, independent tester r2 and reviewer r2 | browser-real (scoped, non-gate) | Does not close `G0-CORE-DOCX`: the lane fixture is not byte-equal to `F-DOCX-KITCHEN`, no versioned protocol exists on the browser path, and the scope is one cell of one fixture (no nested/merged tables, no row/column insert-delete, no headers/footers or layout diffs). macOS/Safari untested. Local tooling integration is complete and the DOCX lead was released (see the register docxIntegration field for status and receipts), but deployment/product integration and the full G0-CORE-DOCX gate remain unclaimed and the browser cycle ran in the retained UNI-667 lane worktree, not against today's main checkout, so this is not a main-deployed claim |
| PDF text cycle (non-gate scoped row): one existing text run on page 1, real Edit-text control, renderer Save, distinct-view reopen; Orca embedded Chromium 150.0.7871.250 on Win32 | browser-real (scoped, non-gate) | Does not close `G0-CORE-PDF`: **embedded Chromium only**, not installed Chrome/Edge; `image-changed` is unevidenced (`imageEvidence` null, no pixel comparison, `renderFidelityClaimed` false); HIGH findings F1 and F2 remain open; the marker was set with fill, not typed; no versioned protocol exists |
| PPTX existing-image cycle (two non-gate scoped rows): Replace Picture on slide1 pic#3, normal Save, distinct-view reopen; installed Windows Chrome 153.0.8010.50 and Edge 153.0.4234.48 | browser-real (scoped, non-gate) | Accepted image scope only: rId2/image1.png becomes rId4/image3.png while control pic#4, target geometry, table/title content and 13 declared parts retain their scoped oracle guarantees. No text/shape edit or full fidelity claim; no core gate, DOC-003 or G0 GO. Granted PNG picker is not a native chooser. Original reviewer residuals remain in the pinned reports; Mac/Safari deferred. |
| Browser launch probe: Chrome 153.0.8010.48 / Edge 153.0.4234.32 on Windows | harness | Launch is not an editor cycle |
| In-memory upstream PDF text apply/verify plus independent extraction | engine-round-trip | No saved output, no browser render, no image edit |
| DOC-001a accepted by main; DOC-002/003/004/005 patches and reviews active | source/harness | Not accepted artifacts; no gate follows |
| DOC-005 R9 reference harness: 41/41 accepted cases | harness | The remote authorization half is a labeled reference model; no HTTP server and no product tenant isolation |
| DOC-005 durable draft bytes read back by a fresh store (4 persistence cases) | harness | Durable local bytes only: no product key management, no crash or power-loss durability, and the account/session/ACL layer around the bytes is modeled |

Local tooling integration receipts for the DOCX row above: `.uniwork-dev/office-g0/advisor-automation/docx-main-apply-g46.json`, `.uniwork-dev/office-g0/advisor-automation/docx-main-verify-g46.json` and `.uniwork-dev/office-g0/advisor-automation/docx-main-tests-g46.tap` (56 payload files applied, 56 hashes verified, 28/28 main behavior tests). This records local tooling integration only; deployment/product integration and the full G0-CORE-DOCX gate remain unclaimed.

PPTX package completeness is accepted and integrated locally, uncommitted, into
`feature/UNI-656-documents-office-g0`: 14 payload paths, 20 unchanged main prerequisites, main
affected tests 57/57 and 9 module imports. Worker replica 137/137 and retained 16/16 remain
separate provenance; the original tester-r3 browser run remains 2/2 and was not rerun. The
archive SHA256 is `2a64fcc92ffbc9ca5a3a26ba6a0721b04ac94ecbd711177c825f71ddfccfaf70`. Exact
acceptance, integration, source and external inventory pins are in `pptxIntegration.references`,
rooted at `E = W/.uniwork-dev/office-g0`. Current renderer asset hashes are not proof of
historical per-asset hashes. The original independent reports remain historical; package
followup and this reconciliation use **self-review, not independent review**. `make check` is
unavailable; no full-repository or deployed-product claim. The newly accepted checksum zero-put
reference result is recorded separately below; XLSX acceptance and local integration are recorded separately.

The PPTX rows retain separate immutable input, saved output, independently reopened output,
render, extraction and original report files. The 33 PPTX/checksum portable copies are now integrated in
`E/pptx-reconciliation/artifacts`; the prior reconciliation preserved 75 dependencies and
passed Advisor main 57/57, valid INCOMPLETE/NO-GO, require-go exit 1. The current XLSX
reconciliation keeps main, E and the former PPTX scratch read-only.

The current checksum reference boundary now meets the original **0 puts / 0 commits** refusal
criterion (5 local files, 8 source/dependency pins, main 67/67). Real DOCX output is 3279 bytes
/ `84c3a4639bd8a70396f6a05c9eac57273405ba269b9444312a723587333f5af8`; genuine declarations
store/commit once, while controlled checksum-declaration tampering yields
`engine_checksum_mismatch` with zero ledger rows/objects and unchanged revision/version pointer.
`E-CHECKSUM-ZERO-PUT-SCOPED` remains a non-gate reference result: **REAL** host/bytes,
**CONTROLLED** tamper, **MODELED** auth/store/version commit. It does not close the canonical
real-adapter checksum row or the full DOC-004 fault gate. The previous boundary
`7f37e69017228e461150df990bb3ea8513ac24afa40ca21e3ce210e867b915f8` remains one-put **UNMET**;
the accepted current boundary is
`07bdb4742cbfacf389d728e2d75646fe80af4f1be7d00fa825899ed4d0585442`. Exact revision, original
report, live artifact, historical and acceptance pins are in `checksumIntegration`; self-review
and separate hash computation are not independent review. No Go/production
durability/ACL/product claim or new live run is made here.

None of these closes a core gate, and the register must not promote them. The six
scoped browser rows are recorded for the record with rehashed provenance only: they are
referenced by no required gate, no gate count depends on them, and no modeled or
embedded result is relabelled as installed-browser or product evidence.

### 3.1 Accepted native XLSX input cycle and local integration

| Non-gate row | Accepted scope | Integration |
| --- | --- | --- |
| E-XLSX-INPUT-SCOPED-ORCA | Small native Orca input-edit/recalculate/Save/distinct-reopen cycle | Functional acceptance and scheduled7 local integration accepted |

E-XLSX-INPUT-SCOPED-ORCA records native click/type/keypress, recalculation, UI Save
and distinct-page/view reopen in real Orca 1.4.205 / Electron 43.7.0. Profile
07639da8-6914-4019-bd50-bcef62dce3d0 has no UA spoof. This is embedded Chromium;
it is not installed Chrome/Edge or Mac/Safari evidence. Exact original command
receipts and source/fixture/operation/page/view/artifact pins are in the row.

The original input is g0-compatibility-edit.xlsx, 3161 bytes,
a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85.
Data!C1 changes 5 to 9; B3 retains SUM(C1:C2) with numeric cache 9. Actual saved
and independently reopened files are each 3196 bytes,
c9828da4a4f581fb78fd3ce45196e48c4839e9d81d59c5cdc25953e2c812f84e.
Original page 8128995c-3daa-403f-8933-3e446c0521ff / view
view-e3705d36-c677-46f0-89aa-10d31f2782ec is closed before reopened page
59f1b995-872e-4269-bfc3-125bf697e533 / view
view-84fe03ef-2956-4820-b511-f24a1c6c4d80. The native operation log records
stale cleanup closed:false and successful subsequent reads.

Renderer manifest ff5efc029daf488b7c1f69059cbcfed5ed22401a9d0775c442ad041708a7d1f6
and sidecar a498cbd7868f60243fef2f0ca39e30f8cf27ad2a390a0a603b18b94812605e0f
are pinned to upstream 09485f884dc845cf3bf27fb7edfe489f9d457aad plus 18 exact
frozen source digests. A1 Hello/bold, row5 height20, styles, formula cache and
13 unchanged ZIP entries retain only their original small-fixture evidence
scope. The other two entries change; calcPr fullCalcOnLoad=1 and equivalent
dimension/default-style serialization are explicit. No general fidelity claim.

Only astra-stale-close-green2.txt is the original final 63/63 passing receipt.
Retained independent tester evidence stays at its original revision (20/20
focused tests); the final stale-close fix used worker self-review under the solo
mandate. Historical full Playwright Chrome/Edge diagnostics failed with two 502
responses and were not rerun. N2 busy retry remains inert because this lab host
maps the busy error to engine_error. Earlier ungated reads and the invalid green
log remain disclosed by the original report.

Advisor accepted this functional scope in xlsx-acceptance-g48-scheduled5.md.
Advisor subsequently accepted and locally integrated20workspace files from
ctx_709578cc9ebd (completed/released):247actual main passing tests,28imports
and63verified source/prerequisite pins. This completes the existing subordinate
integration and is not an additional functional delivery. No upstream lane was
applied, no native binary was replaced/rebuilt and the browser cycle was not rerun.
New copies and original-path/role/bytes/hash mapping
live in P/.uniwork-dev/xlsx-evidence-reconciliation-g48 with portable destinations
under E/xlsx-evidence-reconciliation-g48/artifacts. Prior accepted rows, checksum
one-put/current-zero-put distinctions and canonical gates remain intact. No full
XLSX/browser matrix, DOC-003, G0 GO, production storage/auth or pilot acceptance.

The scheduled7 acceptance, audit, integration result and command receipts are
pinned as five additional row artifacts under artifacts/integration. Main lacks
local TypeScript: initial supporting execution passed62 tests then failed importing
the formula suite before loading it. An owned Node loader resolved only typescript
to existing compiler SHA256
3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675; after correcting
a Windows loader path to a file URL, formula20 passed. Final afterpin category
filtering excluded test-only support, then all63intended pins passed. Worker354/354,
16guard probes and four main-absent test-only supports retain their original replica
provenance; this is not a main354claim. Historical failed commands remain in the
copied receipts. No installation or product/test source change was needed for
compiler resolution, and no full make check was run.

## 4. Estimate: M1/M2, costed with stated assumptions

The withdrawn figures stay withdrawn: the old 8-12 day G0 and 12-18 week pilot numbers are **not** carried
forward. The delivered estimate is [m1-m2-estimate.md](m1-m2-estimate.md), written in engineer-weeks with
every assumption stated next to the arithmetic it feeds. Its measured inputs are counts only (87 six-format
capability rows: 30 proven, 1 candidate, 56 blocked; 16 blocked operations; 95 inventory rows with 72
must-port and 26 proven on web in the r2 candidate matrix; 17 accepted DOC-005 cases; 18 brand surfaces;
2 host OS targets); **no measured effort exists**
anywhere in G0, so the per-row and per-package rates are labelled assumptions to be recalibrated after the
first G1/G2 sprint. The r2 refresh names - without changing the totals - the five upstream-behaviour
port items (P1-P5, owners G3/G2) and the exact Q7 blocker (no conversion engine exists today).

| Milestone | Scope | Estimate (engineer-weeks) |
| --- | --- | --- |
| M1 | Q1-B verified upstream capability (OCR deferred), Q3-B platforms, Q5 online, Q7/Q8 mandatory | ~82 low / ~149 expected / ~265 high |
| M2 | M1 plus the full offline desktop library and durable queue (Q5-A) | +~20 / +~35 / +~62 |

Dependency order, resource roles, the parameterised calendar and the risk exposures are in the same file.
Estimating rule: measure first. A work package is costed only after the evidence it depends on is accepted,
and measured results stay separate from estimates.

## 5. Downstream ownership map

| Group | Issue | Receives from G0 |
| --- | --- | --- |
| G1 | UNI-657 | Go data store contract: auth, ACL, quota, version commit, audit |
| G2 | UNI-658 | Internal engine adapter and on-prem service boundary |
| G3 | UNI-659 | UniWork Office editor and web brand |
| G4 | UNI-636 | Desktop login, deep link, identity and brand |
| G5 | UNI-660 | Full offline desktop library and durable queue (before M2) |
| G6 | UNI-635 | AI features (not started at G0) |
| G7 | UNI-661 | Installer, update, identity and product E2E |
| Coauthoring | UNI-662 | Separate scope |
| Mac QA | UNI-671 | Deferred real Mac/Safari device evidence |

Ownership boundary that does not change: Documents owns identity, bytes,
versions, permissions and audit; the Office engine returns computation results
and never decides who may read what or writes business tables. Go owns
auth/ACL/quota/commit/audit. The engine runs as internal module or on-premise
service; documents never go to a third-party Office or OCR endpoint (Q4-A).

Milestone shape to confirm, not a promise: M1 = q1-B verified capabilities
online, with the Q7 conversion-copy path and Q8 draft protection; M2 requires
the full offline desktop library from G5 first (Q5-A); OCR for scanned PDF
stays a later milestone (Q2-A). What each group receives, the acceptance criteria
it inherits and the decisions that are still open are itemised per group in
[handoff-map.md](handoff-map.md), including the two tracker items the coordinator
must confirm (the G1-G7 mapping line and the unowned ADV-002 rows).

## 6. Reviewer and human acceptance action

The G0 gate decision is recorded (GO, section 3); the pilot hand-off and DOC-006 remain
open. The remaining human actions:

1. Run the reproducible command in section 1 with `--require-go` and confirm it exits 0
   (valid, COMPLETE, errors 0, 8/8 required gates). Review the six scoped non-gate rows
   and the separate checksum reference row: they stay non-gate history.
2. (Done 2026-09-25 for every required gate; kept as the rule for any re-run.) Attach
   the real evidence rows for each gate: for each core format one row run
   in the Orca embedded browser (Chromium) on Windows, with command, cwd, platform,
   runtime, the recorded Orca application version and embedded Chromium version,
   fixture and operation, expected and actual result, the required assertions, the
   versioned browser-cycle protocol string, and structured artifacts bound by role
   and ref. Installed Windows Chrome/Edge and macOS/Safari rows are not required at
   G0 and never satisfy a core-cycle gate. Attach one accepted row per
   DOC-004 fault case and per DOC-005 mandatory case. Re-run the verifier with
   --require-go.
3. Keep the declared decision separate from the computed readiness. A warning
   may flag a mismatch (for example a stale NO-GO while every gate is now
   satisfied), but the declared human decision is never silently rewritten.
4. Accept or reject each row as reviewer. Only a human sets the issue done
   state after merge and the definition of done.
5. Close the unresolved visual tolerance under its own id: `DEC-RENDER-TOLERANCE`
   in [acceptance-thresholds.md](acceptance-thresholds.md) section 4, recorded exactly
   as decided (user decision 2026-09-25): **OPEN, owned by G3 UNI-659** - G3
   measures the per-format pixel diffs, then a named human reviewer signs. The
   evidence it needs is one pixel-diff per format per fixture with the edited
   region masked (fixed viewport and DPR, machine `WIN-ORCA-1.4.209`); until it is
   signed, a row may claim only what its part/object oracle proves, and G0 keeps
   only the rule that differences outside the edited region must be explained.

No full G0, pilot completion or issue-done claim is made by this scaffold.
