# MeetingScribeCannotJoin — thư ký AI không vào được phòng họp

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.1, §4.6; ADR 0038

## Triệu chứng

- Alert `MeetingScribeCannotJoin`: hơn 2 sự kiện `scribe_dispatch_failed` (LiveKit từ chối `CreateDispatch`) hoặc `scribe_failed` (ba lần gọi liên tiếp mà agent không báo `/agent/started` trong 60 giây khi phòng có người) trong 15 phút.
- Phòng họp hiện chip "AI ghi lời đang gặp lỗi"; phụ đề quay về Web Speech của từng máy (D12), transcript của cuộc họp chỉ có lời từ Web Speech.
- Cuộc họp không bị ảnh hưởng gì khác: thư ký lỗi không chặn vào phòng.

## Kiểm tra

1. Tỉ lệ từng loại:
   ```promql
   sum by (event) (increase(uniwork_meetings_total{event=~"scribe_.*"}[15m]))
   ```
   `scribe_dispatched` có mà `scribe_active` không có: agent nhận job nhưng không gọi được server. Chỉ có `scribe_dispatch_failed`: LiveKit không nhận dispatch.
2. Worker agent có chạy không: `kubectl -n uniwork get pods -l app.kubernetes.io/name=uniwork-meeting-agent` và `kubectl -n uniwork logs deploy/uniwork-meeting-agent --since=15m | grep -E 'reject|leaving|api retry|stt'`. Log chỉ có id và độ dài, không có lời nói.
3. Lần chạy trong DB:
   ```sql
   SELECT status, count(*), max(failures), max(updated_at)
   FROM meeting_scribe_runs WHERE created_at > now() - interval '1 hour' GROUP BY 1;
   SELECT id, meeting_id, dispatch_id, failures, dispatched_at
   FROM meeting_scribe_runs WHERE status IN ('DISPATCHED', 'FAILED') ORDER BY updated_at DESC LIMIT 20;
   ```
   `dispatch_id` rỗng: `CreateDispatch` lỗi. Có `dispatch_id` mà vẫn `DISPATCHED`: agent không tới `/agent/started`.
4. Agent gọi server có bị chặn không: `sum by (status) (rate(uniwork_http_requests_total{route=~"/api/v1/meetings/{meetingID}/agent/.*"}[5m]))`. 404 hàng loạt: `JWT_SECRET` của BE đã đổi sau khi dispatch (token cũ hết hiệu lực). 401: agent gửi sai header. 429: chạm budget `meeting-agent`.
5. Phiên bản LiveKit dùng chung (≥ v1.9.12 theo kết quả S0) và worker đã đăng ký `agent_name=uniwork-scribe`: log khởi động của pod agent có dòng đăng ký worker.

## Khắc phục

- Pod agent không chạy hoặc crash: `kubectl -n uniwork rollout restart deploy/uniwork-meeting-agent`. Pod cũ drain tới 4 giờ, nên chỉ restart khi pod hiện tại không nhận job.
- `CreateDispatch` bị từ chối: kiểm `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` của BE và secret `uniwork-meeting-agent` cùng một cặp với LiveKit.
- Agent không gọi được BE: kiểm NetworkPolicy `uniwork-meeting-agent` (egress tới `uniwork-be`) và rule ingress của `uniwork` cho pod agent.
- Agent không vào được phòng LiveKit (log worker không đăng ký được, hoặc vào phòng nhưng không nhận được âm thanh): NetworkPolicy chỉ khớp IP. `meetingAgent.egress.livekit.cidrs` phải chứa mọi IP mà URL agent dùng (`meetingAgent.livekitUrl`; khi bật chart, URL và `cidrs` đều bắt buộc và đặt cùng nhau, không có mặc định) phân giải ra, và TURN nếu media đi qua TURN; `meetingAgent.egress.livekit.ports` phải gồm cổng tín hiệu (443/7880 WSS, 7881 TCP) và dải UDP media của cấu hình LiveKit (`rtc.port_range_start`–`rtc.port_range_end`, mặc định 50000–60000). Kiểm: `kubectl -n uniwork exec deploy/uniwork-meeting-agent -- python -c "import socket; print(socket.gethostbyname('<host của LIVEKIT_URL>'))"`, so với values, rồi `helm upgrade`.
- Bật `otlpEndpoint`: thêm địa chỉ collector vào `meetingAgent.egress.extra`, nếu không span bị chặn (agent vẫn chạy).
- Lỗi STT (key hết hạn, vượt giới hạn phiên mới mỗi phút của AssemblyAI): thay secret `ASSEMBLYAI_API_KEY` rồi restart agent.
- Cần tắt ngay cho mọi tổ chức: `MEETING_SCRIBE_ENABLED=false` trên BE, hoặc tắt cờ `meeting_scribe` trong console `/admin`. Lần chạy đang mở được vòng quét đóng; phòng quay về Web Speech.

## Leo thang

- Lỗi kéo dài quá 30 phút trong giờ họp, hoặc mọi cuộc họp đều không có thư ký: nâng sev 2, gọi on-call backend.
- Nguyên nhân ở LiveKit dùng chung (dispatch bị từ chối, worker không đăng ký được): báo người vận hành LiveKit (`deploy/livekit/README.md`), vì lms-core dùng chung server.
- Nghi có worker không đặt `agent_name` đăng ký vào LiveKit (nó sẽ tự vào mọi phòng): báo ngay ops, theo S0 results §3.
