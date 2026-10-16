# Hướng dẫn: AI biên bản họp → tạo việc (Meeting D08b)

Tài liệu dành cho người dùng workspace UniWork. Kỹ thuật triển khai: [`docs/meeting-d08b-delivery.md`](../meeting-d08b-delivery.md).

## Ai làm được gì?

| Vai trò | Trong phòng | Sau họp |
| --- | --- | --- |
| Thành viên workspace | Xem transcript, tóm tắt, chat; giơ tay, biểu cảm | Đọc tóm tắt, việc cần làm và việc nào đã thành task trên trang chi tiết cuộc họp |
| Chủ trì / quản trị workspace | Bật phụ đề, ghi hình, tạo tóm tắt AI, chọn việc → tạo task, mute participant | Tạo lại tóm tắt, tạo task, tải `.ics`, xem bản ghi |

## Chuẩn bị (quản trị / DevOps)

1. **LiveKit** — cuộc họp video cần LiveKit (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Local: `make start` tự chạy container LiveKit và stream log (hoặc `make livekit-up`).
2. **Nhà cung cấp AI** — tóm tắt chạy qua AI gateway của server (cùng gateway với Hỏi UNI), cấu hình bằng biến môi trường (xem `.env.example`, `docs/ops/RUNBOOK_AI.md`):
   - `AI_PROVIDER` = `anthropic` | `openai` | `ollama` | `fake`. Để trống thì server tự chọn theo credential đang có (Anthropic trước).
   - `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL` tùy chọn); `OPENAI_API_KEY` + `OPENAI_BASE_URL` (OpenAI hoặc endpoint tương thích OpenAI); `OLLAMA_BASE_URL` (Ollama nội bộ, không cần key).
   - `fake` trả lời cố định, không gọi mạng: dùng cho dev local và E2E.
   - `AI_TIMEOUT_SECONDS` (mặc định 60) là thời gian tối đa chờ nhà cung cấp trả lời.
   - Không cấu hình nhà cung cấp nào → mọi tính năng AI ẩn; nút tóm tắt không hiện.
3. **Gói (plan)** — tóm tắt AI cần quyền gói `meeting.ai_summary` của tổ chức. Gói không có quyền này thì nút tóm tắt cũng ẩn (capabilities trả `ai_summary: false`); gọi thẳng API nhận 403 `entitlement_required`. Mỗi lần tóm tắt tính vào hạn mức token AI của tổ chức.
4. **STT server (tùy chọn)** — đặt `MEETING_STT_AGENT_SECRET` và chạy worker trong [`deploy/meeting-stt-agent/`](../../deploy/meeting-stt-agent/). Khi bật, client ẩn Web Speech để tránh transcript trùng.
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
2. Chủ trì (hoặc quản trị workspace) bấm **Tạo tóm tắt** trên trang chi tiết hoặc ở header tab Copilot. Cần ít nhất một nguồn: transcript, ghi chú, chat của cuộc họp, hoặc kết quả biểu quyết đã đóng. Khi chưa có nguồn nào, nút vẫn bấm tới được bằng bàn phím và nói rõ lý do.
3. Trong lúc AI làm việc (có thể tới một phút), nút hiện vòng quay và trình đọc màn hình được báo “Đang tạo tóm tắt”. Mỗi cuộc họp chỉ chạy một lần tóm tắt tại một thời điểm; mỗi người tạo tối đa khoảng 6 lần mỗi phút.
4. Đã có tóm tắt thì **Tạo lại tóm tắt** luôn hỏi xác nhận trước, ở cả trang chi tiết và Copilot. Bản mới thay bản cũ; các task đã tạo từ bản cũ vẫn giữ nguyên. Lựa chọn đang tick trên bản cũ bị bỏ.
5. Dòng nhãn AI dưới tóm tắt ghi nguồn thật sự có lúc tạo (ví dụ “Từ bản ghi lời thoại và tin nhắn”), thời điểm và model. Có dữ liệu mới sau đó thì hiện “Có dữ liệu mới sau khi tạo tóm tắt”.

### Tạo task từ việc cần làm

1. Danh sách **Việc cần làm** hiện chữ AI ghi (người phụ trách, hạn) và **gợi ý của server** trước khi tạo: người được gán (→ tên) và ngày hạn đã đọc ra.
2. Tick các việc muốn đưa lên board → **Tạo N việc** (trang chi tiết) hoặc **Tạo việc trong UniWork (N)** (Copilot). Hộp thoại xem lại mở ra cho từng việc: **Gán cho**, **Độ ưu tiên**, **Hạn chót**, và **Dự án** chung cho cả lô.
   - Giá trị ban đầu là gợi ý của server; chủ trì sửa tùy ý. Chọn **Không gán** hoặc xóa ngày hạn nghĩa là task không có người phụ trách / không có hạn. Server không tự đoán lại từ chữ AI: lựa chọn của chủ trì là cuối cùng.
   - Dự án mặc định là dự án của cuộc họp (khi dự án đó còn tồn tại), ở cả trang chi tiết và Copilot. Chọn **Không thuộc dự án** thì task không thuộc dự án nào.
3. Bấm **Tạo N việc** trong hộp thoại. Cả lô được tạo trong một giao dịch: lỗi ở một việc thì không việc nào được tạo. Xong thì có thông báo kèm nút **Xem việc**.
4. Việc đã thành task được đánh dấu **Đã tạo việc** kèm liên kết tới task, ô chọn bị khóa. Mọi người đang mở cuộc họp thấy dấu này ngay (sự kiện realtime `summary.tasks_linked`).
5. Một việc chỉ thành task một lần: tạo lại việc đã chuyển bị từ chối (`summary_item_already_converted`); chọn từ bản tóm tắt cũ sau khi đã tạo lại bị từ chối (`summary_superseded`).
6. Task mới nằm cột **Todo**, nguồn `meeting`. Mô tả có dòng `Từ cuộc họp: <tiêu đề>`; khi task không có người phụ trách hay hạn, chữ AI ghi được giữ lại trong mô tả (“Người phụ trách (AI): …”, “Hạn (AI): …”).

### Cách server gợi ý người và hạn

- **Người phụ trách:** server so tên AI ghi với các thành viên workspace có thể được giao việc (thành viên đã bị vô hiệu hóa và khách không tính), theo tên hồ sơ và tên hiển thị trong cuộc họp. Khớp khi bằng cả tên, hoặc bằng các chữ cuối của tên (“An”, “Văn An” khớp “Nguyễn Văn An”; “An” không khớp “Thanh”, “Lan” không khớp “Lan Anh”). Danh xưng đứng trước (“anh”, “chị”, “sếp”, “Mr”…) được bỏ; dấu tiếng Việt và chữ hoa không ảnh hưởng (“ĐỨC” khớp “Đức”, “Duc”). Nhiều người cùng khớp thì chỉ chọn khi đúng một người trong số đó dự họp; còn lại không gợi ý ai.
- **Hạn:** server đọc ISO (`2026-09-10`), `ngày mai`, `thứ Sáu`, `thứ Sáu tuần sau`, `next week`, v.v. theo ngày của cuộc họp (giờ kết thúc thực tế, nếu không có thì giờ kết thúc dự kiến) và theo múi giờ của cuộc họp (mặc định Asia/Ho_Chi_Minh). Không đọc được thì không gợi ý ngày.

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
| `summary_superseded` (409) | Tóm tắt vừa được tạo lại (bởi bạn hoặc chủ trì khác) | Chọn lại việc trong bản mới |
| `summary_item_already_converted` (409) | Việc đã thành task trước đó (`fields.indexes`) | Danh sách tự cập nhật; chọn lại các việc còn lại |
| `not_meeting_host` (403) | Không phải chủ trì hay quản trị workspace | Nhờ chủ trì tạo |
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
