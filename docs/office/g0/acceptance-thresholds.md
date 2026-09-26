# THRESHOLDS - DOC-006 plan item 6.2 (measured acceptance thresholds, g119 r2)

> **Status:** candidate for M; canonical files stay read-only. Issue UNI-670 (DOC-006), plan
> `docs/superpowers/plans/2026-09-16-documents-office-g0.md` task 6, item 6.2.
> Owned slice dir: `M/.uniwork-dev/orca-recovery-g119/doc006-handoff/r2/`. This is the **r2 refresh**:
> the open budgets for XLSX/PPTX/PDF/Markdown/HTML that were `chua do` in the r1 version
> (`../THRESHOLDS.md`, SHA-256 `C1211C4B...`) are now measured values re-read from the DOC-003 r2
> receipts. Every number below is re-read from an existing receipt named in
> `evidence/threshold-sources-r2.json` (new r2 inputs, frozen under `r2/receipts/frozen-evidence/`)
> or in the r1 map `../evidence/threshold-sources.json` (frozen under `../receipts/frozen-evidence/`).
> No measurement in this document was produced by this slice.

Plan item 6.2 asks for four things, and this file answers each in its own section:

1. content and structure are not lost - section 3;
2. render differences outside the edited region are explained and a tolerance is decided - section 4;
3. time / memory / size / complexity limits per format and per machine come from measurements - sections 2 and 5;
4. no threshold is silently loosened to pass one file - section 6.

## 1. Admissibility rules (what counts as a threshold here)

- **T-1 (traceability).** A number is admissible only with: the receipt path, its SHA-256, the command that
  produced it, the machine/runtime identity, and its sample count `n`. `evidence/threshold-sources-r2.json`
  carries the first two for every r2 source; `../evidence/threshold-sources.json` does the same for the r1
  sources still cited.
- **T-2 (sample floor).** A value may be called a **budget** only when `n >= 5` on the target machine class.
  With `n < 5` the value is a **measured envelope** (the observed range) and is used as a provisional
  ceiling: a run that exceeds it needs a recorded explanation, not a silent pass.
- **T-3 (no promotion).** A model, harness or fixture-generation result never becomes a browser or
  performance threshold. Levels are the register's classes (`source-read` < `fixture-generation` <
  `modeled` < `harness` < `engine-round-trip` < `browser-real` < `product-e2e`).
- **T-4 (blocked is a result).** Where a run was blocked by a named engine/browser error, the row says
  `blocked` and names the error and the test that would unblock it - it is never filled with a modelled
  number.
- **T-0 (evidence snapshot).** Every receipt cited here is captured twice: its SHA-256 is recorded for the live
  file, and the same bytes are frozen with a timestamp (`r2/receipts/frozen-evidence/FROZEN-MANIFEST.json`
  for the new r2 inputs, `../receipts/frozen-evidence/FROZEN-MANIFEST.json` for the r1 inputs). Several cited
  trees (`doc003-evidence/`, `doc002-fixtures/`, `doc004-runtime/`) are untracked and shared with
  other concurrent workers, so a live hash can move under the reader; the frozen copy is the one to re-check. Git
  tracks the `docs/office/g0/*` files named here, so those are recorded by path and hash only.
- **T-5 (retry accounting).** Orca snapshot invocations on a fresh session fail with
  `runtime_unavailable` after ~30.5-30.8 s before a successful attempt (measured: 3 back-to-back examples
  in `receipts/tester-a1/snapshot-attempts.json`). A time number must therefore state whether it includes
  failed attempts. This document always reports both. The r2 timings method uses an in-page 25 ms poll
  started by one `orca eval` per sample and recorded **0 eval retries in 35 counted samples**
  (author run) and **0 of 35** in the independent run, so the r2 rows carry no retry overhead.
- **T-6 (both runs shown).** Where two independent runs measured the same thing, both are reported. The
  faster run is never picked silently; a divergence is a recorded finding, not a reason to cherry-pick.

## 2. Machines and runtimes measured

| Machine id | What is recorded | Where | Gap |
| --- | --- | --- | --- |
| `WIN-ORCA-1.4.209` | Windows; Orca 1.4.209; embedded Chromium 150.0.7871.250; Electron 43.7.0; Node v22.23.2 (pin `.uniwork-dev/tools/node-v22.23.2-win-x64`) | `receipts/tester-b/TIMINGS.md`; `receipts/tester-a1/00-served-build-identity.json`; `doc003-evidence/r2/receipts/run-lab/*/start.json` | **CPU / RAM / GPU / Windows build number are not recorded anywhere.** Per-machine thresholds cannot be compared across hardware until a G1 run records them (`systeminfo`, `Get-CimInstance Win32_Processor,Win32_ComputerSystem`). |
| served build A (r1 DOCX cycles) | `host-build-manifest.json` SHA-256 `b8d0abed367164012d8a54ee7df960095ebdaee848c0102253c77931e137237c`; Docs `main-DHF4Zrxj.js` SHA-256 `0c4e9ead...`; lab server `386dc212...`; host adapter `434f7571...`; bridge `e80524c4...` | `receipts/tester-a1/00-served-build-identity.json` | The r1 DOCX time rows in section 5.1/5.2 are valid only for this build. |
| served build B (r2 five-format runs) | `host-build-manifest.json` SHA-256 `ee2b86a0e97982de7d2d536925bc38d0fa78f39d178bee3c737ceee5a99a1dd8` (pinned source `09485f88`, out of the same r7 build source); served entry per app recorded in every sample: `sheets/assets/index-Cw6KZ9Ak.js`, `slides/assets/index-CDVtr7yE.js`, `pdf/assets/index-Ctv5EPZV.js`, `markdown/assets/index-Bt2-nXl0.js`, `html/assets/index-Dht2XTbl.js` | `doc003-evidence/r2/lab-build/builds/host-build-manifest.json`; both `run-lab` `start.json` files record `hashes.buildManifestSha256` = `ee2b86a0...` (author run `2026-09-25T16-10-44-203Z`, tester-r2b run `2026-09-25T16-46-12-045Z`) | The r2 five-format rows in section 5.3 are valid only for this build; a later build starts a new row. |
| lab (r2) | author run `2026-09-25T16-10-44-203Z`: app 5726 / preview 5727 / engine 5728 / xlsx-engine-host 5729 (sidecar `xlsx-sidecar.exe` SHA-256 `a498cbd7...`, the register pin); tester-r2b run `2026-09-25T16-46-12-045Z`: app 5720 / preview 5721 / engine 5722 / xlsx-engine-host 5723, same sidecar | `doc003-evidence/r2/receipts/run-lab/*/start.json` | TCP/loopback only; no network or GPU stack is characterised. Both runs used the pinned Node v22.23.2 (no deviation). |
| lab (r1) | ports 5706 app / 5707 preview / 5708 engine, run tag `b` | `receipts/tester-b/00-lab-start.json` | same note |

Scope reminder (user decision 2026-09-25): the G0 core cycles are Orca-embedded-browser rows on Windows.
Installed Chrome/Edge and macOS/Safari rows are **not** part of these thresholds.

## 3. Content and structure threshold (measured, DOCX; rules for the rest)

The only content/structure oracle with real cycles is the DOCX part oracle
(`doc003-evidence/oracle/docx-parts-diff.mjs`, run by Tester A1 and re-run by the BE reviewer). It compares
the input package, the saved package and the reopened package. Its assertion list **is** the threshold:

| Assertion (oracle name) | Threshold | Evidence |
| --- | --- | --- |
| `input-identity` | input bytes equal the manifest identity (5,939 B / `a3c8badf...`; 3,870 B / `c877c446...`) | `docx-table-image-parts-diff.json`, `docx-watermark-parts-diff.json` |
| `changed-parts-exactly-as-declared` | the changed ZIP part set is exactly `{docProps/core.xml, word/document.xml}` for the table+image edit and exactly `{word/document.xml}` for the body edit - **no other part may change** | same two receipts |
| `undeclared-parts-unchanged` | `word/header1.xml` (`1e06df86fe9f8d135e763c087605f83e1c4c05dc47d09a52d5acc0071a858ddd`), styles, numbering byte-identical | `docx-watermark-parts-diff.json` |
| `media-bytes-unchanged` | image bytes unchanged when the edit only rotates the drawing (`<a:xfrm rot="5400000">`) | `docx-table-image-parts-diff.json` |
| `fonts-unchanged`, `layout-signature-unchanged` | section/font/layout signature identical | same receipts |
| `drawing-count-preserved`, `table-cell-text-changed`, `marker-in-saved-document` | the edit is present and nothing else disappeared | same receipts |
| `fresh-session-reopen-bytes-identical` | reopen in a new page/view returns the same bytes as the saved output (6,003 B / `8b904eb2...`; 4,154 B / `11bd745f...`) | `*-reopen-parts-diff.json` |
| independent re-run | the same oracle re-run outside the authoring tester returns the same verdict | `receipts/be-review/re-docx-*.json` |

Generalised rule for every other format (the minimum assertion table is already fixed in
`docs/office/g0/pilot-handoff.md` section 1.2): **content loss = 0 and structure loss = 0**, where "0" means
each required assertion is present and passed, and any changed part / object / asset outside the edited
region is enumerated with a written cause. A run that cannot enumerate its outside-region delta fails the
row; it does not get a tolerance.

| Format | Content/structure oracle available today | State |
| --- | --- | --- |
| docx | `docx-parts-diff.mjs` (above) | **measured** for two edits (table+image, body text) |
| xlsx | register assertions: cell value change, formula recalculated to a numeric value, expected formula value, sheet structure preserved, fresh-session reopen (`E-XLSX-CYCLE`); the r2 capability matrix marks `xlsx-open`/`xlsx-edit-cells`/`xlsx-save`/`xlsx-recalculate` `đạt có giới hạn` on web | correctness proven on web; **no part-level diff oracle run** -> `chua do`: repeat the DOCX oracle pattern on the XLSX package (changed sheet part only, rest byte-identical) |
| pptx | register assertions: text/image/shape change, objects preserved, fresh-session reopen (`E-PPTX-CYCLE`); r2 matrix marks `pptx-open`/`pptx-edit-text`/`pptx-edit-shape-image`/`pptx-save` `đạt có giới hạn` | no part-level diff oracle -> `chua do` (same pattern) |
| pdf | register assertions: existing text change, image change, pre/post extraction + pre/post render, annotation not substituted, page structure preserved (`E-PDF-TEXT-CYCLE`); r2 matrix marks `pdf-open-view`/`pdf-edit-text-in-place`/`pdf-edit-image`/`pdf-save` `đạt có giới hạn` | no part-level oracle; PDF has no ZIP part set - the equivalent is a page-object/stream delta -> `chua do` |
| md | source change, assets resolve, unrendered table preserved, fresh-session reopen (`E-MD-CYCLE`); r2 matrix marks `md-open`/`md-save`/`md-content-blocks`/`md-content-local-assets` `đạt có giới hạn` | byte-level identity is trivially available; **not yet recorded as a threshold row** -> `chua do` |
| html | source change, assets resolve, preview isolated, session read refused, fresh-session reopen (`E-HTML-CYCLE`); r2 matrix marks `html-open`/`html-save`/`html-preview-isolation`/`html-content-assets` `đạt có giới hạn` | same as md -> `chua do` |

## 4. Render differences outside the edited region - OPEN decision owned by G3

What is measured today: screenshots of before/edit/after and the reopened view for the two DOCX cycles
(`16-table-img-before-edit.png`, `28-table-img-after-save.png`, `33-table-img-reopen-screenshot.png`,
`39-watermark-before-screenshot.png`, `45-watermark-after-save-screenshot.png`,
`50-watermark-reopen-screenshot.png`), plus a single browser-clock reading per DOCX fixture
(navigation 49.8-53.6 ms, FCP 404-424 ms, `render-f-docx-*-open.json`), and the r2 ready/FCP/LCP paint
timings for the five other formats (section 5.3). Paint timings are not a fidelity comparison.

What is **not** measured: any pixel-level difference metric (per-page or per-region), any font-shaping
comparison across machines (DOC-004 records "web font shaping differs per host and is unmeasured"), and any
pixel comparison for the formats other than DOCX. There is therefore **no measured tolerance** for layout
or render differences outside the edited region, and this document does not invent one.

**Decision row (user decision 2026-09-25 - recorded exactly as decided):**

| Field | Value |
| --- | --- |
| Decision id | `DEC-RENDER-TOLERANCE` |
| Question | what layout/render difference outside the edited region is acceptable, per format, to accept a pilot row? |
| Status | **OPEN** - no default is assumed, and no row may claim fidelity while this is OPEN |
| Owner | **G3 (UNI-659)**: G3 measures the per-format pixel diffs |
| Signer | a **named human reviewer** signs after seeing the measured diffs; the Advisor records it, never the workers |
| What G0 keeps | only the rule: no content/structure loss; differences outside the edited region must be explained |
| Evidence needed before deciding | one pixel-diff per format per fixture with the edited region masked, at a fixed viewport and DPR, run on `WIN-ORCA-1.4.209`; the diff must be reported as changed-region count and maximum channel delta, with a screenshot pair |
| Options (not chosen yet) | (a) zero difference outside the masked region; (b) a stated per-format ceiling on changed pixels + a written cause for each region above it; (c) full manual page-by-page visual sign-off recorded per row |

Until `DEC-RENDER-TOLERANCE` is signed, a row may claim only what the part/object oracle proves (content and
structure), and must carry the sentence: "layout/render difference outside the edited region is not
measured; the acceptance tolerance is the open decision DEC-RENDER-TOLERANCE (owner G3 UNI-659, signer a
named human reviewer)".

## 5. Time, memory, size and complexity limits from measurements

The r1 DOCX rows (sections 5.1, 5.2) come from `../evidence/timing-reanalysis.json`, a read-only re-read of
the Tester B receipts on served build A. The r2 five-format rows (section 5.3) come from the DOC-003 r2
author run plus the independent tester-r2b check on served build B. All values are ms since the navigation
`timeOrigin` unless noted; `n = 3` per cell makes each a **measured envelope** (provisional ceiling), never
a budget (T-2).

### 5.1 DOCX - measured envelope (n = 3 per fixture; 9 opens per fixture class; served build A)

| Measure | F-DOCX-KITCHEN | F-DOCX-TABLE-IMG | F-DOCX-LONGTABLE |
| --- | --- | --- | --- |
| input package | 3,415 B zip / 5,971 B uncompressed / 11 parts | 5,939 B / 11,536 B / 17 parts | 6,558 B / 38,090 B / 17 parts |
| cold open, first usable snapshot, retries excluded | 2,274 / 2,283 / 2,336 ms | 2,442 / 2,487 / 2,722 ms | 3,547 / 3,643 / 3,810 ms |
| cold open incl. failed snapshot retries, through the first successful snapshot (the number `TIMINGS.md` reports) | 32,878 / 93,815 / 93,973 ms | 94,123 / 94,137 / 94,296 ms | 94,782 / 94,808 / 95,473 ms |
| of which failed-retry cost | 30,604 / 91,532 / 91,637 ms | 91,574 / 91,636 / 91,695 ms | 91,139 / 91,261 / 91,663 ms |
| warm open (reload + first snapshot) | 1,788 / 2,113 / 2,253 ms | 1,987 / 2,034 / 2,071 ms | 2,127 / 2,182 / 2,575 ms |
| reload alone | 739 / 784 / 795 ms | 726 / 752 / 770 ms | 723 / 800 / 1,004 ms |
| tab create alone | 1,189 / 1,317 / 1,416 ms | 1,454 / 1,462 / 1,595 ms | 1,190 / 1,220 / 2,672 ms |
| engine `docx-parse` | 62.8 / 64.6 / 66.8 ms | 68.1 / 71.2 / 97.1 ms | 99.1 / 109.5 / 121.6 ms |
| browser nav / FCP (n = 1) | 49.9 / 420 ms | 49.8 / 424 ms | 53.6 / 404 ms |
| JS heap used / total (n = 1) | 15,490,756 / 16,878,592 B | 15,118,414 / 16,882,794 B | 16,767,131 / 17,935,243 B |

Reading of these numbers (each is a threshold statement, not a wish):

- **Provisional ceiling.** On this machine the cold open of a sub-10 KB DOCX fixture must stay within the
  measured envelope **3,810 ms** and the warm open within **2,575 ms** (retries excluded). Exceeding it
  requires a recorded explanation; a lower value is not a claim about other hardware.
- **Retry cost is not part of the product.** The ~91 s in "cold open, incl. retries" is Orca
  `runtime_unavailable` retry overhead (3 x ~30.5 s). It must never be quoted as editor performance, and a
  `n >= 5` re-measurement on the target machine is required before a budget is published.
- **Memory is not yet a limit.** One heap reading per fixture (n = 1) is an observation only. A limit needs
  `n >= 5` readings per format on the target machine, taken before and after the same edit.

The F-DOCX-KITCHEN first sample is the one place where the two columns differ: `TIMINGS.md` stops at the first
successful snapshot (32,878 ms), while `../evidence/timing-reanalysis.json` also records the three later snapshot
attempts taken on that page for the render/heap readings (`totalAllAttemptsMs` = 35,293 ms). The re-analysis
reproduces the `TIMINGS.md` totals exactly for all three fixtures in both directions (cold and warm) and for
F-DOCX-TABLE-IMG / F-DOCX-LONGTABLE, which is the cross-check that makes the separated numbers usable.

### 5.2 DOCX at the Q9 band (n = 3; served build A)

| Measure | Value | Evidence |
| --- | --- | --- |
| large fixture on disk (generated, not in Git) | 46,007,964 B uncompressed / 345,554 B zip / 15 parts | `size-F-LARGE-DOCX.json` |
| engine `docx-parse` | 16,498.4 / 17,207.4 / 17,692.8 ms (n = 3), 92,393 blocks, 0 tables, 0 images | `parse-good-f-large-docx-{1,2,3}.json` |
| browser cold open | **blocked**: 3 samples, each ended `browser_error` after 3 recorded attempts; no successful snapshot, so no warm/open threshold is claimed | `cold2-f-large-docx-*` receipts |
| retry cost observed while trying | 120,881 / 128,715 / 129,016 ms | `../evidence/timing-reanalysis.json` |
| Q9 declared band (DOC-002) | `[51,380,224, 52,428,799]` B = `[49 MiB, 50 MiB)`; actual DOCX 51,399,044 B (`6866DF80...`), XLSX 51,380,278 B (`A88549E5...`) | `fixtures/q9-r2/lab-record.json` |

Threshold statement: **a 46 MB DOCX must parse in the engine within 17,693 ms (measured max, n = 3); its
browser open is not yet a passing capability** - the row stays blocked until a browser open succeeds and
records the same fields.

### 5.3 XLSX, PPTX, PDF, Markdown, HTML - measured open envelopes (r2, served build B)

Two runs exist, on the same machine and the same served build B (`ee2b86a0...`):

- **Author run** (DOC-003 r2 lead, tag `author`, run `2026-09-25T16-10-44-203Z`, ports 5724-5727): method
  `r2/scripts/author-timings.mjs`, summary `r2/receipts/author-timings/timings.json`, reported table
  `r2/TIMINGS-r2.md`. COLD = a new isolated Orca profile + new tab per sample (profile deleted after);
  WARM = in-page `location.reload()` of one open tab (the lab serves assets without cache validators, so
  warm = warm process/compiled code, not HTTP cache). `ready` = first 25 ms in-page poll where the app
  shows the fixture content (upper bound: the poll starts when orca attaches the eval). 30 counted samples
  (3 cold + 3 warm x 5 formats) plus 5 discarded warm primers; 0 of 35 failed/unready, 0 eval retries. A
  first discarded run (`author-timings-v1-warm-biased/`) biased warm by
  waiting 1.5 s before the first eval; it is kept and named, not used.
- **Independent check** (Tester r2b, claude claude-sonnet-5 medium, tag `tester2b`, run
  `2026-09-25T16-46-12-045Z`, ports 5720-5723): `r2/receipts/tester-r2b/REPORT.md`, raw
  `r2/receipts/tester-r2b/timings/`. Method check verdict **CLEAR** (each ready predicate confirmed by its
  own snapshot/eval to gate on fixture content; two samples' Navigation Timing reproduced by manual eval).
  35/35 samples ready including primers.

Both tables below give ready time (first content-confirming poll) in ms, `min / median / max`, `n = 3`
per cell. FCP/LCP, lab-data-delivered, DOMContentLoaded, transfer bytes and heap are in the two named
receipts; the notable ones are quoted after the tables.

**Author run:**

| Fixture | Cold ready | Warm ready |
| --- | --- | --- |
| F-XLSX-KITCHEN (sheets) | 2,649.2 / 2,674.9 / 2,696.6 | 2,187.8 / 2,281.2 / 2,383.9 |
| F-PPTX-STD (slides) | 725.7 / 737.5 / 827.6 | 483.8 / 514.3 / 520.8 |
| F-PDF-TEXT (pdf) | 697.7 / 713.9 / 785.5 | 560.9 / 618.3 / 623.6 |
| F-MD-FULL (markdown) | 589.1 / 648.5 / 790.2 | 468.0 / 539.9 / 562.6 |
| F-HTML-SINGLE (html) | 623.0 / 649.9 / 674.6 | 478.0 / 528.2 / 628.5 |

**Independent run (tester-r2b):**

| Fixture | Cold ready | Warm ready |
| --- | --- | --- |
| F-XLSX-KITCHEN (sheets) | 2,630.3 / 2,642.7 / 2,739.7 | 966.8 / 1,288.6 / 1,297.5 |
| F-PPTX-STD (slides) | 750.1 / 796.5 / 834.1 | 494.3 / 502.3 / 612.3 |
| F-PDF-TEXT (pdf) | 572.6 / 582.6 / 1,109.5 | 468.6 / 495.7 / 504.9 |
| F-MD-FULL (markdown) | 602.1 / 646.1 / 686.1 | 474.6 / 480.7 / 524.9 |
| F-HTML-SINGLE (html) | 600.5 / 610.5 / 722.8 | 587.1 / 593.6 / 598.9 |

Cross-run comparison of ready medians (author vs tester-r2b): XLSX cold 2,674.9 vs 2,642.7 (~1.2%);
PPTX cold ~8%, warm ~2.3%; PDF cold ~18% and warm ~20% lower in the independent run (within a generally
faster session); MD cold ~0.4%, warm ~11%; HTML cold ~6%, warm ~12% higher. Agreement is inside the
author's own noted cross-run band (3-18%, from the discarded warm-biased run's cold-vs-cold delta)
**except XLSX warm**.

**FINDING - XLSX warm reproducibility gap (~44%).** The author's three warm samples
(2,187.8 / 2,281.2 / 2,383.9 ms; raw `0020/0022/0024-sheets-warm*-ready-a1.json`) stay near cold speed,
while tester-r2b's three (1,297.5 / 1,288.6 / 966.8 ms) show progressive warm-up across the reloads - its
own discarded warm-primer took 2,625.2 ms, essentially cold speed. The likely cause (named by the
independent tester, not proved): the sheets engine/bridge warm state depends on how many reloads precede
the sample. Both runs are reported; the provisional ceiling below uses the **slower** envelope, and the
closing test is a larger `n` that separates first-reload warm from steady-state warm. This is a
cross-run reproducibility note, not a driver defect (method verdict CLEAR).

**Provisional ceilings (T-2, union of both runs, slower side kept):**

| Format | Cold open ceiling (ms) | Warm open ceiling (ms) | Note |
| --- | --- | --- | --- |
| xlsx | 2,739.7 | 2,383.9 | warm ceiling is the author's; the faster independent values are the finding above, not a substitute |
| pptx | 834.1 | 612.3 | both runs agree within ~8% |
| pdf | 1,109.5 | 623.6 | the 1,109.5 outlier is the tester-r2b cold max; medians agree (~18%) |
| md | 790.2 | 562.6 | both runs agree within ~11% |
| html | 722.8 | 628.5 | warm direction differs between runs; ceiling is the larger observed max |

Other measured r2 values worth carrying as envelope observations (medians; source rows in
`timings.json` / the r2b report): FCP cold - XLSX 1,124 / PPTX 384 / PDF 220 / MD 312 / HTML 208;
lab data delivered cold - XLSX 2,581.5 / PPTX 481.9 / PDF 546.2 / MD 555.7 / HTML 458.4;
resource transfer bytes (identical cold vs warm, no HTTP cache validators) - XLSX ~15.1 MB,
PPTX ~8.75 MB, PDF ~2.9 MB, MD ~3.03 MB (r2b recorded 3,146,420 B on warm - a second Markdown asset
variant within the fixture's expected content, per its report), HTML ~1.59 MB; JS heap used (median) - XLSX 52.6 MB cold /
161.5 MB warm, PPTX 24.6 / 45.9 MB, PDF 13.2 / 21.8 MB, MD 22.9 / 24.1 MB, HTML 14.1 / 24.2 MB. Heap
readings are observations (`n = 3` but one read per sample, no before/after-edit pair), not a limit.

**Still `chua do` for these five formats (named gaps, not silently filled):**

- **save -> serialise -> transfer per format** - no XLSX/PPTX/PDF/MD/HTML save timing exists (the only
  measured save is the n = 1 DOCX POST in section 5.6). Closing test: one scripted save per format with
  the focus-proof recipe on served build B; owner DOC-003 follow-up / Tester.
- **engine-side parse vs render split** - `xlsx-open`/`pptx-open` durations exist in the lab receipts but
  are not aggregated; the browser-side ready/FCP/LCP and lab-data-delivered are the separated parts today.
- **large-fixture browser opens** - F-LARGE-XLSX and the generated large DOCX still have no browser open
  (unchanged r1 gap; see section 5.2 for DOCX, and the r2 root-cause D2 note that the earlier
  `engine_unsupported` on XLSX was a lab wiring gap, not an engine verdict - the 74 MB workbook open is
  still unmeasured).
- **page / sheet / formula / object counts** for the five formats - not recorded in r2.
- **warm state definition for XLSX** - the finding above: a larger `n` separating first-reload warm from
  steady-state warm.

### 5.4 Size and complexity limits (DOCX engine, measured against the pinned source)

| Limit | Value | Evidence |
| --- | --- | --- |
| ZIP parts | 10,000 (engine constant) | `genoffice/packages/docx-engine/src/zip-load.ts` `DOCX_ZIP_LIMITS` at pin `09485f88` |
| largest single part, uncompressed | 536,870,912 B (512 MiB) | same |
| total uncompressed | 1,610,612,736 B (1.5 GiB) | same |
| observed refusal | a part declaring 629,145,600 B was refused with `docx rejected: part word/media/expansion.bin declares 629145600 uncompressed bytes (limit 536870912)` in 16 ms (wallMs 242 including process start) | `doc002-fixtures/evidence/probe-fixture-handling-g119.json` |
| expansion ratio | 343.12 (1,833,588 B archive -> 629,145,600 B declared part) | `docx-expansion.receipt.json` |
| nesting / XML depth | 3,000 nested XML tags (generator `depth=1500`) parsed: 2 blocks, 54 ms (lead probe), ~106 ms (independent tester), both inside the probe budget of 30,000 ms / 768 MiB | `probe-fixture-handling-g119.json`, `doc002-fixtures/REPORT.md` |
| user-facing file band | pilot is a `[49 MiB, 50 MiB)` design/measurement band, not a quota change; the candidate manifest verifier rejects a band that exceeds 50 MiB or is too wide, and rejects an on-disk file that falls outside the declared band | `q9-r2/lab-record.json`, `fixtures/manifest.json` rules, `doc002-fixtures/REPORT.md` section 2.6 |

Threshold statement: **decompression must be refused before inflation when any part declares more than the
engine limit** (16 ms measured), and **nesting up to 3,000 XML tags must not crash the parser**. Both are
measured; neither is a general robustness claim.

### 5.5 Not measured at all (explicit, with the test that would close each)

| Missing measurement | Why it matters | How to close it |
| --- | --- | --- |
| save -> serialise -> transfer per format (XLSX/PPTX/PDF/MD/HTML) and on a large/Q9 fixture | the Q9 oracle and the pilot estimate still need a save cost; only the n = 1 DOCX sample exists (section 5.6) | one scripted save per format on served build B, then a bounded run on the Q9 band fixture |
| cold start of the app build, network RTT, GPU time | distinguishes engine cost from startup/network cost | new instrumented run; out of DOC-006 scope |
| large-fixture browser open (DOCX 46 MB blocked, XLSX 74 MB never reached the engine) | Q9 band acceptance | fix the blockers named in sections 5.2/5.3 (DOCX `browser_error`; XLSX open unmeasured on the wired engine), then re-run |
| pixel-diff per format | `DEC-RENDER-TOLERANCE` needs it | see section 4: G3 measures, named human reviewer signs |
| engine-side parse timings for non-DOCX formats | separates engine cost from page ready | aggregate `xlsx-open`/`pptx-open`/`pdf-open` durations already in the lab receipts |
| page/sheet/formula/object counts for the five formats | completes the per-format envelope | extend the r2 driver to record them |

### 5.6 Save, serialise and transfer - the bounded follow-up measurement (n = 1)

The Tester B addendum (2026-09-25, lab tag `b2`, no manifest overlay) produced the measurement the first r1 run
could not: the Save control reached the lab and the lab answered 200.

| Measure | Value | Receipt |
| --- | --- | --- |
| POST `/lab/host:docs-save` (isolated page, Resource Timing after `clearResourceTimings()`) | 28.2 ms, HTTP 200 | `receipts/tester-b/b2-kitchen-save-duration.json` |
| request body | 4,879 B UTF-8, one matching save POST | `receipts/tester-b/b2-kitchen-save-network-requests.json` |
| written file | 3,436 B, SHA-256 `823f04cccb942c25b6a74257a350c9568c0fbf509c35b837da5f0413445871d3` | same addendum |
| saved package | 3,436 B compressed / 6,010 B uncompressed / 11 parts / ratio 0.5717 | `receipts/tester-b/b2-kitchen-zip-size-report.json` |
| part oracle after save | exit 0; changed set exactly `{word/document.xml}`; no additions or removals; six declared-unchanged content parts keep their hashes | `receipts/tester-b/b2-kitchen-parts-diff.json` |
| post-save JS heap | 19,595,238 used / 24,105,038 total / 4,395,630,592 limit bytes | `receipts/tester-b/b2-kitchen-post-save-memory.json` |
| run identity | lab tag `b2`, committed manifest SHA-256 `bcd592a85eb9b84d8009257ad8140b26abf6a0b87d8df29e36160fe3214f2a1c`, r7 build, Orca 1.4.209 / Chromium 150.0.7871.250, **Node v25.8.0** (not the pinned v22.23.2 - a recorded deviation) | `receipts/run-lab/b2/2026-09-25T14-36-27-139Z/start.json` |

Threshold statement: a save of a sub-10 KB DOCX must complete its POST and write a byte-verified package within
the measured envelope of **28.2 ms on this machine class (n = 1)** - a measured envelope, not yet a budget (T-2).
The earlier 404 remains in the record as a lab-route response of the overlay run, not a renderer finding, and the
DOC-003 BLOCKED verdict for the r1 run is unchanged: the addendum supplements it.

## 6. Loosening rule (never silent)

1. A row that cannot meet a threshold reports the measured value and the cause; it does not edit the
   threshold, the fixture, the oracle or the sample count to pass.
2. A threshold changes only by a written decision naming the old value, the new value, the evidence that
   justifies the change, and the human who approved it - recorded next to the threshold, in the register
   history, and in the slice REPORT. `DEC-RENDER-TOLERANCE` is the standing example of a tolerance that is
   **open** (owner G3 UNI-659, signer a named human reviewer), not defaulted.
3. A blocked row is not a pass and not a failure of the threshold; it keeps its gate unsatisfied with the
   named blocker and the named test.
4. Thresholds are per served-build identity and per machine class. A later build or a different machine
   starts a new row rather than inheriting these numbers (served builds A `b8d0abed...` and B `ee2b86a0...`
   are tracked separately in section 2 for exactly this reason).
5. Where two independent runs disagree, both stay in the record and the provisional ceiling takes the
   slower side (T-6; the XLSX warm finding is the standing example).
