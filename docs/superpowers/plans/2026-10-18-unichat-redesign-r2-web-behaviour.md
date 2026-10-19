# UniChat R2 — Hành vi chat mới trên web — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1893; code xong, gộp chung một PR với R1, R3, R4 trên nhánh `feature/UNI-1881-unichat-giao-dien-chat-moi`.

**Goal:** Các hành vi canvas vẽ mà chỉ cần client: sửa tin ngay trong ô soạn, thread mở bảng bên phải,
tin gửi lỗi giữ bong bóng + Thử lại, gom album và xem ảnh lướt được, lối vào Bắt kịp nhanh, bảng emoji
cho cảm xúc, % bình chọn, nhóm Theo dõi sau theo hạn, danh sách người tham gia cuộc gọi, hộp xác nhận
có ô icon.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` §3 dòng R2; canvas trang
"Web · Trong hội thoại" và "Web · Cuộc gọi".

## Ràng buộc

- Không đổi API, schema, sự kiện, query key. Logic mới ở client có test (vitest) cạnh file.
- Chữ mới đã thêm sẵn ở commit `feat(i18n): strings for the R2 chat behaviours`; khóa thiếu thì ghi lại, không tự sửa locale.
- Mỗi task sở hữu nhóm file riêng (bảng dưới). `chat-page-content.tsx` đang 501 dòng trên develop:
  không làm dài thêm — tách logic ra file mới.

## Tasks

- [x] **A — Dòng tin** (UNI-1893): tin gửi lỗi giữ bong bóng với "Chưa gửi được · Thử lại / Bỏ tin này"
  (store outbox + merge optimistic ở `packages/core/chat`), gom ảnh liên tiếp cùng người gửi thành album,
  xem ảnh có Tải xuống, mũi tên trước/sau, dải ảnh "2 / 3".
- [x] **B — Cảm xúc & thẻ**: nút "Thêm cảm xúc" trên thanh rê chuột mở bảng emoji (dùng lại dữ liệu
  emoji của bộ chọn biểu cảm), % trên phương án bình chọn, nhóm Theo dõi sau Quá hạn / Hôm nay / Sắp tới /
  Không có hạn.
- [x] **C — Cuộc gọi & hộp xác nhận**: bảng người tham gia ở chế độ toàn màn hình; `ConfirmDialog` và
  `FormDialogFooter` nhận prop tùy chọn (ô icon, nút đặc, biến thể nút Hủy) và chat dùng chúng.
- [x] **D — Khung trang**: sửa tin trong ô soạn (thay hộp thoại), thread thành bảng bên phải từ `lg`,
  thanh tìm kiếm mở dưới header, thẻ "Bắt kịp nhanh" trên danh sách và chip "N tin chưa đọc" + "Tóm tắt nhanh"
  ở mốc chưa đọc.
- [x] **E — Kiểm**: typecheck, lint, test chat + core chat, render sáng/tối, rồi PR.

## Ghi chú khi xong (2026-10-18)

- Kiểm: vitest views 124 file / 631 test, core 58 file / 534 test, tsc core + views, eslint `chat/` + `common/`
  (kể cả `chat-page-content.tsx`, giờ 348 dòng), knip, test hợp đồng; render sáng / tối bằng trình duyệt thật.
- Còn lại: thanh "N trả lời" dưới tin gốc trong bảng thread, nhãn dưới nút điều khiển cuộc gọi, chữ "Search"
  tiếng Anh trong bảng emoji (emoji-mart tải bản dịch qua mạng — không bật), trạng thái nhấn của nút tìm kiếm.
