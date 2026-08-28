# UniWork — Ma trận quyền workspace (nền cho Issues)

**Ngày:** 2026-08-27  
**Trạng thái:** Đã duyệt spec; foundation đang implement trên `develop`  
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md`, `2026-08-25-onboarding-organizations-design.md`, `2026-08-27-settings-design.md`  
**Tham chiếu:** Multica Issues permissions + `packages/core/permissions` (UniWork)

## 1. Mục tiêu

Chốt **ma trận quyền toàn workspace** (không chỉ Issues): một công thức effective role,
các domain nội dung / members / settings, và chỗ Issues sẽ ngồi sau này. Đồng thời **vá nền**
để FE/BE cùng một nguồn role và bổ sung quản trị thành viên còn thiếu.

**Deliverable đợt này**

1. Spec ma trận (file này) — policy + chỗ enforce.
2. Implement: expose **effective role** cho FE; API/UI **remove member** + **đổi role**
   `admin` ↔ `member`.

**Ngoài phạm vi implement đợt này** (vẫn ghi trong ma trận để không quên):

- Transfer ownership, xóa workspace.
- Comment authorship trên Tasks (policy đã chốt; code khi Issues hoặc đợt Tasks follow-up).
- Issues UI/catalog, Public API / PAT / plugin scopes.
- Role mới (ví dụ `viewer`) — chỉ giữ extension point.

## 2. Quyết định đã chốt (brainstorming)

| # | Quyết định |
|---|------------|
| 1 | Phạm vi = **toàn workspace** (A), Issues là một cột domain trên cùng nền |
| 2 | Nội dung work items (Tasks, Meetings, Issues khi có): mọi **effective member** CRUD ngang nhau |
| 3 | Quản trị members đủ bộ kiểu Multica: invite + remove + đổi role; chỉ **WS owner tường minh** transfer / xóa WS; role có thể mở rộng sau |
| 4 | Org owner/admin **implicit** = effective **workspace admin**, không tự thành **workspace owner** |
| 5 | Comments (policy): mọi member tạo; sửa/xóa = **author** hoặc effective owner/admin |
| 6 | Deliverable = **B**: spec + vá effective role + remove/change-role; chưa code comment authorship trên Tasks |
| 7 | Hướng kỹ thuật = mở rộng mô hình hiện tại (`PermissionContext` + `rules.ts` mirror Go), không capability engine, không port middleware Multica |

## 3. Nguyên tắc & vai trò

### 3.1 Hai tầng membership

| Tầng | Roles hiện tại | Ghi chú |
|------|----------------|---------|
| Organization | `owner`, `admin`, `member` | Giữ nguyên |
| Workspace | `owner`, `admin`, `member` | Wire schema **lenient**; role lạ trên client → `null` (least privilege). Có thể thêm role sau (vd. `viewer`) mà không khóa design vào đúng 3 giá trị mãi |

### 3.2 Effective workspace role (một công thức)

Nguồn sự thật: SQL `GetWorkspaceAccess` / `WorkspaceService.RequireMember`.

```
effective_ws_role =
  workspace_members.role                          nếu có dòng membership
  OR "admin"                                      nếu org role ∈ {owner, admin}
  OR (không phải member)
```

- Org **member** thường chỉ vào workspace khi có dòng `workspace_members`.
- Org owner/admin không có dòng membership vẫn vào được WS với quyền **admin**, không phải **owner**.

FE và BE **phải** dùng cùng công thức. Không suy role chỉ từ `ListWorkspaceMembers`
(list chỉ thành viên tường minh — đúng cho UI danh sách, sai cho “tôi được làm gì”).

### 3.3 Phân lớp quyền

| Lớp | Quy tắc |
|-----|---------|
| Nội dung | Membership đủ → CRUD (tasks, meetings, Issues khi có) |
| Comments | Tạo: membership; sửa/xóa: author ∨ admin-like (policy; code sau) |
| Admin surface | Effective owner/admin: invite, remove, đổi role, settings workspace |
| Owner-only | Chỉ `workspace_members.role = owner`: transfer ownership, xóa workspace |

Backend service = source of truth; FE `packages/core/permissions/rules.ts` mirror và cite gate Go.

## 4. Ma trận role × action

Cột = **effective workspace role**, trừ hàng org-only. Org owner/admin không có membership → cột **admin**.

**Organization** (cột = org role; giữ hành vi hiện có):

| Action | org owner | org admin | org member | outsider |
|--------|:---------:|:---------:|:----------:|:--------:|
| Tạo workspace trong org | ✅ | ✅ | ✅ | ❌ |
| List mọi WS trong org | ✅ | ✅ | chỉ WS mình thuộc | ❌ |

**Workspace** (cột = effective WS role):

| Action | owner | admin | member | outsider |
|--------|:-----:|:-----:|:------:|:--------:|
| **Workspace access** | | | | |
| Resolve / vào workspace | ✅ | ✅ | ✅ | 404 (che tồn tại) |
| List members | ✅ | ✅ | ✅ | ❌ |
| **Members** | | | | |
| Invite (`admin` / `member` only) | ✅ | ✅ | ❌ | ❌ |
| Remove member | ✅† | ✅† | ❌ | ❌ |
| Đổi role `admin` ↔ `member` | ✅† | ✅† | ❌ | ❌ |
| Transfer ownership | ✅* | ❌ | ❌ | ❌ |
| Xóa workspace | ✅* | ❌ | ❌ | ❌ |
| **Settings** | | | | |
| Đổi tên / settings workspace hiện có | ✅ | ✅ | ❌ | ❌ |
| **Tasks / Meetings / Issues (khi có)** | | | | |
| List / create / get / update / delete | ✅ | ✅ | ✅ | ❌ |
| **Comments** (policy; code sau) | | | | |
| Tạo | ✅ | ✅ | ✅ | ❌ |
| Sửa / xóa | author hoặc ✅ | author hoặc ✅ | chỉ author | ❌ |
| **Issues catalog (tương lai)** | | | | |
| Đọc status / labels | ✅ | ✅ | ✅ | ❌ |
| Sửa catalog (status defs, …) | ✅ | ✅ | ❌ | ❌ |

\*Chỉ khi có dòng `workspace_members.role = owner` — org admin implicit **không** đủ.  
†Không remove / demote **owner tường minh** qua các API đợt này. Không PATCH role thành `owner`. Admin không đổi role của owner.

**Invite:** giữ quy tắc hiện có (email verified, không invite role `owner`, batch limit).

## 5. API, enforce, data flow

### 5.1 Expose effective role

**Đã chốt:** `GET /workspaces/{workspaceID}/me` — không gộp vào workspace resolve (tránh phình mọi consumer resolve).

Response (schema Zod lenient + malformed-response test theo convention API):

```json
{
  "user_id": "…",
  "role": "admin",
  "source": "membership"
}
```

`source`: `"membership"` | `"org_admin"`. Non-member → 404 (cùng chính sách che tồn tại như `GetBySlugs`).

`useCurrentMember(wsId)` chỉ đọc endpoint này cho `role`. `ListWorkspaceMembers` không đổi: chỉ thành viên tường minh (UI danh sách).

### 5.2 Members API (mới)

| Method | Path | Gate | Hành vi |
|--------|------|------|---------|
| `PATCH` | `/workspaces/{workspaceID}/members/{userID}` | effective owner/admin | Body `{ "role": "admin" \| "member" }`. Từ chối `owner`. Từ chối nếu target là owner tường minh. |
| `DELETE` | `/workspaces/{workspaceID}/members/{userID}` | effective owner/admin | Xóa dòng `workspace_members`. Từ chối nếu target là owner tường minh. Không xóa `organization_members`. Caller được leave (xóa chính mình) nếu không phải owner tường minh. |

Invite (`InviteMany`) giữ nguyên. Không `FOREIGN KEY` / cascade — mutate trong service; transaction khi cần atomic.

### 5.3 Enforce (backend)

```
RequireAuth → handler (decode) → WorkspaceService
  role, err := RequireMember(…)   // effective role
  if !adminLike(role) → ErrForbidden
  load target workspace_members row
  validate (owner bảo vệ, enum role)
  mutate
  optional: publish member.updated / member.removed (id-only)
```

Handlers không query membership trực tiếp; `mapServiceError` → 403/404 như các domain khác. Path param id giao cho service quyết định visibility.

### 5.4 Frontend rules

| Rule | Mirror |
|------|--------|
| `canInviteMembers` | đã có — InviteMany admin gate |
| `canRemoveMember` | mới — cùng admin-like + ràng buộc target |
| `canChangeMemberRole` | mới — cùng admin-like + enum |
| `canManageMembers` | union cho khu vực UI members |
| `canUpdateWorkspaceSettings` | đã có |
| `canEditTask` / `canDeleteTask` / meeting | membership only (giữ) |
| `canEditComment` / `canDeleteComment` | thêm signature + test policy; **chưa** wire Tasks UI |

Màn Settings → tab Members: hiện đổi role / xóa khi rule cho phép; org admin ẩn danh thấy đúng nhờ effective role.

### 5.5 Realtime (tuỳ chọn đợt này)

Nếu đã có pattern invalidate members query: publish `member.updated` / `member.removed` với payload id-only. Không bắt buộc nếu invalidate sau mutation đủ.

## 6. Testing

| Tầng | Case tối thiểu |
|------|----------------|
| Go service | Org admin không có `workspace_members` → remove / change-role **OK**; WS `member` → **403**; không PATCH/DELETE owner tường minh; không PATCH `role=owner`; leave self OK nếu không phải owner |
| Go handler | decode body, map 403/404 |
| `packages/core` | `rules.test.ts` cho rule mới; endpoint `/me` + malformed-response; hook: org admin không có trong list members → vẫn `role=admin` |
| `packages/views` | Members UI: nút đổi role / xóa enable/disable theo rule |
| E2E | Hẹp nếu harness sẵn: admin change-role; không bắt buộc transfer/leave đầy đủ |

## 7. Lệch hiện tại cần vá (đợt này)

1. **`useCurrentMember`** chỉ `members.find(self)` → org owner/admin không có dòng membership bị FE deny invite/settings dù API cho phép. Sửa bằng `/me` (hoặc tương đương).
2. **`canManageMembers`** hiện alias invite; tách remove / change-role và nối API thật.
3. Không có remove / change-role trên backend — thêm theo §5.2.

## 8. Extension points (không implement)

- Role `viewer` (hoặc tương tự): chỉ đọc nội dung; không CRUD; không admin surface. Thêm vào CHECK/migration + `MEMBER_ROLES` + least privilege trên client.
- Comment authorship trên Tasks/Issues.
- Issues catalog admin-only (cột đã có trong ma trận).
- Public API scopes (`issues:read|write`, …) — credential surface riêng, không thay membership.

## 9. Tiêu chí xong đợt này

- [x] Spec này đã duyệt.
- [x] `GET …/me` (hoặc tương đương) + FE `useCurrentMember` dùng effective role.
- [x] `PATCH` / `DELETE` members + service tests + FE rules + UI members.
- [x] Org admin ẩn danh: invite/settings/members actions khớp API.
- [ ] Không ship transfer ownership, xóa WS, comment authorship code, Issues trong đợt này.
