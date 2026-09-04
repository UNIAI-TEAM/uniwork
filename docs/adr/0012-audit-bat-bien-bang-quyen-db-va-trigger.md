# 0012 — `audit_events` bất biến bằng quyền DB và trigger; ghi qua đúng một package

**Trạng thái:** accepted (2026-09-04) — chấp nhận cùng lúc với F-08 (UNI-423). Luật vào `CLAUDE.md` § Database and Migration Rules và § Coding Rules; test giữ luật: `server/internal/audit/recorder_test.go` (`TestAuditEventsAreAppendOnly`), `server/internal/arch_test.go` (`TestAuditAndOutboxWritesGoThroughTheAuditPackage`), `server/internal/service/audit_coverage_test.go`.

## Bối cảnh

Vision §6.1 đòi nhật ký bất biến; ADR 0009 đã chốt "audit + outbox trong cùng
transaction". Nhưng "bất biến" nếu chỉ là quy ước thì chỉ đúng đến lần đầu có ai
viết `UPDATE audit_events SET …` để sửa một dòng sai — và với nhật ký, một dòng
sửa được thì cả bảng mất giá trị làm bằng chứng: người đọc không phân biệt được
"không có gì xảy ra" với "có người xóa nó rồi".

Cùng lý do đó, "mọi command ghi audit" cũng không sống được bằng review. Trong
`unidigiwork` bản cũ, audit ghi bằng trigger `audit_row_change` trên từng bảng:
không bỏ sót, nhưng cũng không có actor, không có "trường nào đổi", và không
phân biệt được một command với một lần chạy migration.

## Quyết định

1. **Hai lớp bất biến.** `REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM
   PUBLIC` là lớp một, đúng ở staging và production nơi app không sở hữu schema.
   Trigger `BEFORE UPDATE` / `BEFORE DELETE` `RAISE EXCEPTION` là lớp hai, đúng
   cả khi app chạy bằng owner của schema — tức là mọi máy dev và mọi database
   test.
2. **`TRUNCATE` cố ý không bị trigger chặn.** Nó là cách `testutil.DB` dọn bảng
   giữa các test, và quyền TRUNCATE đã bị REVOKE ở nơi có phân quyền thật. Chặn
   nó bằng trigger sẽ đổi lấy một chút chặt chẽ ở dev bằng một bộ test không chạy
   được.
3. **Xóa chỉ qua archive job.** Retention không `DELETE`. Đợt này chỉ có chính
   sách (`audit_retention_policies`) và số đo; job chuyển dòng cũ sang bảng
   archive chạy bằng một role DB khác, viết ở đợt sau, kèm diễn tập restore.
   Vì thế trigger không có "cửa sau" nào cả.
4. **Đúng một package được ghi.** `server/internal/audit` là nơi duy nhất gọi
   `InsertAuditEvent` và `InsertDomainOutboxEvent`. Service gọi
   `audit.Recorder.Record(ctx, q, Entry, emit…)` với `q` đã bound vào transaction
   của chính nó — "cùng transaction" trở thành cấu trúc chứ không phải thói quen.
   `Recorder.Emit` là lối đi hẹp cho topic hạ tầng (`provider.*`) không có
   command nghiệp vụ đằng sau.
5. **Ghi từ service, không ghi bằng trigger trên bảng nghiệp vụ.** Đổi lấy nguy
   cơ bỏ sót lấy được actor, `actor_kind`, `correlation_id` và một `changes` gọn.
   Nguy cơ bỏ sót được bù bằng `audit_coverage_test`: một bảng liệt kê mọi command
   phải ghi, đỏ theo cả hai chiều — thiếu command, và thừa một action không ai gọi.
6. **`payload` sự kiện chỉ mang id.** Consumer cần nội dung thì đọc lại qua API,
   nên một sự kiện không bao giờ lộ trường mà người nhận không được xem.
   `scripts/events-catalogue.test.mjs` giữ luật này cho mọi topic có người nghe.

## Hệ quả

- Không sửa được một dòng audit ghi sai. Cách duy nhất là ghi thêm một dòng nói
  điều đúng. Đây là cái giá cố ý: một nhật ký sửa được không phải là nhật ký.
- Test tamper (`TestAuditEventsAreAppendOnly`) là điều kiện merge, không phải
  test "nên có". Nó chạy bằng chính user của test database — tức là user sở hữu
  schema — nên nó chứng minh đúng cái lớp hai sinh ra để chứng minh.
- Một service muốn thêm command phải chạm hai chỗ: chính nó, và bảng trong
  `audit_coverage_test`. Đó là chủ ý — chỗ thứ hai là nơi reviewer nhìn thấy
  quyết định "việc này có đáng ghi không".
- Sự kiện realtime đi qua outbox nên trễ thêm tối đa một nhịp worker (mặc định
  500 ms). OPEN_QUESTIONS A5 đã chốt chấp nhận; ngưỡng theo dõi là p95 ≤ 1 giây,
  đo bằng `uniwork_outbox_pending_age_seconds`.
