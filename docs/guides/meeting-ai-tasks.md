# Hướng dẫn: AI biên bản họp → tạo việc (Meeting D08b)

Tài liệu dành cho người dùng workspace UniWork. Kỹ thuật triển khai: [`docs/meeting-d08b-delivery.md`](../meeting-d08b-delivery.md).

## Ai làm được gì?

| Vai trò | Trong phòng | Sau họp |
| --- | --- | --- |
| Thành viên workspace | Xem transcript, tóm tắt, chat; giơ tay, biểu cảm | Đọc tóm tắt và **Việc sau họp** (chờ xử lý, đã giao kèm tiến độ task, đã bỏ qua) trên trang chi tiết cuộc họp |
| Chủ trì / quản trị workspace | Bật phụ đề, ghi hình, tạo tóm tắt AI, giao việc, mute participant | Tạo lại tóm tắt, giao / bỏ qua / khôi phục / thêm việc, tải `.ics`, xem bản ghi |
| Thư ký cuộc họp | Tạo tóm tắt AI, giao việc | Tạo lại tóm tắt, giao / bỏ qua / khôi phục / thêm việc |

## Chuẩn bị (quản trị / DevOps)

1. **LiveKit** — cuộc họp video cần LiveKit (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Local: `make start` tự chạy container LiveKit và stream log (hoặc `make livekit-up`).
2. **Nhà cung cấp AI** — tóm tắt chạy qua AI gateway của server (cùng gateway với Hỏi UNI), cấu hình bằng biến môi trường (xem `.env.example`, `docs/ops/RUNBOOK_AI.md`):
   - `AI_PROVIDER` = `anthropic` | `openai` | `ollama` | `fake`. Để trống thì server tự chọn theo credential đang có (Anthropic trước).
   - `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL` tùy chọn); `OPENAI_API_KEY` + `OPENAI_BASE_URL` (OpenAI hoặc endpoint tương thích OpenAI); `OLLAMA_BASE_URL` (Ollama nội bộ, không cần key).
   - `fake` trả lời cố định, không gọi mạng: dùng cho dev local và E2E.
   - `AI_TIMEOUT_SECONDS` (mặc định 60) là thời gian tối đa chờ nhà cung cấp trả lời.
   - Không cấu hình nhà cung cấp nào → mọi tính năng AI ẩn; nút tóm tắt không hiện.
3. **Gói (plan)** — tóm tắt AI cần quyền gói `meeting.ai_summary` của tổ chức. Gói không có quyền này thì nút tóm tắt cũng ẩn (capabilities trả `ai_summary: false`); gọi thẳng API nhận 403 `entitlement_required`. Mỗi lần tóm tắt tính vào hạn mức token AI của tổ chức.
4. **Thư ký AI (tùy chọn)** — đặt `MEETING_SCRIBE_ENABLED=true`, bật cờ `meeting_scribe` cho tổ chức và chạy agent trong [`apps/meeting-agent/`](../../apps/meeting-agent/) (ADR 0037). Khi agent có trong phòng, client đọc phụ đề của agent và tắt Web Speech để tránh transcript trùng.
5. **Ghi hình (tùy chọn)** — `LIVEKIT_RECORDING_BUCKET` + biến `AWS_*`.

## Trong phòng họp

1. Vào phòng từ **Vào phòng họp** trên trang chi tiết (hoặc prejoin sau khi meeting `IN_PROGRESS`).
2. **Phụ đề (transcript)** — bật nút phụ đề trên thanh điều khiển (Chrome/Edge/Safari). Mỗi câu hoàn chỉnh được gửi lên server. *Mẹo:* khi giao việc, nói rõ tên người phụ trách và hạn (“An làm phần QA”, “deadline thứ Sáu”).
3. **Tab Copilot** (sidebar) — ghi chú nhanh, xem transcript, mục **Việc cần làm** sau khi có tóm tắt.
4. **Chat phòng** — tin nhắn được lưu và đưa vào input tóm tắt AI.
5. **Biểu quyết** — kết quả của các nội dung biểu quyết đã đóng cũng là nguồn của tóm tắt.
6. **Chủ trì** — tab **Mọi người**: mời thêm thành viên, tắt mic mềm (client) hoặc **Không cho phép nói (host)** (server, participant không publish lại được cho đến khi **Cho phép nói lại**).

## Tạo tóm tắt và task

### Tạo tóm tắt

1. Meeting đã **Đang diễn ra** hoặc **Đã kết thúc**.
2. Chủ trì, thư ký hoặc quản trị workspace bấm **Tạo tóm tắt** trên trang chi tiết hoặc ở header tab Copilot. Cần ít nhất một nguồn: transcript, ghi chú, chat của cuộc họp, hoặc kết quả biểu quyết đã đóng. Khi chưa có nguồn nào, nút vẫn bấm tới được bằng bàn phím và nói rõ lý do.
3. Trong lúc AI làm việc (có thể tới một phút), nút hiện vòng quay và trình đọc màn hình được báo “Đang tạo tóm tắt”. Mỗi cuộc họp chỉ chạy một lần tóm tắt tại một thời điểm (nếu máy chủ dừng giữa chừng, cuộc họp đó chờ tối đa 3 phút mới tóm tắt lại được); mỗi người tạo tối đa khoảng 6 lần mỗi phút.
4. Đã có tóm tắt thì **Tạo lại tóm tắt** luôn hỏi xác nhận trước, ở cả trang chi tiết và Copilot. Bản mới thay bản cũ. Trong **Việc sau họp**, chỉ việc AI còn chờ xử lý bị thay; việc đã giao, đã bỏ qua và việc thêm tay giữ nguyên, và AI được báo các việc đó để không đề xuất lại.
5. Dòng nhãn AI dưới tóm tắt ghi nguồn thật sự có lúc tạo (ví dụ “Từ bản ghi lời thoại và tin nhắn”), thời điểm và model. Có dữ liệu mới sau đó thì hiện “Có dữ liệu mới sau khi tạo tóm tắt”.

### Căn cứ của kết luận và việc

Mỗi kết luận AI rút ra và mỗi việc AI đề xuất có thể kèm chip **Căn cứ · n**: những câu trong transcript, ghi chú hay tin nhắn chat mà AI dựa vào. Bấm chip để xem chính các câu đó (ai nói hoặc viết, lúc nào, nội dung). Với một câu nói, nếu cuộc họp có bản ghi hình đã xong bao trùm thời điểm đó thì có thêm nút **Mở bản ghi tại m:ss** mở bản ghi đúng giây ấy.

- AI chỉ được dẫn những câu thật sự có trong đầu vào của lần tóm tắt; server bỏ mọi tham chiếu khác. Việc không còn căn cứ hợp lệ vẫn được giữ, chỉ không có chip.
- Việc thêm tay không có căn cứ. Tóm tắt tạo trước khi có tính năng này không có chip.
- Câu đã bị xóa sau đó thì chip báo “Các nguồn này không còn.”

### Việc sau họp

Mục **Việc sau họp** trên trang chi tiết (và mục **Việc cần làm** trong Copilot) liệt kê mọi việc của cuộc họp, chia ba nhóm: **Chờ xử lý**, **Đã giao**, **Đã bỏ qua** (thu gọn). Đầu mục đếm từng nhóm và tiến độ “Đã xong x/y · z quá hạn”. Mọi thành viên workspace xem được; chỉ chủ trì, thư ký và quản trị workspace thao tác.

1. Mỗi việc chờ xử lý hiện chữ được nhắc (người phụ trách, hạn) và **gợi ý của server**: người được gán (→ tên) và ngày hạn đã đọc ra.
2. Tick các việc → **Giao N việc**. Hộp thoại xem lại mở ra cho từng việc: **Tiêu đề**, **Gán cho**, **Độ ưu tiên**, **Hạn chót**, và **Dự án** chung cho cả lô.
   - Giá trị ban đầu là gợi ý của server; người giao sửa tùy ý. Chọn **Không gán** hoặc xóa ngày hạn nghĩa là task không có người phụ trách / không có hạn. Server không tự đoán lại từ chữ được nhắc: lựa chọn của người giao là cuối cùng.
   - Dự án mặc định là dự án của cuộc họp (khi dự án đó còn tồn tại). Chọn **Không thuộc dự án** thì task không thuộc dự án nào.
3. Cả lô được tạo trong một giao dịch: lỗi ở một việc thì không việc nào được tạo. Người được giao nhận thông báo (một thông báo cho mỗi lần giao).
4. **Bỏ qua** một việc (lý do không bắt buộc) đưa nó vào nhóm **Đã bỏ qua**; **Khôi phục** đưa về chờ xử lý. **Thêm việc** ghi một việc tóm tắt bỏ sót.
5. Task bị xóa thì việc của nó quay về chờ xử lý. Mọi người đang mở cuộc họp thấy thay đổi ngay (sự kiện realtime `action_item.*`).
6. Task mới nằm cột **Todo**, nguồn `meeting`. Mô tả có dòng `Từ cuộc họp: <tiêu đề>`; khi task không có người phụ trách hay hạn, chữ được nhắc giữ lại trong mô tả (“Người phụ trách (AI): …”, “Hạn (AI): …”).

### Việc còn tồn từ các cuộc họp trước

Cuộc họp **chưa bắt đầu** hoặc **đang diễn ra** có dự án thì trang chi tiết hiện mục **Việc còn tồn từ các cuộc họp trước** (Copilot: nhóm thu gọn **Việc còn tồn (n)** trong **Việc cần làm**): các việc đã giao mà task chưa xong (trạng thái không thuộc nhóm hoàn thành hay đã hủy) từ những cuộc họp **đã kết thúc** khác cùng workspace và cùng dự án, bắt đầu trước cuộc họp này (giờ bắt đầu thực tế nếu có, không thì theo lịch). Việc gom theo cuộc họp gốc, sắp theo hạn (không hạn xếp cuối), tối đa 100. Không có việc nào thì mục không hiện; cuộc họp không có dự án không có mục này.

### Cách server gợi ý người và hạn

- **Người phụ trách:** server so tên AI ghi với các thành viên workspace có thể được giao việc (thành viên đã bị vô hiệu hóa và khách không tính), theo tên hồ sơ và tên hiển thị trong cuộc họp. Thứ tự ưu tiên: khớp cả tên; khớp các chữ cuối của tên (“An”, “Văn An” khớp “Nguyễn Văn An”; “An” không khớp “Thanh”); cuối cùng, một chữ đơn khớp một chữ bất kỳ trong tên nếu chỉ đúng một người như vậy (“Hùng” khớp “Hùng Nguyễn”, “Lan” khớp một “Lan Anh” duy nhất). Danh xưng đứng trước (“anh”, “chị”, “sếp”, “Mr”…) được đọc cả hai cách, nên “anh Tuấn” ưu tiên người tên đúng “Tuấn”, còn tên đệm “Anh” trong “Nguyễn Anh Thư” vẫn khớp. Dấu tiếng Việt và chữ hoa không ảnh hưởng (“ĐỨC” khớp “Đức”, “Duc”). Nhiều người cùng khớp thì chỉ chọn khi đúng một người trong số đó dự họp; còn lại không gợi ý ai.
- **Hạn:** server đọc ISO (`2026-09-10`), `ngày mai`, `thứ Sáu`, `thứ Sáu tuần sau`, `next week`, v.v. theo ngày của cuộc họp (giờ kết thúc thực tế, nếu không có thì giờ kết thúc dự kiến) và theo múi giờ của cuộc họp (mặc định Asia/Ho_Chi_Minh). Ngày đã qua so với cuộc họp (kể cả `05/09` khi họp ngày 06/09) không được gợi ý; riêng ngày tháng 1–2 nói trong cuộc họp tháng 12 được hiểu là năm sau. Cụm như “đầu tuần sau”, “tuần trước”, “tuần sau nữa” và số thứ tự (“lần thứ hai”) không được đoán thành ngày. Không đọc được thì không gợi ý ngày.

## Ghi hình và lịch

- **REC** — chủ trì bấm ghi hình khi egress đã cấu hình; mọi người thấy badge đỏ REC.
- **Thêm vào lịch** — tải file `.ics` (RFC 5545) có link tham gia workspace.

## Xử lý sự cố

| Triệu chứng / mã lỗi | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Không có nút tóm tắt, hiện “Tóm tắt AI chưa được bật…” | Chưa cấu hình nhà cung cấp AI, hoặc gói của tổ chức không có `meeting.ai_summary` | Admin cấu hình `AI_PROVIDER` / key; hoặc nâng gói |
| `ai_not_configured` (503) | Server không có nhà cung cấp AI | Cấu hình `AI_PROVIDER` và credential tương ứng |
| `entitlement_required` (403) | Gói không có tóm tắt AI | Nâng gói của tổ chức |
| `summary_no_source` (409) | Chưa có transcript, ghi chú, chat hay biểu quyết đã đóng | Bật phụ đề, ghi chú hoặc chat trong phòng |
| `summary_in_progress` (409) | Một lần tóm tắt của cuộc họp này đang chạy | Chờ; tóm tắt mới tự hiện khi xong |
| `ai_timeout` (504) | Nhà cung cấp trả lời quá `AI_TIMEOUT_SECONDS` | Thử lại; họp rất dài hoặc model chậm thì tăng `AI_TIMEOUT_SECONDS` |
| `ai_failed` (502) | Nhà cung cấp lỗi hoặc trả nội dung không đọc được | Thử lại sau ít phút; xem log `meetings: summary failed` (có `usage_event_id`) |
| `ai_quota_exceeded` (402) | Tổ chức hết hạn mức token AI của tháng | Tăng hạn mức hoặc chờ tháng sau |
| `ai_rate_limited` (429, `retry_after`) | Gọi AI quá nhanh | Chờ đúng số giây được báo |
| `rate_limited` (429) | Vượt giới hạn tạo tóm tắt (khoảng 6 lần/phút/người) | Chờ một phút |
| `action_item_not_found` (404) | Việc không còn: tóm tắt vừa được tạo lại (`fields.action_item_ids`) | Chọn lại việc còn chờ xử lý |
| `action_item_not_pending` (409) | Việc đã được giao hoặc bỏ qua trước đó (`fields.action_item_ids`) | Danh sách tự cập nhật; chọn lại các việc còn lại |
| `action_item_not_dismissed` (409) | Khôi phục một việc không ở nhóm Đã bỏ qua | Tải lại danh sách |
| `active_duplicate_task` (409) | Việc trùng tiêu đề với một task đang mở trong cùng dự án, hoặc hai việc trùng nhau trong lô (`fields.action_item_ids`) | Hộp thoại đánh dấu các việc trùng: đổi tiêu đề, đổi dự án hoặc bỏ chọn rồi giao lại |
| `not_meeting_clerk` (403) | Không phải chủ trì, thư ký hay quản trị workspace | Nhờ chủ trì hoặc thư ký |
| `assignee_not_member` (422) | Người được gán không còn trong workspace | Chọn người khác |
| `not_found` (404) khi tạo task | Dự án đã chọn không còn | Chọn dự án khác hoặc **Không thuộc dự án** |
| Phụ đề không hiện | Trình duyệt không hỗ trợ Web Speech | Dùng Chrome/Edge/Safari hoặc bật STT server |
| Rớt phòng sau ~2 phút | Token LiveKit hết hạn (dev TTL ngắn) | Client tự refresh JWT; nếu vẫn lỗi, thoát và vào lại |
| Không có gợi ý người phụ trách | Tên AI ghi khớp nhiều người, hoặc không khớp ai | Chọn **Gán cho** trong hộp thoại trước khi tạo |

## Kiểm thử E2E LiveKit (developer)

```bash
make start
E2E_LIVEKIT=1 pnpm e2e e2e/meetings-livekit.spec.ts
```

Spec lifecycle (không cần LiveKit): `e2e/meetings.spec.ts`.

## STT worker (developer)

Xem [`deploy/meeting-stt-agent/README.md`](../../deploy/meeting-stt-agent/README.md): worker join room `uw_mtg_{meetingId}`, gửi segment tới `POST /api/v1/meetings/{id}/transcript/agent` với header `X-Meeting-Agent-Secret`.
