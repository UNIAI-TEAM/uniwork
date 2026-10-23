# UniChat — Nâng cấp giao diện chat theo canvas thiết kế

> **Trạng thái:** in-progress — R1–R4 và đợt khớp canvas (§6) xong trong code, gộp một PR trên nhánh `feature/UNI-1881-unichat-giao-dien-chat-moi`, chờ review; mobile chưa qua đợt khớp canvas.

**Issue:** UNI-1881 (sub-issue của epic UNI-1826). **Nguồn thiết kế:** canvas Claude
"UniChat — Nâng cấp giao diện chat" (https://claude.ai/artifact/6bxcJnFj5gemA3BBqGgC8L),
56 bảng chia 6 trang: Tổng quan, Web · Danh sách & phòng, Web · Trong hội thoại,
Web · Cuộc gọi, Mobile, Desktop. Chủ sản phẩm duyệt canvas và yêu cầu làm theo ngày 2026-10-18.

## 1. Mục tiêu

Chat của UniWork phải đọc và dùng như Telegram / WhatsApp / Viber: tường chat có màu,
bong bóng ghép theo lượt, tin của mình nổi bằng màu thương hiệu, thẻ (bình chọn, ghi chú,
nhắc hẹn, việc) nằm đúng cột người gửi, ô soạn tin bo tròn, danh sách hội thoại dày thông tin
nhưng gọn. Không đổi luồng nghiệp vụ nào chỉ vì giao diện.

## 2. Ngôn ngữ thiết kế (bảng "Ngôn ngữ thiết kế" trên canvas)

- Token mới trong `packages/ui/styles/tokens.css`, khai báo ở cả `:root` và `.dark`:
  `--chat-wall`, `--chat-wall-dot`, `--chat-bubble-own` (= `--primary`, theo accent),
  `--chat-bubble-own-foreground`, `--chat-bubble-own-meta`, `--chat-bubble-other`,
  `--chat-bubble-shadow`, `--chat-chip`, `--chat-chip-foreground`; alias Tailwind
  `bg-chat-wall`, `bg-chat-bubble-own`, `text-chat-bubble-own-foreground`,
  `text-chat-bubble-own-meta`, `bg-chat-bubble-other`, `bg-chat-chip`,
  `text-chat-chip-foreground`, `shadow-chat-bubble`. Tỉ lệ tương phản ghi cạnh token.
- Bong bóng: bo 18, cạnh ghép 6, góc đuôi 4 ở tin cuối lượt; khoảng cách trong lượt 2px,
  giữa lượt 12px; giờ và dấu gửi nằm trong bong bóng.
- Chip ngày / dòng hệ thống / mốc chưa đọc là chip giữa tường.
- Bề mặt cuộc gọi dùng bảng tối bằng cách bọc nội dung trong `.dark` (mẫu `--surface-emphasis`),
  không mã màu cứng.
- Chữ: Plus Jakarta Sans cho tên/tiêu đề, Inter cho nội dung (đã có trong app).

## 3. Các đợt

| Đợt | Phạm vi | Cần server |
|---|---|---|
| **R1** (UNI-1881) | Web + desktop: dựng lại giao diện mọi màn chat theo canvas, giữ nguyên hành vi. Kèm vài thay đổi chỉ ở client: thanh 6 cảm xúc nhanh (dùng `onToggleReaction` sẵn có), mốc chưa đọc có nút "Tóm tắt nhanh" mở Bắt kịp, thẻ nằm cột người gửi, bề mặt cuộc gọi tối. | Không |
| **R2** | Hành vi client mới: sửa tin ngay trong ô soạn, thread mở bảng bên phải, tin gửi lỗi giữ bong bóng + Thử lại, bình chọn hiện % và avatar, gom album ảnh, xem ảnh có tải xuống / lướt album, danh sách người tham gia cuộc gọi toàn màn hình. | Không hoặc ít |
| **R3** | Tính năng cần server: dấu đã tới máy / đã xem từng tin, đếm chưa đọc theo workspace + cột workspace, ảnh nhóm, chuyển tiếp, bản chép tin thoại, xem trước liên kết, nguồn tin cho từng ý Bắt kịp. | Có |
| **R4** | Mobile (`apps/chat-mobile`) theo trang Mobile của canvas. | Theo R3 |

Mỗi đợt sau R1 có issue và spec lát riêng trước khi code.

## 4. Không làm trong R1

- Không đổi API, schema, sự kiện realtime, store hay query key.
- Không thêm chữ giao diện mới trừ khi canvas cần và có trong `vi.json` + `en.json` cùng lúc
  (`scripts/i18n-chat-key-parity.test.mjs`).
- Không đổi bố cục trang (vẫn hai cột + sheet); cột workspace thuộc R3.

## 5. Ràng buộc

Mọi luật trong `CLAUDE.md` › UI Rules: chỉ token ngữ nghĩa, không màu cứng; bốn hợp đồng
truy cập của primitive; mọi chữ JSX qua `t()`; file `.ts/.tsx` ≤ 500 dòng; icon lucide tên chuẩn.
Test hiện có của từng component phải còn xanh; test nào khẳng định class cũ thì đổi theo class mới.

## 6. Đợt khớp canvas (2026-10-18)

Chủ sản phẩm so app thật với canvas và yêu cầu giống 100%. Quyết định của chủ sản phẩm: **desktop
(UniChat) y canvas** — cột workspace 72px, không thanh trên, không thẻ bo; **web giữ điều hướng UniWork**
nhưng vùng chat (danh sách, hội thoại, bảng thông tin) phải khớp; **làm luôn phần server** cần cho bảng
thông tin. Cách làm: dựng dữ liệu y canvas trong DB local, chụp app thật cạnh ảnh render của từng bảng Web*
và Main, sửa tới khi khớp.

- Bố cục đổi so với §4: bảng thông tin thành cột thứ ba (mở sẵn khi khung rộng ≥ 780px, nhớ lựa chọn đóng
  theo thiết bị, hẹp hơn thì thành lớp phủ); cột danh sách 380px từ xl.
- Server thêm (đều qua cổng đọc phòng, có test cách ly): mô tả nhóm dùng lại cột `chat_rooms.topic`;
  `GET …/rooms/{roomID}/linked-tasks`; `last_message_call_outcome` / `last_message_duration_ms` trên danh
  sách phòng; `GET …/rooms/{roomID}/shared-summary` (đếm ảnh/tệp/liên kết/thoại + 6 ảnh mới nhất, thay việc
  lật 500 tin ở client mỗi lần mở phòng). Không migration.
- Khi hai bảng vẽ khác nhau, bảng chi tiết hơn của thành phần đó thắng: thẻ bình chọn theo WebCardKinds,
  thanh ghim theo WebSearchPins.
- Cố ý giữ khác canvas: màu trạng thái việc lấy từ danh mục trạng thái của workspace; màu người/phòng là
  tint định danh, không phải mã hex của canvas; trên web ⌘K vẫn là bảng lệnh chung.
- Còn thiếu vì chưa có dữ liệu server: bản chép và tốc độ tin thoại, xem trước liên kết, dấu "đã tới máy",
  người trả lời trên nhãn thread, trang PDF, tiến độ tải xuống. Mobile (các bảng Mob*) chưa qua đợt này.
