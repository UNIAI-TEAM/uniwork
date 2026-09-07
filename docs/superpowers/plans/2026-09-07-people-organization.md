# F-03 · Hồ sơ, phòng ban, danh bạ `/people`, quản trị thành viên org, transfer ownership — Plan triển khai

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến organization từ vỏ chứa workspace thành bounded context Organization & People: hồ sơ thành viên trong tổ chức, phòng ban 2 cấp, danh bạ `/people` có tìm/lọc/xuất CSV, và quản trị thành viên org (mời org-level, đổi role, vô hiệu hóa, transfer ownership nguyên tử, rời tổ chức).

**Issue:** UNI-431 · **Spec:** `docs/superpowers/specs/2026-09-04-organization-people-directory-design.md` (Đã duyệt) · **Câu hỏi mở đã chốt:** OPEN_QUESTIONS nhóm P (P1 trả ghế, P2 gõ tên org + mật khẩu, P3 email công khai trong org / phone chỉ khi bật, P4 2 cấp, P5 một phòng ban, P6 chỉ owner vô hiệu hóa admin) · **ADR:** 0001, 0002, 0007, 0008, 0009, 0012.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`; index `CONCURRENTLY` một mình một file; có `.down.sql`; bảng mới có `organization_id TEXT NOT NULL`; bảng mới có `created_by` phải có `created_by_kind` (ADR 0007).
- `invitations` rời `tenantBackfillDebt` trong `migrations/lint_test.go` khi migration thêm `organization_id` cho nó.
- Mọi lệnh đổi trạng thái ghi `audit_events` + `outbox_events` cùng transaction qua `audit.Recorder`; thêm action vào `internal/audit/actions.go` và case vào `service/audit_coverage_test.go`.
- Event mới phải có mặt ở cả ba nơi: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`.
- Quyền quyết ở service; handler chỉ decode. Mã lỗi mới: `last_owner` (409), `member_deactivated` (403), `department_depth_exceeded` (400), `department_has_children` (409), `cannot_deactivate_self` (400), `password_required` (403).
- `packages/core` không `process.env`, không `localStorage`; endpoint mới đi qua `parseWithFallback` + test malformed.
- vi.json trước, en.json cùng key. JSX trong `views` qua `t()`. Không hardcode màu.
- Commit sau mỗi task theo Conventional Commits, `Refs: UNI-431` do hook tự thêm.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration (spec ghi `070`–`081` là giữ chỗ) | Mới nhất trên `develop` là `106` → dùng `107`–`118` |
| 2 | `users.is_platform_admin` (§2 quyết định 10) | **Bỏ**: F-11 đã ship `users.platform_role`; dùng cột đó |
| 3 | `users.timezone` (§3.1) | Đã có ở migration `091` (F-07); chỉ thêm vào `PATCH /me` SDI/SDO |
| 4 | `ActorDTO` + `ActorResolver` (§4, §5.4) | Đã có (`sdo.ActorDTO`, `service.ActorService` từ F-08); tái sử dụng, không viết lại |
| 5 | Tên event `org.member.*` (§4.3) | Dùng họ `member.*` đã có trong catalogue; thêm `member.deactivated`, `member.reactivated`, `member.left`, `organization.ownership_transferred`, `department.*`, `profile.updated` |
| 6 | P3 — phone của người khác | Cột `phone_visible BOOLEAN NOT NULL DEFAULT false`; chính chủ bật. Người khác không thấy `phone` khi tắt (admin/owner luôn thấy) |
| 7 | P2 — transfer ownership | SDI mang `password`; service xác thực lại mật khẩu owner hiện tại (`auth.CheckPassword`); tài khoản Google-only không có mật khẩu → `password_required` |
| 8 | P6 — vô hiệu hóa | admin chỉ vô hiệu hóa được `member`; owner vô hiệu hóa được `member`/`admin`; không ai tự vô hiệu hóa mình |
| 9 | Realtime scope `org` (§6.4) | Client WS đã mang `workspace_id`; hub tra `organization_id` của workspace lúc handshake và auto-subscribe `org:<id>`. `ScopeOrganization` thêm vào `outbox.Scope` và consumer |
| 10 | `search_text` không dấu | Extension `unaccent` bật trong migration bảng profile; `search_text` do service ghi = `lower(unaccent(...))`; truy vấn cũng `unaccent` chuỗi tìm |
| 11 | CSV export | `GET .../people.csv` (đuôi rõ ràng, tránh nhầm với `{userID}`), `sdo: nil` + `produces: text/csv` |
| 12 | Trang `/people` | Route workspace-scoped `/{org}/{ws}/people` và `/{org}/{ws}/people/{userId}` để dùng lại `DashboardLayout` |
| 13 | Tab Settings | `settings/page.tsx` hiện có thêm 2 tab `organization`, `departments` (query param `?tab=`), không thêm route mới |

## File map

```
server/migrations/107_organization_members_lifecycle.{up,down}.sql
server/migrations/108_org_members_single_owner_uidx.{up,down}.sql
server/migrations/109_organization_member_profiles.{up,down}.sql
server/migrations/110_member_profiles_search_idx.{up,down}.sql
server/migrations/111_member_profiles_employee_code_uidx.{up,down}.sql
server/migrations/112_member_profiles_department_idx.{up,down}.sql
server/migrations/113_departments.{up,down}.sql
server/migrations/114_departments_org_idx.{up,down}.sql
server/migrations/115_departments_org_code_uidx.{up,down}.sql
server/migrations/116_invitations_org_level.{up,down}.sql
server/migrations/117_invitations_org_pending_idx.{up,down}.sql
server/pkg/db/queries/{organizations,departments,member_profiles,workspaces}.sql
server/internal/service/{organization,organization_members,department,people}.go + *_test.go
server/internal/handler/{organization,people,department}.go
server/internal/handler/router/{organizations,people,departments}.go
server/internal/handler/dto/sdi/{organization,people,department}.go
server/internal/handler/dto/sdo/{organization,people,department}.go
packages/core/types/{organization,people,events}.ts
packages/core/api/endpoints/{organizations,people,departments}.ts + *.test.ts
packages/core/{organizations,people}/hooks.ts
packages/core/permissions/{rules,types}.ts
packages/views/people/*.tsx
packages/views/settings/{organization-tab,departments-tab,transfer-ownership-dialog}.tsx
apps/web/app/[orgSlug]/[workspaceSlug]/people/{page.tsx,[userId]/page.tsx}
```

## Lát 1 — Vòng đời thành viên org (nền)

- [ ] 1.1 Migration `107` (`deactivated_at`, `deactivated_by`, `invited_by`, `updated_at` + DML hạ owner thừa) và `108` (unique 1 owner). Test migration: org 2 owner → 1 owner + 1 admin.
- [ ] 1.2 `RequireMember` loại thành viên `deactivated_at IS NOT NULL` → `ErrMemberDeactivated` (403 `member_deactivated`); `WorkspaceService.RequireMember` hưởng theo.
- [ ] 1.3 `OrganizationMemberService`: `Members`, `Membership`, `UpdateRole`, `Deactivate`, `Reactivate`, `Leave`. Audit + outbox. Quota `members.max` ±1.
- [ ] 1.4 API `GET/PATCH /orgs/{org}/members*`, `POST .../deactivate|reactivate`, `POST /orgs/{org}/leave`.
- [ ] 1.5 Test ma trận quyền §4.1 (table-driven), `Leave` của owner → `last_owner`.

## Lát 2 — Hồ sơ và danh bạ `/people` (đọc + sửa)

- [ ] 2.1 Migration `109`–`112`: `organization_member_profiles`, extension `pg_trgm`/`unaccent`, backfill 1 dòng/thành viên, 3 index.
- [ ] 2.2 `PeopleService`: `Search` (keyset, `unaccent ILIKE`), `Get` (+ reports), `UpdateProfile` (tập trường theo vai trò), `RefreshSearchText`.
- [ ] 2.3 API `GET /orgs/{org}/people`, `GET .../people/{userID}`, `PATCH .../people/{userID}/profile`; `PATCH /me` thêm `timezone`.
- [ ] 2.4 `packages/core/people` (types, endpoints + test malformed, hooks, keys) và rule quyền.
- [ ] 2.5 `packages/views/people`: `people-view`, `person-row`, `person-detail-view`, `profile-form`, `actor-chip`; route web; i18n vi/en; test.

## Lát 3 — Phòng ban

- [ ] 3.1 Migration `113`–`115` + `DepartmentService` (depth ≤ 2, archive dọn `department_id`, `code` unique trong org).
- [ ] 3.2 API `GET/POST/PATCH /orgs/{org}/departments`, `POST .../archive`, `PUT .../order`.
- [ ] 3.3 Core hooks + `department-picker`, tab Settings → Phòng ban.

## Lát 4 — Mời vào org

- [ ] 4.1 Migration `116`–`117`: `invitations.workspace_id` nullable, `organization_id`, `org_role`, `invited_by`, `revoked_at`; gỡ `invitations` khỏi `tenantBackfillDebt`.
- [ ] 4.2 `InviteToOrg`, `AcceptOrgInvite` (gộp `AcceptInvite` cũ), `RevokeInvitation`, `ListOrgInvitations`.
- [ ] 4.3 API + tab Settings → Tổ chức (danh sách thành viên, mời, đổi role, vô hiệu hóa).

## Lát 5 — Transfer, CSV, realtime scope `org`

- [ ] 5.1 `TransferOwnership` nguyên tử (`FOR UPDATE`, xác thực mật khẩu) + dialog gõ tên org.
- [ ] 5.2 `ExportCSV` stream + BOM + audit `people.exported`.
- [ ] 5.3 Scope realtime `org` ở hub + consumer + `use-realtime-sync` map 8 event.
- [ ] 5.4 E2E `e2e/people.spec.ts`; roadmap `CÓ`; plan → `shipped`; spec → `Đã triển khai`.
