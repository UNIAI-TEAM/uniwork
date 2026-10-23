# WebhookInboxLagHigh — webhook LiveKit chờ xử lý quá 30 giây

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/meeting-concurrency-assessment.md`](../meeting-concurrency-assessment.md) (G9)

## Triệu chứng

- Alert `WebhookInboxLagHigh`: `max(uniwork_meeting_webhook_inbox_oldest_pending_seconds) > 30` liên tục 2 phút.
- Danh sách người trong phòng và điểm danh cập nhật chậm hoặc sai; cuộc họp đã hết người vẫn hiện "đang diễn ra"; bản ghi hình không gắn vào cuộc họp.
- Panel **Webhook inbox: tuổi dòng chờ cũ nhất** tăng đều. Đường thẳng đi lên nghĩa là worker không xử lý được dòng nào.

## Kiểm tra

1. Webhook có vào không, và có được xử lý không?
   ```promql
   rate(uniwork_meeting_webhook_received_total[5m])
   rate(uniwork_meeting_webhook_processed_total[5m])
   rate(uniwork_meeting_webhook_errors_total[5m])
   ```
   Có received, không có processed: worker đứng. Errors tăng đều: một loại sự kiện đang lỗi và thử lại theo backoff.
2. LiveKit có bị chặn ở cửa không? `sum by (status) (rate(uniwork_http_requests_total{route="/api/v1/integrations/livekit/webhook"}[5m]))`. Có 429 hoặc 5xx thì xem [ApiRateLimitedSpike](ApiRateLimitedSpike.md) hoặc [ApiErrorRateHigh](ApiErrorRateHigh.md) trước.
3. SQL trực tiếp:
   ```sql
   SELECT status, event_type, count(*), min(received_at), max(attempt_count)
   FROM webhook_inbox WHERE status IN ('PENDING', 'PROCESSING')
   GROUP BY 1, 2 ORDER BY 4;
   SELECT id, event_type, attempt_count, next_attempt_at, last_error
   FROM webhook_inbox WHERE status IN ('PENDING', 'PROCESSING')
   ORDER BY received_at LIMIT 20;
   ```
   Dòng `PROCESSING` có `next_attempt_at` đã qua là lease hết hạn; worker trả nó về `PENDING` ở tick sau. `last_error` giống nhau trên nhiều dòng cho biết nguyên nhân chung.
4. DB có đang quá tải không? Xem dashboard *UniWork · DB* (pool chờ, p95 query). Worker webhook dùng chung pool với API.
5. Log: `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep -i webhook`.

## Khắc phục

- Worker đứng (không có processed, không có lỗi): restart BE bằng `kubectl -n uniwork rollout restart deploy/uniwork-be`. Worker là goroutine trong tiến trình API, không có deployment riêng.
- Một loại sự kiện lỗi lặp lại: sửa nguyên nhân trong `last_error` (thường là cuộc họp hoặc phiên không còn khớp với phòng LiveKit). Dòng tự chạy lại theo backoff. Sau số lần tối đa, dòng chuyển sang `DEAD_LETTER` và không tự chạy nữa.
- DB quá tải: xử lý theo [ApiLatencyP95High](ApiLatencyP95High.md). Hàng đợi webhook tự rút khi DB hồi lại.
- Bão webhook (nhiều phòng cùng mở hoặc đóng): `MEETING_WEBHOOK_BATCH` và `MEETING_WEBHOOK_CONCURRENCY` trong `deploy/app/env/uniwork-be.env` quyết định tốc độ rút. Chỉ tăng khi DB còn dư pool.

## Leo thang

- Lag > 5 phút, hoặc có cuộc họp đang diễn ra mà điểm danh sai: nâng sev 1, gọi on-call backend.
- Nguyên nhân nằm ở LiveKit (webhook không tới, `received` bằng 0 trong khi có phòng đang họp): báo người vận hành LiveKit dùng chung với lms-core (`deploy/livekit/README.md`).
