# OutboxDeadLetter — có dòng outbox mới bị dead letter

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/ops/RUNBOOK_OUTBOX.md`](../ops/RUNBOOK_OUTBOX.md)

## Triệu chứng

- Alert `OutboxDeadLetter`: `sum(increase(uniwork_outbox_dead_total[15m])) > 0`.
- Một sự kiện cụ thể không bao giờ tới nơi: một cuộc họp không lên lịch được ở provider, một email không gửi, một màn hình của đúng một tổ chức không cập nhật — trong khi mọi thứ khác bình thường.
- Panel **Dead letter theo topic** (`uniwork_outbox_dead_letter_total{topic}`) nhảy lên và giữ nguyên: dead letter **không tự chạy lại**.

## Kiểm tra

1. Dòng nào, lỗi gì:
   ```sql
   SELECT id, topic, attempts, last_error, dead_at, correlation_id
   FROM outbox_events WHERE dead_at IS NOT NULL OR status = 'DEAD_LETTER'
   ORDER BY dead_at DESC LIMIT 50;
   ```
   `last_error` nêu tên consumer (`realtime: …`, `meeting-provider: …`, `mail: …`).
2. Mở `/admin/trace/<correlation_id>` để thấy command gốc, tổ chức và audit đi kèm; hỏi được ai bị ảnh hưởng mà không cần đọc payload.
3. Cùng topic, cùng lỗi trên nhiều dòng → cấu hình/provider hỏng. Một dòng lẻ → payload xấu hoặc bản ghi đích đã bị xóa (ví dụ meeting bị xóa trước khi provider được gọi).
4. Log tại thời điểm `dead_at`: `docker compose logs server | grep 'outbox dead letter'` (mức error, có `trace_id`).

## Khắc phục

- Sửa nguyên nhân trước (env provider, dữ liệu đích), rồi phát lại — mọi consumer idempotent theo `id` nên phát lại an toàn:
  ```sql
  UPDATE outbox_events
  SET status = 'PENDING', dead_at = NULL, attempts = 0, available_at = now(), last_error = NULL
  WHERE id = '<id>';
  ```
- Bản ghi đích không còn (đã xóa) → để nguyên dead letter, ghi chú vào incident; không phát lại.
- Lỗi lặp lại do bug consumer → hotfix, deploy, rồi phát lại theo lô `WHERE topic = '<topic>' AND dead_at > '<thời điểm>'`.
- Sau khi xử lý, gauge `uniwork_outbox_dead_letter_total` phải về 0; nếu không, còn dòng chưa xem.

## Leo thang

- > 50 dòng dead letter trong 15 phút hoặc topic `realtime.*`/`meeting.*` → nâng sev 1.
- Phát lại làm lỗi lặp → dừng, không phát lại nữa, gọi người viết consumer (xem `server/internal/outbox/catalogue.go` để biết topic thuộc module nào).
