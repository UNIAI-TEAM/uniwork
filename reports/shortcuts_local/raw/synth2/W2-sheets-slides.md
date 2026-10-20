# W2 — web shortcuts proposal for groups `sheets` and `slides` (UNI-2011, MS 365 for the web)

Output: `raw/synth2/W2-sheets-slides.csv` (176 rows = 98 sheets + 78 slides, each once; ids checked against `shortcuts.csv`). Inputs read-only: `C3-ms-web-lookup.csv`, `C3-ms-web-raw.csv` (line ids cited per row as `file:Lnnn` = saved HTML line; prose lines come from the C3 lookup `source_url`), `C3-ms-web.out.md`, `shortcuts.csv`, `S3-shell-global-pdf.md` §5a. No product code touched, nothing committed.

## 1. Counts per basis

| basis | sheets | slides | total |
|---|---:|---:|---:|
| MS-WEB | 51 | 34 | 85 |
| MS-WEB-ALT | 6 | 4 | 10 |
| DESKTOP-FALLBACK | 22 | 24 | 46 |
| ALT-PROPOSED | 7 | 4 | 11 |
| KEEP | 12 | 10 | 22 |
| OFFICE-WINS | 0 | 1 | 1 |
| n/a | 0 | 1 | 1 |
| **all** | 98 | 78 | 176 |

**Rows that fall back to the desktop key (MS web prints nothing): 46** (22 sheets, 24 slides): sheets-03, sheets-09, sheets-11, sheets-13, sheets-16, sheets-17, sheets-26, sheets-27, sheets-38, sheets-41, sheets-44, sheets-51, sheets-54, sheets-55, sheets-56, sheets-58, sheets-62, sheets-66, sheets-68, sheets-83, sheets-87, sheets-91, slides-03, slides-04, slides-10, slides-11, slides-15, slides-24, slides-27, slides-30, slides-31, slides-32, slides-33, slides-35, slides-37, slides-38, slides-39, slides-41, slides-46, slides-52, slides-58, slides-61, slides-62, slides-67, slides-68, slides-71.

Also partly desktop but counted `MS-WEB`: sheets-30, -31 (Up/Down arrows), -43, -59 (F8), -63..-65 (Ctrl+2/3/4 not adopted), slides-42 (Shift+Tab), -18 (Backspace), -40 (Ctrl+Arrow fine step).

Reading rules used for the Mac column:
- Excel web has no Mac column, so `ms_web_mac` is `not documented` for every printed Excel row (one exception: ribbon key tips `Control+Option`, prose). Where the Windows key equals desktop **or differs only in notation** (Ctrl+Shift+4 vs Ctrl+Shift+$, Ctrl+Plus vs Ctrl+Shift+Plus, Ctrl+Shift+; vs Ctrl+Shift+:, Ctrl+Shift+7 vs &, Ctrl+' / Ctrl+Shift+' vs "; same physical chord on a US keyboard) the Mac proposal is the MS desktop Mac key and the note says "mac from desktop, web page has no Mac column".
- PowerPoint web has a real Mac column and is used as printed.
- `change_note` starts with `CHANGED:` only when the Windows key changes or the old proposal text named a different key; other rows may carry an informational note (no prefix) or are empty.

## 2. Rows whose web proposal CHANGED (old `proposal_web` -> new)

37 rows. Old text from `shortcuts.csv`; the reason is in the CSV `change_note`.

| id | old proposal_web | new proposal_web_new | basis |
|---|---|---|---|
| sheets-01 | KEEP browser Ctrl+N (reserved); ALT-PROPOSED Alt+Shift+N for an in-app New (host/documents list owns it) | no in-app key; Ctrl+N stays the browser's; New by File menu / documents-list button (MS web equivalent = the … | MS-WEB-ALT |
| sheets-04 | F12 (MS); same risk and fallback as docs-005 (F12 opens browser DevTools, a page can preventDefault, validate… | Alt+F2 / not documented | ALT-PROPOSED |
| sheets-06 | KEEP browser Ctrl+W (reserved); ALT-PROPOSED Alt+Shift+W only if an in-app close chord is wanted | Ctrl+W / Cmd+W stay the browser's (Chromium-reserved: the page cannot intercept them; the browser closes the tab) | ALT-PROPOSED |
| sheets-22 | KEEP Windows Ctrl+9 / Ctrl+Shift+9 | Ctrl+9 hide / Ctrl+Shift+9 unhide / mac: Ctrl+9 hide, Cmd+( hide (MS desktop) | MS-WEB |
| sheets-23 | KEEP Windows Ctrl+0 / Ctrl+Shift+0 | Ctrl+0 hide / Ctrl+Shift+0 unhide / mac: Ctrl+0 hide, Cmd+) hide (MS desktop) | MS-WEB |
| sheets-39 | KEEP Ctrl+PageDown (browsers may keep it for tab switching, not validated); ALT-PROPOSED Alt+Shift+PageDown | Alt+Ctrl+Page down / Option+Right arrow | MS-WEB-ALT |
| sheets-40 | KEEP Ctrl+PageUp (browser tab switch; not validated); ALT-PROPOSED Alt+Shift+PageUp | Alt+Ctrl+Page up / Option+Left arrow | MS-WEB-ALT |
| sheets-42 | KEEP | Ctrl+G / Ctrl+G | MS-WEB |
| sheets-46 | F11 / Alt+F1 (MS); F11 is browser fullscreen so web: ALT-PROPOSED none, keep ribbon | Alt+F1 / not documented | ALT-PROPOSED |
| sheets-47 | KEEP | F4 / F4 (Mac Cmd+T dropped: Chromium new-tab chord) | ALT-PROPOSED |
| sheets-48 | KEEP Alt+=; drop Ctrl+Shift+T on web (browser reopen-closed-tab, page cannot take it) | Alt+= / no key on web Mac (Shift+Cmd+T is Chromium restore-tab) | ALT-PROPOSED |
| sheets-55 | KEEP | Ctrl+` / Ctrl+` | DESKTOP-FALLBACK |
| sheets-56 | KEEP | Ctrl+[ / Ctrl+] (precedents / dependents) / Ctrl+Shift+[ / Ctrl+] | DESKTOP-FALLBACK |
| sheets-77 | KEEP | Ctrl+Shift+; (= Ctrl+Shift+:) / Cmd+; | MS-WEB |
| sheets-80 | KEEP | Ctrl+Shift+F2 / Cmd+Shift+F2 | MS-WEB |
| sheets-81 | KEEP Ctrl+Shift+L | Ctrl+Shift+L / Ctrl+Shift+L or Cmd+Shift+F | MS-WEB |
| sheets-84 | Alt / F10 (MS); bare Alt toggles the browser menu bar on Windows, not validated | Alt+Period (.) / Control+Option (Narrator key, borrowed; default MS web key cannot reach a page) | ALT-PROPOSED |
| sheets-85 | F6 / Shift+F6 (MS) | Ctrl+F6 / Ctrl+Shift+F6 / Cmd+F6 / Shift+Cmd+F6 | MS-WEB-ALT |
| sheets-86 | F1 (MS; browser F1 opens browser help, not validated) | no key: F1 stays the browser's; Help by button (MS web override: Help > Keyboard Shortcuts > Override browser… | MS-WEB-ALT |
| sheets-87 | KEEP (MS Ctrl+Alt+= / Ctrl+Alt+- overlap AltGr, not proposed for web) | Ctrl+Alt+= / Ctrl+Alt+- / not documented | DESKTOP-FALLBACK |
| slides-01 | KEEP browser Ctrl+N (reserved); ALT-PROPOSED Alt+Shift+N for an in-app New (host/documents list owns it) | no in-app key; Ctrl+N / Cmd+N stay the browser's; New by File menu / documents-list button (MS web equivalent… | MS-WEB-ALT |
| slides-06 | KEEP browser Ctrl+W; ALT-PROPOSED Alt+Shift+W only if an in-app close chord is wanted | Ctrl+W / Cmd+W (browser closes the tab; the page cannot intercept it) | MS-WEB-ALT |
| slides-12 | KEEP | no web key for Paste formatting (Ctrl+Shift+V / Cmd+Shift+V is Paste text, unformatted on MS web) | n/a |
| slides-14 | KEEP | Ctrl+M / none | MS-WEB |
| slides-22 | KEEP F5 | Ctrl+F5 / Cmd+Shift+Return | MS-WEB |
| slides-23 | KEEP | Shift+Ctrl+F5 / Cmd+Shift+F5 | MS-WEB |
| slides-25 | KEEP | N / Enter (Return) / Page down / Right / Down / Space | MS-WEB |
| slides-26 | KEEP | P / Page up / Left / Up / Backspace (mac: Delete) | MS-WEB |
| slides-28 | KEEP | G, then Right / Left arrow, then Enter (Return) / same | MS-WEB |
| slides-34 | Ctrl+S inside the show = All Slides (MS) vs Save: show-scoped override needed | Ctrl+S (All Slides, show-scoped); Ctrl+T and F1: no key / Control+click | ALT-PROPOSED |
| slides-44 | Ctrl+Shift+] / Ctrl+Shift+[ (MS) | Ctrl+] / Ctrl+[ one step; Ctrl+Shift+] / Ctrl+Shift+[ front / back / Cmd+Shift+Option+F / B one step; Cmd+Shi… | MS-WEB |
| slides-45 | Ctrl+Space (MS) | Space (media object selected) / Space | ALT-PROPOSED |
| slides-56 | KEEP | Ctrl+E / Ctrl+L / Ctrl+R / Ctrl+J / Cmd+E / Cmd+Shift+L / Cmd+Shift+R / Cmd+J | MS-WEB |
| slides-59 | Ctrl+K = hyperlink (MS); move the Ask AI chord into the Alt+Shift scheme used by global-01/02 (letter chosen … | Ctrl+K / Cmd+K = hyperlink; Ask AI popover by button only | OFFICE-WINS |
| slides-69 | F6 / Shift+F6 (MS) | Ctrl+F6 / Shift+Ctrl+F6 / Cmd+F6 / Shift+Cmd+F6 | MS-WEB-ALT |
| slides-72 | Alt / F10 (MS; bare Alt toggles the browser menu bar, not validated) | Alt+Period (.) / Ctrl+Period (.) | MS-WEB |
| slides-73 | F1 (MS; browser help, not validated) | no key: F1 stays the browser's; Help by button / none | MS-WEB-ALT |

## 3. `ALT-PROPOSED` rows

| id | key | why MS web gives nothing / no alternative |
|---|---|---|
| sheets-04 | Alt+F2 / not documented | Alt+F2 is the MS web key; the Mac cell is not printed (Excel web has no Mac column) and Alt+F2 differs from desktop F12, so mac = not documented per the WEBMAP rule; today's Shift+Cmd+S stays until decided. |
| sheets-46 | Alt+F1 / not documented | Alt+F1 is the MS web key; F11 (desktop) is browser fullscreen; desktop Mac F11 is browser-owned, so mac = not documented. |
| sheets-06 | Ctrl+W / Cmd+W (stay the browser's) | Ctrl+W / Cmd+W are Chromium-reserved: the page cannot intercept them. Excel web's table prints Ctrl+W (L3518) but no Excel page says it closes the tab; the quote 'press Ctrl+W to close the browser tab' is on the Word page (sr-word-basic L1399) and the PowerPoint page (sr-ppt-basic L1702), so this is not MS-WEB-ALT for Excel (R1 F3). |
| sheets-47 | F4 / F4 | Windows F4 is the MS web key (L3785). Excel web has no Mac column and desktop Mac Cmd+T is the Chromium new-tab chord, so the Mac half is the other MS desktop Mac key, F4 (R1 F2). |
| sheets-48 | Alt+= / no key on web Mac | Windows Alt+= is the MS web key (L4171). Excel web has no Mac column; desktop Mac prints only Shift+Cmd+T, the Chromium restore-tab chord, so Mac has no key on web (ribbon / button) (R1 F2). |
| sheets-82 | Ctrl+L / Ctrl+L | Ctrl+L is the MS web key for Insert a table (Windows); Ctrl+T is Chromium-reserved. Excel web has no Mac key and desktop Mac Cmd+T is Chrome new-tab, so Ctrl+L is reused with Control. |
| sheets-84 | Alt+Period (.) / Control+Option | Excel web prints Alt+Period (.) only for the classic ribbon *when using Narrator* (L3555); its default key is Alt+Windows logo key (L3575), which a page cannot receive. Alt+Period is borrowed from the Narrator row (R1 F4). Mac Control+Option is printed in prose (L3569). |
| slides-02 | Ctrl+O / Cmd+O (kept; no MS alternative exists) | MS web says Ctrl+O belongs to the browser and prints no Open row; no other key for Open exists in MS web or desktop, so Ctrl+O is kept (not Chromium-reserved, the frame intercepts it). |
| slides-34 | Ctrl+S (All Slides, show-scoped); Ctrl+T and F1: no key / Control+click | Ctrl+T (taskbar) is Chromium-reserved and F1 belongs to the browser per MS web; both dropped. Ctrl+S inside the show (All Slides) kept show-scoped. |
| slides-45 | Space (media object selected) / Space | Ctrl+Space is clear-formatting on MS web, so media play/pause moves to Space on a selected media object (MS desktop Mac key). |
| slides-70 | Alt+Shift+O (no MS key) / Alt+Shift+O | Ctrl+Shift+Tab is Chromium-reserved; MS web prints nothing and no other MS key exists for this action, so the previous Alt+Shift+O stays (not used by any PowerPoint web row). |

## 4. MS web contradicts a USER decision, the desktop contract, or UniWork today — flagged

- **slides-12 Paste formatting.** MS web gives `Ctrl+Shift+V` / `⌘+Shift+V` to *Paste text, unformatted* (ppt L3163; copy-paste-ppt-web L722: Chrome/Edge only, Chrome needs the Office extension). The desktop contract (and UniWork today) use the same chord for *Paste formatting*. Web proposal follows MS web; Paste formatting has no web key. Needs a decision before S-slides.
- **sheets-12 Paste values only.** Excel web prints `Shift+Ctrl+V` labelled "Paste formatting." (L3870) while the Excel copy-paste article (L824) says the chord pastes plain text. UniWork today = paste values. Kept (KEEP), because plain text is the closest MS web meaning; MS web contradicts itself.
- **slides-44 vs slides-55 `Ctrl+]` / `Ctrl+[`.** MS web: send backward / bring forward one step (L3222, L3232). UniWork today: font size +1 / -1 pt. The proposed context split (text editing = font step, object selected = z-order) is mine, not MS's.
- **slides-45 / slides-53 `Ctrl+Space`.** MS web = clear character formatting (L3478); desktop contract row 45 = play/pause media. Media moves to Space.
- **sheets-16 `Ctrl+Enter`.** MS web = Follow hyperlink (L4008); desktop = fill selection with the current entry. Kept for the cell editor; the two meanings overlap when a hyperlink cell is selected.
- **slides-22 / -23 slide show start.** MS web `Ctrl+F5` / `Shift+Ctrl+F5` (Mac `⌘+Shift+Return` / `⌘+Shift+F5`), desktop `F5` / `Shift+F5`. Ctrl+F5 is the browser hard-reload chord (page can intercept; not Chromium-reserved). Also slides-14: MS web Mac New slide = "No shortcut" (desktop Mac ⌘+Shift+N).
- **slides-28 go to slide.** MS web = `G`, arrows, Enter; desktop and UniWork today = type the number, Enter.
- **Browser-taken keys.** MS web says F1 and Ctrl+O apply to the browser (excel L3434, ppt L2943): sheets-86 and slides-73 become "no key" (Help by button); slides-02 keeps Ctrl+O (see section 3); sheets-02 prints Ctrl+O in the Excel table although the same page says it is the browser's (MS contradicts itself): `MS-WEB-ALT` through Excel web's opt-in *Override browser shortcuts* ("You can control these shortcuts, so they work the same in both versions of Excel by changing the Keyboard Shortcuts settings.", L4308), and kept in the frame (R1 F6).
- **Sheets Save As / Go To / panes / ribbon.** Alt+F2 (not F12), Ctrl+G only (not F5), Ctrl+F6 (not F6), Alt+Period / Alt+Windows logo key (not Alt / F10). `Alt+Windows logo key` cannot reach a page, hence Alt+Period (.) (printed at L3554 for Narrator) is proposed; this goes beyond what MS web states for the default case, so sheets-84 is `ALT-PROPOSED` (R1 F4).
- **Number formats / current time / insert cells.** MS web `Ctrl+Shift+1..6`, `Ctrl+Shift+;`, `Ctrl+Plus` look different from the desktop symbols but are the same physical chords on a US keyboard; treated as equal, not as differences.
- **sheets-53 deviation from the WEBMAP Mac rule.** Desktop Mac `Cmd+=` for Calculate is not adopted (browser / Univer zoom-in chord). Other Mac deviations: sheets-82 and sheets-39/40 (explained in `change_note`).
- **MS desktop data oddity.** C2 prints `Ctrl+D` for "Close a presentation." (C2 raw L830), not a key I can vouch for; web uses the browser Ctrl+W instead (slides-06).
- **AltGr guard.** Ctrl+Alt chords kept or proposed on web (Ctrl+Alt+V, Ctrl+Alt+M, Ctrl+Alt+O, Ctrl+Alt+= / -) need the shared AltGr guard; Alt+Ctrl+PageDown / PageUp (sheets-39/40) are not character keys and are not affected.

## 5. Checks on proposed keys

- Chromium-reserved (S3 §5a: Ctrl+W, Ctrl+Shift+W, Ctrl+N, Ctrl+Shift+N, Ctrl+T, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp/PgDn, Alt+F4): none is proposed as a key the page must intercept. Ctrl+W (sheets-06 `ALT-PROPOSED`, slides-06 `MS-WEB-ALT`) is proposed as the browser's own; Ctrl+PgUp/PgDn replaced by Alt+Ctrl+PgUp/PgDn (MS web); Ctrl+T, Ctrl+Shift+Tab, Ctrl+N have no key (slides-70 keeps Alt+Shift+O).
- Same-product clashes on web (checked in `C3-ms-web-raw.csv`): Excel Shift+F3 is printed for both Find (L3526) and Insert a function (L3711) -> Find proposal keeps Ctrl+F only; Excel Ctrl+Shift+M is the Copilot mode switch (L4205) -> not used for comments; Excel Ctrl+Period rotates the active cell (L4122) -> not used for the Mac ribbon key. PowerPoint clashes are in section 4.

## 6. Open questions

- Keep the desktop aliases next to the MS web keys where MS web prints a different one (F5 for Go To and slide show, Shift+F5, Ctrl+Shift+S for Save As, Esc for end-edit, digits + Enter for go-to-slide)? The CSV proposes the MS web key only; dropping existing aliases is a behaviour change.
- Excel web Mac: MS web prints no Mac keys at all. The rule "mac from desktop when the Windows key equals desktop" was applied; where it differs (Save As, Create chart) mac is `not documented`. Does a missing Mac key mean "keep today's Mac key" or "unbound"?
- sheets-84: is Alt+Period (.) (Narrator-labelled in MS web) acceptable as the Windows ribbon key-tip chord, given Alt+Windows logo key cannot be delivered to a page?
- slides-12: which chord does UniWork use for Paste formatting on web once Ctrl+Shift+V is Paste text only (MS web has no Paste formatting key)?
- slides-55 / -44: confirm the editing-vs-selection split for Ctrl+[ / Ctrl+].
- slides-22/-23: Ctrl+F5 (hard reload in browsers) must be tested in Chrome/Edge/Firefox; same for Alt+F2, Alt+F1, Ctrl+Alt+PgDn and Alt+Left/Right (back/forward) before shipping (all "not validated").
- Web-only MS actions with no row in sheets/slides (not added, rows are fixed): Excel Shift+F4 / Ctrl+Shift+F4 find next/previous, Ctrl+Alt+L re-apply filter, Alt+Q search, Alt+Shift+A accessibility menu, Alt+Left/Right rotate object; PowerPoint J captions, Alt+F12 comment/anchor focus.
- Ctrl+K / Ctrl+B rows follow OFFICE-WINS: confirm the frame-focus rule (document open and frame/module focused) is the one the global rows (global-01/02) use.

## 7. R1 review fixes (M1b, 2026-10-20)

Rows of this file changed after review R1 (`raw/review/R1-webmerge.md`); details in its "R1 fixes" section.
- **sheets-47, sheets-48** (F2): Mac `Cmd+T` / `Shift+Cmd+T` are Chromium-reserved; Mac is now `F4` (sheets-47) and "no key on web Mac" (sheets-48); basis MS-WEB -> ALT-PROPOSED.
- **sheets-06** (F3): basis MS-WEB -> ALT-PROPOSED, Ctrl+W stays the browser's; the "close the browser tab" sentence is from the Word page, not an Excel page.
- **sheets-84** (F4): basis MS-WEB-ALT -> ALT-PROPOSED; `Alt+Period (.)` is Excel web's Narrator-only key.
- **sheets-02** (F6): basis MS-WEB -> MS-WEB-ALT with the quoted Override-setting sentence. **slides-02** (F6): text aligned with the Ctrl+O rule (frame handles it where an Open action exists).
- **slides-12** (F7): basis MS-WEB -> n/a (MS web has no Paste formatting action; its Ctrl+Shift+V is Paste text, unformatted, shell-07 / docs-016).
- **slides-65** (F10): both cells split into verbatim parts (one per key) with the line ids in `ms_web_source`.
- **sheets-05, sheets-43, sheets-67, sheets-81** (F11): the proposal text now says the Mac half comes from the desktop Mac key because the desktop Windows key is not documented.
