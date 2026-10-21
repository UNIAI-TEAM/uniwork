# C3 — Microsoft 365 *for the web* shortcut reference, rebuilt from raw HTML (UNI-2011 stage 1)

Fetch date: 2026-10-20 (UTC+7). Every key below was parsed from saved HTML with `raw/parse_ms_web.py` (standard library, `python -I`) and joined to the desktop lookup by `raw/build_lookup_web.py`; no WebFetch/WebSearch text was used as a key value (WebSearch only found the URLs). Goal (user decision 2026-10-20): the UniWork *web* surface follows Microsoft 365 for the web; the desktop app follows MS desktop (`C2-ms-*`).

## Output files

| File | What it is |
| --- | --- |
| `raw/C3-ms-web-raw.csv` | 698 parsed rows: `product,platform,section,action,keys,source_url,line_in_html_or_table_index` (`<saved file>:L<line>/T<table>`) |
| `raw/C3-ms-web-lookup.csv` | 557 rows, `module,action,key_web_win,key_web_mac,key_desktop_win_ref,key_desktop_mac_ref,source_url,confidence,notes`: the 165 rows of `C2-ms-lookup.csv` (same order) + 392 rows for web-table rows no desktop row used |
| `raw/C3-ms-web-browser-notes.csv` | 72 distinct page sentences that mention the browser, Edge/Chrome/Firefox/Safari, Ctrl+F6, overrides, Alt+Shift+A or Mac start keys (web tabs and web articles only), with saved-file line |
| `raw/parse_ms_web.py`, `raw/build_lookup_web.py` | parser and lookup builder (`python -I -X utf8`); the builder asserts a guard substring of the action text for every raw row it copies, so a wrong line fails the build |
| `raw/ms-html-web/*.html`, `raw/ms-fetch-web-log.tsv`, `raw/parse_ms_web.log.json` | evidence, fetch log (final URL, status, size), per-file parser counts |
| `raw/ms-html/*.html` | C2's saved desktop articles; only their `web` tabpanel is read here |

## URLs fetched and HTTP status

`curl.exe -sL -A "Mozilla/5.0"` (`curl.exe` run from Git-bash). Status is the final one after redirects. Fetch date 2026-10-20 for all rows.

Articles whose **web tab** was parsed (saved earlier by C2 in `raw/ms-html/`, HTTP 200 each, see `ms-fetch-log.tsv`):

| Saved file | URL | HTTP | Web-tab rows |
| --- | --- | --- | ---: |
| `ms-html/word-a11y.html` | https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word | 200 | 68 |
| `ms-html/excel-a11y.html` | https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel | 200 | 158 |
| `ms-html/ppt-a11y-create.html` | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations | 200 | 222 |
| `ms-html/ppt-a11y-deliver.html` | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-deliver-powerpoint-presentations | 200 | 28 |

Fetched in this task (`raw/ms-html-web/`, `raw/ms-fetch-web-log.tsv`):

| Saved file | Requested URL | Final URL | HTTP (bytes) | Use |
| --- | --- | --- | --- | --- |
| `word-web-app-2554e572` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-web-app-2554e572-59c4-4406-bc4d-94a29c9879fb | https://support.microsoft.com/en-us/word/keyboard-shortcuts-in-word-web-app | 200 (115871 B) | **parsed** (older stand-alone article, now titled 'Keyboard shortcuts in Word for the web': Reading view / Editing view tables + 'Windows and Mac keyboard equivalents') |
| `copy-paste-office-web` | https://support.microsoft.com/en-us/office/copy-and-paste-in-office-for-the-web-682704da-8360-464c-9a26-ff44abf4c4fe | https://support.microsoft.com/en-us/word/copy-and-paste-in-office-for-the-web | 200 (120620 B) | **parsed** (1 table, PowerPoint section: Copy/Cut/Paste Windows | macOS) + prose notes for Word/Excel/OneNote |
| `copy-paste-ppt-web` | https://support.microsoft.com/en-US/PowerPoint/copy-and-paste-in-powerpoint-for-the-web | https://support.microsoft.com/en-us/powerpoint/copy-and-paste-in-powerpoint-for-the-web | 200 (112141 B) | prose notes only (0 tables) |
| `keyboard-shortcuts-86d68234` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-86d68234-7f1a-40fc-a3d6-4c39c7a5ddaf | https://support.microsoft.com/en-us/sharepoint/sites-pages/keyboard-shortcuts | 200 (156439 B) | **not used**: the URL redirects to SharePoint sites/pages shortcuts, not Office apps |
| `ribbon-keyboard-954cd3f7` | https://support.microsoft.com/en-us/office/use-the-keyboard-to-work-with-the-ribbon-954cd3f7-2f77-4983-978d-c09b20e31f0e | https://support.microsoft.com/en-us/accessibility/windows/use-the-keyboard-to-work-with-the-ribbon | 200 (131284 B) | **parsed** (`web` tab table: 1 row, Windows: Ctrl+F6 / Mac: Command+F6) + prose |
| `ppt-modern-comments` | https://support.microsoft.com/en-us/topic/use-keyboard-shortcuts-to-navigate-modern-comments-in-powerpoint-e6924fd8-43f2-474f-a1c5-7ccdfbf59b3b | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-navigate-modern-comments-in-powerpoint | 200 (132145 B) | **parsed** (`web` tab table: 3 columns `To do this | On Windows web press | On Mac web press`) |
| `ppt-help-window` | https://support.microsoft.com/en-US/accessibility/powerpoint/use-keyboard-shortcuts-in-the-help-window | https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-in-the-help-window | 200 (103999 B) | **not used**: it is the Office Help-window page for PowerPoint desktop ('To use keyboard shortcuts in PowerPoint desktop, see ...'), not a web article |
| `word-select-all-web` | https://support.microsoft.com/en-gb/word/select-all-document-content-in-word-for-the-web | https://support.microsoft.com/en-gb/word/select-all-document-content-in-word-for-the-web | 200 (96652 B) | prose notes only (0 tables) |
| `excel-web-app-1798d9d5-old` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-for-the-web-1798d9d5-842a-42b8-9c99-9b7213f0040f | https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel | 200 (219374 B) | duplicate of the Excel article above (redirect); file deleted |
| `ppt-web-legacy` | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-powerpoint-for-the-web-e1c8b4e4-4ed4-4b56-b3ae-d2e25ea0e1d4 | — | 404 | 404 on a URL I guessed; file deleted |
| `excel-web-guess` | https://support.microsoft.com/en-us/excel/keyboard-shortcuts-in-excel-for-the-web | — | 404 | 404 on a URL I guessed; file deleted |
| `ppt-web-guess` | https://support.microsoft.com/en-us/powerpoint/keyboard-shortcuts-in-powerpoint-for-the-web | — | 404 | 404 on a URL I guessed; file deleted |
| `word-web-guess` | https://support.microsoft.com/en-us/word/keyboard-shortcuts-in-word-for-the-web | — | 404 | 404 on a URL I guessed; file deleted |
| `sr-ppt-explore` | https://support.microsoft.com/en-us/accessibility/powerpoint/use-a-screen-reader-to-explore-and-navigate-powerpoint | https://support.microsoft.com/en-us/accessibility/powerpoint/use-a-screen-reader-to-explore-and-navigate-powerpoint | 200 (153544 B) | prose notes only (0 tables; screen-reader walkthrough, `web` tab) |
| `sr-word-basic` | https://support.microsoft.com/en-us/accessibility/word/basic-tasks-using-a-screen-reader-with-word | https://support.microsoft.com/en-us/accessibility/word/basic-tasks-using-a-screen-reader-with-word | 200 (179570 B) | prose notes only (0 tables) |
| `sr-excel-basic` | https://support.microsoft.com/en-us/accessibility/excel/basic-tasks-using-a-screen-reader-with-excel | https://support.microsoft.com/en-us/accessibility/excel/basic-tasks-using-a-screen-reader-with-excel | 200 (187670 B) | prose notes only (0 tables) |
| `sr-ppt-basic` | https://support.microsoft.com/en-us/accessibility/powerpoint/basic-tasks-to-create-a-presentation-in-powerpoint-with-a-screen-reader | https://support.microsoft.com/en-us/accessibility/powerpoint/basic-tasks-to-create-a-presentation-in-powerpoint-with-a-screen-reader | 200 (205596 B) | prose notes only (0 tables) |

WebSearch (standard mode, `support.microsoft.com`) was used only to find these URLs. **No stand-alone current 'Keyboard shortcuts in Excel for the web' or 'Keyboard shortcuts in PowerPoint for the web' article was found**: the search results and the old URL pattern both lead to the combined Windows/Mac/iOS/Android/web articles above (the three 404 rows are URLs I guessed, not links Microsoft publishes). Microsoft Learn was not used.

How the pages are laid out (checked in the raw HTML):

- Word, Excel, PowerPoint (create) are one article each with OS tabs; the **`web` tabpanel** (`<section role="tabpanel" data-tab="web">`) is the Office-for-the-web content. The article text on every web tab says: 'Because Word/Excel/PowerPoint for the web runs in your web browser, the keyboard shortcuts are different from those in the desktop program. For example, you'll use Ctrl+F6 instead of F6 for jumping in and out of the commands. Also, common shortcuts like F1 (Help) and Ctrl+O (Open) apply to the web browser – not Word/Excel/PowerPoint for the web.'
- **Word and Excel web tabs are 2-column tables (`To do this | Press`) and never say which OS they mean**, so there is no Mac column for them; the lookup writes `not documented` in `key_web_mac` and tags the row `NO-MAC-COLUMN`. The only Mac statements for Word/Excel web are page prose (ribbon start key; Word copy/cut/paste ⌘ keys in the copy-paste article).
- **PowerPoint web tab tables are 3-column** (`To do this | Windows | Mac`): Windows and Mac values are captured separately (`platform` = `web-windows` / `web-mac`). C2 skipped exactly these tables.
- The older Word article has a 4-column table `Key | Modifier | Windows | Mac` whose Windows/Mac cells are *descriptions of what a combination does on that OS*, not keys. The parser flips it: `keys` = modifier+key (`ALT+SHIFT+Right`), `action` = the cell text (`Indent`), platform = `web-windows` / `web-mac`. 42 of its Windows/Mac cells are empty (no entry on that OS) and produce no row.
- `platform` values: `web` (2-column table, OS not stated), `web-windows`, `web-mac`.

## Row counts in `C3-ms-web-raw.csv`

| product | `web` (no OS) | `web-windows` | `web-mac` | total |
| --- | ---: | ---: | ---: | ---: |
| word | 122 | 56 | 66 | 244 |
| excel | 158 | 0 | 0 | 158 |
| powerpoint | 0 | 144 | 144 | 288 |
| office-common | 2 | 3 | 3 | 8 |
| **total** | 282 | 203 | 213 | 698 |

Per file (tables read / rows): `word-a11y.html` 60 / 68; `excel-a11y.html` 47 / 158; `ppt-a11y-create.html` 49 / 222; `ppt-a11y-deliver.html` 12 / 28; `word-web-app-2554e572.html` 7 / 176; `copy-paste-office-web.html` 1 / 6; `ppt-modern-comments.html` 3 / 38; `ribbon-keyboard-954cd3f7.html` 3 / 2.

One row per key alternative (`<li>`, `<br>` or `<p>` in a cell), as C2 did; 'Ctrl+F or F3' typed on one line stays one row.

## What the parser could not read, or deliberately does not report

- **Unparsed rows: 0** (every web table has a recognised header). Skipped on purpose: the Windows, macOS, iOS and Android tabs of the same pages (cell counts in `parse_ms_web.log.json`).
- **Excel 'Control keyboard shortcuts ... by overriding browser keyboard shortcuts'** (xl table T46) is an image + one paragraph of steps, not a key table: kept only as prose in `C3-ms-web-browser-notes.csv` (xl L4308–L4316). It gives no key.
- **Empty cells:** 42 cells of the older Word article's 4-column table are blank; they are not rows.
- **Key cells with prose** are copied whole, e.g. `Alt+Period or Alt+Windows logo key. To move to a different tab, use an access key or the Tab key.`, `Windows keyboards: Shift+F10 or Windows Menu keyOther keyboards: Shift+F10` (the page prints the two lines without a break), `Press Enter to go to the ribbon for the tab.`, `PowerPoint for the web saves changes automatically.` (the Save row has no key), `No shortcut` (PowerPoint Mac cells).
- **PowerPoint region lists** are printed run together by the page (`Slide paneNotes paneStatus bar...`); copied as printed.
- Key names are as printed: `Alt+Windows logo key`, `Tab key`, `Right angle bracket (>)`; the Mac PowerPoint cells use real `⌘`; older Word article is UPPERCASE (`CTRL+SHIFT+F6`). Read `⌘ = Cmd = Command`.
- Microsoft's own odd values, kept as printed: the older Word article says 'IP' for the insertion point; its 'Right [ALT-SHIFT]' Mac cell says 'Select left by word'; Word 'Move cursor ... Right [CTRL]' Windows cell says 'Move IP left by word'; the Word web page says Ctrl+O applies to the browser while Excel's web table prints `Open workbook. Ctrl+O`.

## Lookup (`C3-ms-web-lookup.csv`)

- 165 desktop rows (all of `C2-ms-lookup.csv`, order kept; `key_desktop_*_ref` are C2's `key_win` / `key_mac` unchanged) + 392 `UNMAPPED-WEB-ROW` rows.
- Confidence on the 165 desktop rows: `high` 76 (key printed in a web table row whose action text matches), `medium` 28 (key from page prose, from a clearly related label, or from the older article), `n/a` 61 (nothing in any web article: `not documented`). All 392 unmapped rows are `high` (printed in their own table row).
- Tags in `notes`: `DIFF-FROM-DESKTOP(win|mac)` (both documented, no alternative in common) 29; `PARTIAL-OVERLAP-WITH-DESKTOP(...)` (they share at least one alternative) 12; `WEB-NOT-DOCUMENTED` (desktop documents it, web pages print nothing, PDF rows excluded) 55; `NO-MAC-COLUMN` (Word/Excel 2-column web table) 63; `BROWSER-ALT` (web prints another key or route because of the browser) 13; `BROWSER-TAKEN` (MS says the key belongs to the browser, no alternative) 6.
- The 13 `pdf` rows and `Developer tools` are `not documented` on purpose: the Edge PDF viewer / DevTools are not Microsoft 365 for the web surfaces.

## Where MS web differs from MS desktop

`key_*` values are verbatim from the lookup. For Word and Excel the web Mac column does not exist, so only Windows can differ; Mac differences appear for PowerPoint, Word copy/paste, ribbon start keys and the Word 'Indent' rows.

### Both documented and different (DIFF-FROM-DESKTOP / PARTIAL-OVERLAP)

| Module | Action | Desktop Windows | Web Windows | Desktop Mac | Web Mac | Kind |
| --- | --- | --- | --- | --- | --- | --- |
| word | Cut | Ctrl+X | Ctrl+X | Cmd+X or F2 | ⌘+X | PARTIAL mac |
| word | Copy | Ctrl+C | Ctrl+C | Cmd+C or F3 | ⌘+C | PARTIAL mac |
| word | Paste | Ctrl+V | Ctrl+V | Cmd+V or F4 | ⌘+V | PARTIAL mac |
| word | Find (Navigation pane) | Ctrl+F | Ctrl+F or Ctrl+G | Cmd+F | not documented | PARTIAL win |
| word | Bulleted list | Ctrl+Shift+L | Ctrl+Period (.) | Cmd+Shift+L | not documented | DIFF win |
| word | Indent paragraph | Ctrl+M | ALT+SHIFT+Right ; TAB | Control+Shift+M | TAB | DIFF win+mac |
| word | Remove paragraph indent | Ctrl+Shift+M | ALT+SHIFT+Left ; SHIFT+TAB | Cmd+Shift+M | SHIFT+TAB | DIFF win+mac |
| word | Activate ribbon access keys | Alt or F10. To move to a different tab, use access keys or … | Alt+Period or Alt+Windows logo key. To move to a different … | not documented | Control+Period (.) | DIFF win |
| word | Expand or collapse ribbon | Ctrl+F1 | Ctrl+F3 | Cmd+Option+R | not documented | DIFF win |
| word | Cycle panes forward | F6 | Ctrl+F6 | F6 | not documented | DIFF win |
| word | Cycle panes backward | Shift+F6 | CTRL+F6 or CTRL+SHIFT+F6 | Shift+F6 | not documented | DIFF win |
| excel | Save As | F12 | Alt+F2 | Cmd+Shift+S or F12 | not documented | DIFF win |
| excel | Go To | F5 | Ctrl+G | Ctrl+G or F5 | not documented | DIFF win |
| excel | Insert cells / rows / columns | Ctrl+Shift+Plus sign (+) | Ctrl+Plus sign (+) | Ctrl+Shift+Equal sign ( = ) | not documented | DIFF win |
| excel | Number format: Currency | Ctrl+Shift+Dollar sign ($) | Ctrl+Shift+4 | Ctrl+Shift+Dollar sign ($) | not documented | DIFF win |
| excel | Number format: Percentage | Ctrl+Shift+Percent sign (%) | Ctrl+Shift+5 | Ctrl+Shift+Percent sign (%) | not documented | DIFF win |
| excel | Number format: Scientific | Ctrl+Shift+Caret sign (^) | Ctrl+Shift+6 | Ctrl+Shift+Caret (^) | not documented | DIFF win |
| excel | Number format: Date | Ctrl+Shift+Number sign (#) | Ctrl+Shift+3 | Ctrl+Shift+Number sign (#) | not documented | DIFF win |
| excel | Number format: Time | Ctrl+Shift+At sign (@) | Ctrl+Shift+2 | Ctrl+Shift+At symbol (@) | not documented | DIFF win |
| excel | Number format: Number (2 decimals, thousands) | Ctrl+Shift+Exclamation point (!) | Ctrl+Shift+1 | Ctrl+Shift+Exclamation point (!) | not documented | DIFF win |
| excel | Move to edge of data region | Ctrl+Arrow key | Ctrl+Right arrow key or Ctrl+Left arrow key | Cmd+Arrow key | not documented | DIFF win |
| excel | Next sheet | Ctrl+Page down | Alt+Ctrl+Page down ; Ctrl+Page down | Ctrl+Page down or Option+Right arrow key | not documented | PARTIAL win |
| excel | Previous sheet | Ctrl+Page up | Alt+Ctrl+Page up ; Ctrl+Page up | Ctrl+Page down or Option+Left arrow key | not documented | PARTIAL win |
| excel | Enter current time | Ctrl+Shift+Colon (:) | Ctrl+Shift+Semicolon (;) | Cmd+Semicolon (;) | not documented | DIFF win |
| excel | Bold | Ctrl+B or Ctrl+2 | Ctrl+B | Cmd+B or Ctrl+B | not documented | PARTIAL win |
| excel | Italic | Ctrl+I or Ctrl+3 | Ctrl+I | Cmd+I or Ctrl+I | not documented | PARTIAL win |
| excel | Underline | Ctrl+U or Ctrl+4 | Ctrl+U | Cmd+U | not documented | PARTIAL win |
| excel | Activate ribbon key tips | Alt or F10. To move to a different tab, use access keys or … | Alt+Windows logo key. To move to a different tab, use an ac… | not documented | Control+Option | DIFF win |
| excel | Cycle panes | F6 / Shift+F6 | Ctrl+F6 | F6 or Shift+F6 | not documented | DIFF win |
| powerpoint | Save | Ctrl+S | PowerPoint for the web saves changes automatically. | ⌘+S | PowerPoint for the web saves changes automatically. | DIFF win+mac |
| powerpoint | New slide | Ctrl+M | Ctrl+M | ⌘+Shift+N | No shortcut | DIFF mac |
| powerpoint | Duplicate selected object | Ctrl+D or Ctrl+Drag the mouse | Ctrl+D | Control+D or Control+Drag the mouse | ⌘+D | DIFF mac, PARTIAL win |
| powerpoint | Next / previous slide | Page down / Page up | Page down / Page up | Page down / Page up | Fn+Down arrow key / Fn+Up arrow key | DIFF mac |
| powerpoint | Nudge selected object | not documented | Arrow keys | Arrow keys or ⌘+Arrow keys | Arrow keys | PARTIAL mac |
| powerpoint | Start slide show | F5 | Ctrl+F5 | ⌘+Shift+Return | ⌘+Shift+Return | DIFF win |
| powerpoint | Start slide show from current slide | Shift+F5 | Shift+Ctrl+F5 | ⌘+Return | ⌘+Shift+F5 | DIFF win+mac |
| powerpoint | Align center / left / right / justify | Ctrl+E / Ctrl+L / Ctrl+R / Ctrl+J | Ctrl+E / Ctrl+L / Ctrl+R / Ctrl+J | ⌘+E / ⌘+L / ⌘+R / ⌘+J | ⌘+E / ⌘+Shift+L / ⌘+Shift+R / ⌘+J | PARTIAL mac |
| powerpoint | Cycle panes forward / backward | F6 / Shift+F6 | Ctrl+F6 / Shift+Ctrl+F6 | F6 / Shift+F6 | ⌘+F6 / Shift+⌘+F6 | DIFF win+mac |
| powerpoint | Activate ribbon access keys | Alt or F10. To move to a different tab, use access keys or … | Alt+Period (.) | not documented | Ctrl+Period (.) | DIFF win |
| common | Move focus to next pane | F6 | Windows: Ctrl+F6 | not documented | Mac: Command+F6 | DIFF win |

### Web prints a key the desktop page does not (desktop `not documented`)

| Module | Action | Web Windows | Web Mac | Note |
| --- | --- | --- | --- | --- |
| word | Numbered list | Ctrl+Slash (/) | not documented | desktop Win not documented / Mac not documented |
| word | Activate ribbon access keys | Alt+Period or Alt+Windows logo key. To move to a … | Control+Period (.) | desktop Win Alt or F10. To move to a… / Mac not documented |
| excel | Print | Ctrl+P | not documented | desktop Win not documented / Mac Cmd+P or Ctrl+P |
| excel | Find | Ctrl+F or Shift+F3 | not documented | desktop Win not documented / Mac Ctrl+F or Shift+F5 |
| excel | Number formats Ctrl+Shift+1..6 | Ctrl+Shift+1 ; Ctrl+Shift+2 ; Ctrl+Shift+3 ; Ctrl… | not documented | desktop Win not documented / Mac not documented |
| excel | Activate ribbon key tips | Alt+Windows logo key. To move to a different tab,… | Control+Option | desktop Win Alt or F10. To move to a… / Mac not documented |
| powerpoint | Nudge selected object | Arrow keys | Arrow keys | desktop Win not documented / Mac Arrow keys or ⌘+Arrow ke… |
| powerpoint | Activate ribbon access keys | Alt+Period (.) | Ctrl+Period (.) | desktop Win Alt or F10. To move to a… / Mac not documented |
| common | Move focus to next pane | Windows: Ctrl+F6 | Mac: Command+F6 | desktop Win F6 / Mac not documented |
| common | Shortcut help (Ctrl+/) | Alt+Shift+A | not documented | desktop Win not documented / Mac Cmd+Forward slash (/) |

### Desktop documents a key, MS web pages print nothing (WEB-NOT-DOCUMENTED)

- **word** (22): New document; Open document; Save; Save As; Close document; Paste Special; Double underline; Strikethrough; Subscript; Superscript; Increase font size (preset steps); Decrease font size (preset steps); Clear character formatting; Hanging indent; Normal style; Heading 1; Heading 2; Heading 3; Track changes on/off; Help; Move cursor to last change / previous revision; Repeat last action / F4
- **excel** (12): New workbook; Save workbook; Paste Special; Select all / worksheet; Replace; Fill down; Fill right; Number format: General; Strikethrough; Expand or collapse ribbon; Help; Repeat last action (Windows Ctrl+Y / F4)
- **powerpoint** (19): New presentation; Open; Save As; Close presentation; Paste Special; Duplicate selected slide; Group; Ungroup; Regroup; Presenter view; Subscript; Superscript; Indent (demote paragraph); Outdent (promote paragraph); Replace; Toggle Outline and Thumbnail panes; Expand or collapse ribbon; Help; Zoom to fit
- **common** (2): Developer tools; Redo (Ctrl+Shift+Z)

### Web-only families the desktop page does not have

- Word for the web: numbered list `Ctrl+Slash (/)`, bulleted list `Ctrl+Period (.)` (desktop `Ctrl+Shift+L`), collapse ribbon `Ctrl+F3`, Find in Editing view `Ctrl+F or Ctrl+G`, `Alt+Q` Tell Me/Search, landmark regions `Ctrl+F6`.
- Excel for the web: number formats `Ctrl+Shift+1…6` (+ `Ctrl+Shift+7` outside border), `Alt+Ctrl+Page down/up` for sheets, access keys `Alt+Windows logo key, H, I, R` etc., Accessibility Shortcuts Menu `Alt+Shift+A`, screen-reader keys `Ctrl+Alt+Shift+T/H/Home/End/Page up/Page down`, Copilot keys.
- PowerPoint for the web: Start slide show `Ctrl+F5` / `⌘+Shift+Return`, from current slide `Shift+Ctrl+F5` / `⌘+Shift+F5`, next/previous slide Mac `Fn+Down/Up arrow key`, Mac left/right align `⌘+Shift+L / ⌘+Shift+R`, send/bring object keys, comments keys (`Ctrl+Alt+M`, `Ctrl+Enter`).

## Places where the web pages say a key is taken by the browser, and what MS says to do instead

| # | Where (saved file : line) | What Microsoft says | What to do instead |
| ---: | --- | --- | --- |
| 1 | ms-html/word-a11y.html:L4115, excel-a11y L3434, ppt-a11y-create L2943, ppt-a11y-deliver L1236, ppt-modern-comments L833, sr-word-basic L1338, sr-excel-basic L1375, sr-ppt-basic L1643, sr-ppt-explore L1096 | 'common shortcuts like F1 (Help) and Ctrl+O (Open) apply to the web browser – not <app> for the web.' | 'you'll use Ctrl+F6 instead of F6 for jumping in and out of the commands.' Use Microsoft Edge ('we recommend'). No replacement is given for F1 or Ctrl+O except Excel's override below. |
| 2 | excel-a11y L3514 vs L3434 | The Excel web table prints `Open workbook. Ctrl+O`, while the intro of the same page says Ctrl+O applies to the browser (MS contradicts itself). | MS gives no other key for Open; the only mechanism it names is the Excel 'Override browser shortcuts' setting (next row). |
| 3 | excel-a11y L4308–L4316 (section 'Control keyboard shortcuts in Excel for the web by overriding browser keyboard shortcuts') | 'Excel for the web works in a browser. Browsers have keyboard shortcuts, some of which conflict with shortcuts that work in Excel on the desktop. You can control these shortcuts, so they work the same in both versions of Excel by changing the Keyboard Shortcuts settings. Overriding browser shortcuts also enables you to open the Excel for the web Help by pressing F1.' | In Excel for the web: Help > Keyboard Shortcuts, search a shortcut, choose a category, select **Override browser shortcuts**, select **Show Overrides** to list them, Close. |
| 4 | excel-a11y L3567 | 'To learn how to override the browser's Alt-based ribbon shortcuts, go to Control keyboard shortcuts in Excel for the web by overriding browser keyboard shortcuts.' | Same Override setting. Ribbon access keys start with `Alt+Windows logo key` (Excel) / `Alt+Period or Alt+Windows logo key` (Word) / `Alt+Period (.) or Alt+Windows key` (PowerPoint). |
| 5 | word-a11y L4185, excel-a11y L3569 | 'If you're using Word for the web on a Mac computer, press Control+Period (.) to start.' / 'If you're using Excel for the web on a Mac computer, press Control+Option to start.' | Mac ribbon start key differs from Windows. PowerPoint's own table: Ctrl+Period (.) for Mac. |
| 6 | word-a11y L4191, excel-a11y L3575, ppt-a11y-create L3656 | 'To get to the ribbon, press Alt+Period or Alt+Windows logo key.' / 'press Alt+Windows key, or press Ctrl+F6 until you reach the Home tab.' | Ctrl+F6 repeatedly reaches the ribbon without Alt keys. |
| 7 | excel-a11y L3975 / L3983 (table rows) | 'Switch to the next sheet (when in Microsoft Teams or a browser other than Chrome).' = Ctrl+Page down; previous = Ctrl+Page up. | Default web keys are `Alt+Ctrl+Page down` / `Alt+Ctrl+Page up`; the Ctrl-only keys are the alternative for Teams / non-Chrome browsers. |
| 8 | copy-paste-office-web L711, L722 | Word for the web: 'On Chrome, Firefox, and Chromium-based Microsoft Edge, you can also use Ctrl+Shift+V and ⌘+Shift+V to paste text only'; 'Paste text only can be accessed via the ribbon and context menu (when you're using any version of Microsoft Edge, or Chrome with the Office - Enable Copy and Paste Extension), via Ctrl+Shift+V (Chrome, Firefox, and Chromium-based Microsoft Edge), or by clicking the paste floatie'. | Browser-dependent: Ctrl+Shift+V works only in those browsers; otherwise ribbon / context menu / paste floatie. |
| 9 | copy-paste-office-web L715, L765, L781 | 'If you're using Firefox and you want to use the Copy, Cut, and Paste commands on the Word for the web ribbon, you need to allow JavaScript to use the clipboard. If you don't want to do this, use the -C, -X, and -V keyboard commands.' (same for PowerPoint and OneNote ribbon; the page prints the shortcut as '-C, -X, -V', the modifier is missing in the HTML) | Allow JavaScript clipboard access in Firefox, or use the keyboard copy/cut/paste. |
| 10 | copy-paste-office-web L716 | 'On Chrome, you can install the Office - Enable Copy and Paste Extension, which will allow you to cut, copy, and paste with your mouse on all the Office Online apps.' | Install the extension (Chrome). |
| 11 | copy-paste-office-web L824–L825 | Excel for the web: 'Using Microsoft Edge or Chrome, when you paste text from outside Excel for the web the text retains its formatting ... unless you press Ctrl+SHIFT+V to paste as plain text.' 'If your browser is not Microsoft Edge or Chrome ... it's always pasted as plain text.' | Ctrl+Shift+V = plain text in Edge/Chrome; other browsers always paste plain text. |
| 12 | copy-paste-ppt-web L722, L746 | 'Currently, Paste Text Only is only available in Chrome and Microsoft Edge. For Chrome, you need an Office extension to use this command in PowerPoint for the web.' 'You have to use keyboard shortcuts to cut or copy text and then paste in the Firefox browser.' | Use Edge, or Chrome + extension; in Firefox use keyboard shortcuts. |
| 13 | word-web-app-2554e572 table T6 ('Windows and Mac keyboard equivalents') | Mac cells flag browser clashes: `Home [CMD]` 'in Safari on Mac this navigates to the browser home page'; `Left [CMD]` 'in Firefox on Mac this navigates the browser back'; `Right [CMD]` '... forward'; `Left [CMD-ALT]` 'In Chrome on Mac this navigates between browser tabs'; `DELETE [CMD-SHIFT]` 'in Firefox on Mac this clears the browser cache'; `PageDn/PageUp [CTRL]` 'in Firefox and Chrome on Mac this switches between open tabs'; `TAB [ALT]` Mac 'Accessibility Loop (moves focus between browser UI and page elements)'; Windows cells name IE actions (`ALT+Left` 'Navigate back in IE', `ALT+Home` 'Navigate to Home Page', `ALT+ENTER` 'Page Properties in IE', `ALT-SHIFT+ENTER` 'Full Screen in IE'); OS-owned keys (`CTRL+ESC` Start Menu, `ALT+TAB`, `CTRL-ALT+DELETE`). | No replacement is printed; the table is a conflict list, not a how-to. |
| 14 | sr-word-basic L1399, sr-ppt-basic L1702 | Walkthrough step: 'Navigate back to Word for the web, and then press Ctrl+W to close the browser tab.' (PowerPoint: '... press Ctrl+W to close the browser tab.') | Ctrl+W is the browser close-tab key; Excel's web table prints `Close workbook. Ctrl+W`, Word and PowerPoint web tables print no Close row. |
| 15 | word-a11y L4132 (Tip), excel-a11y L3472, ppt-a11y-create L2977 | 'To quickly create a new document in Word for the web, open your browser, type Word.new in the address bar, and then press Enter.' (Excel: Excel.new; PowerPoint: PowerPoint.new or ppt.new) | Replaces Ctrl+N (no New row in any web table). |
| 16 | excel-a11y L3464, L4234 | 'If you use a screen reader, go to Accessibility Shortcuts Menu (Alt+Shift+A).' 'Press Alt+Shift+A to access the common features quickly by using the following shortcuts:' | Alt+Shift+A opens the accessibility shortcuts menu (Excel page). |
| 17 | ribbon-keyboard-954cd3f7 L1092 (web tab) and L1074 | Web tab: 'Move the focus to select the active tab, document, task pane, or status bar.' = Windows: Ctrl+F6, Mac: Command+F6; tip 'To move the focus to the header above the ribbon, press Shift+Ctrl+F6 on Windows or Shift+Command+F6 on Mac.' | Ctrl+F6 / Cmd+F6 is the web replacement for F6. |

The full sentence list (72 distinct sentences, each with its saved-file line) is `C3-ms-web-browser-notes.csv`; it also holds sentences that only mention a browser in passing (sign-in steps, 'Microsoft Edge' navigation text).

## Raw rows no desktop row used (`UNMAPPED-WEB-ROW`)

392 lookup rows (552 raw rows) are web-table rows that no desktop row maps to: web-only actions, or a repeat of a mapped action in another table (e.g. 'Apply bold formatting' in the PowerPoint 'Frequently used' table next to the one in 'Format text'). They are in the lookup with `notes` starting `UNMAPPED-WEB-ROW`, grouped by product/source/line. Counts by section:

| Module | Source | Section | Rows |
| --- | --- | --- | ---: |
| common | `copy-paste-office-web.html` | PowerPoint for the web | 3 |
| excel | `excel-a11y.html` | Access keys: Shortcuts for using the ribbon > Go to the access keys for the ribbon | 7 |
| excel | `excel-a11y.html` | Access keys: Shortcuts for using the ribbon > Work in the ribbon tabs and menus | 5 |
| excel | `excel-a11y.html` | Accessibility Shortcuts Menu | 15 |
| excel | `excel-a11y.html` | Copilot in Excel | 9 |
| excel | `excel-a11y.html` | Frequently used shortcuts | 9 |
| excel | `excel-a11y.html` | Keyboard shortcuts for calculating data | 5 |
| excel | `excel-a11y.html` | Keyboard shortcuts for editing cells | 11 |
| excel | `excel-a11y.html` | Keyboard shortcuts for editing data within a cell | 12 |
| excel | `excel-a11y.html` | Keyboard shortcuts for entering data | 5 |
| excel | `excel-a11y.html` | Keyboard shortcuts for formatting cells | 3 |
| excel | `excel-a11y.html` | Keyboard shortcuts for moving and scrolling within worksheets | 8 |
| excel | `excel-a11y.html` | Keyboard shortcuts for moving within a selected range | 11 |
| excel | `excel-a11y.html` | Keyboard shortcuts for working with cells, rows, columns, and objects | 7 |
| excel | `excel-a11y.html` | Keyboard shortcuts for working with objects | 7 |
| powerpoint | `ppt-a11y-create.html` | Frequently used shortcuts | 8 |
| powerpoint | `ppt-a11y-create.html` | Navigate the ribbon and panes | 5 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Copy objects and text | 1 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Delete text | 4 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Move around in text | 12 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Select text | 13 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Work in objects and text | 13 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Work with comments | 10 |
| powerpoint | `ppt-a11y-create.html` | Work with objects and text > Work with tables | 6 |
| powerpoint | `ppt-a11y-create.html` | Work with presentations and slides | 7 |
| powerpoint | `ppt-a11y-deliver.html` | Control the slide show | 3 |
| powerpoint | `ppt-modern-comments.html` | In this topic > Frequently used shortcuts | 18 |
| word | `word-a11y.html` | Frequently used shortcuts | 5 |
| word | `word-a11y.html` | Navigate the document | 17 |
| word | `word-a11y.html` | Ribbon keyboard shortcuts > Go to the access keys for the ribbon | 8 |
| word | `word-a11y.html` | Ribbon keyboard shortcuts > Work in the ribbon tabs and menus | 5 |
| word | `word-a11y.html` | Work with comments | 9 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view | 6 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view > Edit content | 6 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view > Format text | 7 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view > Move insertion point | 12 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view > Select content: expand sel… | 14 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Editing view > Windows and Mac keyboard e… | 80 |
| word | `word-web-app-2554e572.html` | Microsoft Word for the web keyboard shortcuts > Reading view | 6 |

Full list of the unmapped rows (module | action | web Windows | web Mac):

| Module | Action | Web Windows | Web Mac |
| --- | --- | --- | --- |
| excel | Move down. | Page down or Down arrow key | not documented |
| excel | Move up. | Page up or Up arrow key | not documented |
| excel | Apply bold formatting. | Ctrl+B | not documented |
| excel | Open the context menu. | Windows keyboards: Shift+F10 or Windows Menu keyOther keybo… | not documented |
| excel | Jump to Search. | Alt+Q | not documented |
| excel | Repeat Find downward. | Shift+F4 | not documented |
| excel | Repeat Find upward. | Ctrl+Shift+F4 | not documented |
| excel | Insert a chart. | Alt+F1 | not documented |
| excel | Display the access keys (ribbon commands) on the classic ribbon when using Narrator. | Alt+Period (.) | not documented |
| excel | Go to the Search field on the ribbon and type a search term. | Alt+Windows logo key, Q | not documented |
| excel | Open the File menu. | Alt+Windows logo key, F | not documented |
| excel | Open the Home tab and format text and numbers or use other tools such as Sort & Filter. | Alt+Windows logo key, H | not documented |
| excel | Open the Insert tab and insert a function, table, chart, hyperlink, or threaded comment. | Alt+Windows logo key, N | not documented |
| excel | Open the Data tab and refresh connections or use data tools. | Alt+Windows logo key, A | not documented |
| excel | Open the Review tab and use the Accessibility Checker or work with threaded comments and … | Alt+Windows logo key, R | not documented |
| excel | Open the View tab to choose a view, freeze rows or columns in your worksheet, or show gri… | Alt+Windows logo key, W | not documented |
| excel | Move the focus to commands on the ribbon. | Enter, then the Tab key or Shift+Tab | not documented |
| excel | Activate a selected button. | Spacebar or Enter | not documented |
| excel | Open the list for a selected command. | Spacebar or Enter | not documented |
| excel | Open the menu for a selected button. | Alt+Down arrow key | not documented |
| excel | When a menu or submenu is open, move to the next command. | Esc | not documented |
| excel | Cut selection. | Ctrl+X | not documented |
| excel | Copy selection. | Ctrl+C | not documented |
| excel | Paste selection. | Ctrl+V | not documented |
| excel | Undo an action. | Ctrl+Z | not documented |
| excel | Insert a table. | Ctrl+L | not documented |
| excel | Insert a function. | Shift+F3 | not documented |
| excel | Increase font size. | Ctrl+Shift+Right angle bracket (>) | not documented |
| excel | Decrease font size. | Ctrl+Shift+Left angle bracket (<) | not documented |
| excel | Apply a filter. | Alt+Windows logo key, A, T | not documented |
| excel | Re-apply a filter. | Ctrl+Alt+L | not documented |
| excel | Toggle AutoFilter on and off. | Ctrl+Shift+L | not documented |
| excel | Complete cell entry and select the cell below. | Enter | not documented |
| excel | Complete cell entry and select the cell above. | Shift+Enter | not documented |
| excel | Complete cell entry and select the next cell in the row. | Tab key | not documented |
| excel | Complete cell entry and select the previous cell in the row. | Shift+Tab | not documented |
| excel | Cancel cell entry. | Esc | not documented |
| excel | Clear the selected cell. | Delete | not documented |
| excel | Clear the selected cell and start editing. | Backspace | not documented |
| excel | Go to beginning of cell line. | Home | not documented |
| excel | Go to end of cell line. | End | not documented |
| excel | Select right by one character. | Shift+Right arrow key | not documented |
| excel | Select to the beginning of cell data. | Shift+Home | not documented |
| excel | Select to the end of cell data. | Shift+End | not documented |
| excel | Select left by one character. | Shift+Left arrow key | not documented |
| excel | Extend selection to the last nonblank cell in the same column or row as the active cell, … | Ctrl+Shift+Right arrow key or Ctrl+Shift+Left arrow key | not documented |
| excel | Copy a formula from the cell above. | Ctrl+Apostrophe (') | not documented |
| excel | Copy the value from the cell above. | Ctrl+Shift+Apostrophe (') | not documented |
| excel | Insert a formula argument. | Ctrl+Shift+A | not documented |
| excel | Paste formatting. | Shift+Ctrl+V | not documented |
| excel | Apply the outline border to the selected cells. | Ctrl+Shift+Ampersand (&) | not documented |
| excel | Apply outside border. | Ctrl+Shift+7 | not documented |
| excel | Move up one cell. | Up arrow key or Shift+Enter | not documented |
| excel | Move down one cell. | Down arrow key or Enter | not documented |
| excel | Move right one cell. | Right arrow key or Tab key | not documented |
| excel | Go to the beginning of the row. | Home | not documented |
| excel | Move down one screen (28 rows). | Page down | not documented |
| excel | Move up one screen (28 rows). | Page up | not documented |
| excel | Move to a different ribbon tab. | Tab key ; Press Enter to go to the ribbon for the tab. | not documented |
| excel | Insert a new sheet. | Shift+F11 | not documented |
| excel | Open menu or drill down. | Alt+Down arrow key | not documented |
| excel | Close menu or drill up. | Alt+Up arrow key | not documented |
| excel | Follow hyperlink. | Ctrl+Enter | not documented |
| excel | Open a note for editing. | Shift+F2 | not documented |
| excel | Open and reply to a threaded comment. | Ctrl+Shift+F2 | not documented |
| excel | Rotate an object left. | Alt+Left arrow key | not documented |
| excel | Rotate an object right. | Alt+Right arrow key | not documented |
| excel | Select a range of cells. | Shift+Arrow keys | not documented |
| excel | Extend selection to the last nonblank cell in the same column or row as the active cell, … | Ctrl+Shift+Right arrow key or Ctrl+Shift+Left arrow key | not documented |
| excel | Add a non-adjacent cell or range to a selection. | Shift+F8 | not documented |
| excel | Hide rows. | Ctrl+9 | not documented |
| excel | Unhide rows. | Ctrl+Shift+9 | not documented |
| excel | Hide columns | Ctrl+0 | not documented |
| excel | Unhide columns | Ctrl+Shift+0 | not documented |
| excel | Move from top to bottom (or forward through the selection). | Enter | not documented |
| excel | Move from bottom to top (or back through the selection). | Shift+Enter | not documented |
| excel | Move forward through a row (or down through a single-column selection). | Tab key | not documented |
| excel | Move back through a row (or up through a single-column selection). | Shift+Tab | not documented |
| excel | Move to an active cell. | Shift+Backspace | not documented |
| excel | Move to an active cell and keep the selection. | Ctrl+Backspace | not documented |
| excel | Rotate the active cell through the corners of the selection. | Ctrl+Period (.) | not documented |
| excel | Move to the next selected range. | Ctrl+Alt+Right arrow key | not documented |
| excel | Move to the previous selected range. | Ctrl+Alt+Left arrow key | not documented |
| excel | Extend selection to the last used cell in the sheet. | Ctrl+Shift+End | not documented |
| excel | Extend selection to the first cell in the sheet. | Ctrl+Shift+Home | not documented |
| excel | Calculate workbook (refresh). | F9 | not documented |
| excel | Perform full calculation. | Ctrl+Shift+Alt+F9 | not documented |
| excel | Refresh external data. | Alt+F5 | not documented |
| excel | Refresh all external data. | Ctrl+Alt+F5 | not documented |
| excel | Apply Flash Fill. | Ctrl+E | not documented |
| excel | Send your prompt, in the Copilot in Excel task pane. | Enter or Return | not documented |
| excel | Stop or cancel the Copilot in Excel request. | Esc | not documented |
| excel | Accept changes made by Copilot in Excel. | Ctrl+Enter or Cmd+Return | not documented |
| excel | Switch between edit, chat, and plan mode in the Copilot in Excel task pane. | Ctrl+Shift+M or Cmd+Shift+M | not documented |
| excel | Navigate between chat responses in the Copilot in Excel task pane. | Alt+C or Option+C | not documented |
| excel | Confirm use of selected files in the Copilot in Excel task pane. | Ctrl+J or Cmd+J | not documented |
| excel | Start dictation for Copilot in Excel. | Alt+Shift+H or Option+Shift+H | not documented |
| excel | Open the Copilot in Excel task pane. | Alt+C or Cmd+Ctrl+I | not documented |
| excel | Move focus between the Excel grid and the Copilot in Excel task pane. | F6 or Shift+F6 | not documented |
| excel | Cycle between landmark regions. | Ctrl+F6 or Ctrl+Shift+F6 | not documented |
| excel | Move within a landmark region. | Tab key or Shift+Tab | not documented |
| excel | Go to the Search field to run any command. | Alt+Q | not documented |
| excel | Display or hide Key Tips or access the ribbon. | Alt+Windows logo key | not documented |
| excel | Edit the selected cell. | F2 | not documented |
| excel | Go to a specific cell. | Ctrl+G | not documented |
| excel | Move to another worksheet in the workbook. | Ctrl+Alt+Page up or Ctrl+Alt+Page down | not documented |
| excel | Open the context menu. | Shift+F10 or Windows Menu key | not documented |
| excel | Read row header. | Ctrl+Alt+Shift+T | not documented |
| excel | Read row until an active cell. | Ctrl+Alt+Shift+Home | not documented |
| excel | Read row from an active cell. | Ctrl+Alt+Shift+End | not documented |
| excel | Read column header. | Ctrl+Alt+Shift+H | not documented |
| excel | Read column until an active cell. | Ctrl+Alt+Shift+Page up | not documented |
| excel | Read column from an active cell. | Ctrl+Alt+Shift+Page down | not documented |
| excel | Open a list of moving options within a dialog box. | Ctrl+Alt+Spacebar | not documented |
| common | Copy | Ctrl+C | ⌘+C |
| common | Cut | Ctrl+X | ⌘+X |
| common | Paste | Ctrl+V | ⌘+V |
| powerpoint | Display the access keys (ribbon commands) on the ribbon. Then, open the comments pane. | Alt+Period, ; Z, C | Control+Period, ; Z, C |
| powerpoint | Navigate forward to the following regions: Notes paneStatus barHeaderRibbon tabsThumbnail… | Ctrl+F6 | ⌘+F6 |
| powerpoint | Navigate backward to the following regions: Notes paneStatus barHeaderRibbon tabsThumbnai… | Ctrl+Shift+F6 | ⌘+Shift+F6 |
| powerpoint | Add a new comment | Ctrl+Alt+M | ⌘+Shift+M |
| powerpoint | Post a comment or a reply | Ctrl+Enter | ⌘+Enter |
| powerpoint | Move forward through the current comment | Tab key | Tab key |
| powerpoint | Move backward through the current comment | Shift+Tab | Shift+Tab |
| powerpoint | Move to the next comment thread | Down arrow key | Down arrow key |
| powerpoint | Go to the previous comment thread | Up arrow key | Up arrow key |
| powerpoint | Expand a comment thread when the focus is on it | Right arrow key | Right arrow key |
| powerpoint | Collapse a comment thread | Left arrow key | Left arrow key |
| powerpoint | Go to the next reply in a comment thread | Down arrow key | Down arrow key |
| powerpoint | Go to the previous reply in a thread or the parent comment | Up arrow key | Up arrow key |
| powerpoint | Move the focus to the reply box | Tab key | Tab key |
| powerpoint | Select the reply text | Shift+Arrow keys | Shift+Arrow keys |
| powerpoint | Copy the reply text | Ctrl+C | ⌘+C |
| powerpoint | To move the focus to the anchored object when a comment is selected | Alt+F12 | Option+F12 |
| powerpoint | To move the focus to the anchored comment when an object is selected | Alt+F12 | Option+F12 |
| powerpoint | Insert a new slide (with the focus in the thumbnail pane, slide pane, or Notes pane). | Ctrl+M | No shortcut |
| powerpoint | Apply bold formatting to the selected text. | Ctrl+B | ⌘+B |
| powerpoint | Cut selected text, object, or slide. | Ctrl+X | ⌘+X |
| powerpoint | Copy selected text, object, or slide. | Ctrl+C | ⌘+C |
| powerpoint | Paste cut or copied text, object, or slide. | Ctrl+V | ⌘+V |
| powerpoint | Delete selected text, object, or slide. | Delete | Delete |
| powerpoint | When a task pane option has focus, move to the next or previous option in the task pane. | Tab key or Shift+Tab | Tab key or Shift+Tab |
| powerpoint | Exit the slide show. | Esc | Esc |
| powerpoint | Go to the next slide (with the focus in the thumbnail pane or the slide pane). | Page down | Fn+Down arrow key |
| powerpoint | Go to the previous slide (with the focus in the thumbnail pane or the slide pane). | Page up | Fn+Up arrow key |
| powerpoint | Go to the next slide in the Slide Show view. | N, Page down, Down arrow key, Enter, or Space | N, Page down, Right arrow key, Down arr… |
| powerpoint | Go to the previous slide in the Slide Show view. | P, Page up, Left arrow key, Up arrow key, or Backspace | P, Page up, Left arrow key, Up arrow ke… |
| powerpoint | Go to a specific slide in the Slide Show view. | G, then the Right or Left arrow key until on the slide, and… | G, then the Right or Left arrow key unt… |
| powerpoint | Turn captions or subtitles on or off in the Slide Show view. | J | J |
| powerpoint | Exit the Slide Show view. | Esc | Esc |
| powerpoint | Paste text, unformatted. | Ctrl+Shift+V | ⌘+Shift+V |
| powerpoint | Move left to right through placeholders on a slide. | Tab key | Tab key |
| powerpoint | Select or edit the current placeholder. | Enter or F2 | Return or F2 |
| powerpoint | End editing text in a placeholder. | F2 | F2 |
| powerpoint | Select multiple single objects. | Ctrl+Click or Shift+Click | ⌘+Click or Shift+Click |
| powerpoint | Select multiple objects. | Click+Drag the mouse or Shift+Drag the mouse, or Ctrl+Drag … | Click+Drag the mouse or Shift+Drag the … |
| powerpoint | Select all text in the active text box. | Ctrl+A | ⌘+A |
| powerpoint | Insert a hyperlink. | Ctrl+K | ⌘+K |
| powerpoint | Send the object back one position. | Ctrl+Left bracket ([) | ⌘+Shift+Option+B |
| powerpoint | Send the object to back. | Ctrl+Shift+Left bracket ([) | ⌘+Shift+Option+Left bracket ([) |
| powerpoint | Bring the object forward one position. | Ctrl+Right bracket (]) | ⌘+Shift+Option+F |
| powerpoint | Bring the object to front. | Ctrl+Shift+Right bracket (]) | ⌘+Shift+F |
| powerpoint | Rotate the selected object by 15 degrees increments clockwise. | Alt+Right arrow key | Option+Right arrow key |
| powerpoint | Rotate the selected object by 15 degrees increments counterclockwise. | Alt+Left arrow key | Option+Left arrow key |
| powerpoint | Select one character to the right. | Shift+Right arrow key | Shift+Right arrow key |
| powerpoint | Select one character to the left. | Shift+Left arrow key | Shift+Left arrow key |
| powerpoint | Select one word to the right. | Shift+Ctrl+Right arrow key | Shift+Option+Right arrow key |
| powerpoint | Select one word to the left. | Shift+Ctrl+Left arrow key | Shift+Option+Left arrow key |
| powerpoint | Select from the insertion point to the same point one line up. | Shift+Up arrow key | Shift+Up arrow key |
| powerpoint | Select from the insertion point to the same point one line down. | Shift+Down arrow key | Shift+Down arrow key |
| powerpoint | Select from the insertion point to the beginning of the paragraph. | Shift+Ctrl+Up arrow key | ⌘+Shift+Up arrow key |
| powerpoint | Select from the insertion point to the end of the paragraph. | Shift+Ctrl+Down arrow key | ⌘+Shift+Down arrow key |
| powerpoint | Select to the beginning of a line. | Shift+Home | ⌘+Shift+Left arrow key |
| powerpoint | Select to the end of a line. | Shift+End | ⌘+Shift+Right arrow key |
| powerpoint | Select to the beginning of a placeholder or notes. | Shift+Ctrl+Home | ⌘+Shift+Fn+Left arrow key |
| powerpoint | Select to the end of a placeholder or notes. | Shift+Ctrl+End | ⌘+Shift+Fn+Right arrow key |
| powerpoint | Select all within the placeholder or notes. | Ctrl+A | ⌘+A |
| powerpoint | Delete one character to the left. | Backspace | Delete |
| powerpoint | Delete one word to the left. | Ctrl+Backspace | ⌘+Delete |
| powerpoint | Delete one character to the right. | Delete | Fn+Delete |
| powerpoint | Delete one word to the right (with the cursor between the words). | Ctrl+Delete | ⌘+Fn+Delete |
| powerpoint | Move one character to the right. | Right arrow key | Right arrow key |
| powerpoint | Move one character to the left. | Left arrow key | Left arrow key |
| powerpoint | Move one word to the right. | Ctrl+Right arrow key | Option+Right arrow key |
| powerpoint | Move one word to the left. | Ctrl+Left arrow key | Option+Left arrow key |
| powerpoint | Move one line up. | Up arrow key | Up arrow key |
| powerpoint | Move one line down. | Down arrow key | Down arrow key |
| powerpoint | Move to the end of a line. | End | End or Fn+Right arrow key |
| powerpoint | Move to the beginning of a line. | Home | Home or Fn+Left arrow key |
| powerpoint | Move up one paragraph. | Ctrl+Up arrow key | ⌘+Up arrow key |
| powerpoint | Move down one paragraph. | Ctrl+Down arrow key | ⌘+Down arrow key |
| powerpoint | Move to the end of a text box. | Ctrl+End | ⌘+Fn+Right arrow key |
| powerpoint | Move to the beginning of a text box. | Ctrl+Home | ⌘+Fn+Left arrow key |
| powerpoint | Move to the next cell. | Tab key | Tab key |
| powerpoint | Move to the preceding cell. | Shift+Tab | Shift+Tab |
| powerpoint | Move to the next row. | Down arrow key | Down arrow key |
| powerpoint | Move to the preceding row. | Up arrow key | Up arrow key |
| powerpoint | Start a new paragraph. | Enter | Return |
| powerpoint | Add a new row at the bottom of the table with the cursor in the last cell of the last row. | Tab key | Tab key |
| powerpoint | Add a new comment. | Ctrl+Alt+M | ⌘+Shift+M |
| powerpoint | Go to the next comment thread. | Down arrow key | Down arrow key |
| powerpoint | Go to the previous comment thread. | Up arrow key | Up arrow key |
| powerpoint | Expand a comment thread when the focus is on it. | Right arrow key | Right arrow key |
| powerpoint | Collapse a comment thread. | Left arrow key | Left arrow key |
| powerpoint | Go to the next reply in a comment thread. | Down arrow key | Down arrow key |
| powerpoint | Go to the previous reply in a thread or the parent comment. | Up arrow key | Up arrow key |
| powerpoint | Move the focus to the reply box. | Tab key | Tab key |
| powerpoint | Edit a parent comment or reply (when the focus is on the parent comment or reply). | Tab key to More thread actions, Enter, and Down arrow key t… | Tab key to More thread actions, Return,… |
| powerpoint | Post a comment or a reply or save an edit. | Ctrl+Enter | ⌘+Return |
| powerpoint | Go to a different ribbon tab. | Right and Left arrow keys | Right and Left arrow keys |
| powerpoint | Carry out the currently selected ribbon option. | Enter | Return |
| powerpoint | Move between ribbon options or controls. | Right and Left arrow keys | Right and Left arrow keys |
| powerpoint | Move between groups of features in the Single Line Ribbon. | Ctrl+Left arrow key or Right arrow key | No shortcut |
| powerpoint | Switch between the simplified and classic ribbons. | Alt+Period (.), Z, or R | Ctrl+Period (.), Z, or R |
| powerpoint | Perform the next animation or advance to the next slide. | N ; Enter ; Page down ; Right arrow key ; Down arrow key ; … | N ; Return ; Page down ; Right arrow ke… |
| powerpoint | Perform the previous animation or return to the previous slide. | P ; Page up ; Left arrow key ; Up arrow key ; Backspace | P ; Page up ; Left arrow key ; Up arrow… |
| powerpoint | End the presentation. | Esc | Esc |
| word | Go to a view that supports screen readers and keyboard selection of content (requires a P… | TAB to the Generate more accessible view (new window) comma… | not documented |
| word | Find text | CTRL+F, or F3 | not documented |
| word | Hide the Search pane | ESC | not documented |
| word | Switch to Zoom control | CTRL+Z | not documented |
| word | Go to a specific page | Type page number (in page-number control) | not documented |
| word | Print | CTRL+P | not documented |
| word | Move from editing document to Home tab | CTRL+[ | not documented |
| word | Move from editing document to most recently used ribbon command | CTRL+] | not documented |
| word | Activate a different ribbon tab | TAB, ENTER | not documented |
| word | Move among ribbon commands | TAB | not documented |
| word | Execute the currently selected ribbon command | ENTER | not documented |
| word | Collapse or expand the ribbon | CTRL+F3 | not documented |
| word | Right one character | RIGHT ARROW | not documented |
| word | Left one character | LEFT ARROW | not documented |
| word | Right one word | CTRL+RIGHT ARROW | not documented |
| word | Left one word | CTRL+LEFT ARROW | not documented |
| word | Up one line | UP ARROW | not documented |
| word | Down one line | DOWN ARROW | not documented |
| word | Up one paragraph | CTRL+UP ARROW | not documented |
| word | Down one paragraph | CTRL+DOWN ARROW | not documented |
| word | Beginning of line | HOME | not documented |
| word | End of line | END | not documented |
| word | Beginning of page | CTRL+HOME | not documented |
| word | End of page | CTRL+END | not documented |
| word | Right one character | SHIFT+RIGHT ARROW | not documented |
| word | Left one character | SHIFT+LEFT ARROW | not documented |
| word | Right one word | SHIFT+CTRL+RIGHT ARROW | not documented |
| word | Left one word | SHIFT+CTRL+LEFT ARROW | not documented |
| word | Up one line | SHIFT+UP ARROW | not documented |
| word | Down one line | SHIFT+DOWN ARROW | not documented |
| word | Up one paragraph | SHIFT+CTRL+UP ARROW | not documented |
| word | Down one paragraph | SHIFT+CTRL+DOWN ARROW | not documented |
| word | To beginning of paragraph | SHIFT+HOME | not documented |
| word | To end of paragraph | SHIFT+END | not documented |
| word | To beginning of document | SHIFT+CTRL+HOME | not documented |
| word | To end of document | SHIFT+CTRL+END | not documented |
| word | Whole document | CTRL+A | not documented |
| word | Select image | CTRL+ALT+G | not documented |
| word | Cut | CTRL+X | not documented |
| word | Copy | CTRL+C | not documented |
| word | Paste | CTRL+V | not documented |
| word | Undo | CTRL+Z | not documented |
| word | Redo | CTRL+Y | not documented |
| word | Move from on misspelled word to another | ALT+F7 | not documented |
| word | Bold | CTRL+B | not documented |
| word | Italics | CTRL+I | not documented |
| word | Underline | CTRL+U | not documented |
| word | Bulleted list | CTRL+PERIOD | not documented |
| word | Align left | CTRL+L | not documented |
| word | Align right | CTRL+R | not documented |
| word | Align centered | CTRL+E | not documented |
| word | Backspace by word | not documented | ALT+BACKSPACE |
| word | Move IP to bottom of document/outline | not documented | ALT+End |
| word | Page Properties in IE | ALT+ENTER | not documented |
| word | Task Switcher | CTRL+ALT+TAB | not documented |
| word | Win: Navigate to Home Page \| Mac: Move IP to top of document/outline | ALT+Home | ALT+Home |
| word | Win: Navigate back in IE \| Mac: Navigate left by word | ALT+Left | ALT+Left |
| word | Move IP to bottom of document | not documented | ALT+PageDn |
| word | Move IP to top of document | not documented | ALT+PageUp |
| word | Win: Navigate forward in IE \| Mac: Navigate right by word | ALT+Right | ALT+Right |
| word | Win: Switch between Apps \| Mac: Accessibility Loop (moves focus between browser UI and p… | ALT+TAB | ALT+TAB |
| word | Win: Move current page Down one position in the Nav Pane \| Mac: Selects from the IP to t… | ALT+SHIFT+Down | ALT+SHIFT+Down |
| word | Full Screen in IE | ALT+SHIFT+ENTER | not documented |
| word | Task Switcher | CTRL+ALT+SHIFT+TAB | not documented |
| word | Select left by word | not documented | ALT+SHIFT+Left |
| word | Select left by word | not documented | ALT+SHIFT+Right |
| word | Win: Switch between Apps \| Mac: Accessibility Loop (moves focus between browser UI and p… | ALT+SHIFT+TAB | ALT+SHIFT+TAB |
| word | Win: Move current page Down one position in the Nav Pane \| Mac: Selects from the IP to t… | ALT+SHIFT+Up | ALT+SHIFT+Up |
| word | Backspace by word | not documented | CMD+BACKSPACE |
| word | Delete by word | not documented | CMD+DELETE |
| word | Move IP down by paragraph | not documented | CMD+Down |
| word | Move IP to bottom of document/outline | not documented | CMD+End |
| word | Navigate to top of document/outline (in Safari on Mac this navigates to the browser home … | not documented | CMD+Home |
| word | Move IP to the beginning of the line (in Firefox on Mac this navigates the browser back t… | not documented | CMD+Left |
| word | Move IP to the end of the line (in Firefox on Mac this navigates the browser forward) | not documented | CMD+Right |
| word | Task Switcher (like Windows Alt-Tab) | not documented | CMD+TAB |
| word | Move IP up by paragraph | not documented | CMD+Up |
| word | Task Manager (Force Quit Apps) | not documented | CMD+ALT+ESC |
| word | In Safari on Mac this navgiates to the browser home page | not documented | CMD+ALT+Home |
| word | In Chrome on Mac this navigates between browser tabs | not documented | CMD+ALT+Left |
| word | Iin Firefox on Mac this clears the browser cache | not documented | CMD+SHIFT+DELETE |
| word | Select down by paragraph | not documented | CMD+SHIFT+Down |
| word | Select to bottom of document/page | not documented | CMD+SHIFT+End |
| word | Select to top of document/page (in Safari on Mac this navigates to the browser home page) | not documented | CMD+SHIFT+Home |
| word | Select to beginning of line | not documented | CMD+SHIFT+Left |
| word | Select to end of line | not documented | CMD+SHIFT+Right |
| word | Task Switcher (like Windows Alt-Tab) | not documented | CMD+SHIFT+TAB |
| word | Select up by paragraph | not documented | CMD+SHIFT+Up |
| word | Task Manager | CTRL+SHIFT+ESC | not documented |
| word | Select right by word | CTRL+SHIFT+Right | not documented |
| word | Win: Move IP down by paragraph \| Mac: Move IP to end of line | CTRL+Down | CTRL+Down |
| word | Select left by word | CTRL+SHIFT+Left | not documented |
| word | Open Start Menu/Start Screen | CTRL+ESC | not documented |
| word | Open Lock Screen Menu | CTRL+ALT+DELETE | not documented |
| word | Win: Move IP left by word \| Mac: Displays a widget dashboard | CTRL+Left | CTRL+Left |
| word | in Firefox and Chrome on Mac this switches between open tabs | not documented | CTRL+PageDn |
| word | in Firefox and Chrome on Mac this switches between open tabs | not documented | CTRL+PageUp |
| word | Move IP to end of document/outline | CTRL+End | not documented |
| word | Switch between open tabs | CTRL+TAB | CTRL+TAB |
| word | Win: Move IP up by paragraph \| Mac: Move IP to beginning of line | CTRL+Up | CTRL+Up |
| word | Win: Backspace by word \| Mac: Backspace by letter | CTRL+ALT+BACKSPACE | CTRL+ALT+BACKSPACE |
| word | Move IP to beginning of document/outline | CTRL+Home | not documented |
| word | Move IP left by word | CTRL+Right | not documented |
| word | Win: Backspace by word \| Mac: Backspace by letter | CTRL+ALT+SHIFT+BACKSPACE | CTRL+ALT+SHIFT+BACKSPACE |
| word | Minimize Window | ALT+ESC | not documented |
| word | Win: Select down by paragraph \| Mac: Select to end of line | CTRL+SHIFT+Down | CTRL+SHIFT+Down |
| word | Minimize Window | ALT+SHIFT+ESC | not documented |
| word | Win: Select up by paragraph \| Mac: Select to beginning of line | CTRL+SHIFT+Home | CTRL+SHIFT+Home |
| word | Enter Overtype Mode | Insert | not documented |
| word | Switch between open tabs | CTRL+SHIFT+TAB | CTRL+SHIFT+TAB |
| word | Win: Select up by paragraph \| Mac: Select to beginning of line | CTRL+SHIFT+Up | CTRL+SHIFT+Up |
| word | Backspace by letter | BACKSPACE | BACKSPACE |
| word | Delete by letter | DELETE | DELETE |
| word | Move IP down by line | Down | Down |
| word | Move IP to end of line | End | End |
| word | Insert new line | ENTER | ENTER |
| word | Backspace by word | CTRL+BACKSPACE | not documented |
| word | Win: Move IP to beginning of line \| Mac: In Safari and Chrome this moves the IP to the b… | Home | Home |
| word | Move IP left by letter | Left | Left |
| word | Move IP down by one screen | PageDn | PageDn |
| word | Move IP up by one screen | PageUp | PageUp |
| word | Move IP right by letter | Right | Right |
| word | Move IP up by one line | Up | Up |
| word | Backspace by letter | SHIFT+BACKSPACE | SHIFT+BACKSPACE |
| word | Select down by line | SHIFT+Down | SHIFT+Down |
| word | Select to end of line | SHIFT+End | SHIFT+End |
| word | Insert soft line break | SHIFT+ENTER | SHIFT+ENTER |
| word | Select to beginning of line | SHIFT+Home | SHIFT+Home |
| word | Select left by letter | SHIFT+Left | SHIFT+Left |
| word | Select right by letter | SHIFT+Right | SHIFT+Right |
| word | Select up by line | SHIFT+Up | SHIFT+Up |
| word | In the Reading view, open a PDF-based view tagged to work with screen readers. | Press the Tab key until you reach the Accessibility Mode bu… | not documented |
| word | Find text in the Reading view. | Ctrl+F or F3 | not documented |
| word | Hide the task pane, if one is open. | Esc | not documented |
| word | Switch to the Zoom control. | Alt+Period, W, then Q or Alt+Windows logo key, W, then Q | not documented |
| word | Go to the Tell Me or Search text field. | Alt+Q | not documented |
| word | Open the Tell Me or Search text field on the ribbon to type a search term. | Alt+Period, Q or Alt+Windows logo key, Q | not documented |
| word | Open the File tab to use the Backstage view. | Alt+Period, F or Alt+Windows logo key, F | not documented |
| word | Open the Home tab to format text and use the Find tool. | Alt+Period, H or Alt+Windows logo key, H | not documented |
| word | Open the Insert tab to insert a picture, link, comment, header or footer, or a page numbe… | Alt+Period, N or Alt+Windows logo key, N | not documented |
| word | Open the Page Layout tab to set page margins, orientation, and size, and paragraph spacin… | Alt+Period, A or Alt+Windows logo key, A | not documented |
| word | Open the References tab to insert a table of contents, footnotes, or endnotes. | Alt+Period, S or Alt+Windows logo key, S | not documented |
| word | Open the Review tab to check spelling, add comments, or track and review changes to your … | Alt+Period, R or Alt+Windows logo key, R | not documented |
| word | Open the View tab to choose a view, open the Navigation pane, edit the Header & Footer, a… | Alt+Period, W or Alt+Windows logo key, W | not documented |
| word | When a Ribbon tab is selected, move the focus to the tab commands. | Enter, then Tab key or Shift+Tab | not documented |
| word | Activate a selected button. | Spacebar or Enter | not documented |
| word | Open the list for a selected command. | Spacebar or Enter | not documented |
| word | Open the menu for a selected button. | Alt+Down arrow key | not documented |
| word | When a menu or submenu is open, move to the next command. | Down arrow key | not documented |
| word | Move the cursor right by one word. | Ctrl+Right arrow key | not documented |
| word | Move the cursor left by one word. | Ctrl+Left arrow key | not documented |
| word | Move the cursor up by one paragraph. | Ctrl+Up arrow key | not documented |
| word | Move the cursor down by one paragraph. | Ctrl+Down arrow key | not documented |
| word | Move the cursor to the beginning of the current line. | Home | not documented |
| word | Move the cursor to the end of the current line. | End | not documented |
| word | Move the cursor to the beginning of the document. | Ctrl+Home | not documented |
| word | Move the cursor to the end of the document. | Ctrl+End | not documented |
| word | Select text. | Shift+Arrow keys | not documented |
| word | Select the word to the right. | Shift+Ctrl+Right arrow key | not documented |
| word | Select the word to the left. | Shift+Ctrl+Left arrow key | not documented |
| word | Select the paragraph above. | Shift+Ctrl+Up arrow key | not documented |
| word | Select the paragraph below. | Shift+Ctrl+Down arrow key | not documented |
| word | Select from the current position to the beginning of the line. | Shift+Home | not documented |
| word | Select from the current position to the end of the line. | Shift+End | not documented |
| word | Select from the current position to the beginning of the document. | Shift+Ctrl+Home | not documented |
| word | Select from the current position to the end of the document. | Shift+Ctrl+End | not documented |
| word | Show or hide the Comments pane. | Alt+Period, R, K or Alt+Windows logo key, R, K | not documented |
| word | Go to the next comment thread, or the next reply in an expanded comment thread. | Down arrow key | not documented |
| word | Go to the previous comment thread. | Up arrow key | not documented |
| word | Expand the current comment thread. | Right arrow key | not documented |
| word | Collapse the current comment thread. | Left arrow key | not documented |
| word | Move to the reply box, when focus is on a comment. | Tab key, Tab key, Enter | not documented |
| word | Edit a comment or reply, when focus is on the comment or reply. | Tab key, Enter | not documented |
| word | Post a comment/reply or save an edit. | Ctrl+Enter | not documented |
| word | Discard a draft comment/reply or edit. | Esc | not documented |

## Gaps left

- No Mac column for Word and Excel for the web: Mac web keys for those two apps are not on any Microsoft page I found; copy/cut/paste ⌘ keys and the two ribbon start keys come from prose.
- Word web has no rows for New / Open / Save / Save As / Close / Help; PowerPoint web has none for New / Open / Save As / Close / Help and its Save row says changes save automatically (no key); Excel web prints Open, Close, Print and `Alt+F2` Save As but no New / Save / Help.
- Styles and character formats missing on every web page: Word headings, Normal style, double underline, strikethrough, sub/superscript, hanging indent, track changes; Excel replace, fill, paste special, select all; PowerPoint group/ungroup, replace, strikethrough, bulleted list, indent/outdent, presenter view, zoom to fit.
- Edge PDF viewer rows are out of scope for 'for the web' (no web page lists them).
- Not covered: OneNote/Outlook for the web, SharePoint pages (`keyboard-shortcuts-86d68234` is SharePoint), Microsoft Learn.
