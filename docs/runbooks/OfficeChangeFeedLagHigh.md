# OfficeChangeFeedLagHigh — change feed Office trễ hơn 5 phút

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có dashboard Office: đọc metric ở mục Kiểm tra bằng Explore · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeChangeFeedLagHigh`: `max(uniwork_office_change_feed_lag_seconds) > 300` liên tục 10 phút. Giá trị khỏe là 0 (trang vừa giao đã đuổi kịp người gọi).
- App desktop và frame web nhận bản mới của tài liệu chậm; Lưu, mở file và tải về vẫn chạy. Không mất commit: cursor giữ nguyên chỗ.
- Gauge chỉ cập nhật khi có người gọi feed. Nếu không ai đồng bộ, nó giữ giá trị cuối: kiểm tra có client đang gọi (`uniwork_http_requests_total{route=~".*/documents/changes"}`) trước khi tin con số.

## Kiểm tra

1. Có transaction dài giữ xmin không: `SELECT pid, state, application_name, xact_start FROM pg_stat_activity WHERE xact_start < now() - interval '5 minutes' ORDER BY xact_start;` (đừng chọn cột `query`). Một migration, backup hoặc reader treo làm trang feed không tiến được trong khi lag vẫn lớn; `has_more=false` không phải dấu hiệu bình thường ở đây.
2. Lag có giảm sau khi holder kết thúc không? Nếu có: đã xong, xem mục "Feed" trong [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md).
3. Flag `office_sync_feed` có tắt không (`GET /api/v1/config`)? Tắt thì feed trả `403 office_capability_off`, lag không còn ý nghĩa.
4. Lỗi 5xx trên route feed: `sum by (status) (rate(uniwork_http_requests_total{route=~".*/documents/changes"}[5m]))`.

## Khắc phục

- Holder là migration hoặc backup: chờ nó kết thúc; không `pg_terminate_backend` một migration đang chạy.
- Holder là reader/session treo của ứng dụng: kết thúc đúng pid đó sau khi xác nhận với chủ của nó.
- Không sửa dữ liệu feed bằng tay và không đặt lại cursor của người dùng; cursor tự đi tiếp khi xmin được giải phóng.

## Leo thang

Lag còn trên 5 phút sau khi không còn transaction dài, hoặc feed trả 5xx kéo dài: báo owner Documents server (lane G5-01b) kèm kết quả bước 1 và 4.
