# OutboxLagHigh — dòng outbox chờ quá 60 giây

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/ops/RUNBOOK_OUTBOX.md`](../ops/RUNBOOK_OUTBOX.md)

## Triệu chứng

- Alert `OutboxLagHigh`: `max(uniwork_outbox_pending_age_seconds) > 60` liên tục 2 phút.
- Bảng công việc/chat không tự cập nhật, phải F5; thông báo và email tới muộn; hội nghị không tự bắt đầu.
- Panel **Tuổi dòng pending cũ nhất theo topic** tăng tuyến tính (đường thẳng đi lên = không có gì được xử lý).

## Kiểm tra

1. Topic nào kẹt?
   ```promql
   max by (topic) (uniwork_outbox_pending_age_seconds)
   sum by (topic) (uniwork_outbox_pending_total)
   ```
   Một topic → consumer của topic đó lỗi. Mọi topic → dispatcher không chạy (tiến trình API vừa restart? DB không cho claim?).
2. `sum(rate(uniwork_outbox_delivered_total[5m]))` phẳng ở 0 trong khi pending tăng = worker chết. `rate(uniwork_outbox_retry_total[5m])` tăng đều = một consumer đang ném lỗi và thử lại.
3. Log: `docker compose logs --since 15m server | grep 'outbox process'` (mức warn có tên consumer và `trace_id`).
4. SQL trực tiếp:
   ```sql
   SELECT topic, count(*), min(created_at), max(attempts)
   FROM outbox_events WHERE done_at IS NULL AND dead_at IS NULL
   GROUP BY topic ORDER BY 3;
   ```
5. Lấy `correlation_id` (= trace id) của dòng cũ nhất, mở `/admin/trace/<id>` để thấy command gốc và audit đi kèm.
6. Consumer realtime kẹt vì Redis? Panel **Redis relay đang nối** (`uniwork_realtime_redis_connected`) phải là 1 khi có `REDIS_URL`.

## Khắc phục

- Dispatcher không chạy → restart API (`docker compose restart server`); dispatcher là goroutine trong tiến trình, không có service riêng.
- Consumer ngoài lỗi (LiveKit, SMTP, webhook) → sửa cấu hình env của provider đó (`LIVEKIT_*`, `SMTP_*`), restart API; dòng pending tự chạy tiếp với backoff, không cần can thiệp DB.
- Dòng đã sang dead letter sau khi sửa → theo [OutboxDeadLetter](OutboxDeadLetter.md) để phát lại.
- Bảng `outbox_events` phình (hàng triệu dòng done) làm claim chậm → kiểm tra job dọn `done_at` cũ; tạm thời `DELETE FROM outbox_events WHERE done_at < now() - interval '30 days'` theo lô nhỏ.

## Leo thang

- Pending age > 10 phút hoặc mọi topic kẹt → nâng sev 1, gọi on-call backend.
- Nguyên nhân là provider ngoài không phục hồi trong 1 giờ → báo người giữ hợp đồng provider, thông báo cho tổ chức bị ảnh hưởng qua admin.
