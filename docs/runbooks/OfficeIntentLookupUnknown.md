# OfficeIntentLookupUnknown — tra intent trả unknown

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có dashboard Office: đọc metric ở mục Kiểm tra bằng Explore · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeIntentLookupUnknown`: hơn 5 lượt tra kết quả intent trả `outcome="unknown"` trong 1 giờ (`uniwork_office_intent_lookups_total`). Route trả `410 commit_intent_unknown`.
- Thiết bị đang ở `reconciling` tra intent của lần Lưu cũ, nhưng kết quả đã bị dọn (cửa sổ giữ `DOCUMENT_COMMIT_INTENT_RETENTION`, mặc định 168 giờ). Client không được tạo khóa mới rồi gửi lại như thể "chưa commit".

## Kiểm tra

1. `uniwork_office_commit_intents_swept_total` có tăng nhanh bất thường không: dọn sớm hơn cấu hình?
2. `DOCUMENT_COMMIT_INTENT_RETENTION` có bị đổi ngắn hơn giá trị đã chốt (G5-D2) không?
3. Thiết bị có offline vượt cửa sổ giữ không (nghỉ dài)? Đây là nguyên nhân bình thường nhất và chỉ cần hướng dẫn người dùng.

## Khắc phục

- Cấu hình bị đổi ngắn: trả về giá trị đã chốt, restart; các intent đã dọn không khôi phục được.
- Thiết bị offline quá lâu: người dùng giữ bản cục bộ, kiểm lịch sử phiên bản của tài liệu trên server, rồi tự quyết định lưu bản cục bộ như một lần Lưu mới.
- Không xóa tay dòng trong `document_commit_intents` và không đổi `Idempotency-Key` hộ client.

## Leo thang

Có `unknown` trong khi retention chưa hết hạn: báo owner Documents server (G5-07) kèm `correlation_id`; coi là nghi ngờ mất kết quả commit.
