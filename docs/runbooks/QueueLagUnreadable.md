# QueueLagUnreadable — không đọc được độ trễ hàng đợi

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/meeting-concurrency-assessment.md`](../meeting-concurrency-assessment.md) (G9)

## Triệu chứng

- Alert `QueueLagUnreadable`: `uniwork_outbox_lag_up` hoặc `uniwork_meeting_queue_lag_up{queue}` bằng 0 suốt 5 phút.
- Panel tuổi dòng chờ của outbox hoặc webhook inbox trống: khi truy vấn đo lỗi hoặc quá thời gian, gauge lag vắng mặt thay vì báo 0, nên [OutboxLagHigh](OutboxLagHigh.md) và [WebhookInboxLagHigh](WebhookInboxLagHigh.md) không thể kêu.
- Thường đi cùng DB quá tải: chính lúc hàng đợi dễ nghẽn nhất.

## Kiểm tra

1. Gauge nào đang 0?
   ```promql
   uniwork_outbox_lag_up
   uniwork_meeting_queue_lag_up
   ```
2. DB có đang quá tải không? Xem dashboard *UniWork · DB* (pool chờ, p95 query) và [ApiLatencyP95High](ApiLatencyP95High.md). Truy vấn đo lag có timeout riêng; DB chậm làm nó hết giờ trước.
3. Đo tay độ trễ bằng SQL, không qua collector:
   ```sql
   SELECT now() - min(created_at) FROM outbox_events WHERE status IN ('PENDING', 'PROCESSING');
   SELECT now() - min(received_at) FROM webhook_inbox WHERE status IN ('PENDING', 'PROCESSING');
   ```
4. Log của collector: `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep -i lag`.

## Khắc phục

- DB quá tải: xử lý theo [ApiLatencyP95High](ApiLatencyP95High.md). Gauge tự trở lại khi truy vấn đo chạy kịp.
- Độ trễ đo tay lớn: xử lý tiếp theo [OutboxLagHigh](OutboxLagHigh.md) hoặc [WebhookInboxLagHigh](WebhookInboxLagHigh.md) như khi alert đó kêu.
- Bảng sự kiện phình to: job retention (`server/internal/service/event_retention.go`) xoá dòng đã xong theo lô mỗi giờ; sau đợt xoá đầu tiên nên `VACUUM (ANALYZE)` các bảng `outbox_events`, `webhook_inbox`, `meeting_provider_events`.

## Leo thang

- Kéo dài hơn 15 phút, hoặc đo tay thấy lag > 5 phút: nâng sev 1, gọi on-call backend.
- Truy vấn đo lỗi trong khi DB khoẻ: lỗi ở collector (`server/internal/metrics`), mở issue cho backend.
