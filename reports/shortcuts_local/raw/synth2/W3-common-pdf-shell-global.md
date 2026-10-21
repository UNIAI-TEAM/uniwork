# W3 — common, pdf, shell, global: web proposals rebuilt from Microsoft 365 for the web (UNI-2011 stage 1, WEBMAP addendum 1)

Output: `W3-common-pdf-shell-global.csv` (94 rows: common 23, pdf 27, shell 21, global 23; every row once, id set checked against `shortcuts.csv`). Columns as WEBMAP: `id,ms_web_win,ms_web_mac,ms_web_source,proposal_web_new,proposal_web_basis,change_note`. No product code touched, no commit.

How the values were made: `ms_web_win` / `ms_web_mac` are copied by script from `raw/C3-ms-web-lookup.csv` (or from `C3-ms-web-raw.csv` for rows the lookup does not map: common-15 Alt+Q, common-18 Ctrl+0, shell-07 Excel/PowerPoint paste, shell-12 PowerPoint comments, global-06 Ctrl+Enter); `ms_web_source` is `<page URL> <line id from the C3 raw / browser-notes row>` (all line ids resolved, 0 unresolved; a lookup row with no web page row says so). Multi-product rows list Word | Excel | PowerPoint in that order; a part with no printed key is `not documented`. **PDF: MS web has nothing for any of the 27 pdf rows** (Edge PDF viewer is not a Microsoft 365 for the web surface, W3 brief); so all pdf `ms_web_*` are `not documented` / `n/a`, and where a pdf proposal uses a key it is the Edge PDF key from `ms_win` (basis `DESKTOP-FALLBACK`, the nearest reference) or `KEEP`.

Basis of a multi-product row = its most deviating part (ALT-PROPOSED > MS-WEB-ALT > DESKTOP-FALLBACK > MS-WEB > OFFICE-WINS > KEEP); per-product parts are tagged in brackets inside `proposal_web_new` where they differ. Proposal format is `<win> / <mac>`.

## 1. Counts per `proposal_web_basis` (row level)

| basis | rows |
| --- | ---: |
| MS-WEB | 11 |
| MS-WEB-ALT | 3 |
| DESKTOP-FALLBACK | 19 |
| ALT-PROPOSED | 6 |
| KEEP | 37 |
| OFFICE-WINS | 7 |
| n/a | 11 |
| **total** | **94** |

By group: common: ALT-PROPOSED 6, DESKTOP-FALLBACK 4, KEEP 8, MS-WEB 2, MS-WEB-ALT 3; pdf: DESKTOP-FALLBACK 13, KEEP 14; shell: DESKTOP-FALLBACK 1, KEEP 1, MS-WEB 8, n/a 11; global: DESKTOP-FALLBACK 1, KEEP 14, MS-WEB 1, OFFICE-WINS 7.

**Desktop fallback (MS web prints nothing -> MS desktop key): 21 rows** have a fallback part: 19 at row level + 2 rows where only one product part falls back (common-05, common-10). 13 of the 21 are pdf rows (Edge PDF key); the other 8: common-04, common-16, common-17, common-18, shell-11, global-19, common-05, common-10.

## 2. Rows whose web proposal CHANGED (id, old -> new)

17 rows. Old = `proposal_web` in `shortcuts.csv` (shortened); new = `proposal_web_new` (shortened); the reason is in `change_note` of the CSV.

- **common-01** (MS-WEB-ALT): old: KEEP browser Ctrl+N (Chromium reserves it, page cannot own it); ALT-PROPOSED Alt+Shift+N on the New menu item (collides only with Word "Merge a document" Alt+Shift+N, a f… -> new: no key: Ctrl+N / Cmd+N stay the browser's new window (Chromium reserved); New = menu item / button, MS web route is the address-bar URL Word.new / Excel.new / PowerPoint.new (ppt.new)
- **common-05** (ALT-PROPOSED): old: Word/Excel: F12 is not browser-reserved but unverified for pages (DevTools key): F12 UNVERIFIED, test in stage 2; until then KEEP Ctrl+Shift+S. PowerPoint: KEEP Ctrl+Shif… -> new: Docs: F12 / Cmd+Shift+S [DESKTOP-FALLBACK; D8: test F12 in browsers, replace if DevTools wins] | Sheets: Alt+F2 / not documented [MS-WEB win; Mac ALT-PROPOSED suggestion Cmd+Shift+S = desktop Excel Mac key, MS web prints no Mac] |…
- **common-09** (MS-WEB-ALT): old: F6 / Shift+F6 inside each frame with preventDefault; whether Chrome/Edge let a page keep F6 is UNVERIFIED, test in stage 2 (Chrome lists F6 as browser focus key: support.… -> new: Ctrl+F6 / Shift+Ctrl+F6 inside each frame (preventDefault) / Cmd+F6 / Shift+Cmd+F6
- **common-10** (ALT-PROPOSED): old: KEEP Ctrl+F1 / Cmd+Option+R -> new: Docs: Ctrl+F3 / not documented [MS-WEB win; Mac ALT-PROPOSED suggestion Cmd+Option+R = desktop Word Mac] | Sheets: Ctrl+F1 / Cmd+Option+R [DESKTOP-FALLBACK] | Slides: Ctrl+F1 / not documented [DESKTOP-FALLBACK; desktop Mac prints …
- **common-12** (ALT-PROPOSED): old: Backlog: access keys not in scope for stage 2 unless asked; Alt alone must not be swallowed by the page -> new: Backlog (access keys not in scope for stage 2). Target when built: Docs Alt+Period / Control+Period; Sheets Alt+Period (.) / Control+Option (ALT-PROPOSED, R1 F4); Slides Alt+Period / Ctrl+Period; Alt alone must not be swa…
- **common-13** (MS-WEB-ALT): old: F1 opens UniWork help only if stage 2 shows pages can keep F1; UNVERIFIED -> new: no in-frame key: F1 stays the browser's (MS: 'common shortcuts like F1 (Help) and Ctrl+O (Open) apply to the web browser'); Help by button, as docs-094 / sheets-86 / slides-73 (R1 F5)
- **common-14** (ALT-PROPOSED): old: Add Ctrl+/ in the frame bridge (Ctrl+/ is not browser-reserved) once other modules have a sheet -> new: Docs no key (Ctrl+/ is Numbered list in Word web) | Sheets, Slides Ctrl+/ / Cmd+/ (R1 F1: Alt+Shift+A is Excel web's Accessibility Shortcuts Menu, not a shortcut sheet)
- **common-16** (DESKTOP-FALLBACK): old: KEEP frame zoom where it exists; Ctrl+Plus is not browser-reserved but page zoom is the browser default, so frames that do not zoom must leave it alone -> new: Docs, Slides: Ctrl++ / Cmd++ where the frame has in-app zoom (browser zoom otherwise) | Sheets: KEEP existing zoom (Excel Ctrl+Alt+= not proposed: AltGr)
- **common-17** (DESKTOP-FALLBACK): old: as common-16 -> new: Docs, Slides: Ctrl+- / Cmd+- where the frame has in-app zoom | Sheets: KEEP existing zoom (Excel Ctrl+Alt+- not proposed: AltGr)
- **pdf-02** (DESKTOP-FALLBACK): old: Test shiftKey in the renderer so Ctrl+Shift+S opens Save As (PowerPoint chord); F12 stays UNVERIFIED (see common-05) -> new: Ctrl+Shift+S / Cmd+Shift+S (PowerPoint desktop chord; Edge PDF has none); test shiftKey in the renderer; F12 stays with Docs (common-05)
- **pdf-04** (DESKTOP-FALLBACK): old: Add Ctrl+Y (Word, Excel, PowerPoint Windows redo) next to Ctrl+Shift+Z -> new: Ctrl+Y and Ctrl+Shift+Z / Cmd+Y and Cmd+Shift+Z (Word/Excel/PowerPoint redo, MS web prints Ctrl+Y in Docs/Sheets/Slides; Ctrl+Shift+Z kept as non-colliding secondary, D2)
- **shell-07** (MS-WEB): old: Docs: Ctrl+Shift+V = paste text only (Word); Sheets: keep paste values off Ctrl+Shift+V (Excel has none) -> new: Docs: Ctrl+Shift+V / Cmd+Shift+V = paste text only | Slides: Ctrl+Shift+V / Cmd+Shift+V = paste text, unformatted | Sheets: KEEP no Ctrl+Shift+V paste-values (MS web contradicts itself: 'Paste formatting' Shift+Ctrl+V in the table…
- **shell-12** (MS-WEB): old: Free Ctrl+Alt+M for Word "Insert comment"; paragraph dialog via ribbon or context menu -> new: Free Ctrl+Alt+M / Cmd+Option+A for Word 'Insert comment' (mac from desktop) and Ctrl+Alt+M / Cmd+Shift+M for Slides (PowerPoint web prints both); paragraph dialog via ribbon or context menu; match with event.code and no AltGraph s…
- **global-01** (OFFICE-WINS): old: KEEP outside documents; inside UniNote and Office frames Word/PowerPoint Ctrl+J = Justify wins (editor wins); ALT-PROPOSED Alt+Shift+J for Ask UNI while an editor has foc… -> new: OFFICE-WINS: Ctrl+J / Cmd+J = Ask UNI outside Office; while an Office document is open (frame or module focused) Office Ctrl+J = Justify wins; no new chord; Ask UNI reachable by button
- **global-02** (OFFICE-WINS): old: Outside documents KEEP Ctrl+K; inside UniNote and Office frames Ctrl+K = Insert hyperlink (Word, Excel, PowerPoint) wins; ALT-PROPOSED Alt+Shift+Q for search while an edi… -> new: OFFICE-WINS: Ctrl+K / Cmd+K = search outside Office; while an Office document is open Office Ctrl+K = Insert hyperlink wins; no new chord; search reachable by button
- **global-05** (KEEP): old: ALT-PROPOSED rebind default away from Ctrl+Shift+O (Chrome Bookmarks Manager); the registry comment already calls it a known gap -> new: KEEP Ctrl+Shift+O (not in the Chromium reserved list, S3 5b: page can preventDefault; no MS web key uses it)
- **global-17** (OFFICE-WINS): old: Decide per chord: editor wins by default (nothing to do); for F6 region cycling and Esc, forward the key from the frame as an event (Esc already forwarded as close_reques… -> new: OFFICE-WINS: editor wins by default; no frame-to-host key forwarding (F6 becomes Ctrl+F6 inside the frame, common-09)

Rows not listed keep the old proposal in substance; some only gained spelled-out Mac keys or a basis label (e.g. common-04, common-06, shell-04..shell-10, pdf rows that restate the Edge key).

## 3. `ALT-PROPOSED` rows

Six rows are ALT-PROPOSED at row level (MS web gives nothing for a browser-reserved key, or no Mac key where the Windows key differs, or the key is not what MS prints for the default case, or only one product part has MS's own mechanism):
- **common-07 Close**: `Alt+Shift+W` (Mac: not documented, suggestion `Option+Shift+W`). Chromium reserves Ctrl+W / Cmd+W (S3 5a). MS web prints no Close key for Word/PowerPoint; Excel web's table prints Ctrl+W but MS's own walkthrough says Ctrl+W closes the browser tab. No key MS web or MS desktop uses for Close is browser-safe (desktop Word Mac Cmd+F4, PowerPoint Ctrl+D low confidence), so the old `Alt+Shift+W` stays. Alt+Shift+W appears on no MS web page read (Alt+Shift is used there only with A, H, arrows, Tab, Enter, Esc).
- **common-05 Save As**, Sheets Mac part only: Excel web prints `Alt+F2` and no Mac key; the Windows key differs from desktop (F12), so per WEBMAP rule 7 the Mac value is `not documented`; suggestion `Cmd+Shift+S` (the key desktop Word/Excel/PowerPoint Mac use). Docs (F12 / Cmd+Shift+S) and Slides (Ctrl+Shift+S / Cmd+Shift+S) are DESKTOP-FALLBACK.
- **common-10 Expand/collapse ribbon**, Docs Mac part only: Word web prints `Ctrl+F3` (desktop Ctrl+F1) and has no Mac column, so Mac is `not documented`; suggestion `Cmd+Option+R` (desktop Word/Excel Mac).
- **common-03 Open**: Excel part `MS-WEB-ALT` (Excel web's opt-in *Override browser shortcuts*, excel-a11y L4308); Word and PowerPoint part `ALT-PROPOSED`: `Ctrl+O` / `Cmd+O` handled in the frame where UniWork has an Open action. MS Word and PowerPoint web say Ctrl+O applies to the browser and have no override setting; Ctrl+O is not Chromium-reserved (R1 F6).
- **common-12 Ribbon access keys (backlog)**: Sheets part only: `Alt+Period (.)` is what Excel web prints for the classic ribbon *when using Narrator* (excel-a11y L3555); its default key `Alt+Windows logo key` cannot reach a page (same as sheets-84). Docs and Slides parts are `MS-WEB` (R1 F4).
- **common-14 Keyboard shortcut sheet**: Docs no key; Sheets and Slides `Ctrl+/` / `Cmd+/`. No MS web page prints a key that opens a keyboard shortcut list: Excel web has the menu item Help > Keyboard Shortcuts (excel-a11y L4316), and `Alt+Shift+A` (L4234) is its Accessibility Shortcuts Menu, a different action, so it is not used. Word web uses `Ctrl+Slash (/)` for Numbered list (L4452), so Docs gets no key; Excel and PowerPoint web use `Ctrl+/` for nothing, so it is proposed there (not Chromium-reserved). Mac `Cmd+/` is the Excel Mac desktop key for the Help window (R1 F1).
The old ALT-PROPOSED keys Alt+Shift+N (common-01) and Alt+Shift+J / Alt+Shift+Q (global-01/02, plus the equivalent in slides-59, not my group) are gone; common-11 (drop the shortcut) and global-05 (rebind) are now KEEP (section 2).

## 4. Where MS web contradicts a USER decision, the desktop contract, or itself (read loudly)

1. **common-14: Ctrl+/ as the shortcut sheet is not viable in Docs on web.** Word for the web uses `Ctrl+Slash (/)` for Numbered list (word-a11y L4452). No MS web page prints a key for a shortcut list (Excel: menu item Help > Keyboard Shortcuts; `Alt+Shift+A` is the Accessibility Shortcuts Menu, a different action). Web proposal per product: Docs no key, Sheets and Slides `Ctrl+/` as ALT-PROPOSED (R1 F1); the desktop row keeps its own key (not my column).
2. **common-09: F6 is `Ctrl+F6` on web** (Cmd+F6 on Mac), as MS says on every web tab: "you'll use Ctrl+F6 instead of F6". Desktop keeps F6. **global-17**: the old "forward F6 and Esc from the frame" is dropped by USER ADDENDUM 1 (no frame-to-host forwarding). **An Esc `close_requested` forward already exists in code** (escape-forwarder); it sits uneasily with "no frame-to-host key forwarding"; left as existing behaviour, Advisor to decide.
3. **D8 / common-05: F12 as Save As on web.** MS web prints no Word Save As key; Excel web prints `Alt+F2`, not F12. F12 for Docs is only the desktop fallback, not an MS web key, and Sheets/Docs web now differ.
4. **common-03 Ctrl+O: MS contradicts itself** (Excel table prints Ctrl+O; every web intro says Ctrl+O is the browser's). Excel part: Excel's documented *Override browser shortcuts* mechanism (MS-WEB-ALT); Word and PowerPoint part: ALT-PROPOSED, they have no such setting (R1 F6). F1 (common-13) follows the browser's rule in all three: no in-frame key, Help by button (R1 F5); intercepting F1 stays an open question.
5. **common-01 New: MS web has no key at all**; the route is the address-bar URL `Word.new` / `Excel.new` / `PowerPoint.new`. The desktop contract's `Ctrl+N` stays on desktop only.
6. **shell-07 Sheets paste: MS web contradicts itself**: Excel web table prints `Shift+Ctrl+V` as *Paste formatting* (xl L3870) while the copy-paste article says Ctrl+Shift+V pastes plain text in Edge/Chrome. Kept Ctrl+Shift+V off paste-values in Sheets (old rule), picked neither meaning.
7. **global-06: Word web uses Ctrl+Enter for "Post a comment / save an edit"** (word-a11y L4502), not for a page break (the desktop meaning the old note quoted). Still OFFICE-WINS, so no change in effect, but the old reason is wrong for the web.
8. **PowerPoint web Mac differs from desktop Mac**: Insert comment `⌘+Shift+M`, align left/right `⌘+Shift+L/R`, Save = autosave (no key). Affects shell-12 (done) and slides rows (not mine).
9. **AltGr**: no new Ctrl+Alt chord proposed. The only one kept is Ctrl+Alt+M (shell-12, printed by MS web for Word and PowerPoint); match by `event.code` and refuse AltGraph, or it eats characters on AltGr layouts (S3 section 7).
10. **Chromium reservation check (S3 5a)**: none of the new keys (Ctrl+F6, Ctrl+F3, Alt+Q, Alt+Shift+W, Alt+F2, Ctrl+Y, F12) is in the reserved list. Whether Chrome still acts on Ctrl+F6 (focus next pane), F1, F12 and Alt+F2 (GNOME run dialog on Linux) before the page runs is **unverified, test in stage 2**.

## 5. Rules applied (re-check)

- Mac value when MS web prints no Mac key (Word/Excel web): MS web Windows key equals desktop -> desktop Mac key, basis MS-WEB ("mac from desktop, web page has no Mac column": common-03, common-06, shell-04, shell-06, shell-08..10, shell-12 Docs, global-04); Windows key differs -> `not documented`, desktop Mac key only as an ALT-PROPOSED suggestion (common-05 Sheets, common-07, common-10 Docs). PowerPoint web Mac column used as printed.
- MS web prints nothing and the browser does not reserve the key -> MS desktop key (`DESKTOP-FALLBACK`): common-04, common-05 (Docs, Slides), common-10 (Sheets, Slides), common-16..18, shell-11, global-19, pdf rows (Edge key).
- UniWork host keys (global group): `OFFICE-WINS` for global-01/02/06/07/10/11/17; meeting room, lists, composers, pickers and other non-Office screens stay `KEEP` (global-12/15/16 ...).
- Ours-only rows with no MS web counterpart: `KEEP` or `n/a` (web has no Home page, window menu or interface scale).

## 6. Open questions

1. common-01: should UniWork offer a `Word.new`-style URL route (for example a `/new/doc` link) as the web "new document" shortcut, or only the menu item?
2. common-05 / D8: MS web prints `Alt+F2` for Excel and nothing for Word/PowerPoint. Should Docs web really use F12 (may open DevTools), or `Alt+F2` for all three modules?
3. Mac for rows where the web Windows key differs (common-05, common-07, common-10): accept the desktop Mac key as ALT-PROPOSED, or leave `not documented`?
4. common-13: F1 stays the browser's (R1 decision, as docs-094 / sheets-86 / slides-73); is intercepting F1 ever wanted? (Only Excel web has the Override setting, opt-in.)
5. global-17: keep the existing Esc `close_requested` from frames, given "no frame-to-host key forwarding"?
6. pdf: confirm the Edge PDF key as the reference for `DESKTOP-FALLBACK` on pdf rows (the basis name is a slight misnomer; MS web has nothing).
7. Windows Alt+Shift is the input-language switch for users with several layouts (Alt+Shift+W): test with Unikey / Telex / VNI in stage 2 (unverified).
8. common-15: Alt+Q was planned for Ask UNI / command search; MS web uses it for the frame's Tell Me / Search field. Confirm it stays frame-local (USER: no key forwarding, Ask UNI by button).

## 7. Files
Read: `WEBMAP.md`, `shortcuts.csv`, `raw/C3-ms-web-lookup.csv`, `raw/C3-ms-web-raw.csv`, `raw/C3-ms-web-browser-notes.csv`, `raw/C3-ms-web.out.md`, `raw/synth/S3-shell-global-pdf.md` (5a/5b, 7), `contract.md` (D2, D8). Written: only `raw/synth2/W3-common-pdf-shell-global.csv` and `.md` (the builder scripts stay in the scratchpad).

## 8. R1 review fixes (M1b, 2026-10-20)

Rows of this file changed after review R1 (`raw/review/R1-webmerge.md`); details in its "R1 fixes" section.
- **common-14** (F1): `Alt+Shift+A` was Excel web's Accessibility Shortcuts Menu, not a shortcut sheet. `ms_web_*` = `not documented` per product; web proposal per product (Docs no key, Sheets / Slides `Ctrl+/` ALT-PROPOSED); basis MS-WEB -> ALT-PROPOSED.
- **common-13** (F5): no in-frame key, Help by button, as docs-094 / sheets-86 / slides-73; MS quote kept; basis stays MS-WEB-ALT.
- **common-03** (F6): Excel part MS-WEB-ALT (Override setting, quoted); Word / PowerPoint part ALT-PROPOSED; row basis MS-WEB-ALT -> ALT-PROPOSED.
- **common-12** (F4, F9): Sheets part `Alt+Period (.)` is Narrator-only on MS web, so ALT-PROPOSED (row basis MS-WEB -> ALT-PROPOSED); Mac cites fixed (Word Mac key is word-a11y L4185, Excel Mac key L3569).
- **shell-15** (F9): Word Mac key cite L4185. **shell-07** (F9): copy-and-paste cite is the prose row `copy-paste-office-web.html:L711/P` (added to `C3-ms-web-raw.csv`). **global-15** (F10): note moved out of the value.
