# C-06 — Xuất và xóa dữ liệu tổ chức

> **Trạng thái:** in-progress

**Issue:** UNI-442. Lát xuất và lát xóa đều đang làm, chưa merge.

## Quyết định đã chốt

Khi xóa tổ chức: ghi nhận ngay, job xóa cứng chạy sau 5 ngày. Trong 5 ngày thành viên thường không vào được; chủ sở hữu vẫn vào để tải tệp, xuất nhật ký, xem hóa đơn và hủy lệnh xóa. Hủy thì job bỏ qua. Hết hạn thì xóa nội dung nghiệp vụ và file, ẩn danh tổ chức cùng hồ sơ thành viên trong tổ chức đó, giữ `audit_events` (ADR 0012 cấm sửa và xóa) và giữ hóa đơn cùng chứng từ thanh toán. Tài khoản đăng nhập không bị ẩn danh, vì một người có thể thuộc tổ chức khác.

## Hợp đồng lát 2 — xóa tổ chức

Chủ sở hữu gõ lại slug rồi `POST /api/v1/orgs/{orgID}/privacy/deletion` (202). Cùng một yêu cầu đang mở với bản xuất. Sự kiện `privacy.deletion_requested` mang `available_at` sau 5 ngày, nên consumer `privacy-deletion` đang có chạy muộn 5 ngày, không thêm job. `POST .../privacy/deletion/cancel` hủy khi job chưa chạy. Trong 5 ngày `deletion_scheduled_at` trên tổ chức khiến cả hai cổng thành viên từ chối người không phải chủ sở hữu.

Job xóa mọi bảng tenant không nằm trong danh sách giữ (`tenantDeleteRetain` trong `tenant_delete_tables.go`): việc, họp, tài liệu, chat, workspace, và các sổ kỹ thuật. Một lần chạy lỗi thì lần sau xóa tiếp, không coi là xong. Hết số lần thử thì yêu cầu được ghi lỗi và thành viên vào lại được. File được nhả qua FileService để collector xóa byte. Hồ sơ thành viên trong tổ chức bị xóa nội dung và thành viên bị vô hiệu. Tổ chức đổi tên thành «Tổ chức đã xóa», slug thành `d-<id>`, trạng thái `archived`, nên cửa thành viên đóng. Work Graph được projector xóa tiêu đề. Hóa đơn, chứng từ thanh toán, `audit_events` và gói đăng ký (chuyển `canceled`) được giữ. Gói đăng ký bị hủy để không còn kỳ thanh toán mới.

## Hợp đồng lát 1

Chủ sở hữu tạo một yêu cầu xuất. Mỗi tổ chức chỉ một yêu cầu đang chạy. `POST /api/v1/orgs/{orgID}/privacy/exports` trả 202. Job đi qua outbox `privacy.export_requested` (payload `request_id`, `organization_id`), lane slow.

File là zip. `manifest.json` ghi tổ chức, thời điểm, số dòng từng bảng, bảng bị loại và lý do, cùng metadata tệp (`file_id`, tên, kích thước, checksum). Mỗi bảng được đưa vào là một JSONL. Không nhét byte tệp. Trần zip 100 MiB; vượt trần thì job thất bại, không retry.

Purpose FileService `tenant_export`, scope tổ chức, đọc qua proxy, không tính `storage.bytes`. Link tải hết hạn 24 giờ; mỗi lần tải kiểm tra lại chủ sở hữu.

Bảng nào được đưa vào hay loại ra nằm ở `server/internal/service/tenant_export_tables.go`. Test đỏ khi một bảng tenant mới chưa được phân loại. Cột bí mật (`*_enc`, `*_hash`, `password`) và locator lưu trữ (`object_key`, `bucket`, `object_version`) bị gỡ khỏi JSONL.

Hàng `organizations` không có `organization_id`; zip vẫn có `organization.json` của đúng tổ chức đang xuất.
