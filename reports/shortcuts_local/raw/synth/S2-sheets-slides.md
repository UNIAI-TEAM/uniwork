# S2 — sheets (Excel) + slides (PowerPoint): shortcut parity contract

UNI-2011 stage 1 (contract only, no product code). Companion file: `S2-sheets-slides.csv`
(176 rows, 16 columns exactly as in SYNTH-COMMON; UTF-8, RFC 4180).

Inputs: `A-fork-modules.csv`, `B-shell-host-web.csv`, `D-lib-defaults.csv`, `C2-ms-lookup.csv`, `C2-ms-raw.csv`.
Code read: fork `d999b8801` (read-only checkout), D repo `e7be35f41`. Every `evidence` entry in the CSV was opened by a script
(`verify()`: file exists and the line is inside the file) and the neighbouring lines were read by hand for the rows marked `high`.

## 1. Row counts by status

| group  | rows | same | different | missing | conflict | web:conflict;desktop:same |
| ------ | ---: | ---: | --------: | ------: | -------: | ------------------------: |
| sheets |   98 |   61 |        15 |      14 |        5 |                         3 |
| slides |   78 |   38 |        14 |      23 |        3 |                         0 |
| total  |  176 |   99 |        29 |      37 |        8 |                         3 |

Slice: S-sheets 94, S-slides 75, S-shell 7 (menu / window roles that live in the Electron shell).
Confidence: high 105, medium 55, low 16 (low = the MS cell is itself doubtful, or our behaviour could not be read from source).

How `status` was decided (the SYNTH-COMMON definition leaves room, so this is the convention used in all 176 rows):

- `same` = at least one key that MS lists works on that OS and nothing collides with it. A missing MS alias (for example MS lists
  `Ctrl+2` for Bold as well as `Ctrl+B`) is written in `notes` and does not change the status.
- `different` = we have a key but none of the keys MS lists works on that OS (or MS lists nothing and the action is ours only).
- `conflict` = our key means something other than the MS key, or it collides with a browser / OS chord.
- `missing` = no key at all.
- Ours-only actions get `ms_win` / `ms_mac` = `n/a`, `status = different`, proposal `KEEP`.
- Where the MS page lists nothing (`not documented`) and we have a sensible key, the row is `same`; this is flagged in `notes`.
- Web and desktop share one renderer (`apps/sheets`, `apps/slides`); desktop adds Electron menu accelerators. Web and desktop only
  differ in the rows that carry `web:<s>;desktop:<s>` (browser-reserved chords: Ctrl+T, Ctrl+PageDown/Up).
- Web `ALT-PROPOSED` keys use the pattern `Alt+Shift+<key>` or `Ctrl+Shift+<key>` and are all marked unvalidated. They need to be reconciled
  with S1 (docs) and S3 so one browser-reserved key gets one alternative across modules.

## 2. 10 khoảng trống người dùng dễ thấy nhất (sheets + slides)

1. **Mac: Ẩn / hiện hàng và cột bị ngược so với Excel (`sheets-22`, `sheets-23`).** Trên Mac, Excel dùng `Cmd+(` (tức Cmd+Shift+9) để *ẩn* hàng
   và `Cmd+)` (Cmd+Shift+0) để *ẩn* cột. Bên ta Cmd+Shift+9 và Cmd+Shift+0 lại *hiện* hàng / cột. Người quen Excel bấm vào là làm điều ngược lại.
2. **Mac: ngày và giờ bị đảo (`sheets-76`, `sheets-77`).** Excel Mac: `Cmd+;` chèn *giờ hiện tại*. Bên ta `Cmd+;` chèn *ngày*. Ngoài ra
   `Cmd+Shift+L` ở Excel Mac là "Modify Cell Style" nhưng bên ta bật / tắt bộ lọc (`sheets-81`).
3. **Slides: Ctrl+K mở hộp hỏi AI thay vì chèn liên kết (`slides-59`).** Khi chọn một hình (không đang gõ chữ), Ctrl+K mở popover Ask AI. PowerPoint
   dùng Ctrl+K cho hyperlink. Chưa có phím nào chèn liên kết trong Slides. Đề xuất chuyển AI sang phím khác (ví dụ Ctrl+Shift+K, chưa kiểm tra).
4. **Slides: Ctrl+Shift+D nhân đôi *đối tượng* thay vì nhân đôi *slide* (`slides-15`).** Nhánh nhân đôi đối tượng không loại trừ Shift nên
   phím của PowerPoint cho "Duplicate Slide" bị hiểu nhầm. Đây là lỗi nhìn thấy ngay: bấm phím quen thuộc, slide không được nhân đôi mà hình bị nhân đôi.
5. **Slides: không có phím di chuyển slide (`slides-19`, `slides-20`).** Ctrl+Up / Ctrl+Down (đưa slide lên / xuống) và
   Ctrl+Shift+Up / Down (lên đầu / xuống cuối) không hoạt động, vì nhánh "không chọn đối tượng" yêu cầu không có phím Ctrl.
   Muốn sắp xếp lại slide chỉ còn cách kéo thả.
6. **Slides: thiếu Ctrl+H (Replace), Ctrl+Alt+V (Paste Special), Alt+Mũi tên (xoay 15°), Ctrl+Shift+] / [ (đưa lên / xuống lớp)
   (`slides-61`, `slides-10`, `slides-43`, `slides-44`).** Các bộ xử lý hiện tại đều thoát sớm khi `altKey` bật, nên mọi chord có Alt đều bị bỏ qua.
   Ctrl+H còn là "ẩn con trỏ" trong khi trình chiếu, cần phân biệt theo ngữ cảnh.
7. **Slides: phím trong lúc trình chiếu thiếu nhiều (`slides-31`, `slides-32`, `slides-33`, `slides-34`, `slides-24`).** Chưa có `H`, `Ctrl+H`,
   bút / laser / tẩy (Ctrl+L, Ctrl+P, Ctrl+E…), `Alt+F5` (Presenter View). `Ctrl+S` trong lúc trình chiếu của PowerPoint mở "All Slides" nhưng bên
   ta Ctrl+S vẫn là Lưu (chưa kiểm tra bằng chạy thật). Điều này khiến người thuyết trình quen PowerPoint mất công cụ chính.
8. **Sheets: không chọn mở rộng tới đầu / cuối bảng (`sheets-33`), không có F6, F7, F8, Shift+F10 (`sheets-85`, `sheets-58`, `sheets-59`,
   `sheets-60`).** Ctrl+Shift+Home / End, F6 (đổi vùng), F7 (kiểm tra chính tả), F8 (chế độ mở rộng vùng chọn) và Shift+F10 (menu chuột phải)
   đều chưa có. Cũng chưa có Ctrl+Shift+* (chọn vùng hiện tại, `sheets-27`) và Ctrl+' / Ctrl+Shift+" (chép từ ô phía trên, `sheets-57`).
9. **Mac Sheets: Ctrl+Home / Ctrl+End, Chèn ô và Save As lệch bàn phím Mac của Excel (`sheets-34`, `sheets-35`, `sheets-19`, `sheets-04`).**
   Ta gắn Cmd+Home / Cmd+End, Cmd+Shift+= còn Excel Mac liệt kê Ctrl+Home / Ctrl+End, Ctrl+Shift+=. Ở Windows, Save As trong Excel là `F12`,
   bên ta là Ctrl+Shift+S (F12 chưa được gắn trong Sheets).
10. **Phím bị trình duyệt chiếm trên web (`sheets-82`, `sheets-39`, `sheets-40`, `sheets-41`, `slides-70`, `slides-01`).** Ctrl+T (tạo Table),
    Ctrl+PageDown / PageUp (đổi sheet), Ctrl+Shift+Tab, Ctrl+N (workbook / presentation mới) là phím của trình duyệt nên trên web không thể dựa vào.
    Mỗi dòng giữ phím trình duyệt và có `ALT-PROPOSED`; chưa kiểm tra trên Chrome / Edge / Safari. Bản desktop không bị ảnh hưởng.

Mục 8 gộp các phím điều hướng / chọn của Excel vì cùng một lỗi gốc (chưa đăng ký trong `excel-shortcuts.ts`).

## 3. Open questions / things not verified

- **No browser validation.** Nothing was run. Every `ALT-PROPOSED` key and every claim "the browser keeps Ctrl+X" is from reading code and
  general browser behaviour; each row says "not validated". Needs a Chrome / Edge / Safari pass (Ctrl+T, Ctrl+PageDown, Ctrl+Shift+Tab,
  Ctrl+N, Ctrl+W, F5, F12, Ctrl+L).
- **Alt keys on web and in Univer.** `Alt+Shift+<key>` as web alternative must be reconciled with S1 / S3 so one chord does not mean two things.
- **Windows MS pages leave gaps.** The Excel Windows page does not list New workbook, Print, Find, Replace, Fill Right, Filter, Font size
  steps or a Format Painter chord; those rows are `not documented` for Windows, with the mac key (or the Office convention) shown only where the
  mac page lists it. Nothing was invented.
- **PowerPoint "Close presentation" on the Windows page prints `Ctrl+D`** (the same page uses `Ctrl+D` for Duplicate). Treated as a typo,
  confidence low (`slides-06`). Needs a decision: keep Ctrl+W.
- **Mac MS pages contradict themselves.** Hide row is both `Ctrl+9` and `Cmd+(`; previous sheet lists `Ctrl+Page down` for both next and previous
  (`sheets-40`). Rows quote both and say so.
- **Non-US layouts.** Number-format chords (`Ctrl+Shift+1…6`, `Ctrl+Shift+4` for `$`, `;`, `=`, `+`, `-`) are matched on `event.code`, so they
  behave as on a US layout. Whether a French / German / Vietnamese layout produces the MS meaning was not tested.
- **AltGr (Ctrl+Alt) and IME (Telex / VNI).**
  - Univer's shortcut dispatcher has no `isComposing` check, and about 25 dialog Enter handlers in Sheets lack one (rows
    `sheets-dialog-keys`, `sheets-90`).
  - Slides `TextEditOverlay` handles Esc / Enter / Tab without `isComposing`.
  - Whether a Telex composition commits through Enter is not tested.
  - Ctrl+Alt chords (Paste Special, Zoom) may collide with AltGr on European layouts; not validated.
- **Page-key gate in Sheets.** `global-shortcuts.ts` gates PageUp/PageDown away while a cell is being edited, which swallows those keys
  (likely bug, noted in `sheets-37`); not reproduced.
- **Mac pointer modifiers.** MS Control+drag vs our Option+drag for copy-drag in Slides (`slides-17`) was not tested.
- **Slides show `Ctrl+S`** (capture-phase save, `web-slides-api.ts:858`) is not show-aware; the effect inside a running show was read, not run.
- **Statuses are static analysis.** `same` means the code path exists; it does not mean the key was pressed and observed.
- **Row ids** are `sheets-NN` / `slides-NN`; the dialog class rows are `sheets-dialog-keys` and `slides-dialog-keys`. `slides-77` is intentionally not used
  (the number went to `slides-dialog-keys`), so `slides-78` follows `slides-dialog-keys`.

## 4. Source rows not turned into action rows, and why

- **Ribbon access-key sequences** (Alt+H…, Alt+N…, Alt+A…, Alt+W…, Alt+M, M, D …): hundreds of sequences, none exist because we have no
  ribbon key tips. Collapsed into one row per group: `sheets-84`, `slides-72` (Activate ribbon key tips), and `sheets-50` carries the one
  Define-name sequence that the lookup lists.
- **Excel Power Pivot, Copilot in Excel, macros / VBA, external-data refresh, PivotTable field list, slicers, Data Model, Query Editor:** features we do not have.
  Nothing to map; flagged here rather than as 20 `missing` rows.
- **PowerPoint Rehearse Timings (T / O / M / R), Presenter View table, media playback keys (Alt+P, Alt+Q, Alt+Up/Down, Alt+End …),
  Selection-pane internals, equation insert (Alt+=), SmartArt, Notes pane, Reading view F-keys:** features absent or not mapped to a
  keyboard action. Slides media play / pause is kept (`slides-45`), the rest is not.
- **mac window management and OS keys** (Cmd+H, Cmd+M, Cmd+Q, Cmd+Space, Mission Control, Dictation): OS-owned.
  Desktop `role`-based menu items are in `sheets-97` / `slides-78`.
- **Excel Windows raw rows with no action row** (`C2-ms-raw.csv`, 230 Excel-Windows rows; only the curated `C2-ms-lookup.csv` rows plus the ones
  listed above were turned into rows): Ctrl+Q (Quick Analysis), Ctrl+Shift+G (Workbook Statistics), Ctrl+Alt+F9 (calculate all open workbooks),
  Alt+Shift+F10 (Error Checking menu), Alt+Down (open a button menu / the validation list / the AutoFilter menu). We have no matching feature or
  the key is a dialog / menu-internal key in Excel. These are a coverage gap against the "every MS action" rule: if the lead wants the full raw
  table, a second pass should add one row per remaining raw action (not done here; only these five were spot-checked against the raw file).
- **Lookup row "Number formats Ctrl+Shift+1..6"** was split into the seven symbol rows `sheets-68…74` (General, Number, Time, Date, Currency, Percent, Scientific) so the
  mac table could be quoted without merging.
- **Host registry rows in `B-shell-host-web.csv`** (Ctrl+J Ask UNI, Ctrl+K palette, `C` quick-create, Ctrl+F search, Ctrl+[ / ] navigation,
  Ctrl+/ help): belong to the S-global group. They never see keys typed inside a frame (`office-module-frame.tsx:265-268`), so inside the editor
  our row wins; only mentioned in `notes` (for example `slides-59`).
- **B rows that are not shortcuts** (frame focus hand-back, iframe `allow` policy, protocol messages, desktop device bridge): infrastructure.
- **Hint-text rows** (ScreenTips, file-menu hints, no help dialog): text strings, not key bindings. The one real finding (no keyboard-help dialog,
  Excel `F1` / `Cmd+/`) is in `sheets-86` and `slides-73`.
- **Full-screen "press any key" hint** and the fullscreen `Esc`: folded into `slides-29` and `slides-36`.
- **Univer default shortcuts we do not register** (rich-text / docs-ui keys inside a cell editor): one row (`sheets-92`) because they are inert today.
