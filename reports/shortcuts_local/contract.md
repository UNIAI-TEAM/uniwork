# UNI-2011 SHORTCUT-PARITY — hợp đồng phím tắt (giai đoạn 1: kiểm kê + hợp đồng)

> **Trạng thái:** in-progress — bản nháp chờ reviewer xác minh (review ở `raw/review/review.md`) rồi chờ người dùng duyệt. Chưa có dòng code sản phẩm nào được viết, chưa có commit.

Lane `lead-shortcuts_local` (Run con `run_951402226787`), issue UNI-2011. Yêu cầu của người dùng (2026-10-20): *phím tắt trong tài liệu và app khác nhiều so với các app văn phòng như MS Office; muốn căn chỉnh để trải nghiệm liền mạch, người dùng không phải học lại.*

Tệp đi kèm: `shortcuts.csv` (486 hàng, một hàng cho mỗi hành động theo từng nhóm module, đọc bằng máy). Dữ liệu thô nằm ở `raw/` (kiểm kê từng handler, bảng MS dựng từ HTML gốc, mặc định của thư viện). Mọi mục dưới đây trỏ về hàng trong `shortcuts.csv` bằng cột `id`.

## 1. Tóm tắt

1. **Hiện không có "một bảng phím" ở đâu cả.** Mỗi module tự gắn phím ở 3–6 chỗ: menu Electron (accelerator), listener `keydown` trên window, keymap của TipTap/Univer/CodeMirror, và chuỗi gợi ý (tooltip, hộp thoại phím tắt) viết tay riêng. Docs có `shortcuts.ts` nhưng chỉ là danh sách hiển thị, không phải nguồn của handler. Hệ quả: cùng một phím bị đăng ký hai lần, menu và renderer lệch nhau, gợi ý nói một đằng, phím làm một nẻo.
2. **Phần lớn phím cơ bản đã khớp Office** (Ctrl+B/I/U, Ctrl+Z, Ctrl+C/V/X, Ctrl+F, Ctrl+P, Ctrl+S…). Chỗ lệch tập trung vào: Lưu thành, Redo, chèn liên kết, căn lề, danh sách, bình luận, hàng/cột và điều hướng trong Sheets, nhân đôi và di chuyển slide, phím Mac, và các phím toàn cục của UniWork (Ctrl+K, Ctrl+J).
3. **Có vài lỗi nhìn thấy ngay**, không chỉ là "khác thói quen": Slides `Ctrl+Shift+D` nhân đôi *hình* thay vì *slide* (`slides-15`); Sheets trên Mac ẩn/hiện hàng và cột ngược Excel (`sheets-22`, `sheets-23`) và `Cmd+;` chèn ngày thay vì giờ (`sheets-76`, `sheets-77`); docs trên web: `Ctrl+Shift+S` (Lưu thành) không bao giờ chạy vì handler so `e.key==='s'` (có Shift thì là `'S'`); UniNote không có `Ctrl+S` nên trình duyệt mở hộp "Lưu trang" (`global-19`).
4. **Giới hạn cứng của web**: `Ctrl+N`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+Shift+N`, `Ctrl+Tab`, `Ctrl+PgUp/PgDn` thuộc về trình duyệt (nguồn Chromium ở §6.1). Desktop (Electron) không bị giới hạn này.
5. **Đề xuất cốt lõi**: desktop theo MS đúng từng chữ (cột Windows trên Windows, cột Mac của MS trên macOS — không chỉ đổi Ctrl thành Cmd); web theo MS trừ các phím trình duyệt giữ, và những phím đó có phím thay thế hiển thị trong menu và tooltip; trong editor đang focus, phím MS thắng phím toàn cục của UniWork.
6. **Triển khai** theo 10 lát cắt song song có chủ file rõ ràng (§8), mỗi repo một bảng phím làm nguồn sự thật, có test khoá bảng đó với dữ liệu MS đã chụp.

Độ tin cậy: xem §2. Điểm cần người dùng quyết định: §9.

## 2. Phạm vi, phương pháp và độ tin cậy

**Phạm vi kiểm kê** (đã đọc code, không chạy app):

| Nơi | Commit | Nội dung |
| --- | --- | --- |
| Fork `UNIAI-TEAM/uniwork-office` | `d999b8801` (main) | sáu renderer: docs (DOCX), sheets (XLSX), slides (PPTX), pdf, html, markdown; `apps/shell` (menu, accelerator, `before-input-event`); `packages/ui`, `packages/i18n`, `packages/electron-utils`; cầu nối khung web (`web/…`) |
| D `UNIAI-TEAM/uniwork` | `e7be35f41` | khung Office (`apps/web/platform/office-frame`, `packages/views/office/frame`), trang tài liệu và UniNote (TipTap), phím toàn cục (`packages/core/shortcuts`, `packages/views/layout/global-shortcuts.tsx`, sidebar, họp, email) |
| Thư viện | phiên bản ghim của fork | Univer 0.25.1, TipTap 3.31.0, ProseMirror, CodeMirror, Electron 43.7.6 (đọc từ mã nguồn thẻ/tarball, không cài workspace) |

**Tham chiếu Microsoft** (chụp 2026-10-20, HTML gốc lưu ở `raw/ms-html/`, phân tích bằng `raw/parse_ms.py`): bài hỗ trợ Word, Excel, PowerPoint (Windows và tab macOS của cùng bài), trang Office for Mac chung, trang Edge (Chromium) cho PDF. Lần đầu dùng WebFetch (do mô hình tóm tắt, không dùng được), nên đã làm lại từ HTML thô: 1.718 hàng, bảng tra `raw/C2-ms-lookup.csv` (165 hàng, mỗi giá trị chép nguyên văn). Một phím **không có trên trang Microsoft nào** được ghi `not documented`, không điền từ trí nhớ.

**Những điều cần biết khi đọc `shortcuts.csv`:**

- `status = same` nghĩa là *phím chính của MS có đường đi trong code trên bề mặt đó và không va chạm* (phím phụ của MS chưa gắn chỉ ghi ở `notes`), không có nghĩa là đã bấm và quan sát. Trên web, hành động mà phím MS là phím trình duyệt giữ (Ctrl+W…) ghi `conflict`. Hàng chỉ có ở UniWork (không có đối ứng MS) cũng ghi `same`/`KEEP`; hàng MS không in phím cũng vậy (ghi chú trong cột `notes`).
- Mọi hàng `ALT-PROPOSED` là **phím đề xuất chưa kiểm thử trên trình duyệt** (26 hàng).
- Tham chiếu MS có vài chỗ chính Microsoft in chưa nhất quán (liệt kê ở §10). Hợp đồng chép đúng trang in, đánh dấu `medium`/`low`.
- Reviewer độc lập kiểm tra: toàn bộ `evidence` có thật; mọi khoá MS có trong HTML nguồn; các hàng conflict/high của nhóm common–shell–global đọc tay. Kết quả: `raw/review/review.md` (§11 ghi vào nhận xét cuối).

Tổng quan trạng thái (486 hàng):

| Nhóm | Hàng | same | different | missing | conflict | khác nhau giữa web/desktop |
| --- | --: | --: | --: | --: | --: | --: |
| common (file, trợ giúp, F6, zoom, DevTools) | 23 | 5 | 1 | 4 | 3 | 10 |
| docs (Word) | 103 | 61 | 8 | 16 | 6 | 12 |
| sheets (Excel) | 98 | 60 | 15 | 14 | 5 | 4 |
| slides (PowerPoint) | 78 | 38 | 14 | 22 | 4 | 0 |
| pdf | 27 | 11 | 8 | 5 | 1 | 2 |
| html | 28 | 21 | 0 | 1 | 4 | 2 |
| markdown | 40 | 26 | 1 | 2 | 9 | 2 |
| uninote | 45 | 26 | 2 | 9 | 8 | 0 |
| shell | 21 | 12 | 2 | 1 | 5 | 1 |
| global | 23 | 12 | 0 | 2 | 9 | 0 |
| **Tổng** | **486** | **272** | **51** | **76** | **54** | **33** |

## 3. Nguyên tắc căn chỉnh (quy tắc áp cho mọi lát cắt)

1. **Desktop = MS đúng.** Trên Windows dùng cột Windows của MS; trên macOS dùng cột *Mac của MS* (nhiều phím không phải "Cmd thay Ctrl": ví dụ chèn bình luận Word là `Ctrl+Alt+M` trên Windows và `Cmd+Option+A` trên Mac; PowerPoint slide mới là `Ctrl+M` / `Cmd+Shift+N`; Excel ẩn hàng Mac là `Cmd+(`). Nếu trang MS không in phím Mac, giữ phím Mac hiện tại và ghi `not documented`.
2. **Web = MS, trừ phím trình duyệt giữ.** Với phím trình duyệt không cho trang chặn (§6.1), web giữ phím trình duyệt, và có phím thay thế `ALT-PROPOSED` hiện trong menu và tooltip (kèm chú thích "trên desktop: Ctrl+N"). Phím thay thế phải kiểm thử trên Chrome/Edge/Safari/Firefox ở giai đoạn 2 trước khi gắn.
3. **Trong editor, phím MS thắng phím toàn cục UniWork** khi focus nằm trong khung/editor; chức năng toàn cục vẫn dùng được bằng nút và ở mọi nơi ngoài editor. Trong khung iframe thì điều này đã đúng sẵn vì phím toàn cục không bao giờ tới (§6.2); trong UniNote (cùng document với shell) phải làm tường minh.
4. **Phím cũ không va chạm với MS có thể giữ làm phím phụ** (ví dụ `Ctrl+Shift+Z` redo, MS Excel Mac cũng liệt kê). Phím cũ **va chạm** (nghĩa khác trong MS) thì bỏ khỏi phím chính, theo "không lớp tương thích" của CLAUDE.md. Quyết định D2 ở §9.
5. **Một nguồn sự thật mỗi repo** (§8.1): handler, accelerator của menu và chuỗi gợi ý sinh ra từ cùng bảng; test khoá bảng.
6. **IME/Telex/VNI**: mọi handler mới phải bỏ qua khi `event.isComposing` hoặc `keyCode === 229`; Enter/Esc/Space trong hộp thoại không được kích hoạt khi đang gõ dấu.
7. **AltGr**: chord có Ctrl+Alt trên Windows là AltGr ở nhiều bố cục; handler loại `getModifierState('AltGraph')` (mẫu đã có ở `packages/core/shortcuts/definitions.ts:139`). Phím MS dùng Ctrl+Alt (Heading 1–3, bình luận, chú thích cuối trang) phải đi qua guard này.
8. **Khả năng tiếp cận giữ nguyên**: không chặn phím của trình đọc màn hình (NVDA/VoiceOver; danh sách cụ thể kiểm tay ở giai đoạn 2); không chặn Tab/Shift+Tab trong điều khiển; giữ hợp đồng a11y hiện có (`aria-disabled`, focus-visible…). `F6`/`Shift+F6` chuyển vùng như Office là ứng viên (§6.5).
9. **Phím theo `event.code` hay `event.key`**: chord chữ cái dùng `event.key` (phím thể hiện đúng ký tự theo bố cục, không bị Caps Lock phá — nhớ so sánh không phân biệt hoa/thường); chord dấu/số theo vị trí phím dùng `event.code`. Quy ước này ghi vào bảng phím, mỗi chord khai báo rõ.

## 4. Hiện trạng: phím được định nghĩa ở đâu

| Bề mặt | Một chỗ duy nhất? | Ở đâu |
| --- | --- | --- |
| docs | Chỉ danh sách hiển thị | menu `docs-main.ts`; một `keydown` window `renderer/App.tsx`; keymap TipTap trong `editor/extensions.ts`, `marks.ts`…; plugin ProseMirror; ribbon; `packages/ui/src/ribbon-collapse.tsx`. Danh sách `renderer/shortcuts.ts` nuôi `ShortcutsDialog` |
| sheets | Không | `global-shortcuts.ts` (bảng, nối từ `ExcelShell.tsx`), `registerShortcut` của Univer (`excel-shortcuts.ts`…), bộ chặn Delete/Backspace, menu `sheets-main.ts` |
| slides | Không | một `handleGlobalKeydown` trong `keyboard-actions.ts`, `show-keys.ts`, menu `slides-main.ts`; phím điều hướng chép ở 4 nơi |
| pdf | Không | một `keydown` window trong `App.tsx` + `keyNav.ts`; menu do shell dựng. pdf.js không cung cấp phím nào (không dùng viewer) |
| html / markdown | Không | `keydown` window, `inspector.js` (postMessage), CodeMirror `cm-setup.ts` / `PlainTextEditor.tsx`, TipTap StarterKit (markdown), menu do shell dựng |
| shell (Electron) | Không — 5 chỗ | menu Home/PDF/Markdown/HTML trong `apps/shell/src/main/index.ts`; Docs/Sheets/Slides trong `*-main.ts`; chung `packages/electron-utils/src/app-menu.ts`; `before-input-event` duy nhất cho Ctrl/Cmd+W ở `tab-manager.ts` |
| Khung Office (D) | Có, một handler | `packages/views/office/frame/office-module-frame.tsx` — chỉ `Ctrl/Cmd+P`; giao thức host↔frame **không có thông điệp phím** (chỉ `close_requested{reason:'escape'}` từ frame lên) |
| UniNote (D) | Không — 3 lớp | StarterKit/TipTap, `list-item.ts` + `page-task-item.ts`, `title-editor.tsx`; gợi ý ở `page-toolbar-model.ts` + `page-help-popover.tsx` (dùng chord từ `@uniwork/core/shortcuts`) |
| Toàn cục (D) | Phần lớn có | registry `packages/core/shortcuts/definitions.ts` + listener `global-shortcuts.tsx`; ngoài registry: `sidebar.tsx` (Ctrl/Cmd+B), chat Ctrl+F, họp Ctrl+D/E, email hub |

Phát hiện cấu trúc đáng kể:

- Menu accelerator **thắng** handler của renderer trên desktop: mọi phím rời khỏi menu phải đổi ở menu trước.
- Phím chỉ có trong menu (Ctrl+N, Ctrl+W, Ctrl+/, zoom…) **không tồn tại trong khung web**.
- Trong khung web, chỉ Esc được chuyển từ frame lên host. Ctrl+P do chính frame (docs, html) và host (các module khác) bắt.
- Redo `Ctrl+Y` chỉ chạy qua TipTap (docs), còn menu của docs/sheets/slides chỉ hiện `Ctrl+Shift+Z` — sửa gợi ý là đủ ở docs.
- `Slides` luôn hiện Developer Tools, kể cả bản đóng gói (docs chỉ khi `isDev`, sheets chỉ khi chưa đóng gói).
- Một vài handler "chết": `Ctrl+Shift+S` ở docs web (so `key==='s'`), Save As ở PDF bị `Ctrl+Shift+S` coi là Lưu, `Ctrl+Shift+D` ở slides.

## 5. Khoảng cách theo module (rút từ `shortcuts.csv`)

Mười khoảng trống dễ thấy nhất của từng nhóm nằm trong `raw/synth/S1-text-editors.md`, `S2-sheets-slides.md`, `S3-shell-global-pdf.md` (mục 2 của từng tệp, tiếng Việt). Bản rút gọn:

**Chung (file, trợ giúp, vùng, zoom)**
- Lưu thành: Word/Excel `F12`, PowerPoint `Ctrl+Shift+S`; ta dùng `Ctrl+Shift+S` ở mọi nơi (trong Word, `Ctrl+Shift+S` lại là Apply Styles). Không có `F12` nào (`common-05`).
- `F6`/`Shift+F6` (chuyển vùng) và `F1` chưa có ở module nào (`common-09`, `common-13`); `Ctrl+/` chỉ trong menu Docs (`common-14`).
- Redo `Ctrl+Y`: menu shell chỉ có `Ctrl+Shift+Z` (`shell-05`, `pdf-04`).
- Zoom: giao diện desktop dùng `Ctrl+Alt+= / - / 0` (đúng chord Excel dùng cho zoom, và Ctrl+Alt là AltGr trên Windows) trong khi `Ctrl+= / - / 0` khác nhau giữa module và giữa web/desktop (`shell-03`, `common-16`…`common-18`).

**docs (Word)** — `docs-*`: Ctrl+Alt+M mở hộp Paragraph (Word: chèn bình luận; bình luận của ta là Ctrl+Alt+A); Ctrl+Shift+N = cửa sổ mới (Word: Normal style); danh sách gạch đầu dòng `Ctrl+Shift+8` (Word: `Ctrl+Shift+L`); subscript `Ctrl+,` (trang MS in `Ctrl+Shift+Minus`); thiếu double underline, All caps, Small caps, `F4` lặp lại, `Shift+F4`, `Ctrl+Alt+I`. Mac: indent `Control+M` (MS `Control+Shift+M`), `Control+Space` đụng phím chuyển bộ gõ của macOS.

**sheets (Excel)** — Univer **không gắn** Home/End/PgUp/PgDn/Ctrl+Home/Ctrl+Space/Shift+Space; thiếu `Ctrl+Shift+Home/End`, `F6/F7/F8`, `Shift+F10`, `Ctrl+Shift+*`, `Ctrl+'`; `Ctrl+0` là reset zoom (Excel: ẩn cột); Save As là `Ctrl+Shift+S` (Excel: F12); Mac: ẩn/hiện hàng-cột ngược, giờ/ngày đảo, `Cmd+Home/End` thay vì `Ctrl+Home/End`, `Cmd+Shift+L` đang là bộ lọc (Excel Mac: Modify Cell Style).

**slides (PowerPoint)** — `Ctrl+K` mở Ask AI (PowerPoint: hyperlink; chưa có phím chèn link) (`slides-59`); `Ctrl+Shift+D` nhân đôi hình thay vì slide (`slides-15`); `Ctrl+↑/↓`, `Ctrl+Shift+↑/↓` chuyển slide không chạy (`slides-19`, `slides-20`); mọi chord có Alt bị bỏ qua nên thiếu `Ctrl+Alt+V`, xoay 15°, `Ctrl+Shift+]/[` (`slides-61`, `slides-10`, `slides-43`, `slides-44`); `Ctrl+H` thay thế thiếu; khi trình chiếu thiếu `H`, bút/laser/tẩy, `Alt+F5`.

**pdf** — thiếu các phím của Edge PDF: `Ctrl+\` (vừa trang/chiều rộng), `Ctrl+[` / `Ctrl+]` (xoay) — trang Edge Chromium chỉ in ba phím PDF này (trang Edge cũ in `Ctrl+G` đến trang, `Alt+T` mục lục… nhưng đó là EdgeHTML đã ngừng, không dùng làm chuẩn); `Ctrl+Shift+S` bị coi là Lưu; dialog Enter/Esc không bảo vệ IME.

**html / markdown** — `Ctrl+E` (đổi chế độ nguồn) và `Ctrl+Shift+S` (Save As) nuốt phím inline code/strike của TipTap; `Ctrl+D` nhân đôi block (Word: hộp Font); `Ctrl+K` ở html = Ask AI (Word: hyperlink); trong khung nguồn CodeMirror, `Ctrl+I` là chọn nút cha cú pháp, `Ctrl+/` bật/tắt comment; Ctrl+Shift+Z redo không có ở nguồn markdown trên Windows (chỉ `Ctrl+Y`).

**UniNote (D)** — `Ctrl+K` mở tìm kiếm *kể cả khi con trỏ trong editor*, không chèn link (test hiện tại khẳng định điều đó — đảo quyết định cũ, D2); `Ctrl+E` = inline code (Word: căn giữa); `Ctrl+J` = Ask UNI (Word: căn đều); `Ctrl+Shift+8` bullet (Word `Ctrl+Shift+L`); `Ctrl+Shift+S` = strike (Word: Apply Styles); không có `Ctrl+S` (xem tóm tắt #3); gợi ý trong popover chỉ liệt kê 6 phím.

**Toàn cục / shell** — registry chặn sẵn nhiều phím trình duyệt nhưng không biết gì về khung Office; hộp thoại không có guard IME ở nhiều chỗ (§6.3); `Ctrl+Shift+H` "Về Trang chủ" đụng Word (Hidden text) và Excel Mac (Replace); `Ctrl+B` sidebar chỉ im lặng trong editor vì listener bỏ qua contenteditable, không vì có thiết kế chung.

## 6. Xung đột và giới hạn mà hợp đồng phải trả lời

### 6.1 Phím trình duyệt giữ (web)

Nguồn (đã đọc): Chromium `chrome/browser/ui/browser_command_controller.cc` (`IsReservedCommandOrKey`: đóng tab/cửa sổ, cửa sổ mới/ẩn danh, tab mới, khôi phục tab, tab kế/trước, thoát) và `chrome_dll.rc` cho phím tương ứng; trang Chrome https://support.google.com/chrome/answer/157179 cho phím Mac; WICG Keyboard Lock. Chi tiết và URL: `raw/synth/S3-shell-global-pdf.md` §5.

| Phím trình duyệt giữ (Windows/Linux) | Hành động MS cùng phím | Web đề xuất | Desktop |
| --- | --- | --- | --- |
| `Ctrl+N` | New (Word/PowerPoint) | giữ phím trình duyệt; thay thế `ALT-PROPOSED` (`common-01`) | `Ctrl+N` / `Cmd+N` |
| `Ctrl+W`, `Ctrl+F4` | Close (Word/Excel) | `ALT-PROPOSED` (`common-07`) | `Ctrl+W` / `Cmd+W` |
| `Ctrl+T` | Excel: tạo Table | `ALT-PROPOSED` (`sheets-82`) | `Ctrl+T` |
| `Ctrl+Shift+T`, `Ctrl+Shift+N`, `Ctrl+Shift+W` | (Word: Ctrl+Shift+N = Normal style) | không dùng cho hành động Office trên web | theo MS |
| `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+PgUp/PgDn` | Excel: đổi sheet (PgUp/PgDn); PPT: chuyển pane | web giữ; Excel dùng thay thế đề xuất (`sheets-39`…`sheets-41`) | theo MS |
| Cmd+N/T/W/Shift+T/Shift+W/Shift+N/Q trên macOS | tương ứng | tương tự; cần kiểm thử ở giai đoạn 2 | theo MS Mac |

Phím trang **chặn được** nhưng trình duyệt vẫn có nghĩa (Ctrl+S, Ctrl+P, Ctrl+F, Ctrl+H, F12, F5, Ctrl+D, Ctrl+O, Ctrl+U, F1, F6…): trang gọi `preventDefault`; hành vi thật ở từng trình duyệt **chưa kiểm chứng**, giai đoạn 2 phải thử (Playwright không bấm được phím dành riêng, cần Chrome thật). Các phím thay thế `Alt+Shift+<chữ>` cũng phải thử với bộ gõ tiếng Việt (Alt+Shift có thể là phím đổi ngôn ngữ nhập trên Windows).

### 6.2 Va chạm với phím toàn cục UniWork

Phím toàn cục là listener `document` (pha bubble), bỏ qua sự kiện `defaultPrevented`, `repeat`, đang gõ IME; chỉ `ai.askUni` (Ctrl/Cmd+J) và `openSearch` (Ctrl/Cmd+K) chạy cả trong editor. Trong **iframe** của khung Office, mọi phím toàn cục im lặng vì sự kiện không vượt qua ranh giới document.

| Phím UniWork | Nơi áp dụng | Nghĩa trong Office | Quyết định đề xuất |
| --- | --- | --- | --- |
| `Ctrl/Cmd+K` tìm kiếm | cả app (không trong khung) | hyperlink | trong UniNote: editor focus → chèn link; ngoài editor → tìm kiếm (D2) |
| `Ctrl/Cmd+J` Ask UNI | cả app, cả trong TipTap | căn đều (Word) | editor thắng khi có căn lề; Ask UNI qua nút |
| `Ctrl/Cmd+E` inline code | UniNote | căn giữa | đổi khi thêm căn lề (MS thắng) |
| `Ctrl/Cmd+B` sidebar | ngoài editor | in đậm | giữ (đã im lặng trong editor); khai báo tường minh vào bảng |
| `Ctrl/Cmd+[`, `]` quay lại/tiến | ngoài editable | giảm/tăng cỡ chữ 1pt (Word) | giữ ngoài editor; trong editor MS thắng |
| `Ctrl/Cmd+Enter` gửi | composer task/chat | page break (Word) | giữ ở composer; không ở page editor |
| `Ctrl/Cmd+D`/`E` họp | phòng họp | Font / căn giữa | giữ (bỏ qua ô gõ) |

Hợp đồng không đề xuất thêm thông điệp "forward phím" từ frame lên host ở giai đoạn này (giao thức frame↔host hiện không có), vì phím MS thắng và Ask UNI/tìm kiếm có nút; để mở nếu người dùng muốn (D4).

### 6.3 Gõ tiếng Việt (Telex/VNI/Unikey)

Khi đang ghép dấu, `keydown` mang `isComposing === true` hoặc `keyCode 229`, và Enter/Esc/Space có thể bị IME tiêu thụ để chốt/huỷ. Số liệu từ kiểm kê thô: ở fork, 260/526 hàng `ime_safe=no` (phần lớn là Enter/Esc trong hộp thoại và panel), ở D 13/143. TipTap/ProseMirror đã bỏ qua keydown đang ghép (`prosemirror-view`), nên phím trong editor an toàn; rủi ro nằm ở hộp thoại PDF, Home, Settings, Onboarding, find/comment của docs, và ba listener window (Ctrl+F/P của Home, sidebar Ctrl+B, họp). Mẫu đã đúng để sao chép: `escape-forwarder.ts`, `global-shortcuts.tsx`, `NotesPane`. Quy tắc §3.6, test §8.3. Chưa kiểm thử với Unikey thật (giai đoạn 2: máy ảo Windows + Telex/VNI).

### 6.4 AltGr

Trên Windows, AltGr = Ctrl+Alt: mọi chord Ctrl+Alt+chữ có thể là ký tự được gõ ở bố cục châu Âu. Hiện handler window của docs bắt Ctrl+Alt+M/1–3/A/F… không loại AltGr; PDF không loại Alt; chord cỡ giao diện `Ctrl+Alt+= - 0` của shell cũng thế. Quy tắc §3.7.

### 6.5 Khả năng tiếp cận và F6

Giữ nguyên: không chiếm phím của trình đọc màn hình (NVDA/VoiceOver), Tab/Shift+Tab, `aria-disabled` giữ nút trong thứ tự Tab, `:focus-visible`, vùng chạm ≥ 44px. `F6`/`Shift+F6` như Office (vòng qua ribbon → vùng soạn thảo → thanh trạng thái/pane) đề xuất làm ở lát cắt riêng sau khi bảng phím có (cần xác định các "vùng" mỗi module); giai đoạn này chỉ chuẩn bị chỗ trong bảng (`common-09`). Test a11y bắt buộc: kiểm tay với NVDA (Windows) và VoiceOver (macOS) ở giai đoạn 2 rằng phím mới không chặn phím của trình đọc màn hình; danh sách phím reserved của từng trình đọc chưa được đọc từ nguồn trong giai đoạn này, nên chưa nêu cụ thể.

### 6.6 macOS và Mac OS-key va chạm

Danh sách đầy đủ có nguồn Apple (https://support.apple.com/en-us/102650) ở `raw/synth/S3-shell-global-pdf.md` §6 và `raw/C2-ms-raw.out.md`. Quan trọng nhất: `Control+Space` (Excel chọn cột; Word/PowerPoint xoá định dạng) là phím chuyển bộ gõ của macOS — ảnh hưởng người gõ tiếng Việt; Microsoft đã đánh dấu sao nhiều phím F-key/Control+Shift+Up/Down trùng với Mission Control. Hợp đồng: giữ phím MS nhưng ghi chú trong menu và cung cấp phím phụ khi Microsoft tự liệt kê.

## 7. Khả năng khám phá (discoverability)

- **Menu và tooltip hiện phím theo nền tảng** (Windows `Ctrl`, macOS `⌘`), lấy từ cùng bảng phím với handler. Docs đã có cơ chế `macShortcutsToWin`/`platformShortcuts` (`packages/i18n/src/index.ts`); UniNote có `ShortcutKeycaps` + `createShortcutChord`. Dùng chung một hàm định dạng.
- **Web hiện thêm phím thay thế** cạnh phím MS khi phím MS bị trình duyệt giữ: `Mới — Alt+Shift+N (Ctrl+N trên desktop)`.
- **Hộp thoại phím tắt**: mỗi module một hộp (docs đã có `ShortcutsDialog`; sheets/slides/pdf/html/markdown chưa có), mở bằng `Ctrl+/` (MS Excel Mac in `Cmd+/` cho Help; không có trên trang Windows — chỉ làm khi người dùng đồng ý) và qua menu Trợ giúp. **Tái dùng mẫu của UniNote** (`page-help-popover.tsx` + `page-shortcuts.test.ts`): bảng chord, test bắn từng chord bằng `editor.commands.keyboardShortcut`, chỉ liệt kê phím nếu test chứng minh được. Hiện popover UniNote liệt kê 6 phím trong khi có nhiều hơn (underline, Ctrl+Y, danh sách, heading, code block): sửa trong lát cắt S-uninote.
- Test chống lệch: mỗi hộp thoại/tooltip được sinh từ bảng, test so sánh số phím hiển thị với số chord thật.

## 8. Kế hoạch triển khai (sau khi người dùng duyệt)

### 8.1 Một bảng phím cho mỗi repo

**Fork (`uniwork-office`)**: một gói mới (đề xuất `packages/shortcuts`, tên chốt ở D5) chứa bảng `action id → { win, mac, webAlt?, scope, guard }` và các hàm: (a) sinh accelerator cho menu Electron (`CmdOrCtrl`, thay vì viết tay ở 6 menu), (b) khớp `KeyboardEvent` (xử lý `isComposing`, AltGraph, `key` vs `code`), (c) định dạng gợi ý theo nền tảng. Mỗi module khai báo tập hành động của mình (docs=Word, sheets=Excel, slides=PowerPoint, pdf, html, markdown) và nối handler/menu vào bảng; handler `keydown` window của docs/sheets/slides/pdf/html/markdown thay bằng một bộ khớp chung. Keymap của TipTap/Univer/CodeMirror được sinh/ghi đè từ cùng bảng (Univer: `registerShortcut`; TipTap: `addKeyboardShortcuts`; CodeMirror: `keymap.of`).

**D (`uniwork`)**: mở rộng `packages/core/shortcuts/definitions.ts` (đã có `createShortcutChord`, `isReservedShortcut`, phát hiện AltGraph, gợi ý theo nền tảng) thay vì tạo kho mới; thêm bảng chord của page editor (UniNote) và bảng phím của khung Office host.

**Test khoá bảng (cả hai repo)**: (i) mỗi hàng của bảng bằng dữ liệu MS đã chụp (`shortcuts.csv`/`C2-ms-lookup.csv` là snapshot test đầu vào); (ii) không hai hành động cùng chord trong cùng scope; (iii) không phím trình duyệt giữ ở cột web trừ khi là `webAlt`; (iv) mỗi `evidence`/handler tồn tại.

### 8.2 Lát cắt có thể chạy song song

Mọi lát cắt đọc cùng nguồn sự thật (`shortcuts.csv`), sau lát cắt gốc S-table (bảng + bộ khớp) mỗi lát cắt khác độc lập.

| Lát | Repo | Nội dung | Chủ file (dự kiến) | Phụ thuộc |
| --- | --- | --- | --- | --- |
| S-table | fork | gói bảng phím + bộ khớp + gợi ý + test khoá | gói mới `packages/shortcuts`; `packages/i18n` (định dạng), `packages/electron-utils/src/app-menu.ts` (nối accelerator) | không |
| S-shell | fork | menu Home/PDF/Markdown/HTML, `tab-manager.ts`, `ui-scale-menu.ts`, F12/F6/DevTools nhất quán | `apps/shell/src/main/*` | S-table |
| S-docs | fork | docs: bảng handler, menu `docs-main.ts`, `App.tsx` keydown, Ribbon, `shortcuts.ts` | `apps/docs/src/**` | S-table |
| S-sheets | fork | sheets: thêm điều hướng/chọn còn thiếu, đảo phím Mac, Save As F12, bảng | `apps/sheets/src/**` | S-table |
| S-slides | fork | slides: sửa `Ctrl+Shift+D`, di chuyển slide, chord Alt, phím trình chiếu, Ctrl+K | `apps/slides/src/**` | S-table |
| S-pdf | fork | pdf: phím Edge PDF, Save As, guard IME dialog | `apps/pdf/src/renderer/App.tsx`, `keyNav.ts` | S-table |
| S-html-md | fork | html + markdown: gỡ nuốt phím TipTap, Ctrl+E/Ctrl+D, CodeMirror, Ask AI | `apps/html/src/renderer/App.tsx`, `source/cm-setup.ts`, `apps/markdown/src/renderer/**` | S-table; **tuần tự sau UNI-1993** (§8.4) |
| S-uninote | D | UniNote: Ctrl+K link, Ctrl+S, căn lề, bullet, help popover đầy đủ | `packages/views/documents/page-toolbar/*`, `packages/views/editor/extensions/*` | D2 |
| S-global | D | registry: khai báo phím toàn cục tường minh (sidebar Ctrl+B, guard IME), quy tắc editor thắng | `packages/core/shortcuts/*`, `packages/views/layout/global-shortcuts.tsx` | D2 |
| S-host | D | khung host: Ctrl+P, Save hint, (tuỳ chọn) thông điệp forward phím | `packages/views/office/frame/*`, `packages/core/office/docs-frame-protocol.ts` | D4 |

Các lát cắt fork sau khi merge cần **pin lại khung** vào D (repin web-0.1.0-<sha>) — công việc chuẩn của lane repin, không thuộc lát này.

### 8.3 Test mỗi lát cắt

- **Bảng/bộ khớp (S-table):** unit — khớp chord, loại `isComposing`/229, loại AltGraph, `key` vs `code` (Caps Lock), Mac vs Windows; snapshot test với `C2-ms-lookup.csv`.
- **Mỗi module:** test bắn từng chord (TipTap `keyboardShortcut`, Univer `ShortcutService`, DOM `KeyboardEvent` cho slides/pdf/html/markdown) khẳng định đúng hành động; test "phím cũ va chạm không còn kích hoạt"; test gợi ý (tooltip/menu) hiển thị đúng chuỗi theo nền tảng.
- **Menu Electron:** test dựng menu từ bảng (accelerator bằng bảng; không còn chuỗi viết tay).
- **IME/AltGr:** mỗi dialog Enter/Esc test với `isComposing: true` (không kích hoạt); chord Ctrl+Alt với `getModifierState('AltGraph') === true` (không kích hoạt).
- **E2E (D, Playwright):** khung Office trên web: Ctrl+S/Ctrl+P trong frame; không thể kiểm Ctrl+N/W/T (phím trình duyệt) bằng Playwright — kiểm tay giai đoạn 2 trên Chrome/Edge/Safari/Firefox.
- **Visual (theo quy tắc lane):** screenshot menu/tooltip/hộp phím tắt ở cả hai chế độ sáng/tối.

### 8.4 Chủ file và tránh đụng lane khác

- **g5-fork_main (UNI-1993 UW-SOURCE-RO, apps/html + apps/shell nguồn xem)**: chạm `apps/html/**` và phần source view của `apps/shell`. Lát S-html-md và S-shell chỉ bắt đầu sau khi UNI-1993 vào fork main, hoặc giới hạn ở các tệp không nằm trong danh sách của UNI-1993 và phối hợp qua Advisor. Phần `apps/shell/src/main/index.ts` (menu) và `tab-manager.ts` chưa được UNI-1993 nhắc, nhưng cần xác nhận với lane đó trước khi sửa.
- **Lane chat/docs ở D** (`chat-ui_local`, `docs-ui_local`, `doc-share_local`, `doc-lock_local`…): S-uninote giới hạn ở `packages/views/documents/page-toolbar/*` và `packages/views/editor/extensions/*`; không động `document-editor.tsx` và `document-tree.tsx` (UI của các lane đó). S-global không động `packages/views/chat/*`, `packages/views/meetings/*`.
- **S-table** ở fork là gói mới, không có chủ trước.
- Mỗi lát một worktree/nhánh `feature/UNI-2011-<lát>` (hoặc sub-issue của UNI-2011), PR riêng; commit `Refs: UNI-2011`.

### 8.5 Thứ tự và độ ưu tiên

- **P0 (lỗi/ngược nghĩa nhìn thấy ngay):** slides `Ctrl+Shift+D`; Mac Sheets ẩn/hiện hàng-cột và giờ/ngày; docs web Save As chết; UniNote `Ctrl+S`; Redo hiển thị `Ctrl+Y`; Slides luôn hiện DevTools.
- **P1 (parity lõi):** Save As `F12`, chèn liên kết, căn lề, danh sách `Ctrl+Shift+L`, bình luận, điều hướng/chọn trong Sheets, di chuyển/nhân đôi slide, phím Edge PDF, phím Mac theo trang MS, hộp thoại phím tắt cho mỗi module.
- **P2 (đuôi dài):** `F6` vùng, KeyTips `Alt`/`F10`, công cụ trình chiếu (bút/laser), các hàng `missing` ít dùng.

## 9. Quyết định cần người dùng/Advisor duyệt trước khi code

| Mã | Quyết định | Đề xuất |
| --- | --- | --- |
| D1 | Desktop theo MS đúng, cả cột Mac của MS | Có |
| D2 | Phím cũ không va chạm: giữ làm phím phụ một bản phát hành hay bỏ hẳn; phím cũ va chạm (Ctrl+K của UniNote → link; slides Ctrl+K AI; Ctrl+E; Ctrl+Shift+S…) bỏ khỏi phím chính | giữ phím phụ không va chạm, bỏ phím va chạm |
| D3 | Web: phím thay thế cho Ctrl+N/W/T — chọn mẫu `Alt+Shift+<chữ>` hay mẫu khác (cần kiểm thử Chrome/Edge/Safari/Firefox và Unikey) | kiểm thử trước khi chốt |
| D4 | Có thêm thông điệp frame→host chuyển các phím toàn cục (Ask UNI/tìm kiếm) không | Không ở giai đoạn này |
| D5 | Tên và vị trí gói bảng phím ở fork (`packages/shortcuts`) | chấp thuận |
| D6 | Khi trang MS in giá trị khác Word cổ điển (subscript `Ctrl+Shift+Minus`, non-breaking hyphen `Shift+Alt+Minus`, sao chép/dán định dạng `Ctrl+Alt+C/V`): theo trang MS in hay theo thói quen | theo trang MS in, đánh dấu medium |
| D7 | Word Mac đóng: `Cmd+F4` (bảng Word) hay `Cmd+W` (trang Office Mac chung) | `Cmd+W` |
| D8 | F12 làm Save As trên web (chồng DevTools) | thử trên trình duyệt; nếu hỏng, thay thế |

## 10. Câu hỏi mở và điều chưa kiểm chứng

- Không chạy app: mọi trạng thái là phân tích tĩnh; mọi phím `ALT-PROPOSED` và mọi khẳng định "trình duyệt giữ/không giữ" ngoài danh sách Chromium (Firefox/Safari/Edge, danh sách trên nhánh main, PWA/Apps mode) chưa thử.
- Trang MS có chỗ tự mâu thuẫn: PowerPoint Windows in `Ctrl+D` cho cả "Close" lẫn Duplicate (coi là lỗi in, giữ `Ctrl+W`); Excel Mac "previous sheet" in `Ctrl+Page down` lẫn `Option+Left`; trang Excel Windows không in New/Print/Find/Replace/Go To (Ctrl+G)/Fill Right; không trang nào in `Ctrl+/` (chỉ Excel Mac `Cmd+/`); `Ctrl+Shift+1..6` không phải bộ phím Excel (là ký hiệu `~ $ % ^ # @ !`).
- Univer: nhánh chỉnh sửa ô (mũi tên trong cell editor) quyết định ở controller render chưa đọc hết; cạnh tranh `Mod-B` vs `Mod-Shift-b`, `Mod-Enter` của TipTap phụ thuộc thứ tự extension lúc chạy.
- Sheets: bộ chặn PageUp/PageDown khi đang sửa ô có thể nuốt phím (nghi lỗi, chưa tái hiện).
- Bố cục bàn phím không phải Mỹ (Pháp/Đức/Việt): chord số/ký hiệu khớp `event.code` có thể khác nghĩa.
- Tham chiếu Microsoft Learn chưa tìm.
- Thư viện: dùng mã nguồn thẻ/tarball, không phải bản cài trong fork; phiên bản TipTap của D (lockfile 3.30.6, catalog 3.27.1) chưa đối soát.

## 11. Kết quả reviewer

Reviewer độc lập (worker Sonnet 5.5 high, chỉ đọc), báo cáo đầy đủ ở `raw/review/review.md`, phát hiện ở `raw/review/review.csv`. Phán quyết: **PASS-WITH-FIXES**.

- Cơ học (486 hàng): CSV hợp lệ, id duy nhất; **734/734 mục `evidence` trỏ tới tệp và dòng có thật**; **không có phím MS nào bị bịa** (mọi `ms_win`/`ms_mac` có trên trang Microsoft đã trích, 148 giá trị chỉ ghim ở mức trang chưa ghim dòng).
- Đọc tay 164 hàng (mọi hàng `conflict`, mọi hàng khẳng định handler chết/vắng, 40 hàng high của common/shell/global, 10% ngẫu nhiên seed 2011): 155 đúng, 3 sai, 6 không kiểm chứng được qua dòng trích. 45 hàng phía MS đối chiếu HTML gốc: không đảo Win/Mac. Bốn khẳng định trọng yếu đã xác nhận trong code: slides `Ctrl+Shift+D`, docs Save As `e.key==='s'`, cổng PageUp/PageDown của Sheets, UniNote `Ctrl+K`.
- **Đã sửa trong `shortcuts.csv`** (ghi `REVIEW-FIX` ở cột `notes`): `pdf-19` (dòng trích sai), `docs-103` (nguồn Mac Paste Special), `sheets-82` (Ctrl+L là phím MS, không phải đề xuất), `global-10` (email hub có kiểm `defaultPrevented`), `slides-24` (Alt+F5 hiện bắt đầu trình chiếu từ đầu → `conflict`, không phải "không có"); `pdf-13` bỏ Ctrl+G (nhường Find next, `pdf-06`); 6 đề xuất web vi phạm quy tắc phím trình duyệt giữ (`docs-038/052/053`, `docs-008`/`html-005`/`markdown-005` nay có `Alt+Shift+W`, `sheets-04` nay F12 như `docs-005`, `slides-59` theo mẫu Alt+Shift thay cho Ctrl+Shift+K); thống nhất định nghĩa `status` (§2); gộp 4 trạng thái web/desktop giống nhau.
- **Còn mở** (không phải lỗi bảng, đã nằm ở §9/§10): chọn chữ cụ thể trong mẫu `Alt+Shift+<chữ>` và thử với Unikey; quy tắc AltGr chung cho mọi chord Ctrl+Alt của MS (§3.7 — handler docs hiện không có guard); `isReservedShortcut` của D chưa có Ctrl+Tab/Ctrl+Shift+Tab/Ctrl+PgUp/PgDn/Ctrl+F4 (`global-09`, đưa vào lát S-global); 6 hàng vắng-mặt trích dòng chú thích (đã ghi chú); `sheets-04`/`slides-59`/`global-01..02` chờ chốt D3.

## 12. Phụ lục

- `shortcuts.csv` — 486 hàng, cột: `id,group,action,ms_win,ms_mac,ms_source,web_today,desktop_today,evidence,status,proposal_web,proposal_desktop,slice,ime_altgr,confidence,notes`.
- `raw/A-fork-modules.csv` (526 hàng), `raw/B-shell-host-web.csv` (143), `raw/D-lib-defaults.csv` (292) — kiểm kê từng handler, kèm `.out.md` mô tả.
- `raw/C2-ms-raw.csv` (1.718 hàng MS), `raw/C2-ms-lookup.csv` (165), `raw/ms-html/` (HTML gốc), `raw/parse_ms.py`.
- `raw/synth/S1-text-editors`, `S2-sheets-slides`, `S3-shell-global-pdf` (`.csv` + `.md`) — tổng hợp; `.md` có danh sách hàng nguồn không thành hàng hành động và lý do.
- `raw/review/` — báo cáo reviewer.
- `raw/lib-src/` (~157 MB, không đưa vào commit; gồm thư mục `.git` lồng nhau) — xoá sau khi duyệt.
