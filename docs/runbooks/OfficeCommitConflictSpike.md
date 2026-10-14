# OfficeCommitConflictSpike — nhiều lệnh Lưu file Office bị 409

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có dashboard Office: đọc metric ở mục Kiểm tra bằng Explore · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeCommitConflictSpike`: hơn 20 % lệnh Lưu file (`uniwork_document_saves_total{kind="file"}`) trong 30 phút bị `document_version_conflict` (`uniwork_document_conflicts_total{kind="file",code="document_version_conflict"}`), với ít nhất 20 lệnh Lưu.
- Người dùng thấy hộp thoại xung đột ("Tải bản mới nhất" / "Ghi đè" / "Hủy"). Không mất dữ liệu: bản cục bộ được giữ.

## Kiểm tra

1. Một vài tài liệu hay nhiều? Hỏi `audit_events` theo `correlation_id` của một lượt 409 (không dùng tiêu đề tài liệu trong báo cáo).
2. Feed có trễ không (`OfficeChangeFeedLagHigh`)? Feed trễ làm client giữ `base_revision` cũ.
3. Có bản app cũ không nhận feed (dưới N′, xem [support matrix](../office/g5g6g7/support-matrix.md)) hoặc một client gửi lại `base_revision` cũ trong vòng lặp?
4. `uniwork_office_idempotent_replays_total` có tăng cùng lúc không: retry hàng loạt (`OfficeIdempotentReplaySpike`).

## Khắc phục

- Nguyên nhân là feed trễ: xử lý theo `OfficeChangeFeedLagHigh`.
- Nguyên nhân là một bản app lỗi: ghi bản, báo owner fork; không hạ ngưỡng, không thêm đường bỏ kiểm revision (mọi lệnh Lưu đều kiểm `base_revision`).
- Hai người thật sự cùng sửa: bình thường, không cần hành động.

## Leo thang

Tỷ lệ còn trên 20 % sau khi feed khỏe và không có app cũ: báo owner Documents server (G5-07) và owner fork (G5-06) kèm bản app và ví dụ `correlation_id`.
