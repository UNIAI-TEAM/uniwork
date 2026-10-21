# C — Microsoft 365 shortcut reference (UNI-2011 stage 1)

Output: `C-ms-reference.csv` (159 rows: word 50, excel 49, powerpoint 45, pdf 13, common 2).

## Method and limits (read first)

- Every row comes from a Microsoft page fetched on 2026-10-20 with WebFetch. WebFetch returns a **model-written extraction of the page, not the raw HTML**. No row is `high` confidence for that reason: 135 rows are `medium`, 24 are `low`.
- `low` means one of these: the fetches contradicted each other, the key looks like a Microsoft typo, or the row did not come out of the extraction. Re-read the page before porting any `low` row.
- A key I could not find on Microsoft's page is written `not documented` (Microsoft does not list it) or `not extracted` (it probably is on the page, but the fetch did not return it). I did not fill either from memory.
- Only the PowerPoint, Word, Excel and two Edge pages were read. No separate Word-for-Mac, Excel-for-Mac or Microsoft Learn article was fetched. The Mac keys come from the macOS tab of the same articles.

## Sources (fetched 2026-10-20)

| Product | URL |
| --- | --- |
| Word (Windows, macOS tab) | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2 |
| Excel (Windows, macOS tab) | https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f |
| PowerPoint (Windows, macOS tab) | https://support.microsoft.com/en-us/office/use-keyboard-shortcuts-to-create-powerpoint-presentations-ebb3d20e-dcd4-444f-a38e-bb5c5ed180f4 |
| Edge, with a PDF section (Windows keys only) | https://support.microsoft.com/en-us/edge/microsoft-edge-keyboard-shortcuts |
| Edge, older page (Windows and Mac) | https://support.microsoft.com/en-us/help/4531783/microsoft-edge-keyboard-shortcuts |

## Where Word, Excel and PowerPoint disagree (Windows)

| Action | Word | Excel | PowerPoint |
| --- | --- | --- | --- |
| Save As | F12 | F12 | Ctrl+Shift+S |
| Redo | Ctrl+Y | Ctrl+Y (also "repeat") | Ctrl+Y |
| Ctrl+M | Indent paragraph | not listed | New slide |
| Ctrl+G | Go To | not listed for desktop (F5 is Go To) | Group |
| Ctrl+R | Align right | not listed for desktop (fill right on Mac list only) | Align right |
| Ctrl+D | not listed | Fill down | Duplicate object (page also prints it for "Close", likely an error) |
| Ctrl+H | Replace | not listed for desktop | Replace |
| Ctrl+F | Navigation pane | not listed for desktop | Find |
| Ctrl+E | Center | not extracted | Center |
| Ctrl+Space | Clear character formatting | Select column | Clear character formatting |
| Ctrl+K | Hyperlink | Hyperlink | Hyperlink |
| Ctrl+F1 | Expand or collapse ribbon | Expand or collapse ribbon | Expand or collapse ribbon, and also "full screen" on the same page |
| F4 | Repeat last action | Repeat last action, cycle reference types | not listed |
| Indent | Ctrl+M | not applicable | Alt+Shift+Right (demote) |
| Strikethrough | not listed (Mac: Cmd+Shift+X) | Ctrl+5 | not listed |
| Subscript | extraction said Ctrl+Shift+- (low) | not applicable | Ctrl+= |
| Bold/italic/underline | Ctrl+B/I/U | Ctrl+B/I/U, also Ctrl+2/3/4 | Ctrl+B/I/U |
| Font grow/shrink | Ctrl+Shift+> / <, plus 1pt Ctrl+] / [ | not applicable | Ctrl+Shift+> / < only |
| Comment | Ctrl+Alt+M | Shift+F2 (cell note) | not extracted |
| Numbered list | not listed | not applicable | not listed |

Shared by all three: Ctrl+B/I/U, Ctrl+K, Ctrl+Z, Ctrl+Y, Ctrl+X/C/V, Ctrl+A, Ctrl+O/S/W (Excel, Word), Ctrl+P, F6 / Shift+F6, Alt or F10 for ribbon key tips, Ctrl+F1.

## Where Mac differs structurally

- **Cmd replaces Ctrl** for most editing keys (Cmd+B, Cmd+S, Cmd+Arrow in Excel). Excel for Mac often lists both Cmd and Ctrl for the same action (Cmd+D or Ctrl+D, Cmd+K or Ctrl+K).
- **Ctrl stays Ctrl** for some actions: Excel select column (Ctrl+Space), date entry (Ctrl+;), number formats (Ctrl+Shift+~ etc.), Word Replace (Control+H), PowerPoint duplicate object (Control+D), PowerPoint Clear formatting (Control+Space), Word Mac indent (Control+Shift+M, low).
- **Option replaces Alt**: Word Heading 1-3 (Cmd+Option+1..3), Word Go To (Cmd+Option+G), PowerPoint group (Cmd+Option+G), Excel next/previous sheet (Option+Right/Left).
- **Different letter, not only different modifier**: Word comment is Ctrl+Alt+M on Windows and Cmd+Option+A on Mac. Excel AutoSum is Alt+= and Shift+Cmd+T (low). Excel current time is Ctrl+Shift+: and Cmd+;. PowerPoint new slide is Ctrl+M and Cmd+Shift+N. PowerPoint start show is F5 and Cmd+Shift+Return. Word and Excel strikethrough is Cmd+Shift+X (Excel Windows is Ctrl+5).
- **Ribbon**: Windows uses Alt/F10 key tips and Ctrl+F1. Mac documents Cmd+Option+R in Word and Excel, and no key-tip activation.
- **F-keys**: Word for Mac maps F1 to Undo, F2 to Cut, F3 to Copy, F4 to Paste. Excel and PowerPoint for Mac keep F1 as Help, F2 as Edit cell, F4 as absolute reference. Microsoft says to press Fn together with an F-key, or turn on "Use all F1, F2, etc. keys as standard function keys" in Keyboard settings. F12 (Save As) needs that setting too.
- **Redo**: Word Mac lists Cmd+Y only. Excel Mac also lists Cmd+Shift+Z. Ctrl+Shift+Z is not on any Windows Microsoft page I read.

## Mac keys reserved by the OS

- Microsoft's own pages only say that Word and Excel mark conflicting shortcuts with an asterisk (Word) or tell you to clear the system shortcut in System Settings > Keyboard > Keyboard Shortcuts (Excel). The pages I read did not name specific OS shortcuts (for example Mission Control or Spotlight).
- Not from Microsoft, my own general macOS knowledge, unverified here: Ctrl+Space (Excel select column, Word clear formatting on Windows) is the default macOS input-source switch when that shortcut is enabled, and Cmd+Space opens Spotlight. Those matter for Vietnamese input-method users. Check before relying on them.

## Edge PDF viewer

- Microsoft's two Edge pages disagree. `/edge/microsoft-edge-keyboard-shortcuts` has a "When reading PDF documents" section: Ctrl+G go to page, Alt+T table of contents, Ctrl+F search, Ctrl+Plus/Minus zoom, Ctrl+Shift+A fit width/page, F8 one/two pages, F9 rotate, F11 full screen, Ctrl+Shift+G read aloud, Ctrl+Shift+M notes, Ctrl+Shift+S save a copy. `4531783` instead lists Ctrl+\ (fit toggle) and Ctrl+[ / Ctrl+] (rotate), with Cmd equivalents on Mac. Both are recorded in the CSV as `low`.
- Neither page documents next/previous page for PDFs. The first page lists only Windows keys.

## Gaps (asked for, not found on Microsoft's pages)

- Word: numbered list, Ctrl+Shift+Z redo, Mac New/Open/Save/hyperlink/clear formatting/superscript, F6 on Mac.
- Excel: Windows Ctrl+N, Ctrl+P, Ctrl+F, Ctrl+H, Ctrl+G and Ctrl+R were absent from the extraction. Ctrl+Shift+1..6 is not a desktop Excel set.
- PowerPoint: Shift+F5 (start from current slide) did not appear in two fetches of the article. Ctrl+W close is not shown, and the page prints Ctrl+D for close, which clashes with duplicate. Numbered list and strikethrough are not listed.
- Ctrl+/ shortcut help: not seen on any of these pages.
- Microsoft Learn was not searched.
