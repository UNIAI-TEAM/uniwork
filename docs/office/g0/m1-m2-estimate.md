# M1 / M2 ESTIMATE - DOC-006 plan item 6.3 (g119 r2)

> **Status:** candidate for M; canonical files stay read-only. Issue UNI-670 (DOC-006), plan task 6, item 6.3.
> This is the **r2 refresh** of `../ESTIMATE-M1-M2.md` (SHA-256 `949C1F04...`). Every count in this document
> is re-read from an accepted artifact named in `evidence/estimate-sources-r2.json` (r2 inputs) or the r1
> map `../evidence/estimate-sources.json`. **No effort, throughput or calendar number here is a
> measurement** - no measured engineering effort exists anywhere in the G0 evidence, and this document does
> not pretend otherwise. Effort rates are explicit, labelled assumptions, and this file states exactly what
> replaces them and when.
>
> **r2 delta (what changed and what did not):** the arithmetic is unchanged - M1 ~82/149/265 EW, M2
> +~20/35/62 EW. What changed is traceability: the DOC-003 r2 run produced (a) measured open envelopes for
> the five formats that had no timing in r1, (b) five named upstream-behaviour port items (P1-P5) and the
> exact Q7 blocker, now owner-mapped to G3 UNI-659 / G2 UNI-658, and (c) two corrections to r1 statements
> (the XLSX `engine_unsupported` was a lab wiring gap, not an engine verdict; password-encrypted DOCX open
> now works in the lab through the renderer's own dialog). Named items inside existing packages are not
> added as new engineer-weeks - that would double-count; they are now assigned work instead of discovery risk.

## 1. Scope being estimated

| Item | Definition | Source |
| --- | --- | --- |
| **M1** | Full verified upstream capability (Q1-B), OCR deferred (Q2-A); the Q3-B platforms; online sync (Q5-A); the Q7 conversion-copy path and Q8 draft protection mandatory | plan task 6 item 6.3; `pilot-handoff.md` section 5 |
| **M2** | M1 plus the full offline desktop library and durable queue, which the plan requires before M2 (Q5-A); OCR stays later than M2 | plan Q5-A/Q2-A; `pilot-handoff.md` section 5 |
| withdrawn | the prior "8-12 day G0" and "12-18 week pilot" figures are **not** carried forward: the G0 evidence does not support them | `pilot-handoff.md` section 4 (already recorded) |

What M1 must produce (all evidenced as *unproven* today unless stated):

1. every must-port capability row implemented and verified on web **and** desktop - the pilot gate Q1-B;
2. the engine running from a clean monorepo checkout with no `../genoffice` and no private registry;
3. the platform matrix Q3-B: Windows + macOS hosts, Chrome/Edge/Safari plus the Orca embedded browser;
4. the DOC-005 login/sync/version/draft protocol against real services (not the modeled reference);
5. the Q7 conversion-copy path and Q8 draft protection as product behaviour - r2 sharpens this: **no
   conversion engine exists at all today** (`r2/Q7-BLOCKER.md`), so this is new engine work (G2), not a
   lab wiring fix, plus a warning/cancel/accept UI that does not exist (G3) and provenance records from
   the DOC-005 contract;
6. brand/identity/update surfaces under the UniWork Office namespace, with GenOffice coexistence proven.

## 2. Measured inputs (counts) versus assumed inputs (rates)

### 2.1 Measured / accepted counts - the only numeric hard inputs

| Input | Value | Source |
| --- | --- | --- |
| capability rows in the accepted runtime map (six formats) | 87 (docx 22, xlsx 16, pptx 15, pdf 17, md 9, html 8) | `doc004-runtime/RUNTIME-MAP-G119.md` |
| of those: proven by an accepted core cycle | 30 | same |
| of those: candidate with supporting evidence only (never called proven) | 1 | same |
| of those: blocked, each with a named test that would prove it | 56 | same |
| capability rows in the inventory / must-port | 95 / 72 | `doc002-fixtures/REPORT.md`, `docs/office/g0/capabilities.json` |
| capability rows proven on web in the r2 candidate matrix | **26 of 95** (docx 6, xlsx 4, pptx 4, pdf 4, md 4, html 4; desktop 0) - different basis than the 87-row runtime map: this counts inventory rows marked `đạt có giới hạn` | `doc003-evidence/r2/candidates/capability-matrix.md` section 2 |
| non-proven **operations** per format (operation-level list, one row per operation) | docx 4, xlsx 2, pptx 2, pdf 4 (3 blocked + 1 candidate), md 2, html 2 = **16 non-proven operations: 15 blocked + 1 candidate** | `doc004-runtime/RUNTIME-MAP-G119.md` ("Operations per format" - one row per operation). The companion `RUNTIME-CONCLUSION.md` section 2 groups convert+export into one row, so it yields a different per-format breakdown and is deliberately **not** cited for this count |
| proven editor cycles (open-edit-save-reopen, browser page) | 6 (one per format), Orca embedded browser, frozen bridge `uniwork-office-lab-bridge@1` | register rows `E-DOCX-CYCLE`, `E-XLSX-CYCLE`, `E-PPTX-CYCLE`, `E-PDF-TEXT-CYCLE`, `E-MD-CYCLE`, `E-HTML-CYCLE` |
| measured open envelopes per format | all six formats now have `n = 3` cold + `n = 3` warm browser open envelopes on `WIN-ORCA-1.4.209` (DOCX on served build A `b8d0abed...` with the r1 timing re-analysis reproducing the reported totals; the five others on served build B `ee2b86a0...` with an independent re-run: Tester r2b 35/35, method verdict CLEAR) | `r2/THRESHOLDS.md` sections 5.1/5.3; `doc003-evidence/r2/TIMINGS-r2.md`; `r2/receipts/tester-r2b/REPORT.md` |
| wall time of one five-format open-timing sweep | ~5.2 min lab wall on this machine class (tester-r2b lab start 16:46:12Z -> lab stop 16:51:24Z, covering its method checks plus the 35-sample sweep; the author run started 16:10:44Z) | `r2/receipts/tester-r2b/REPORT.md` header; `r2/receipts/run-lab/*/start.json` |
| named upstream-behaviour port items (r2) | **P1-P5**: P1 named localized PDF parse error (G3); P2 font check must count adopted embedded faces (G3); P3 failed DOCX open must not land on a blank document (G3 screen, G2 adapter failure class); P4 sheets failed-select shows an error state not a shell (G3); P5 password-protected DOCX save needs the password-intent adapter path to a re-encrypting service (G2). Plus fixture item F1 (embedded family neither bundled nor installed) owned by DOC-002 UNI-666 | `doc003-evidence/r2/PORT-ITEMS.md` |
| Q7 conversion-copy blocker (restated by r2) | **no conversion engine exists or is bound**: `xlsx-open` reads OOXML zip only (`.xls` answers `invalid Zip archive: Could not find EOCD`, a named parse error, not `engine_unsupported`); no BIFF8/ODF/RTF/XLSB reader; no convert op in the lab allowlist or engine routes; no warning/cancel/accept UI; provenance is a DOC-005 contract item. Owners: engine G2, UI G3, provenance DOC-005 implemented in G1/G2 | `doc003-evidence/r2/Q7-BLOCKER.md`; `r2/ROOT-CAUSE.md` D6 |
| r2 corrections to r1 failure statements | password DOCX open now runs the renderer's own password dialog (`host:docs-open-decrypt` on the pinned officecrypto-tool 0.0.19; wrong password -> `wrong-password`; decrypted session refuses save with 501 `encrypted_save_unsupported` - the lab never re-encrypts); XLSB/corrupt XLSX get the named engine error instead of `engine_unsupported`; embedded-font fixture DID render (r1 summary used an earlier failed attempt) | `r2/ROOT-CAUSE.md` D1, D2, D4 |
| DOC-005 follow-up work items / rollout steps | 6 items, 6 ordered steps | `docs/office/g0/login-sync-contract.md` sections 9 and 9.1 |
| DOC-005 mandatory cases accepted / E2E families to re-run later | 17 accepted (4 with real durable draft bytes, 13 modeled) / 4 families | `login-sync-contract.md` sections 8, 9 |
| brand surfaces / brand acceptance checks | 18 surfaces (B-01..B-18) / 7 checks | `docs/office/g0/uniwork-office-integration-brand.md` sections 3, 3.1, 4 |
| brand identity values still unfixed | app id, executable, artifact name, deep-link scheme, user-data namespace, update feed - all proposed, none existing at the pinned commit | `doc004-runtime/PACKAGING-AND-HANDOFF.md` section 3 |
| clean-checkout build state | lab+adapter contracts proven 41/41 contained; **engine build deferred** with 2 named missing pieces (prepared pinned source + local esbuild; untracked `e2e/office-g0/lab/fixtures/g0-text.pdf`), plus a runner temp/git-discovery default to pin | `PACKAGING-AND-HANDOFF.md` section 5b |
| dependency conflict to resolve in the port | UniWork catalog React 19.2.3 / TipTap 3.30.6 vs docs app React 19.2.4 / TipTap 3.31.0 | `PACKAGING-AND-HANDOFF.md` section 4 |
| DOC-004 fault gate state | 1 of 7 fault cases accepted on the real adapter; 6 lack accepted real-adapter coverage | `pilot-handoff.md` section 2 |
| known UI/QA defects carried into G1 work | 375 px with the AI panel open collapses markdown/slides/html to a 0 px document; brand 1280 px width not measured; PDF `excludeAnnots` end-to-end path missing; DOCX core row edits paragraph text only; r2 adds the XLSX warm-state reproducibility gap (~44% cross-run spread) | `pilot-handoff.md` section 3 limits; `r2/receipts/tester-r2b/REPORT.md` finding |
| fixture regeneration drift | 13 XLSX/PPTX fixtures do not regenerate byte-identically with today's generator | `doc002-fixtures/REPORT.md` limits |
| non-portable artifact left outside the workspace by DOC-004 | `%LOCALAPPDATA%\Temp\office-g0-iQLGS5` (41 case directories) | `PACKAGING-AND-HANDOFF.md` section 5b |

### 2.2 Assumed inputs (rates) - must be replaced by measured throughput

The G0 evidence contains **no** measured effort for porting, integration, testing, packaging or release. The
rates below are therefore assumptions, stated so the arithmetic can be checked and so the first G1 sprint can
replace them. Units: **EW = engineer-week of one focused engineer**.

| Id | Rate assumption | Value (low / expected / high) | Basis and what would replace it |
| --- | --- | --- | --- |
| R1 | port + verify one blocked capability row (engine work, adapter glue, one accepted row) | 0.5 / 0.9 / 1.5 EW per row | derived from the row's own named blocker and the fact that a proven row needs a browser-real cycle plus artifacts; replace with the measured rows-per-sprint after G1 |
| R2 | one format's editor+adapter integration into Documents (shell, save state, permissions, i18n, tokens) | 1.5 / 2.5 / 4 EW per format | 6 formats today; the proven cycles give the behaviour baseline, not the effort; replace after G3's first format. The r2 port items P1-P4 are concrete instances inside this package - naming them does not add new scope, it removes discovery risk |
| R3 | independent verification per format (fixtures re-run, thresholds, reviewer) | 0.5 / 1.0 / 2.0 EW per format | r2 replaces the r1 guess-basis: one full five-format open-timing sweep cost ~5-6 min lab wall on this machine, but a full per-format verification (cycles + thresholds + review) is still unmeasured; replace with measured run-days after the first G3 format |
| R4 | engine service + native sidecar productisation (process, health, metrics, limits, backpressure, on-prem packaging) | 3 / 5 / 8 EW total | DOC-004 packaging matrix rows exist; nothing is built. r2 adds a concrete instance: a conversion engine for Q7 does not exist at all |
| R5 | Go document store work (metadata, versions, commit transaction, audit/outbox, quota, orphan ledger + reconciler) | 6 / 10 / 16 EW total | G1 UNI-657; the register states all of it is modeled today |
| R6 | desktop host: login/deep link/session, identity namespace, coexistence, packaging pipeline per OS | 4 / 7 / 11 EW total | DOC-005 desktop items + brand B-01..B-17 |
| R7 | signing, notarization, installer formats (deb/rpm/nsis/dmg) and the private update channel | 2 / 3.5 / 6 EW total | brand B-04/B-05/B-17 and DOC-004 section 3 |
| R8 | brand/assets/identity work across the 18 surfaces + 7 acceptance checks | 2.5 / 4 / 6.5 EW total | brand doc sections 3-4 |
| R9 | Q7 conversion-copy path and Q8 draft protection as product behaviour (incl. provenance/history records) | 3 / 5 / 8 EW total | r2 sharpens this: the conversion path needs a **new engine** (no BIFF8/ODF reader exists), a warning/cancel/accept UI (G3), and the DOC-005 provenance record - the high end is more likely than the low |
| R10 | sync/change-feed/cursor work (steps 1-4 of the DOC-005 rollout on real services) | 3 / 5 / 8 EW total | `login-sync-contract.md` section 9.1 |
| R11 | platform matrix completion: installed Chrome/Edge re-record, macOS/Safari device QA (UNI-671) | 2 / 3.5 / 6 EW total **plus** Mac hardware availability | Q3-B; QA-01 deferral |
| R12 | risk contingency on the sum of R1..R11 | 25 % / 30 % / 40 % | the blocked-operation list is long and several blockers are engine-level (r2 confirms: the Q7 blocker is a missing engine, the hardest class) |

## 3. M1 cost

M1 driver counts: 56 blocked capability rows (operation-layer: 16 blocked operations + 1 candidate), 6 formats,
6 DOC-005 work items, 18 brand surfaces, 2 host OS targets, 3+1 browser targets, **5 named port items + the
Q7 conversion engine** (r2 additions - enumerated members of the existing packages, not new scope).

| Work package (plan 6.3 wording) | Formula | Low | Expected | High |
| --- | --- | --- | --- | --- |
| Port of the upstream capability (port work; r2 detail: the five P1-P5 named behaviours are inside this and the FE/native packages as assigned items) | 56 rows x R1 | 28.0 | 50.4 | 84.0 |
| Native / runtime (engine service + sidecar + PDF node-safe decode or desktop host; r2 detail: the Q7 conversion engine is a concrete member of this package) | R4 | 3.0 | 5.0 | 8.0 |
| FE design + integration (r2 detail: P1-P4 named error/blank/shell/font behaviours are inside this package) | 6 formats x R2 | 9.0 | 15.0 | 24.0 |
| Test / verification (incl. DOC-004 fault gate, thresholds, pixel diff) | 6 formats x R3 | 3.0 | 6.0 | 12.0 |
| Signing + distribution | R7 | 2.0 | 3.5 | 6.0 |
| Infrastructure (Go store, commit/audit/outbox, quota, orphan ledger, change feed) | R5 + R10 | 9.0 | 15.0 | 24.0 |
| Brand / assets / identity / update + coexistence | R8 + R6 | 6.5 | 11.0 | 17.5 |
| Q7/Q8 product behaviour (conversion copy, draft protection; r2 detail: P5 adapter intent path + the missing conversion engine land here and in R4) | R9 | 3.0 | 5.0 | 8.0 |
| Platform matrix (Chrome/Edge re-record + macOS/Safari, UNI-671) | R11 | 2.0 | 3.5 | 6.0 |
| **subtotal** |  | **65.5** | **114.4** | **189.5** |
| Risk contingency | R12 | 16.4 | 34.3 | 75.8 |
| **M1 total (engineer-weeks)** |  | **~82** | **~149** | **~265** |

Reading: with the assumptions above, M1 is **on the order of 80-265 engineer-weeks, expected ~150**. This
supersedes both withdrawn figures (8-12 days and 12-18 weeks) by two orders of magnitude at the low end and
one order at the high end, which is itself the finding: the old numbers assumed a port that G0 evidence shows
is 56 blocked capability rows, 16 blocked operations and a deferred engine clean-checkout build. r2 does not
soften that reading - it names more of the blocked work (P1-P5, Q7) without changing the driver counts.

## 4. M2 additional cost

| Work package | Formula | Low | Expected | High |
| --- | --- | --- | --- | --- |
| Offline desktop library + durable queue (G5 UNI-660): local cache, queued changes, retry/progress, device sign-out, revocation, audit | 2.5x R10 | 7.5 | 12.5 | 20.0 |
| Conflict/retention UX and data guarantees (both versions kept, actionable conflict) | 1x R10 | 3.0 | 5.0 | 8.0 |
| Offline/large-library performance work driven by the Q9 measurements (browser open is blocked today) | 1.5x R4 | 4.5 | 7.5 | 12.0 |
| M2 verification (offline E2E families, long-disconnect resync, desktop upgrade with drafts) | 2x R3 | 1.0 | 2.0 | 4.0 |
| **M2 subtotal** |  | **16.0** | **27.0** | **44.0** |
| Risk contingency | R12 | 4.0 | 8.1 | 17.6 |
| **M2 additional total (engineer-weeks)** |  | **~20** | **~35** | **~62** |

OCR stays outside M2 (Q2-A) and is not costed here; a scanned-PDF OCR milestone needs its own evidence.

## 5. Dependency order (what blocks what)

| Step | Must exist before | Evidence |
| --- | --- | --- |
| 1 | Go store + commit/audit/outbox + orphan ledger (G1 UNI-657) | migration order is the dependency order: store and ledger exist before the engine writes |
| 2 | engine port into the monorepo from a clean checkout, catalog-conflict decision (React/TipTap) resolved (G2 UNI-658) | clean-checkout FAIL-DEFERRAL with 2 named missing pieces |
| 3 | engine service + native sidecar productised (G2); r2 adds: the Q7 conversion engine (G2) and the P5 password-intent adapter path (G2) | DOC-004 packaging matrix row "Server"; `r2/Q7-BLOCKER.md`; `r2/PORT-ITEMS.md` P5 |
| 4 | browser editors integrated on the ported engine (G3 UNI-659); r2 adds: the named port behaviours P1-P4 and the Q7 warning/cancel/accept UI (G3) | six proven cycles exist on the lab bridge, not on the product engine; `r2/PORT-ITEMS.md` P1-P4 |
| 5 | DOC-005 steps 1-3 (errorClass, payload fingerprint, mismatch switch) on real services | `login-sync-contract.md` 9.1 |
| 6 | desktop host + login/deep link/namespace (G4 UNI-636) | DOC-005 step 5 |
| 7 | DOC-005 steps 4-6 (change feed, cursor, drafts namespace) - G4/G5 | `login-sync-contract.md` 9.1 |
| 8 | M2 offline library + queue (G5) | Q5-A requires it before M2 |
| 9 | release: signing, installers, update channel, brand scan, fixture replay (G7 UNI-661) | DOC-004 versioning section: bumping a version is not a gate, re-running fixtures is |

## 6. Resource requirements (roles, not calendar)

| Resource | Why | Evidence |
| --- | --- | --- |
| engine/native engineer (Rust + Node/TS) | sidecar, engine service, PDF image-edit decode path, PPTX `host:slides-edit-transform` channel; r2 adds the Q7 conversion engine (BIFF8/ODF -> OOXML, service side) | DOC-004 deviations 1-3; `r2/Q7-BLOCKER.md` |
| Go/backend engineer | store, commit transaction, audit/outbox, quota, change feed, orphan ledger | G1 scope; register says it is modeled today |
| FE engineer | 6 editors into Documents, brand chrome, editor shell states, 375 px defect, brand 1280 px; r2 adds the named port behaviours P1-P4 and the Q7 dialog | `pilot-handoff.md` limits; brand B-16; `r2/PORT-ITEMS.md` |
| desktop/packaging engineer | host, login/deep link, installers, signing/notarization, update feed | brand B-01..B-17, DOC-004 section 1 |
| independent Tester with the Orca browser | every new row needs its own browser-real evidence; the r2 sweep (~5-6 min lab wall per five-format timing pass) is the cheapest verification loop so far | DOC-003 reports; `r2/receipts/tester-r2b/REPORT.md` |
| **Mac hardware / device access** | Q3-B requires macOS + Safari; measured today only on Windows | QA-01 / UNI-671 deferral |
| design/brand owner | 18 brand surfaces and the UniWork icon/wordmark set | brand doc sections 3-4 |

## 7. Calendar (parameterised, not promised)

There is no measured team throughput, so calendar is expressed as a function, not a date:

- dependency chain (section 5) gives a serial floor of about 4 phases (store -> engine/service -> editors/desktop ->
  release + offline for M2) if each phase ran alone;
- M1 effort 82-265 EW divided by parallel capacity `N` engineers gives the calendar range. With the resource
  table above a realistic `N` is 4-6, and the arithmetic is transparent: the low total over 6 engineers is
  ~14 weeks, the expected total (149 EW) over 4-6 engineers is ~25-37 weeks, and the high total over 4
  engineers is ~66 weeks. M2 adds 20-62 EW, i.e. ~3-16 further weeks at the same capacity, **provided** the
  Mac hardware exists for Q3-B;
- two calendar risks are already visible in accepted evidence and are not hidden here: the large-fixture browser
  open is blocked today (Q9 band), and 6 of 7 DOC-004 fault cases plus the engine clean-checkout build remain
  unproven, so the first real sprint must re-measure the rates R1-R12 before any date is quoted to a stakeholder.
  r2 adds a third: the Q7 conversion path needs an engine that does not exist, so its schedule sits entirely
  inside the R9/R4 packages and cannot start before step 3.

## 8. Risk register with cost exposure

| Risk | Exposure | Mitigation / owner |
| --- | --- | --- |
| ported capability rows cost more than R1 (blocked operations are engine-level, not glue) | +50-100 % on the port line | measure the first 5 rows in G2, then recalibrate R1 |
| engine cannot be built from a clean checkout (missing source/esbuild, missing PDF fixture) | blocks M1 step 2-3 | resolved by G2 UNI-658 + fixture owner UNI-667/658 (named pieces are in the evidence) |
| macOS/Safari verification needs hardware that is not available | blocks Q3-B and therefore M1 | resource decision to be taken with the user (UNI-671) |
| pixel/render tolerance never decided | blocks any fidelity claim even with full port work | `DEC-RENDER-TOLERANCE` in `THRESHOLDS.md` section 4: OPEN, owner G3 UNI-659, signer a named human reviewer |
| huge-workbook/large-document handling (46 MB DOCX browser open blocked; 74 MB XLSX open unmeasured on the wired engine - r2 corrected the r1 `engine_unsupported` misread: it was a lab wiring gap, the real engine now answers named errors) | Q9 band fails at the pilot | engine capacity work in step 2-3; re-run the Tester B / r2 procedure on the Q9 fixtures |
| Q7 conversion path needs an engine that does not exist (no BIFF8/ODF/RTF/XLSB reader anywhere) | the M1 scope item "Q7 mandatory" cannot pass until G2 builds one; near-certain use of R9's high end | G2 engine decision with DOC-004 contract; the lab keep-refusing behaviour is the correct interim |
| XLSX warm-state reproducibility gap (~44% cross-run spread) | performance acceptance rows flaky until the warm definition is settled | close with the larger-n warm separation run (THRESHOLDS 5.3 finding) |
| 13 fixtures do not regenerate byte-identically | re-pinning or per-entry generator hashes | decision recorded in DOC-002 limits; owner to be named before G3 |
| catalog conflict React/TipTap resolved by raising the product catalog | breaks repo rules | `PACKAGING-AND-HANDOFF.md` section 4: port must build on the UniWork catalog |
| 6 of 7 DOC-004 fault cases unaccepted | fault gate unsatisfied at M1 | run the fault harness against the real adapter in G2 (owner named there) |

## 9. What would invalidate this estimate (stated up front)

1. A different M1 scope (for example moving OCR, coauthoring or the offline library into M1) changes both the
   driver counts and the total; the formulas in sections 3-4 are then re-run, not patched.
2. Measured throughput from G1/G2 replacing R1-R3 - the total should be recomputed, not defended. The r2
   timing sweep is the first real throughput data point for verification loops (~5-6 min wall per
   five-format timing pass), not yet for engineering.
3. A decision to ship fewer formats or platforms at M1 (a scope cut), which must be recorded as a scope change
   with the capability rows it removes.
