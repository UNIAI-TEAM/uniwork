# W1 — web shortcuts proposal for groups `docs`, `uninote`, `markdown` and `html` (UNI-2011, MS 365 for the web)

Output: `raw/synth2/W1-text-editors.csv` (216 rows = 103 docs + 45 uninote + 40 markdown + 28 html, each once; ids checked against `shortcuts.csv`). Inputs read-only: `C3-ms-web-lookup.csv`, `C3-ms-web-raw.csv` (line ids cited per row as `<saved file>:Lnnn`), `C3-ms-web.out.md`, `shortcuts.csv`, `S3-shell-global-pdf.md` §5a, `WEBMAP.md`. No product code touched, nothing committed.

The first W1 worker was stopped before review and before writing this file. This version is the result of the M1 review: every row was read against `WEBMAP.md` and the C3 raw data (section 7 lists the 18 rows that were edited). Product mapping: docs / uninote / markdown / html -> Word for the web (older stand-alone article `word-web-app-2554e572` and the current `word-a11y` web tab).

## 1. Counts per basis

| basis | docs | uninote | markdown | html | total |
|---|---:|---:|---:|---:|---:|
| MS-WEB | 31 | 21 | 16 | 14 | 82 |
| MS-WEB-ALT | 4 | 0 | 0 | 0 | 4 |
| DESKTOP-FALLBACK | 49 | 9 | 12 | 7 | 77 |
| ALT-PROPOSED | 6 | 2 | 5 | 3 | 16 |
| KEEP | 7 | 10 | 7 | 4 | 28 |
| OFFICE-WINS | 0 | 3 | 0 | 0 | 3 |
| n/a | 6 | 0 | 0 | 0 | 6 |
| **all** | 103 | 45 | 40 | 28 | **216** |

**Rows that fall back to the desktop key (MS web prints nothing, the key is not Chromium-reserved): 77** (docs 49, uninote 9, markdown 12, html 7):

docs-004, docs-005, docs-007, docs-012, docs-019, docs-025, docs-026, docs-027, docs-028, docs-029, docs-030, docs-033, docs-034, docs-035, docs-036, docs-037, docs-039, docs-040, docs-041, docs-042, docs-047, docs-048, docs-049, docs-054, docs-056, docs-057, docs-058, docs-059, docs-064, docs-066, docs-067, docs-068, docs-069, docs-070, docs-073, docs-074, docs-075, docs-076, docs-077, docs-078, docs-079, docs-080, docs-082, docs-083, docs-084, docs-085, docs-089, docs-093, docs-103, html-002, html-003, html-013, html-019, html-020, html-021, html-022, markdown-002, markdown-003, markdown-014, markdown-019, markdown-022, markdown-023, markdown-024, markdown-032, markdown-033, markdown-034, markdown-035, markdown-036, uninote-004, uninote-012, uninote-013, uninote-014, uninote-026, uninote-035, uninote-036, uninote-038, uninote-039.

Also partly desktop but counted `MS-WEB`: docs-097 (native browser editing keys; the Mac cells come from the older article), docs-098 (Ctrl+Delete, the right-hand twin, is not printed), docs-016 / markdown-011 / uninote-021 (MS prints the key in a prose note, not in a table row).

Reading rules used:
- `ms_web_win` / `ms_web_mac` are copied verbatim from `C3-ms-web-raw.csv` / `C3-ms-web-lookup.csv` at the cited line id, or are `not documented` / `n/a`. Word for the web has no Mac column in its current table, so `ms_web_mac` is `not documented` except where the older article or the copy-and-paste page prints a Mac key.
- Mac proposal: MS web Windows key equals the MS desktop Windows key -> the MS desktop Mac key, `change_note` says "mac from desktop, web page has no Mac column" (basis `MS-WEB`). MS web Windows key differs from desktop -> Mac key only if MS prints one (older article: indent / outdent / backspace by word), else `not documented` and basis `ALT-PROPOSED` (docs-060, docs-086, html-023, markdown-026, markdown-037, uninote-006).
- `change_note` starts with `CHANGED:` when the new web key differs from the old `proposal_web` (or its meaning); it is empty when the old proposal already meant the same key. "mac from desktop" is an information note, not a change.
- Rows of ours with no Word counterpart (view cycle, inspect mode, CodeMirror defaults, dialogs, typed patterns) are `KEEP` or `n/a`.

## 2. Rows whose web proposal CHANGED (old `proposal_web` -> new)

32 rows. Old text from `shortcuts.csv`; the reason is in the CSV `change_note`.

| id | old proposal_web | new proposal_web_new | basis |
|---|---|---|---|
| docs-001 | KEEP browser Ctrl+N (reserved). ALT-PROPOSED: Alt+Shift+N in menus/tooltips (collides with Wor… | no in-frame key (Ctrl+N is Chromium-reserved); New document by menu item or the MS web address-bar route Word… | MS-WEB-ALT |
| docs-018 | KEEP | Ctrl+F or Ctrl+G / Cmd+F | MS-WEB |
| docs-021 | KEEP | F5 / Cmd+Option+G (Ctrl+G is Find in the MS web Editing view and MS web prints no Editing-view Go To; F5 is t… | ALT-PROPOSED |
| docs-028 | KEEP Ctrl+Shift+= (same physical key as the printed Ctrl+Shift+Plus) | Ctrl+Shift+Plus (+) / not documented (Mac: current Cmd+. / Shift+Cmd+= stay) | DESKTOP-FALLBACK |
| docs-038 | KEEP; Ctrl+Shift+W is Chromium-reserved (close window), do not bind on web. If the Normal-styl… | none on web (Ctrl+Shift+W / Cmd+Shift+W close the browser window and Chromium reserves them); action not in U… | KEEP |
| docs-050 | Win KEEP. Mac: Control+Shift+M (MS) | Alt+Shift+Right or Tab / Tab | MS-WEB |
| docs-051 | Win KEEP. Mac: Cmd+Shift+M (MS) | Alt+Shift+Left or Shift+Tab / Shift+Tab | MS-WEB |
| docs-052 | KEEP; Ctrl+T is Chromium-reserved (new tab), the handler never fires on web. ALT-PROPOSED: a f… | none on web (Ctrl+T / Cmd+T are Chromium-reserved: new tab) | KEEP |
| docs-053 | KEEP; Ctrl+Shift+T is Chromium-reserved (restore tab). ALT-PROPOSED: a free Alt+Shift letter w… | none on web (Ctrl+Shift+T / Cmd+Shift+T are Chromium-reserved: restore tab) | KEEP |
| docs-060 | Ctrl+Shift+L (MS) | Ctrl+Period (.) / not documented (Mac: MS web prints none and its Windows key differs from desktop Ctrl+Shift… | ALT-PROPOSED |
| docs-061 | none until MS documents one | Ctrl+Slash (/) / not documented (desktop prints none either) | MS-WEB |
| docs-064 | KEEP | Alt+Shift+Up\|Down / Control+Shift+Up\|Down (MS web prints Alt+Shift+Up/Down only for moving a page in the Na… | DESKTOP-FALLBACK |
| docs-068 | KEEP | Ctrl+Shift+Space / Option+Space | DESKTOP-FALLBACK |
| docs-075 | KEEP | Alt+Shift+D / Control+Shift+D | DESKTOP-FALLBACK |
| docs-076 | KEEP | Alt+Shift+T / Control+Shift+T | DESKTOP-FALLBACK |
| docs-086 | KEEP | Ctrl+F3 / not documented (Mac: MS web prints no Mac key and its Windows key differs from desktop Ctrl+F1, so… | ALT-PROPOSED |
| docs-087 | Move off MS's AutoFormat chord: pick a non-MS key (open) | KEEP Ctrl+Alt+K / Cmd+Option+K (MS web prints no AutoFormat key, so the chord is free on web; AltGr guard on… | KEEP |
| docs-090 | none (large feature; defer) | Alt+Period (.) / Control+Period (.) | MS-WEB |
| docs-091 | F6 (MS) | Ctrl+F6 / Cmd+F6 | MS-WEB-ALT |
| docs-092 | Shift+F6 (MS) | Ctrl+Shift+F6 / Cmd+Shift+F6 | MS-WEB-ALT |
| docs-094 | F1 for the shortcuts sheet (browser F1 is help; preventDefault possible) | no in-frame key (MS Word web: F1 'applies to the web browser'); the shortcut sheet is reached by a menu item… | MS-WEB-ALT |
| html-012 | KEEP | Ctrl+F or Ctrl+G / Cmd+F | MS-WEB |
| html-018 | Editor wins: Ctrl+K inserts a link when text is selected; Ask AI keeps the ribbon/popover entr… | Ctrl+K / Cmd+K (inserts a link when text is selected; Ask AI stays on its ribbon/popover entry, no new chord) | MS-WEB |
| html-023 | KEEP | Ctrl+F3 / not documented (Mac: MS web prints no Mac key and its Windows key differs from desktop Ctrl+F1, so… | ALT-PROPOSED |
| markdown-003 | F12 (MS) as an alias; Ctrl+Shift+S has to give way to strikethrough/Apply Styles only if those… | F12 / Cmd+Shift+S (Windows Ctrl+Shift+S is released to Strikethrough, markdown-019) | DESKTOP-FALLBACK |
| markdown-013 | KEEP | Ctrl+F or Ctrl+G / Cmd+F | MS-WEB |
| markdown-020 | KEEP the source toggle on Ctrl+E (Obsidian parity) but note MS Ctrl+E = Center | none (Ctrl+E belongs to the source toggle, markdown-021) | KEEP |
| markdown-026 | Add Ctrl+Shift+L (MS) as an alias (validate in browsers) | Ctrl+Period (.) / not documented (current Ctrl+Shift+8 / Cmd+Shift+8 stays; MS web prints no Mac key and its… | ALT-PROPOSED |
| markdown-027 | KEEP | Ctrl+Slash (/) / not documented (current Ctrl+Shift+7 / Cmd+Shift+7 stays; the source view keeps CodeMirror C… | MS-WEB |
| markdown-037 | KEEP | Ctrl+F3 / not documented (Mac: MS web prints no Mac key and its Windows key differs from desktop Ctrl+F1, so… | ALT-PROPOSED |
| uninote-006 | Add Ctrl+Shift+L / Cmd+Shift+L (MS) as an alias; keep Ctrl+Shift+8. Validate Ctrl+Shift+L in C… | Ctrl+Period (.) / not documented (current Ctrl+Shift+8 / Cmd+Shift+8 stays; MS web prints no Mac key and its… | ALT-PROPOSED |
| uninote-007 | KEEP | Ctrl+Slash (/) / not documented (current Ctrl+Shift+7 / Cmd+Shift+7 stays) | MS-WEB |

Rows not listed keep the old proposal in substance (some only gained spelled-out Mac keys or a basis label).

## 3. `ALT-PROPOSED` rows (16)

| id | key | why MS web gives nothing / no alternative |
|---|---|---|
| docs-003 | Ctrl+O / Cmd+O | MS Word web says Ctrl+O "applies to the web browser" and prints no Open row and no alternative; Ctrl+O is not Chromium-reserved, so the frame handles the MS desktop key where UniWork has an Open action (capability-gated); elsewhere the browser keeps it. Same in html-001 / markdown-001 and slides-02. |
| docs-008 | Alt+Shift+W / not documented | Ctrl+W is Chromium-reserved and MS web prints no Close row (its walkthrough says Ctrl+W closes the browser tab); no MS key for Close is browser-safe, so the old ALT-PROPOSED Alt+Shift+W stays (same as common-07, W3). Mac: not documented (suggestion Option+Shift+W). |
| docs-021 | F5 / Cmd+Option+G | MS web prints Ctrl+G only as a Reading-view page-number key (older article L654) and as Find in the Editing view (current page L4150), and has no Editing-view Go To; Ctrl+G now belongs to Find (docs-018). Proposal F5 / Cmd+Option+G (F5 is the MS desktop Windows Go To key, desktop Mac Go To is Cmd+Option+G); F5 reloads the browser, so preventDefault only while the frame has focus, validate. |
| docs-055 | Ctrl+Alt+0 / Cmd+Option+0 | Normal style: Ctrl+Shift+N is Chromium-reserved (incognito) and MS web prints no Normal-style row; the existing UniWork key Ctrl+Alt+0 stays (AltGr guard). Same in markdown-025 and uninote-011. |
| docs-060 | Ctrl+Period | Windows key is the MS web key (Ctrl+Period, both Word web articles); desktop is Ctrl+Shift+L and MS web prints no Mac key, so Mac is `not documented` (WEBMAP rule). Same in markdown-026 and uninote-006. |
| docs-086 | Ctrl+F3 / not documented | Windows key is the MS web key (Ctrl+F3); desktop Ctrl+F1 differs and MS web prints no Mac key, so Mac is `not documented`. Same in html-023 and markdown-037. |
| html-001 | Ctrl+O / Cmd+O | as docs-003. |
| html-005 | Alt+Shift+W / not documented | as docs-008. |
| html-023 | Ctrl+F3 / not documented | as docs-086. |
| markdown-001 | Ctrl+O / Cmd+O | as docs-003. |
| markdown-005 | Alt+Shift+W / not documented | as docs-008. |
| markdown-025 | Ctrl+Alt+0 / Cmd+Option+0 | as docs-055. |
| markdown-026 | Ctrl+Period | as docs-060. |
| markdown-037 | Ctrl+F3 / not documented | as docs-086. |
| uninote-006 | Ctrl+Period | as docs-060. |
| uninote-011 | Ctrl+Alt+0 / Cmd+Option+0 | as docs-055. |

## 4. MS web contradicts a USER decision, the desktop contract or itself — flagged

1. **common-14 / docs-061 / markdown-027 / uninote-007: `Ctrl+/` is Numbered list in Word web** (word-a11y L4452). The desktop contract floated `Ctrl+/` as the shortcut sheet (common-14; W3: Docs gets no key, Sheets and Slides `Ctrl+/` as ALT-PROPOSED; `Alt+Shift+A` is Excel web's Accessibility Shortcuts Menu, not a shortcut sheet). In a Word-style frame and in UniNote, Numbered list wins; the sheet is reached by button.
2. **docs-018 / html-012 / markdown-013: Find is `Ctrl+F or Ctrl+G`** (L4150). It takes `Ctrl+G` away from Go To (docs-021 moves to F5, ALT-PROPOSED). The older Word-web article prints Ctrl+G as the page-number control of the Reading view (L654): MS web uses Ctrl+G for two things depending on the view. For html / markdown the CodeMirror source view must be checked for a clash with its own Find-next (`Ctrl+G` is Find next in CodeMirror search).
3. **docs-050 / docs-051 / docs-062 / uninote-032: indent is `Alt+Shift+Right` or `Tab` on web** (older article, medium confidence; the current Word-web table has no indent row). Desktop is `Ctrl+M` / `Ctrl+Shift+M`; web Mac prints only `Tab` / `Shift+Tab`. The older article also says `Tab` in a table cell moves to the next cell (docs-099), so Tab is three things (indent, list level, next cell) depending on context.
4. **docs-060 / docs-086: bullet list `Ctrl+Period (.)` and ribbon collapse `Ctrl+F3`** differ from desktop (`Ctrl+Shift+L`, `Ctrl+F1`) and have no Mac key on MS web. Today UniWork uses neither on web. `Ctrl+.` was also today's superscript alias (docs-028): dropped, `Ctrl+Shift+=` stays.
5. **docs-091 / docs-092: panes are `Ctrl+F6` / `Ctrl+Shift+F6` on web**, as every MS web tab says ("you'll use Ctrl+F6 instead of F6"). The desktop contract keeps F6.
6. **docs-001 New, docs-094 Help, docs-003 Open: MS says these belong to the browser.** New = address-bar route `Word.new`; Help (`F1`) = no in-frame key, shortcut sheet by button; Open (`Ctrl+O`) = kept, because MS gives no alternative. Word and PowerPoint web have no *Override browser shortcuts* setting (only Excel has), so in MS's own app the browser keeps F1 / Ctrl+O; intercepting them is a UniWork choice.
7. **docs-005 Save As: F12 is only the desktop fallback.** MS web prints no Word Save As key (Excel web prints `Alt+F2`). F12 is the DevTools key; decision D8 asks for a browser test. html-003 / markdown-003 follow docs-005.
8. **docs-072 / uninote-037: Insert comment `Ctrl+Alt+M`** is printed by MS web for Word (L4474), so the old "move Ctrl+Alt+M off the Paragraph dialog" is confirmed for web too; AltGr guard needed (match by `event.code`, refuse `AltGraph`).
9. **uninote-041 / global-06: Word web uses `Ctrl+Enter` to post a comment / save an edit** (L4502), not for a page break (the desktop meaning). Still OFFICE-WINS / KEEP in effect, but the old reason is wrong for web.
10. **OFFICE-WINS rows (uninote-015 Ctrl+K, uninote-031 Ctrl+J, uninote-041):** Office keys win while the page editor has focus; the UniWork global key is unchanged outside the editor; no new chord (the old Alt+Shift+J / Alt+Shift+Q proposals are gone). USER ADDENDUM 1 words the rule as "while an Office document is open (frame or module focused)"; UniNote is a page editor in the host document, not an Office frame, so applying it there follows contract §3 rule 3 (D2), not ADDENDUM 1 verbatim.
11. **markdown-020 / markdown-021 / uninote-005: `Ctrl+E`** is Center in Word web (L4440) but stays inline code (UniNote) / source toggle (markdown-021) because those editors have no alignment (markdown-020 inline code gives the chord up: one action per chord, R1 F8); it moves only when alignment is added (uninote-029).
12. **markdown-019 / uninote-004 Strikethrough:** MS web and MS Windows desktop print no strike key; `Ctrl+Shift+S` stays on Windows for it (that chord is Apply Styles in Word, docs-059, and Save As in PowerPoint). Not an MS web finding; a UniWork collision inside the markdown / UniNote products, noted.
13. **Chromium-reserved keys** (S3 §5a): none is proposed as a key the page must intercept. docs-038 (Ctrl+Shift+W), docs-052 (Ctrl+T), docs-053 (Ctrl+Shift+T) are `KEEP` / none because UniWork has no such action yet and MS web prints nothing (no Alt+Shift letter is invented). Alt+Shift+W (docs-008 / html-005 / markdown-005) appears on no MS web page row read; Windows Alt+Shift is the input-language switch for some users (Unikey / Telex / VNI test in stage 2).
14. **AltGr:** Ctrl+Alt chords kept or proposed on web (Ctrl+Alt+1/2/3 headings, Ctrl+Alt+C/V, Ctrl+Alt+F/D, Ctrl+Alt+I, Ctrl+Alt+K, Ctrl+Alt+M, Ctrl+Alt+0, Ctrl+Alt+Minus) need the shared AltGr guard on Windows (contract §3.7).

## 5. Checks on proposed keys

- Chromium-reserved list (Ctrl+W, Ctrl+Shift+W, Ctrl+N, Ctrl+Shift+N, Ctrl+T, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp/PgDn): only named in rows that say "no in-frame key" or in the ALT-PROPOSED Alt+Shift+W rows.
- Same-product clashes on web (checked in `C3-ms-web-raw.csv`): `Ctrl+G` (Find vs Go To), `Ctrl+/` (numbered list vs shortcut sheet), `Ctrl+.` (bullets vs old superscript alias), `Tab` (indent / list level / next cell), `Ctrl+F3` (collapse ribbon; Word web has no other Ctrl+F3 row). `Alt+Period` (ribbon key tips) does not clash with any Word web row.

## 6. Open questions

1. docs-021: is F5 acceptable for Go To in Docs web (reload key, MS desktop Windows Go To key), or is Go To left unbound on web until MS prints an Editing-view key?
2. Keep the desktop aliases next to the MS web keys (Ctrl+Shift+Z redo, Ctrl+Shift+8 / Ctrl+8 formatting marks, Ctrl+Shift+S for strike in markdown / UniNote)? The CSV keeps the non-colliding ones and states it in the proposal text; dropping them is a behaviour change.
3. docs-050 / docs-051: adopt `Alt+Shift+Right/Left or Tab/Shift+Tab` for indent on web (older article, medium confidence), or keep `Ctrl+M` / `Ctrl+Shift+M` as desktop does? The CSV follows MS web.
4. docs-008 / html-005 / markdown-005 (and common-07): is `Alt+Shift+W` for an in-app Close acceptable (unvalidated; Alt+Shift switches the input language on some Windows setups)?
5. UniNote rows with `n/a until ... exists` (alignment, indent, comments, replace): the MS web key is recorded for when the feature is added; confirm that those features are not part of UNI-2011.
6. Which Mac key for bullets / ribbon collapse when MS web prints none (docs-060, docs-086): leave `not documented`, or accept the desktop Mac key as an ALT-PROPOSED suggestion (as W3 did for some rows)?

## 7. Rows corrected during the M1 review (18)

Content corrections (6):
- **docs-099** (Table: next / previous cell): the first pass wrote `not documented` / DESKTOP-FALLBACK, but the older Word-web article prints `TAB` (next cell, L1348) and `SHIFT+TAB` (previous cell, L1402) on Windows and Mac. Now `ms_web_win` / `ms_web_mac` = `TAB ; SHIFT+TAB`, basis `MS-WEB`; the key is unchanged (Tab / Shift+Tab), `change_note` empty.
- **docs-094** (Help / shortcut sheet): basis `KEEP` -> `MS-WEB-ALT`, the same basis slides-73 / sheets-86 use for "MS says F1 is the browser's, Help by button"; the MS sentence is now quoted in `change_note`.
- **docs-008, html-005, markdown-005** (Close): the first pass dropped the old ALT-PROPOSED `Alt+Shift+W` and wrote `KEEP`. WEBMAP keeps an ALT-PROPOSED key where MS web prints nothing for a Chromium-reserved key, and W3 keeps `Alt+Shift+W` for common-07; now `ALT-PROPOSED`, `Alt+Shift+W / not documented`, `change_note` empty (old = new).
- **markdown-032** (move block): `change_note` was `CHANGED: basis only, key unchanged`; the rule is "empty iff same key", so it is now empty.

Source-citation fixes (12): the Mac values `⌘+X` / `⌘+C` / `⌘+V` of docs-013..015, html-008..010, markdown-008..010 and uninote-018..020 come from the copy-and-paste page prose (`copy-paste-office-web.html:L711`, "press ⌘+C, ⌘+X, or ⌘+V (Mac)"); the cell cited only the Windows line. The Mac citation was added; no value changed.

Checked and left as is: every other `ms_web_win` / `ms_web_mac` that is not `not documented` / `n/a` was matched to its cited line in `C3-ms-web-raw.csv` (0 mismatches); all `not documented` rows were searched in the Word-web raw rows (word-a11y web tab, older article, copy-paste page, ribbon page) for a row of the same action, and docs-099 was the only miss. Mac for rows where MS web Windows equals desktop: desktop Mac key; docs-018 (`Ctrl+F or Ctrl+G` contains the desktop `Ctrl+F`) was treated as equal.

## 8. Files

Read: `WEBMAP.md`, `shortcuts.csv`, `C3-ms-web-lookup.csv`, `C3-ms-web-raw.csv`, `C3-ms-web.out.md`, `raw/synth/S3-shell-global-pdf.md` §5, `W2-sheets-slides.md`, `W3-common-pdf-shell-global.md`. Written: `raw/synth2/W1-text-editors.csv` (corrected in place) and this file.

## 9. R1 review fixes (M1b, 2026-10-20)

Rows of this file changed after review R1 (`raw/review/R1-webmerge.md`); details in its "R1 fixes" section.
- **docs-003, html-001, markdown-001** (F6): Ctrl+O text aligned with the rule "handled in the frame where UniWork has an Open action; the browser keeps it elsewhere" (basis stays ALT-PROPOSED).
- **markdown-020, markdown-021** (F8): Ctrl+E has one action in the markdown group, the source toggle (markdown-021); inline code (markdown-020) is `none` (KEEP).
- **docs-090, docs-092, docs-097, docs-098, docs-013..016, html-008..010, markdown-008..011, uninote-018..021** (F9, F10): cite lines fixed (Word Mac key L4185, ribbon L1077, prose rows `L711/P` added to `C3-ms-web-raw.csv`); docs-097, docs-092, docs-098 cells are verbatim parts again, annotations live in `ms_web_source`.
- **markdown-025, uninote-011** (F12): "AltGr guard on Windows" added to the proposal. **docs-021** (F13): F5 is the MS desktop Windows Go To key (the Mac one is Cmd+Option+G).
- **docs-061, markdown-027, uninote-007** (F11): no change; their Mac cell is `not documented` (the desktop prints no key either), so no desktop Mac key is borrowed.
