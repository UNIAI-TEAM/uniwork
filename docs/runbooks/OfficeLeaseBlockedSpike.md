# OfficeLeaseBlockedSpike — lease offline bị chặn nhiều

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có dashboard Office: đọc metric ở mục Kiểm tra bằng Explore · **Nền:** [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)

## Triệu chứng

- Alert `OfficeLeaseBlockedSpike`: hơn 50 lần cấp hoặc gia hạn lease offline bị từ chối trong 15 phút cho một `reason` (`uniwork_office_offline_lease_blocked_total`), không tính `flag_off` (đó là công tắc đang hoạt động).
- `reason` thuộc tập đóng: `device`, `acl`, `epoch`, `revoked`, `limit`, `archived`, `signature`. Người dùng thấy tài liệu ghim offline không gia hạn được; bản đang có vẫn mở tới khi hết hạn (lease tối đa 24 giờ).

## Kiểm tra

1. Xem `reason` nào tăng: `sum by (reason) (increase(uniwork_office_offline_lease_blocked_total[15m]))`.
2. `signature` hoặc `revoked` cùng lúc với một lần deploy: `JWT_SECRET` có vừa đổi không (khóa ký lease và cursor suy từ nó; xem mục "Cursor và lease sau khi đổi khóa" trong [`docs/ops/RUNBOOK_OFFICE_SYNC.md`](../ops/RUNBOOK_OFFICE_SYNC.md)).
3. `epoch`: tổ chức vừa tăng epoch chính sách offline (bảng `office_offline_policy`).
4. `limit` (`offline_lease_limit_reached`): thiết bị vượt 200 lease sống; `device` (`offline_lease_device_required`): phiên web hoặc phiên không có hàng `device_sessions` sống.
5. `acl`/`archived`: quyền đổi hàng loạt hoặc tài liệu bị lưu trữ; đúng thiết kế.

## Khắc phục

- `signature` sau khi đổi `JWT_SECRET`: không hoàn tác bằng cách sửa dữ liệu; thiết bị xin lease mới khi online. Chỉ đổi lại khóa cũ nếu việc đổi là nhầm lẫn và chưa có phiên mới nào ký.
- `epoch`/`acl`/`archived`/`revoked`: đúng thiết kế, không cần sửa; thông báo cho tổ chức nếu họ chưa biết.
- `limit`: thiết bị ghim quá nhiều; người dùng bỏ ghim bớt.
- Tắt `office_offline_library` chỉ dừng cấp/gia hạn mới; không xóa lease sẵn có.

## Leo thang

`reason` không giải thích được bằng các bước trên, hoặc `signature` kéo dài khi `JWT_SECRET` không đổi: báo owner Documents server (G5-08s).
