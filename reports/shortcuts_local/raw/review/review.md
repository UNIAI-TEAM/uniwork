# UNI-2011 stage 1 review of `shortcuts.csv`

Reviewer: worker term_e7e9f442 (read-only; no CSV, product code or commit touched).
Inputs: `reports/shortcuts_local/shortcuts.csv` (486 rows, 16 columns), fork at d999b8801, D at e7be35f41, `raw/lib-src/`, `raw/C2-ms-raw.csv`, `raw/ms-html/`.
Findings: `review.csv` (63 lines, `id,check,verdict,detail`, findings only). Working files in this folder (`check1*.csv`, `_ledger.txt`, `_sets.json`, pickles) are scratch; `_ledger.txt` has the 164 per-row hand-read verdicts.

## Counts per check

| Check | Scope | Result |
|---|---|---|
| 1a CSV / enums | 486 rows | header exact, 16 cols, ids unique, all enums valid. 4 WARN: combined status with equal halves (docs-055, docs-072, html-003, markdown-003) |
| 1b evidence resolves | 734 entries | 0 unresolved, 0 blank target lines, 0 out of range. 72 rows where the key was not within +-3 lines: 1 real defect (pdf-19 WRONG cite), 6 cites that do not show the claim (UNVERIFIABLE-by-cite, see below), 10 indirect-cite INFO rows, the rest fine on reading |
| 1c MS value in cited source | 402 rows with an MS value, 810 key segments | 471 found at the cited line id; 165 via `C2-ms-lookup[...]` plus page; 148 on the product page only (no line pin, listed in `check1c-weak.txt`); 26 composite strings by hand. **1 WRONG: docs-103** (key exists, source mis-cited). No MS key invented |
| 1d ms_win != n/a needs ms_source | 486 | 0 violations |
| 1e ALT-PROPOSED vs MS keys | all ALT rows | 1 mislabel (sheets-82), 1 same-product collision (Alt+Shift+N in docs, disclosed); others free or different product |
| 1f duplicate proposed keys | all groups | 1 real (pdf-06 / pdf-13 Ctrl+G); the rest are MS's own mode overlaps or sequencing, INFO |
| 2 semantic | 164 rows by hand | OK 155, WRONG 3 (pdf-19, slides-24, global-10), UNVERIFIABLE 6 |
| 3 MS side by hand | 45 rows against the saved HTML | all action texts and platforms match; no Win/Mac swap; 1 defect (docs-103) |
| 4 internal consistency | all proposals | 6 rows break the web rule, 2 inconsistencies, 1 AltGr contract gap (details below) |

## WRONG rows, with the correction and evidence line

1. **pdf-19** (fullscreen, check 1b/2). Evidence `fork:apps/shell/src/main/ui-scale-menu.ts:27` is `chromeFollowsUiScale` (home/sheets), it says nothing about PDF. The claim itself is true. Cite `fork:apps/shell/src/main/index.ts:5935` (buildPdfMenu: File and Help menus only, no View / `togglefullscreen`).
2. **slides-24** (Presenter view, Alt+F5, check 2). Row says web/desktop "none", status `missing`. `fork:apps/slides/src/renderer/keyboard-actions.ts:97` is `if (e.key === 'F5' && !mod)` and never tests `altKey`, so Alt+F5 calls `startSlideShow(ctx, !e.shiftKey)`, i.e. starts the show from the beginning. Correct today value: "Alt+F5 starts the slideshow from the first slide (same handler as F5)", status `conflict`.
3. **global-10** (notes, check 2). Notes list the email hub among listeners that "do not honour defaultPrevented". `D:packages/views/email-hub/use-email-hub-shortcuts.ts:61` is `if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;`. Drop "email hub" from that clause; the rest of the row (global-shortcuts.tsx:66 bubble-phase listener, definitions.ts:139 AltGraph) is right.
4. **docs-103** (Paste Special, check 1c/3). `ms_mac` "Cmd+Control+V" cites Word-for-Mac L2766, which is "Paste the selected text formatting" = Cmd+Option+V. Cmd+Control+V is on the Office-for-Mac common page, `office-mac-common.html` L728 (C2 office-common mac L728, "Paste Special (doesn't apply to all products)"). Fix `ms_source`; the value itself is real.
5. **sheets-82** (check 1e, mislabel, not a missing key). "ALT-PROPOSED Ctrl+L" is Excel's own printed key for Create table (excel windows L1172, "Ctrl+L or Ctrl+T"). Label it MS.

## Invented / unsupported keys

No invented key: every ms_win / ms_mac value appears on a cited Microsoft page, and no proposal or `*_today` key I opened has no source line. Itemised weaknesses:

- docs-103: source mis-cited (above).
- Six rows whose cite is a section comment or opener, so the claim can be neither confirmed nor refuted from the cited line (my own grep supports the claim for each, so "UNVERIFIABLE-by-cite", not WRONG): docs-012 (shortcuts.ts:74), docs-026 (shortcuts.ts:74), docs-060 (shortcuts.ts:97), docs-097 (prosemirror-view index.js:2813), uninote-038 and uninote-039 (extensions/index.ts:382). Better cites: the keymap table that would contain the key, or an explicit absence note.
- 148 MS values have a page but no line pin (traceability, not correctness); 58 rows cite only a URL.
- Page typos copied verbatim, correctly flagged in-row where noted: sheets-40 (Excel for Mac prints Ctrl+Page down for both next and previous sheet), PowerPoint Ctrl+D = Close (ppt L830) while the same page has Ctrl+D = Duplicate (L873), Word Mac Close Cmd+F4 (word mac L2419).

## Check 4 findings (full text in review.csv)

- Web proposals that take a Chromium-reserved key with no ALT-PROPOSED: docs-038 (Ctrl+Shift+W), docs-052 (Ctrl+T), docs-053 (Ctrl+Shift+T, "none yet"); close rows docs-008, html-005, markdown-005 offer no alternative while common-07, sheets-06, slides-06 use Alt+Shift+W (one alternative everywhere).
- sheets-04 keeps non-MS Ctrl+Shift+S on web though F12 is not reserved (docs-005 adopts F12). slides-59 uses Ctrl+Shift+K for Ask UNI where global-01/02 use Alt+Shift+J/Q (and Ctrl+Shift+K is Word small caps / Edge duplicate tab).
- Status inconsistencies: sheets-06 `same` with web "none" vs `missing`/`different` for the same situation elsewhere; shell-11 `different` vs docs-033 `same` for Font dialog Ctrl+D; shell-08 `different` vs sheets-14/17/63/64/65/78 `same` when only an unbound MS alternative is missing. sheets-87 desktop_today omits the Ctrl+Alt+=/-/0 interface-scale chords that common-16..18 and shell-03 report.
- AltGr: Windows Ctrl+Alt MS chords are adopted exactly (docs-041/070/072/073/074/056..058) while the docs handlers test `(metaKey||ctrlKey) && altKey && e.code` with no AltGraph guard (prosemirror-keymap itself skips Ctrl+Alt fallback on Windows, dist/index.js:111-113). Guards are mentioned per row only for docs-007/040, slides-10/47/68, sheets-87; the spec needs one shared rule. Alt+Shift alternates depend on the Windows language-switch hotkey not firing (flagged "test in stage 2" in the rows; for Vietnamese users with two layouts this should be tested first).
- Desktop = MS exactly and editor-wins-over-global are applied consistently; deviations are justified in-row (common-22, slides-06, common-12, sheets-12, pdf-17/18/20). `isReservedShortcut` (definitions.ts:293-322) has no case for Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp/PgDn, Ctrl+F4 (global-09 already proposes adding them).
- PDF rows follow the Chromium Edge page (Ctrl+G find next, Ctrl+[ ] rotate), not the legacy EdgeHTML page (Ctrl+G go to page, F9 rotate); disclosed in-row. pdf-06 vs pdf-13 both claim Ctrl+G.

## Sampled ids (check 2, 164 rows)

- Set A, all 71 rows with a `conflict` status (web or desktop): common-02, common-05, common-07, common-08, common-11, common-12, common-16, common-17, common-18, common-20, docs-002, docs-005, docs-027, docs-039, docs-059, docs-063, docs-069, docs-072, docs-087, docs-088, docs-090, docs-095, sheets-12, sheets-22, sheets-23, sheets-39, sheets-40, sheets-77, sheets-81, sheets-82, slides-15, slides-34, slides-59, pdf-02, pdf-19, html-003, html-017, html-018, html-027, markdown-003, markdown-019, markdown-020, markdown-021, markdown-026, markdown-028, markdown-031, markdown-032, markdown-040, uninote-005, uninote-006, uninote-010, uninote-015, uninote-026, uninote-029, uninote-031, uninote-034, shell-01, shell-03, shell-07, shell-12, shell-15, shell-16, global-01, global-02, global-05, global-06, global-07, global-11, global-12, global-15, global-16.
- Set B, 38 rows whose notes claim a dead / absent / swallowed handler, ids docs-001, docs-003, docs-010, docs-012, docs-033, docs-053, docs-062, docs-074, docs-097, docs-100, sheets-14, sheets-17, sheets-20, sheets-21, sheets-26, sheets-29, sheets-37, sheets-38, sheets-43, sheets-59, sheets-63, sheets-64, sheets-65, sheets-78, slides-05, slides-06, slides-19, slides-22, slides-29, pdf-06, pdf-12, uninote-038, uninote-039, uninote-043, shell-04, shell-11, global-04, global-17; including the four the brief names: slides-15 (Ctrl+Shift+D), docs-005 / common-05 (Save As `e.key==='s'`), sheets-37 (PageUp/PageDown gate), uninote-015 (Ctrl+K). All four claims verified OK.
- Set C, the 19 remaining high-confidence common / shell / global rows (all 40 high rows of those groups covered): common-06, common-10, common-19, common-21, shell-02, shell-05, shell-08, shell-10, shell-13, shell-14, shell-17, shell-20, shell-dialog-keys, global-03, global-08, global-09, global-10, global-13, global-20.
- Set D, random 10% of the other 358 rows, seed 2011, 36 ids: docs-004, docs-017, docs-022, docs-026, docs-060, docs-098, docs-102, sheets-30, sheets-33, sheets-45, sheets-52, sheets-79, sheets-83, sheets-84, sheets-87, sheets-91, sheets-dialog-keys, slides-24, slides-37, slides-40, slides-49, slides-dialog-keys, html-004, html-008, html-011, html-022, html-025, markdown-035, markdown-037, uninote-009, uninote-013, uninote-021, uninote-023, uninote-027, uninote-033, global-18. (Ids exactly as in the CSV id column.)

Check 3 rows opened against the saved HTML: Save As (common-05, docs-005, sheets-04, slides-04), Redo (docs-011), Ctrl+K (docs-071, sheets-78, slides-59), Ctrl+E/J/Ctrl+Shift+L, F6, Ctrl+Space, Excel F2/Ctrl+D/Alt+=/seven number formats/Ctrl+PgUp-PgDn, PowerPoint Ctrl+M/Ctrl+D/Ctrl+Shift+D/F5/Shift+F5/Ctrl+G, Word Go To, Close x3, PDF Find/Print/Zoom/Rotate, Mac variants.

## Overall verdict: PASS-WITH-FIXES

The sheet is trustworthy on its core claim: no key is invented, all 734 file:line entries resolve to real non-blank lines, every Microsoft key I traced is on the cited page with the matching action and platform, and the four handler claims the brief singled out (slides Ctrl+Shift+D, docs Save As `e.key==='s'`, the sheets PageUp/PageDown gate, UniNote Ctrl+K) are confirmed in code. It is not clean enough to freeze as is: 3 hand-read rows are wrong (pdf-19 evidence cite, slides-24 Alt+F5 value/status, global-10 email-hub note), docs-103 cites the wrong Microsoft line and sheets-82 labels an MS key as an alternative, six absence rows cite lines that do not show the claim, and the proposal columns break the stated web rules in six rows (reserved Ctrl+Shift+W / Ctrl+T / Ctrl+Shift+T and inconsistent alternatives for Save As, close and Ask UNI), contain one duplicate key on a surface (pdf Ctrl+G), and lack a single shared AltGr guard requirement for the adopted Ctrl+Alt chords. These are row-level fixes and one contract paragraph, none needs a new research pass, so I recommend fixing them before stage 2 builds on the sheet.
