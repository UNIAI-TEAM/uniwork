# C2 — Microsoft 365 shortcut reference, rebuilt from raw HTML (UNI-2011 stage 1)

Fetch date: 2026-10-20 (UTC+7). Every key below was parsed from the saved HTML in `raw/ms-html/` with `raw/parse_ms.py` (standard library, `python -I`); no WebFetch was used for key values.

## Output files

| File | What it is |
| --- | --- |
| `raw/C2-ms-raw.csv` | 1,718 parsed rows: `product,platform,section,action,keys,source_url,line_in_html_or_table_index` (`L<line>/T<table index>`) |
| `raw/C2-ms-lookup.csv` | 165 rows, `module,action,key_win,key_mac,source_url,confidence,notes`; replaces all 159 rows of `C-ms-reference.csv` (+6 added) |
| `raw/parse_ms.py` | the parser (`python -I parse_ms.py` rewrites the raw CSV and `parse_ms.log.json`) |
| `raw/build_lookup.py` | builds the lookup: each key is copied from a raw row picked by (page, line) and a guard substring of the action text is asserted, so a wrong reference fails the build |
| `raw/ms-html/*.html`, `raw/apple-html/*.html` | the evidence (10 Microsoft pages, 1 Apple page) |
| `raw/ms-fetch-log.tsv`, `raw/parse_ms.log.json` | fetch status log, per-file parser counts |

## URLs fetched and HTTP status

All with `curl -sL -A "Mozilla/5.0"`; status is the final one after redirects.

| Saved file | Requested URL | Final URL | HTTP |
| --- | --- | --- | --- |
| `word-a11y.html` | https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word | same | 200 (224,569 B) |
| `word-win-95ef89dd.html` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2 | redirects to the row above | 200 (224,581 B, text identical) |
| `excel-a11y.html` | https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel | same | 200 (219,391 B) |
| `excel-win-1798d9d5.html` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f | redirects to the row above | 200 (219,375 B, text identical) |
| `ppt-a11y-create.html` | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations | same | 200 (191,287 B) |
| `ppt-ebb3d20e.html` | https://support.microsoft.com/en-us/office/use-keyboard-shortcuts-to-create-powerpoint-presentations-ebb3d20e-dcd4-444f-a38e-bb5c5ed180f4 | redirects to the row above | 200 (191,305 B, text identical) |
| `ppt-a11y-deliver.html` | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations | same | 200 (129,969 B) |
| `edge-shortcuts-old.html` | https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge | same | 200 (119,163 B) |
| `edge-shortcuts.html` | https://support.microsoft.com/en-US/edge/microsoft-edge-keyboard-shortcuts | https://support.microsoft.com/en-us/edge/microsoft-edge-keyboard-shortcuts | 200 (108,275 B) |
| `office-mac-common.html` | https://support.microsoft.com/en-us/office/common-office-for-mac-keyboard-shortcuts-307f469a-1a05-4263-9b55-49df19a8b8ff | https://support.microsoft.com/en-us/accessibility/office-accessibility/common-office-for-mac-keyboard-shortcuts | 200 (107,329 B) |
| `apple-html/mac-keyboard-shortcuts-102650.html` | https://support.apple.com/en-us/102650 | same | 200 (206,426 B; fetched with `curl.exe` from PowerShell because Git-bash curl segfaults on this host) |

How the pages are laid out (checked in the raw HTML):

- Word, Excel and PowerPoint (create) are **one article each with OS tabs** (`tabpanel_1_windows`, `tabpanel_1_macos`, iOS, Android, web). Word for Mac and Excel for Mac are the `macos` tab of the same article: there is no separate Word-for-Mac or Excel-for-Mac article. PowerPoint's Slide Show keys (Shift+F5, Alt+F5) are in a second article, "deliver" (`ppd`).
- **Important correction to the first pass:** `/edge/microsoft-edge-keyboard-shortcuts` is the legacy EdgeHTML page (it carries the banner "The new browser recommended by Microsoft is here" and documents Cortana, Hub, books, "When reading PDF documents"). The current Chromium Edge page is `/edge/keyboard-shortcuts-in-microsoft-edge` (Windows and Mac tabs). Its PDF keys are `Ctrl+\`, `Ctrl+[` and `Ctrl+]` with "(in a PDF)", and it has no go-to-page, table-of-contents, notes or one/two-page rows. The first pass treated the two pages the other way round.
- `common-office-for-mac-keyboard-shortcuts` is an extra Mac-only page I added (product `office-common` in the raw CSV): it supplies New / Open / Save / Close / hyperlink for Word for Mac, which the Word for Mac table does not list.

## Row counts in `C2-ms-raw.csv`

| product | windows | mac | total |
| --- | ---: | ---: | ---: |
| word | 286 | 195 | 481 |
| excel | 230 | 318 | 548 |
| powerpoint (create + deliver) | 269 | 181 | 450 |
| edge | 153 (legacy 69 + Chromium 84) | 60 (Chromium) | 213 |
| office-common (Mac page) | 0 | 26 | 26 |
| **total** | 938 | 780 | 1,718 |

Per file: Word 60 tables / 481 rows; Excel 47 / 548; PowerPoint create 49 / 338; PowerPoint deliver 12 / 112; Edge legacy 4 / 69; Edge Chromium 2 / 144; common Mac 3 / 26.

## What the parser could not read, or deliberately does not report

- **Unparsed rows: 0.** Every table in a desktop tab has a recognised header (`To do this | Press`, `Press this key | To do this`, `Key | Description`, `Use`).
- **Skipped on purpose:** every table in the iOS, Android and web tabs (Word 124, Excel 203, PowerPoint 183 rows) and the PowerPoint 3-column `To do this | Windows | Mac` tables, which all sit in the web tab and list browser keys. The skip counts are in `parse_ms.log.json`.
- **Mac Command key is an image** on the Word and Excel pages (`mac-cmd.gif`, alt text "The Command button on macOS."). The parser prints it as `Cmd`. Some rows print the text "Cmd" next to the image; those are not doubled. The Mac Delete key with a cross symbol is printed as `[img: The Mac Delete button with a cross symbol on it.]`. PowerPoint for Mac prints a real `⌘` glyph and the lookup keeps it. The Edge and common Mac pages spell `Command`/`Control`/`Option`; Word and Excel use `Cmd`/`Control`/`Option`. Read `⌘ = Cmd = Command`.
- **Function-key tables** (`F1`…`F12`): the key cell is one key and the description holds the whole family ("F5 alone … Shift+F5 … Ctrl+Shift+F5 …"). The parser leaves the family in the `action` text; it does not split it into rows. Shift+F6 and Shift+F5 in the lookup come from either their own row or that text (marked in notes).
- **Key cells with prose** are copied whole, for example `Alt or F10. To move to a different tab, use access keys or the arrow keys.`, `Shift+F5, immediately after opening the document.`, `Ctrl+click`, `Ctrl+1, 2, 3, and so on`.
- **Spelled-out symbol names** are kept as printed (`Ctrl+Shift+Right angle bracket (>)`, `Ctrl+Shift+Dollar sign ($)`); Mac Excel mixes spellings (`Tilde (~)` vs Windows `Tilde sign (~)`).
- **Edge:** key names carry invisible U+2060 word joiners (removed); the `Settings and more …` button is an image with empty alt text (`[img: ]`); the legacy page has no headings, so `section` is the paragraph above each table (`When reading PDF documents in Microsoft Edge:`); the Chromium page has no section text (`(no heading)`).
- **Lists such as "Cmd+V or Ctrl+V"** on Excel for Mac are one `<td>` with `<br>` and a bare "or" line; the parser drops the "or" and emits one row per alternative.
- A bare `Office 2010 and Office 2007: Not available` line sits in PowerPoint key cells; it is a version remark, kept in the raw CSV and dropped in the lookup.
- Microsoft's own typos or odd values are copied as printed and flagged in lookup notes: Word subscript printed as `Ctrl+Shift+Minus sign (-)`, PowerPoint "Close a presentation" printed as `Ctrl+D`, Excel for Mac "Previous sheet" printed with `Ctrl+Page down` as well as `Option+Left arrow key`.

## Lookup (`C2-ms-lookup.csv`)

- 165 rows: the 159 old rows (module + action unchanged) plus 6 added: Word Shift+F5 (last change), Word / Mac F4, common shortcut help (Ctrl+/), common Redo (Ctrl+Shift+Z), Excel repeat (Ctrl+Y / F4), PowerPoint Zoom to fit.
- Confidence: `high` 143 (key printed in a table row whose action text matches), `medium` 11 (key taken from another Microsoft page, from a label that is similar but not the same, or from the function-key row text), `low` 2 (PowerPoint Windows "Close a presentation" prints Ctrl+D, which the same page uses for Duplicate; Edge "Save a copy of the PDF" is only a page-save row), `n/a` 9 (not documented on either platform; absence checked against every raw row, not a key).
- 19 Windows cells and 18 Mac cells are `not documented`; they stay so even when another page prints a key under a different label (named in notes).
- `CHANGED:` appears in 42 rows. About half only name Microsoft's spelled-out symbols or "or" alternatives; the substantive ones:
  - **Edge PDF (all wrong in the first pass, wrong page):** the Chromium page has no go-to-page, table of contents, one/two-page, notes or save-a-copy PDF key; fit toggle is `Ctrl+\`, rotate is `Ctrl+[` / `Ctrl+]`, read aloud is `Ctrl+Shift+U` (the legacy page's `Ctrl+Shift+G` is "Jump to the previous result for find on page" on the Chromium page). Legacy keys are kept in notes with their line.
  - **PowerPoint:** Windows Shift+F5 (start from current slide) and Mac `⌘+Return` are on the "deliver" article; Ctrl+Shift+D / `⌘+Shift+D` duplicate slide is on the create article ("Make a copy of the selected slide").
  - **Word for Mac:** the Mac table has no New / Open / Save / hyperlink rows (taken from the common Mac page); it does have Double underline `Cmd+Shift+D`, Hanging indent `Cmd+T`, F6 and Shift+F6; Superscript, Clear formatting and Help have no Mac row.
  - **Word Windows Paste Special:** the Windows table has no row labelled Paste Special; Ctrl+Alt+V is printed there as "Paste the selected text formatting".
  - **Excel Windows:** no New, Print, Find, Replace, Go To (Ctrl+G) or Fill Right (Ctrl+R) rows at all (the first pass said `not extracted`); Ctrl+R there is "Rename the table".
  - **Excel for Mac:** Ctrl+Shift+Caret and Ctrl+Shift+Exclamation point number formats are present (the first pass said not documented); new line in a cell is `Option+Return or Ctrl+Option+Return`; Help is `F1 or Cmd+Forward slash (/)`.
  - **Ctrl+Shift+1..6 number formats** are not on any page; Excel number formats are the symbol keys `Ctrl+Shift+~ $ % ^ # @ !`.
  - **Ctrl+/** is not printed anywhere for Windows; Excel for Mac prints `Cmd+Forward slash (/)` for the Help window.

Differences between products that still stand: Save As is F12 in Word and Excel, `Ctrl+Shift+S` in PowerPoint; Ctrl+M is Indent in Word and New slide in PowerPoint; Ctrl+G is Go To in Word, Group in PowerPoint (Excel Go To is F5 on Windows); Ctrl+D is Fill down in Excel and Duplicate in PowerPoint; Ctrl+Y is Redo in Word and PowerPoint but "Repeat" in Excel; PowerPoint's New slide on Mac is `⌘+Shift+N`, while Word's Normal style is `Cmd+Shift+N`.

## macOS shortcuts that collide with the Mac keys above

Source: Apple, "Mac keyboard shortcuts", https://support.apple.com/en-us/102650 (saved in `raw/apple-html/`). Only Apple's own wording is quoted. "Where" is the line in `C2-ms-raw.csv` / the saved Microsoft HTML.

| Mac key | UniWork/Microsoft meaning (where) | What Apple says it does |
| --- | --- | --- |
| Control+Space | Excel select column (xl L2616, Microsoft marks it with an asterisk); PowerPoint clear character formatting (`Control+Spacebar`, pp L2313) | "Select the previous or next input source, if you use multiple input sources to type in different languages" (Control–Space bar / Control–Option–Space bar) — matters for Vietnamese input methods |
| Control+D | PowerPoint duplicate object (pp L1979); Excel fill down alternative (xl L1909) | "Delete the character to the right of the insertion point" |
| Control+H | Word Replace (wd L2408); Excel Replace alternative (xl L1945) | "Delete the character to the left of the insertion point" |
| Control+F / N / P / B / T | Excel alternatives `Ctrl+F` find, `Ctrl+N` new, `Ctrl+P` print, `Ctrl+B` bold, `Ctrl+T` create table (xl L2174, L1961, L1901, L1897, L2431) | Move one character forward / down one line / up one line / one character backward / swap characters |
| Control+Shift+Tab | PowerPoint toggle Outline and thumbnail panes (pp L2469) | "Move to the previous grouping of controls" |
| Command+T | Word hanging indent (wd L2836); PowerPoint Font dialog (pp L2273); Excel reference toggle / create table (xl L2366, L2431) | "Show or hide the Fonts window" / "Open a new tab" |
| Command+; | Excel enter the time (xl L2378) | "Find misspelled words in the document" |
| Command+Shift+Minus | Word subscript (wd L3032) | "Decrease the size of the selected item" |
| Command+Option+M | PowerPoint Paragraph dialog (pp L2285) | "To minimize all windows of the front app, press Option-Command-M" |
| Command+Shift+P | New file from template: Excel xl L1965, PowerPoint pp L1888, common page oc L648 | "Page setup: Show a window for selecting document settings" |
| Command+Shift+3 | Microsoft itself lists it on the Excel page as "Take a screenshot" (xl L2073) | "take a screenshot" (Shift-Command-3/4/5) |

Same meaning in Apple's list (no conflict): Command+C/V/X/Z/A/F/G/P/S/O/W/Q/B/I/U/K, Shift+Command+Z (redo), Shift+Command+S (Save As), Option+Command+C / V (copy / paste style), Control+Command+F (full screen), Control+Command+Space (Character Viewer, Excel xl L2439). Finder-only Apple keys (Shift+Command+N / D / H / O, Command+Y, Command+1..4) do not apply inside Office apps.

Rows Microsoft itself flags as conflicting with default macOS shortcuts (asterisk in the Word and Excel for Mac pages, "you may have to change your Mac keyboard settings"): Word `Shift+F10` (L2358), `F8` (L2673), `Shift+F8` (L2689), `F9` (L3341), `Shift+F9` (L3345), `Control+Shift+Up / Down arrow key` (L3400 / L3404), `Control+Shift+Minus sign (-)` (L3412), F-key rows F8–F11 (L3636–L3657); Excel `Shift+F11` (L2017, L3014), `Ctrl+Spacebar` select column (L2616), `Return` / `Shift+Return` move in selection (L2740 / L2744), `F11` (L2782, L3010). The Word page names the fix: System Preferences › Keyboard › Shortcuts › Mission Control, clear the conflicting check box.

Not covered by an Apple page I fetched: the F-key mapping on Mac laptops (Fn) beyond the Microsoft rows, and Spotlight (`Command–Space bar`, listed on the same Apple page) because no Microsoft Mac key in the lookup uses it.

## Gaps left

- Word: numbered-list toggle (no row), Mac superscript / clear formatting / Help, Windows Paste Special label.
- Excel Windows: New, Print, Find, Replace, Go To (Ctrl+G), Fill Right — not on the page.
- PowerPoint: strikethrough, bulleted/numbered list, Windows nudge, Mac ribbon keys — no rows.
- Edge PDF: go to page, table of contents, one/two-page, notes, next/previous page — only on the legacy EdgeHTML page (and next/previous page not even there for PDFs).
- Microsoft Learn was not searched.
