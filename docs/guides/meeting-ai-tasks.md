# Hướng dẫn: AI biên bản họp → tạo việc (Meeting D08b)

Tài liệu dành cho người dùng workspace UniWork. Kỹ thuật triển khai: [`docs/meeting-d08b-delivery.md`](../meeting-d08b-delivery.md).

## Ai làm được gì?

| Vai trò | Trong phòng | Sau họp |
| --- | --- | --- |
| Thành viên workspace | Xem transcript, tóm tắt, chat; giơ tay, biểu cảm | Đọc tóm tắt và việc cần làm trên trang chi tiết cuộc họp |
| Chủ trì / quản trị workspace | Bật phụ đề, ghi hình, tạo tóm tắt AI, chọn việc → tạo task, mute participant | Tạo lại tóm tắt, tạo task, tải `.ics`, xem bản ghi |

## Chuẩn bị (quản trị / DevOps)

1. **LiveKit** — cuộc họp video cần LiveKit (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Local: `docker compose -f docker-compose.livekit.yml up` rồi `make start`.
2. **Tóm tắt AI** — cấu hình `ANTHROPIC_API_KEY` trên server. Không có key → nút tóm tắt ẩn (`ai_not_configured`).
3. **STT server (tùy chọn)** — đặt `MEETING_STT_AGENT_SECRET` và chạy worker trong [`deploy/meeting-stt-agent/`](../../deploy/meeting-stt-agent/). Khi bật, client ẩn Web Speech để tránh transcript trùng.
4. **Ghi hình (tùy chọn)** — `LIVEKIT_RECORDING_BUCKET` + biến `AWS_*`.

## Trong phòng họp

1. Vào phòng từ **Vào phòng họp** trên trang chi tiết (hoặc prejoin sau khi meeting `IN_PROGRESS`).
2. **Phụ đề (transcript)** — bật nút phụ đề trên thanh điều khiển (Chrome/Edge/Safari). Mỗi câu hoàn chỉnh được gửi lên server. *Mẹo:* khi giao việc, nói rõ tên người phụ trách (“An làm phần QA”, “deadline thứ Sáu”).
3. **Tab Copilot** (sidebar) — ghi chú nhanh, xem transcript, mục **Việc cần làm** sau khi có tóm tắt.
4. **Chat phòng** — tin nhắn được lưu và đưa vào input tóm tắt AI cùng transcript và ghi chú.
5. **Chủ trì** — tab **Mọi người**: mời thêm thành viên, tắt mic mềm (client) hoặc **Không cho phép nói (host)** (server, participant không publish lại được cho đến khi **Cho phép nói lại**).

## Tạo tóm tắt và task

### Trên trang chi tiết cuộc họp

1. Meeting đã **Đang diễn ra** hoặc **Đã kết thúc**.
2. Bấm **Tạo tóm tắt** (chủ trì). Cần ít nhất transcript, ghi chú hoặc chat.
3. Xem **Quyết định** và **Việc cần làm** do AI đề xuất (kèm gợi ý người phụ trách và hạn nói trong họp).
4. Tick các việc muốn đưa lên board → chọn **Gán cho** nếu cần sửa assignee → **Tạo N việc**.
5. Task mới nằm cột **Todo**, mô tả có dòng `Từ cuộc họp: <tiêu đề>`, liên kết nguồn `meeting` trên server.

### Trong phòng (tab Copilot → Việc cần làm)

Cùng quy trình: tạo tóm tắt từ header Copilot → tick action items → **Tạo việc trên UniWork**.

### Cách hệ thống gán người và hạn

- **Assignee:** server khớp tên AI với participant/meeting member (khớp chính xác hoặc một ứng viên duy nhất). Host có thể override trước khi tạo.
- **Hạn:** server parse ISO (`2026-09-10`), `ngày mai`, `thứ Sáu`, `next week`, v.v. theo thời điểm kết thúc dự kiến của cuộc họp. Không parse được → chỉ lưu text gợi ý trong mô tả task.

## Ghi hình và lịch

- **REC** — chủ trì bấm ghi hình khi egress đã cấu hình; mọi người thấy badge đỏ REC.
- **Thêm vào lịch** — tải file `.ics` (RFC 5545) có link tham gia workspace.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Không có nút tóm tắt | `ANTHROPIC_API_KEY` trống | Liên hệ admin bật AI |
| “Chưa có transcript…” | Chưa bật phụ đề / chưa chat / chưa ghi chú | Bật phụ đề hoặc chat trong phòng |
| Phụ đề không hiện | Trình duyệt không hỗ trợ Web Speech | Dùng Chrome/Edge/Safari hoặc bật STT server |
| Rớt phòng sau ~2 phút | Token LiveKit hết hạn (dev TTL ngắn) | Client tự refresh JWT; nếu vẫn lỗi, thoát và vào lại |
| Không gán được người | Tên AI mơ hồ (nhiều “An”) | Chọn **Gán cho** thủ công trước khi tạo task |

## Kiểm thử E2E LiveKit (developer)

```bash
docker compose -f docker-compose.livekit.yml up   # terminal 1
make start                                         # terminal 2
E2E_LIVEKIT=1 pnpm e2e e2e/meetings-livekit.spec.ts
```

Spec lifecycle (không cần LiveKit): `e2e/meetings.spec.ts`.

## STT worker (developer)

Xem [`deploy/meeting-stt-agent/README.md`](../../deploy/meeting-stt-agent/README.md): worker join room `uw_mtg_{meetingId}`, gửi segment tới `POST /api/v1/meetings/{id}/transcript/agent` với header `X-Meeting-Agent-Secret`.
