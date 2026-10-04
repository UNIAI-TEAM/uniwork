# 0026 — Script inspector do UniWork sở hữu, chỉ trong chế độ visual-edit của preview HTML

**Trạng thái:** accepted (2026-10-04, UNI-928 S1; quyết định người dùng 2026-10-04 03:13 UTC+7, lựa chọn (a))
**Issue:** UNI-928 (nhánh `feature/UNI-928-md-html-genoffice-parity`) · **Parent:** UNI-659 · **Liên quan:** G3-D2, G3-08, H5-H8.
**Nguồn quyết định:** `.uniwork-lane/brief/html-visual-edit-inspector-2026-10-04.md` (bản ghi quyết định của người dùng,
lựa chọn (a) — "a nhé"); `.uniwork-lane/brief/md-html-parity-tasks.md` mục "SECURITY CONFLICT" và hàng S1.
**Liên quan:** [0021](0021-runtime-engine-office-da-dinh-dang.md) (engine đa định dạng, preview cô lập), [0025](0025-office-desktop-host.md).

---

## Bối cảnh

`CLAUDE.md` và mô hình cô lập G3-D2 chốt rằng preview HTML của UniWork chạy trong
một iframe `srcdoc` với sandbox rỗng (không bao giờ `allow-same-origin`), CSP
`script-src 'none'`, origin tài sản riêng (`PREVIEW_ORIGIN`) và một cổng cuối
(`apps/web/platform/office/preview-gate.ts`) phân tích lại bản copy bằng chính
bộ phân tích của trình duyệt. Mọi script của tài liệu, handler nội tuyến (`on*`),
URL `javascript:`, `<base>` và phần tử nhúng đều bị vô hiệu hoá **trước khi**
bản copy tới frame; không có cầu cookie/token/API nào trong frame; `connect-`,
`frame-`, `worker-`, `object-`, `form-action` đều `'none'`.

Trình soạn thảo HTML mà genoffice cung cấp lại cần một script **bên trong** frame
để chỉnh sửa trực quan (chọn phần tử, hover, khung bao, kéo/thả). Một frame
sandbox không có `allow-same-origin` thì không thể bị parent thao tác DOM, nên
phương án "overlay hoàn toàn từ parent, không script trong frame" là bất khả thi
về mặt kỹ thuật. Ngày 2026-10-04, người dùng đã chọn **phương án (a)**: chèn một
script inspector do UniWork sở hữu vào frame, **chỉ** ở chế độ visual-edit.

## Quyết định

Chỉ ở chế độ visual-edit của trình soạn thảo HTML, host chèn **đúng một** script
inspector do UniWork sở hữu, mang một nonce sinh theo từng lần render; CSP của
frame đổi thành `script-src 'nonce-<n>'` (kèm origin tài sản) **chỉ cho chế độ
này**. Toàn bộ G3-D2 còn lại giữ nguyên: origin tài sản riêng, sandbox **không**
`allow-same-origin` (chỉ thêm `allow-scripts`), không cầu cookie/token/API trong
frame, `connect`/`frame`/`worker`/`object`/`form-action` `'none'`, tài sản chỉ qua
broker. Script của tài liệu, `on*`, URL `javascript:`, `<base>` và phần tử nhúng
vẫn bị cổng loại **trước khi** bản copy tới frame; inspector được chèn **sau**
cổng, không bao giờ lấy từ tài liệu.

Cụ thể trong mã nguồn:

- `PreviewCapability` giữ `{ scripts: boolean }` cho đường tin cậy hiện có, và có
  thêm `visualEdit?: { nonce: string }`. Đặt `visualEdit` là **cách duy nhất** để
  frame chạy script mà không có `'unsafe-inline'`; khi đó `scripts` bị bỏ qua và
  script tài liệu luôn tắt (`buildHtmlPreviewCopy({ scripts: false })`), nên chỉ
  script mang nonce của host là chạy được. Sandbox vẫn là `allow-scripts` và
  **không bao giờ** có `allow-same-origin`.
- Nonce phải là 32 ký tự hex thường (`/^[0-9a-f]{32}$/`); một nonce không hợp lệ
  hoặc không sinh được thì **từ chối ngay khi mount** (ném
  `PreviewIsolationError`), không dựng frame — fail closed, không đoán.
- Inspector được chèn sau `gatePreviewCopy`, ngay trước `</head>` để nằm **sau**
  thẻ `<meta http-equiv="Content-Security-Policy">` (chính sách CSP qua meta chỉ
  áp dụng cho nội dung được phân tích sau nó).
- Giao thức postMessage có kiểu và được kiểm ở **cả hai phía**: parent kiểm
  origin + nonce + schema zod (`z.strictObject` trong một union phân biệt) cho
  mọi thông điệp vào, và **không bao giờ** `eval` dữ liệu của frame; inspector
  kiểm `event.source === parent`, nonce, loại thông điệp và giữ port trong closure
  — nó không đọc cookie/storage, không `fetch`, không lộ gì cho tài liệu.
- Chỉnh sửa đi về dưới dạng **ý định** (`text-edit-commit`) rồi được H3 biến thành
  patch set áp lên nguồn qua `engine.applyPatchSet`; S1 không tự ghi DOM.
- Chế độ preview thường (`{ scripts: false }`, mặc định sản xuất) và preview
  Markdown giữ **đúng** hành vi hôm nay: không script, `script-src 'none'`.

`preview-gate.ts` chỉ thêm **một** tuỳ chọn, `stripScripts` (mặc định tắt).
Bật nó ở chế độ visual-edit là yêu cầu bắt buộc của chính quyết định này: nếu
script của tài liệu vẫn nằm trong bản copy, frame có `allow-scripts` sẽ chạy nó,
và "chỉ một script do UniWork sở hữu" sẽ không còn đúng. Khi bật, cổng loại mọi
`<script>` (mọi namespace, kể cả trong SVG) và mọi thuộc tính `on*`; khi tắt,
đường preview thường giữ **nguyên từng byte** như trước. Thay đổi này không nới
một luật loại/cho phép nào đang có: nó chỉ thêm một lượt loại nữa, và vì cổng đã
chứng minh bản serialisation ổn định qua lần phân tích lại, việc chèn inspector
sau đó (một lần phân tích lại + nối vào `<head>`) không mở lại đường nào. Thuộc
tính `data-sid` vốn đã được cổng giữ nguyên (đã kiểm bằng test), nên việc gắn
`data-sid` từ parse map là phạm vi của H5, không cần thêm gì ở cổng.

## Hệ quả

- Chế độ visual-edit chạy được script, nhưng chỉ đúng một script do repo sở hữu và
  được review như mã sản phẩm; nó chạy trong origin mờ, không có `allow-same-origin`,
  nên vẫn không đọc được cookie/storage/DOM của app và không gọi được API của app.
- Rủi ro còn lại không đổi so với G3-D2: một script có thể tự điều hướng frame và
  mang chữ của tài liệu theo (trình duyệt không có CSP chặn self-navigation);
  host phát hiện, xoá trắng frame và thu hồi cầu. Vì vậy cầu **không** cấp quyền
  gì cho frame ngoài việc báo sự kiện, và mọi thông điệp vào đều bị kiểm lại.
- Cần một test thoát hiểm HTML thù địch chứng minh: script tài liệu không chạy,
  không tới được parent, không giả mạo được thông điệp inspector, không có mạng
  rời frame; fixture thù địch được chạy lại ở bước visual cuối.
- Khi thêm loại thông điệp mới, phải thêm vào union zod (parent) **và** allowlist
  trong script (frame) cùng lúc; một test sinh script từ chính các hằng số giao
  thức giữ hai phía không lệch.

## Trạng thái

`accepted` (2026-10-04, UNI-928 S1; thay đổi G3-D2 **chỉ** cho chế độ visual-edit,
theo bản ghi quyết định của người dùng). Chưa thay thế ADR nào.
