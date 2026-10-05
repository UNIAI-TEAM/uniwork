# Runbook — outbox sự kiện và nhật ký audit

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-05 · **Thành phần:** `outbox.Dispatcher` trong tiến trình API · **Liên quan:** ADR 0009, ADR 0012, `docs/events/CATALOGUE.md`

Mọi command đổi trạng thái nghiệp vụ ghi một dòng `audit_events` và một hoặc
nhiều dòng `outbox_events` trong cùng transaction. `outbox.Dispatcher` trong
mỗi tiến trình API claim các dòng chưa gửi và phát cho consumer theo topic.
Không có hàng đợi ngoài, không có dependency mới.

Dispatcher chạy năm lane, mỗi lane một vòng claim riêng
(`server/internal/outbox/lane.go`), để việc chậm không chặn frame realtime:

| Lane | Consumer | Claim mỗi lượt |
| --- | --- | --- |
| `realtime` | realtime, flags invalidator; nhận mọi topic không lane nào khác giữ | `MEETING_OUTBOX_BATCH` |
| `notify` | notification, chat-task sync | `MEETING_OUTBOX_BATCH` |
| `provider` | provider hội nghị (LiveKit) | tối đa 16 |
| `push` | web push | tối đa 8 |
| `slow` | export nhật ký, tóm tắt AI cuộc gọi, webhook (stub) | tối đa 2 |

Một topic chạy trên lane chậm nhất trong các consumer của nó, và các consumer
của cùng một dòng chạy song song. Vì vậy topic vừa có realtime vừa có
notification (`task.updated`, `task.comment_added`, `member.*`…) đi lane
`notify`, và frame của nó có thể chờ sau các lô notify trước đó. Trong một
lane, dòng được nhóm theo workspace: cùng workspace thì đúng thứ tự commit,
khác workspace chạy song song. Chỉ lane `realtime` quét lease hết hạn
(`ReleaseStaleOutboxClaims`). Khi `pending_age` tăng, xem log trường `lane`
để biết lane nào đang nghẽn.

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_outbox_pending_age_seconds` | Tuổi dòng chưa gửi cũ nhất | p95 ≤ 1 s (Vision §6.3). > 30 s liên tục 5 phút = cảnh báo |
| `uniwork_outbox_dead_rows` | Dòng đã bỏ cuộc sau 10 lần thử | > 0 = điều tra, không tự khỏi |
| `uniwork_outbox_delivered_total` | Dòng đã gửi xong | Phẳng trong khi `pending_age` tăng = worker chết |
| `uniwork_outbox_retry_total` | Lần thử lại | Tăng đều = một consumer đang hỏng |
| `uniwork_audit_events_total{action}` | Dòng audit theo hành động | Về 0 cho một action vẫn có người dùng = command bỏ ghi audit |
| `uniwork_outbox_lag_up` | 1 khi lần đọc lag gần nhất thành công | 0 = DB không trả lời trong 2 s; các gauge outbox vắng mặt chứ không về 0. Điều tra DB trước |
| `uniwork_meeting_queue_lag_up{queue}` | Như trên cho `outbox` và `webhook_inbox` của cuộc họp | 0 = không đọc được lag của hàng đợi đó |
| `uniwork_event_retention_deleted_total{table}` | Dòng job retention đã xóa | Phẳng nhiều ngày trong khi có traffic = job không chạy |
| `uniwork_event_retention_errors_total{table}` | Lần quét retention lỗi trên một bảng | Tăng đều = xem log `event retention sweep` |
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

Dead letter chỉ được giữ **30 ngày** (xem mục Retention bên dưới). Muốn giữ một
dòng lâu hơn để điều tra thì chép nó ra trước khi hết hạn.

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

## Retention

`service.EventRetention` (`server/internal/service/event_retention.go`) chạy
trong mỗi tiến trình API: quét ngay khi khởi động rồi mỗi giờ một lần, dừng
theo chuỗi shutdown. Nó xóa các dòng không còn đường code nào đọc lại:

| Bảng | Bị xóa | Giữ |
| --- | --- | --- |
| `outbox_events` | `DONE` có `available_at` và `updated_at` cũ hơn 7 ngày | `PENDING`, `PROCESSING` không bao giờ bị xóa |
| `outbox_events` | `DEAD_LETTER` đã nằm quá 30 ngày (`dead_at`) | Dead letter trẻ hơn 30 ngày, để phát lại tay |
| `webhook_inbox` | `DONE` nhận quá 7 ngày, `DEAD_LETTER` nhận quá 30 ngày | `PENDING`, `PROCESSING` |
| `meeting_provider_events` | Dòng nhận quá 14 ngày | Sổ chống trùng: provider chỉ gửi lại trong vài phút |

`audit_events` **không bao giờ** bị đụng tới: bảng này append-only (ADR 0012).
Hệ quả cần biết:

- Trang console admin tra theo `correlation_id` chỉ còn phần outbox của một
  trace trong 7 ngày; phần `audit_events` vẫn còn nguyên.
- `uniwork_outbox_dead_letter_total` và `uniwork_outbox_dead_rows` tự về 0 khi
  dead letter cuối cùng quá 30 ngày, kể cả khi chưa ai xem. Alert dead letter
  dựa trên `increase(uniwork_outbox_dead_total[15m])` nên không bị ảnh hưởng.
- Một `recording_ended` đến lại sau khi dòng sổ đã bị xóa vẫn chạy
  `finishRecordingFromProvider`, vì nhánh đó vốn idempotent.

Mỗi câu `DELETE` xóa tối đa 5.000 dòng, nghỉ 250 ms giữa hai lô, và tối đa 200
lô mỗi bảng mỗi lần quét. Vì vậy lần đầu chạy trên một bảng tồn nhiều triệu
dòng sẽ được trải ra qua vài giờ thay vì giữ một connection hàng phút. Các lô
dùng `FOR UPDATE SKIP LOCKED`, nên nhiều replica quét cùng lúc chia nhau việc
chứ không chờ nhau. `outbox_events` được quét theo
`idx_outbox_events_pending (status, available_at)`. `webhook_inbox` và
`meeting_provider_events` được quét theo khóa chính: id là ULID tạo lúc nhận,
nên `id < ULID(mốc cắt)` đi từ dòng cũ nhất.

Sau lần dọn đầu tiên, nên chạy `VACUUM (ANALYZE)` cho ba bảng nếu autovacuum
chưa kịp chạy, để trả lại chỗ trống cho dòng mới.

## Dừng và khởi động lại

Dispatcher dừng trước relay realtime trong chuỗi shutdown của
`server/cmd/server/main.go`, có 30 giây. Dòng đang claim mà tiến trình chết sẽ
được `ReleaseStaleOutboxClaims` trả về hàng đợi sau khi lease 120 giây hết hạn —
không cần can thiệp tay.
