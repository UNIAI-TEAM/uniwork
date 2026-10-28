# Nút xóa tổ chức trên console admin

> **Trạng thái:** in-progress

**Ngày:** 2026-10-23
**Issue:** chưa có. Tạo issue UniAI trước khi mở nhánh `feature/UNI-nnn-…` (luật "No issue, no code").
**Spec liên quan:** `2026-10-12-tenant-export-design.md` (C-06, xóa tổ chức sau 5 ngày), `2026-10-13-one-organization-per-account-design.md` (đóng tổ chức không xóa dữ liệu, ADR 0032).

## 1. Mục tiêu

Người có vai trò nền tảng `admin` xếp lệnh xóa một tổ chức từ trang chi tiết trong console, và hoàn tác được khi job chưa chạy. Job xóa cứng vẫn là consumer `privacy-deletion` đang có, chạy sau 5 ngày.

Thành công khi:

- Bấm «Xóa tổ chức», gõ đúng slug và một lý do dài ít nhất 10 ký tự, thì tổ chức có cùng hồ sơ `data_subject_requests` mà chủ sở hữu thấy ở màn riêng tư, và `deletion_scheduled_at` cách thời điểm ghi nhận 5 ngày.
- Trong 5 ngày đó nút thành «Hoàn tác xóa». Hoàn tác chỉ cần lý do, rồi lịch xóa biến mất và thành viên vào lại được.
- Sau khi job xóa cứng xong, nút «Xóa tổ chức» hiện và không bấm được.
- Vai trò `support` không thấy nút. Người không có vai trò nền tảng không gọi được route.

## 2. Hiện trạng

Chủ sở hữu gõ slug rồi `POST /api/v1/orgs/{orgID}/privacy/deletion` (202). `PrivacyExportService.RequestDeletion` tạo hồ sơ `kind = delete`, đặt `organizations.deletion_scheduled_at`, ghi nhật ký `privacy.deletion_requested` và phát outbox cùng tên với `available_at` sau 5 ngày (`privacyDeletionDelay`). `POST .../privacy/deletion/cancel` hủy khi `started_at` còn trống. Job đã bắt đầu thì 409 `privacy_delete_started`. Đang có hồ sơ xuất hoặc xóa chưa kết thúc thì 409 `privacy_export_in_flight`.

Consumer `privacy-deletion` xóa bảng tenant ngoài danh sách giữ, nhả file, ẩn danh tổ chức (tên «Tổ chức đã xóa», slug `d-<id>`, `status = archived`, `suspended_reason = organization_deleted`) và xóa `deletion_scheduled_at`. Đối chiếu migration ngày 2026-10-23: 128 bảng có `organization_id` đều đã được phân loại; 113 bị xóa, 15 được giữ. Spec này không thêm bảng.

Console admin (`/admin/organizations/{id}`) có «Tạm ngưng» và «Đổi gói». Mọi lần ghi đi qua `ReasonDialog` (lý do ≥ 10 ký tự), cổng `RequirePlatformRole` (`support` đọc, `admin` ghi), và một dòng `admin_actions` trong cùng giao dịch với thay đổi. `GET /api/v1/admin/organizations/{orgID}` chưa trả `deletion_scheduled_at`. Đóng tổ chức (`suspended_reason = organization_closed`) lưu trữ và không xóa dữ liệu.

## 3. API

Hai route nằm trong nhóm ghi của `registerAdmin`, cùng middleware `admin` với Đình chỉ. Cả hai được khai trong `isoRoutes` với `class: isoPlatform`, cùng lý do với `POST /api/v1/admin/organizations/{orgID}/suspend`.

`POST /api/v1/admin/organizations/{orgID}/deletion` nhận:

| Trường | Ràng buộc |
| --- | --- |
| `reason` | Chuỗi, sau khi trim còn ít nhất 10 ký tự. Dưới mức đó là 400 `invalid_request`, cùng `ErrReasonTooShort` của các lệnh admin khác. |
| `confirm_slug` | Sau `TrimSpace`, khớp đúng `organizations.slug` hiện tại, phân biệt hoa thường, cùng cách `RequestDeletion` đang so. Sai thì 400 `privacy_delete_confirm`. Không có dòng nào được ghi. |

Thành công trả 202 và `AdminOrganizationDeletionSDO`: `deletion_scheduled_at` là thời điểm RFC 3339 vừa ghi.

`POST /api/v1/admin/organizations/{orgID}/deletion/cancel` nhận `ReasonSDI` (chỉ `reason`, cùng sàn 10 ký tự). Thành công trả 200 và cùng SDO với `deletion_scheduled_at: null`.

`GET /api/v1/admin/organizations/{orgID}` thêm hai trường metadata, không thêm nội dung nghiệp vụ:

| Trường | Giá trị |
| --- | --- |
| `deletion_scheduled_at` | RFC 3339 khi đang có lệnh; `null` khi không có. |
| `erased` | `true` khi `suspended_reason = organization_deleted`. Mọi trường hợp khác là `false`, kể cả tổ chức đã đóng (`organization_closed`) và tổ chức đang tạm ngưng. |

`erased` tính từ `suspended_reason`, cột `AdminGetOrganization` đã chọn. `deletion_scheduled_at` thì chưa: câu `AdminGetOrganization` trong `server/pkg/db/queries/admin.sql` phải thêm `o.deletion_scheduled_at`, rồi `make sqlc`. Danh sách tổ chức không thêm cột này.

Schema client (`AdminOrganizationDetailSchema`) nhận hai trường này theo kiểu lỏng: thiếu thì `deletion_scheduled_at` là `null` và `erased` là `false`, để một response cũ không làm trắng trang.

`PrivacyExportService` chưa được gắn thì handler trả 503 `privacy_unavailable`, cùng câu với route riêng tư của chủ sở hữu.

## 4. Giao dịch

`RequestDeletion` và lệnh admin dùng chung một hàm xếp hàng trong `PrivacyExportService`. Hàm đó không gọi query trong `admin.sql`. `AdminService` không giữ `*PrivacyExportService`; nó nhận interface hẹp `OrganizationDeletionQueue` (chỉ `queueDeletion` và `cancelDeletion`, ADR 0046) qua `SetOrganizationDeletionQueue`. Setter trống thì lệnh admin trả 503 như mục 3.

`AdminService.ScheduleOrganizationDeletion(ctx, adminID, orgID, confirmSlug, reason)` kiểm tra lý do trước, rồi gọi hàm xếp hàng với người thực hiện là `adminID` (`requested_by_kind = human`). Trong cùng giao dịch, trước commit, một hook của `AdminService` ghi `admin_actions`:

- `action`: `organization.deletion_scheduled`
- `target_type`: `organization`
- `target_id`: id tổ chức
- `reason`: lý do đã trim
- `before`: `deletion_scheduled_at` cũ (`null` khi chưa có)
- `after`: `deletion_scheduled_at` mới

Nhật ký nghiệp vụ vẫn là một dòng `privacy.deletion_requested`, actor là admin, `metadata` thêm `platform_admin: true` và `reason`. Đường của chủ sở hữu không thêm hai khóa đó. Outbox vẫn là `privacy.deletion_requested`, payload chỉ `request_id` và `organization_id`, `available_at` sau 5 ngày. Không có topic mới, không sửa catalogue.

`AdminService.CancelOrganizationDeletion` kiểm tra lý do, gọi phần hủy đang có, và hook ghi `admin_actions` với `action` `organization.deletion_cancelled`. `before.deletion_scheduled_at` là thời điểm cũ, `after.deletion_scheduled_at` là `null`. Nhật ký là `privacy.deletion_cancelled`, cùng metadata `platform_admin` và `reason`. Cả hai dòng `admin_actions` đi qua `recordAdmin`, nên có `trace_id` từ `ensureTrace` như mọi lệnh admin khác. Hook lỗi thì cả giao dịch rollback: không có lịch, không có hồ sơ, không có outbox. Test hook gọi hàm xếp hàng với một hook trả lỗi. `AdminService` truyền `recordAdmin` vào đúng tham số hook đó.

`ScheduleOrganizationDeletion` kiểm tra lý do trước mọi thứ khác. Lý do ngắn thì dừng, không đọc tổ chức và không ghi. Phần còn lại, theo thứ tự:

1. Tổ chức không tồn tại: 404.
2. `suspended_reason = organization_deleted`: 409 `organization_already_deleted`, kể cả khi `confirm_slug` là `d-<id>`. Kiểm tra này đứng trước so khớp slug, và nằm trong hàm xếp hàng dùng chung. `RequestDeletion` vẫn gọi `requireOwner` trước hàm đó, nên chủ sở hữu đã bị vô hiệu vẫn nhận 403, không nhận 409.
3. Slug không khớp: 400 `privacy_delete_confirm`.
4. Còn hồ sơ xuất hoặc xóa chưa kết thúc (`CountOpenDataSubjectRequests`): 409 `privacy_export_in_flight`. Một lệnh xóa đang mở cũng dùng mã này, như đường của chủ sở hữu. Không thêm mã mới.

Hủy kiểm tra lý do trước, rồi hồ sơ đang mở. `started_at` đã đặt thì 409 `privacy_delete_started` và `deletion_scheduled_at` giữ nguyên. Không có lệnh đang mở thì 404, như `CancelDeletion` của chủ sở hữu.

Tổ chức đang `suspended`, hoặc `archived` với `suspended_reason = organization_closed`, vẫn xếp được lệnh. Job thất bại và mở khóa tổ chức (`giveUp` xóa lịch, hồ sơ `failed`) thì `erased` vẫn `false` và nút trở lại «Xóa tổ chức».

Chủ sở hữu và admin dùng chung một hồ sơ. Chủ sở hữu hủy từ màn riêng tư bằng route hiện có, không cần lý do admin, và lần hủy đó không ghi `admin_actions`. Admin hủy được cả lệnh do chủ sở hữu tạo. Hoàn tác chỉ xóa `deletion_scheduled_at` và đánh dấu hồ sơ đã hủy. Nó không mở lại thành viên mà lệnh đóng tổ chức đã vô hiệu. `requested_by` của lệnh admin là user id của admin; consumer hiện tại ghi id đó vào `deactivated_by` khi xóa cứng. Không đổi consumer.

## 5. Màn admin

Trang là `AdminOrganizationDetailView`. Nút và hộp thoại nằm ở `packages/views/admin/organization-deletion.tsx`. Trang chi tiết chỉ gắn banner và nút, để file chi tiết không vượt 500 dòng.

`useAdminMe().data === "admin"` thì hiện nút. `support` không thấy nút. Banner hiện với cả hai vai trò.

| Điều kiện | Nút | Banner |
| --- | --- | --- |
| `erased` | «Xóa tổ chức», `disabled`, không mở hộp thoại | «Tổ chức đã bị xóa cứng.» |
| `deletion_scheduled_at` có giá trị | «Hoàn tác xóa», variant `outline` | «Sẽ xóa cứng lúc {{at}}.» Thời điểm theo `formatDateTime` đang dùng cho banner tạm ngưng. |
| Còn lại | «Xóa tổ chức», variant `destructive`, icon `Trash2` | Không banner xóa. Banner tạm ngưng, nếu có, giữ nguyên. |

Hai banner (tạm ngưng và xóa) xếp dọc, banner tạm ngưng ở trên.

Hộp thoại xóa là `ReasonDialog` với `destructive`. Phía trên lý do là ô slug: `autoComplete="off"`, `autoCapitalize="none"`, `spellCheck={false}`. Gợi ý hiện slug thật (`Gõ lại {{slug}} để xác nhận.`). Khi ô đã có chữ và chưa khớp, gợi ý đổi thành «Định danh chưa khớp.» Nút xác nhận của dialog chỉ bật khi slug đã trim khớp `organization.slug` và lý do đủ 10 ký tự (`submitDisabled`).

Hộp thoại hoàn tác là `ReasonDialog` chỉ với lý do, không `destructive`.

Đang gửi thì nút header và nút dialog bị khóa. Thành công: toast, đóng hộp thoại, invalidate `adminKeys.organization(orgId)` và `adminKeys.organizationsRoot` qua cùng helper `useOrganizationMutation` của Đình chỉ. Lỗi: toast `apiErrorMessage`, hộp thoại giữ nguyên. Job đã bắt đầu thì nút header vẫn là «Hoàn tác xóa».

«Tạm ngưng» và «Đổi gói» không đổi hành vi.

Chữ qua `t()`, tiền tố `admin.detail`. Thêm cùng khóa vào `vi.json` và `en.json`:

| Khóa | Tiếng Việt | English |
| --- | --- | --- |
| `delete` | Xóa tổ chức | Delete organization |
| `delete_title` | Xóa {{name}}? | Delete {{name}}? |
| `delete_description` | Job xóa cứng chạy sau 5 ngày. Trong thời gian đó có thể hoàn tác. Thành viên thường không vào được; chủ sở hữu vẫn vào để tải tệp và hủy. | Permanent deletion runs after 5 days. It can be undone until then. Members cannot enter; the owner still can, to download files and cancel. |
| `slug_label` | Định danh tổ chức | Organization slug |
| `slug_hint` | Gõ lại {{slug}} để xác nhận. | Type {{slug}} again to confirm. |
| `slug_mismatch` | Định danh chưa khớp. | The slug does not match. |
| `delete_toast` | Đã ghi nhận xóa tổ chức | Organization deletion scheduled |
| `scheduled_banner` | Sẽ xóa cứng lúc {{at}}. | Permanent deletion at {{at}}. |
| `undo_delete` | Hoàn tác xóa | Undo deletion |
| `undo_delete_title` | Hoàn tác xóa {{name}}? | Undo deletion of {{name}}? |
| `undo_delete_description` | Lệnh xóa bị hủy. Thành viên vào lại được. | The deletion is cancelled. Members can enter again. |
| `undo_delete_toast` | Đã hoàn tác lệnh xóa | Deletion undone |
| `erased_banner` | Tổ chức đã bị xóa cứng. | This organization has been permanently deleted. |

Toast lỗi dùng `admin.detail.error_write` đang có khi `apiErrorMessage` không có câu. Không thêm khóa lỗi riêng.

## 6. Kiểm thử

Dịch vụ, trong `server/internal/service/tenant_delete_test.go`, dùng fixture riêng tư đang có cộng `AdminService` đã gắn `PrivacyExportService`:

- Đúng slug và lý do đủ dài: một hồ sơ `delete`, `deletion_scheduled_at` nằm trong một phút quanh thời điểm ghi nhận cộng 5 ngày, một dòng `admin_actions` `organization.deletion_scheduled` mang lý do, một dòng nhật ký `privacy.deletion_requested` có `platform_admin` và `reason`, một outbox `privacy.deletion_requested`. `Exports` của chủ sở hữu đọc được hồ sơ đó.
- Slug sai: 400 `privacy_delete_confirm`, không hồ sơ, không `admin_actions`.
- Lý do ngắn: `ErrReasonTooShort`, không ghi gì.
- Hồ sơ xuất hoặc xóa đang mở: 409 `privacy_export_in_flight`.
- `suspended_reason = organization_deleted`: 409 `organization_already_deleted` cả khi slug là `d-<id>`.
- Tổ chức `suspended` và tổ chức `archived` / `organization_closed` xếp lệnh được.
- Hoàn tác trước `started_at`: lịch về `null`, `admin_actions` `organization.deletion_cancelled`, nhật ký `privacy.deletion_cancelled`.
- Hoàn tác sau `started_at`: 409 `privacy_delete_started`, lịch còn.
- Chủ sở hữu hủy lệnh do admin tạo bằng `CancelDeletion`: thành công, không có dòng `admin_actions` cho lần hủy đó.
- Hook truyền vào hàm xếp hàng trả lỗi: transaction rollback, `deletion_scheduled_at` vẫn `null`. `AdminService` dùng chính tham số hook đó để gọi `recordAdmin`.

HTTP: hai route mới có mặt trong `isoRoutes` với `isoPlatform`. Handler: `support` nhận 403, không có vai trò nền tảng nhận 404. `GET` chi tiết có `deletion_scheduled_at` và `erased`.

Client: `packages/core/api/endpoints/admin.test.ts` chứng minh hai POST và schema chi tiết. Response hỏng của POST trả `null` thay vì ném. Response chi tiết thiếu hai trường mới vẫn parse được, với `erased` false và `deletion_scheduled_at` null.

Màn hình, `packages/views/admin/organization-deletion.test.tsx`:

- `platform_role` `admin`, chưa có lệnh: không gửi khi slug sai hoặc lý do ngắn; slug khớp và lý do đủ thì `POST .../deletion` với `confirm_slug` và `reason`.
- `deletion_scheduled_at` có giá trị: nút «Hoàn tác xóa», banner có thời điểm, hộp thoại không có ô slug, `POST .../deletion/cancel` chỉ có `reason`.
- `erased`: nút «Xóa tổ chức» disabled, banner xóa cứng, không mở hộp thoại.
- `platform_role` `support`: không có nút, vẫn có banner khi đang chờ hoặc đã xóa cứng.

Không thêm e2e. Không đổi consumer, `tenantDeleteRetain`, hay danh sách bảng xuất.

## 7. Ngoài phạm vi

- Không xóa thêm bảng, không thu hồi hộp thư hay lịch ở nhà cung cấp, không dọn `feature_flag_overrides`.
- Không nút xóa trên danh sách tổ chức.
- Không cho `support` ghi.
- Không đổi cửa sổ 5 ngày, không xóa ngay.
- Không bắt chủ sở hữu gõ lý do admin khi họ tự hủy.
