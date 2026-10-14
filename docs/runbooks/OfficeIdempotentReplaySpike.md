# OfficeIdempotentReplaySpike — nhiều lệnh commit được trả lại từ kết quả đã lưu

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có dashboard Office: đọc metric ở mục Kiểm tra bằng Explore · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeIdempotentReplaySpike`: hơn 50 lệnh commit trong 15 phút được trả từ kết quả đã lưu của cùng `Idempotency-Key` (`uniwork_office_idempotent_replays_total`).
- Replay là retry mà lần đầu đã commit nên không nhân đôi phiên bản; đây là hệ thống đang làm đúng, nhưng số lớn nghĩa là client không nhận được phản hồi lần đầu.

## Kiểm tra

1. Độ trễ commit: `histogram_quantile(0.95, sum by (le) (rate(uniwork_document_save_duration_seconds_bucket{kind="file"}[10m])))`; gần timeout client thì response bị bỏ.
2. Ingress/proxy cắt response (504, 499) trên route commit: `uniwork_http_requests_total{route=~".*/versions/commit"}` theo `status`.
3. `uniwork_office_intent_lookups_total{outcome="in_flight"}` tăng: nhiều lượt đang chờ cùng lúc.
4. Mạng di động hay một văn phòng: nếu chỉ một nhóm, đó là mạng của họ.

## Khắc phục

- Commit chậm: xử lý nguyên nhân chậm (DB, FileService, `OfficeChangeFeedLagHigh`); không tăng `DOCUMENT_COMMIT_INTENT_CLAIM_TTL` (mặc định 2 phút) mà chưa hỏi owner, vì nó là hàng rào chống commit muộn.
- Proxy cắt response: nâng timeout của ingress cho route commit tới trên p99 của lần Lưu.

## Leo thang

Replay tiếp tục tăng sau khi commit và proxy khỏe: báo owner Documents server (G5-07) và owner fork (queue G5-06).
