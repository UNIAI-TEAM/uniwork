# G7-09 — Checklist nghiệm thu UX (S1–S11)

> **Trạng thái:** in-progress

Thẻ G7-09 (UNI-1383), AC G7-A04. Nguồn quy tắc duy nhất: [EXPERIENCE.md › Accessibility Floor](EXPERIENCE.md#accessibility-floor)
(gọi tắt **Floor**), [State Patterns › Conflict dialog (S5)](EXPERIENCE.md#conflict-dialog-s5),
[Responsive & Platform](EXPERIENCE.md#responsive--platform), [DESIGN.md › Colors](DESIGN.md#colors); host theo cột Host của
[Information Architecture](EXPERIENCE.md#information-architecture). Checklist này chỉ dẫn về các quy tắc đó, không nêu lại
hay đổi quy tắc. Lệch spine là finding chặn.

Cột **Chế độ**:

- `auto` — chạy trong `e2e/office-ux-floor.spec.ts` (gate `OFFICE_UX_FLOOR_E2E=1`, trên trang D web host frame Docs đã pin,
  đo trong iframe cùng origin); ghi tên test. Test có `finding()` là finding chặn đã biết: test tới được trạng thái rồi mới
  đánh dấu expected-fail với mã `UXF-nn`; khi sản phẩm sửa xong, test "unexpectedly passed" và bỏ dấu. Expected-fail cũng nuốt
  timeout/throw xảy ra sau khi tới trạng thái, nên khi đọc báo cáo cloud phải đối chiếu thông điệp lỗi của từng expected-fail
  với quy tắc ở annotation `finding`; lỗi không nói về quy tắc đó là fail thật, không phải finding.
- `manual` — người kiểm ghi lại: NVDA + Windows (Chrome/Edge), VoiceOver + macOS, ảnh chụp; ghi âm screen reader là artifact.
- `fork e2e (proposed)` — bề mặt chỉ có ở shell Electron của fork; một dòng đề xuất cách e2e của fork kiểm, chưa làm.
- `blocked` — S3, S11 (desktop): BLOCKED tới khi G5-05u merge (G5-D1 đã ký 2026-10-13, G5-05u HOLD vì UNI-1645);
  phần macOS VoiceOver/Safari: BLOCKED(G7-D2).

Host: **W** = web frame trên D web, **D** = desktop shell (fork). Frame đã pin lúc viết: `0.1.0-05fd209`; REPIN-1 (UNI-1825) nâng lên `0.1.0-5a72c13` (fork main `5a72c1313`, thay các bản trước `0.1.0-fa22cd9` và candidate `0.1.0-0d77962`), và pin hiện tại là `0.1.0-cc35602` (fork main `cc35602c8`, UNI-1860). Spec đọc pin từ
`apps/web/platform/office-frame/docs.pin.json`, không ghi cứng pin trong logic/selector (marker S5 nhận cả `data-docs-web` và
`data-office-web`, hàng UniWork AI tìm theo nhóm), nên mỗi lần re-pin chạy lại đúng file này.

**Nhóm S7/S8/S9 (UniWork AI) — hết blocked từ pin `0.1.0-5a72c13` (REPIN-1, UNI-1825, lane g6-fork_ui).** Ở pin cũ
`0.1.0-05fd209` picker không vẽ hàng UniWork AI (`packages/ui/src/ai-model-picker-options.ts:47` bỏ provider không có model và
`UNIWORK_PROVIDER_META.models = []`), nên `openPicker` từng `test.skip` lúc chạy (annotation `blocked`). Fork 7888df06c (có trong
fork main và trong pin từ `0.1.0-fa22cd9` / `0.1.0-5a72c13`) liệt kê provider có danh sách model rỗng, nên `openPicker` giờ không còn skip: thiếu hàng
UniWork AI là fail thật, và số annotation `blocked` của `office-ux-floor.spec.ts` là 0. Phía server không đổi: `beforeAll` của nhóm bật
`office_ai_uniwork` + `office_ai_uniwork_docx` rồi mint frame token và đòi `ai.uniwork_ai = true` (Starter có `office.ai_cloud`,
`AI_PROVIDER=fake` có model cho `office_uniwork_ai`). Các dòng G-01 (phần S7/S9), F-02, FC-03, S7-01, S8-01, S9-02 chạy lại trên
cloud runner với pin mới; trạng thái pass chỉ ghi khi có báo cáo cloud.

Annotation `contrast` ghi số nút đo và **tỉ lệ nhỏ nhất** (tỉ lệ, ngưỡng cần, nút) cho từng bề mặt và chế độ.

## Chung, vùng live, vùng chạm, focus, zoom, chuyển động, forced colors

| id | S# | Host | Floor | Kiểm | Chế độ |
| --- | --- | --- | --- | --- | --- |
| G-01 | S5 S6 S7 S9 | W | Floor › Chung; DESIGN › Colors | Chữ ≥ 4.5:1 (lớn ≥ 3:1) đo trên trang render, light + dark, vi + en | auto: `S6 clean + dirty bars and every reachable S5 step — {mode} {locale}`, `S7 picker with UniWork AI and the S9 result line — {mode} {locale}` (phần S7/S9 chạy trên pin `0.1.0-cc35602`, chờ cloud e2e) |
| G-02 | S1 S2 S3 S4 S10 S11 | D | Floor › Chung; DESIGN › Colors | Như G-01 trên bề mặt desktop | fork e2e (proposed): spec Playwright-Electron của shell mở từng bề mặt qua fixture store, chạy cùng phép đo `auditText` trên `webContents` light/dark |
| G-03 | mọi | W + D | Floor › Chung | Trạng thái không chỉ bằng màu (badge/pill luôn có chữ) | manual: ảnh light/dark + forced colors từng trạng thái |
| G-04 | S5 | W | Floor › Chung | Điều khiển không chạy được: `aria-disabled` + `aria-describedby` lý do, giữ trong thứ tự Tab | auto: `aria-disabled choices (web offline) stay in the Tab loop with a reason` |
| G-05 | S2 S3 S6 S8 | W + D | Floor › Chung | Như G-04 cho S6 (chờ commit), S8 (Gửi), S2/S3 | manual (W S6/S8: NVDA); D: fork e2e (proposed): fixture intent `committing` rồi đọc thuộc tính |
| G-06 | S5 | W + D | Floor › Chung | Nút danger `aria-disabled` giữ chữ `danger-text` | manual: ảnh S5 offline light/dark |
| L-01 | shell, frame | W | Floor › Vùng live | Mỗi frame có đúng một `role=status` và một `role=alert` (rỗng) cố định từ lúc tải | auto: `the frame has its two fixed live nodes from load, before any bar` (**UXF-10**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| L-02 | shell | D | Floor › Vùng live | Như L-01 cho cửa sổ shell | fork e2e (proposed): đếm `[role=status]`/`[role=alert]` gốc của shell ngay sau `ready-to-show` |
| L-03 | mọi | W + D | Floor › Vùng live | Không đổi `aria-live`/`role` lúc chạy; alert ghi một lần rồi xóa ~1 s; hai sự kiện trong 1 s xếp hàng | manual: NVDA + Windows (ghi âm), VoiceOver + macOS BLOCKED(G7-D2) |
| L-04 | S6 | W | Floor › Vùng live, › S6 | Thanh không mang `role=status|alert`/`aria-live`; câu đọc đúng một lần qua nút polite của cửa sổ | auto: `an S6 bar is read once, through the window node; the bar itself is not live`; manual: NVDA xác nhận một lần đọc |
| L-05 | S5 | W | Floor › Vùng live | Nút live của cửa sổ nằm ngoài cây bị `inert` khi S5 mở | auto: `the window live nodes stay outside the inert tree while S5 is open` (**UXF-04**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| L-06 | S5 | W + D | Floor › Vùng live, › S5 | Dòng lỗi của S5 chỉ vào `role=alert` của hộp thoại, không vào cửa sổ | manual: NVDA, biến thể Ghi đè thất bại |
| L-07 | S1 | D | Floor › Vùng live, › S1 | Một lần chuyển trạng thái pill → một câu được đọc | manual: NVDA + Windows ghi âm; VoiceOver BLOCKED(G7-D2); fork e2e (proposed): MutationObserver trên nút polite của shell đếm đúng 1 ghi cho mỗi chuyển trạng thái của store |
| L-08 | S2 S3 | D | Floor › Vùng live, › Progress | Progress không đọc từng bước, chỉ khi xong | S2: fork e2e (proposed): đếm ghi vào nút polite trong một lượt tải; S3: blocked |
| T-01 | S5 S6 | W | Floor › Vùng chạm | Mọi điều khiển ≥ 24×24 CSS px (con trỏ mịn) | auto: `target sizes: every S5 and S6 control >= 24x24 CSS px (fine pointer)` |
| T-02 | S5 S6 S7 S9 | W | Floor › Vùng chạm, › S5, › S7, › S9 | 44 px khi `pointer: coarse` | manual: thiết bị cảm ứng thật, ảnh có thước |
| T-03 | S1 S2 S3 | D | Floor › S1, › Vùng chạm | Vùng chạm pill (24 px mịn, 40 px thô trong thanh tiêu đề), nút tên hàng S2/S3 | fork e2e (proposed): đo `::before` bằng `elementFromPoint` tại mép vùng chạm |
| F-01 | S1 S5 S6 | W + D | Floor › Focus ring | Ring kế thừa của fork hiện rõ ở hai chế độ | manual: ảnh focus bàn phím từng bề mặt |
| F-02 | S7 | W | Floor › Focus ring, › S7 | `.ai-model-item.selected:focus-visible` ring ≥ 3:1 với `accent-soft`, light + dark | auto: `S7 the selected option's focus ring is >= 3:1 against accent-soft — {mode}` (**UXF-01**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| Z-01 | S5 S6 | W | Floor › Phóng to 200% | Không nhãn trạng thái bị cắt bởi `nowrap` không lối thoát; S5 dùng đủ (viewport CSS 640×400 = 1280×800 ở 200 %) | auto: `zoom 200 % and WCAG 1.4.12 text spacing: no status label clipped, S5 fully reachable` (phần 200 %) |
| Z-03 | S5 S6 | W | Floor › Phóng to 200% / text spacing (WCAG 1.4.12) | Chèn style ghi đè 1.4.12 (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, khoảng đoạn 2em) vào frame: không nhãn bị cắt (nowrap hoặc hộp `overflow` ẩn quá thấp), S5 vẫn dùng đủ | auto: cùng test với Z-01 (phần text spacing) |
| Z-02 | S1 S2 | D | Floor › Phóng to 200% | Pill ellipsis nhưng câu đủ ở mô tả; badge/dòng phụ xuống dòng | fork e2e (proposed): `webContents.setZoomFactor(2)` rồi cùng kiểm `nowrap`/`scrollWidth` |
| M-01 | S5 S6 | W | Floor › Chuyển động | `prefers-reduced-motion: reduce`: không hiệu ứng trượt/mờ | auto: `reduced motion: no slide/fade on S6 or S5` (ghi `animationstart`/`transitionrun` từ trước khi bề mặt hiện, và đo thời lượng computed của thanh/mask/thẻ) |
| M-02 | S1 | D | Floor › Chuyển động | Spinner thành biểu tượng tĩnh + "Đang lưu…" | fork e2e (proposed): emulate reduced motion trong Electron, kiểm `getAnimations()` rỗng và chữ |
| FC-01 | S5 | W | Floor › Forced colors; DESIGN › Forced colors | Nút S5 giữ viền nhìn thấy (không chỉ màu) | auto: `S5 buttons keep a visible border, not colour alone` |
| FC-02 | S5 | W | DESIGN › Forced colors | Nút `aria-disabled` dùng chữ + viền `GrayText` | auto: `S5 aria-disabled buttons use GrayText text and border` (**UXF-05**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| FC-03 | S7 | W | DESIGN › Forced colors | Tùy chọn đang chọn có viền 2px `Highlight` | auto: `S7 the selected picker option has a 2px Highlight border, not only a fill` (**UXF-06**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`; hàng UniWork AI có từ pin `0.1.0-5a72c13`) |
| FC-04 | S2 S3 | D | DESIGN › Forced colors | Tab S2 đang chọn viền 2px `Highlight`; progress fill/chấm `forced-color-adjust: none` | fork e2e (proposed): `emulateMedia({forcedColors})` trên cửa sổ shell; S3 blocked |
| N-01 | mọi | W + D | Floor › Không chỉ `title` | Giải thích an toàn dữ liệu nằm trong DOM, không chỉ `title` | manual: NVDA đọc mô tả bằng focus |

## Theo bề mặt

| id | S# | Host | Floor | Kiểm | Chế độ |
| --- | --- | --- | --- | --- | --- |
| S1-01 | S1 | D | Floor › S1 | `div[role=group][aria-label]` > nhãn không live + nút hành động có `aria-describedby`; không `title` | fork e2e (proposed): truy vấn DOM `UniworkChrome` theo từng trạng thái store |
| S1-02 | S1 | D | Floor › S1 | Nút bận `aria-disabled`, focus không rơi về `<body>` sau khi bấm bằng phím | fork e2e (proposed): bấm Enter, kiểm `document.activeElement` |
| S2-01 | S2 | D | Floor › S2/S3 | Tablist APG (roving tabindex, ←/→, Home/End, số đếm trong tên tab) | fork e2e (proposed): bàn phím trên cửa sổ trung tâm đồng bộ |
| S2-02 | S2 | D | Floor › S2/S3 | `caption`, cột "Hành động" ẩn, `th scope=row`; nút "…" `aria-haspopup=menu`; Discard confirm focus "Quay lại" | fork e2e (proposed) + manual NVDA (chế độ bảng) |
| S3-01 | S3 | D | Floor › S2/S3, › Progress | Progressbar `aria-labelledby` + `aria-valuetext`; thanh dung lượng `aria-hidden` | blocked (G5-05u) |
| S4-01 | S4 | D | Floor › S4 | `role=dialog` không modal, focus vào popover, Esc trả focus (pill / editor) | fork e2e (proposed): mở từ pill và từ Ctrl+S, kiểm `activeElement` |
| S5-01 | S5 | W | Floor › S5 | `alertdialog`, `aria-modal`, tiêu đề `h2[tabindex=-1]`, có mô tả | auto: `DOM order = visual order = the standard order, default focus Cancel, Tab stays in, the rest is inert` |
| S5-02 | S5 | W | State Patterns › S5 (câu chuẩn) | DOM = thị giác = Tab; nút X cuối DOM | auto: như S5-01 |
| S5-03 | S5 | W | State Patterns › S5 | "Lưu thành bản sao…" giữa Tải lại và Ghi đè khi còn quyền sửa | auto: `Save copy sits between Reload and Overwrite with edit access` (**UXF-02**, vẫn expected-fail: fork có contract `ConflictIo.saveCopy`, chờ D web host cấp đường lưu bản sao) |
| S5-04 | S5 | W | State Patterns › S5 | "Xem khác biệt" (Docs) trước Tải lại | auto: `Docs shows 'Xem khác biệt' before Reload` (**UXF-03**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| S5-05 | S5 | W | State Patterns › S5 | Focus mặc định Hủy; Esc = Hủy; bước 2 trong cùng thẻ, focus mặc định "Quay lại", "Quay lại" trả focus về nút đã mở | auto: S5-01 (Hủy, Esc) + `S6 clean + dirty bars and every reachable S5 step` (bước 2, Quay lại) |
| S5-06 | S5 | W | Floor › S5 | Bẫy Tab qua mọi phần tử focus được, kể cả `aria-disabled` | auto: S5-01 + G-04 |
| S5-07 | S5 | W | Floor › S5, › Web host | Phần còn lại của frame `inert`; trang host ngoài iframe `inert` khi `modal` bật, gỡ khi đóng | auto: S5-01 |
| S5-08 | S5 | W | Floor › Web host | Host tạm ngưng Ctrl/⌘+S, Esc khi `modal`; trả focus vào frame khi đóng; frame unload gỡ `inert` | manual: bàn phím + NVDA, ảnh |
| S5-09 | S5 | W + D | Floor › S5 | Tiêu đề nhận focus khi biến thể đổi tại chỗ (403 org, revoke, tải về xong) | manual (W: cần lỗi server có chủ đích); D: fork e2e (proposed) |
| S5-10 | S5 | D | Floor › S5 | Radio `fieldset` + `input[type=radio]`, "Giữ…" `aria-describedby` hint, `aria-disabled` khi không giữ được | fork e2e (proposed): fixture store đầy |
| S5-11 | S5 | W | Floor › S5 | 320×256 CSS px: hộp thoại cuộn, tiêu đề không bị cắt, mọi nút tới được (iframe đặt cứng 320×256) | auto: `S5 at 320x256 CSS px: the dialog scrolls, the title is not cut, every button is reachable` |
| S5-12 | S5 | W | Responsive › Web hẹp | < 768 px: rộng toàn phần trừ lề 16 px, nút xếp dọc (iframe 390 và 600 px) | auto: `narrow web frame 390px: …`, `narrow web frame 600px: …` (**UXF-07** ở 600 px, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| S5-13 | S5 | D | State Patterns › S5 | Desktop vẽ cùng khuôn, cùng thứ tự/focus | fork e2e (proposed): cùng bộ kiểm S5-01..S5-06 trên cửa sổ desktop từ hàng `conflict` |
| S6-01 | S6 | W | Floor › S6 | `region` có nhãn `uwRemoteRegion` (sạch/dirty) | auto: L-04 |
| S6-02 | S6 | W | Floor › S6 | Biến thể `uwLockRegion` (revoke, delete, nạp thất bại) | manual: ảnh + NVDA (xóa/thu hồi quyền khi đang mở) |
| S6-03 | S6 | W + D | Floor › S6 | Không tự ẩn khi có focus/hover | manual |
| S6-04 | S6 | W | State Patterns › S6 | Biến thể AI đang chạy (`uwRemoteNewerAi`) | manual: ảnh light/dark (cần lượt AI đang chạy khi có version mới) |
| S7-01 | S7 | W | Floor › S7 | `listbox` ở `.ai-model-pop-list`, `.ai-model-pop` là `group`, "Quản lý"/footer là anh em sau danh sách | auto: `S7 listbox sits on the list, Manage and the footer are siblings after it` (**UXF-08**, expected-fail đã gỡ ở pin `0.1.0-5a72c13`) |
| S7-02 | S7 | W | Floor › S7 | Roving tabindex, ↑/↓, Home/End, Esc trả focus về chip; chip `aria-haspopup=listbox` + `aria-expanded` | manual: bàn phím + NVDA |
| S7-03 | S7 | D | Floor › S7, IA S7 | Picker footer desktop (`aiUniworkFooterSignIn`, `cloudState*`), tín dụng qua `aria-describedby` | fork e2e (proposed): fixture trạng thái cloud cho từng hàng bảng UniWork AI |
| S8-01 | S8 | W | Floor › S8 | `region` nhãn `aiUniworkDisclosureLabel`, `tabindex=-1`, không cướp focus; Gửi `aria-disabled` + `aria-describedby` tới khi bấm "Đã hiểu", rồi bật | auto: `S8 disclosure region shows on the first UniWork AI turn and gates Send` (**UXF-09**; Gửi đo với ô soạn có chữ, lý do = `aiUniworkSendNeedsAck`; expected-fail đã gỡ ở pin `0.1.0-5a72c13`); manual: NVDA |
| S8-02 | S8 | D | Floor › S8 | Như S8-01 trên desktop, biến thể tệp cục bộ (S10) | fork e2e (proposed) |
| S9-01 | S9 | W + D | Floor › S9 | Luồng không `aria-live`; nút polite riêng đọc câu trả lời một lần; `aria-busy` khi stream; Gửi ↔ Dừng đổi `aria-label` + báo polite | manual: NVDA ghi âm; VoiceOver BLOCKED(G7-D2) |
| S9-02 | S9 | W | DESIGN › Colors | Tương phản dòng kết quả/lỗi | auto: G-01 (`S7 picker with UniWork AI and the S9 result line`); hàng UniWork AI có từ pin `0.1.0-5a72c13` |
| S10-01 | S10 | D | IA S10, Floor › S8 | Tệp cục bộ: mục UniWork AI theo trạng thái đăng nhập, khối S8 biến thể `aiUniworkLocalFile` | fork e2e (proposed): mở tệp chưa bind cloud, đăng nhập/đăng xuất bằng fixture |
| S11-01 | S11 | D | Floor › S11 | Lock panel `region` `aria-labelledby`, ghi "{tiêu đề}. {câu}" một lần vào alert, focus tiêu đề | blocked (G5-05u); sau đó fork e2e (proposed) |
| S11-02 | S11 | W | IA S11, State Patterns › S6 | Web: thanh S6 error + editor chỉ đọc khi mất quyền/xóa | manual: ảnh light/dark vi/en |
| SO-01 | Sign-out | D | Floor › Sign-out prompt | `alertdialog`, focus mặc định "Quay lại", `uwSignOutWaiting` vào polite, "Đăng xuất" `aria-disabled` khi chờ | fork e2e (proposed): fixture hàng chờ còn intent rồi đăng xuất; manual: NVDA ghi âm |

## Nền tảng, ngôn ngữ, chế độ màu

| id | S# | Host | Floor | Kiểm | Chế độ |
| --- | --- | --- | --- | --- | --- |
| P-01 | S1–S11 | W + D | Floor (dòng cuối) | Đi hết bề mặt bằng NVDA + Windows (Chrome, Edge, desktop) | manual: ghi âm + ghi chú theo id ở trên |
| P-02 | S1–S11 | D + W | Floor (dòng cuối) | VoiceOver + macOS (desktop, Safari) trên máy Mac thật | blocked: BLOCKED(G7-D2) |
| P-03 | S5 S6 S7 S9 | W | Floor (dòng cuối) | Chrome tự động; Edge thủ công; Safari | Chrome: auto (cả spec); Edge: manual; Safari: BLOCKED(G7-D2) |
| P-04 | mọi | W + D | Floor › Chung | vi + en | W S5/S6/S7/S9: auto (vòng `{locale}`); còn lại manual: ảnh vi/en |
| P-05 | mọi | W + D | Floor › Chung | light + dark | W S5/S6/S7/S9: auto (vòng `{mode}`, kiểm nền thẻ đúng chế độ); D: fork e2e (proposed) |

## Findings chặn đã biết (frame `0.1.0-cc35602`)

Chi tiết (vị trí, giá trị đo, quy tắc) ở báo cáo lane `reports/ux-accept_local/worker-r1.md`; lead chuyển Advisor. Pin hiện tại
của D: `0.1.0-cc35602` (prerelease `web-0.1.0-cc35602` từ fork main `cc35602c8`, UNI-1860, thay `0.1.0-5a72c13`, `0.1.0-fa22cd9` và candidate `0.1.0-0d77962` của REPIN-1). UXF-FIX (UNI-1824, fork main `005e54632`, vào từ `0.1.0-5a72c13`) đã vào pin nên các finding UXF-03, 04, 05, 06, 07, 10 đã gỡ expected-fail và chờ cloud e2e xác nhận; chỉ còn UXF-02 giữ expected-fail (cần đường host trên D web cho `ConflictIo.saveCopy`).

| Mã | Hàng | Tóm tắt | Owner / trạng thái |
| --- | --- | --- | --- |
| UXF-01 | F-02 | Ring focus của tùy chọn đang chọn trong picker không có (`outline: none`) | đã đóng ở pin `0.1.0-5a72c13` (fork main 99e5a5253): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-02 | S5-03 | S5 không có "Lưu thành bản sao…" | fork `cbf9c9e92` đã có contract `ConflictIo.saveCopy` (UNI-1824); còn giữ expected-fail trên D tới khi D web host cấp đường lưu bản sao (owner: D host / Advisor) |
| UXF-03 | S5-04 | S5 Docs không có "Xem khác biệt" | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `cbf9c9e92` + `47ad37ff8`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-04 | L-05 | Nút live của frame bị `inert` khi S5 mở | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `3d7bc718c`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-05 | FC-02 | Forced colors: nút `aria-disabled` không dùng `GrayText` | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `31941aa42`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-06 | FC-03 | Forced colors: tùy chọn đang chọn không có viền `Highlight` | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `c34554c91` + hàng UniWork AI từ `7888df06c`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-07 | S5-12 | Frame hẹp 480–767 px: S5 giữ `max-width: 448px`, không rộng toàn phần trừ 16 px | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `31941aa42`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-08 | S7-01 | Picker: `listbox` ở `.ai-model-pop`, "Quản lý" nằm trong listbox | đã đóng ở pin `0.1.0-5a72c13` (fork main 99e5a5253): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-09 | S8-01 | S8 không được render (chỉ có chuỗi) | đã đóng ở pin `0.1.0-5a72c13` (fork main 99e5a5253): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |
| UXF-10 | L-01 | Hai nút live của cửa sổ chỉ được tạo ở lần announce đầu (`remote-bar.ts` `liveNode()`), không có từ lúc tải | đã đóng ở pin `0.1.0-5a72c13` (UXF-FIX `005e54632`, `e44b3403a`): expected-fail gỡ trong `office-ux-floor.spec.ts`, chờ cloud e2e xác nhận |

## Ký nghiệm thu

Chỉ người dùng ký. Phần `manual` và `blocked` chỉ ký khi có artifact (ảnh, ghi âm) gắn theo id.

| Phần | Người ký | Ngày | Ghi chú |
| --- | --- | --- | --- |
| Tự động (auto) |  |  |  |
| NVDA + Windows |  |  |  |
| VoiceOver + macOS (G7-D2) |  |  |  |
| Fork e2e (proposed) |  |  |  |
| S3/S11 (G5-05u) |  |  |  |
