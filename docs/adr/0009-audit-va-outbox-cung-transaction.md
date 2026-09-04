# 0009 — Mọi command đổi trạng thái nghiệp vụ ghi audit và outbox trong cùng transaction

**Trạng thái:** accepted (2026-09-04) — chấp nhận bởi quangpd trong phiên Giai đoạn 0 (UNI-420). Luật tương ứng vào `CLAUDE.md` cùng lúc với test giữ luật (xem mục cuối); đến lúc đó reviewer giữ luật bằng tay theo DoD.

## Bối cảnh

Meeting đã có `outbox_events` và `meeting_audit_logs` (migration 008) và test
`meeting_outbox_test.go`. Task, chat, organization, workspace chưa có; realtime hiện phát
sự kiện trực tiếp từ service. Nếu process chết giữa commit và publish thì client mất
sự kiện; nếu audit ghi ở handler thì có thể ghi audit cho thao tác đã rollback.

Vision §6.1 đòi audit bất biến và correlation id xuyên suốt; §6.9 đòi "audit + event trong
cùng transaction" là điều kiện Done. Bản cũ đã chứng minh mô hình này chịu tải
(`SEC.6`, 7 worker × 25/25) và bộ test `03_outbox_idempotency.sql` đáng viết lại.

## Quyết định

1. Có hai bảng toàn hệ thống: `audit_events` (bất biến) và `outbox_events` (tổng quát
   hóa từ meeting). `meeting_audit_logs` được migrate vào `audit_events` hoặc giữ như view.
2. Mọi service method làm thay đổi trạng thái nghiệp vụ (tạo/sửa/xóa/chuyển trạng thái)
   ghi một dòng `audit_events` và ít nhất một `outbox_events` **trong cùng `pgx.Tx`** với
   thay đổi. Helper duy nhất: `events.Record(tx, Event{...})`.
3. `audit_events` không có đường UPDATE/DELETE: trigger `RAISE EXCEPTION`, role ứng dụng
   không có GRANT UPDATE/DELETE. Retention xử lý bằng partition drop, không bằng DELETE.
4. Tên sự kiện `<entity>.<verb>` có phiên bản schema payload; payload chỉ mang id và các
   trường cần để route (tenant, actor); consumer refetch. Catalogue sống trong spec audit
   và được sinh thành hằng số Go + TS.
5. Một worker outbox duy nhất (đã có cho meeting) phát cho: realtime relay, notification
   consumer, webhook consumer. Consumer idempotent theo `event_id`.
6. Mỗi request có `correlation_id` (từ header hoặc sinh mới), ghi vào audit, outbox, log.

## Hệ quả

- Service không được gọi `realtime.Publish` trực tiếp; `arch_test.go` chặn import
  `realtime` từ `service` trừ worker outbox.
- Có cái giá về độ trễ realtime (poll outbox mỗi N ms); chấp nhận, ngưỡng ≤ 1 giây p95
  (Vision §6.3) và có metric `outbox_lag_seconds`.
- Test: mỗi command có test "audit + outbox xuất hiện sau commit, không xuất hiện sau
  rollback".

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md`)

- `server/internal/arch_test.go`: `service` không import `realtime` publisher.
- `server/internal/service/events_contract_test.go` (mới): danh sách service method
  thuộc loại command phải gọi `events.Record` (kiểm bằng AST hoặc bảng khai báo).
- SQL test: UPDATE/DELETE trên `audit_events` bị từ chối.
