# OfficeLeaseRevokeFailed — revoke lease offline fail-closed không thành

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeLeaseRevokeFailed`: có lần revoke lease offline fail-closed không ghi được trong 15 phút (`uniwork_office_offline_lease_revoke_failed_total`): bước kiểm lại membership sau commit lỗi, nên hàng lease chưa được đóng ngay.
- Rủi ro: một thiết bị vừa mất quyền (rút khỏi workspace, thu hồi chia sẻ, xóa tài liệu) còn lease sống tới khi consumer outbox `office_lease_revoker` đóng hàng đó hoặc lease hết hạn (tối đa 24 giờ).

## Kiểm tra

1. Consumer có chạy không: `OutboxLagHigh`, `OutboxDeadLetter` (lane slow); log `office_lease_revoker`.
2. DB có lỗi tạm thời cùng lúc (`ReadinessFailing`, kết nối bị ngắt)? Lỗi lẻ do DB là nguyên nhân thường gặp nhất.
3. `uniwork_office_offline_leases_revoked_total{reason}` có tăng sau đó không: revoke đã được consumer hoàn tất.
4. Hàng còn sống của tài liệu/thiết bị liên quan: bảng `office_offline_leases` (chỉ id, không nội dung).

## Khắc phục

- Outbox khỏe: chờ consumer tự đóng; kiểm lại bước 3 sau vài phút.
- Outbox kẹt hoặc dead letter: xử lý theo `OutboxLagHigh`/`OutboxDeadLetter`, rồi chạy lại dòng đã dead letter theo [RUNBOOK_OUTBOX](../ops/RUNBOOK_OUTBOX.md).
- Cần dừng ngay một thiết bị cụ thể: thu hồi thiết bị/phiên (đường admin hoặc người dùng thu hồi thiết bị), việc này ghi audit và revoke mọi lease của nó.

## Leo thang

Lỗi lặp lại, hoặc còn hàng lease sống sau khi consumer chạy lại: coi là sự cố quyền truy cập, báo owner Documents server (G5-08s) và người phụ trách bảo mật ngay, giữ nguyên hiện trường.
