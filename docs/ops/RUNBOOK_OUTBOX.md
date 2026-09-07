# Runbook — outbox sự kiện và nhật ký audit

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-04 · **Thành phần:** `outbox.Dispatcher` trong tiến trình API · **Liên quan:** ADR 0009, ADR 0012, `docs/events/CATALOGUE.md`

Mọi command đổi trạng thái nghiệp vụ ghi một dòng `audit_events` và một hoặc
nhiều dòng `outbox_events` trong cùng transaction. Một goroutine
(`outbox.Dispatcher`) trong mỗi tiến trình API claim các dòng chưa gửi và phát
cho consumer theo topic: realtime, provider hội nghị, export nhật ký, webhook
(stub). Không có hàng đợi ngoài, không có dependency mới.

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_outbox_pending_age_seconds` | Tuổi dòng chưa gửi cũ nhất | p95 ≤ 1 s (Vision §6.3). > 30 s liên tục 5 phút = cảnh báo |
| `uniwork_outbox_dead_rows` | Dòng đã bỏ cuộc sau 10 lần thử | > 0 = điều tra, không tự khỏi |
| `uniwork_outbox_delivered_total` | Dòng đã gửi xong | Phẳng trong khi `pending_age` tăng = worker chết |
| `uniwork_outbox_retry_total` | Lần thử lại | Tăng đều = một consumer đang hỏng |
| `uniwork_audit_events_total{action}` | Dòng audit theo hành động | Về 0 cho một action vẫn có người dùng = command bỏ ghi audit |
| `uniwork_audit_events_expired{organization}` | Dòng đã quá thời gian lưu của tổ chức | Chỉ để nhìn. Không có gì xóa chúng — xóa audit là việc của archive job viết ở đợt sau (ADR 0012) |

## Triệu chứng và cách xử lý

### Bảng công việc không tự cập nhật, phải F5

Realtime đi qua outbox, nên đây gần như luôn là outbox đứng.

1. `uniwork_outbox_pending_age_seconds` có tăng không? Nếu có, worker không
   chạy hoặc một consumer đang chặn.
2. Xem log `outbox process` (mức warn) và `outbox dead letter` (mức error).
3. Kiểm tra dòng đang kẹt:

```sql
SELECT topic, count(*), min(created_at)
FROM outbox_events
WHERE done_at IS NULL AND dead_at IS NULL
GROUP BY topic ORDER BY 3;
```

4. Một topic chiếm hết thì consumer của topic đó là thủ phạm; log của nó có
   tên consumer trong thông báo lỗi (`realtime: …`, `meeting-provider: …`).

### Có dòng dead letter

Dòng đã thử 10 lần với backoff tới 5 phút rồi dừng. Nó **không** tự chạy lại.

```sql
SELECT id, topic, attempts, last_error, dead_at
FROM outbox_events WHERE dead_at IS NOT NULL OR status = 'DEAD_LETTER'
ORDER BY dead_at DESC LIMIT 50;
```

Sau khi sửa nguyên nhân, phát lại bằng cách trả dòng về hàng đợi:

```sql
UPDATE outbox_events
SET status = 'PENDING', dead_at = NULL, attempts = 0, available_at = now(), last_error = NULL
WHERE id = '<id>';
```

Mọi consumer phải idempotent theo `id`, nên phát lại an toàn. Nếu không chắc
consumer nào đã chạy, phát lại vẫn đúng — đó là hợp đồng của `Consumer.Handle`.

### `audit_events` không ghi nữa cho một loại command

`uniwork_audit_events_total{action="…"}` phẳng trong khi người dùng vẫn thao
tác nghĩa là một đường code mới đi vòng qua `audit.Recorder`.
`server/internal/arch_test.go` chặn việc gọi thẳng query, và
`audit_coverage_test.go` chặn việc quên command — nếu cả hai xanh mà metric vẫn
phẳng thì command đó chưa có trong bảng coverage. Thêm vào đó trước.

### Không sửa được một dòng audit

Đúng như thiết kế (ADR 0012). `UPDATE` và `DELETE` bị trigger từ chối kể cả với
user sở hữu schema. Ghi sai thì ghi thêm một dòng nói điều đúng; không có đường
nào khác, và không mở đường nào.

## Bản xuất nhật ký treo

Mỗi tổ chức chỉ một bản xuất chạy cùng lúc. Một job kẹt ở `running` chặn các
lần sau.

```sql
SELECT id, organization_id, started_at, completed_at, failed_at, error
FROM audit_exports WHERE completed_at IS NULL AND failed_at IS NULL;
```

Nguyên nhân thường gặp: `STORAGE_BACKEND` chưa cấu hình (consumer trả lỗi "no
storage backend configured" và dòng outbox retry). Sửa cấu hình rồi phát lại
dòng `audit.export_requested` như phần dead letter. Nếu muốn bỏ job, đánh dấu
thất bại chứ đừng xóa hàng:

```sql
UPDATE audit_exports SET failed_at = now(), error = 'hủy thủ công' WHERE id = '<id>';
```

## Dừng và khởi động lại

Dispatcher dừng trước relay realtime trong chuỗi shutdown của
`server/cmd/server/main.go`, có 30 giây. Dòng đang claim mà tiến trình chết sẽ
được `ReleaseStaleOutboxClaims` trả về hàng đợi sau khi lease 120 giây hết hạn —
không cần can thiệp tay.
