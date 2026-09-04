# UniWork — Hồ sơ, phòng ban, danh bạ và quản trị thành viên tổ chức

**Ngày:** 2026-09-04
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.
**Spec liên quan:** `2026-08-25-onboarding-organizations-design.md`, `2026-08-27-workspace-permissions-design.md`, `2026-08-27-settings-design.md`, `2026-08-28-transactional-email-design.md`, `2026-09-04-tenant-subscription-entitlement-design.md`
**Tham chiếu:** Vision §5.2 (#3 Organization & People, #1 Identity), §6.1 (phân quyền server-side), §7.2 V6 (actor hạng nhất); bản cũ `unidigiwork` `src/lib/api/people.functions.ts` (`PersonDTO`, `tenant_member_profiles`), `docs/audit/UNIWORK_GAP_REGISTER.md` G6 (6 nút chết ở `/people`), Blueprint §5.1, §13.3


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Biến **organization** từ một cái vỏ chứa workspace (hiện chỉ có `organizations` + `organization_members` với 3 role, không có UI quản trị) thành **bounded context Organization & People** hoàn chỉnh:

1. **Hồ sơ thành viên** trong bối cảnh tổ chức: chức danh, phòng ban, múi giờ, số điện thoại, ngày vào, người quản lý trực tiếp — tách khỏi `users` (danh tính toàn cục).
2. **Phòng ban** (`departments`) dạng cây nông (tối đa 2 cấp) trong organization.
3. **Danh bạ** `/people`: tìm, lọc theo phòng ban / vai trò / trạng thái, xem hồ sơ, xuất CSV — thay hoàn toàn màn `/people` của bản cũ (6 nút chết).
4. **Quản trị thành viên org** đang thiếu: mời vào org (không cần qua workspace), đổi role org, vô hiệu hóa / kích hoạt lại, chuyển quyền chủ sở hữu, rời tổ chức.
5. **Actor thống nhất**: một DTO `ActorDTO{id, kind, display_name, avatar_url}` mà mọi domain (task, meeting, comment, audit) dùng để hiển thị "ai làm", với `kind ∈ {human, agent}`. Spec này chỉ **dành chỗ** cho `agent`; định nghĩa bảng agent thuộc spec AI.

**Ngoài phạm vi đợt này**

- SCIM / đồng bộ từ Google Workspace, AD (Vision giai đoạn E).
- Org-level SSO bắt buộc, MFA policy (spec Identity).
- Sơ đồ tổ chức dạng đồ họa; chỉ có trường `manager_id` và danh sách "báo cáo cho".
- Kỹ năng, teams chéo phòng ban (`skills`, `teams` của bản cũ) — bỏ, xem §8.

## 2. Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | `users` giữ danh tính toàn cục (email, tên hiển thị, avatar, locale). Mọi thuộc tính "trong công ty này" nằm ở `organization_member_profiles` (1 dòng cho mỗi cặp org–user). Cùng một người ở hai org có hai hồ sơ. |
| 2 | Trạng thái thành viên org là timestamp, không boolean: `organization_members.deactivated_at`. Thành viên bị vô hiệu hóa **không** bị xóa khỏi workspace (giữ lịch sử), nhưng `RequireMember` ở mọi cấp trả `ErrForbidden`. |
| 3 | Role org giữ 3 giá trị `owner | admin | member`; **đúng một** owner tại một thời điểm (unique partial index). Chuyển owner là một thao tác nguyên tử: owner cũ → `admin`. |
| 4 | Phòng ban là dữ liệu của org, không của workspace. Một thành viên thuộc **tối đa một** phòng ban (`profile.department_id`). Cần nhiều → dùng workspace. |
| 5 | Lời mời **org-level** dùng lại bảng `invitations` với `workspace_id` cho phép `NULL` (nới ràng buộc bằng migration; `001` không sửa — dùng `ALTER COLUMN DROP NOT NULL` ở migration mới). Accept lời mời org chỉ tạo `organization_members`. |
| 6 | Danh bạ tìm kiếm bằng `ILIKE` + index trigram trên cột sinh `search_text` (tên, email, chức danh, phòng ban). Không Elasticsearch trong giai đoạn F. |
| 7 | Xuất CSV do server sinh (stream), giới hạn 10.000 dòng, chỉ owner/admin; phát audit event `people.exported`. |
| 8 | Quyền hồ sơ: chính chủ sửa được `title`, `phone`, `timezone`, `bio`, `manager_id` **không**; owner/admin sửa mọi trường kể cả `department_id`, `manager_id`, `employee_code`, `joined_on`. |
| 9 | `ActorDTO` được resolve ở tầng handler qua `ActorResolver` (batch theo id), không join trong từng query domain. Cột nguồn: `users` khi `kind=human`; bảng agent (spec AI) khi `kind=agent`. Cột `actor_kind` trên bảng domain mới **bắt buộc**; bảng cũ (`tasks.created_by`, …) mặc định `human` cho đến khi spec AI thêm cột. |
| 10 | Platform admin (vận hành UNICOM) là cột `users.is_platform_admin BOOLEAN`, chỉ set bằng CLI `server/cmd/admin`, không có API. Spec Billing và Platform Admin dùng chung cột này. |

## 3. Dữ liệu

Quy tắc: ULID `TEXT`, không FK, index `CONCURRENTLY` mỗi file. Số migration đề xuất `070`–`081`.

### 3.1 `070_users_platform_admin.up.sql`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
```

`timezone` ở `users` vì nó theo người, không theo công ty; validate bằng `time.LoadLocation` trong service.

### 3.2 `071_departments.up.sql`

```sql
CREATE TABLE departments (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  parent_id       TEXT,                  -- tối đa 2 cấp: service từ chối parent đã có parent
  name            TEXT NOT NULL,
  code            TEXT,                  -- 'ENG', 'SALES'; unique trong org khi không NULL
  head_user_id    TEXT,                  -- trưởng phòng
  sort_order      INTEGER NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`072_departments_org_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_departments_org ON departments(organization_id, sort_order) WHERE archived_at IS NULL;`
`073_departments_org_code_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_departments_org_code ON departments(organization_id, code) WHERE code IS NOT NULL AND archived_at IS NULL;`

### 3.3 `074_organization_member_profiles.up.sql`

```sql
CREATE TABLE organization_member_profiles (
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',      -- chức danh
  department_id   TEXT,
  manager_id      TEXT,                          -- user_id người quản lý trực tiếp, cùng org
  employee_code   TEXT,                          -- mã nhân viên, unique trong org khi không NULL
  phone           TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',      -- văn phòng / thành phố, chuỗi tự do
  bio             TEXT NOT NULL DEFAULT '',      -- ≤ 500 ký tự
  joined_on       DATE,
  search_text     TEXT NOT NULL DEFAULT '',      -- ghi bởi service: lower(display_name || email || title || department.name)
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
```

`075_member_profiles_search_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_member_profiles_search ON organization_member_profiles USING gin (search_text gin_trgm_ops);` (yêu cầu `CREATE EXTENSION IF NOT EXISTS pg_trgm` — đặt trong `074`, không phải file index).
`076_member_profiles_employee_code_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_member_profiles_employee_code ON organization_member_profiles(organization_id, employee_code) WHERE employee_code IS NOT NULL;`
`077_member_profiles_department_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_member_profiles_department ON organization_member_profiles(organization_id, department_id);`

Backfill trong `074` (DML): mỗi `organization_members` → 1 dòng profile rỗng, `search_text` từ `users`. Từ đây, `OrganizationService.AddMemberIfAbsent` và `AcceptInvite` tạo profile trong cùng tx (service, không trigger).

`search_text` được cập nhật bởi service ở 3 điểm: sửa profile, sửa `users.display_name`/`email` (`PATCH /me` → gọi `ProfileService.RefreshSearchText(userID)` cho mọi org), đổi tên phòng ban (refresh mọi thành viên phòng đó).

### 3.4 `078_organization_members_lifecycle.up.sql`

```sql
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS deactivated_by TEXT;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS invited_by TEXT;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

`079_organization_members_owner_uidx.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_org_members_single_owner ON organization_members(organization_id) WHERE role = 'owner' AND deactivated_at IS NULL;`

Trước khi tạo index: kiểm tra dữ liệu — `004` grandfather có thể tạo nhiều owner nếu workspace cũ có nhiều owner. `078` chứa DML: với mỗi org có >1 owner, giữ owner có `created_at` nhỏ nhất, hạ các owner còn lại xuống `admin` (ghi log migration). Test migration kiểm tra tình huống này.

### 3.5 `080_invitations_org_level.up.sql`

```sql
ALTER TABLE invitations ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS organization_id TEXT;   -- backfill từ workspaces.organization_id
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invited_by TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
UPDATE invitations i SET organization_id = w.organization_id FROM workspaces w WHERE w.id = i.workspace_id AND i.organization_id IS NULL;
ALTER TABLE invitations ALTER COLUMN organization_id SET NOT NULL;
```

Lưu ý: `001` có `REFERENCES workspaces(id)` trên cột này — DROP NOT NULL không đụng FK; FK cũ vẫn chấp nhận `NULL`. `lint_test.go` chỉ áp cho `005+`, và file này không thêm FK mới.

`081_invitations_org_pending_idx.up.sql`: `CREATE INDEX CONCURRENTLY idx_invitations_org_pending ON invitations(organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;`

### 3.6 Cột `actor_kind` (dành chỗ)

Spec này **không** thêm `actor_kind` vào bảng cũ. Quy ước cho mọi migration mới từ nay: cột tác nhân đi thành cặp `<verb>_by TEXT NOT NULL` + `<verb>_by_kind TEXT NOT NULL DEFAULT 'human'`. `lint_test.go` thêm rule: `CREATE TABLE` có `created_by` mà không có `created_by_kind` → fail (áp từ `082+`, có allowlist cho các bảng ở spec này vì `updated_by` ở profile luôn là người).

## 4. Service (Go)

```
server/internal/service/
  organization.go          # mở rộng: Members, InviteToOrg, AcceptOrgInvite, UpdateMemberRole, Deactivate, Reactivate, TransferOwnership, Leave
  organization_test.go
  department.go            # DepartmentService: List, Create, Update, Archive, Reorder
  department_test.go
  people.go                # PeopleService: Search, Get, UpdateProfile, ExportCSV, RefreshSearchText
  people_test.go
  actor.go                 # ActorResolver: Resolve(ctx, refs []ActorRef) map[ActorRef]ActorView
server/pkg/db/queries/
  organizations.sql        # thêm
  departments.sql
  member_profiles.sql
```

### 4.1 Quyền (một bảng, mirror sang `rules.ts`)

`effective_org_role` = `organization_members.role` khi `deactivated_at IS NULL`; ngược lại không phải thành viên. `RequireOrgMember` (đã có) sửa để loại thành viên đã vô hiệu hóa; `WorkspaceService.RequireMember` gọi qua nó nên tự hưởng.

| Hành động | member | admin | owner | platform admin |
|---|---|---|---|---|
| Xem danh bạ, xem hồ sơ người khác | ✓ | ✓ | ✓ | ✓ |
| Sửa hồ sơ của mình (title, phone, location, bio) | ✓ | ✓ | ✓ | – |
| Sửa hồ sơ người khác, `department_id`, `manager_id`, `employee_code`, `joined_on` | – | ✓ | ✓ | ✓ |
| Tạo/sửa/lưu trữ phòng ban | – | ✓ | ✓ | ✓ |
| Mời vào org, thu hồi lời mời | – | ✓ | ✓ | ✓ |
| Đổi role `admin` ↔ `member` | – | ✓ (không tự nâng mình lên owner) | ✓ | ✓ |
| Vô hiệu hóa / kích hoạt lại thành viên | – | ✓ (không được vô hiệu hóa owner/admin khác) | ✓ (trừ chính mình) | ✓ |
| Chuyển quyền owner | – | – | ✓ | ✓ |
| Rời tổ chức | ✓ | ✓ | – (phải chuyển owner trước) | – |
| Xuất CSV | – | ✓ | ✓ | ✓ |

Mọi gate ở service; handler chỉ decode. Lỗi: `ErrForbidden` (403), `ErrLastOwner` mới (409, code `last_owner`), `ErrMemberDeactivated` (403, code `member_deactivated`), `ErrDepartmentDepth` (400, code `department_depth_exceeded`), `ErrSelfDeactivate` (400, code `cannot_deactivate_self`).

### 4.2 Hành vi chính

- **InviteToOrg(actorID, orgID, emails[], orgRole)**: tối đa 50, dedupe/lowercase như `InviteMany`; email đã là thành viên active → `skipped`; email đã có lời mời pending → tái sử dụng (không tạo token mới). Gọi `Entitlement.CheckQuota(orgID, "members.max", len(emails))` **trước** khi tạo lời mời để báo sớm; `Consume` thật diễn ra khi accept. Gửi email qua `mail.Enqueuer` (đã có ở `transactional-email`), template `org_invite`.
- **AcceptOrgInvite(userID, token)**: một tx — upsert `organization_members` (nếu đang `deactivated_at` → **không** tự kích hoạt lại, trả `member_deactivated`), tạo profile, `Consume(members.max, +1)`, mark accepted, `MarkUserOnboarded` nếu chưa. Có `workspace_id` → cộng thêm bước như `AcceptInvite` hiện tại (gộp hai hàm thành một, `AcceptInvite` cũ gọi hàm mới).
- **Deactivate(actorID, orgID, targetID)**: set `deactivated_at/by`; revoke mọi `refresh_tokens` của target **chỉ khi** target không còn org active nào khác (người dùng có thể thuộc nhiều org); `Consume(members.max, -1)`; đóng phiên realtime của target trên mọi scope thuộc org (`EventPublisher.SendToUser(target, "session.revoked", {organization_id})`). Workspace membership giữ nguyên.
- **Reactivate**: `CheckQuota(members.max, +1)` → clear `deactivated_at` → `Consume(+1)`.
- **TransferOwnership(actorID, orgID, targetID)**: một tx với `SELECT ... FOR UPDATE` hai dòng; target phải active; owner cũ → `admin`, target → `owner`; audit + outbox `organization.ownership_transferred`. Có bước xác nhận lại mật khẩu ở FE? → §10.
- **Leave**: member/admin tự xóa `organization_members` **và** mọi `workspace_members` của org trong tx (không vô hiệu hóa, vì là tự nguyện) — ghi `usage_events` -1. Owner → `last_owner`.
- **Department.Archive**: phòng ban còn thành viên → chuyển `department_id = NULL` cho tất cả trong tx, `search_text` refresh; phòng ban có con → từ chối (`department_has_children`, 409).
- **People.Search(orgID, q, filters, page)**: `q` ≥ 2 ký tự → `search_text ILIKE '%q%'` (trigram index); filters `department_id`, `role`, `status ∈ active|deactivated` (mặc định active), `manager_id`; sort `display_name`; cursor keyset `(display_name, user_id)`; page ≤ 100.
- **ExportCSV**: stream `text/csv; charset=utf-8` với BOM (Excel tiếng Việt), cột: `display_name,email,title,department,manager,employee_code,phone,location,org_role,status,joined_on`. Audit event `people.exported {organization_id, actor_id, row_count}`.
- **ActorResolver.Resolve**: input `[]ActorRef{ID, Kind}`; `human` → batch `users` (1 query, `WHERE id = ANY($1)`); `agent` → hook `AgentLookup` interface, mặc định trả `{display_name: "Agent", kind: agent}` cho đến khi spec AI cung cấp. Kết quả cache theo request (context value), không cache toàn cục.

### 4.3 Sự kiện

| Sự kiện | Kênh | Payload (id-only) |
|---|---|---|
| `org.member.added` / `org.member.deactivated` / `org.member.reactivated` / `org.member.role_changed` / `org.member.left` | `SendToUser` mọi org owner/admin + target; outbox topic cùng tên | `{organization_id, user_id}` |
| `organization.ownership_transferred` | outbox + `SendToUser` cả hai bên | `{organization_id, from_user_id, to_user_id}` |
| `department.created` / `department.updated` / `department.archived` | `PublishToScope("org", orgID, …)` (scope mới, xem §7.3) | `{organization_id, department_id}` |
| `profile.updated` | `PublishToScope("org", orgID, …)` | `{organization_id, user_id}` |
| `people.exported` | chỉ audit (outbox topic `audit`) | `{organization_id, actor_id, row_count}` |
| `session.revoked` | `SendToUser(target)` | `{organization_id}` |

Spec Audit & Notification tiêu thụ; spec này chỉ phát và **không** tạo bảng audit riêng (dùng outbox topic `audit` như quy ước chung sẽ chốt ở spec Audit).

## 5. API (`/api/v1`, sau `RequireAuth`)

Router: `router/organizations.go` (mở rộng), `router/people.go` (tag mới `People`), `router/departments.go` (tag `Departments`). SDI/SDO: `dto/sdi/organization.go`, `people.go`, `department.go`; `dto/sdo/` tương ứng; `dto/sdo/common.go` thêm `ActorDTO`. `pathParamSDI` thêm `{userID}` (đã có cho workspace), `{departmentId}`, `{invitationId}`.

### 5.1 Organization members & invitations

| Method & path | Quyền | SDI → SDO |
|---|---|---|
| `GET /orgs/{org}/members?status=active\|deactivated\|all&cursor&limit` | member | → `OrgMemberListSDO{members:[OrgMemberDTO], next_cursor}` |
| `GET /orgs/{org}/members/me` | member | → `OrgMembershipSDO{role, deactivated_at, is_platform_admin}` |
| `PATCH /orgs/{org}/members/{userID}` | admin/owner | `OrgMemberRoleSDI{role}` → `OrgMemberSDO` |
| `POST /orgs/{org}/members/{userID}/deactivate` | admin/owner | → `OrgMemberSDO` |
| `POST /orgs/{org}/members/{userID}/reactivate` | admin/owner | → `OrgMemberSDO` |
| `POST /orgs/{org}/transfer-ownership` | owner | `TransferOwnershipSDI{to_user_id}` → `OrgMembershipSDO` |
| `POST /orgs/{org}/leave` | member/admin | → `StatusSDO` |
| `POST /orgs/{org}/invitations` | admin/owner | `OrgInviteSDI{emails[], org_role}` → `InvitationListSDO{invitations:[InvitationDTO], skipped[]}` |
| `GET /orgs/{org}/invitations` | admin/owner | → `InvitationListSDO` (pending) |
| `DELETE /orgs/{org}/invitations/{invitationId}` | admin/owner | → `StatusSDO` (set `revoked_at`) |
| `POST /invitations/{token}/accept` | (đã có) | giữ path; response `AcceptInviteSDO{organization, workspace?}` — `workspace` optional |

`OrgMemberDTO{user_id, email, display_name, avatar_url, role, deactivated_at, invited_by, created_at, profile: ProfileDTO}`.

### 5.2 People & profiles

| Method & path | Quyền | SDI → SDO |
|---|---|---|
| `GET /orgs/{org}/people?q&department_id&role&status&manager_id&cursor&limit` | member | → `PeopleListSDO{people:[PersonDTO], next_cursor, total_active}` |
| `GET /orgs/{org}/people/{userID}` | member | → `PersonSDO{person: PersonDTO, reports:[ActorDTO]}` |
| `PATCH /orgs/{org}/people/{userID}/profile` | self (tập con) / admin | `ProfileSDI{title?, department_id?, manager_id?, employee_code?, phone?, location?, bio?, joined_on?}` → `PersonSDO` |
| `GET /orgs/{org}/people/export` | admin/owner | → `text/csv` (ngoại lệ Swagger § 8: khai `sdo: nil`, mô tả content-type) |
| `PATCH /me` | (đã có) | thêm `timezone` vào SDI/SDO `UserDTO` |

`PersonDTO{user_id, display_name, email, avatar_url, org_role, status, title, department: {id, name} | null, manager: ActorDTO | null, employee_code, phone, location, bio, joined_on, timezone, is_self}`.

### 5.3 Departments

| Method & path | Quyền | SDI → SDO |
|---|---|---|
| `GET /orgs/{org}/departments?include_archived` | member | → `DepartmentListSDO{departments:[DepartmentDTO]}` (phẳng, có `parent_id`; FE dựng cây) |
| `POST /orgs/{org}/departments` | admin/owner | `DepartmentSDI{name, code?, parent_id?, head_user_id?}` → 201 `DepartmentSDO` |
| `PATCH /orgs/{org}/departments/{departmentId}` | admin/owner | `DepartmentSDI` (partial) → `DepartmentSDO` |
| `POST /orgs/{org}/departments/{departmentId}/archive` | admin/owner | → `DepartmentSDO` |
| `PUT /orgs/{org}/departments/order` | admin/owner | `DepartmentOrderSDI{ids[]}` → `DepartmentListSDO` |

`DepartmentDTO{id, name, code, parent_id, head: ActorDTO | null, member_count, sort_order, archived_at}`.

### 5.4 `ActorDTO` (common)

```go
type ActorDTO struct {
  ID          string `json:"id"`
  Kind        string `json:"kind" description:"human | agent"`
  DisplayName string `json:"display_name"`
  AvatarURL   string `json:"avatar_url,omitempty"`
}
```

Mọi DTO **mới** có trường tác nhân dùng `ActorDTO` thay vì `{user_id, display_name}` rời. DTO cũ (`MemberDTO`, `TaskDTO.created_by`) không đổi trong spec này (tránh vỡ contract); có ticket theo dõi chuyển dần.

## 6. Frontend

### 6.1 `packages/core`

```
types/organization.ts     thêm OrgMember, OrgMembership, Invitation (org-level), ORG_MEMBER_STATUSES
types/people.ts           Person, Profile, Department, Actor (+ ACTOR_KINDS = ["human","agent"])
organizations/hooks.ts    useOrgMembers(orgId, status), useOrgMembership(orgId), useUpdateOrgMemberRole,
                          useDeactivateMember, useReactivateMember, useTransferOwnership, useLeaveOrg,
                          useInviteToOrg, useOrgInvitations, useRevokeInvitation
people/hooks.ts           peopleKeys = { list(orgId, filters), detail(orgId, userId), departments(orgId) };
                          usePeople(orgId, filters) (infinite), usePerson, useUpdateProfile, useDepartments,
                          useCreateDepartment, useUpdateDepartment, useArchiveDepartment, useReorderDepartments
people/export.ts          buildExportUrl(orgId) — tải qua <a href> có credentials (cookie), không fetch blob
api/endpoints/organizations.ts, people.ts, departments.ts   + *.test.ts malformed từng hàm
permissions/rules.ts      canEditProfile(target, ctx), canManageOrgMembers(ctx), canChangeOrgRole(target, ctx),
                          canDeactivateMember(target, ctx), canTransferOwnership(ctx), canLeaveOrg(ctx),
                          canManageDepartments(ctx), canExportPeople(ctx) — mỗi rule cite gate Go
permissions/types.ts      PermissionContext thêm orgMemberStatus: "active" | "deactivated" | null
realtime/use-realtime-sync.ts   map 8 sự kiện §4.3 → invalidate peopleKeys / organizationKeys
```

Route builders (`packages/core/paths/paths.ts`): `paths.workspace(org, ws).people()`, `.people(userId)`, `.settings("organization")`, `.settings("departments")`. `consistency.test.ts` ép có page tương ứng.

### 6.2 `packages/views`

```
people/
  people-view.tsx              trang /people: thanh tìm kiếm (debounce 250 ms), bộ lọc phòng ban / vai trò / trạng thái,
                               danh sách ảo hóa (≥ 200 dòng theo Vision §6.3), nút Xuất CSV (canExportPeople)
  person-row.tsx               avatar, tên, chức danh, phòng ban, pill vai trò; pill "Đã vô hiệu hóa" khi lọc all
  person-detail-view.tsx       trang /people/{userId}: hồ sơ, quản lý, danh sách "báo cáo cho", nút Sửa (canEditProfile)
  profile-form.tsx             form sửa; trường admin-only disabled kèm tooltip từ Decision.message
  department-picker.tsx        select 2 cấp (Base UI Select), dùng lại ở profile-form và filter
  actor-chip.tsx               hiển thị ActorDTO: avatar + tên; kind=agent → icon bot + nhãn "Agent" (i18n), không mascot
settings/
  organization-tab.tsx         tab "Tổ chức": tên/slug (đã có ở settings-design?), danh sách thành viên org,
                               mời (EmailChipsInput + org_role), đổi role, vô hiệu hóa/kích hoạt, transfer, rời
  departments-tab.tsx          CRUD phòng ban, kéo thả sắp xếp (Base UI + dnd đã dùng ở board), lưu trữ
  transfer-ownership-dialog.tsx xác nhận bằng cách gõ tên org (như xóa repo GitHub) — không dialog `confirm()`
```

Routes (`apps/web/app/[orgSlug]/[workspaceSlug]/`): `people/page.tsx`, `people/[userId]/page.tsx`; Settings thêm 2 tab qua `settings/page.tsx` hiện có. Navigation: `packages/core/navigation` thêm mục `People` vào nhóm WORK theo IA V2 (`nav.people`).

Empty state danh bạ (org 1 người): "Chỉ có bạn trong tổ chức. Mời đồng nghiệp để bắt đầu." + nút mời (nếu có quyền) — không mock row. i18n key `people.*`, `org.members.*`, `departments.*`; vi viết bản ngữ, en parity.

### 6.3 Xử lý bị vô hiệu hóa

`useOrgMembership` trả `deactivated_at` → layout workspace (nơi guard onboarding) chuyển sang màn "Tài khoản của bạn đã bị vô hiệu hóa trong {org}" với nút chuyển org khác / đăng xuất. Sự kiện `session.revoked` → invalidate `["me"]`, `organizationKeys` ngay.

### 6.4 Realtime scope `org`

`EventPublisher.PublishToScope("org", orgID, ev)`: WebSocket handshake hiện mang `/{org}/{ws}`; hub thêm scope `org:<id>` mà mọi client của org subscribe khi kết nối (thay đổi nhỏ ở `server/internal/realtime`, có test). Không fan-out per-workspace cho sự kiện org.

## 7. Kế thừa từ bản cũ và cái bỏ đi

| Bản cũ | Xử lý |
|---|---|
| `PersonDTO{title, department, team, location, phone, empId, joinDate, reportsTo, skills, teams, about}` | Giữ `title, department, location, phone, employee_code, joined_on, manager, bio`; **bỏ** `team/teams` (dùng workspace) và `skills` (không có use case ở giai đoạn F) |
| `departments` là chuỗi tự do trong profile | Thay bằng bảng `departments` có id, cây 2 cấp |
| `tenant_member_profiles` | Đổi thành `organization_member_profiles`, thêm `search_text`, `manager_id` |
| `change_tenant_member_status` (suspend) | Thay bằng `deactivated_at` + hành vi rõ ràng về workspace/session |
| 6 nút `notifyComingSoon` ở `/people` | Không tồn tại: mọi control trong spec đều có backend |
| Blueprint §13.3 "internal user identity" | Kế thừa ý: `users` là identity, profile là quan hệ với tổ chức |
| CSV export client-side (`xlsx`) | Bỏ dependency; server stream CSV |

## 8. Kiểm thử và DoD

**Go**

- Migration: `078` với org có 2 owner → còn 1 owner + 1 admin; `079` sau đó tạo được; `080` backfill `organization_id` đủ; down đảo được.
- `organization_test.go`: ma trận quyền §4.1 (mỗi ô một case, table-driven); `TransferOwnership` nguyên tử (inject lỗi giữa chừng → rollback, vẫn 1 owner); `Deactivate` revoke refresh token chỉ khi không còn org khác; `Leave` của owner → `last_owner`; `AcceptOrgInvite` với member deactivated → `member_deactivated`; quota `members.max` chặn accept và rollback.
- `department_test.go`: depth > 2 → lỗi; archive có con → 409; archive có thành viên → profile `department_id` NULL và `search_text` refresh; `code` unique trong org, hai org trùng `code` OK.
- `people_test.go`: search theo tên có dấu / không dấu (chuẩn hóa `unaccent` trong `search_text`, extension `unaccent` bật trong `074`); filter deactivated; keyset pagination ổn định; self chỉ sửa được tập con (admin field → 403); export CSV có BOM, đúng số dòng, audit event ghi.
- `actor_test.go`: resolve batch 1 query cho N id; kind lạ → fallback không panic.
- `arch_test.go`: chỉ `organization.go`/`workspace.go` đọc `organization_members`; chỉ `people.go` ghi `organization_member_profiles`.
- `swagger_test.go` tự bắt route mới; ngoại lệ export CSV khai báo tường minh.

**Vitest**

- Endpoints malformed cho toàn bộ hàm mới (organizations, people, departments).
- `rules.test.ts` cho 8 rule mới, gồm case `orgMemberStatus = "deactivated"` → deny mọi thứ.
- `people-view.test.tsx`: debounce, filter → query key, empty state, ảo hóa render đúng số hàng nhìn thấy.
- `transfer-ownership-dialog.test.tsx`: nút chỉ enable khi gõ đúng tên org.
- `i18n/parity.test.ts` tự áp.

**E2E**: owner mời email mới vào org (mailbox test đã có ở transactional-email) → người mới accept → xuất hiện trong `/people`; owner đặt phòng ban + quản lý; member tìm theo tên không dấu; owner vô hiệu hóa → người bị vô hiệu hóa reload thấy màn chặn; transfer ownership → sidebar/role pill đổi ở cả hai phiên.

**DoD**: theo Vision §6.9 — OpenAPI đủ, mã lỗi ổn định §4.1, migration up/down, sự kiện trong catalogue, vi/en parity, không "coming soon", coverage không giảm, `ActorDTO` dùng cho mọi DTO mới.

## 9. Trình tự triển khai đề xuất (cho plan)

1. `070`, `078`, `079` + sửa `RequireOrgMember` loại deactivated + `ActorDTO`/`ActorResolver` (nền, không UI).
2. `074`–`077` profile + `PATCH profile` + `GET people` + trang `/people` (đọc trước).
3. `071`–`073` departments + tab Settings.
4. `080`–`081` org-level invite + members tab + deactivate/reactivate/role.
5. Transfer ownership + leave + export CSV + realtime scope `org`.

Mỗi bước là một plan `docs/superpowers/plans/2026-09-xx-people-<n>.md` có `> **Trạng thái:**`.

## 10. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. **Vô hiệu hóa có giữ ghế (`members.max`) không?** Spec hiện: trả ghế (-1). Nếu muốn tính phí theo "ghế đã cấp" thì đổi thành giữ ghế cho đến khi xóa hẳn.
2. **Transfer ownership** có yêu cầu xác nhận lại mật khẩu / OTP email không? Spec hiện: gõ tên org. Đề xuất thêm OTP email khi có MFA (spec Identity).
3. **Thành viên thường có thấy số điện thoại / email của người khác không?** Spec hiện: thấy (danh bạ nội bộ). Có thể cần cờ `profile_visibility` theo org cho khách hàng nhạy cảm PII (Nghị định 13).
4. **Phòng ban 2 cấp có đủ** cho khách 200–1.000 người? Nếu cần sâu hơn, `parent_id` đã sẵn; chỉ nới rule depth.
5. **Nhiều phòng ban cho một người** (kiêm nhiệm): spec chọn 1. Nếu cần, thêm bảng `department_members` sau, không phá schema.
6. Có cho **admin** vô hiệu hóa admin khác không? Spec: không, chỉ owner. Cần xác nhận.
