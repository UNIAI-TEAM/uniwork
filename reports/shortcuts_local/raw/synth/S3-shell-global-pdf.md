# S3 — shell, global, pdf, common (stage 1, read-only)

Output: `S3-shell-global-pdf.csv` (94 rows, the exact 16 columns of SYNTH-COMMON). Groups: pdf 27, common 23, global 23, shell 21.
Every `evidence` entry was resolved by script (file exists, line in range): 0 bad. MS keys were copied programmatically and verbatim from `C2-ms-lookup.csv` / `C2-ms-raw.csv`, never typed from memory.
Evidence prefixes in the CSV: `fork:` = `uniwork-office` fork (worktree `shortcuts-ro-UNI-2011`), `D:` = this repo, `electron:` = `raw/lib-src/electron-src` (Electron role defaults).

## 1. Counts

Rows by group and status (`web:X;desktop:Y` kept when the two surfaces differ; `same` etc. when they agree):

| status | common | pdf | shell | global | total |
| --- | --- | --- | --- | --- | --- |
| same | 5 | 11 | 10 | 12 | 38 |
| different | 1 | 8 | 4 | 0 | 13 |
| missing | 4 | 5 | 1 | 2 | 12 |
| conflict | 3 | 1 | 5 | 9 | 18 |
| web:different;desktop:conflict | 4 | 0 | 0 | 0 | 4 |
| web:conflict;desktop:different | 2 | 0 | 1 | 0 | 3 |
| web:conflict;desktop:missing | 1 | 1 | 0 | 0 | 2 |
| web:missing;desktop:same | 1 | 1 | 0 | 0 | 2 |
| web:same;desktop:different | 2 | 0 | 0 | 0 | 2 |
| **total** | 23 | 27 | 21 | 23 | **94** |

Per surface (splitting the combined statuses): web — same 40, different 17, missing 14, conflict 23. Desktop — same 40, different 18, missing 14, conflict 22.
Confidence: high 56, medium 31, low 7. Rows with no MS counterpart (`ms_win` = `n/a`, ours-only): 27. Rows with `ALT-PROPOSED`: 9 (common-01/07/11/15, shell-01/03, global-01/02/05).

Reading: in the shell and global groups the code is mostly consistent with itself (same 22 of 44) but collides with Word/Excel/PowerPoint on 14 chords. In pdf the viewer follows Edge PDF on the basics (find, print, zoom, save) and lacks the Edge extras (Ctrl+G, Ctrl+\, rotate, read aloud, TOC).
"Absence" rows (no F6, F1, F11, F12, Ctrl+/ handler) are grep-based: the evidence line names the closest code that would hold the handler.

## 2. The 10 most user-visible gaps (plain Vietnamese)

1. **Lưu thành (Save As) không giống Office.** Word/Excel dùng F12; bản desktop của Docs dùng Ctrl+Shift+S, trong khi Ctrl+Shift+S của Word là "Áp dụng kiểu". PDF cũng coi Ctrl+Shift+S là Lưu. Không có F12 ở đâu cả (common-05, pdf-02).
2. **F6 / Shift+F6 và F1 chưa có.** Người dùng Office quen F6 để nhảy giữa thanh ribbon, vùng soạn thảo và thanh trạng thái, và F1 để mở trợ giúp. Không module nào bắt phím này (common-09, common-13). Ctrl+/ chỉ mở bảng phím tắt ở menu của Docs (common-14).
3. **Redo bằng Ctrl+Y.** Menu Edit của shell chỉ có Ctrl+Shift+Z, trong khi cả ba ứng dụng Office dùng Ctrl+Y (shell-05, pdf-04).
4. **Ctrl+N / Ctrl+W / Ctrl+T trên web bị trình duyệt giữ.** Trang web không chặn được các phím này, nên "Tạo mới" và "Đóng tài liệu" không thể dùng đúng phím Office; cần phím thay thế `ALT-PROPOSED` (Alt+Shift+N, Alt+Shift+W) và phải kiểm tra thực tế ở giai đoạn 2 (common-01, common-07).
5. **Ctrl+J (Hỏi UNI) và Ctrl+K (Tìm kiếm) trùng với Word.** Trong Word, Ctrl+J là căn đều và Ctrl+K là chèn liên kết. Ngoài khung Office thì không sao, nhưng trong khung tài liệu phím này không bao giờ tới được host, nên người dùng bấm mà không có gì xảy ra (global-01, global-02, global-17).
6. **Phím phóng to/thu nhỏ không thống nhất.** Giao diện desktop dùng Ctrl+Alt+= / - / 0 để đổi cỡ giao diện, đúng chord mà Excel dùng để zoom; trong khi Ctrl++ / Ctrl+- / Ctrl+0 lại khác nhau giữa các module và giữa web với desktop (shell-03, common-16..18).
7. **Ctrl+Shift+H "Về Trang chủ" đụng Word (Ẩn văn bản) và Excel Mac (Thay thế)**; Ctrl+Alt+M của hộp thoại Đoạn văn đụng Word "Chèn chú thích" và dễ nhầm với AltGr (shell-01, shell-12).
8. **DevTools, tải lại, toàn màn hình không nhất quán.** Slides luôn có DevTools, Docs chỉ khi isDev, Sheets chỉ khi chưa đóng gói; F11 toàn màn hình không bắt được trong PDF; Trang chủ dùng Ctrl+P để tìm kiếm thay vì in (common-20..22, pdf-19, shell-16).
9. **Esc / Enter trong hộp thoại thiếu bảo vệ gõ tiếng Việt.** Hầu hết hộp thoại PDF, Esc ở Trang chủ, SettingsModal và Onboarding không kiểm tra `isComposing`, nên Enter chốt chữ Telex/VNI/Unikey có thể bấm nhầm nút "Xác nhận" (pdf-dialog-keys, shell-dialog-keys, common-dialog-keys; chi tiết ở mục 6).
10. **PDF thiếu các phím của Edge PDF**: Ctrl+G / Ctrl+Shift+G tìm tiếp, Ctrl+\ vừa trang/vừa chiều rộng, Ctrl+[ và Ctrl+] xoay, Ctrl+Shift+U đọc to, mục lục và hai trang. Ngoài ra UniNote chưa có Ctrl+S nên phím này rơi xuống trình duyệt ("Lưu trang") (pdf-06, pdf-11, pdf-12, pdf-20, global-19).

## 3. Open questions

1. PowerPoint Windows ghi Ctrl+F1 cho cả "toàn màn hình" lẫn "thu gọn ribbon", và "đóng bản trình chiếu" là Ctrl+D (confidence low). Cần xác minh trên máy thật trước khi chép (common-10, common-20).
2. Word Mac đóng bằng Cmd+F4 còn Excel/PowerPoint dùng Cmd+W; chọn phím nào cho Docs trên macOS?
3. Mức chặn được của F12 / F6 / F1 / F5 trong từng trình duyệt: trang có `preventDefault` được không, và có bị trình duyệt xử lý tiếp không (chưa kiểm chứng).
4. Các phím thay thế `ALT-PROPOSED` (Alt+Shift+N, W, J, Q) chưa được kiểm thử. Trên các trang MS đã đọc, chữ Alt+Shift còn trống là G J Q U W Y Z; Alt+Shift trên Windows còn là phím đổi ngôn ngữ nhập, cần thử với bộ gõ tiếng Việt.
5. Firefox, Safari và Edge: khả năng chặn phím chưa xác minh; trang Firefox support trả về "Client Challenge" nên không đọc được.
6. Khi cài làm PWA (chế độ Apps) trình duyệt không giữ phím nào theo chú thích trong mã Chromium; chưa thử trên thực tế.
7. Danh sách phím dành riêng trên nhánh main của Chromium chưa đọc được (chỉ đọc bản ghim 20e8909e); có thể đã đổi.
8. UniChat desktop dùng menu mặc định của Electron: có muốn thêm menu/phím tắt riêng không (shell-19)?
9. Excel Windows không có tài liệu cho "Tạo mới" và "In" trong các trang đã phân tích (common-01, common-06); lấy từ trang nào?
10. Vai trò `selectAll`/`copy`/`paste` của Electron có chạy trước khi trang nhận keydown hay không (ảnh hưởng đến việc chặn Ctrl+A trong khung).
11. Ctrl+Alt+= / - / 0 (cỡ giao diện) có nên đổi chord để không trùng Excel zoom và AltGr không.

## 4. Source rows NOT turned into rows (with reasons)

75 of the 187 source rows in my four groups are not cited by their exact `file:line`; their actions are aggregated into another row. None was dropped silently:

- **S1 / S2 territory** — uninote and page-editor rows, and Docs/Sheets/Slides/HTML/Markdown rows that are not common actions: belong to `S1-text-editors` and `S2-sheets-slides`.
- **Per-module File-menu rows (B-1..B-69)** — the same New/Open/Save/Print/Close accelerators repeated per module; aggregated into common-03..common-07.
- **Electron role rows (D-273..D-289)** — default role accelerators (undo, redo, cut, copy, paste, selectAll, minimize, hide, quit, zoom, reload, DevTools, fullscreen); aggregated into common-04/08/16..22 and shell-04/06/13/14.
- **Per-dialog PDF rows (A-402..A-418)** — one Enter/Esc/Tab handler per dialog, identical contract; collapsed into `pdf-dialog-keys`.
- **Home screen Esc / Enter rows (B-76..B-81)** — collapsed into `shell-dialog-keys`.
- **A-113 (AI web dialog Esc)** — same dialog class as `common-dialog-keys`.
- **Structural rows B-29, B-31, B-83, B-90..B-92** — "no globalShortcut", "no key forwarding", host protocol and platform host: facts, not shortcuts; folded into global-17 and the notes of other rows.
- **D-291 (pdf.js viewer)** — bundled viewer is unused and has no viewer keys.
- **B-141** — folded into global-23.
- **B-86** — noted in common-06 (Print).

## 5. Browser-reserved keys

Method: first claim of each kind comes from a primary page I fetched; anything without one is labelled **unverified, test in stage 2**.

### 5a. Keys a page can NOT intercept (the browser keeps them)

Source: Chromium `chrome/browser/ui/browser_command_controller.cc` at pinned revision 20e8909e (`IsReservedCommandOrKey` lists IDC_CLOSE_TAB, IDC_CLOSE_WINDOW, IDC_NEW_INCOGNITO_WINDOW, IDC_NEW_TAB, IDC_NEW_WINDOW, IDC_RESTORE_TAB, IDC_SELECT_NEXT_TAB, IDC_SELECT_PREVIOUS_TAB, IDC_EXIT):
https://chromium.googlesource.com/chromium/src.git/+/20e8909e694cab857da21d8fe9d5f1da170eaae2/chrome/browser/ui/browser_command_controller.cc

The key bindings behind those commands, from `chrome_dll.rc` (rev dc26192):
https://chromium.googlesource.com/chromium/src/+/dc26192a317d9511ce983fd4b26b1130fe25761a/chrome/app/chrome_dll.rc

| Keys (Windows/Linux) | Command | Source |
| --- | --- | --- |
| Ctrl+W, Ctrl+F4 | close tab | both URLs above |
| Ctrl+Shift+W | close window | both URLs above |
| Ctrl+N | new window | both URLs above |
| Ctrl+Shift+N | new incognito window | both URLs above |
| Ctrl+T | new tab | both URLs above |
| Ctrl+Shift+T | restore tab | both URLs above |
| Ctrl+Tab, Ctrl+PgDn | next tab | both URLs above |
| Ctrl+Shift+Tab, Ctrl+PgUp | previous tab | both URLs above |
| Exit (Alt+F4 / Cmd+Q) | quit | `IsReservedCommandOrKey` list |

Cross-checks:
- Chrome's own shortcut page lists the same tab and window keys, including the macOS Cmd equivalents: https://support.google.com/chrome/answer/157179
- Keyboard Lock draft: Escape, Alt+Tab, Cmd+` and Ctrl+N are captured by the browser/OS by default, and `navigator.keyboard.lock()` can request some of them in fullscreen: https://wicg.github.io/keyboard-lock/ ; MDN says `Keyboard.lock()` is secure-context only, limited availability and experimental: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock
- The Chromium source comments (main) say that in fullscreen only IDC_FULLSCREEN and IDC_EXIT stay reserved, and that in Apps mode no keys are reserved: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/browser_command_controller.cc . The content of the reserved list on `main` is **unverified, test in stage 2** (the function moved; only the pinned older revision was read).
- macOS Cmd+N / Cmd+T / Cmd+W / Cmd+Shift+T / Cmd+Shift+W / Cmd+Shift+N / Cmd+Q: Chrome page above lists them as the Mac keys of the same commands; that they are non-interceptable is inferred, **unverified, test in stage 2**.
- Safari (https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac) and Edge (https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge) list the same family of keys but say nothing about interception. Firefox: **unverified, test in stage 2** (support page blocked).

The desktop app (Electron) is not subject to this list; the rule applies to the web build, and to the shell only where Electron menu accelerators are absent. Impact: common-01 (New), common-07 (Close), global-15 (Ctrl+N alias in pickers, unreachable in browsers).

### 5b. Keys a page CAN intercept, but the browser may still act

These are not in the reserved list above, so `keydown` + `preventDefault` reaches them. Whether a given browser then still acts (for example opens a dialog before the page runs) is **unverified, test in stage 2** unless a line says otherwise.

| Keys | Browser meaning (Chrome page, https://support.google.com/chrome/answer/157179) | Our use |
| --- | --- | --- |
| Ctrl+S | Save page | Save (all editors); UniNote has none (global-19) |
| Ctrl+P | Print | Host Ctrl+P on window, Home search (common-06, shell-16) |
| Ctrl+F, F3, Ctrl+G, Ctrl+Shift+G | Find / find next | pdf-05, pdf-06, global-04 |
| Ctrl+H | History | Excel/Word Replace |
| F12, Ctrl+Shift+I, Ctrl+Shift+J | DevTools | common-21 |
| F5, Ctrl+R, Ctrl+Shift+R, Shift+F5 | Reload | common-22 |
| Ctrl+D | Bookmark | global-12 (mic), shell-11 (Font) |
| Ctrl+O | Open file | common-03 |
| Ctrl+U | View source | Word underline is Ctrl+U |
| Ctrl+L, Alt+D | Address bar | not used |
| Ctrl+K, Ctrl+E | Search from the address bar | global-02, global-12 |
| Ctrl+J | Downloads | global-01 |
| F1 | Help | not used (common-13) |
| F6 | Move focus to address bar / panes | not used (common-09) |
| Ctrl++, Ctrl+-, Ctrl+0 | Browser zoom | common-16..18 |
| Ctrl+Shift+O | Bookmark manager | global-05 |

Chromium's reserved list does not include any of these, which is why they can be intercepted. The real behaviour of F12 / F5 / F6 / F1 is **unverified, test in stage 2** (Chrome may handle them before or after the page).
MDN references for the contract (preventDefault, event.key / event.code):
https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault ; https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key ; https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code ; https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API

Our own guard (`isReservedShortcut`, `packages/core/shortcuts/`): already refuses Ctrl+Shift+T / N / W (global-09). It does **not** refuse Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp, Ctrl+PgDn, nor Ctrl+F4 on Windows/Linux; those can still be recorded as a custom binding that never fires.

## 6. macOS system keys that collide

Source for every row: https://support.apple.com/en-us/102650 (Mac keyboard shortcuts). Parsed copy: `raw/apple-html/mac-keyboard-shortcuts-102650.html`.

| macOS key | System meaning | Collides with |
| --- | --- | --- |
| Cmd+Space | Spotlight | not used by us, but blocks any Cmd+Space chord |
| Ctrl+Space | Select the previous input source | Sheets/Excel "select column" Ctrl+Space; also the way Vietnamese users switch input source |
| Cmd+Tab | Switch app | Not interceptable; no chord possible |
| Cmd+` | Switch window of the app | Sheets "show formulas" (Cmd+`) |
| Cmd+Shift+3 / 4 / 5 | Screenshots | Sheets number formats that accept Cmd+Shift+digit |
| Cmd+Option+D | Show / hide Dock | Alt+Cmd chords using D |
| Ctrl+Up / Ctrl+Down / Ctrl+Left / Ctrl+Right | Mission Control, app windows, spaces | Documents tree moves a node with Ctrl+Arrow (global-20) |
| Cmd+H, Cmd+M, Cmd+Q | Hide, minimize, quit | shell-13/14 roles; common-08 |
| Ctrl+Cmd+F | Enter full screen | common-20 |
| Shift+Cmd+H | Finder Home | Our "Back to Home" Ctrl+Shift+H uses Cmd+Shift+H on Mac (shell-01) |
| Fn+F11 / F11 | Show desktop | Sheets Shift+F11 (insert sheet), PDF full screen F11 |

None of these collisions was tested on a Mac; the table states what Apple documents, not what the app does.

## 7. Vietnamese input (Telex / VNI / Unikey) and AltGr

Principle (sources: https://w3c.github.io/uievents/ §7.3.1, https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing): during composition, `keydown` may report `isComposing === true` and `keyCode` 229, and Enter / Escape / Space can be consumed by the IME to commit or cancel. On Windows, Ctrl+Alt can be reported as AltGraph, so Ctrl+Alt+<letter> chords are typed characters on some layouts. A handler is "guarded" when it reads `isComposing` (or `keyCode === 229`) and, for chords with Ctrl+Alt, `!altKey` or `AltGraph`.

Totals from the raw rows: A (fork modules) has 260 of 526 rows with `ime_safe=no`; B (shell host web) has 13 of 143. Unikey, Telex and VNI specifics, and the Alt+Shift language switch, are **unverified, test in stage 2**.

**Handlers without an `isComposing` guard (these can fire while the user is composing):**
- All PDF Enter / Esc dialogs and the key navigation in `App.tsx` (pdf-dialog-keys, pdf-13..16, pdf-23).
- `frame-dialog.ts:311`.
- Home screen Esc handlers (6 places, shell-dialog-keys).
- `SettingsModal.tsx:1936`, `Onboarding.tsx:117`.
- `pdf-password.ts:72` and `:95`.
- uniai-pwa (shell-18), email-hub (global-13), comment composer (global-21), `use-zoom-canvas`.

**Handlers without a `!altKey` / AltGraph guard (these can steal AltGr characters):**
- PDF `App.tsx` at the 6349-6368 block and line 8834, and `NoteMargin:212`.
- Interface scale Ctrl+Alt+= / - / 0 (`ui-scale-menu.ts:41-52`, shell-03).
- Docs Ctrl+= and Ctrl+Alt+M (shell-12).
- Home Ctrl+F and Ctrl+P (shell-16).
- Host Ctrl+P at `office-module-frame.tsx:265-281` (common-06): no composition check, ignores Shift.
- Sidebar Ctrl+B (global-11) and meeting Ctrl+D / Ctrl+E (global-12).

**Guarded correctly (copy these patterns):**
- `escape-forwarder.ts`.
- `AiAskPopover:136`, `NotesPane:189`, `PdfServerComments:339`.
- Home Enter inputs.
- The global registry (`global-shortcuts.tsx`): ignores `defaultPrevented`, `repeat`, `isImeComposing`, drops AltGraph and matches `event.key` (global-10).

Stage 2 test: on a Windows VM with Unikey in Telex and VNI mode, type "uw", "ow", "dd" followed by Enter / Esc in each dialog above, and press AltGr-layout characters through the Ctrl+Alt chords.

## 8. Files read and fetched

Read (under `raw/`): `S3.md`, `SYNTH-COMMON.md`, `COMMON.md`, `A-fork-modules.csv` (+ `.out.md`), `B-shell-host-web.csv` (+ `.out.md`), `D-lib-defaults.csv`, `_univer.rows.csv`, `_others.rows.csv`, `C2-ms-lookup.csv`, `C2-ms-raw.csv`, `apple-html/mac-keyboard-shortcuts-102650.html`, `lib-src/electron-src`.
Fetched: the Chrome, Edge, Safari, Apple, MDN, WICG, UI Events and Chromium URLs cited in sections 5-7. Firefox support page: blocked (Client Challenge), not used.
Nothing outside `reports/shortcuts_local/raw/synth/` was written and no commit was made.
