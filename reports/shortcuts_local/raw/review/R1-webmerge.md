# R1 — review of the ms_web merge (UNI-2011)

Reviewer: `reviewer-webmerge (UNI-2011) R1` (claude sonnet-5-5). Read-only. Date 2026-10-20.
Scope: `shortcuts.csv` (new `ms_web_win`, `ms_web_mac`, `ms_web_source`, `proposal_web`, `proposal_web_basis`), `raw/merge_ms_web.py`, `raw/synth2/W1..W3`, `WEB-DIFF.md`, `contract.md`. Rules: `raw/WEBMAP.md`. Sources: `raw/C3-ms-web-raw.csv`, `C3-ms-web-lookup.csv`, `C3-ms-web.out.md`, `raw/ms-html*/`, `raw/synth/S3-shell-global-pdf.md` §5a.

## Verdict: PASS-WITH-FIXES

No key was invented and none was copied from the desktop column; the merge is exact; WEB-DIFF counts match. There are **6 MEDIUM** findings (a wrong basis or a wrong claim that a worker reading the table would act on) and **6 LOW** findings (labels, cite lines, wording). Nothing blocks stage 2 once the MEDIUM rows are fixed; none needs new research.

| Check | Result |
| --- | --- |
| 1. verbatim keys / cites | PASS (3 LOW cite/format notes: F9, F10) |
| 2. basis rules | PASS-WITH-FIXES (F2, F3, F4, F5, F6, F7, F11) |
| 3. Chromium / duplicates / AltGr | PASS-WITH-FIXES (F2, F3, F8, F12) |
| 4. merge integrity | PASS |
| 5. WEB-DIFF and contract | PASS-WITH-FIXES (F1, F6, F5) |

## Method (what was run)

Stdlib python (`python -I`), scripts in the review scratchpad (not in D). Each script reads `shortcuts.csv`, the W files, `C3-ms-web-raw.csv` and the saved HTML in `raw/ms-html*/`.

1. Every non-`not documented`/`n/a` part of `ms_web_win`/`ms_web_mac` (361 key values, compound values split on ` | `, ` ; `, `; `) was looked up in the C3 raw rows **and** the HTML line of every cited line id (`<file>:Lnnn`, lists and ranges). First run: 147 misses; after reading the cited HTML lines (many cites point at an HTML line, not a C3 raw row, e.g. `word-a11y.html:L4115`, `copy-paste-office-web.html:L711`, `excel-a11y.html:L4234`) 22 misses remain, all explained below (F9, F10). Case-only or invented values: 0. Desktop-copied values: 0 (the three rows where a desktop key equals a web key, `slides-12`, `slides-17`, `slides-62`, are different actions; see F7).
2. Reverse check: the 190 rows with `ms_web_win = not documented` were compared with every C3 raw row of the same product by action text and by key. No row hides a key MS web prints (best matches are other actions: `docs-008` vs "Whole document", `slides-15` vs "Duplicate selected objects", `slides-12` see F7).
3. Basis rules: scripted tests for MS-WEB with no printed key, DESKTOP-FALLBACK with a printed key, KEEP with a desktop key, MS-WEB proposal vs printed key, Mac-from-desktop rule, MS-WEB-ALT quote present and found in the saved HTML (22 rows), OFFICE-WINS list.
4. Chromium list (S3 §5a: Ctrl/Cmd+N/T/W, +Shift variants, Ctrl+Tab/PgUp/PgDn/F4, Alt+F4/Cmd+Q) scanned over every `proposal_web`; same-group chord duplicates; Ctrl+Alt chords vs `ime_altgr`/AltGr mention.
5. Merge: byte/BOM/CR check, round-trip, column-by-column diff against `git show HEAD:…/shortcuts.csv`, value equality with the W files.
6. WEB-DIFF §1–§4 recomputed from the CSV; contract §2 table counts recomputed; contract §3/6.1/6.2/8/9 read in full against the USER decisions.
7. By hand: **≥ 110 rows** across all ten groups (common, docs, sheets, slides, pdf, html, markdown, uninote, shell, global): the 70 lowest action-similarity MS-WEB rows (cited raw action vs row action), all 11 OFFICE-WINS, all 18 MS-WEB-ALT, all 26 ALT-PROPOSED, all 87 KEEP and all DESKTOP-FALLBACK proposals vs their desktop key.

## Check 4 — merge integrity: PASS

- `shortcuts.csv`: 486 data rows, same ids in the same order as `HEAD`; header = the documented 20 columns; no ragged row; UTF-8 with BOM, LF, no CR, no mojibake; re-serialising with `csv.writer(lineterminator='\n')` reproduces the file byte for byte.
- Old columns unchanged: only `proposal_web` differs from HEAD (440 cells, 46 are identical). `ms_web_*`, `proposal_web`, `proposal_web_basis` equal the W files for all 486 ids (0 mismatches); each id is in exactly one W file (W1 216, W2 176, W3 94).
- `proposal_web` differs from HEAD in 440 rows but only 82 are flagged `CHANGED`: the W files define CHANGED as "the key changed"; most of the other 358 were `KEEP …` text and now name the key. A token comparison found one key change not flagged (`sheets-41`, notation only), so 82 is right.
- `merge_ms_web.py` cannot be re-run on the merged file (header check, by design). `contract.md`/`WEB-DIFF.md`/W1 `.md`: UTF-8, LF, no BOM, diacritics intact.

## Check 5 — WEB-DIFF and contract

- `WEB-DIFF.md` §1 table (all 10 groups + total × 7 bases), §2 (142 fallback rows, the id list and the by-group sentence), §3 (82 rows = every `CHANGED:` note), §4 (26 ALT-PROPOSED rows, same ids): **all equal the CSV**. `contract.md` §2 basis counts (185 / 18 / 142 / 26 / 87 / 11 / 17) equal the CSV.
- USER decisions in contract §3 rule 2–3, §6.2, §8.1, §9 (D3, D4): web = Microsoft 365 for the web, Office keys win while Office is open, no new chord, no forwarding, Ask UNI/search by button, `Alt+Shift+J/Q` dropped: stated consistently. The one existing forward (`close_requested{reason:'escape'}`, global-17) is disclosed, not hidden.
- Contradictions inside `contract.md`: F1 (Alt+Shift+A), F6 (Ctrl+O vs §3 rule 2(b)), F5 (F1 vs common-13), F13 (docs-071 listed as OFFICE-WINS).

## Findings

Severity: MEDIUM = wrong basis or wrong claim a slice worker would act on; LOW = label, cite or wording. Fix = smallest change. The failing rows are also in `R1-webmerge.csv`.

### MEDIUM

**F1 — common-14 (also contract §6.1 last paragraph, §7)**
- Wrong: the action is "Keyboard shortcut sheet" but `Alt+Shift+A` is Excel web's *Accessibility Shortcuts Menu* ("Press Alt+Shift+A to access the common features quickly by using the following shortcuts", a list of landmark / Search / Go to / sheet keys). MS web's real shortcut sheet is the dialog **Help > Keyboard Shortcuts**, opened from the menu, no key. Basis `MS-WEB` and the contract sentence "phím MS web in cho bảng phím tắt của Excel" overstate it; WEB-DIFF §5 repeats "printed by Excel web only".
- Evidence: `ms-html/excel-a11y.html:L4234` (cited), heading "Accessibility Shortcuts Menu"; `excel-a11y.html` "Control keyboard shortcuts … Select Help > Keyboard Shortcuts" (same page, after the table).
- Fix: `ms_web_win` = `not documented` (Alt+Shift+A is a different action; note it), `proposal_web_basis` = `ALT-PROPOSED` (Alt+Shift+A kept as a proposal, flagged for the Vietnamese-IME test it already gets), reword contract §6.1 and §7 ("phím mở hộp thoại: đề xuất `Alt+Shift+A` — MS Excel web dùng phím này cho Accessibility Shortcuts Menu, không phải bảng phím tắt").

**F2 — sheets-47, sheets-48 (Mac column)**
- Wrong: Mac proposals use `Cmd+T` (`F4 / F4 or Cmd+T`) and `Shift+Cmd+T` (`Alt+= / Shift+Cmd+T`); both are Chromium-reserved on Mac (new tab / restore tab, S3 §5a), and basis is `MS-WEB`. The W2 note for sheets-48 says "Ctrl+Shift+T stays dropped on web (browser restore-tab)" and the sheets-82 note calls `Cmd+T` "the Chrome new-tab chord", so the same file contradicts itself. Excel web prints no Mac key for either row.
- Evidence: `shortcuts.csv` sheets-47/48 `proposal_web`; `raw/synth/S3-shell-global-pdf.md` §5a (cross-checks, Mac rows "unverified, test in stage 2").
- Fix: sheets-47 Mac = `F4` only; sheets-48 Mac = `not documented`; basis `ALT-PROPOSED` for sheets-48 (no Mac key, desktop Mac key reserved), note the reason.

**F3 — sheets-06**
- Wrong: `Ctrl+W / Cmd+W` with basis `MS-WEB`, but the W2 note itself says Ctrl+W is Chromium-reserved and that MS says it closes the browser tab. A Chromium-reserved chord is allowed only with `MS-WEB-ALT`/`ALT-PROPOSED` (WEBMAP, check 3); the sister row slides-06 is `MS-WEB-ALT`. Also the quoted sentence is cited from a **Word** page (`sr-word-basic L1399`, "Navigate back to Word for the web, and then press Ctrl+W to close the browser tab") and used for Excel; no Excel page says it.
- Evidence: `raw/ms-html-web/sr-word-basic.html:L1399`; `grep -n "close the browser tab"` in `sr-excel-basic.html` and `excel-a11y.html` finds nothing.
- Fix: basis `MS-WEB-ALT` (as slides-06), say in the note that the sentence is from the Word page and Excel prints `Ctrl+W` in its table (L3518); contract §6.1 row "Ctrl+W" same wording ("bài hướng dẫn của MS" → "bài hướng dẫn Word web").

**F4 — sheets-84 (also related: common-12, docs-090, shell-15 notes)**
- Wrong: basis `MS-WEB-ALT` with **no quoted MS sentence** (WEBMAP requires one). The proposal `Alt+Period (.)` for Excel web is printed only for "the classic ribbon **when using Narrator**" (L3555–L3556); for the default case Excel web prints `Alt+Windows logo key`, which a page cannot receive. WEB-DIFF §5 already says this goes beyond what MS web states.
- Evidence: `ms-html/excel-a11y.html:L3555-L3556` ("Display the access keys (ribbon commands) on the classic ribbon when using Narrator." `Alt+Period (.)`), `L3575` ("press Alt+Windows key").
- Fix: basis `ALT-PROPOSED` (reason: MS web's default key cannot reach a page; `Alt+Period` is MS's Narrator key, borrowed), or keep MS-WEB-ALT and quote the Narrator sentence. Mention "Narrator" in the note either way.

**F5 — common-13 vs docs-094 / sheets-86 / slides-73**
- Wrong: three module rows say "no in-frame key; MS web leaves F1 to the browser; Help by button" (quote verified in the saved HTML, e.g. `ppt-a11y-create.html:L2943`, `word-a11y.html:L4115`), while common-13 (basis `MS-WEB-ALT`) proposes "F1 intercepted in frames to open UniWork help (like Excel web 'Override browser shortcuts' ON)". Only Excel web has that setting. Basis `MS-WEB-ALT` fits the module rows; for common-13 intercepting F1 is a UniWork choice, not an MS web alternative. The contract (§6.1) and WEB-DIFF §5 flag the conflict and ask for "one answer".
- Fix: pick one. Smallest: common-13 = same as the three rows (no key, Help by button, quote the same sentence); keep "intercept F1" only as an open question in contract §10.

**F6 — Ctrl+O: contract §3 rule 2(b) vs §6.1 and the rows (common-03, sheets-02, docs-003, html-001, markdown-001, slides-02)**
- Wrong: §3 rule 2(b) says "F1 và Ctrl+O MS web nói thuộc trình duyệt → không đặt phím trong khung, Trợ giúp qua nút", but §6.1 says "`Ctrl+O` giữ như hiện có (common-03, docs-003, slides-02)" and the CSV keeps `Ctrl+O / Cmd+O` in the frame for docs-003, html-001, markdown-001, slides-02 (ALT-PROPOSED) and common-03 (MS-WEB-ALT, "handled by the page only where UniWork has an Open action (preventDefault, as Excel web 'Override…')"). Word and PowerPoint web have no Override setting, so the Excel justification does not carry over. Ctrl+O is not on the Chromium list, so keeping it is defensible, but the contract states both.
- Evidence: `contract.md` §3 rule 2(b) vs §6.1 paragraph "Phím trang chặn được…"; `word-a11y.html:L4115`.
- Fix: reword §3 rule 2(b) to "F1 … → không đặt phím trong khung; Ctrl+O MS web nói thuộc trình duyệt nhưng không nằm trong danh sách Chromium giữ: giữ như hiện có, `ALT-PROPOSED`, chưa thử" and make common-03's basis `ALT-PROPOSED` for Word/PowerPoint (MS-WEB-ALT only for the Excel part).

### LOW

**F7 — slides-12**: basis `MS-WEB` while `ms_web_win` = `not documented`; the proposed `Ctrl+Shift+V / Cmd+Shift+V` is MS web's *paste text only* (a different action from "Paste formatting"), the row's own text says "Paste formatting: no key". Fix: basis `n/a` or `KEEP` for this action; paste-text-only already lives on shell-07/docs-016. (Same pattern, lighter: slides-65 and docs-097 are `MS-WEB` with the proposal "native browser text-editing keys", see F10.)

**F8 — markdown-020 vs markdown-021 (rule 3, duplicate chord in one group)**: both are `KEEP Ctrl+E / Cmd+E`; markdown-020 is "Inline code" but its proposal text describes the source toggle ("Ctrl+E / Cmd+E for the source toggle"). `web_today` says Inline code `Ctrl+E` is shadowed by the source toggle. Fix: markdown-020 → `none (shadowed by markdown-021; pick a free chord when inline code is re-enabled)`. uninote-005 is fine (UniNote has no source toggle). Context-split pairs are acceptable, not findings: docs-050/062/099 `Tab`, sheets-09/47 `F4`, slides-44/55 `Ctrl+]` (object vs text), slides-52/67 `Ctrl+=` (text edit vs zoom; note `Ctrl+Shift++` is the same physical key as `Ctrl++`, worth one line in the stage-2 test list), slides-32/61 `Ctrl+H`, slides-03/34 `Ctrl+S` (show-scoped).

**F9 — cite lines that do not hold the value**: docs-090, shell-15, common-12 (Word Mac `Control+Period (.)`) cite `word-a11y.html:L4266` (Windows row only); the Mac key is at `L4185` ("press Control+Period (.) to start"). docs-092 Mac `Shift+Command+F6` cites `ribbon-keyboard-954cd3f7.html:L1074`; it is at `L1077`. docs-013/014/015/016, html-008..010, markdown-008..011, uninote-018..021, shell-07 cite `copy-paste-office-web.html:L711`, which is an HTML line (verified: it holds `Ctrl+C`, `⌘+C`, `Ctrl+Shift+V`) but not a C3 raw id, so it cannot be looked up in `C3-ms-web-raw.csv` (the raw only has the PowerPoint rows L745/750/755). Fix: correct the four line ids; for the L711 rows add "(HTML line, Word section; not in C3 raw)" or add the Word rows to C3 raw.

**F10 — values that are summaries, not verbatim keys**: docs-097 (win value contracts "Shift+Ctrl+Right/Left/Up/Down arrow key"; Mac cell is prose "not documented (current table has no Mac column); older article Mac cells: …"; the source is a range `L4307 .. L4371`), slides-65 (both cells are summary lists with "(rows L3266-L3434)", the Mac list omits several printed keys such as `⌘+Shift+Up/Down arrow key`), docs-092 / docs-098 / global-15 (parenthetical notes inside the value). The values are all traceable to the cited rows (checked), but the CSV contract says verbatim. Fix: put the annotation in `notes`, keep the cell as `see rows L…` or the first key, basis `MS-WEB` stays.

**F11 — Mac-from-desktop rule not met strictly**: WEBMAP allows the desktop Mac key only when the MS web Windows key equals the desktop Windows key. sheets-05, sheets-43, sheets-67, sheets-81, docs-061, markdown-027, uninote-007, common-14 have `MS desktop Windows = not documented` (so the equality cannot be shown) and still take the Mac key from desktop with basis `MS-WEB`. Values are right (same physical key / MS prints the Mac key); only the label is stretched. Fix: note "desktop Windows key not documented; Mac from desktop" in `notes`, or move those Mac halves to `ALT-PROPOSED`. Same for docs-050/062 (web `Alt+Shift+Right or Tab`, Mac `Tab` as printed by the older article: fine).

**F12 — AltGr flag**: `markdown-025` and `uninote-011` propose `Ctrl+Alt+0 / Cmd+Option+0`; their `proposal_web` carries no AltGr remark (docs-055 does), and `ime_altgr` of markdown-025 says "ok (ProseMirror ignores keydown while composing)" without AltGr (uninote-011 says "keymap skips Ctrl+Alt on Windows", so it is covered). Fix: add "(AltGr guard on Windows)" to both proposals. The other Ctrl+Alt chords (headings, Ctrl+Alt+M/F/D/C/V/I, Ctrl+Alt+=/-) all mention the guard in `proposal_web` or `ime_altgr`; `Alt+Shift+<letter>` chords (W, O, A) are covered by contract §6.1's IME warning.

**F13 — contract §6.2 table, Ctrl/Cmd+K row**: lists `docs-071` under `OFFICE-WINS`; in the CSV docs-071 is `MS-WEB` (the OFFICE-WINS set is global-01/02/06/07/10/11/17, slides-59, uninote-015/031/041). Fix: drop `docs-071` from that parenthesis or say "(`MS-WEB`: docs-071)". Also docs-021 note "F5 is the MS desktop Mac alternative" should read "MS desktop Windows key" (desktop Mac Go To is `Cmd+Option+G`).

## Rule 2/3 results with no finding (for the record)

- **MS-WEB-ALT (18 rows)**: all carry a quoted MS sentence except sheets-84 (F4); the 17 quotes were found in the saved HTML (dash and apostrophe normalised): `Word.new`/`Excel.new`/`PowerPoint.new`, `Ctrl+F6 instead of F6`, `F1 (Help) and Ctrl+O (Open) apply to the web browser`, the Teams/other-browser sheet-switch note, `press Ctrl+W to close the browser tab` (slides-06, `sr-ppt-basic`).
- **DESKTOP-FALLBACK (142)**: `ms_web_win` is `not documented` for every one except common-04/common-18/slides-03 (partial: PowerPoint autosave sentence, Excel `Ctrl+0` = Hide columns) which are correct as partial fallbacks. None uses a Chromium-reserved chord or F1/Ctrl+O. Chords such as `F12` (docs-005, D8), `F5`-class and `Ctrl+D` are interceptable, not reserved, and are flagged "test in browsers".
- **KEEP (87)**: no MS web action, or the desktop key is Chromium-reserved and the row says "none on web" (docs-038/052/053, common-08); the ten KEEP rows that carry a desktop key (docs-081, docs-087, sheets-12/18/50, slides-17/55/66, uninote-034, global-18) are "existing behaviour"; sheets-18 (Fill right `Ctrl+R`, desktop MS key exists, MS web prints nothing) would be `DESKTOP-FALLBACK` by WEBMAP, but `Ctrl+R` is also the browser reload so KEEP + preventDefault is defensible; mentioned, not counted.
- **ALT-PROPOSED (26)**: each has a reason in W `.md`; the Chromium-reserved ones keep the browser key (Ctrl+W, Ctrl+Shift+N); non-reserved ones (Ctrl+O ×4, docs-021 F5, slides-45 Space, slides-70 Alt+Shift+O) rest on "MS web prints nothing / MS says the browser takes it / the MS key is taken by Find or by a reserved chord" (see F6).
- **OFFICE-WINS (11)** match the USER rule (Office key wins while an Office document is open; UniWork key unchanged outside; no new chord; no forwarding; `Alt+Shift+J/Q` absent from the whole CSV). No leftover `Alt+Shift+N/J/Q` or "forward" text in any `proposal_web` except the disclosed global-17 / escape-forwarder.
- **Chromium chords in a proposal**: only as "none / stays the browser's" (common-01, docs-001, sheets-01, slides-01, docs-038/052/053, global-09/15, uninote-042) or as the browser's own key (common-07, docs-008, html-005, markdown-005, slides-06); violations are F2 and F3 only.
- **pdf (27 rows)**: MS web has nothing for the Edge PDF viewer; all are DESKTOP-FALLBACK (13) or KEEP (14) with `ms_web_*` = `not documented`/`n/a`, as the W3 brief asked.

## Counts

| Item | Count |
| --- | ---: |
| rows in CSV / ids in W files / ids merged | 486 / 486 / 486 |
| `ms_web_*` key values checked against C3 raw + cited HTML | 361 |
| invented or desktop-copied web keys | 0 |
| findings | 13: MEDIUM 6 (F1–F6), LOW 7 (F7–F13) |
| rows listed in `R1-webmerge.csv` (one per id, the F6 and F9 groups name one representative plus the group in the text) | 26 (MEDIUM 12, LOW 14) |
| further rows covered by a named group in a finding | F9 L711 group ~17 ids; F11 group 7 ids |
| WEB-DIFF count mismatches | 0 |
| contract text contradictions | 3 (F1, F6, F13) + 1 open (F5) |

## Not checked

Nothing was run in a browser; Chromium behaviour is taken from S3 §5a as the brief says. The MS pages were not re-fetched (the saved HTML in `raw/ms-html*/` was used). Product code was not read.


## R1 fixes (M1b, 2026-10-20)

`worker-webmerge (UNI-2011) M1b`. All 13 findings fixed at the source: W files edited (`raw/synth2/W1-text-editors`, `W2-sheets-slides`, `W3-common-pdf-shell-global`, `.csv` and `.md`), then `raw/merge_ms_web.py` rerun. The script refuses an already merged file, so `shortcuts.csv` was first reset to `HEAD`, which holds the pre-merge 16 columns; the merged file is the script's output only, never hand-edited. `raw/merge_ms_web.py` itself: five `CONTRADICTIONS` texts updated (common-14 / `Ctrl+/`, Ctrl+O, F1, Close, Sheets key tips) and one added (Excel Mac `Cmd+T`). `contract.md` fixed in Vietnamese. New basis counts: MS-WEB 178, MS-WEB-ALT 17, DESKTOP-FALLBACK 142, ALT-PROPOSED 33, KEEP 87, OFFICE-WINS 11, n/a 18 (was 185 / 18 / 142 / 26 / 87 / 11 / 17). WEB-DIFF section 3 now lists 86 CHANGED rows (was 82: + common-13, sheets-47, sheets-48, markdown-020).

| Finding | Rows | What changed |
| --- | --- | --- |
| F1 | common-14, contract 6.1 / 7 | `ms_web_*` = `not documented` per product (Excel prints the list as menu item Help > Keyboard Shortcuts, L4316; `Alt+Shift+A` L4234 is the Accessibility Shortcuts Menu, said in `ms_web_source`). Per product: Docs no key (Word web `Ctrl+Slash (/)` = Numbered list, L4452), Sheets and Slides `Ctrl+/` / `Cmd+/` as `ALT-PROPOSED` (neither product uses `Ctrl+/` anywhere in `C3-ms-web-raw.csv`; `Cmd+/` is the Excel Mac desktop Help key). Basis MS-WEB -> ALT-PROPOSED. Contract 6.1 and 7 rewritten; `Alt+Shift+A` is gone as a proposal. |
| F2 | sheets-47, sheets-48 | Mac `Cmd+T` / `Shift+Cmd+T` dropped (Chromium-reserved). sheets-47 Mac = `F4` (the other key Excel Mac desktop prints); sheets-48 Mac = "no key on web Mac (ribbon/button)" (Excel Mac prints no other AutoSum key). Both `ALT-PROPOSED`. Contract 6.1 Mac row says so. |
| F3 | sheets-06, contract 6.1 Ctrl+W row | Basis MS-WEB -> `ALT-PROPOSED`, `Ctrl+W` / `Cmd+W` stay the browser's. The sentence "press Ctrl+W to close the browser tab" is only on `sr-word-basic` L1399 (and `sr-ppt-basic` L1702 for slides-06), not on an Excel page; `ms_web_source` and the note say so. Contract: "bài hướng dẫn của MS" -> the Word web / PowerPoint web pages. |
| F4 | sheets-84, common-12 | sheets-84 basis MS-WEB-ALT -> `ALT-PROPOSED`: `Alt+Period (.)` is Excel web's Narrator key (L3555), the default key `Alt+Windows logo key` (L3575) cannot reach a page; Mac `Control+Option` (L3569) is printed. common-12 carried the same idea for Sheets (its old text named the unreachable `Alt+Windows logo key`): Sheets part now `Alt+Period (.)` `ALT-PROPOSED`, Docs / Slides parts stay MS-WEB, row basis MS-WEB -> ALT-PROPOSED. docs-090 / shell-15 are Word rows (`Alt+Period` is printed for Word web), only their Mac cite changed (F9). |
| F5 | common-13, contract 6.1, 10 | `F1` stays the browser's in common-13 too: no in-frame key, Help by button, MS sentence quoted (word-a11y L4115; the Excel and PowerPoint pages say the same). Excel's Override setting is opt-in and not adopted. "Intercept F1" only as an open question (contract 10). Basis stays MS-WEB-ALT (same as docs-094, sheets-86, slides-73). |
| F6 | common-03, sheets-02, docs-003, html-001, markdown-001, slides-02, contract 3 rule 2(b), 6.1 | Excel: `MS-WEB-ALT` with the quoted sentence ("You can control these shortcuts, so they work the same in both versions of Excel by changing the Keyboard Shortcuts settings.", excel-a11y L4308): sheets-02 basis MS-WEB -> MS-WEB-ALT. Word / PowerPoint / the other products: `ALT-PROPOSED`, `Ctrl+O` handled in the frame where UniWork has an Open action, the browser keeps it elsewhere (the four ALT rows reworded to say it). common-03 is one row for three products: row basis MS-WEB-ALT -> ALT-PROPOSED (part tags inside the proposal). Contract 3 rule 2(b) and 6.1 now say exactly that. |
| F7 | slides-12 | Basis MS-WEB -> `n/a`: proposal "no web key for Paste formatting (`Ctrl+Shift+V` is Paste text, unformatted on MS web: shell-07, docs-016)"; the source cell says the L3163 key is a different action. |
| F8 | markdown-020, markdown-021 | `Ctrl+E` has one action in the group, the source toggle (markdown-021, KEEP, existing). markdown-020 inline code = `none` (KEEP); it stays on the toolbar and backticks. Judgement call: MS web Word `Ctrl+E` = Center and neither markdown action has an MS web key, so I did not invent a replacement chord for inline code (an ALT-PROPOSED key needs the browser and Vietnamese-IME matrix); say if you want one. uninote-005 / uninote-029 unchanged (029 is conditional on alignment). |
| F9 | docs-090, shell-15, common-12, docs-092; docs-013..016, html-008..010, markdown-008..011, uninote-018..021, shell-07 | Word Mac `Control+Period (.)` cited at word-a11y L4185; docs-092 Mac cite L1074 -> L1077. The L711 cites are HTML lines of the copy-and-paste page, so 12 prose rows were appended to `raw/C3-ms-web-raw.csv` (marked "prose line, row added by hand in M1b", line ids end `/P`: copy-paste L711 Word Windows + Mac, word-a11y L4185, excel-a11y L3569, ribbon L1077 Windows + Mac) and the cites read `L711/P`. The raw file now has 710 rows (698 + 12); `parse_ms_web.py` would drop them if rerun. |
| F10 | docs-097, slides-65, docs-092, docs-098, global-15 | Cells are verbatim parts joined with ` ; `, one per printed key, line ids listed in the same order in `ms_web_source`; annotations moved to `ms_web_source`. docs-097 Windows: the contracted `Shift+Ctrl+Right/Left/Up/Down arrow key` is now four printed keys; Mac: six older-article keys (the cell was prose before). slides-65: 29 Windows and 29 Mac parts (L3266-L3434). docs-098 Mac: `ALT+BACKSPACE ; CMD+BACKSPACE` (L922, L1024). global-15: "Word: not documented". |
| F11 | sheets-05, sheets-43, sheets-67, sheets-81 | The real set is these four (desktop Windows `not documented`, Mac key taken from desktop): label kept MS-WEB, the proposal text now says "Mac half from the MS desktop Mac key; the MS desktop Windows key is not documented". docs-061, markdown-027, uninote-007 (also named in F11) borrow no desktop key: their Mac is `not documented` and desktop prints none, so no change. common-14 is covered by F1 (its Mac half is now ALT-PROPOSED). |
| F12 | markdown-025, uninote-011 | "(AltGr guard on Windows)" added to `proposal_web`. |
| F13 | contract 6.2 Ctrl/Cmd+K row; docs-021 | docs-071 removed from the OFFICE-WINS parenthesis ("docs-071 là MS-WEB"). docs-021 text: F5 is the MS desktop Windows Go To key, the desktop Mac one is `Cmd+Option+G`. |

W `.md` files: basis tables, CHANGED tables, ALT-PROPOSED sections (new rows: common-03, common-12, common-14, sheets-06, sheets-47, sheets-48, sheets-84), contradiction notes and open questions updated; each has a new "R1 review fixes" section at the end.

### Check outputs (run on the regenerated `shortcuts.csv`)

```
CHECK 1  ms_web_win / ms_web_mac key parts checked: 479; not found in C3-ms-web-raw.csv: 0
CHECK 2  basis counts: {'MS-WEB-ALT': 17, 'KEEP': 87, 'ALT-PROPOSED': 33, 'DESKTOP-FALLBACK': 142, 'MS-WEB': 178, 'n/a': 18, 'OFFICE-WINS': 11} total 486
CHECK 3  rows naming a Chromium-reserved chord outside parentheses: 11; basis other than MS-WEB-ALT/ALT-PROPOSED: 2
   keeping the browser key (MS-WEB-ALT / ALT-PROPOSED): common-01, sheets-01, slides-01 (Ctrl+N), common-07, sheets-06, slides-06 (Ctrl+W), slides-34 (Ctrl+T, dropped)
   regex hits that are not proposals: sheets-39, sheets-40 ('Ctrl+Page down/up' inside the MS-printed 'Alt+Ctrl+Page down/up')
   KEEP rows that name the chord only to refuse it: global-09 (adds Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageUp/PageDown, Ctrl+F4 to the refused set), global-15 (drops the Ctrl+N alias)
CHECK 4  same web chord on two rows of one group: 7, all context splits (the kind F8 already accepted): docs Tab (indent / list level / table cell: docs-050, 062, 099), sheets F4 (sheets-09, 47), slides Ctrl+S (03, 34, show-scoped), Ctrl+H (32, 61), Tab (35, 42, 58, 64: hotspot / object / indent / table cell), Ctrl+] (44, 55), Ctrl+= (52, 67). No duplicate left in markdown (Ctrl+E fixed).
gitleaks dir --no-banner --redact: no leaks found on shortcuts.csv, WEB-DIFF.md, contract.md, merge_ms_web.py, C3-ms-web-raw.csv and the six W files (.csv + .md); this report is scanned too.
```

Check 1 reads each `ms_web_*` cell part by part (split on ` | `, ` ; `, `; `, product / platform labels stripped) and requires an exact match with a whole raw key cell or one of its `, ` / ` or ` parts (case, dash and quote normalised). The check scripts live in the scratchpad, not in the repo.
