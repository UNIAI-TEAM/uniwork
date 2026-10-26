# 0044 — Console `/admin` xếp và hoàn tác xóa tổ chức qua một cửa hẹp

**Trạng thái:** accepted (2026-10-23) — ngoại lệ content thứ hai của console, ADR mà quyết định 4 của
[0042](0042-console-admin-go-tin-bi-bao-cao-qua-mot-cua.md) đòi: nhà vận hành xếp hoặc hoàn tác lịch xóa 5 ngày
của một tổ chức. Bổ sung cho luật "console không chạm content" của F-11 (`CLAUDE.md` § Platform Admin and
Observability) và cho 0042, không thay chúng. Test giữ: `TestReportedContentRemoverIsTheConsoleOnlyContentSeam`
(`server/internal/arch_admin_takedown_test.go`), `TestAdminOrganizationDeletion`,
`TestPrivacyDeletionQueueHookRollsBack` (`server/internal/service/tenant_delete_test.go`).

## Bối cảnh

Chủ tổ chức đã tự xin xóa tổ chức qua hồ sơ quyền riêng tư (`PrivacyExportService.RequestDeletion`): một yêu cầu
`delete` trong `data_subject_requests`, `organizations.deletion_scheduled_at` đặt sau 5 ngày, và consumer
`privacy.deletion_requested` xóa khi đến hạn. Khi chủ tổ chức không còn đăng nhập được, hoặc khách yêu cầu qua kênh
hỗ trợ, nhà vận hành cần xếp cùng lịch đó từ console, và hoàn tác được trước khi việc xóa bắt đầu. Tạm ngưng hay
đóng tổ chức không xóa gì, nên không thay được.

Bản đầu của nhánh cho `AdminService` giữ cả `*PrivacyExportService`. Service đó còn xuất và cho tải tệp của tenant,
nên console có trong tay một đường đọc content mà luật F-11 cấm, và test của 0042 không còn giữ đúng điều luật nói.

## Quyết định

1. **Một cửa, hai việc.** Lệnh ghi content thứ hai của console là xếp hoặc hoàn tác lịch xóa 5 ngày sẵn có, qua
   interface `OrganizationDeletionQueue` trong `server/internal/service/admin.go`. Interface có đúng hai method,
   `queueDeletion` và `cancelDeletion`, chưa export nên chỉ package `service` cài được; `PrivacyExportService` cài
   nó bằng chính hàng đợi chủ tổ chức dùng, không có bản sao.
2. **Console không giữ `*PrivacyExportService`.** `AdminService` chỉ giữ interface, nên không xuất, không tải và
   không đọc tệp nào của tenant. File `admin*.go` chỉ gọi `queueDeletion` và `cancelDeletion` trên field đó.
3. **Chỉ `cmd/server/main.go` nối cửa,** qua `SetOrganizationDeletionQueue(privacySvc)`. Chưa nối thì lệnh trả 503
   `privacy_unavailable`.
4. **Cùng giao dịch như mọi lệnh ghi của admin.** Vai trò platform `admin`, `reason` ≥ 10 ký tự kiểm trước; hook
   của hàng đợi chạy `recordAdmin` bên trong giao dịch của việc xếp hoặc hoàn tác, nên `admin_actions` (trace id,
   `before`/`after` của `deletion_scheduled_at`), hàng audit `privacy.deletion_requested` /
   `privacy.deletion_cancelled` (metadata `platform_admin` và lý do) và lịch xóa cùng commit hoặc cùng rollback.
5. **Việc thứ ba vẫn là ADR mới,** như quyết định 4 của 0042.

## Hệ quả

- `CLAUDE.md` § Platform Admin nêu ngoại lệ này cạnh 0042 và tên test giữ nó.
- Thêm method vào `OrganizationDeletionQueue`, cho `AdminService` giữ `*PrivacyExportService` hay service content
  khác, gọi method khác trên field, hay nối một implementer khác làm
  `TestReportedContentRemoverIsTheConsoleOnlyContentSeam` đỏ.
- Logic xếp, hoàn tác và xóa ở một chỗ (`tenant_delete.go`); thay đổi ở đó tự đi theo cả đường của nhà vận hành.
