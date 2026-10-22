# S1 — text editors: docs (Word), uninote, markdown, html (UNI-2011 stage 1, contract only)

Output: `S1-text-editors.csv`, 216 rows, 16 columns exactly as in SYNTH-COMMON, UTF-8, RFC4180 (CRLF). Groups: docs 103, uninote 45, markdown 40, html 28. (`docs-103`, Paste Special, was appended last, after the lookup coverage check; it is `missing`, confidence low.) Nothing was run; every cell comes from a read line. Every `evidence` entry was resolved by script (file exists, line exists and is not blank) and the cited lines were read in the script output; library entries point into `raw/lib-src/*` (TipTap 3.31.0 source, ProseMirror, CodeMirror dist). MS keys are copied from `C2-ms-raw.csv` by (page, html line); `ms_source` carries the line (`word win L1508`, `word mac L3063`, `common-mac L744`) and the page URL.

## Conventions I used

- Statuses follow SYNTH-COMMON. Where Windows and Mac differ for the same surface, `same` is only used when **both** match MS; a Mac-only or Windows-only difference is `different` and the notes say which platform.
- Ours-only actions (no Word counterpart) get `ms_win`/`ms_mac` = `n/a`. Their status is `same` unless their key collides with a different MS action, then `conflict`. Actions where MS has the action but the page prints no key get `not documented`; those rows also use `same` when we have a key and nothing collides.
- UniNote is web-only: `desktop_today` = `n/a` and `proposal_desktop` = `n/a`.
- In the web frame of docs/html/markdown, global UniWork shortcuts (Ctrl+J, Ctrl+K, …) cannot fire while the iframe has focus, so "editor wins" is already true there. In UniNote (same document as the app shell) it is not: the global listener runs on `document`, bubble phase, and skips events that are `defaultPrevented` (`D:packages/views/layout/global-shortcuts.tsx:69`; `definitions.ts:261`). ProseMirror also ignores `defaultPrevented` events (`prosemirror-view dist/index.js:3196`). So an editor binding that calls preventDefault beats the global chord, and a capture-phase window handler (markdown, html) beats ProseMirror.
- `ALT-PROPOSED` keys are not validated in any browser.

## 1. Rows by status

| status | docs | uninote | markdown | html | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| same | 61 | 26 | 26 | 21 | 134 |
| different | 7 | 2 | 1 | 0 | 10 |
| missing | 16 | 9 | 2 | 1 | 28 |
| conflict | 5 | 8 | 8 | 3 | 24 |
| web:missing;desktop:same | 5 | 0 | 2 | 2 | 9 |
| web:missing;desktop:conflict | 3 | 0 | 0 | 0 | 3 |
| web:same;desktop:conflict | 3 | 0 | 0 | 0 | 3 |
| web:conflict;desktop:conflict | 1 | 0 | 1 | 1 | 3 |
| web:different;desktop:different | 1 | 0 | 0 | 0 | 1 |
| web:missing;desktop:different | 1 | 0 | 0 | 0 | 1 |
| **rows** | 103 | 45 | 40 | 28 | 216 |

Confidence: high 124, medium 72, low 19 (rows without a read MS cell or with indirect evidence are medium/low).

MS coverage: the 52 Word rows of `C2-ms-lookup.csv` all appear (checked by script: each lookup key appears as `ms_win`/`ms_mac` of some row; the two that were missing at first, Shift+F5 and Shift+F6, were added). Beyond the lookup, 89 of the 286 Word Windows rows and 76 of the 195 Word Mac rows in `C2-ms-raw.csv` are cited by `ms_source`; the rest are listed in §4.

## 2. The 10 most visible gaps (tiếng Việt)

1. **UniNote: Ctrl+K mở tìm kiếm, không chèn liên kết.** Word dùng Ctrl+K để chèn hyperlink. Trang UniNote cố ý không có phím link (test `page-shortcuts.test.ts:67` khẳng định điều đó) và Ctrl+K còn bắn cả khi con trỏ đang trong editor (`allowInEditable`). Đề xuất: khi focus trong editor thì Ctrl+K chèn link, tìm kiếm giữ phím này ở mọi nơi khác. Cần sản phẩm duyệt vì đảo một quyết định cũ.
2. **UniNote: Ctrl+E là inline code, Ctrl+J mở Ask UNI.** Word: Ctrl+E căn giữa, Ctrl+J căn đều. UniNote chưa có căn lề nên người dùng Word không mất tính năng, nhưng bấm Ctrl+E/Ctrl+J ra kết quả lạ. Khi thêm căn lề, phím MS phải thắng trong editor.
3. **UniNote: danh sách gạch đầu dòng là Ctrl+Shift+8.** Word: Ctrl+Shift+L (còn Ctrl+Shift+8 là hiện/ẩn ký tự không in). Docs/markdown cũng vậy. Đề xuất thêm Ctrl+Shift+L làm phím phụ (cần thử trên trình duyệt).
4. **UniNote: Ctrl+S không có xử lý.** Trang tự lưu nhưng bấm Ctrl+S thì trình duyệt mở hộp "Lưu trang". Đề xuất bắt phím, chặn mặc định và hiện "Đã lưu".
5. **Docs/Markdown/HTML: Lưu thành (Save As).** Word Windows dùng F12, còn Ctrl+Shift+S là Apply Styles. Ta dùng Ctrl+Shift+S; trong docs web phím này còn không chạy (handler so `e.key==='s'`, có Shift thì là `'S'`); trong markdown nó đè luôn phím gạch ngang chữ của TipTap.
6. **Docs desktop: Ctrl+Shift+N = Cửa sổ mới, Ctrl+Alt+M = hộp thoại Paragraph.** Word: Ctrl+Shift+N là Normal style, Ctrl+Alt+M là chèn bình luận (bình luận của ta đang ở Ctrl+Alt+A). Ba hành động này cần dời phím để khớp MS.
7. **Docs: những phím trang MS in ra nhưng ta khác.** Subscript (MS in Ctrl+Shift+Minus, ta Ctrl+,), non-breaking hyphen (MS Shift+Alt+Minus, ta Ctrl+Shift+-), copy/paste format (MS Ctrl+Alt+C / Ctrl+Alt+V, ta Ctrl+Shift+C / Ctrl+Alt+Shift+V), Compact ribbon Ctrl+Alt+K trùng AutoFormat của Word. Các giá trị này lấy nguyên văn từ trang MS, đã ghi câu hỏi mở ở §3.
8. **Docs thiếu hẳn phím:** danh sách bullet Ctrl+Shift+L, double underline, All caps, Small caps, Hidden text, F4 lặp lại thao tác, Shift+F4 tìm tiếp, F6 chuyển pane, F1 trợ giúp, Ctrl+Alt+I xem trước in, Alt/F10 KeyTips. Chủ yếu mức ưu tiên thấp, trừ bullet list.
9. **Mac:** Tăng indent (MS Control+Shift+M, ta Control+M), chèn field DATE/TIME (MS Control+Shift+D/T, ta Option+Shift+D/T), nbsp (MS Option+Space, ta Shift+Cmd+Space), Strikethrough Cmd+Shift+X chưa có. Riêng **Control+Space (xoá định dạng) đụng phím chuyển bộ gõ của macOS**, ảnh hưởng người gõ tiếng Việt.
10. **Markdown/HTML:** Ctrl+E (đổi chế độ nguồn) và Ctrl+Shift+S (Save As) nuốt mất phím inline code/strikethrough của TipTap; Ctrl+D nhân đôi block (Word: hộp Font); Ctrl+Shift+Up/Down di chuyển block đè lên chọn theo đoạn; HTML: Ctrl+K = Ask AI (Word: hyperlink); trong khung nguồn CodeMirror Ctrl+I/Ctrl+U/Ctrl+[ ] không phải in nghiêng/gạch chân/cỡ chữ.

Thêm một rủi ro không phải phím: rất nhiều handler Enter/Esc (modal, panel Find, comment, slash menu, auto-link, read-mode) không kiểm `isComposing`, nguy cơ khi gõ Telex/VNI (cột `ime_altgr`).

## 3. Open questions and what I could not verify

1. **MS pages vs classic Word.** The contract says to copy what the page prints, and the pages print values that differ from what Word users know: subscript `Ctrl+Shift+Minus (-)` (classic Word: Ctrl+=), non-breaking hyphen `Shift+Alt+Minus`, copy/paste formatting `Ctrl+Alt+C / Ctrl+Alt+V` (Windows) and `Cmd+Option+C/V` (Mac Word table) while the common Mac page prints `Command+Shift+C`. I proposed the printed values but flagged them (`medium`). Decision needed before S-docs binds them.
2. **Word for Mac Close:** Word table prints `Cmd+F4`, the common Mac page prints `Command+W`. Proposal keeps Cmd+W (macOS standard).
3. **F12 for Save As on the web:** it is MS's key but is also the browser DevTools key; the pages can preventDefault. Not validated.
4. **Browser claims are not read from any source:** Ctrl+H = history, Ctrl+Shift+N = incognito, F12 = DevTools, Ctrl+G = find next, Ctrl+Shift+T = reopen tab, Ctrl+D = bookmark. The registry comment (`definitions.ts:279-283`) confirms only print, address bar, new tab/window, bookmark and view source as browser-owned. All `ALT-PROPOSED` keys (Alt+Shift+N, Ctrl+Shift+L, F12, …) need a browser pass.
5. **TipTap version for UniNote:** D's `pnpm-lock.yaml` resolves `@tiptap/*` to 3.30.6 (`pnpm-workspace.yaml` catalog says 3.27.1, not reconciled; the lock wins). D has no `node_modules` in this checkout, so UniNote library lines point to the 3.31.0 sources in `raw/lib-src/tiptap-src`; D-lib-defaults found no keymap change between 3.30.6 and 3.31.0. Line numbers match B's 3.30.6 citations.
6. **UniNote `Mod-B` vs `Mod-Shift-b`:** TipTap Bold lists an uppercase `Mod-B` alias (`bold.tsx:134`) that overlaps blockquote's `Mod-Shift-b`. `page-shortcuts.test.ts:41` proves blockquote activates in the page editor; behaviour in a real browser was not run.
7. **Esc forwarding:** an unhandled Esc in a docs frame becomes `close_requested{reason:'escape'}` to the host (`escape-forwarder.ts:41`). Word does not close the document on Esc. Whether the host closes the view needs a product check.
8. **Save As in docs web frame:** renderer handler tests `e.key==='s'`; with Shift that is `'S'` unless Caps Lock, so the branch looks dead. Concluded from reading, not run.
9. **Markdown/html "capture-phase beats ProseMirror":** derived from `eventBelongsToView` (`prosemirror-view dist/index.js:3196`) and the window capture listeners; not run in a browser.
10. **Docs web zoom:** no zoom key exists in the web frame (zoom is menu-only, `App.tsx:5810-5816`); browser zoom applies. Whether the intended web behaviour is document zoom is open.
11. **UniNote Ctrl+S, Ctrl+F, Ctrl+P:** the claims "browser Save page / browser find / browser print" come from B's grep of `packages/views/documents` (no handler) and from `use-task-detail-shortcuts.ts` being wired on task detail only. The absence evidence in the CSV points at the test header and registry lines, not at a handler, because no handler exists.
12. **Statuses for MS `not documented`:** documented in Conventions; if the lane lead wants a different rule, only the status column changes.
13. Alt-based ribbon KeyTips (`Alt, H`, …), Outline view, mail-merge, fields beyond DATE/TIME/F9/Alt+F9, language/IME-switch rows: no counterpart feature in these groups. Listed in §4.

## 4. Source rows not turned into their own action row

**A-fork-modules (docs) folded into a class row:** AI composer, AI queue strip, AI model picker, CollabComposer, CollabThread, comment composer/submit, PromptModal, FindPanel/GoTo/NavPane Enter-Esc, Ruler nudge, LengthInput, context-menu Esc, modal Esc/Tab trap, frame-dialog Esc/Tab (`web/modules/shared/frame-dialog.ts:311`), AI web dialog Esc (`shared/ai/ui.ts:245`) → `docs-100` (dialog and panel keys) and `docs-009` (Esc). Ribbon font box Enter/arrows → `docs-100`. Editing behaviours (Enter in heading, Enter replaces selection, Enter in page-break paragraph, Backspace in indented paragraph, undo-autocorrect Backspace, Backspace over struck run, auto-link Space/Enter, page-gap arrows, hf-editor Esc, shape/table-drag Esc, Tab inserts tab character) → `docs-098` and `docs-062`. TipTap core editing keys row and the Ctrl+Enter-in-code row → `docs-096`/`docs-066` notes. `docs-main.ts` "page-break not in menu" comment row → `docs-066`.
**B-shell-host-web:** fork shell rows for Home, PDF, Sheets, Slides, tabs, shell/globalShortcut, window, notes, uniai-pwa, chat-desktop and the Electron-role quit/minimize/reload rows belong to S2/S3 (other groups), except the ones docs exposes (Close, Back to Home, Alt menu bar, tab-manager `before-input-event`). Host protocol rows (init/open/save/…/close_requested), focus handback, iframe `allow`, "no key handling in apps/web/platform/office-frame" are structure, not actions; they appear in notes (Save, Print, Esc). Global registry rows `createTask` (C), `openThreadNav` (Ctrl+Shift+O), the eight unassigned `go*` actions, email-hub plain keys, `j k r e x` list keys, `/` in people toolbar, meeting-room Ctrl+D/E: no collision with an editor (plain keys skip editable targets; the room skips typing targets) → not rows here; the sidebar Ctrl+B and the global send/back/forward are in `uninote-001` and `uninote-041`. UniNote: highlight and Esc-blur are Markdown-flavour only (not active in the page editor); help-popover source table, toolbar roving focus, documents-tree keys, comment composer, documents-search Esc, zoom canvas → folded into `uninote-045` and `uninote-037`.
**A-part-pdfhtmlmd (html, markdown):** about 30 popover/menu/dialog Esc and Enter closers (Ribbon, FloatToolbar, ColorField, AiAskPopover, EditQueueCard, BriefCard, RedactDialog, StylePanel, SlashMenu, RedactMenu, Mind map card, code block header) → one dialog-class row per group (`html-028`, `markdown-039`, `markdown-038`). Wiki-link Ctrl+click, mind-map Ctrl+wheel: ours-only pointer actions, not turned into rows. Inspector keys (select sibling/parent, delete, move, Ask AI) → `html-026`, `html-018`.
**D-lib-defaults:** the ~60 CodeMirror `standardKeymap`/emacs rows and `closeBrackets`, `indentWithTab`, fold rows → one "source view default editing keys" row per group (`markdown-040`, `html-027`), with the Word-letter collisions named in notes. TipTap core/table/list/code-block structural rows → `uninote-043`, `docs-096`, `docs-097`. ProseMirror gapcursor/tables arrow rows → cursor-movement row `docs-095`. Univer and pdf.js rows are other lanes.
**C2 Word rows not cited (197 Windows, 119 Mac):** ribbon access-key families and ribbon navigation, Backstage keys; cursor movement and selection families (aggregated in `docs-095`), extended selection (F8), table cell selection/resizing, Spike/AutoText/Building Block, Symbol font, special characters and accents, em/en dash, copyright/trademark, mail merge, fields other than DATE/TIME/update/toggle codes, language and IME switching, document views (Read, Print Layout, Outline, Draft) and outline keys, TOC/index/citation marking, next/previous footnote, split window, Reveal Formatting, Mac drawing mode and right-to-left switching. Reason: no counterpart feature in docs/UniNote/markdown/html, or browser-native behaviour that cannot be verified from source.

## 5. Structural findings that matter for the slices

- **Keyboard→menu mapping is absent in the web frame (docs):** Ctrl+N, Ctrl+Shift+N, Ctrl+W, Ctrl+Shift+S (dead handler), zoom keys and Ctrl+/ exist only as desktop menu accelerators. A "key-to-command" table shared by menu and renderer (S-docs) would remove the duplicate registrations (`docs-003`, `docs-004`, `docs-018`, `docs-033`, `docs-071`).
- **Menu accelerators win over renderer handlers on desktop**, so every key moved off a menu item (New window, Save As, Paragraph dialog, Back to Home) must change in `docs-main.ts` and `apps/shell/src/main/index.ts` (S-docs and S-shell) before the renderer sees it.
- **Redo hint:** Ctrl+Y already works through TipTap; both the docs menu and the UniNote toolbar tooltip only show Ctrl+Shift+Z. The fix is hint-only.
- **Collision resolution rule used throughout:** inside a focused editor the editor's MS-aligned key wins; the UniWork global chord keeps working everywhere else and gets a visible button/menu entry. This reverses two existing choices (UniNote Ctrl+K, and the html Ask-AI Ctrl+K) and needs the lane lead's sign-off.
- **Ctrl+Alt on Windows is AltGr:** every `Ctrl+Alt+…` MS key in this group (headings, comment, footnote, endnote, preview, Compact ribbon) fires on AltGr+key in the docs window handler (`ime_altgr` column). Any new binding should use the `getModifierState('AltGraph')` exclusion the global registry already has (`definitions.ts:139`).

## 6. Files read

Inputs: `SYNTH-COMMON.md`, `S1.md`, `COMMON.md`, `A-fork-modules.csv/.out.md`, `A-part-pdfhtmlmd.csv/.md`, `B-shell-host-web.csv/.out.md`, `D-lib-defaults.csv/.out.md`, `C2-ms-raw.csv`, `C2-ms-lookup.csv`, `C2-ms-raw.out.md`.
Code read to confirm lines: fork `apps/docs/src/renderer/{App.tsx 5495-5830, shortcuts.ts, components/Ribbon.tsx 1850-1870}`, `apps/docs/src/renderer/editor/extensions.ts 1655-1700`, `apps/markdown/src/renderer/App.tsx 1062-1131`, `apps/html/src/renderer/App.tsx 1480-1540`, `packages/ui/src/ribbon-collapse.tsx 72-95`; D `packages/views/documents/page-toolbar/{page-shortcuts.test.ts, page-toolbar-model.ts 40-105}`, `packages/views/editor/extensions/index.ts 355-410`, `packages/core/shortcuts/definitions.ts 55-150, 255-325`, `packages/views/layout/global-shortcuts.tsx 40-115`, `packages/ui/components/ui/sidebar.tsx 196-222`, `packages/views/meetings/meeting-room-shortcuts.ts 20-52`, `packages/views/tasks/detail/hooks/use-task-detail-shortcuts.ts 44-66`, `document-tree.tsx 176-200`; library `raw/lib-src/prosemirror-view-1.42.6/dist/index.js 3193-3201`; every cited evidence line was also printed by the build script.
