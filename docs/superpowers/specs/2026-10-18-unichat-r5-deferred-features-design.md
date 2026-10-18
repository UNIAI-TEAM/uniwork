# UniChat R5 — Các tính năng chat đã hoãn

> **Trạng thái:** in-progress — UNI-1908 (sub-issue của UNI-1881), nhánh `feature/UNI-1908-unichat-r5-tinh-nang-chat-hoan`, xếp sau PR #348.

**Vì sao:** R3 hoãn bảy thứ canvas vẽ mà chưa có server hoặc chưa có quyết định của chủ sản phẩm
(`docs/superpowers/plans/2026-10-18-unichat-redesign-r3-server.md` › Hoãn). Ngày 2026-10-18 chủ sản phẩm
duyệt làm cả bảy cho web + desktop, giao diện đúng canvas (`docs/superpowers/specs/2026-10-18-unichat-redesign-design.md`).
Mobile làm sau, trên cùng API.

## Quyết định của chủ sản phẩm (2026-10-18)

1. **Chuyển tiếp:** cho phép tới các phòng người dùng đã vào; tin hiện "Chuyển tiếp từ <người gửi gốc>", không lộ
   tên phòng nguồn; nhóm / kênh có công tắc "Cho phép chuyển tiếp" trong quyền thành viên, mặc định bật; có audit.
2. **Bản chép tin thoại:** chỉ chép khi có người bấm "Xem bản chép"; lưu trên tin, người sau xem không tốn thêm;
   tính một lần vào hạn mức AI của tổ chức qua `ai.Gateway`; ẩn nút khi tổ chức tắt AI.
3. **Xem trước liên kết:** server tải tiêu đề / mô tả / ảnh khi tin được gửi, chặn SSRF, lưu ảnh vào kho UniWork;
   máy người xem không gọi tới trang ngoài. Ghi thành ADR 0035.
4. **PR:** PR mới xếp sau #348.

## Thiết kế (hợp đồng giữa các phần)

Đường dẫn dưới đây là gợi ý; người làm theo đúng mẫu route đã có trong `server/internal/handler/router/`.
Mọi route mới qua cổng phòng (`authorizeRoomRead` / gửi) và `RequireMember`, vào `TestIsolationMatrix`; trường
body `_id`/`_ids` có case trong `isoReferences`; query mới có lọc tenant hoặc dòng `-- tenant:`; lệnh đổi trạng
thái nghiệp vụ ghi audit + outbox trong cùng transaction; sự kiện mới sửa đủ ba nơi của danh mục.

### F1 — Chuyển tiếp
- `POST …/chat/messages/{messageID}/forward` `{target_room_ids: [1..10], comment?: string}` →
  `{messages: [{room_id, message_id}]}`.
- Nguồn: người gọi đọc được phòng nguồn; nếu phòng nguồn tắt `allow_forward` thì chỉ quản trị phòng được chuyển.
  Đích: người gọi gửi được vào từng phòng (không bị chặn, hạn chế gửi, chỉ đọc).
- Loại được chuyển: chữ, ảnh / album / tệp, tin thoại, sticker / GIF, liên kết. Bình chọn, ghi chú, nhắc hẹn,
  nhật ký cuộc gọi, tin hệ thống thì không (ẩn mục trên menu).
- Tin mới mang `forwarded_from: {sender_id, sender_name, sent_at}` (không có phòng nguồn); tệp đính kèm phải đọc
  được bởi thành viên phòng đích.
- Audit `chat.message.forwarded` mỗi phòng đích; sự kiện như gửi tin thường.
- `member_permissions.allow_forward` (mặc định true) trong cài đặt nhóm / kênh.

### F2 — Bản chép và tốc độ tin thoại
- `POST …/chat/messages/{messageID}/transcript` → `{text, language}`: có rồi thì trả bản đã lưu (không tính
  thêm), chưa có thì chép qua `ai.Gateway.CloudTranscribe`, lưu, audit. Lỗi hết hạn mức / AI tắt là lỗi có mã.
- Lưu ở bảng riêng (một dòng mỗi tin), có `organization_id`, `created_by` + `created_by_kind`.
- Tốc độ phát 1× / 1,5× / 2× chỉ ở client (WebMessageKinds).

### F3 — Xem trước liên kết (ADR 0035)
- Khi tin chữ có URL http(s) được tạo, một consumer ở lane chậm lấy URL đầu tiên, tải trang qua bộ tải chặn
  SSRF (chỉ http/https cổng 80/443; phân giải DNS rồi từ chối IP nội bộ / loopback / link-local / multicast /
  CGNAT / ULA và quay số thẳng tới IP đã kiểm; kiểm lại sau mỗi redirect, tối đa 3; giới hạn thời gian 5 s,
  HTML 1 MiB, ảnh 2 MiB, loại ảnh trong danh sách cho phép; không cookie), đọc Open Graph / thẻ title, tải ảnh
  vào kho UniWork. Kết quả dùng chung theo URL trong tổ chức.
- Client đọc theo lô như liên kết tin ↔ việc: `GET …/rooms/{roomID}/link-previews?message_ids=…`; khi xem trước
  sẵn sàng có sự kiện chỉ mang id để client làm mới.

### F4 — Đã tới máy
- Con trỏ "đã nhận" theo thành viên phòng (`last_delivered_at`), chỉ tiến lên. Client báo khi nhận khung
  `chat.message.created` hoặc khi tải danh sách phòng, gom lại (debounce), một request cho nhiều phòng.
- Sự kiện ephemeral như `chat.room.member_read`; DM có `peer_last_delivered_at`, nhóm có `last_delivered_at` trên
  danh sách thành viên.
- Dấu: ✓ đã gửi, ✓✓ xám đã tới (mọi thành viên khác đã nhận), ✓✓ xanh đã xem (giữ luật đã xem hiện có).

### F5 — Người trả lời trên nhãn thread
- Tin gốc có `thread_participant_ids` (tối đa 3 người trả lời gần nhất, khác nhau); nhãn thread vẽ mặt họ
  (WebMessageKinds / WebThread).

### F6 — Trang PDF và tiến độ tải xuống
- PDF: số trang và ảnh trang đầu, làm một lần khi tải lên (như ảnh thu nhỏ), hoặc ở client nếu server không vẽ
  được trang — người làm chọn và ghi lý do.
- Tải xuống: thanh tiến độ và Hủy trên thẻ tệp (WebMessageKinds / WebMessageActions); desktop qua bridge nếu được.
- **Đã chọn (2026-10-18): vẽ trang đầu ở client.** Server Go không được vẽ PDF không tin cậy, và trong repo chỉ có
  Office engine (PDFium WASM) vẽ được trang. Engine là dịch vụ tuỳ chọn (không đặt `OFFICE_ENGINE_URL` là không có,
  kể cả máy dev), hợp đồng của nó có danh sách thao tác đóng (thêm thao tác là đổi fixture TS + Go + tài liệu hợp
  đồng), và mỗi job cần grant — dựng đường đó cho một ảnh thu nhỏ chat là quá nặng, mà nơi không chạy engine vẫn
  phải có đường dự phòng. Nên: `pdfjs-dist` (ghim trong `catalog:`) nạp lười khi thẻ PDF lọt vào màn hình
  (`packages/views/chat/chat-pdf-render.ts`), đọc số trang và vẽ phần trên trang 1 thành JPEG, nhớ theo id tin
  trong phiên; pdf.js xin storage theo dải byte khi CORS cho phép. PDF trên 10 MiB chỉ đọc khi người dùng mở bản
  xem trước; không đọc được thì thẻ vẫn mở được tệp. Không có cột / migration mới.
- Tải xuống trên web: `fetch` + `ReadableStream` theo `Content-Length` (không có thì theo `size_bytes`), Hủy bằng
  `AbortController`, lưu bằng blob; storage không cho CORS thì quay về link tải thường. Trong UniChat giữ tải
  gốc qua `desktopAPI.downloadURL` (bridge không báo tiến độ nên thẻ chỉ quay); hợp đồng bridge không đổi.

## Không làm

Mobile (làm sau trên cùng API); bỏ xem trước khỏi một tin; chuyển tiếp nhiều tin một lần; chép tự động.

## Ghi chú khi xong (2026-10-18)

Chỗ code đi khác hợp đồng trên, và vì sao:

- **F1:** chuyển tiếp là tất cả hoặc không — mọi phòng đích được kiểm trước, mọi bản sao commit trong một
  transaction; phòng đích từ chối gửi trả 403 `chat_forward_target_refused` kèm `room_id`, phòng không mở được
  trả 404. Tệp cùng phạm vi tải lên dùng chung id; khác phạm vi (DM neo ở workspace khác) thì chép byte sang phạm
  vi đích. Tin chữ chuyển tiếp mang luôn xem trước liên kết của tin gốc.
- **F2:** dòng bản chép kiêm luôn quyền giữ lượt chép (`status` pending/done, `claimed_at`): người giành được
  dòng mới gọi `CloudTranscribe`, không giữ kết nối DB trong lúc chờ nhà cung cấp; người đến giữa chừng nhận 409
  `chat_transcript_pending` và client hỏi lại có giãn cách; lượt giữ quá 5 phút được giành lại (gateway cho một
  lệnh chạy tới 4 phút); lỗi thì xoá lượt giữ.
- **F3:** consumer ở lane chậm nghe chủ đề hạ tầng mới `chat.link_preview.requested` (ghi trong transaction gửi
  tin), không nghe `chat.message.created` vì sự kiện đó ephemeral. Bộ chặn địa chỉ dùng lại
  `internal/emailhub/netguard`. Bảng xem trước là cache hệ thống: không audit, không `created_by`, không vào bản
  xuất tenant. Chi tiết ở ADR 0035.
- **F4:** route báo nhận là `POST /api/v1/workspaces/{workspaceID}/chat/delivered` (tối đa 50 phòng) để cổng
  thành viên và tenant chạy theo workspace trong path. Web báo nhận ở cả vỏ workspace (mọi trang, không chỉ
  trang chat). Danh sách DM ở cột trái mới hiện đã xem, chưa hiện đã tới.
- **F5:** `thread_participant_ids` lấy bằng một truy vấn lô riêng (dùng `idx_chat_messages_thread`), nên mọi đường
  trả tin (timeline, bắt kịp, nhảy tới tin, lấy một tin) đều có.
