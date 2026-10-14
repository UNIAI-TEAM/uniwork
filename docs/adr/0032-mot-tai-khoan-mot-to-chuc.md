# 0032 — Một tài khoản, một tổ chức

**Trạng thái:** accepted (2026-10-13) — chấp nhận bởi quangpd khi duyệt spec
`2026-10-13-one-organization-per-account-design.md` (UNI-1456). Luật nằm ở `CLAUDE.md`
§ Database and Migration Rules.

## Bối cảnh

UniWork cho mỗi tài khoản thêm bao nhiêu dòng `organization_members` cũng được:
`Create`, `AcceptInvite` và `Reactivate` không hỏi người dùng đang thuộc tổ chức nào,
onboarding có thẻ "Tạo tổ chức mới", `/invitations` có "Tham gia tất cả". Sản phẩm
muốn ngược lại: một người làm việc cho một tổ chức tại một thời điểm, đổi tổ chức là
một thao tác có chủ ý.

Đường ghi membership hôm nay cũng không chịu được thao tác đồng thời. `AcceptInvite`
đọc token ngoài transaction, `MarkInvitationAccepted` không có guard, nên hai lời mời
accept song song đều thành và lời mời vừa bị thu hồi vẫn accept được. `Leave` kiểm role
ngoài transaction, nên đua với `TransferOwnership` có thể để tổ chức không còn owner.
Owner duy nhất không có lối ra: chỉ có xóa sau 5 ngày (C-06), và trong 5 ngày đó vẫn là
thành viên.

Dữ liệu có thể đã có tài khoản đa tổ chức: migration `004` sinh một tổ chức cho mỗi
workspace cũ.

## Quyết định

1. **"Đang thuộc tổ chức"** là có dòng `organization_members` với `deactivated_at IS NULL`
   **và** tổ chức có `status IN ('active','suspended')` (D1). Dòng đã deactivate và tổ chức
   `archived` (đã đóng hoặc đã xóa) không giữ chân ai. Tổ chức bị suspend vẫn tính, để
   không ai lách luật bằng suspend rồi unsuspend.
2. **Mỗi tài khoản thuộc tối đa một tổ chức đang hoạt động.** Tài khoản đang thuộc từ hai
   tổ chức trở lên được **giữ nguyên**; từ nay không thêm membership mới cho tài khoản đó
   cho đến khi còn tối đa một (D2). Không đổi quyền truy cập của người dùng thật mà họ
   không chọn.
3. **Thực thi bằng advisory lock theo user, không bằng unique index** (D3). Mọi lệnh ghi
   membership (`OrganizationService.Create`, `WorkspaceService.AcceptInvite`,
   `OrganizationMemberService.Reactivate`, `Leave`, `Close`) mở transaction bằng
   `LockUserMembership`
   (`pg_advisory_xact_lock(hashtextextended('org-membership:' || user_id, 0))`), rồi đọc
   các tổ chức người dùng đang thuộc (`ListActiveOrganizationsForUser`, định nghĩa ở mục 1)
   **trong** transaction đó và từ chối nếu thêm membership sẽ vượt một:
   `already_in_organization` khi tạo, `organization_switch_required` khi accept,
   `member_in_other_organization` khi reactivate. Lý do không dùng index:
   - index unique trên `organization_members(user_id)` fail ngay khi còn dữ liệu đa tổ
     chức (mục 2) và không nhìn được `organizations.status` (mục 1);
   - `SELECT … FOR UPDATE` trên `organization_members` không khoá được gì khi người dùng
     chưa có dòng nào — đúng ca hai lời mời accept song song của một tài khoản mới;
   - advisory lock theo khoá đã có tiền lệ (`documents.sql`, `projects.sql`) và tự nhả khi
     transaction kết thúc.
4. **Đóng tổ chức là lưu trữ, không xóa dữ liệu** (D4). `POST /api/v1/orgs/{org}/close`
   đưa tổ chức về `archived` với `suspended_reason='organization_closed'`, deactivate dòng
   của owner, thu hồi lời mời đang chờ, hủy subscription và phát `organization.closed`.
   Dữ liệu nghiệp vụ, workspace và `workspace_members` giữ nguyên. Chỉ owner là thành viên
   active duy nhất mới đóng được; còn người khác thì phải chuyển quyền sở hữu. Dùng lại
   `archived` để mọi gate `status != 'active'` sẵn có đã từ chối tổ chức đã đóng mà không
   phải sửa từng gate. Không có nút khôi phục; dữ liệu còn để platform admin khôi phục về
   sau nếu cần.
5. **Chuyển tổ chức là một lệnh atomic trên server** (D8). `POST
   /api/v1/invitations/{token}/accept` nhận `resolve` nói cách xử lý từng tổ chức cũ
   (`leave`, `transfer`, `close`); khoá membership, khoá lời mời, xử lý tổ chức cũ và tham
   gia tổ chức mới chạy trong **một** transaction. Lời mời hết hạn, bị thu hồi hay đã dùng,
   hoặc `resolve` không khớp tình hình mới nhất, thì rollback toàn bộ: người dùng vẫn ở tổ
   chức cũ. Không có trạng thái "đã rời A nhưng chưa vào được B". Cho đến khi `resolve`
   land (PR-B của UNI-1456), accept khi đang thuộc tổ chức khác trả 409
   `organization_switch_required` kèm danh sách xung đột.

## Hệ quả

- Không có migration cho `organization_members` hay `organizations`; luật sống ở service
  và một query khoá. Cái giá: một đường ghi membership mới quên lấy khoá sẽ phá luật mà
  schema không cản. `TestOneActiveOrganizationPerAccount` và các test đồng thời chỉ phủ năm
  lệnh ở mục 3; lệnh thứ sáu phải được thêm vào cả `CLAUDE.md` và test.
- Mọi thay đổi membership của một tài khoản chạy tuần tự. Một người hiếm khi đổi
  membership đồng thời nên chi phí không đáng kể, và hai tài khoản khác nhau không chờ nhau.
- `ListOrganizationsForUser` không trả tổ chức `archived`; người không còn tổ chức nào được
  đưa tới `/get-started`. `onboarded_at` không bị xóa khi rời hay đóng (D12).
- Thêm topic `organization.closed` ở cả ba catalogue; `AccessRevoker` ngắt socket như với
  `organization.suspended`.
- Ca `member-of-both` của ma trận cách ly (ADR 0008) không còn dựng được qua API; nó chèn
  dòng membership bằng raw SQL để mô phỏng tài khoản đa tổ chức sót lại từ trước ADR này,
  và vẫn được giữ vì những tài khoản đó còn tồn tại (mục 2).
- Ngoài phạm vi: dọn tài khoản đa tổ chức hiện có, unique index, khôi phục tổ chức đã
  đóng. Khi dữ liệu không còn tài khoản đa tổ chức, một ADR sau có thể thêm index làm lớp
  thứ hai; advisory lock vẫn cần vì index không nhìn được trạng thái tổ chức.

## Test giữ luật

- `TestOneActiveOrganizationPerAccount` (`server/internal/service`): tạo tổ chức thứ hai,
  accept khi đã có tổ chức, reactivate người đã sang tổ chức khác đều bị từ chối; dòng
  deactivate và tổ chức `archived` không tính.
- Test đồng thời cùng package: hai lời mời accept song song, hai `Create` song song (đúng
  một thành công); `Leave` đua `TransferOwnership` (tổ chức vẫn còn owner active).
- `TestIsolationMatrix`, ca `member-of-both` (ADR 0008).
