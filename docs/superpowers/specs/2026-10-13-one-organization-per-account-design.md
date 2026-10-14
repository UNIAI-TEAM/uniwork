# UniWork — Một tài khoản, một tổ chức: rời, đóng và chuyển tổ chức qua lời mời

> **Trạng thái:** in-progress — duyệt thiết kế 2026-10-13 (quangpd, UNI-1456).

**Ngày:** 2026-10-13
**Issue:** UNI-1456 — Điều chỉnh luồng quản lý Organization và chuyển đổi tổ chức trong UniWork
**ADR mới:** 0032 (viết cùng PR-A)
**Spec liên quan:** `2026-08-25-onboarding-organizations-design.md` (onboarding, lời mời), `2026-09-04-organization-people-directory-design.md` (F-03: leave, transfer, deactivate), `2026-10-12-tenant-export-design.md` (C-06: xóa tổ chức 5 ngày), `2026-10-12-mcp-connector-design.md` (grant theo org)

## 1. Mục tiêu

Mỗi tài khoản thuộc **tối đa một tổ chức đang hoạt động** tại một thời điểm, server
giữ quy tắc này kể cả khi người dùng thao tác đồng thời trên nhiều tab hoặc gọi API
trực tiếp. Người dùng vẫn:

- tự tạo tổ chức + workspace đầu tiên để trải nghiệm;
- tham gia thẳng qua lời mời khi chưa có tổ chức;
- chuyển sang tổ chức khác **ngay trong trang lời mời**, kể cả khi đang là owner, mà
  không bao giờ mất tổ chức cũ vì lời mời mới hết hạn, bị thu hồi hay mạng rớt;
- không bị kẹt: owner duy nhất có lối **đóng tổ chức**.

## 2. Hiện trạng (2026-10-13)

| Có sẵn | Ở đâu |
| --- | --- |
| Leave Organization (member/admin; owner bị 409 `last_owner`) | `OrganizationMemberService.Leave` (`server/internal/service/organization_members.go`), `POST /api/v1/orgs/{org}/leave`, `organization-tab.tsx` |
| Transfer Ownership tức thì, nhập lại mật khẩu, khoá `FOR UPDATE` 2 dòng; owner cũ thành `admin` | `TransferOwnership` (`organization_invitations.go`), `transfer-ownership-dialog.tsx` |
| Xóa tổ chức sau 5 ngày (privacy, C-06) | `tenant_delete.go`, tab Privacy |
| Ngắt socket khi `member.left` / `organization.suspended` | `realtime/access_revoker.go` |
| Session theo user, JWT không mang org | `internal/auth/token.go` |

| Thiếu | Hệ quả |
| --- | --- |
| Không có quy tắc một tổ chức ở DB, service hay UI | `Create`, `AcceptInvite`, `Reactivate` thêm membership tùy ý; onboarding có thẻ "Tạo tổ chức mới"; `/invitations` có "Tham gia tất cả" |
| `AcceptInvite` đọc token ngoài transaction, không khoá; `MarkInvitationAccepted` không guard | Hai lời mời accept song song đều thành; lời mời bị thu hồi giữa chừng vẫn accept |
| `Leave` kiểm role ngoài transaction, không khoá | Đua với Transfer Ownership có thể để tổ chức không còn owner |
| `/invite/[token]` tự accept khi mở, không preview | Không có chỗ cho luồng chuyển tổ chức |
| Không có "đóng tổ chức" tức thì | Owner duy nhất bị kẹt (chỉ có xóa 5 ngày, và vẫn là thành viên trong 5 ngày đó) |
| `PendingInvitationSchema.workspace` bắt buộc trong khi server bỏ key với lời mời cấp tổ chức | Một lời mời cấp tổ chức làm client vứt cả danh sách `/me/invitations` |

Dữ liệu dev: 0 tài khoản thuộc > 1 tổ chức. Production chưa kiểm; migration `004` có
thể đã sinh tài khoản đa tổ chức (một org cho mỗi workspace cũ).

## 3. Quyết định

| # | Quyết định | Lý do |
| --- | --- | --- |
| D1 | "Đang thuộc tổ chức" = dòng `organization_members` có `deactivated_at IS NULL` **và** `organizations.status IN ('active','suspended')`. | Dòng bị deactivate và tổ chức `archived` (đã đóng hoặc đã xóa) không giữ chân ai; tổ chức bị suspend vẫn tính để không lách được bằng suspend/unsuspend. |
| D2 | Tài khoản đang thuộc ≥ 2 tổ chức được **giữ nguyên**; từ nay không thêm membership mới cho đến khi còn ≤ 1. | Không đổi quyền truy cập của người dùng thật mà họ không chọn. |
| D3 | Thực thi bằng **advisory lock theo user** + kiểm tra trong transaction ở mọi đường ghi membership; **không** unique index. | Index sẽ fail khi còn dữ liệu đa tổ chức (D2), phá case `member-of-both` của isolation matrix, và không nhìn được status tổ chức. Mẫu advisory lock đã có (`documents.sql`, `projects.sql`). |
| D4 | **Đóng tổ chức = lưu trữ, không xóa dữ liệu.** Tổ chức thành `archived` với `suspended_reason='organization_closed'`; dòng owner bị deactivate; dữ liệu, workspace, `workspace_members` giữ nguyên. Không có nút khôi phục trong phạm vi này. | Owner được giải phóng ngay; dữ liệu còn để platform admin khôi phục về sau nếu cần. Dùng lại `archived` để mọi gate `status != active` đã từ chối sẵn. |
| D5 | Chỉ đóng được khi owner là **thành viên active duy nhất**. Còn thành viên active khác → phải Transfer Ownership. | Theo FR-04; không ai khác mất quyền truy cập vì một mình owner quyết. |
| D6 | Transfer Ownership **có hiệu lực ngay**, không cần người nhận đồng ý (EC-02 không áp dụng). | Cho phép chuyển tổ chức trong một bước atomic. |
| D7 | Owner cũ sau khi transfer (không rời) là **admin**, giữ như F-03. | Trong luồng chuyển tổ chức owner cũ rời luôn nên vai trò không đổi gì. |
| D8 | Luồng chuyển tổ chức là **một lệnh atomic trên server**: `accept` nhận `resolve` mô tả cách xử lý từng tổ chức cũ; mọi bước trong một transaction. | AC-10/11/14, EC-04/05/06/07/12: lời mời không còn hiệu lực ⇒ rollback toàn bộ, người dùng vẫn ở tổ chức cũ. |
| D9 | Member/admin của tổ chức `suspended` hoặc đang chờ xóa **được phép Leave**; owner của tổ chức `suspended` thì `blocked` (liên hệ support). | Không để thành viên kẹt trong tổ chức họ không dùng được; owner suspended là ca hiếm, cần người vận hành. |
| D10 | Không làm "mã mời", không làm nút "Từ chối" lời mời (cần cột `declined_at`). Có "Để sau"; lời mời tự hết hạn sau 7 ngày. | YAGNI; FR-06 "tạm bỏ qua" được đáp ứng. |
| D11 | Khi mời, **không** báo người mời rằng người được mời đang thuộc tổ chức khác. | Tránh lộ thông tin giữa tenant (ADR 0008). |
| D12 | `onboarded_at` không bị xóa khi rời/đóng; người dùng không còn tổ chức được đưa tới `/get-started`. | `onboarded_at` vẫn là nguồn duy nhất cho "đã qua onboarding". |

## 4. Server

### 4.1. Query mới / sửa (`server/pkg/db/queries/`)

| Query | Nội dung | `-- tenant:` |
| --- | --- | --- |
| `LockUserMembership` | `SELECT pg_advisory_xact_lock(hashtextextended('org-membership:' \|\| $1, 0))` | `self` |
| `ListActiveOrganizationsForUser` | các tổ chức người dùng đang thuộc theo D1, kèm `role`, `name`, `slug`, `status` | `self` |
| `CountActiveOrganizationsForUser` | sửa: thêm lọc `o.status IN ('active','suspended')` | giữ |
| `CountActiveOtherMembers` | số thành viên active ≠ người gọi trong một tổ chức | `organization_id = $n` |
| `LockInvitationByToken` | `SELECT … FROM invitations WHERE token=$1 FOR UPDATE`, **mọi trạng thái** | `token` |
| `GetInvitationByTokenAnyState` | như trên, không khoá (cho preview) | `token` |
| `MarkInvitationAccepted` | sửa: thêm `AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, `:execrows` | giữ |
| `RevokePendingInvitationsForOrg` | thu hồi mọi lời mời pending của tổ chức | `organization_id = $n` |
| `CloseOrganization` | `status='archived'`, `suspended_at=now()`, `suspended_reason='organization_closed'` `WHERE id=$1 AND status='active'` | `by-id` |
| `ListOrganizationsForUser` | sửa: bỏ tổ chức `archived` | giữ |

Không có migration cho `organization_members` hay `organizations`.

### 4.2. Khoá và kiểm tra ở mọi đường ghi membership

Một helper trong `service` (file mới `org_membership_guard.go`):

```go
// lockMembership serializes every membership change of one account (ADR 0032).
func lockMembership(ctx context.Context, q *db.Queries, userID string) error
// activeOrganizations lists the organizations the account counts as belonging to (D1).
func activeOrganizations(ctx context.Context, q *db.Queries, userID string) ([]db.ListActiveOrganizationsForUserRow, error)
```

| Lệnh | Thay đổi |
| --- | --- |
| `OrganizationService.Create` | Đầu transaction: `lockMembership`; `activeOrganizations` ≠ rỗng ⇒ 409 `already_in_organization` kèm `details: {organization: {id,name,slug}}` của tổ chức hiện tại (tổ chức của chính người gọi). |
| `WorkspaceService.AcceptInvite` | Viết lại theo §4.4. |
| `OrganizationMemberService.Reactivate` | `lockMembership(target)`; target đang thuộc tổ chức khác ⇒ 409 `member_in_other_organization` (không nêu tên tổ chức kia). |
| `OrganizationMemberService.Leave` | Đầu transaction: `lockMembership`, `LockOrganizationMemberForUpdate`, kiểm lại role trong transaction (owner ⇒ 409 `last_owner`). Không qua `RequireMember` nữa mà qua gate riêng cho phép tổ chức `suspended` / chờ xóa với non-owner (D9); dòng đã deactivate vẫn bị từ chối `member_deactivated`. Handler hiện resolve slug qua `GetBySlug` (đi qua `RequireMemberQ`, chặn `suspended`), nên route leave đổi sang lookup chỉ trả id cho người có dòng membership chưa deactivate — người ngoài vẫn nhận 404 như cũ. |
| `Close` (mới) | §4.5. |
| `TransferOwnership` | Không đổi logic; tách thân transaction thành `transferOwnershipQ(ctx, q, …)` để §4.4 gọi lại. Tương tự `leaveQ`. |

`InviteToOrg`, `InviteMany` không đổi (D11). Không thu hồi session khi rời/đóng (D12).

### 4.3. `GET /api/v1/invitations/{token}` — xem trước

Cần đăng nhập. Kiểm tra như accept: email đã xác minh (`email_unverified`), đúng
mailbox (403 `invitation_email_mismatch`). Token không tồn tại ⇒ 404. Lời mời
`pending` vào tổ chức không nhận thêm người (không `active` ⇒ 403
`organization_suspended`; đang chờ xóa ⇒ 403 `organization_deletion_scheduled`)
trả đúng lỗi accept sẽ trả, để không ai đi hết wizard chuyển tổ chức rồi mới bị từ chối.

`InvitationPreviewSDO`:

```
invitation: {
  id, status: "pending" | "expired" | "revoked" | "accepted", expires_at,
  organization: { id, name, slug }, workspace?: { id, name, slug },
  org_role, inviter_name?
}
conflicts: [{
  organization: { id, name, slug }, role,
  required_action: "leave" | "transfer" | "close" | "blocked",
  blocked_reason?: "owner_of_suspended_organization",
  transfer_candidates_count
}]
```

`required_action` tính trên từng tổ chức trong `activeOrganizations`, bỏ chính tổ
chức mời (người đã là thành viên tổ chức mời — lời mời cấp workspace — không có xung đột):

| Vai trò / tình trạng | `required_action` |
| --- | --- |
| member, admin | `leave` |
| owner, tổ chức `active`, còn ≥ 1 thành viên active khác | `transfer` |
| owner, tổ chức `active`, là thành viên active duy nhất | `close` |
| owner, tổ chức `suspended` | `blocked` |

`conflicts` chỉ trả khi `status = pending`.

### 4.4. `POST /api/v1/invitations/{token}/accept` — nhận `resolve`

Body (tùy chọn, client cũ gửi rỗng vẫn chạy):

```
{ resolve?: [{ organization_id, action: "leave" | "transfer" | "close",
               transfer_to_user_id?, password?, confirm_slug? }] }
```

Trước transaction: email đã xác minh + đúng mailbox (đọc không khoá để trả lỗi sớm);
với mỗi mục `transfer`, kiểm mật khẩu (bcrypt) như `TransferOwnership`.

Trong **một** transaction:

1. `lockMembership(caller)`.
2. `LockInvitationByToken`. Không có ⇒ 404. `accepted_at` có:
   - người gọi đang là thành viên active của tổ chức đó ⇒ **200 với response như lần đầu** (idempotent, EC-12);
   - ngược lại ⇒ 410 `invitation_accepted`.
   `revoked_at` có ⇒ 410 `invitation_revoked`. Hết hạn ⇒ 410 `invitation_expired`.
3. Tổ chức mời phải `active` (giữ lỗi hiện có `organization_suspended`) và không
   đang chờ xóa (403 `organization_deletion_scheduled`: mọi gate sẽ từ chối người
   không phải owner, nên chuyển vào đó là mất tổ chức cũ mà không vào được tổ chức
   mới); dòng deactivate trong tổ chức mời ⇒ `member_deactivated` (giữ F-03).
4. Tính lại `conflicts` như §4.3. `resolve` phải phủ **đúng** mọi tổ chức trong
   `conflicts` với **đúng** `required_action`; có `blocked` hoặc lệch ⇒ 409
   `organization_switch_required` kèm `details: {conflicts}` mới nhất.
5. Xử lý từng tổ chức cũ:
   - `leave` ⇒ `leaveQ`;
   - `transfer` ⇒ `transferOwnershipQ(to)` rồi `leaveQ` (người nhận phải là thành viên active, EC-03);
   - `close` ⇒ `closeQ(confirm_slug)`.
6. Join tổ chức mới (logic hiện có: `Consume`, `AddOrganizationMember`,
   `ensureMemberProfile`, workspace nếu có, `syncDefaultChatRoomMembers`).
7. `MarkInvitationAccepted` — 0 dòng ⇒ rollback, 410.
8. `MarkUserOnboarded`; audit `member.joined` (như hiện có).

Lỗi bất kỳ ⇒ rollback toàn bộ: tổ chức cũ còn nguyên (AC-10, AC-11). Hai lời mời
accept song song: transaction sau chờ lock, rồi thấy tổ chức mới ở `conflicts` mà
`resolve` không có ⇒ 409 (EC-07, AC-14).

### 4.5. `POST /api/v1/orgs/{org}/close` — đóng tổ chức

SDI `{ confirm_slug }`. Trong một transaction:

1. `lockMembership(caller)`; `LockOrganizationMemberForUpdate(caller)`.
2. Người gọi phải là owner active của tổ chức `active` (khác ⇒ 403 / `organization_suspended`).
3. `confirm_slug` ≠ slug ⇒ 400 `close_confirm_mismatch`.
4. `CountActiveOtherMembers > 0` ⇒ 409 `organization_has_members`.
5. `CloseOrganization` (0 dòng ⇒ 409, tổ chức vừa đổi trạng thái).
6. Deactivate dòng owner (`deactivated_by` = chính owner).
7. `RevokePendingInvitationsForOrg`.
8. `CancelOrganizationSubscriptions`.
9. `revokeMcpGrantsForUserInOrg`, `DisconnectEmailHubAccountsForUser` (như Leave);
   sau commit `cleanUpEmailHubAccountsAfterCommit`.
10. Audit `organization.closed` + outbox `organization.closed`.

Không đụng dữ liệu nghiệp vụ, workspace, `workspace_members` (D4, BR-10). Một lệnh
xóa privacy đang chờ (C-06) vẫn chạy bình thường trên tổ chức đã đóng.

### 4.6. Mã lỗi mới (`server/internal/service/errors.go`)

| Mã | HTTP | Khi nào |
| --- | --- | --- |
| `already_in_organization` | 409 | Tạo tổ chức khi đang thuộc tổ chức |
| `organization_switch_required` | 409 | Accept thiếu/lệch `resolve` |
| `member_in_other_organization` | 409 | Reactivate người đã sang tổ chức khác |
| `organization_has_members` | 409 | Đóng khi còn thành viên active khác |
| `close_confirm_mismatch` | 400 | Slug xác nhận sai |
| `invitation_expired` / `invitation_revoked` / `invitation_accepted` | 410 | Lời mời không còn hiệu lực lúc accept |

### 4.7. HTTP / OpenAPI

- Route mới đăng ký qua `apiOp` trong `server/internal/handler/router/` (`invitations` preview cạnh accept; `close` trong `organizations.go`); SDI/SDO trong `dto/sdi`, `dto/sdo` có `description` + `example`.
- `{token}` đã có `pathParamSDI`. Kiểm `{org}` cho route close.
- Isolation: preview phân loại `isoScoped` theo token trong `isoRoutes` (như accept); close là route `{org}` nên `TestIsolationMatrix` tự phủ.

## 5. Events, realtime, audit

- **Topic mới `organization.closed`** — payload `{organization_id}`, scope `organization`, outbox. Thêm vào cả ba bản: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`. Action audit `organization.closed` trong `internal/audit/actions.go`; dòng `Close` trong `audit_coverage_test.go`.
- `AccessRevoker` xử lý `organization.closed` như `organization.suspended` (`DisconnectOrganization`).
- Luồng chuyển tổ chức **không** có topic riêng: cùng transaction phát `organization.ownership_transferred` (nếu transfer), `member.left` hoặc `organization.closed`, rồi `member.joined`. Metadata audit `member.left` thêm `invitation_id`, `switched_to_organization_id`. `member.left` ngắt mọi socket của người dùng sau 2 s; socket tổ chức mới tự kết nối lại và qua kiểm tra.
- Client `packages/core/realtime/use-realtime-sync.ts`: `member.left` / `member.joined` có `user_id` là chính mình (thao tác ở tab khác) ⇒ invalidate thêm danh sách tổ chức, danh sách workspace, `/me`. Guard tự đưa về `/get-started` khi mất quyền.

## 6. Web

### 6.1. `/invite/[token]` — `AcceptInviteView` viết lại

Bỏ auto-accept. Gọi preview; hiển thị theo trạng thái:

| Trạng thái | Giao diện |
| --- | --- |
| lỗi (404, `invitation_email_mismatch`, `email_unverified`, 429) | như hiện có |
| `expired` / `revoked` | báo đúng lý do; "bạn vẫn ở tổ chức hiện tại" nếu có |
| `accepted` | điều hướng vào tổ chức |
| `pending`, không xung đột | thẻ lời mời (tổ chức, vai trò, người mời, workspace nếu có) + **Tham gia** / **Để sau** |
| `pending`, có xung đột | wizard 3 bước (`Stepper`) ngay trong trang |

Wizard:

1. **Xung đột** — "Bạn đang thuộc {A}. Để tham gia {B}, bạn cần rời {A}." Thẻ A (vai trò hiện tại) và B (vai trò được mời); liệt kê quyền truy cập sẽ mất.
2. **Xử lý tổ chức cũ**, một khối cho mỗi `conflicts[i]`:
   - `leave` — ô xác nhận;
   - `transfer` — chọn người nhận + mật khẩu (tách phần trường từ `TransferOwnershipDialog` thành component dùng chung);
   - `close` — cảnh báo: workspace và dữ liệu được lưu trữ, không ai truy cập được, chỉ support khôi phục; gõ slug;
   - `blocked` — "Tổ chức đang bị tạm ngưng, hãy liên hệ hỗ trợ"; không cho đi tiếp.
3. **Xác nhận** — tóm tắt A → B; nút "Chuyển sang {B}" gửi một POST có `resolve`.

Kết quả: thành công ⇒ `qc.clear()`, refetch `/me` + `setSessionUser`, điều hướng
workspace hoặc `/workspaces` (AC-15). 409 `organization_switch_required` ⇒ dùng
`conflicts` trong lỗi, quay về bước 2 với thông báo "tình hình đã thay đổi". 410 ⇒
màn lỗi "lời mời không còn hiệu lực, bạn vẫn ở {A}". Thoát ở bất kỳ bước nào không
đổi gì (AC-10).

### 6.2. `/invitations`

- Bỏ "Tham gia tất cả".
- Mỗi dòng: **Xem** ⇒ `/invite/{token}` — một luồng duy nhất cho mọi lần tham gia.
- Sửa `PendingInvitationSchema`: `workspace` tùy chọn, thêm `org_role`.

### 6.3. `/get-started` — `NoOrganizationView` (route mới)

`packages/views/onboarding/no-organization-view.tsx`, route `apps/web/app/(auth)/get-started/page.tsx`, path builder `paths.getStarted()` (+ `GLOBAL_PREFIXES`, `consistency.test.ts`).

- **Tạo tổ chức** ⇒ `/workspaces/new`.
- **Tham gia tổ chức** ⇒ danh sách lời mời đang chờ (mỗi dòng ⇒ `/invite/{token}`); không có thì "Hãy nhờ quản trị viên mời email {email}".

Được dùng khi: sau Leave/Close; từ màn `member-deactivated` / `organization-suspended`
(thay "Xem tổ chức khác"); `resolvePostAuthDestination` / `resolveHomeDestination`
khi người dùng không có tổ chức active (cần biết tổ chức — đọc `useOrganizations`,
đã lọc `archived` ở server). Người dùng có tổ chức nhưng 0 workspace vẫn đi `/workspaces/new` như hiện tại.

### 6.4. Chặn tạo tổ chức (FR-02)

- `StepOrganization`: ẩn thẻ "Tạo tổ chức mới" khi `useOrganizations()` có tổ chức active.
- `classifyCreateFailure` thêm `already_in_organization`: hiện "Bạn đang là thành viên của {A}. Mỗi tài khoản chỉ có thể tham gia một tổ chức. Vui lòng rời tổ chức hiện tại trước khi tạo tổ chức mới." + nút **Quản lý tổ chức** ⇒ `settings?tab=organization` của workspace đầu tiên trong A (không có workspace ⇒ `/workspaces/new` để tạo workspace trong A).

### 6.5. Settings → Organization, vùng nguy hiểm

| Người xem | Hiển thị |
| --- | --- |
| member, admin | Leave (như hiện có); thành công ⇒ `/get-started` |
| owner, còn thành viên active khác | Transfer (như hiện có); Leave `aria-disabled`, lý do `leave_last_owner` |
| owner, thành viên active duy nhất | dòng mới **Đóng tổ chức** ⇒ dialog cảnh báo + gõ slug ⇒ `qc.clear()` ⇒ `/get-started`. Leave vẫn `aria-disabled` với lý do trỏ tới Đóng tổ chức |

Rule mới `canCloseOrg` trong `packages/core/permissions/rules.ts` (owner ∧ không còn
thành viên active khác — lấy từ `useTransferCandidates(...).none`), mirror
`OrganizationMemberService.Close`. Endpoint `closeOrganization` trong
`packages/core/api/endpoints/organization-members.ts`, hook `useCloseOrganization`
(`qc.clear()` khi thành công, như `useLeaveOrganization`).

### 6.6. Core

- Endpoint: `getInvitationPreview(token)`, `acceptInvite(token, resolve?)`, `closeOrganization(slug, confirmSlug)` — schema lenient, test response hỏng cho từng cái.
- Hook: `useInvitationPreview(token)` (key `["invitation-preview", token]`), `useAcceptInvite` nhận `resolve`, `useCloseOrganization`.
- `ApiError.details` dùng để đọc `conflicts` từ 409.

### 6.7. Copy và thuật ngữ

Thêm vào `docs/conventions.md` (glossary) trước khi viết copy:

| Khái niệm | vi | en |
| --- | --- | --- |
| leave organization | rời tổ chức | Leave organization |
| transfer ownership | chuyển quyền sở hữu | Transfer ownership |
| close organization | đóng tổ chức | Close organization |
| switch organization | chuyển tổ chức | Switch organization |
| owner (nhãn UI) | chủ sở hữu | Owner |

Key mới trong cả `vi.json` và `en.json`: `invitations.preview.*`, `invitations.switch.*`, `org.close.*`, `onboarding.noOrganization.*`, `org.reasons.*` cho các mã lỗi §4.6.

## 7. Tài liệu và quản trị

- **ADR 0032 — Một tài khoản, một tổ chức** (`docs/adr/0032-…`, `**Trạng thái:** accepted`): D1–D4, D8.
- **ADR 0008**, đoạn "Thực thi": ghi rõ case `member-of-both` mô phỏng tài khoản đa tổ chức còn sót từ trước ADR 0032 (tạo bằng raw SQL); vẫn giữ.
- **CLAUDE.md**, Database and Migration Rules: thêm gạch đầu dòng — "A person belongs to at most one active organization (ADR 0032): `Create`, `AcceptInvite`, `Reactivate`, `Leave` and `Close` take `LockUserMembership` first and check `activeOrganizations` inside the transaction. `TestOneActiveOrganizationPerAccount` holds it."
- Spec F-03 / C-06 / onboarding không sửa nội dung; spec này là nơi ghi đè.

## 8. Testing

**Go (`server/internal/service/`)**

- `TestOneActiveOrganizationPerAccount`: tạo tổ chức thứ hai ⇒ `already_in_organization`; accept không `resolve` khi đã có tổ chức ⇒ `organization_switch_required`; tổ chức `archived`/dòng deactivate không tính.
- Chuyển tổ chức: ba nhánh `leave`, `transfer` (owner cũ rời, người nhận là owner), `close` (tổ chức cũ `archived`, `organization_closed`).
- Lời mời hết hạn / bị thu hồi trong lúc chuyển ⇒ 410, membership cũ nguyên vẹn, không có `member.left`.
- `resolve` lệch (thiếu tổ chức, sai action, `blocked`) ⇒ 409 kèm `conflicts`.
- Đồng thời: hai lời mời accept song song (goroutine) ⇒ đúng một thành công; hai `Create` song song ⇒ đúng một thành công; `Leave` đua `TransferOwnership` sang người rời ⇒ tổ chức vẫn có owner active.
- Accept gọi lại sau thành công ⇒ 200 cùng response.
- `Reactivate` người đã sang tổ chức khác ⇒ `member_in_other_organization`.
- `Close`: không phải owner, còn thành viên, slug sai, tổ chức không active; thành công thu hồi lời mời pending, hủy subscription, phát `organization.closed`, dữ liệu còn.
- `Leave` của member trong tổ chức `suspended` thành công.
- `GET /orgs` không trả tổ chức `archived`.
- `audit_coverage_test.go`, `scripts/events-catalogue.test.mjs`, `realtime/access_revoker_test.go` (`organization.closed`).

**Handler**: SDI/SDO, mã lỗi → HTTP, `isoRoutes` cho preview.

**`packages/core`**: endpoint preview/accept-resolve/close (+ malformed); `canCloseOrg`; resolve chọn `/get-started`; schema `PendingInvitation` với lời mời cấp tổ chức.

**`packages/views`**: `AcceptInviteView` (từng trạng thái, từng action, 409 làm mới, 410); `InvitationsView` (không còn "Tham gia tất cả", lời mời cấp tổ chức hiển thị); `NoOrganizationView`; `organization-tab` (dòng Đóng tổ chức theo vai trò); `StepOrganization` (ẩn thẻ tạo, lỗi `already_in_organization`).

**E2E**: `e2e/organization-switch.spec.ts` — (1) member tổ chức A mở lời mời B, đi wizard `leave`, vào B; (2) owner duy nhất đóng tổ chức ⇒ `/get-started` ⇒ tạo tổ chức mới. Năm spec onboarding (contrast, focus, mobile, shell, smoke) giữ xanh.

Coverage chỉ tăng: nâng `server/coverage.floor` / thresholds nếu số mới cao hơn.

## 9. Triển khai

Một branch `feature/UNI-1456-…`, hai PR nối tiếp, cùng release:

1. **PR-A — quy tắc + đóng tổ chức**: §4.1 (trừ query lời mời), §4.2, §4.5, §4.6 phần liên quan, §5 (`organization.closed`), §6.3–6.6 phần close, §6.7, §7, test tương ứng.
2. **PR-B — chuyển tổ chức qua lời mời**: §4.3, §4.4, query lời mời, §6.1, §6.2, e2e.

Giữa hai PR: người đã có tổ chức bấm lời mời nhận 409 và UI cũ báo "thất bại" chung — lý do cần cùng release.

## 10. Ngoài phạm vi

- Khôi phục tổ chức đã đóng (dữ liệu còn; thêm thao tác admin sau nếu cần).
- Nút "Từ chối" lời mời, mã mời, tìm tổ chức.
- Dọn dữ liệu tài khoản đa tổ chức hiện có (D2) và unique index (D3).
- Admin gỡ hẳn thành viên khỏi tổ chức; tự bỏ giao việc cho người đã rời (EC-10: dữ liệu giữ nguyên, phân công lại thủ công như hiện tại).
- Trial/billing: đóng tổ chức chỉ hủy subscription, không hoàn tiền.

## 11. Đối chiếu Acceptance Criteria

| AC | Đáp ứng bởi |
| --- | --- |
| AC-01 | Onboarding hiện có; `/get-started` → Tạo tổ chức |
| AC-02 | §4.4 không xung đột; §6.1 thẻ lời mời |
| AC-03, AC-04, AC-14 | §4.2 lock + kiểm tra; test đồng thời §8 |
| AC-05 | Leave + §4.4 `leave` |
| AC-06, AC-07 | Leave `last_owner`; Transfer; §4.4 `transfer` |
| AC-08 | §4.5 Close; §4.4 `close` |
| AC-09 | §6.1 wizard |
| AC-10, AC-11 | §4.4 một transaction, 410, rollback |
| AC-12 | `leaveQ` xóa membership; `member.left` ngắt socket; gate từ chối |
| AC-13 | D4, D12; không xóa tài khoản, không xóa dữ liệu |
| AC-15 | §6.1 `qc.clear()` + refetch `/me`, không đăng nhập lại |
