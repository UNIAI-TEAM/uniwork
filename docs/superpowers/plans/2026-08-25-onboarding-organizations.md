# Onboarding chuẩn usf + Tổ chức — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm tầng Tổ chức (organization) trên workspace và thay màn tạo-workspace tối giản bằng flow onboarding 4 bước (Về bạn → Tổ chức → Workspace → Mời đồng nghiệp) có chất lượng giao diện/tính năng ngang usf, kết thúc bằng landing 🎉 + task hướng dẫn.

**Architecture:** Backend thêm `organizations`/`organization_members`, `users.onboarded_at` + `onboarding_questionnaire`, `tasks.kind`; quyền workspace = `workspace_members` **hoặc** org owner/admin. FE thêm `packages/core/paths|organizations|onboarding`, `packages/views/onboarding` (shell hoisted + rail tối + cột 28rem), route `app/[orgSlug]/[workspaceSlug]/…`, guard hai chiều theo `onboarded_at`.

**Tech Stack:** Go 1.26 (chi, pgx v5, sqlc) · Postgres 16 · Next.js 16 + React 19 · Tailwind 4 · @base-ui/react ^1.3 · TanStack Query 5 · zod 4 · i18next · sonner ^2 · vitest 4 · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-onboarding-organizations-design.md`

## Global Constraints

- Repo `~/Work/AIFactory/uniwork`; mọi lệnh chạy từ root repo trừ khi ghi khác. usf tham chiếu ở `../usf`.
- Go module `github.com/unicomhub/uniwork/server`. ID mọi bảng ULID text 26 ký tự (`util.NewID()`).
- Error contract API `{"error":{"code","message"}}`; map lỗi qua `handlers.mapServiceError` (`service.Invalid`→400, `ErrNotFound`→404, `ErrForbidden`→403, `ErrConflict`→409).
- Sau khi sửa `server/pkg/db/queries/*.sql` phải chạy `make sqlc` và commit `server/pkg/db/generated`.
- Migrations: `server/migrations/NNN_name.up.sql` + `.down.sql`, chạy trong 1 transaction bởi runner (`migrations.Up`). KHÔNG dùng `CREATE INDEX CONCURRENTLY` (runner chạy trong tx).
- Test Go cần Postgres test (`make db-up`, port 5433); test dùng `testutil.DB(t)` (advisory lock + TRUNCATE). Chạy `cd server && go test ./...`.
- FE: packages `@uniwork/core|ui|views`, app `@uniwork/web`. Views/ui KHÔNG hardcode màu Tailwind; chỉ dùng class token: `bg-canvas|surface|subtle`, `text-primary|secondary|tertiary|inverse`, `border-line|line-strong`, `text-brand|danger|success|warning`, `bg-brand`, `bg-primary` (fill = màu chữ chính, dùng cho indicator "done"), `text-inverse`.
- Bảng đổi class khi port từ usf: `bg-background→bg-canvas`, `bg-card→bg-surface`, `bg-muted→bg-subtle`, `text-foreground→text-primary`, `text-muted-foreground→text-secondary`, `border`/`border-border`→`border border-line`, `ring-border→ring-line`, `bg-foreground→bg-primary`, `text-background→text-inverse`, `text-destructive→text-danger`, `border-primary/30 bg-primary/5`→`border-brand/40 bg-brand/5`, `bg-accent/30→bg-subtle/60`, `ring-ring→ring-brand`, `bg-success→bg-success`, `text-brand→text-brand`, `@multica/ui→@uniwork/ui`, `useT("onboarding"); t(($)=>$.a.b)` → `useTranslation(); t("onboarding.a.b")`.
- i18n: chuỗi UI qua key i18next trong `packages/core/i18n/locales/vi.json` (namespace mặc định, nested object); `en.json` chỉ thêm key rỗng-tương-đương nếu đã có convention, không bắt buộc dịch.
- Text scale vai trò (thêm ở Task 7): `text-micro(11) caption(12) label(13) body(14) body-lg(15) title-sm(16) title(18) title-lg(20) display-sm(24) display(36)`.
- Commit sau mỗi task (conventional commits, tiếng Anh). TDD: test trước ở bước có logic. Cuối commit message thêm `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Khi phân vân convention: mở `../usf` xem cách usf làm.

## Bản đồ file

**Backend (server/)**
- `migrations/004_organizations.up.sql|.down.sql` — bảng org, cột mới, grandfather.
- `pkg/db/queries/organizations.sql` (mới), `workspaces.sql`, `users.sql`, `tasks.sql` (sửa).
- `internal/service/slug.go` + `reserved_slugs.json` (embed) — validate slug dùng chung.
- `internal/service/organization.go` — OrganizationService.
- `internal/service/workspace.go` — CreateInOrg/GetBySlugs/RequireMember(org rule)/InviteMany/AcceptInvite(tx)/PendingInvitations.
- `internal/service/onboarding.go` — questionnaire/complete/seed welcome task.
- `internal/handler/organization.go`, `onboarding.go` (mới); `workspace.go`, `auth.go`, `router.go` (sửa); `cmd/server/main.go`.
- `internal/testutil/db.go` — TRUNCATE thêm bảng mới.

**packages/ui**
- `styles/tokens.css`, `styles/base.css`; `components/ui/button.tsx` (variant outline, size lg/icon-sm); mới: `field.tsx`, `card.tsx`, `skeleton.tsx`, `dot-sphere.tsx`, `stepper.tsx`, `sonner.tsx`; `hooks/use-scroll-fade.ts`.

**packages/core**
- `types/index.ts` (User/Workspace/Organization), `auth/hooks.ts` (`setSessionUser`), `api/client.ts` (không đổi).
- `paths/paths.ts`, `paths/resolve.ts`, `paths/reserved-slugs.ts` (generated), `paths/index.ts`; `scripts/generate-reserved-slugs.mjs` (root).
- `organizations/hooks.ts`, `workspaces/hooks.ts` (sửa), `onboarding/{types,step-order,store,welcome-store,hooks,index}.ts`, `config.ts` (`appHost()`).
- `i18n/locales/vi.json` — nhóm `onboarding`, `org`, `invitations`, mở rộng `workspace`.

**packages/views**
- `workspace/slug.ts`, `workspace/celestial-names.ts`, `workspace/welcome-after-onboarding.tsx`, `workspace/invitations-view.tsx`, `workspace/workspace-picker-view.tsx` (viết lại), `workspace/members-view.tsx` (sửa), `workspace/email-chips-input.tsx`.
- `onboarding/onboarding-flow.tsx`, `onboarding/components/{step-shell,step-sidebar,option-card,icon-option-card,onboarding-logout-button}.tsx`, `onboarding/steps/{step-welcome,welcome-illustration,step-about-you,step-organization,step-workspace,step-invite}.tsx`, `onboarding/slug-field.tsx` (form tên+slug dùng chung bước 2/3).
- `layout/sidebar.tsx` (switcher), `layout/workspace-switcher.tsx`, `tasks/task-card.tsx` (badge hướng dẫn).

**apps/web/app**
- `layout.tsx` (fonts), `providers.tsx` (Toaster), `globals.css` (theme text scale, fonts).
- `(auth)/onboarding/page.tsx`, `(auth)/workspaces/new/page.tsx`, `(auth)/invitations/page.tsx`, `(auth)/login|register/page.tsx` (destination), `invite/[token]/page.tsx`, `workspaces/page.tsx`.
- `[orgSlug]/[workspaceSlug]/…` (di chuyển từ `[workspaceSlug]/…`).

**e2e**: `smoke.spec.ts` (sửa URL), `onboarding-smoke.spec.ts`, `onboarding-shell.spec.ts`.

---

## Phase A — Backend

### Task 1: Migration 004 + sqlc queries + regenerate

**Files:**
- Create: `server/migrations/004_organizations.up.sql`, `server/migrations/004_organizations.down.sql`
- Create: `server/pkg/db/queries/organizations.sql`
- Modify: `server/pkg/db/queries/workspaces.sql`, `server/pkg/db/queries/users.sql`, `server/pkg/db/queries/tasks.sql`
- Modify: `server/internal/testutil/db.go:56-58`, `server/migrations/migrate_test.go`
- Regenerate: `server/pkg/db/generated/*`

**Interfaces:**
- Produces sqlc: `CreateOrganization`, `GetOrganizationByID`, `GetOrganizationBySlug`, `ListOrganizationsForUser` (row: org cols + `role`), `AddOrganizationMember` (ON CONFLICT DO NOTHING), `GetOrganizationMember`, `ListWorkspacesInOrg`, `CreateWorkspace` (thêm `organization_id`), `GetWorkspaceBySlugs`, `ListWorkspacesForUser` (row thêm `organization_slug`, `organization_name`), `GetWorkspaceAccess` (→ `string` role, `""` = không quyền), `ListInvitationsForEmail`, `PatchUserOnboarding`, `MarkUserOnboarded`, `CreateWelcomeTask`, `GetWelcomeTask`.
- DB model `db.User` thêm `OnboardedAt pgtype.Timestamptz`, `OnboardingQuestionnaire []byte`; `db.Workspace` thêm `OrganizationID string`; `db.Task` thêm `Kind string`.

- [ ] **Step 1: Viết test migration grandfather (fail trước)**

Thêm vào `server/migrations/migrate_test.go`:

```go
// Grandfather: workspace + member tạo trước 004 phải có org cùng slug và
// user đã có membership phải được coi là đã onboard.
func TestOrganizationsGrandfather(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// Cùng khoá advisory 727273 với testutil.DB: test này TRUNCATE + Down,
	// không được chạy chen với test package khác trên cùng DB test.
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_lock($1)", 727273); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = lock.Exec(ctx, "SELECT pg_advisory_unlock($1)", 727273); lock.Release() })
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	// Đưa DB về trạng thái sau 003 rồi chèn dữ liệu kiểu cũ.
	if err := Down(ctx, pool); err != nil { // rollback 004
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE users, workspaces, workspace_members CASCADE`); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, display_name) VALUES
		  ('01USER00000000000000000001','old@example.com','x','Old'),
		  ('01USER00000000000000000002','new@example.com','x','New');
		INSERT INTO workspaces (id, slug, name, created_by) VALUES
		  ('01WSPC00000000000000000001','doi-cu','Đội cũ','01USER00000000000000000001');
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		  ('01WSPC00000000000000000001','01USER00000000000000000001','owner');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := Up(ctx, pool); err != nil {
		t.Fatal("re-up:", err)
	}
	var orgSlug, orgID string
	err = pool.QueryRow(ctx, `SELECT o.slug, o.id FROM workspaces w JOIN organizations o ON o.id = w.organization_id WHERE w.id = $1`,
		"01WSPC00000000000000000001").Scan(&orgSlug, &orgID)
	if err != nil || orgSlug != "doi-cu" {
		t.Fatalf("org grandfather: slug=%q err=%v", orgSlug, err)
	}
	var role string
	if err := pool.QueryRow(ctx, `SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2`,
		orgID, "01USER00000000000000000001").Scan(&role); err != nil || role != "owner" {
		t.Fatalf("org member grandfather: role=%q err=%v", role, err)
	}
	var oldOnboarded, newOnboarded bool
	_ = pool.QueryRow(ctx, `SELECT onboarded_at IS NOT NULL FROM users WHERE id=$1`, "01USER00000000000000000001").Scan(&oldOnboarded)
	_ = pool.QueryRow(ctx, `SELECT onboarded_at IS NOT NULL FROM users WHERE id=$1`, "01USER00000000000000000002").Scan(&newOnboarded)
	if !oldOnboarded || newOnboarded {
		t.Fatalf("onboarded grandfather: old=%v new=%v", oldOnboarded, newOnboarded)
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd server && go test ./migrations/ -run TestOrganizationsGrandfather -v`
Expected: FAIL (Down của 003 chạy — vì 004 chưa tồn tại — rồi INSERT lỗi hoặc query `organizations` không tồn tại).

- [ ] **Step 3: Viết migration**

`server/migrations/004_organizations.up.sql`:

```sql
CREATE TABLE organizations (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

ALTER TABLE workspaces ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Grandfather: mỗi workspace cũ → 1 org cùng slug/name/created_by.
-- id org = 'ORG' + 23 ký tự cuối id workspace (vẫn 26 ký tự, không đụng ULID mới).
INSERT INTO organizations (id, slug, name, created_by, created_at)
  SELECT 'ORG' || substr(id, 4), slug, name, created_by, created_at FROM workspaces;
INSERT INTO organization_members (organization_id, user_id, role, created_at)
  SELECT 'ORG' || substr(workspace_id, 4), user_id, role, created_at FROM workspace_members;
UPDATE workspaces SET organization_id = 'ORG' || substr(id, 4);
ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE workspaces DROP CONSTRAINT workspaces_slug_key;
CREATE UNIQUE INDEX idx_workspaces_org_slug ON workspaces(organization_id, slug);
CREATE INDEX idx_workspaces_org ON workspaces(organization_id);

ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN onboarding_questionnaire JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE users SET onboarded_at = created_at
  WHERE id IN (SELECT user_id FROM workspace_members);

ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','welcome'));
CREATE UNIQUE INDEX idx_tasks_welcome_once ON tasks(workspace_id, created_by) WHERE kind = 'welcome';
```

`server/migrations/004_organizations.down.sql`:

```sql
-- Chỉ an toàn khi không còn 2 workspace trùng slug ở 2 org khác nhau.
DROP INDEX IF EXISTS idx_tasks_welcome_once;
ALTER TABLE tasks DROP COLUMN IF EXISTS kind;
ALTER TABLE users DROP COLUMN IF EXISTS onboarding_questionnaire;
ALTER TABLE users DROP COLUMN IF EXISTS onboarded_at;
DROP INDEX IF EXISTS idx_workspaces_org;
DROP INDEX IF EXISTS idx_workspaces_org_slug;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);
ALTER TABLE workspaces DROP COLUMN organization_id;
DROP TABLE organization_members;
DROP TABLE organizations;
```

- [ ] **Step 4: Viết queries**

`server/pkg/db/queries/organizations.sql`:

```sql
-- name: CreateOrganization :one
INSERT INTO organizations (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations WHERE slug = $1;

-- name: ListOrganizationsForUser :many
SELECT o.*, m.role
FROM organizations o
JOIN organization_members m ON m.organization_id = o.id
WHERE m.user_id = $1
ORDER BY o.created_at;

-- name: AddOrganizationMember :exec
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetOrganizationMember :one
SELECT * FROM organization_members WHERE organization_id = $1 AND user_id = $2;

-- name: ListWorkspacesInOrg :many
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE w.organization_id = $1
ORDER BY w.created_at;

-- name: ListMemberWorkspacesInOrg :many
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w
JOIN organizations o ON o.id = w.organization_id
JOIN workspace_members m ON m.workspace_id = w.id
WHERE w.organization_id = $1 AND m.user_id = $2
ORDER BY w.created_at;
```

Thay toàn bộ `server/pkg/db/queries/workspaces.sql`:

```sql
-- name: CreateWorkspace :one
INSERT INTO workspaces (id, organization_id, slug, name, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetWorkspaceByID :one
SELECT * FROM workspaces WHERE id = $1;

-- name: GetWorkspaceBySlugs :one
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE o.slug = $1 AND w.slug = $2;

-- name: GetWorkspaceWithOrg :one
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id
WHERE w.id = $1;

-- name: ListWorkspacesForUser :many
-- Workspace user là thành viên trực tiếp, HOẶC thuộc org mà user là owner/admin.
SELECT DISTINCT ON (w.created_at, w.id) w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspaces w
JOIN organizations o ON o.id = w.organization_id
LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = $1
WHERE m.user_id IS NOT NULL OR om.role IN ('owner','admin')
ORDER BY w.created_at, w.id;

-- name: GetWorkspaceAccess :one
-- '' = không có quyền. Org owner/admin được coi là admin của mọi workspace trong org.
SELECT COALESCE(m.role, CASE WHEN om.role IN ('owner','admin') THEN 'admin' END, '')::text AS role
FROM workspaces w
LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $2
LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = $2
WHERE w.id = $1;

-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetWorkspaceMember :one
SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2;

-- name: ListWorkspaceMembers :many
SELECT m.workspace_id, m.user_id, m.role, m.created_at,
       u.email, u.display_name, u.avatar_url
FROM workspace_members m
JOIN users u ON u.id = m.user_id
WHERE m.workspace_id = $1
ORDER BY m.created_at;

-- name: CreateInvitation :one
INSERT INTO invitations (id, workspace_id, email, role, token, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations
WHERE token = $1 AND accepted_at IS NULL AND expires_at > now();

-- name: MarkInvitationAccepted :exec
UPDATE invitations SET accepted_at = now() WHERE id = $1;

-- name: ListInvitationsForEmail :many
SELECT i.id, i.role, i.token, i.expires_at,
       w.id AS workspace_id, w.slug AS workspace_slug, w.name AS workspace_name,
       o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name,
       u.display_name AS invited_by_name
FROM invitations i
JOIN workspaces w ON w.id = i.workspace_id
JOIN organizations o ON o.id = w.organization_id
JOIN users u ON u.id = w.created_by
WHERE i.email = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
ORDER BY i.created_at DESC;
```

Thêm vào `server/pkg/db/queries/users.sql`:

```sql
-- name: PatchUserOnboarding :one
UPDATE users SET
  onboarding_questionnaire = COALESCE(sqlc.narg('questionnaire'), onboarding_questionnaire),
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkUserOnboarded :one
UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;
```

Thêm vào `server/pkg/db/queries/tasks.sql`:

```sql
-- name: CreateWelcomeTask :one
INSERT INTO tasks (id, workspace_id, title, description, status, priority, assignee_id, position, created_by, kind)
VALUES ($1, $2, $3, $4, 'in_progress', 'high', $5, $6, $5, 'welcome')
RETURNING *;

-- name: GetWelcomeTask :one
SELECT * FROM tasks WHERE workspace_id = $1 AND created_by = $2 AND kind = 'welcome';
```

- [ ] **Step 5: Regenerate sqlc, sửa testutil**

Run: `make sqlc`
Expected: không lỗi; `server/pkg/db/generated/models.go` có `Organization`, `OrganizationMember`; `User` có `OnboardedAt`, `OnboardingQuestionnaire []byte`.

Sửa `server/internal/testutil/db.go` TRUNCATE:

```go
	_, err = pool.Exec(ctx, `TRUNCATE users, organizations, organization_members,
		workspaces, workspace_members, invitations, refresh_tokens, tasks, task_comments,
		meetings, meeting_attendees, meeting_notes CASCADE`)
```

- [ ] **Step 6: Chạy test migration**

Run: `cd server && go test ./migrations/ -v`
Expected: PASS cả `TestUpIsIdempotent` và `TestOrganizationsGrandfather`. (`go build ./...` sẽ lỗi ở service/handler vì `CreateWorkspaceParams` đổi — Task 4 sửa; test migrations vẫn compile độc lập.)

- [ ] **Step 7: Commit**

```bash
git add server/migrations server/pkg/db server/internal/testutil
git commit -m "feat(db): organizations, onboarding columns, welcome task kind"
```

### Task 2: Slug validation dùng chung + reserved slugs

**Files:**
- Create: `server/internal/service/reserved_slugs.json`, `server/internal/service/slug.go`, `server/internal/service/slug_test.go`
- Create: `scripts/generate-reserved-slugs.mjs`, thêm script vào `package.json`

**Interfaces:**
- Produces: `service.ValidateSlug(slug string) error` (nil hoặc `ValidationError`), `service.ReservedSlugs() []string`.
- Produces FE: `packages/core/paths/reserved-slugs.ts` export `RESERVED_SLUGS: readonly string[]` (generated).

- [ ] **Step 1: Test**

`server/internal/service/slug_test.go`:

```go
package service

import "testing"

func TestValidateSlug(t *testing.T) {
	ok := []string{"ab", "acme", "doi-alpha-1", "a1b2"}
	for _, s := range ok {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("%q should be valid: %v", s, err)
		}
	}
	bad := []string{"", "a", "-abc", "abc-", "Ab", "a--b", "a b", "login", "api", "onboarding",
		"thisslugiswaytoolongforthefortycharacterlimitxx"}
	for _, s := range bad {
		if err := ValidateSlug(s); err == nil {
			t.Errorf("%q should be invalid", s)
		}
	}
	if len(ReservedSlugs()) == 0 {
		t.Fatal("reserved slugs empty")
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd server && go test ./internal/service/ -run TestValidateSlug`
Expected: FAIL — `ValidateSlug` undefined (có thể kèm lỗi compile của workspace.go — chấp nhận, Task 4 sửa; nếu cản trở, tạm `go vet` file riêng).

- [ ] **Step 3: Implement**

`server/internal/service/reserved_slugs.json`:

```json
["login","register","onboarding","workspaces","invitations","invite","api","me","orgs","auth",
 "healthz","ws","tasks","meetings","members","settings","new","admin","static","_next","assets","public"]
```

`server/internal/service/slug.go`:

```go
package service

import (
	_ "embed"
	"encoding/json"
	"regexp"
)

//go:embed reserved_slugs.json
var reservedSlugsJSON []byte

var reservedSlugs = func() map[string]bool {
	var list []string
	if err := json.Unmarshal(reservedSlugsJSON, &list); err != nil {
		panic("reserved_slugs.json: " + err.Error())
	}
	m := make(map[string]bool, len(list))
	for _, s := range list {
		m[s] = true
	}
	return m
}()

// slugPattern: chữ thường/số, nhóm cách nhau bởi 1 dấu gạch; 2–40 ký tự.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func ValidateSlug(slug string) error {
	if len(slug) < 2 || len(slug) > 40 || !slugPattern.MatchString(slug) {
		return Invalid("định danh chỉ gồm a-z, 0-9 và dấu gạch ngang (2-40 ký tự)")
	}
	if reservedSlugs[slug] {
		return Invalid("định danh này được hệ thống dành riêng")
	}
	return nil
}

func ReservedSlugs() []string {
	out := make([]string, 0, len(reservedSlugs))
	for s := range reservedSlugs {
		out = append(out, s)
	}
	return out
}
```

`scripts/generate-reserved-slugs.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const list = JSON.parse(readFileSync("server/internal/service/reserved_slugs.json", "utf8"));
const out = `// GENERATED from server/internal/service/reserved_slugs.json — pnpm generate:reserved-slugs
export const RESERVED_SLUGS = ${JSON.stringify(list.sort(), null, 2)} as const;
`;
writeFileSync("packages/core/paths/reserved-slugs.ts", out);
console.log("wrote packages/core/paths/reserved-slugs.ts");
```

`package.json` scripts thêm: `"generate:reserved-slugs": "node scripts/generate-reserved-slugs.mjs"`. Tạo thư mục `packages/core/paths/` và chạy `pnpm generate:reserved-slugs`.

- [ ] **Step 4: Chạy test**

Run: `cd server && go test ./internal/service/ -run TestValidateSlug -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/slug.go server/internal/service/slug_test.go server/internal/service/reserved_slugs.json scripts package.json packages/core/paths/reserved-slugs.ts
git commit -m "feat: shared slug validation with reserved slugs"
```

### Task 3: OrganizationService

**Files:**
- Create: `server/internal/service/organization.go`, `server/internal/service/organization_test.go`

**Interfaces:**
- Produces:
  - `NewOrganizationService(q *db.Queries) *OrganizationService`
  - `(s) Create(ctx, userID, name, slug string) (db.Organization, error)` — creator = owner; `ErrConflict` khi trùng slug.
  - `(s) ListForUser(ctx, userID string) ([]db.ListOrganizationsForUserRow, error)`
  - `(s) GetBySlug(ctx, userID, slug string) (db.Organization, db.OrganizationMember, error)` — `ErrNotFound` nếu không tồn tại hoặc không phải thành viên.
  - `(s) RequireMember(ctx, orgID, userID string) (db.OrganizationMember, error)` — `ErrForbidden`.
  - `(s) ListWorkspaces(ctx, userID, orgID string) ([]db.ListWorkspacesInOrgRow, error)` — owner/admin: tất cả; member: chỉ workspace mình thuộc (convert từ `ListMemberWorkspacesInOrgRow`, cùng cột).

- [ ] **Step 1: Test**

`server/internal/service/organization_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func orgFixture(t *testing.T) (*db.Queries, *OrganizationService, db.User, db.User) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ctx := context.Background()
	sa, err := as.Register(ctx, "a@example.com", "password123", "A")
	if err != nil {
		t.Fatal(err)
	}
	sb, err := as.Register(ctx, "b@example.com", "password123", "B")
	if err != nil {
		t.Fatal(err)
	}
	return q, NewOrganizationService(q), sa.User, sb.User
}

func TestOrganizationCreateAndAccess(t *testing.T) {
	_, s, ua, ub := orgFixture(t)
	ctx := context.Background()

	o, err := s.Create(ctx, ua.ID, "  Unicom  ", "unicom")
	if err != nil || o.Name != "Unicom" {
		t.Fatalf("create: %v name=%q", err, o.Name)
	}
	m, err := s.RequireMember(ctx, o.ID, ua.ID)
	if err != nil || m.Role != "owner" {
		t.Fatalf("owner: %v role=%s", err, m.Role)
	}
	if _, err := s.RequireMember(ctx, o.ID, ub.ID); err != ErrForbidden {
		t.Fatalf("outsider: got %v", err)
	}
	if _, _, err := s.GetBySlug(ctx, ub.ID, "unicom"); err != ErrNotFound {
		t.Fatalf("outsider GetBySlug: got %v", err)
	}
	if _, err := s.Create(ctx, ub.ID, "Khác", "unicom"); err != ErrConflict {
		t.Fatalf("dup slug: got %v", err)
	}
	if _, err := s.Create(ctx, ua.ID, "X", "login"); err == nil {
		t.Fatal("reserved slug accepted")
	}
	if _, err := s.Create(ctx, ua.ID, "", "abc"); err == nil {
		t.Fatal("empty name accepted")
	}
	list, err := s.ListForUser(ctx, ua.ID)
	if err != nil || len(list) != 1 || list[0].Role != "owner" {
		t.Fatalf("list: %v %+v", err, list)
	}
}
```

- [ ] **Step 2: Chạy test, fail**

Run: `cd server && go test ./internal/service/ -run TestOrganizationCreateAndAccess`
Expected: FAIL — `NewOrganizationService` undefined.

- [ ] **Step 3: Implement**

`server/internal/service/organization.go`:

```go
package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type OrganizationService struct {
	q *db.Queries
}

func NewOrganizationService(q *db.Queries) *OrganizationService {
	return &OrganizationService{q: q}
}

func (s *OrganizationService) Create(ctx context.Context, userID, name, slug string) (db.Organization, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return db.Organization{}, Invalid("tên tổ chức không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return db.Organization{}, err
	}
	o, err := s.q.CreateOrganization(ctx, db.CreateOrganizationParams{
		ID: util.NewID(), Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return db.Organization{}, ErrConflict
	}
	if err != nil {
		return db.Organization{}, err
	}
	if err := s.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: o.ID, UserID: userID, Role: "owner",
	}); err != nil {
		return db.Organization{}, err
	}
	return o, nil
}

func (s *OrganizationService) ListForUser(ctx context.Context, userID string) ([]db.ListOrganizationsForUserRow, error) {
	return s.q.ListOrganizationsForUser(ctx, userID)
}

func (s *OrganizationService) RequireMember(ctx context.Context, orgID, userID string) (db.OrganizationMember, error) {
	m, err := s.q.GetOrganizationMember(ctx, db.GetOrganizationMemberParams{OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OrganizationMember{}, ErrForbidden
	}
	return m, err
}

func (s *OrganizationService) GetBySlug(ctx context.Context, userID, slug string) (db.Organization, db.OrganizationMember, error) {
	o, err := s.q.GetOrganizationBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound
	}
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, err
	}
	m, err := s.RequireMember(ctx, o.ID, userID)
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound // không lộ sự tồn tại
	}
	return o, m, nil
}

// ListWorkspaces: owner/admin thấy mọi workspace của org; member chỉ thấy
// workspace mình thuộc.
func (s *OrganizationService) ListWorkspaces(ctx context.Context, userID, orgID string) ([]db.ListWorkspacesInOrgRow, error) {
	m, err := s.RequireMember(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	if m.Role == "owner" || m.Role == "admin" {
		return s.q.ListWorkspacesInOrg(ctx, orgID)
	}
	rows, err := s.q.ListMemberWorkspacesInOrg(ctx, db.ListMemberWorkspacesInOrgParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		return nil, err
	}
	out := make([]db.ListWorkspacesInOrgRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, db.ListWorkspacesInOrgRow(r))
	}
	return out, nil
}
```

(Nếu sqlc sinh 2 row struct có field khác thứ tự khiến conversion `db.ListWorkspacesInOrgRow(r)` không compile, viết copy field-by-field.)

- [ ] **Step 4: Chạy test** — Run: `cd server && go test ./internal/service/ -run TestOrganizationCreateAndAccess -v` → PASS (nếu workspace.go chưa compile, làm Task 4 Step 3 trước rồi quay lại chạy).

- [ ] **Step 5: Commit** — `git add server/internal/service/organization*.go && git commit -m "feat: organization service"`

### Task 4: WorkspaceService theo org + quyền org + invite bulk + accept trong transaction

**Files:**
- Modify: `server/internal/service/workspace.go` (viết lại), `server/internal/service/workspace_test.go` (viết lại)
- Modify: `server/internal/service/task_test.go`, `server/internal/service/meeting_test.go` (fixture gọi `Create` cũ → `CreateInOrg`), `server/cmd/server/main.go`

**Interfaces:**
- Produces:
  - `type WorkspaceView struct { db.Workspace; OrganizationSlug, OrganizationName string }`
  - `NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *WorkspaceService`
  - `CreateInOrg(ctx, userID, orgID, name, slug string) (WorkspaceView, error)` — cần org membership (role bất kỳ); `ErrConflict` trùng slug trong org.
  - `ListForUser(ctx, userID) ([]WorkspaceView, error)`
  - `GetBySlugs(ctx, userID, orgSlug, wsSlug string) (WorkspaceView, error)` — `ErrNotFound` khi không quyền.
  - `GetView(ctx, userID, workspaceID string) (WorkspaceView, error)`
  - `RequireMember(ctx, workspaceID, userID string) (db.WorkspaceMember, error)` — giữ chữ ký cũ; org owner/admin không có dòng riêng → `Role:"admin"`.
  - `Members`, `InviteMany(ctx, userID, workspaceID string, emails []string, role string) (invs []db.Invitation, skipped []string, err error)`, `AcceptInvite(ctx, userID, token string) (WorkspaceView, error)`, `PendingInvitations(ctx, userID string) ([]db.ListInvitationsForEmailRow, error)`.
  - Xoá `Create`, `GetBySlug`, `Invite` cũ.

- [ ] **Step 1: Viết lại test**

`server/internal/service/workspace_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type wsFix struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ws   *WorkspaceService
	ua   db.User
	ub   db.User
	uc   db.User
	org  db.Organization
}

// fixture: 3 user; A tạo org "unicom".
func wsFixture(t *testing.T) wsFix {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ctx := context.Background()
	reg := func(email, name string) db.User {
		s, err := as.Register(ctx, email, "password123", name)
		if err != nil {
			t.Fatal(err)
		}
		return s.User
	}
	ua, ub, uc := reg("a@example.com", "A"), reg("b@example.com", "B"), reg("c@example.com", "C")
	orgs := NewOrganizationService(q)
	org, err := orgs.Create(ctx, ua.ID, "Unicom", "unicom")
	if err != nil {
		t.Fatal(err)
	}
	return wsFix{pool: pool, q: q, orgs: orgs, ws: NewWorkspaceService(pool, q, orgs), ua: ua, ub: ub, uc: uc, org: org}
}

func TestCreateInOrgAndAccess(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()

	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil || w.OrganizationSlug != "unicom" {
		t.Fatalf("create: %v %+v", err, w)
	}
	if m, err := f.ws.RequireMember(ctx, w.ID, f.ua.ID); err != nil || m.Role != "owner" {
		t.Fatalf("owner: %v %s", err, m.Role)
	}
	if _, err := f.ws.RequireMember(ctx, w.ID, f.ub.ID); err != ErrForbidden {
		t.Fatalf("outsider: %v", err)
	}
	// B không thuộc org → không tạo được workspace trong org
	if _, err := f.ws.CreateInOrg(ctx, f.ub.ID, f.org.ID, "X", "x-ws"); err != ErrForbidden {
		t.Fatalf("outsider create: %v", err)
	}
	// trùng slug trong cùng org → conflict; slug đó ở org khác → OK
	if _, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Khác", "doi-alpha"); err != ErrConflict {
		t.Fatalf("dup slug: %v", err)
	}
	org2, _ := f.orgs.Create(ctx, f.ub.ID, "Org B", "org-b")
	if _, err := f.ws.CreateInOrg(ctx, f.ub.ID, org2.ID, "Alpha của B", "doi-alpha"); err != nil {
		t.Fatalf("same slug other org: %v", err)
	}
	if _, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "X", "login"); err == nil {
		t.Fatal("reserved slug accepted")
	}
	got, err := f.ws.GetBySlugs(ctx, f.ua.ID, "unicom", "doi-alpha")
	if err != nil || got.ID != w.ID {
		t.Fatalf("GetBySlugs: %v", err)
	}
	if _, err := f.ws.GetBySlugs(ctx, f.ub.ID, "unicom", "doi-alpha"); err != ErrNotFound {
		t.Fatalf("outsider GetBySlugs: %v", err)
	}
}

func TestOrgAdminSeesAllWorkspaces(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	// C là org admin nhưng không có dòng workspace_members
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: f.org.ID, UserID: f.uc.ID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	m, err := f.ws.RequireMember(ctx, w.ID, f.uc.ID)
	if err != nil || m.Role != "admin" {
		t.Fatalf("org admin access: %v role=%q", err, m.Role)
	}
	list, err := f.ws.ListForUser(ctx, f.uc.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("org admin list: %v n=%d", err, len(list))
	}
	// member thường của org không tự động vào
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: f.org.ID, UserID: f.ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.RequireMember(ctx, w.ID, f.ub.ID); err != ErrForbidden {
		t.Fatalf("org member without ws membership: %v", err)
	}
}

func TestInviteManyAndAccept(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")

	if _, _, err := f.ws.InviteMany(ctx, f.ub.ID, w.ID, []string{"c@example.com"}, "member"); err != ErrForbidden {
		t.Fatalf("outsider invite: %v", err)
	}
	invs, skipped, err := f.ws.InviteMany(ctx, f.ua.ID, w.ID,
		[]string{"B@example.com", "b@example.com", "a@example.com", "not-an-email", "c@example.com"}, "member")
	if err != nil {
		t.Fatal(err)
	}
	if len(invs) != 2 { // b, c (a là thành viên → skipped; dup + email sai bị loại)
		t.Fatalf("want 2 invitations, got %d", len(invs))
	}
	if len(skipped) != 2 { // a@example.com (đã là thành viên), not-an-email
		t.Fatalf("want 2 skipped, got %v", skipped)
	}
	pend, err := f.ws.PendingInvitations(ctx, f.ub.ID)
	if err != nil || len(pend) != 1 || pend[0].OrganizationSlug != "unicom" {
		t.Fatalf("pending: %v %+v", err, pend)
	}
	before, _ := f.q.GetUserByID(ctx, f.ub.ID)
	if before.OnboardedAt.Valid {
		t.Fatal("B should not be onboarded before accept")
	}
	got, err := f.ws.AcceptInvite(ctx, f.ub.ID, pend[0].Token)
	if err != nil || got.ID != w.ID {
		t.Fatalf("accept: %v", err)
	}
	if _, err := f.ws.RequireMember(ctx, w.ID, f.ub.ID); err != nil {
		t.Fatal("ws member not added")
	}
	if _, err := f.orgs.RequireMember(ctx, f.org.ID, f.ub.ID); err != nil {
		t.Fatal("org member not added")
	}
	after, _ := f.q.GetUserByID(ctx, f.ub.ID)
	if !after.OnboardedAt.Valid {
		t.Fatal("accept must mark user onboarded")
	}
	if _, err := f.ws.AcceptInvite(ctx, f.ub.ID, pend[0].Token); err != ErrNotFound {
		t.Fatalf("reused token: %v", err)
	}
	if _, _, err := f.ws.InviteMany(ctx, f.ua.ID, w.ID, nil, "member"); err == nil {
		t.Fatal("empty emails accepted")
	}
	if _, _, err := f.ws.InviteMany(ctx, f.ua.ID, w.ID, []string{"d@example.com"}, "owner"); err == nil {
		t.Fatal("role owner accepted")
	}
}
```

Sửa fixture trong `task_test.go:20-30` và `meeting_test.go:18-23`: `NewWorkspaceService(q)` → `NewWorkspaceService(pool, q, NewOrganizationService(q))` (cần giữ `pool` từ `testutil.DB(t)`), `ws.Create(ctx, uid, name, slug)` → `org, _ := orgs.Create(ctx, uid, "Org", "org-"+slug)` rồi `v, _ := ws.CreateInOrg(ctx, uid, org.ID, name, slug)`; fixture trả `db.Workspace` thì trả `v.Workspace`.

- [ ] **Step 2: Chạy test, fail** — Run: `cd server && go test ./internal/service/` → FAIL compile.

- [ ] **Step 3: Viết lại `server/internal/service/workspace.go`**

```go
package service

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const maxInviteBatch = 50

// WorkspaceView = workspace + định danh org, đủ cho FE dựng URL /{org}/{ws}.
type WorkspaceView struct {
	db.Workspace
	OrganizationSlug string
	OrganizationName string
}

type WorkspaceService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
}

func NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *WorkspaceService {
	return &WorkspaceService{pool: pool, q: q, orgs: orgs}
}

func viewFromInOrgRow(r db.ListWorkspacesInOrgRow) WorkspaceView {
	return WorkspaceView{Workspace: db.Workspace{ID: r.ID, OrganizationID: r.OrganizationID, Slug: r.Slug, Name: r.Name,
		CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt},
		OrganizationSlug: r.OrganizationSlug, OrganizationName: r.OrganizationName}
}

func (s *WorkspaceService) CreateInOrg(ctx context.Context, userID, orgID, name, slug string) (WorkspaceView, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return WorkspaceView{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return WorkspaceView{}, Invalid("tên workspace không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return WorkspaceView{}, err
	}
	w, err := s.q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), OrganizationID: orgID, Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return WorkspaceView{}, ErrConflict
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: userID, Role: "owner"}); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}

func (s *WorkspaceService) GetView(ctx context.Context, userID, workspaceID string) (WorkspaceView, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceView{}, err
	}
	r, err := s.q.GetWorkspaceWithOrg(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

func (s *WorkspaceService) ListForUser(ctx context.Context, userID string) ([]WorkspaceView, error) {
	rows, err := s.q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceView, 0, len(rows))
	for _, r := range rows {
		out = append(out, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)))
	}
	return out, nil
}

func (s *WorkspaceService) GetBySlugs(ctx context.Context, userID, orgSlug, wsSlug string) (WorkspaceView, error) {
	r, err := s.q.GetWorkspaceBySlugs(ctx, db.GetWorkspaceBySlugsParams{Slug: orgSlug, Slug_2: wsSlug})
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if _, err := s.RequireMember(ctx, r.ID, userID); err != nil {
		return WorkspaceView{}, ErrNotFound // không lộ sự tồn tại
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

// RequireMember: quyền workspace = dòng workspace_members HOẶC owner/admin của
// org chứa workspace (khi đó role hiệu lực là "admin"). Đây là nơi DUY NHẤT
// quyết định quyền workspace — service khác không tự query workspace_members.
func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	role, err := s.q.GetWorkspaceAccess(ctx, db.GetWorkspaceAccessParams{ID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && role == "") {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	return db.WorkspaceMember{WorkspaceID: workspaceID, UserID: userID, Role: role}, nil
}

func (s *WorkspaceService) Members(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListWorkspaceMembers(ctx, workspaceID)
}

// InviteMany: dedupe + lowercase; email sai hoặc đã là thành viên → skipped.
func (s *WorkspaceService) InviteMany(ctx context.Context, userID, workspaceID string, emails []string, role string) ([]db.Invitation, []string, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, nil, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return nil, nil, ErrForbidden
	}
	if role != "admin" && role != "member" {
		return nil, nil, Invalid("role phải là admin hoặc member")
	}
	if len(emails) == 0 {
		return nil, nil, Invalid("cần ít nhất một email")
	}
	if len(emails) > maxInviteBatch {
		return nil, nil, Invalid("tối đa 50 email mỗi lần")
	}
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	isMember := map[string]bool{}
	for _, mm := range members {
		isMember[strings.ToLower(mm.Email)] = true
	}
	seen := map[string]bool{}
	var invs []db.Invitation
	var skipped []string
	for _, raw := range emails {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		if _, perr := mail.ParseAddress(email); perr != nil || isMember[email] {
			skipped = append(skipped, email)
			continue
		}
		inv, err := s.q.CreateInvitation(ctx, db.CreateInvitationParams{
			ID: util.NewID(), WorkspaceID: workspaceID, Email: email, Role: role,
			Token:     util.NewID() + util.NewID(),
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		invs = append(invs, inv)
	}
	return invs, skipped, nil
}

func (s *WorkspaceService) PendingInvitations(ctx context.Context, userID string) ([]db.ListInvitationsForEmailRow, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.q.ListInvitationsForEmail(ctx, u.Email)
}

// AcceptInvite: một transaction — org member (nếu chưa) + workspace member +
// đánh dấu lời mời + MarkUserOnboarded. Không bao giờ có trạng thái "là thành
// viên nhưng chưa onboard".
func (s *WorkspaceService) AcceptInvite(ctx context.Context, userID, token string) (WorkspaceView, error) {
	inv, err := s.q.GetInvitationByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, inv.WorkspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	if err := qtx.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: userID, Role: "member"}); err != nil {
		return WorkspaceView{}, err
	}
	if err := qtx.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: userID, Role: inv.Role}); err != nil {
		return WorkspaceView{}, err
	}
	if err := qtx.MarkInvitationAccepted(ctx, inv.ID); err != nil {
		return WorkspaceView{}, err
	}
	if _, err := qtx.MarkUserOnboarded(ctx, userID); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}
```

Sửa `server/cmd/server/main.go`:

```go
	orgSvc := service.NewOrganizationService(q)
	wsSvc := service.NewWorkspaceService(pool, q, orgSvc)
```
và thêm `Organizations: orgSvc` vào `handler.Deps` (field thêm ở Task 6; tạm thời chưa thêm thì handler chưa compile — Task 6 hoàn thiện). Để build xanh ngay task này, tạm sửa các handler cũ gọi `Create`/`GetBySlug`/`Invite` thành `CreateInOrg`… ở Task 6; vì vậy chạy test service bằng `go test ./internal/service/` (không cần handler compile).

- [ ] **Step 4: Chạy test** — Run: `cd server && go test ./internal/service/ -v` → PASS tất cả (workspace/org/task/meeting/auth).

- [ ] **Step 5: Commit** — `git add server && git commit -m "feat: workspace service scoped to organizations, bulk invites, transactional accept"`

### Task 5: OnboardingService (questionnaire, complete, welcome task)

**Files:**
- Create: `server/internal/service/onboarding.go`, `server/internal/service/onboarding_test.go`, `server/internal/service/templates/welcome_task.go`

**Interfaces:**
- Produces:
  - `NewOnboardingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *OnboardingService`
  - `PatchQuestionnaire(ctx, userID string, raw json.RawMessage) (db.User, error)` — `raw` nil/empty → không đổi; validate object, ≤16 KiB, enum.
  - `Complete(ctx, userID, path, workspaceID string) (db.User, error)` — idempotent; `path` ∈ {full, invite_skipped, skip_existing, invite_accept, ""}.
  - `SeedWelcomeTask(ctx, userID, workspaceID string) (task db.Task, created bool, err error)`.
  - `templates.WelcomeTaskTitle`, `templates.WelcomeTaskBody` (string const, tiếng Việt).

- [ ] **Step 1: Test**

`server/internal/service/onboarding_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestQuestionnaireAndComplete(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	s := NewOnboardingService(f.q, f.ws, NopPublisher{})

	u, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`{"version":1,"role":"engineer","use_case":["team_tasks","other"],"use_case_other":"khác"}`))
	if err != nil || !strings.Contains(string(u.OnboardingQuestionnaire), `"engineer"`) {
		t.Fatalf("patch: %v %s", err, u.OnboardingQuestionnaire)
	}
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`{"role":"wizard"}`)); err == nil {
		t.Fatal("bad role accepted")
	}
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(`[1,2]`)); err == nil {
		t.Fatal("non-object accepted")
	}
	big := `{"role_other":"` + strings.Repeat("x", 20000) + `"}`
	if _, err := s.PatchQuestionnaire(ctx, f.ua.ID, json.RawMessage(big)); err == nil {
		t.Fatal("oversized accepted")
	}
	// nil = giữ nguyên
	u2, _ := s.PatchQuestionnaire(ctx, f.ua.ID, nil)
	if string(u2.OnboardingQuestionnaire) != string(u.OnboardingQuestionnaire) {
		t.Fatal("nil patch changed questionnaire")
	}

	if u.OnboardedAt.Valid {
		t.Fatal("should not be onboarded yet")
	}
	u3, err := s.Complete(ctx, f.ua.ID, "full", "")
	if err != nil || !u3.OnboardedAt.Valid {
		t.Fatalf("complete: %v", err)
	}
	u4, _ := s.Complete(ctx, f.ua.ID, "skip_existing", "")
	if !u4.OnboardedAt.Time.Equal(u3.OnboardedAt.Time) {
		t.Fatal("complete not idempotent")
	}
	if _, err := s.Complete(ctx, f.ua.ID, "bogus", ""); err == nil {
		t.Fatal("bad path accepted")
	}
}

func TestSeedWelcomeTask(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	s := NewOnboardingService(f.q, f.ws, NopPublisher{})
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")

	task, created, err := s.SeedWelcomeTask(ctx, f.ua.ID, w.ID)
	if err != nil || !created || task.Kind != "welcome" || task.Status != "in_progress" || task.Priority != "high" {
		t.Fatalf("seed: %v created=%v %+v", err, created, task)
	}
	if !task.AssigneeID.Valid || task.AssigneeID.String != f.ua.ID {
		t.Fatal("welcome task must be assigned to caller")
	}
	again, created2, err := s.SeedWelcomeTask(ctx, f.ua.ID, w.ID)
	if err != nil || created2 || again.ID != task.ID {
		t.Fatalf("seed twice: %v created=%v", err, created2)
	}
	if _, _, err := s.SeedWelcomeTask(ctx, f.ub.ID, w.ID); err != ErrForbidden {
		t.Fatalf("outsider seed: %v", err)
	}
}
```

`NopPublisher` có sẵn trong `service/events.go`.

- [ ] **Step 2: Chạy test, fail** — Run: `cd server && go test ./internal/service/ -run 'TestQuestionnaireAndComplete|TestSeedWelcomeTask'` → FAIL undefined.

- [ ] **Step 3: Implement**

`server/internal/service/templates/welcome_task.go`:

```go
// Package templates giữ nội dung sản phẩm do server tạo (không phải input người dùng).
package templates

const WelcomeTaskTitle = "Bắt đầu với UniWork"

const WelcomeTaskBody = `Chào mừng bạn! Đây là task hướng dẫn đầu tiên — kéo nó sang cột **Hoàn thành** khi xong.

**Trong 5 phút tới:**
1. Tạo một việc mới bằng nút **Việc mới** và giao cho một người.
2. Kéo thẻ việc giữa các cột trên bảng — trạng thái cập nhật tức thì cho cả đội.
3. Mở **Cuộc họp** và lên lịch cuộc họp đầu tiên; phòng video có sẵn khi tới giờ.
4. Vào **Thành viên** để mời thêm đồng nghiệp bằng email.

Mẹo: workspace nằm trong tổ chức của bạn — tạo thêm workspace cho từng đội/dự án từ menu chuyển workspace ở góc trái.`
```

`server/internal/service/onboarding.go`:

```go
package service

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/service/templates"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const questionnaireMaxBytes = 16 * 1024

var validRoles = map[string]bool{"engineer": true, "manager": true, "product": true, "ops": true,
	"sales": true, "hr": true, "student": true, "other": true}
var validUseCases = map[string]bool{"team_tasks": true, "meetings": true, "personal_tasks": true,
	"project_tracking": true, "other": true}
var validCompletionPaths = map[string]bool{"": true, "full": true, "invite_skipped": true,
	"skip_existing": true, "invite_accept": true}

type OnboardingService struct {
	q   *db.Queries
	ws  *WorkspaceService
	pub EventPublisher
}

func NewOnboardingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *OnboardingService {
	return &OnboardingService{q: q, ws: ws, pub: pub}
}

// questionnaire chỉ validate shape; server không suy diễn gì từ nội dung.
type questionnaire struct {
	Version       int      `json:"version"`
	Role          *string  `json:"role"`
	RoleOther     string   `json:"role_other"`
	RoleSkipped   bool     `json:"role_skipped"`
	UseCase       []string `json:"use_case"`
	UseCaseOther  string   `json:"use_case_other"`
	UseCaseSkipped bool    `json:"use_case_skipped"`
}

func validateQuestionnaire(raw json.RawMessage) error {
	if len(raw) > questionnaireMaxBytes {
		return Invalid("questionnaire quá lớn")
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return Invalid("questionnaire phải là object JSON")
	}
	var qn questionnaire
	if err := json.Unmarshal(raw, &qn); err != nil {
		return Invalid("questionnaire sai kiểu dữ liệu")
	}
	if qn.Role != nil && !validRoles[*qn.Role] {
		return Invalid("role không hợp lệ")
	}
	for _, u := range qn.UseCase {
		if !validUseCases[u] {
			return Invalid("use_case không hợp lệ")
		}
	}
	if len(qn.RoleOther) > 80 || len(qn.UseCaseOther) > 80 {
		return Invalid("mô tả 'khác' tối đa 80 ký tự")
	}
	return nil
}

func (s *OnboardingService) PatchQuestionnaire(ctx context.Context, userID string, raw json.RawMessage) (db.User, error) {
	var arg []byte
	if len(raw) > 0 {
		if err := validateQuestionnaire(raw); err != nil {
			return db.User{}, err
		}
		arg = raw
	}
	return s.q.PatchUserOnboarding(ctx, db.PatchUserOnboardingParams{Questionnaire: arg, ID: userID})
}

func (s *OnboardingService) Complete(ctx context.Context, userID, path, workspaceID string) (db.User, error) {
	if !validCompletionPaths[path] {
		return db.User{}, Invalid("completion_path không hợp lệ")
	}
	if workspaceID != "" {
		if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
			return db.User{}, err
		}
	}
	return s.q.MarkUserOnboarded(ctx, userID)
}

// SeedWelcomeTask: đúng 1 task hướng dẫn / (workspace, user); lần 2 trả task cũ.
func (s *OnboardingService) SeedWelcomeTask(ctx context.Context, userID, workspaceID string) (db.Task, bool, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Task{}, false, err
	}
	if existing, err := s.q.GetWelcomeTask(ctx, db.GetWelcomeTaskParams{WorkspaceID: workspaceID, CreatedBy: userID}); err == nil {
		return existing, false, nil
	}
	maxPos, err := s.q.MaxTaskPosition(ctx, db.MaxTaskPositionParams{WorkspaceID: workspaceID, Status: "in_progress"})
	if err != nil {
		return db.Task{}, false, err
	}
	task, err := s.q.CreateWelcomeTask(ctx, db.CreateWelcomeTaskParams{
		ID: util.NewID(), WorkspaceID: workspaceID,
		Title: templates.WelcomeTaskTitle, Description: templates.WelcomeTaskBody,
		AssigneeID: pgtype.Text{String: userID, Valid: true}, Position: maxPos + 1024,
	})
	if isUniqueViolation(err) { // đua với chính mình (StrictMode) → đọc lại
		existing, gerr := s.q.GetWelcomeTask(ctx, db.GetWelcomeTaskParams{WorkspaceID: workspaceID, CreatedBy: userID})
		return existing, false, gerr
	}
	if err != nil {
		return db.Task{}, false, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "task.created", Payload: map[string]string{"task_id": task.ID}})
	return task, true, nil
}
```

Lưu ý sqlc: `CreateWelcomeTask` dùng `$5` hai lần (assignee_id và created_by) — sqlc sinh 1 param `AssigneeID` (kiểu `pgtype.Text`) hoặc tách `CreatedBy string`; kiểm tra `generated/tasks.sql.go` và điền cho khớp (nếu tách thì truyền `CreatedBy: userID`). `PatchUserOnboardingParams.Questionnaire` là `[]byte`; nil → `COALESCE` giữ giá trị cũ.

- [ ] **Step 4: Chạy test** — Run: `cd server && go test ./internal/service/ -v` → PASS.

- [ ] **Step 5: Commit** — `git add server && git commit -m "feat: onboarding service (questionnaire, complete, welcome task)"`

### Task 6: Handlers + router + user DTO

**Files:**
- Create: `server/internal/handler/organization.go`, `server/internal/handler/onboarding.go`, `server/internal/handler/onboarding_test.go`
- Modify: `server/internal/handler/workspace.go`, `server/internal/handler/auth.go:15-27`, `server/internal/handler/router.go`, `server/cmd/server/main.go`

**Interfaces:**
- Produces HTTP (xem spec §4). `Deps` thêm `Organizations *service.OrganizationService`, `Onboarding *service.OnboardingService`.
- `userDTO` thêm `OnboardedAt *string json:"onboarded_at"` (RFC3339 hoặc null — luôn có key), `OnboardingQuestionnaire json.RawMessage json:"onboarding_questionnaire"`.
- `workspaceDTO` thêm `OrganizationID`, `OrganizationSlug`, `OrganizationName`.

- [ ] **Step 1: Test HTTP (kiểm tra `auth_test.go` để tái dùng helper dựng router; nếu có `newTestServer`/tương tự dùng lại, nếu không viết helper như dưới)**

`server/internal/handler/onboarding_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func onboardingServer(t *testing.T) http.Handler {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Hour}
	orgs := service.NewOrganizationService(q)
	ws := service.NewWorkspaceService(pool, q, orgs)
	hub := realtime.NewHub()
	pub := service.NopPublisher{}
	return New(Deps{
		Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: logger.New(), Minter: minter,
		Auth: service.NewAuthService(q, minter, time.Hour), Organizations: orgs, Workspaces: ws,
		Tasks: service.NewTaskService(q, ws, pub), Meetings: service.NewMeetingService(q, ws, pub),
		Onboarding: service.NewOnboardingService(q, ws, pub), Hub: hub,
	})
}

func doJSON(t *testing.T, h http.Handler, method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return rr, out
}

func TestOnboardingEndToEnd(t *testing.T) {
	h := onboardingServer(t)
	rr, out := doJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "a@example.com", "password": "password123", "display_name": "A"})
	if rr.Code != 200 {
		t.Fatalf("register: %d %s", rr.Code, rr.Body)
	}
	token := out["access_token"].(string)
	user := out["user"].(map[string]any)
	if v, ok := user["onboarded_at"]; !ok || v != nil {
		t.Fatalf("register user must expose onboarded_at=null, got %v", user)
	}

	rr, _ = doJSON(t, h, "PATCH", "/api/v1/me/onboarding", token, map[string]any{
		"questionnaire": map[string]any{"version": 1, "role": "manager", "use_case": []string{"meetings"}}})
	if rr.Code != 200 {
		t.Fatalf("patch: %d %s", rr.Code, rr.Body)
	}

	rr, out = doJSON(t, h, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if rr.Code != 201 {
		t.Fatalf("create org: %d %s", rr.Code, rr.Body)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	rr, out = doJSON(t, h, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if rr.Code != 201 {
		t.Fatalf("create ws: %d %s", rr.Code, rr.Body)
	}
	ws := out["workspace"].(map[string]any)
	if ws["organization_slug"] != "unicom" {
		t.Fatalf("workspace dto missing org: %v", ws)
	}
	wsID := ws["id"].(string)
	rr, _ = doJSON(t, h, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Khác", "slug": "doi-alpha"})
	if rr.Code != 409 {
		t.Fatalf("dup slug: %d", rr.Code)
	}

	rr, _ = doJSON(t, h, "GET", "/api/v1/me", token, nil)
	if rr.Code != 200 || !bytes.Contains(rr.Body.Bytes(), []byte(`"onboarded_at":null`)) {
		t.Fatalf("me before complete: %d %s", rr.Code, rr.Body)
	}
	rr, out = doJSON(t, h, "POST", "/api/v1/me/onboarding/complete", token, map[string]string{"completion_path": "full", "workspace_id": wsID})
	if rr.Code != 200 || out["user"].(map[string]any)["onboarded_at"] == nil {
		t.Fatalf("complete: %d %s", rr.Code, rr.Body)
	}

	rr, _ = doJSON(t, h, "POST", "/api/v1/workspaces/"+wsID+"/welcome-task", token, nil)
	if rr.Code != 201 {
		t.Fatalf("welcome task: %d %s", rr.Code, rr.Body)
	}
	rr, _ = doJSON(t, h, "POST", "/api/v1/workspaces/"+wsID+"/welcome-task", token, nil)
	if rr.Code != 200 {
		t.Fatalf("welcome task again: %d", rr.Code)
	}

	rr, out = doJSON(t, h, "POST", "/api/v1/workspaces/"+wsID+"/invitations", token, map[string]any{
		"emails": []string{"b@example.com", "a@example.com"}, "role": "member"})
	if rr.Code != 200 || len(out["invitations"].([]any)) != 1 || len(out["skipped"].([]any)) != 1 {
		t.Fatalf("bulk invite: %d %s", rr.Code, rr.Body)
	}
	rr, _ = doJSON(t, h, "GET", "/api/v1/orgs/unicom/workspaces/doi-alpha", token, nil)
	if rr.Code != 200 {
		t.Fatalf("get by slugs: %d %s", rr.Code, rr.Body)
	}
}
```

`service.NopPublisher{}` đã có sẵn trong `service/events.go` — dùng nó như `auth_test.go` đang làm.

- [ ] **Step 2: Chạy test, fail** — Run: `cd server && go test ./internal/handler/ -run TestOnboardingEndToEnd` → FAIL compile (`Organizations` field).

- [ ] **Step 3: Implement**

`server/internal/handler/auth.go` — thay `userDTO`/`toUserDTO`:

```go
type userDTO struct {
	ID                     string          `json:"id"`
	Email                  string          `json:"email"`
	DisplayName            string          `json:"display_name"`
	AvatarURL              string          `json:"avatar_url,omitempty"`
	OnboardedAt            *string         `json:"onboarded_at"`
	OnboardingQuestionnaire json.RawMessage `json:"onboarding_questionnaire"`
}

func toUserDTO(u db.User) userDTO {
	dto := userDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, OnboardingQuestionnaire: json.RawMessage("{}")}
	if u.AvatarUrl.Valid {
		dto.AvatarURL = u.AvatarUrl.String
	}
	if u.OnboardedAt.Valid {
		s := u.OnboardedAt.Time.Format(time.RFC3339)
		dto.OnboardedAt = &s
	}
	if len(u.OnboardingQuestionnaire) > 0 {
		dto.OnboardingQuestionnaire = json.RawMessage(u.OnboardingQuestionnaire)
	}
	return dto
}
```
(thêm `"encoding/json"` vào import.)

`server/internal/handler/organization.go`:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type organizationDTO struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role,omitempty"`
}

func (h *handlers) listOrganizations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]organizationDTO, 0, len(rows))
	for _, o := range rows {
		out = append(out, organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: o.Role})
	}
	respondJSON(w, 200, map[string]any{"organizations": out})
}

func (h *handlers) createOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	o, err := h.Organizations.Create(r.Context(), middleware.UserID(r.Context()), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"organization": organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: "owner"}})
}

func (h *handlers) getOrganization(w http.ResponseWriter, r *http.Request) {
	o, m, err := h.Organizations.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"organization": organizationDTO{ID: o.ID, Slug: o.Slug, Name: o.Name, Role: m.Role}})
}

func (h *handlers) listOrgWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Organizations.ListWorkspaces(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]workspaceDTO, 0, len(rows))
	for _, x := range rows {
		out = append(out, workspaceDTO{ID: x.ID, Slug: x.Slug, Name: x.Name, OrganizationID: x.OrganizationID,
			OrganizationSlug: x.OrganizationSlug, OrganizationName: x.OrganizationName})
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

func (h *handlers) createOrgWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	ws, err := h.Workspaces.CreateInOrg(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "org"), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

var _ = db.Organization{} // giữ import khi chưa dùng trực tiếp
```

`server/internal/handler/onboarding.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

const onboardingBodyLimit = 16 * 1024

func (h *handlers) patchOnboarding(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, onboardingBodyLimit)
	var in struct {
		Questionnaire json.RawMessage `json:"questionnaire"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json or body too large")
		return
	}
	u, err := h.Onboarding.PatchQuestionnaire(r.Context(), middleware.UserID(r.Context()), in.Questionnaire)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) completeOnboarding(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CompletionPath string `json:"completion_path"`
		WorkspaceID    string `json:"workspace_id"`
	}
	if r.ContentLength != 0 {
		if err := decode(r, &in); err != nil {
			respondError(w, 400, "invalid_request", "invalid json")
			return
		}
	}
	u, err := h.Onboarding.Complete(r.Context(), middleware.UserID(r.Context()), in.CompletionPath, in.WorkspaceID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.Log.Info("onboarding completed", "user", u.ID, "path", in.CompletionPath, "workspace", in.WorkspaceID)
	respondJSON(w, 200, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) seedWelcomeTask(w http.ResponseWriter, r *http.Request) {
	task, created, err := h.Onboarding.SeedWelcomeTask(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := 200
	if created {
		status = 201
	}
	respondJSON(w, status, map[string]any{"task": toTaskDTO(task)})
}

func (h *handlers) myInvitations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Workspaces.PendingInvitations(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, x := range rows {
		out = append(out, map[string]any{
			"id": x.ID, "role": x.Role, "token": x.Token,
			"expires_at":   x.ExpiresAt.Time.Format(time.RFC3339),
			"workspace":    map[string]string{"id": x.WorkspaceID, "slug": x.WorkspaceSlug, "name": x.WorkspaceName},
			"organization": map[string]string{"id": x.OrganizationID, "slug": x.OrganizationSlug, "name": x.OrganizationName},
			"invited_by":   map[string]string{"display_name": x.InvitedByName},
		})
	}
	respondJSON(w, 200, map[string]any{"invitations": out})
}
```

`server/internal/handler/workspace.go` — thay toàn bộ:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

type workspaceDTO struct {
	ID               string `json:"id"`
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	OrganizationID   string `json:"organization_id"`
	OrganizationSlug string `json:"organization_slug"`
	OrganizationName string `json:"organization_name"`
}

func toWorkspaceDTO(w service.WorkspaceView) workspaceDTO {
	return workspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name, OrganizationID: w.OrganizationID,
		OrganizationSlug: w.OrganizationSlug, OrganizationName: w.OrganizationName}
}

func (h *handlers) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]workspaceDTO, 0, len(ws))
	for _, x := range ws {
		out = append(out, toWorkspaceDTO(x))
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

func (h *handlers) getWorkspaceBySlugs(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.GetBySlugs(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "org"), chi.URLParam(r, "wsSlug"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Workspaces.Members(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"members": ms})
}

// POST /workspaces/{id}/invitations — nhận `emails: []` (mới) hoặc `email` đơn (tương thích).
func (h *handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email  string   `json:"email"`
		Emails []string `json:"emails"`
		Role   string   `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	emails := in.Emails
	if in.Email != "" {
		emails = append(emails, in.Email)
	}
	invs, skipped, err := h.Workspaces.InviteMany(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), emails, in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]map[string]string, 0, len(invs))
	for _, inv := range invs {
		out = append(out, map[string]string{"id": inv.ID, "email": inv.Email, "role": inv.Role, "token": inv.Token})
	}
	if skipped == nil {
		skipped = []string{}
	}
	respondJSON(w, 200, map[string]any{"invitations": out, "skipped": skipped})
}

func (h *handlers) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.AcceptInvite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
```

`server/internal/handler/router.go` — `Deps` thêm `Organizations *service.OrganizationService`, `Onboarding *service.OnboardingService`; trong group RequireAuth thay các route workspace:

```go
			r.Get("/me", h.me)
			r.Patch("/me/onboarding", h.patchOnboarding)
			r.Post("/me/onboarding/complete", h.completeOnboarding)
			r.Get("/me/invitations", h.myInvitations)
			r.Get("/orgs", h.listOrganizations)
			r.Post("/orgs", h.createOrganization)
			r.Get("/orgs/{org}", h.getOrganization)                       // {org} = slug
			r.Get("/orgs/{org}/workspaces/{wsSlug}", h.getWorkspaceBySlugs) // {org} = slug
			r.Get("/orgs/{org}/workspaces", h.listOrgWorkspaces)           // {org} = id
			r.Post("/orgs/{org}/workspaces", h.createOrgWorkspace)         // {org} = id
			r.Get("/workspaces", h.listWorkspaces)
			r.Get("/workspaces/{workspaceID}/members", h.listMembers)
			r.Post("/workspaces/{workspaceID}/invitations", h.createInvitation)
			r.Post("/workspaces/{workspaceID}/welcome-task", h.seedWelcomeTask)
			r.Post("/invitations/{token}/accept", h.acceptInvitation)
```
(Dùng chung tên param `{org}` ở cùng vị trí để chi không báo xung đột pattern; handler tự hiểu là slug hay id theo route. Xoá `POST /workspaces`, `GET /workspaces/{slug}`.)

`server/cmd/server/main.go` — thêm `Organizations: orgSvc, Onboarding: service.NewOnboardingService(q, wsSvc, pub)` vào Deps.

- [ ] **Step 4: Build + test toàn bộ** — Run: `cd server && go build ./... && go test ./...` → PASS. Sửa `auth_test.go`/`health_test.go` nếu chúng dựng `Deps` thiếu field (thêm field mới).

- [ ] **Step 5: Commit** — `git add server && git commit -m "feat(api): organizations, onboarding, bulk invitations, welcome task endpoints"`

---

## Phase B — Nền frontend

### Task 7: UI kit — tokens, fonts, animation, Button variants, primitives mới, Toaster

**Files:**
- Modify: `packages/ui/styles/tokens.css`, `packages/ui/styles/base.css`, `packages/ui/components/ui/button.tsx`, `packages/ui/package.json`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/app/providers.tsx`
- Create: `packages/ui/components/ui/field.tsx`, `card.tsx`, `skeleton.tsx`, `dot-sphere.tsx`, `stepper.tsx`, `sonner.tsx`, `packages/ui/hooks/use-scroll-fade.ts`
- Test: `packages/ui/components/ui/button.test.tsx` (mở rộng), `packages/ui/components/ui/field.test.tsx`

**Interfaces:**
- Produces: `Button` variant `outline`, size `lg` (h-10 px-4 text-body) và `icon-sm` (size-7); `Field, FieldGroup, FieldLabel, FieldTitle, FieldDescription, FieldError` (data-slot `field-group`/`field`/`field-error`); `Card, CardHeader, CardTitle, CardContent`; `Skeleton`; `DotSphere` (props như usf); `Stepper, StepperNav, StepperItem, StepperIndicator, StepperTitle, StepperDescription, StepperSeparator`; `Toaster` + re-export `toast` từ sonner; `useScrollFade(ref, fadeSize?, axis?)`.
- CSS utilities: `text-micro … text-display`, `font-serif`, `font-sans`, `animate-onboarding-enter`, `animate-welcome-emoji-pop`.

- [ ] **Step 1: Test Button variants + Field**

Thêm vào `packages/ui/components/ui/button.test.tsx`:

```tsx
it("supports outline variant and lg/icon-sm sizes", () => {
  const { rerender } = render(<Button variant="outline" size="lg">Ok</Button>);
  expect(screen.getByRole("button")).toHaveClass("border-line", "h-10");
  rerender(<Button size="icon-sm" aria-label="x">x</Button>);
  expect(screen.getByRole("button")).toHaveClass("size-7");
});
```

`packages/ui/components/ui/field.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldError, FieldGroup, FieldLabel } from "./field";

describe("Field", () => {
  it("renders slots and error with role=alert", () => {
    render(
      <FieldGroup>
        <Field data-invalid>
          <FieldLabel htmlFor="a">Tên</FieldLabel>
          <input id="a" />
          <FieldError>Lỗi</FieldError>
        </Field>
      </FieldGroup>,
    );
    expect(screen.getByLabelText("Tên")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Lỗi");
    expect(document.querySelector('[data-slot="field-group"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="field"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Chạy, fail** — Run: `pnpm --filter @uniwork/ui test` → FAIL.

- [ ] **Step 3: Implement tokens/CSS**

`packages/ui/styles/tokens.css` — thêm vào `:root`: `--uw-brand-soft: #eef2ff;` và vào `.dark`: `--uw-brand-soft: #1b2340;`.

`packages/ui/styles/base.css` — thay `font-family` của body bằng `var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)` và thêm cuối file:

```css
/* Onboarding: chỉ đổi opacity — transform trên root h-full bị tính vào
   scrollable overflow của parent → nháy scrollbar mỗi bước (bài học usf). */
@keyframes onboarding-enter { from { opacity: 0; } }
.animate-onboarding-enter { animation: onboarding-enter 0.4s ease both; }

@keyframes welcome-emoji-pop {
  0% { transform: scale(0.4); opacity: 0; }
  35% { transform: scale(1.25); opacity: 1; }
  55% { transform: scale(0.92); }
  75% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
.animate-welcome-emoji-pop { animation: welcome-emoji-pop 0.7s cubic-bezier(0.4, 0, 0.2, 1) both; }

@media (prefers-reduced-motion: reduce) {
  .animate-onboarding-enter, .animate-welcome-emoji-pop { animation: none; }
}
```

`apps/web/app/globals.css` — trong `@theme inline` thêm:

```css
  --color-brand-soft: var(--uw-brand-soft);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-source-serif), ui-serif, Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --text-micro: 11px;      --text-micro--line-height: 15px;
  --text-caption: 12px;    --text-caption--line-height: 16px;
  --text-label: 13px;      --text-label--line-height: 18px;
  --text-body: 14px;       --text-body--line-height: 20px;
  --text-body-lg: 15px;    --text-body-lg--line-height: 22px;
  --text-title-sm: 16px;   --text-title-sm--line-height: 24px;
  --text-title: 18px;      --text-title--line-height: 28px;
  --text-title-lg: 20px;   --text-title-lg--line-height: 28px;
  --text-display-sm: 24px; --text-display-sm--line-height: 32px;
  --text-display: 36px;    --text-display--line-height: 40px;
```

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", display: "swap" });
// Serif biên tập cho headline onboarding; cần italic cho <em> trong h1.
const sourceSerif = Source_Serif_4({
  subsets: ["latin", "vietnamese"], style: ["normal", "italic"], variable: "--font-source-serif", display: "swap",
});

export const metadata: Metadata = { title: "UniWork" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning className={`${inter.variable} ${sourceSerif.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```
(base.css `font-family: var(--font-sans, …)` — Tailwind `@theme` định nghĩa `--font-sans` ở `:root` nên body nhận Inter.)

- [ ] **Step 4: Button**

`packages/ui/components/ui/button.tsx` — thay `variants`:

```ts
      variant: {
        primary: "bg-brand text-on-brand hover:opacity-90",
        secondary: "bg-surface text-primary border border-line hover:bg-subtle",
        outline: "bg-surface text-primary border border-line hover:bg-subtle hover:border-line-strong",
        ghost: "text-secondary hover:bg-subtle hover:text-primary",
        danger: "bg-danger text-on-brand hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-body [&_svg]:size-4",
        "icon-sm": "size-7 p-0 [&_svg]:size-4",
      },
```
và thêm `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand` vào base class.

- [ ] **Step 5: Primitives mới**

`packages/ui/components/ui/field.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/utils";
import { Label } from "./label";

export function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex w-full flex-col gap-5", className)} {...props} />;
}

export function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div role="group" data-slot="field"
      className={cn("group/field flex w-full flex-col gap-2 data-[invalid=true]:text-danger", className)}
      {...props} />
  );
}

export function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn("mb-0 w-fit text-body font-medium text-primary", className)} {...props} />;
}

/** Nhãn cho nội dung dẫn xuất — không có control để trỏ tới. */
export function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-label" className={cn("w-fit text-body font-medium text-primary", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-body text-secondary", className)} {...props} />;
}

export function FieldError({ className, children, ...props }: React.ComponentProps<"div">) {
  if (!children) return null;
  return (
    <div role="alert" data-slot="field-error" className={cn("text-body text-danger", className)} {...props}>
      {children}
    </div>
  );
}
```

`packages/ui/components/ui/card.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-lg border border-line bg-surface text-primary", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-title-sm font-semibold", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
```

`packages/ui/components/ui/skeleton.tsx`:

```tsx
import { cn } from "../../lib/utils";
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-subtle", className)} {...props} />;
}
```

`packages/ui/components/ui/dot-sphere.tsx`: copy nguyên `../usf/packages/ui/components/ui/dot-sphere.tsx`, chỉ đổi import `@multica/ui/lib/utils` → `../../lib/utils`. Kiểm tra file dùng màu qua `getComputedStyle(...).color` hoặc `currentColor` — nếu đọc token `--foreground`, đổi thành `--uw-text-primary`.

`packages/ui/components/ui/stepper.tsx`: copy nguyên `../usf/packages/ui/components/ui/stepper.tsx` (phụ thuộc `@base-ui/react/merge-props`, `@base-ui/react/use-render` — có trong ^1.3.0), đổi import utils, và áp bảng đổi class (`bg-primary text-primary-foreground` trong indicator → `bg-primary text-inverse`, `border`→`border-line`, `bg-muted`→`bg-subtle`, `text-muted-foreground`→`text-secondary`).

`packages/ui/hooks/use-scroll-fade.ts`: copy nguyên từ usf (không phụ thuộc gì).

`packages/ui/components/ui/sonner.tsx`:

```tsx
"use client";
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

export { toast };

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-brand" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <OctagonX className="size-4 text-danger" />,
        loading: <Loader2 className="size-4 animate-spin text-brand" />,
      }}
      style={{
        "--normal-bg": "var(--uw-surface)", "--normal-text": "var(--uw-text-primary)",
        "--normal-border": "var(--uw-line)", "--border-radius": "var(--uw-radius)",
      } as React.CSSProperties}
      {...props}
    />
  );
}
```

`packages/ui/package.json`: dependencies thêm `"sonner": "^2.0.7"`; exports thêm `"./hooks/*": "./hooks/*.ts"`. Chạy `pnpm install`.

`apps/web/app/providers.tsx`:

```tsx
"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createQueryClient, initI18n } from "@uniwork/core";
import { Toaster } from "@uniwork/ui/components/ui/sonner";

initI18n();

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(createQueryClient);
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 6: Test + typecheck** — Run: `pnpm --filter @uniwork/ui test && pnpm --filter @uniwork/ui typecheck && pnpm --filter @uniwork/web typecheck` → PASS. Chạy `make web` và mở `/login` để xác nhận font Inter nạp (kiểm tra devtools computed font-family).

- [ ] **Step 7: Commit** — `git add -A packages/ui apps/web pnpm-lock.yaml && git commit -m "feat(ui): role text scale, fonts, onboarding primitives, toaster"`

### Task 8: `packages/core` — types, paths, auth session user, organizations/workspaces hooks, onboarding store

**Files:**
- Modify: `packages/core/types/index.ts`, `packages/core/auth/hooks.ts`, `packages/core/workspaces/hooks.ts`, `packages/core/package.json` (exports), `packages/core/index.ts`
- Create: `packages/core/config.ts`, `packages/core/paths/{paths,resolve,index}.ts`, `packages/core/paths/resolve.test.ts`, `packages/core/organizations/hooks.ts`, `packages/core/onboarding/{types,step-order,store,welcome-store,hooks,index}.ts`, `packages/core/onboarding/store.test.ts`

**Interfaces:**
- Produces types: `User` (+ `onboarded_at: string|null`, `onboarding_questionnaire: Record<string,unknown>`), `Organization {id, slug, name, role?}`, `Workspace` (+ `organization_id, organization_slug, organization_name`), `PendingInvitation`.
- `paths`: `paths.login()`, `.register()`, `.onboarding()`, `.newWorkspace()`, `.invitations()`, `.workspaces()`, `.invite(token)`, `paths.workspace(orgSlug, wsSlug)` → `{ root(), tasks(), task(id), meetings(), meeting(id), room(id), members() }`; `resolvePostAuthDestination(workspaces: Workspace[], hasOnboarded: boolean): string`; `useHasOnboarded(): boolean`; `isReservedSlug(slug): boolean`; `sanitizeNextUrl(raw: string|null|undefined): string|null` (chỉ chấp nhận path bắt đầu `/` và không `//`).
- `auth`: `setSessionUser(user: User): void` (cập nhật cache + notify `useSession`).
- `config`: `appHost(): string` (host của `NEXT_PUBLIC_APP_URL`, mặc định `localhost:3000`).
- `organizations`: `useOrganizations()`, `useCreateOrganization()` (`{name, slug}` → `{organization}`), `useOrgWorkspaces(orgId)`, `useCreateWorkspaceInOrg()` (`{orgId, name, slug}` → `{workspace}`; onSuccess seed cache `["workspaces"]`).
- `workspaces`: `useWorkspaces()`, `useWorkspace(orgSlug, wsSlug)`, `useMembers`, `useInvite(workspaceId)` (`{emails: string[], role}` → `{invitations, skipped}`), `useAcceptInvite`, `useMyInvitations()`, `slugify`.
- `onboarding`: `Role`, `UseCase`, `QuestionnaireAnswers`, `OnboardingStep = "welcome"|"about_you"|"organization"|"workspace"|"invite"`, `OnboardingCompletionPath`, `ONBOARDING_STEP_ORDER`, `EMPTY_QUESTIONNAIRE`, `mergeQuestionnaire(raw)`, `saveQuestionnaire(a)`, `completeOnboarding(path, workspaceId?)`, `setWelcomeSignal(workspaceId)`, `dismissWelcome()`, `useWelcomeSignal(): {signal, dismissed}`, `useSeedWelcomeTask()` (mutation `workspaceId` → `{task}`).

- [ ] **Step 1: Tests**

`packages/core/paths/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isReservedSlug, paths, resolvePostAuthDestination, sanitizeNextUrl } from "./index";
import type { Workspace } from "../types";

const ws = (org: string, slug: string): Workspace => ({
  id: slug, slug, name: slug, organization_id: org, organization_slug: org, organization_name: org,
});

describe("resolvePostAuthDestination", () => {
  it("sends un-onboarded users to onboarding regardless of workspaces", () => {
    expect(resolvePostAuthDestination([ws("unicom", "alpha")], false)).toBe("/onboarding");
  });
  it("lands on the first workspace tasks", () => {
    expect(resolvePostAuthDestination([ws("unicom", "alpha"), ws("x", "y")], true)).toBe("/unicom/alpha/tasks");
  });
  it("onboarded with no workspace → new workspace", () => {
    expect(resolvePostAuthDestination([], true)).toBe("/workspaces/new");
  });
});

describe("paths", () => {
  it("builds workspace urls", () => {
    expect(paths.workspace("unicom", "alpha").task("T1")).toBe("/unicom/alpha/tasks/T1");
    expect(paths.workspace("unicom", "alpha").room("M1")).toBe("/unicom/alpha/meetings/M1/room");
  });
});

describe("sanitizeNextUrl", () => {
  it("accepts same-origin paths only", () => {
    expect(sanitizeNextUrl("/invite/abc")).toBe("/invite/abc");
    expect(sanitizeNextUrl("//evil.com")).toBeNull();
    expect(sanitizeNextUrl("https://evil.com")).toBeNull();
    expect(sanitizeNextUrl(null)).toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("knows generated list", () => {
    expect(isReservedSlug("login")).toBe(true);
    expect(isReservedSlug("acme")).toBe(false);
  });
});
```

`packages/core/onboarding/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_QUESTIONNAIRE, mergeQuestionnaire } from "./types";
import { ONBOARDING_STEP_ORDER } from "./step-order";

describe("mergeQuestionnaire", () => {
  it("pre-fills answers but resets skipped flags", () => {
    const m = mergeQuestionnaire({ role: "manager", role_skipped: true, use_case: "meetings", use_case_skipped: true });
    expect(m.role).toBe("manager");
    expect(m.role_skipped).toBe(false);
    expect(m.use_case).toEqual(["meetings"]);
    expect(m.use_case_skipped).toBe(false);
  });
  it("handles empty", () => {
    expect(mergeQuestionnaire({})).toEqual(EMPTY_QUESTIONNAIRE);
  });
});

describe("step order", () => {
  it("excludes welcome and ends with invite", () => {
    expect(ONBOARDING_STEP_ORDER).toEqual(["about_you", "organization", "workspace", "invite"]);
  });
});
```

- [ ] **Step 2: Chạy, fail** — Run: `pnpm --filter @uniwork/core test` → FAIL (module không tồn tại).

- [ ] **Step 3: Implement**

`packages/core/types/index.ts` — sửa/thêm:

```ts
export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().optional().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).optional().default({}),
});

export const OrganizationSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), role: z.string().optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(),
  organization_id: z.string(), organization_slug: z.string(), organization_name: z.string(),
});

export const PendingInvitationSchema = z.object({
  id: z.string(), role: z.string(), token: z.string(), expires_at: z.string(),
  workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  invited_by: z.object({ display_name: z.string() }),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

export const TaskKindSchema = z.enum(["normal", "welcome"]);
// TaskSchema thêm: kind: TaskKindSchema.optional().default("normal"),
```
(`toTaskDTO` server thêm `Kind string json:"kind"` — làm ở bước này trong `server/internal/handler/task.go` để FE có `kind`; 1 dòng: `Kind: t.Kind`.)

`packages/core/config.ts`:

```ts
export function appHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").host;
  } catch {
    return "localhost:3000";
  }
}
```

`packages/core/paths/paths.ts`:

```ts
export const paths = {
  root: () => "/",
  login: () => "/login",
  register: () => "/register",
  onboarding: () => "/onboarding",
  newWorkspace: () => "/workspaces/new",
  invitations: () => "/invitations",
  workspaces: () => "/workspaces",
  invite: (token: string) => `/invite/${token}`,
  workspace: (orgSlug: string, wsSlug: string) => {
    const base = `/${orgSlug}/${wsSlug}`;
    return {
      root: () => base,
      tasks: () => `${base}/tasks`,
      task: (id: string) => `${base}/tasks/${id}`,
      meetings: () => `${base}/meetings`,
      meeting: (id: string) => `${base}/meetings/${id}`,
      room: (id: string) => `${base}/meetings/${id}/room`,
      members: () => `${base}/members`,
    };
  },
};

/** Chỉ cho phép path cùng origin: bắt đầu bằng "/" và không phải "//". */
export function sanitizeNextUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
```

`packages/core/paths/resolve.ts`:

```ts
"use client";
import { useSession } from "../auth/hooks";
import type { Workspace } from "../types";
import { paths } from "./paths";
import { RESERVED_SLUGS } from "./reserved-slugs";

/**
 * Ưu tiên onboarded-first: `onboarded_at != null` là nguồn sự thật duy nhất
 * cho việc được vào /{org}/{ws}/* — không suy từ số workspace.
 */
export function resolvePostAuthDestination(workspaces: Workspace[], hasOnboarded: boolean): string {
  if (!hasOnboarded) return paths.onboarding();
  const first = workspaces[0];
  if (first) return paths.workspace(first.organization_slug, first.slug).tasks();
  return paths.newWorkspace();
}

export function useHasOnboarded(): boolean {
  const { user } = useSession();
  return user?.onboarded_at != null;
}

const reserved = new Set<string>(RESERVED_SLUGS);
export function isReservedSlug(slug: string): boolean {
  return reserved.has(slug);
}
```

`packages/core/paths/index.ts`: `export * from "./paths"; export * from "./resolve"; export { RESERVED_SLUGS } from "./reserved-slugs";`

`packages/core/auth/hooks.ts` — thêm sau `cachedUser`:

```ts
const userListeners = new Set<() => void>();

/** Cập nhật user trong cache session (sau PATCH onboarding/complete) và báo mọi useSession. */
export function setSessionUser(user: User) {
  cachedUser = user;
  userListeners.forEach((fn) => fn());
}
```
Trong `useSession` effect, đăng ký thêm: `userListeners.add(onUser)` với `onUser = () => { if (!cancelled && cachedUser) setState({ user: cachedUser, status: "authed" }); }` và gỡ ở cleanup. `useLogin`/`useRegister` onSuccess gọi `setSessionUser(sess.user)`.

`packages/core/organizations/hooks.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { OrganizationSchema, WorkspaceSchema, type Workspace } from "../types";

const OrgsResponse = z.object({ organizations: z.array(OrganizationSchema) });
const OrgResponse = z.object({ organization: OrganizationSchema });
const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });

export function useOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.request("/api/v1/orgs", { schema: OrgsResponse }),
    select: (d) => d.organizations,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      api.request("/api/v1/orgs", { method: "POST", body, schema: OrgResponse }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useOrgWorkspaces(orgId: string) {
  return useQuery({
    queryKey: ["org-workspaces", orgId],
    queryFn: () => api.request(`/api/v1/orgs/${orgId}/workspaces`, { schema: WorkspacesResponse }),
    select: (d) => d.workspaces,
    enabled: !!orgId,
  });
}

export function useCreateWorkspaceInOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, name, slug }: { orgId: string; name: string; slug: string }) =>
      api.request(`/api/v1/orgs/${orgId}/workspaces`, { method: "POST", body: { name, slug }, schema: WorkspaceResponse }),
    // Seed cache TRƯỚC khi caller navigate để layout [orgSlug]/[workspaceSlug]
    // resolve ngay, không nháy.
    onSuccess: (d) => {
      qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) => ({
        workspaces: [...(old?.workspaces ?? []), d.workspace],
      }));
      qc.setQueryData(["workspace", d.workspace.organization_slug, d.workspace.slug], d);
      void qc.invalidateQueries({ queryKey: ["org-workspaces", d.workspace.organization_id] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}
```

`packages/core/workspaces/hooks.ts` — sửa:
- `useWorkspace(orgSlug: string, wsSlug: string)`: queryKey `["workspace", orgSlug, wsSlug]`, path `/api/v1/orgs/${orgSlug}/workspaces/${wsSlug}`, `enabled: !!orgSlug && !!wsSlug`.
- Xoá `useCreateWorkspace` (thay bằng `useCreateWorkspaceInOrg`).
- `useInvite(workspaceId)`: `mutationFn: ({emails, role}: {emails: string[]; role: "admin"|"member"}) => api.request(..., {method:"POST", body:{emails, role}, schema: InviteResponse})` với `InviteResponse = z.object({ invitations: z.array(z.object({id, email, role, token})), skipped: z.array(z.string()) })`.
- Thêm:

```ts
const MyInvitationsResponse = z.object({ invitations: z.array(PendingInvitationSchema) });
export function useMyInvitations(enabled = true) {
  return useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => api.request("/api/v1/me/invitations", { schema: MyInvitationsResponse }),
    select: (d) => d.invitations,
    enabled,
  });
}
export function fetchMyInvitations() {
  return api.request("/api/v1/me/invitations", { schema: MyInvitationsResponse }).then((d) => d.invitations);
}
```

`packages/core/onboarding/types.ts`:

```ts
export type Role = "engineer" | "manager" | "product" | "ops" | "sales" | "hr" | "student" | "other";
export type UseCase = "team_tasks" | "meetings" | "personal_tasks" | "project_tracking" | "other";
export type OnboardingStep = "welcome" | "about_you" | "organization" | "workspace" | "invite";
export type OnboardingCompletionPath = "full" | "invite_skipped" | "skip_existing" | "invite_accept";

export interface QuestionnaireAnswers {
  version: 1;
  role: Role | null;
  role_other: string;
  role_skipped: boolean;
  use_case: UseCase[];
  use_case_other: string;
  use_case_skipped: boolean;
}

export const EMPTY_QUESTIONNAIRE: QuestionnaireAnswers = {
  version: 1, role: null, role_other: "", role_skipped: false,
  use_case: [], use_case_other: "", use_case_skipped: false,
};

function toArray<T extends string>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x): x is T => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.length > 0) return [v as T];
  return [];
}

/** Điền lại câu trả lời đã lưu; *_skipped luôn reset để lần này có thể trả lời. */
export function mergeQuestionnaire(raw: Record<string, unknown>): QuestionnaireAnswers {
  return {
    ...EMPTY_QUESTIONNAIRE,
    role: typeof raw.role === "string" ? (raw.role as Role) : null,
    role_other: typeof raw.role_other === "string" ? raw.role_other : "",
    use_case: toArray<UseCase>(raw.use_case),
    use_case_other: typeof raw.use_case_other === "string" ? raw.use_case_other : "",
  };
}
```

`packages/core/onboarding/step-order.ts`:

```ts
import type { OnboardingStep } from "./types";
/** Welcome cố ý không nằm đây — là intro sản phẩm, không phải tiến độ. */
export const ONBOARDING_STEP_ORDER: readonly Exclude<OnboardingStep, "welcome">[] =
  ["about_you", "organization", "workspace", "invite"] as const;
```

`packages/core/onboarding/store.ts`:

```ts
import { z } from "zod";
import * as api from "../api/client";
import { setSessionUser } from "../auth/hooks";
import { UserSchema } from "../types";
import type { OnboardingCompletionPath, QuestionnaireAnswers } from "./types";

const UserResponse = z.object({ user: UserSchema });

export async function saveQuestionnaire(answers: QuestionnaireAnswers): Promise<void> {
  const d = await api.request("/api/v1/me/onboarding", {
    method: "PATCH", body: { questionnaire: answers }, schema: UserResponse,
  });
  setSessionUser(d.user);
}

/** Cơ chế DUY NHẤT phía FE làm `onboarded_at` chuyển từ null → có giá trị. */
export async function completeOnboarding(path: OnboardingCompletionPath, workspaceId?: string): Promise<void> {
  const d = await api.request("/api/v1/me/onboarding/complete", {
    method: "POST", body: { completion_path: path, workspace_id: workspaceId }, schema: UserResponse,
  });
  setSessionUser(d.user);
}
```

`packages/core/onboarding/welcome-store.ts` (transient, không persist; subscribe để sống qua StrictMode double-mount):

```ts
"use client";
import { useSyncExternalStore } from "react";

interface WelcomeState { signal: { workspaceId: string } | null; dismissed: boolean }
let state: WelcomeState = { signal: null, dismissed: false };
const listeners = new Set<() => void>();
function emit() { listeners.forEach((fn) => fn()); }

export function setWelcomeSignal(workspaceId: string) { state = { signal: { workspaceId }, dismissed: false }; emit(); }
export function dismissWelcome() { state = { ...state, dismissed: true }; emit(); }
export function resetWelcome() { state = { signal: null, dismissed: false }; emit(); }

export function useWelcomeSignal(): WelcomeState {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
    () => state,
  );
}
```

`packages/core/onboarding/hooks.ts`:

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { TaskSchema } from "../types";

const TaskResponse = z.object({ task: TaskSchema });

export function useSeedWelcomeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api.request(`/api/v1/workspaces/${workspaceId}/welcome-task`, { method: "POST", schema: TaskResponse }),
    onSuccess: (d) => qc.invalidateQueries({ queryKey: ["tasks", d.task.workspace_id] }),
  });
}
```

`packages/core/onboarding/index.ts`: export tất cả từ `types`, `step-order`, `store`, `welcome-store`, `hooks`.

`packages/core/package.json` exports thêm: `"./paths": "./paths/index.ts"`, `"./organizations": "./organizations/hooks.ts"`, `"./onboarding": "./onboarding/index.ts"`, `"./config": "./config.ts"`.

- [ ] **Step 4: Test + typecheck** — Run: `pnpm --filter @uniwork/core test && pnpm --filter @uniwork/core typecheck` → PASS. (`@uniwork/views`/`web` sẽ lỗi typecheck do `useCreateWorkspace`/`useWorkspace(slug)` đổi — sửa ở Task 14/18; tạm thời chấp nhận.)

- [ ] **Step 5: Commit** — `git add packages/core server/internal/handler/task.go && git commit -m "feat(core): paths, organizations, onboarding stores, session user updates"`

### Task 9: i18n keys + slug helpers views

**Files:**
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`
- Create: `packages/views/workspace/slug.ts`, `packages/views/workspace/celestial-names.ts`, `packages/views/workspace/slug.test.ts`

**Interfaces:**
- Produces: `nameToSlug(name): string` (dùng `slugify` của core; CJK/emoji-only → `""`), `SLUG_REGEX`, `randomWorkspaceIdentity(random?: () => number): {name, slug}`, `isSlugConflict(err): boolean`, `slugClientError(slug, t): string|null` (format/reserved).
- i18n key groups (đầy đủ bên dưới) — mọi task sau dùng đúng key này.

- [ ] **Step 1: Test slug helpers**

`packages/views/workspace/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { isSlugConflict, nameToSlug, randomWorkspaceIdentity, SLUG_REGEX } from "./slug";

describe("slug helpers", () => {
  it("nameToSlug strips diacritics, returns empty for CJK/emoji", () => {
    expect(nameToSlug("Đội Alpha 1")).toBe("doi-alpha-1");
    expect(nameToSlug("日本語")).toBe("");
    expect(nameToSlug("🎉")).toBe("");
  });
  it("random identity has valid slug with 4-char suffix", () => {
    const id = randomWorkspaceIdentity(() => 0.5);
    expect(id.name.length).toBeGreaterThan(0);
    expect(SLUG_REGEX.test(id.slug)).toBe(true);
    expect(id.slug).toMatch(/-[a-z0-9]{4}$/);
  });
  it("isSlugConflict keys on 409", () => {
    expect(isSlugConflict(new ApiError("x", "conflict", 409))).toBe(true);
    expect(isSlugConflict(new ApiError("x", "internal", 500))).toBe(false);
    expect(isSlugConflict(new Error("x"))).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, fail** — `pnpm --filter @uniwork/views test -- slug` → FAIL.

- [ ] **Step 3: Implement**

`packages/views/workspace/celestial-names.ts`:

```ts
/** Tên thiên thể tiếng Việt + slugBase EN ổn định cho nút "Ngẫu nhiên". */
export const CELESTIAL_NAMES: readonly { name: string; slugBase: string }[] = [
  { name: "Sao Thủy", slugBase: "mercury" }, { name: "Sao Kim", slugBase: "venus" },
  { name: "Trái Đất", slugBase: "earth" }, { name: "Sao Hỏa", slugBase: "mars" },
  { name: "Sao Mộc", slugBase: "jupiter" }, { name: "Sao Thổ", slugBase: "saturn" },
  { name: "Thiên Vương", slugBase: "uranus" }, { name: "Hải Vương", slugBase: "neptune" },
  { name: "Mặt Trăng", slugBase: "luna" }, { name: "Sao Bắc Cực", slugBase: "polaris" },
  { name: "Thiên Lang", slugBase: "sirius" }, { name: "Chức Nữ", slugBase: "vega" },
  { name: "Ngưu Lang", slugBase: "altair" }, { name: "Tiên Nữ", slugBase: "andromeda" },
  { name: "Lạp Hộ", slugBase: "orion" }, { name: "Thiên Hà", slugBase: "galaxy" },
];
```

`packages/views/workspace/slug.ts`:

```ts
import { ApiError } from "@uniwork/core/api";
import { slugify } from "@uniwork/core/workspaces";
import { CELESTIAL_NAMES } from "./celestial-names";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Trả "" khi tên không sinh được ký tự hợp lệ (CJK/emoji) — người dùng tự gõ slug. */
export function nameToSlug(name: string): string {
  return slugify(name);
}

export function randomWorkspaceIdentity(random: () => number = Math.random): { name: string; slug: string } {
  const c = CELESTIAL_NAMES[Math.floor(random() * CELESTIAL_NAMES.length)]!;
  let suffix = "";
  for (let i = 0; i < 4; i += 1) suffix += SUFFIX_ALPHABET[Math.floor(random() * SUFFIX_ALPHABET.length)];
  return { name: c.name, slug: `${c.slugBase}-${suffix}` };
}

export function isSlugConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
```

`packages/core/i18n/locales/vi.json` — thêm/mở rộng các nhóm (giữ key cũ):

```json
{
  "common": { "...": "giữ nguyên", "back": "Quay lại", "continue": "Tiếp tục", "skip": "Bỏ qua", "copy": "Sao chép", "copied": "Đã sao chép", "retry": "Thử lại", "later": "Để sau", "done": "Xong" },
  "workspace": {
    "...": "giữ nguyên",
    "new": "Workspace mới",
    "pickTitle": "Chọn workspace",
    "inviteEmails": "Email đồng nghiệp",
    "inviteHint": "Nhập email, cách nhau bằng dấu phẩy hoặc Enter",
    "invalidEmail": "Email không hợp lệ: {{email}}",
    "inviteSent": "Đã tạo {{count}} lời mời",
    "inviteSkipped": "Bỏ qua (đã là thành viên hoặc không hợp lệ): {{list}}",
    "orgRole": "Vai trò tổ chức",
    "guideBadge": "Hướng dẫn"
  },
  "org": { "name": "Tên tổ chức", "slug": "Định danh tổ chức", "create": "Tạo tổ chức", "switch": "Chuyển workspace" },
  "invitations": {
    "title": "Bạn có lời mời",
    "subtitle": "Tham gia để bắt đầu làm việc cùng đồng nghiệp.",
    "invitedBy": "{{name}} mời bạn vào",
    "join": "Tham gia",
    "joinAll": "Tham gia tất cả",
    "empty": "Không có lời mời nào",
    "role": "với vai trò {{role}}"
  },
  "onboarding": {
    "step_nav": {
      "wordmark": "UniWork",
      "label": "Các bước khởi đầu",
      "about_you": { "label": "Về bạn", "description": "Vai trò và điều bạn muốn làm." },
      "organization": { "label": "Tổ chức", "description": "Công ty hoặc đội nhóm của bạn." },
      "workspace": { "label": "Workspace", "description": "Đặt tên và chọn đường dẫn." },
      "invite": { "label": "Mời đồng nghiệp", "description": "Đưa cả đội vào cùng làm." }
    },
    "common": { "log_out": "Đăng xuất" },
    "welcome": {
      "wordmark": "UniWork",
      "headline_line1": "Công việc và cuộc họp của cả đội,",
      "headline_line2": "trong",
      "headline_emphasis": "một không gian.",
      "lede": "Giao việc, kéo thẻ qua bảng, họp video ngay trong workspace — mọi người thấy cùng một bức tranh.",
      "lede_secondary": "Vài phút nữa bạn sẽ có tổ chức, workspace đầu tiên và đồng nghiệp được mời vào.",
      "start": "Bắt đầu",
      "skip_existing": "Tôi đã dùng rồi",
      "illustration_caption": "Một buổi sáng của đội bạn trên UniWork.",
      "illustration": {
        "card1_actor": "Lan", "card1_initial": "L", "card1_ref": "UW-42",
        "card1_prefix": "", "card1_mention": "@Minh", "card1_body": " xem giúp bản nháp đề xuất trước 3h nhé.",
        "card2_actor": "Minh", "card2_initial": "M", "card2_ref": "UW-42",
        "card2_body": "Đã sửa phần ngân sách, chuyển sang Đang làm.",
        "card2_status": "Đang làm",
        "card3_actor": "Cuộc họp", "card3_ref": "14:00",
        "card3_body": "Sync tuần · phòng video sẵn sàng trước 5 phút.",
        "card3_status": "Sắp diễn ra",
        "card4_actor": "Hà", "card4_initial": "H", "card4_ref": "UW-38",
        "card4_body": "Hoàn thành onboarding khách hàng mới.",
        "card4_status": "Hoàn thành", "card4_timestamp": "10 phút trước",
        "card5_actor": "Minh", "card5_initial": "M", "card5_ref": "UW-42",
        "card5_prefix": "Xong rồi ", "card5_mention": "@Lan", "card5_body": " — mời bạn duyệt."
      }
    },
    "questions": {
      "about_you": { "question": "Cho chúng tôi biết đôi chút về bạn." },
      "role": {
        "question": "Bạn làm vai trò gì?",
        "engineer": "Kỹ sư / phát triển", "manager": "Quản lý", "product": "Sản phẩm", "ops": "Vận hành",
        "sales": "Kinh doanh", "hr": "Nhân sự", "student": "Sinh viên", "other": "Khác",
        "other_placeholder": "Vai trò của bạn"
      },
      "use_case": {
        "question": "Bạn muốn dùng UniWork để làm gì?",
        "team_tasks": "Quản lý công việc nhóm", "meetings": "Họp trực tuyến", "personal_tasks": "Việc cá nhân",
        "project_tracking": "Theo dõi dự án", "other": "Khác",
        "other_placeholder": "Mục đích khác"
      }
    },
    "step_question": {
      "hint_pick": "Chọn một mục để tiếp tục — hoặc bỏ qua nếu bạn không muốn trả lời.",
      "hint_continue": "Ổn rồi. Nhấn Tiếp tục khi bạn sẵn sàng."
    },
    "step_organization": {
      "headline_first": "Đặt tên tổ chức của bạn.",
      "headline_resume": "Tiếp tục với {{name}}, hoặc tạo tổ chức khác.",
      "lede_first": "Tổ chức là công ty hoặc đội nhóm; mọi workspace nằm trong đó. Bạn có thể tạo thêm sau.",
      "lede_resume": "Chọn tổ chức bạn đã thuộc, hoặc tạo tổ chức mới.",
      "name_label": "Tên tổ chức",
      "name_placeholder": "Unicom, Đội Marketing, Lớp 12A…",
      "url_label": "Đường dẫn",
      "slug_placeholder": "unicom",
      "create_new_title": "Tạo tổ chức mới",
      "create_new_subtitle": "Bắt đầu một tổ chức riêng",
      "hint_pick": "Chọn tổ chức hoặc tạo mới.",
      "hint_name_first": "Đặt tên tổ chức để tạo.",
      "hint_creating": "Sẽ tạo {{name}}.",
      "hint_creating_pending": "Đang tạo {{name}}…",
      "hint_opening": "Tiếp tục với {{name}}.",
      "cta_create": "Tạo tổ chức",
      "cta_create_named": "Tạo {{name}}",
      "cta_creating": "Đang tạo…",
      "cta_open": "Tiếp tục với {{name}}",
      "slug_taken_error": "Định danh tổ chức này đã có người dùng.",
      "slug_conflict_toast": "Hãy chọn định danh tổ chức khác"
    },
    "step_workspace": {
      "headline_first": "Đặt tên workspace.",
      "headline_resume": "Tiếp tục với {{name}}, hoặc tạo workspace khác.",
      "lede_first": "Workspace là nơi công việc và cuộc họp của một đội sống. Bạn có thể mời đồng nghiệp hoặc tạo thêm workspace sau.",
      "lede_resume": "Tiếp tục với workspace bạn đã tạo, hoặc tạo cái mới.",
      "name_label": "Tên workspace",
      "name_placeholder": "Đội sản phẩm, Dự án Alpha, Việc riêng…",
      "random_name": "Ngẫu nhiên",
      "url_label": "Đường dẫn",
      "slug_placeholder": "doi-san-pham",
      "url_preview_label": "Đường dẫn workspace",
      "url_preview_prefix": "Đội bạn sẽ mở workspace tại ",
      "url_preview_suffix": ".",
      "create_new_title": "Tạo workspace mới",
      "create_new_subtitle": "Bắt đầu một workspace trống",
      "hint_pick": "Chọn workspace hoặc tạo mới.",
      "hint_name_first": "Đặt tên workspace để tạo.",
      "hint_creating": "Sẽ tạo {{name}}.",
      "hint_creating_pending": "Đang tạo {{name}}…",
      "hint_creating_fallback": "workspace",
      "hint_opening": "Mở {{name}}.",
      "cta_create_workspace": "Tạo workspace",
      "cta_create_named": "Tạo {{name}}",
      "cta_creating": "Đang tạo…",
      "cta_open": "Mở {{name}}",
      "slug_format_error": "Chỉ dùng chữ thường, số và dấu gạch ngang",
      "slug_reserved_error": "Định danh này được hệ thống dành riêng",
      "slug_taken_error": "Định danh này đã có người dùng.",
      "slug_conflict_toast": "Hãy chọn định danh khác",
      "create_failed_toast": "Không tạo được. Vui lòng thử lại."
    },
    "step_invite": {
      "headline": "Mời đồng nghiệp vào {{workspace}}.",
      "lede": "Nhập email của những người sẽ làm việc cùng bạn. Họ nhận link mời và vào thẳng workspace.",
      "emails_label": "Email đồng nghiệp",
      "role_label": "Vai trò",
      "role_member": "Thành viên",
      "role_admin": "Quản trị",
      "send": "Gửi lời mời",
      "sending": "Đang gửi…",
      "sent_title": "Đã tạo {{count}} lời mời",
      "sent_hint": "Gửi link cho từng người (email tự động sẽ có trong đợt sau).",
      "skipped_note": "Bỏ qua {{count}} email (đã là thành viên hoặc không hợp lệ).",
      "hint_empty": "Thêm ít nhất một email — hoặc bỏ qua, mời sau ở trang Thành viên.",
      "hint_ready": "Sẵn sàng gửi {{count}} lời mời.",
      "hint_done": "Bạn có thể thêm đợt nữa, hoặc hoàn tất.",
      "finish": "Hoàn tất",
      "skip": "Bỏ qua, mời sau",
      "send_failed": "Không gửi được lời mời"
    },
    "welcome_after_onboarding": {
      "loading": "Đang chuẩn bị workspace của bạn…",
      "title": "Chào mừng đến UniWork!",
      "subtitle": "Chúng tôi đã thêm một task hướng dẫn để bạn bắt đầu.",
      "got_it": "Đã hiểu",
      "status_in_progress": "Đang làm",
      "card_title": "Bắt đầu với UniWork",
      "card_subtitle": "Tạo việc, kéo qua bảng, lên lịch họp — trong 5 phút.",
      "error_title": "Chưa chuẩn bị được workspace",
      "error_body": "Task hướng dẫn chưa được tạo. Bạn có thể thử lại, hoặc để sau.",
      "retry": "Thử lại",
      "dismiss": "Để sau"
    },
    "errors": {
      "save_failed": "Không lưu được câu trả lời",
      "skip_failed": "Không thể hoàn tất phần khởi đầu",
      "complete_failed": "Không thể hoàn tất. Vui lòng thử lại."
    }
  }
}
```
(`"...": "giữ nguyên"` là ghi chú — không đưa vào file; giữ key hiện có.) `en.json` giữ `{}` (fallback vi).

- [ ] **Step 4: Chạy test** — `pnpm --filter @uniwork/views test -- slug` → PASS.

- [ ] **Step 5: Commit** — `git add packages/views/workspace packages/core/i18n && git commit -m "feat: onboarding i18n copy and slug helpers"`

---

## Phase C — Views onboarding

Mọi file trong `packages/views/onboarding/**` dùng `useTranslation()` từ `react-i18next` với key `onboarding.*` (Task 9). `packages/views/package.json` exports thêm `"./onboarding/*": "./onboarding/*.tsx"`.

### Task 10: Shell — StepShell, StepSidebar (rail), StepProgressBar, option cards, logout button

**Files:**
- Create: `packages/views/onboarding/components/step-shell.tsx`, `step-sidebar.tsx`, `option-card.tsx`, `icon-option-card.tsx`, `onboarding-logout-button.tsx`
- Test: `packages/views/onboarding/components/step-sidebar.test.tsx`

**Interfaces:**
- Produces: `STEP_COLUMN`, `STEP_GUTTER`, `StepHeading({title, description?})`, `StepFooter({hint?, children})`, `StepShell({currentStep, onBack?, backDisabled?, onStepChange?, chromeFooter?, children})`, `StepSidebar`, `StepProgressBar`, `RadioMark({selected})`, `IconOptionCard`, `IconOtherOptionCard`, `OnboardingLogoutButton({inline?})`.

- [ ] **Step 1: Test rail**

`packages/views/onboarding/components/step-sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { StepSidebar } from "./step-sidebar";

initI18n();

describe("StepSidebar", () => {
  it("marks current step, lets only completed steps be clicked", () => {
    const onStepChange = vi.fn();
    render(<StepSidebar currentStep="workspace" onStepChange={onStepChange} />);
    const current = screen.getByText("Workspace").closest('[aria-current="step"]');
    expect(current).not.toBeNull();
    // "Về bạn" và "Tổ chức" đã xong → là button
    expect(screen.getByRole("button", { name: /Về bạn/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tổ chức/ })).toBeInTheDocument();
    // bước sau ("Mời đồng nghiệp") không phải button
    expect(screen.queryByRole("button", { name: /Mời đồng nghiệp/ })).toBeNull();
    screen.getByRole("button", { name: /Về bạn/ }).click();
    expect(onStepChange).toHaveBeenCalledWith("about_you");
  });
  it("locks rail when backDisabled", () => {
    render(<StepSidebar currentStep="workspace" onStepChange={() => {}} backDisabled />);
    expect(screen.queryByRole("button", { name: /Về bạn/ })).toBeNull();
  });
});
```

jsdom không có canvas: trong `packages/views/test/setup.ts` thêm mock `HTMLCanvasElement.prototype.getContext = () => null as never;` (DotSphere phải chịu được `getContext` trả null — kiểm tra file port, thêm `if (!ctx) return;`).

- [ ] **Step 2: Chạy, fail** — `pnpm --filter @uniwork/views test -- step-sidebar` → FAIL.

- [ ] **Step 3: Implement**

`packages/views/onboarding/components/option-card.tsx`:

```tsx
"use client";
import { cn } from "@uniwork/ui/lib/utils";

export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden className={cn(
      "relative inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] transition-colors",
      selected ? "border-primary" : "border-line-strong")}>
      {selected && <span className="absolute inset-[3px] rounded-full bg-primary" />}
    </span>
  );
}

/** Card chọn có viền đậm khi chọn (dùng cho org/workspace có sẵn, tạo mới). */
export const pickerCardClass = (selected: boolean) =>
  cn("w-full rounded-lg border bg-surface text-left transition-all",
    selected ? "border-primary shadow-[inset_0_0_0_1px_var(--uw-text-primary)]" : "border-line hover:border-line-strong hover:bg-subtle/60");
```

`packages/views/onboarding/components/icon-option-card.tsx` — port từ usf (`icon-option-card.tsx:42-150`) với đổi: `Button variant="outline" size="lg"`, class chọn `"border-brand/40 bg-brand/5"`, icon `text-secondary` / chọn `text-brand`, input inline `placeholder:text-tertiary`. Giữ nguyên props và hành vi (Enter với text non-empty → `onConfirm`, `maxLength=80`, `autoFocus`, `role={mode}`, `aria-checked`). Export `QuestionOption`.

`packages/views/onboarding/components/onboarding-logout-button.tsx`:

```tsx
"use client";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export function OnboardingLogoutButton({ inline = false }: { inline?: boolean } = {}) {
  const { t } = useTranslation();
  const logout = useLogout();
  return (
    <Button variant="ghost" size="sm"
      className={cn(inline ? "-ml-2 w-fit shrink-0 text-secondary hover:text-primary"
                           : "fixed right-8 top-8 z-50 text-secondary hover:text-danger")}
      onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.assign("/login") })}>
      <LogOut className="size-4" />
      {t("onboarding.common.log_out")}
    </Button>
  );
}
```

`packages/views/onboarding/components/step-sidebar.tsx` — port `../usf/.../step-sidebar.tsx` với:
- import `ONBOARDING_STEP_ORDER, type OnboardingStep` từ `@uniwork/core/onboarding`; `DotSphere`, `Stepper*` từ `@uniwork/ui/components/ui/*`; bỏ `MulticaIcon` → thay bằng `<span className="size-5 rounded-md bg-brand" aria-hidden />` + wordmark `t("onboarding.step_nav.wordmark")`; bỏ `WebkitAppRegion`.
- Panel: `<div className="dark relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl bg-canvas px-5 pb-5 text-primary ring-1 ring-line">` (scoping `.dark` trên panel để token đổi màu chỉ trong subtree — `tokens.css` `.dark` là class selector thường).
- Indicator: done `bg-primary text-inverse ring-primary`, current `text-transparent ring-secondary` + dot `bg-primary`, future `text-transparent ring-line`; separator `isDone ? "bg-secondary" : "bg-line"`.
- Rail rows: `canReturn = isDone && !!onStepChange && !backDisabled` → `<button type="button">` (chứa title text nên `getByRole("button", {name: /Về bạn/})` khớp), else `<div>`; `aria-current="step"` trên `StepperItem` hiện tại.
- Labels: `t(\`onboarding.step_nav.${stepId}.label\`)`, `.description`.
- `StepProgressBar` (md:hidden) giữ nguyên cấu trúc: back icon button (`size="icon-sm"`), N đoạn `h-1 flex-1 rounded-full` (`index <= currentIndex ? "bg-primary" : "bg-line"`), tên bước `text-caption font-medium text-secondary`, slot footer.

`packages/views/onboarding/components/step-shell.tsx` — port nguyên usf `step-shell.tsx` với đổi: bỏ `DragStrip`; root `"animate-onboarding-enter flex h-full min-h-0 flex-col bg-canvas"`; `StepHeading` h1 `"text-balance text-title-lg font-semibold text-primary"`, p `"text-pretty text-body text-secondary"`; `StepFooter` hint `"text-caption text-secondary"`; `useScrollFade` từ `@uniwork/ui/hooks/use-scroll-fade`. Giữ `STEP_COLUMN = "mx-auto flex min-h-full w-full max-w-[28rem] flex-col"`, `STEP_GUTTER = "px-6 py-8 sm:px-10 lg:px-14 lg:py-10"`.

- [ ] **Step 4: Test** — `pnpm --filter @uniwork/views test -- step-sidebar && pnpm --filter @uniwork/views typecheck` → PASS (typecheck có thể còn lỗi ở `workspace-picker-view`/`create-workspace-form` do Task 8 — bỏ qua tới Task 14/19).

- [ ] **Step 5: Commit** — `git add packages/views && git commit -m "feat(views): onboarding shell, progress rail and option cards"`

### Task 11: StepWelcome + WelcomeIllustration

**Files:**
- Create: `packages/views/onboarding/steps/step-welcome.tsx`, `packages/views/onboarding/steps/welcome-illustration.tsx`
- Test: `packages/views/onboarding/steps/step-welcome.test.tsx`

**Interfaces:**
- Produces: `StepWelcome({onNext: () => void|Promise<void>, onSkip?: () => void|Promise<void>})`.

- [ ] **Step 1: Test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { StepWelcome } from "./step-welcome";

initI18n();

describe("StepWelcome", () => {
  it("shows headline and start CTA; skip only when provided", () => {
    const onNext = vi.fn();
    const { rerender } = render(<StepWelcome onNext={onNext} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("một không gian.");
    expect(screen.queryByRole("button", { name: "Tôi đã dùng rồi" })).toBeNull();
    screen.getByRole("button", { name: /Bắt đầu/ }).click();
    expect(onNext).toHaveBeenCalled();
    rerender(<StepWelcome onNext={onNext} onSkip={() => {}} />);
    expect(screen.getByRole("button", { name: "Tôi đã dùng rồi" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fail** — `pnpm --filter @uniwork/views test -- step-welcome` → FAIL.

- [ ] **Step 3: Implement**

`packages/views/onboarding/steps/step-welcome.tsx` — port usf `step-welcome.tsx:38-151` với: bỏ `DragStrip`, `MulticaIcon` → `<span aria-hidden className="size-5 rounded-md bg-brand" />`; class: root `"animate-onboarding-enter flex h-full min-h-[640px] flex-col lg:flex-row"`; h1 `"text-balance font-serif text-5xl font-medium leading-[1.04] tracking-tight text-primary sm:text-6xl"` với `<em className="italic text-brand">`; lede `"text-title leading-relaxed text-primary"`, lede phụ `"text-body leading-relaxed text-secondary"`; CTA `<Button size="lg">` label `t("onboarding.welcome.start")` + `ArrowRight`, ghost `t("onboarding.welcome.skip_existing")`; per-button `Loader2` với `pending` state như usf. Cột phải `"hidden border-l border-line bg-subtle/40 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden"`, caption `"max-w-[440px] text-balance text-center font-serif text-body-lg italic leading-snug text-secondary"`, rồi `<WelcomeIllustration />`.

`packages/views/onboarding/steps/welcome-illustration.tsx` — 5 card nghiêng theo bố cục usf (`-translate-x-5 -rotate-[1.2deg]`, `translate-x-8 rotate-[1.6deg]`, `-translate-x-6 -rotate-[0.8deg]`, `translate-x-6 rotate-[1deg]`), nội dung từ `onboarding.welcome.illustration.*`:

```tsx
"use client";
import { CalendarDays, CircleCheck, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

type Status = "in_progress" | "done" | "upcoming";

export function WelcomeIllustration() {
  const { t } = useTranslation();
  const i = (k: string) => t(`onboarding.welcome.illustration.${k}`);
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      <MockCard actor={{ name: i("card1_actor"), initial: i("card1_initial") }} ref_={i("card1_ref")}
        content={<><Mention>{i("card1_mention")}</Mention>{i("card1_body")}</>} />
      <MockCard className="-translate-x-5 -rotate-[1.2deg]" actor={{ name: i("card2_actor"), initial: i("card2_initial") }}
        ref_={i("card2_ref")} content={i("card2_body")} status="in_progress" statusLabel={i("card2_status")} />
      <MockCard className="translate-x-8 rotate-[1.6deg]" actor={{ name: i("card3_actor"), icon: "meeting" }}
        ref_={i("card3_ref")} content={i("card3_body")} status="upcoming" statusLabel={i("card3_status")} />
      <MockCard className="-translate-x-6 -rotate-[0.8deg]" actor={{ name: i("card4_actor"), initial: i("card4_initial") }}
        ref_={i("card4_ref")} content={i("card4_body")} status="done" statusLabel={i("card4_status")} timestamp={i("card4_timestamp")} />
      <MockCard className="translate-x-6 rotate-[1deg]" actor={{ name: i("card5_actor"), initial: i("card5_initial") }}
        ref_={i("card5_ref")} content={<>{i("card5_prefix")}<Mention>{i("card5_mention")}</Mention>{i("card5_body")}</>} />
    </div>
  );
}

function MockCard({ actor, ref_, content, status, statusLabel, timestamp, className }: {
  actor: { name: string; initial?: string; icon?: "meeting" };
  ref_: string; content: React.ReactNode; status?: Status; statusLabel?: string; timestamp?: string; className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-4 py-3.5 shadow-sm",
      "transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:rotate-0 hover:shadow-md", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {actor.icon === "meeting" ? (
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full border border-line bg-subtle/40 text-primary"><CalendarDays className="size-3.5" /></span>
          ) : (
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-micro font-semibold text-inverse">{actor.initial}</span>
          )}
          <span className="truncate text-body font-medium text-primary">{actor.name}</span>
        </div>
        <span className="shrink-0 font-mono text-micro text-secondary">{ref_}</span>
      </div>
      <p className="mt-2.5 text-body leading-snug text-primary">{content}</p>
      {status && (
        <div className="mt-3 flex items-center gap-2 text-caption">
          <span className={cn("flex items-center gap-1.5 font-medium",
            status === "done" ? "text-success" : status === "in_progress" ? "text-warning" : "text-brand")}>
            {status === "done" ? <CircleCheck className="size-3.5" /> :
             status === "in_progress" ? <CircleDot className="size-3.5 animate-pulse" /> : <CalendarDays className="size-3.5" />}
            {statusLabel}
          </span>
          {timestamp && <><span className="text-secondary">·</span><span className="text-secondary">{timestamp}</span></>}
        </div>
      )}
    </div>
  );
}

function Mention({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-brand">{children}</span>;
}
```

- [ ] **Step 4: Test** — PASS. **Step 5: Commit** — `git commit -m "feat(views): onboarding welcome hero"`

### Task 12: StepAboutYou

**Files:** Create `packages/views/onboarding/steps/step-about-you.tsx`, test `step-about-you.test.tsx`.

**Interfaces:** `StepAboutYou({answers, onChange(patch), onAdvance, onSkip})`.

- [ ] **Step 1: Test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EMPTY_QUESTIONNAIRE } from "@uniwork/core/onboarding";
import { StepAboutYou } from "./step-about-you";

initI18n();

describe("StepAboutYou", () => {
  it("disables continue until a group is answered; stamps skipped groups on continue", () => {
    const onChange = vi.fn();
    const onAdvance = vi.fn();
    const { rerender } = render(
      <StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={onChange} onAdvance={onAdvance} onSkip={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
    screen.getByRole("radio", { name: "Quản lý" }).click();
    expect(onChange).toHaveBeenCalledWith({ role: "manager", role_other: "", role_skipped: false });
    rerender(<StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, role: "manager" }} onChange={onChange} onAdvance={onAdvance} onSkip={() => {}} />);
    screen.getByRole("button", { name: "Tiếp tục" }).click();
    expect(onChange).toHaveBeenLastCalledWith({ use_case: [], use_case_other: "", use_case_skipped: true });
    expect(onAdvance).toHaveBeenCalled();
  });
  it("skip stamps both groups", () => {
    const onChange = vi.fn();
    const onSkip = vi.fn();
    render(<StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={onChange} onAdvance={() => {}} onSkip={onSkip} />);
    screen.getByRole("button", { name: "Bỏ qua" }).click();
    expect(onChange).toHaveBeenCalledWith({ role: null, role_other: "", role_skipped: true, use_case: [], use_case_other: "", use_case_skipped: true });
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fail.** **Step 3: Implement** — port usf `step-about-you.tsx` nguyên logic (`roleAnswered`, `useCaseAnswered`, `canContinue`, `pickRole`, `toggleUseCase`, `confirmAdvance`, `handleSkip`, `QuestionGroup`) với:
- `role_other`/`use_case_other` là `string` (rỗng thay vì null): `pickRole(slug !== "other")` → `onChange({ role: slug, role_other: "", role_skipped: false })`; toggle bỏ "other" → `use_case_other: ""`.
- Options role: `engineer: Code2, manager: Users, product: Briefcase, ops: Settings2, sales: Handshake, hr: UserRound, student: GraduationCap, other: MoreHorizontal`; use case: `team_tasks: ListChecks, meetings: Video, personal_tasks: User, project_tracking: KanbanSquare, other: MoreHorizontal` (lucide-react).
- Copy: `t("onboarding.questions.about_you.question")`, `…role.question`, `…use_case.question`, hint `onboarding.step_question.hint_continue|hint_pick`, nút `common.continue`/`common.skip`.
- Layout: `<div className="flex flex-col gap-8 pt-2 sm:pt-6">` + `QuestionGroup` (`<section className="flex flex-col gap-3"><h2 className="text-label font-medium text-primary">` + `<fieldset role=… className="m-0 flex flex-row flex-wrap gap-2 border-0 p-0">`) + `StepFooter`.

- [ ] **Step 4: Test PASS. Step 5: Commit** — `git commit -m "feat(views): about-you questionnaire step"`

### Task 13: SlugField (form tên + slug dùng chung) + StepOrganization

**Files:**
- Create: `packages/views/onboarding/slug-field.tsx`, `packages/views/onboarding/steps/step-organization.tsx`
- Test: `packages/views/onboarding/slug-field.test.tsx`, `packages/views/onboarding/steps/step-organization.test.tsx`

**Interfaces:**
- `useSlugForm({ t, tKeyPrefix })` → `{ name, slug, setNameValue, setSlugValue, randomize, slugError, setServerError, canSubmit, reset }`; `slugError` gồm format/reserved (client) hoặc server.
- `SlugFields({ idPrefix, form, hostPrefix, nameLabel, namePlaceholder, urlLabel, slugPlaceholder, onEnter, disabled, autoFocus, withRandom, preview? })` — render 2 `Field` (tên [+ Random], pill URL) + `FieldError`, optional preview `Field` (FieldTitle + FieldDescription).
- `StepOrganization({ organizations: Organization[], selected: Organization|null, onSelected(org), onBusyChange? })` — `organizations` = org user đã thuộc (resume); tạo mới qua `useCreateOrganization`.

- [ ] **Step 1: Tests**

`slug-field.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { SlugFields, useSlugForm } from "./slug-field";

initI18n();

function Harness() {
  const form = useSlugForm();
  return (
    <SlugFields idPrefix="x" form={form} hostPrefix="uniwork.app/" nameLabel="Tên" namePlaceholder="" urlLabel="Đường dẫn"
      slugPlaceholder="" onEnter={() => {}} withRandom />
  );
}

describe("SlugFields", () => {
  it("auto-slugs from name until slug is touched; validates format and reserved", () => {
    render(<Harness />);
    const name = screen.getByLabelText("Tên");
    const slug = screen.getByLabelText("Đường dẫn");
    fireEvent.change(name, { target: { value: "Đội Alpha" } });
    expect(slug).toHaveValue("doi-alpha");
    fireEvent.change(slug, { target: { value: "login" } });
    expect(screen.getByRole("alert")).toHaveTextContent("dành riêng");
    fireEvent.change(slug, { target: { value: "Bad Slug" } });
    expect(screen.getByRole("alert")).toHaveTextContent("chữ thường");
    fireEvent.change(name, { target: { value: "Khác" } });
    expect(slug).toHaveValue("Bad Slug"); // đã chạm slug → không auto nữa
  });
});
```

`step-organization.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { StepOrganization } from "./step-organization";

initI18n();
const requestMock = vi.fn();
vi.mock("@uniwork/core/api", async (orig) => ({ ...(await orig<typeof import("@uniwork/core/api")>()), request: (...a: unknown[]) => requestMock(...a) }));

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe("StepOrganization", () => {
  it("shows inline error on 409", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    render(wrap(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} />));
    fireEvent.change(screen.getByLabelText("Tên tổ chức"), { target: { value: "Unicom" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Unicom" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });
  it("resume: picking an existing org enables continue", () => {
    const onSelected = vi.fn();
    const org = { id: "o1", slug: "unicom", name: "Unicom", role: "owner" };
    render(wrap(<StepOrganization organizations={[org]} selected={null} onSelected={onSelected} />));
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Unicom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục với Unicom" }));
    expect(onSelected).toHaveBeenCalledWith(org);
  });
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement**

`packages/views/onboarding/slug-field.tsx`:

```tsx
"use client";
import { Dices } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isReservedSlug } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { nameToSlug, randomWorkspaceIdentity, SLUG_REGEX } from "../workspace/slug";

/** Enter khi đang gõ IME (tiếng Việt/CJK) không được submit. */
export function isImeComposing(e: KeyboardEvent<HTMLElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

export function useSlugForm() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const slugTouched = useRef(false); // ref: không re-render, chỉ là cờ

  const clientError =
    slug.length > 0 && !SLUG_REGEX.test(slug) ? t("onboarding.step_workspace.slug_format_error")
    : slug.length > 0 && isReservedSlug(slug) ? t("onboarding.step_workspace.slug_reserved_error")
    : null;
  const slugError = clientError ?? serverError;

  return {
    name, slug, slugError, setServerError,
    canSubmit: name.trim().length > 0 && slug.trim().length > 0 && !slugError,
    setNameValue: (v: string) => { setName(v); if (!slugTouched.current) { setSlug(nameToSlug(v)); setServerError(null); } },
    setSlugValue: (v: string) => { slugTouched.current = true; setSlug(v); setServerError(null); },
    randomize: () => { const id = randomWorkspaceIdentity(); slugTouched.current = true; setName(id.name); setSlug(id.slug); setServerError(null); },
    reset: () => { slugTouched.current = false; setName(""); setSlug(""); setServerError(null); },
  };
}
export type SlugForm = ReturnType<typeof useSlugForm>;

export function SlugFields({ idPrefix, form, hostPrefix, nameLabel, namePlaceholder, urlLabel, slugPlaceholder,
  onEnter, disabled, autoFocus = true, withRandom, preview }: {
  idPrefix: string; form: SlugForm; hostPrefix: string; nameLabel: string; namePlaceholder: string; urlLabel: string;
  slugPlaceholder: string; onEnter: () => void; disabled?: boolean; autoFocus?: boolean; withRandom?: boolean;
  preview?: { title: string; body: ReactNode };
}) {
  const { t } = useTranslation();
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (isImeComposing(e)) return; if (e.key === "Enter") { e.preventDefault(); onEnter(); } };
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{nameLabel}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input id={`${idPrefix}-name`} autoFocus={autoFocus} value={form.name} placeholder={namePlaceholder}
            className="h-10 min-w-0 text-body" disabled={disabled} onChange={(e) => form.setNameValue(e.target.value)} onKeyDown={onKey} />
          {withRandom && (
            <Button type="button" variant="outline" size="lg" className="shrink-0" onClick={form.randomize} disabled={disabled}>
              <Dices className="size-4" />{t("onboarding.step_workspace.random_name")}
            </Button>
          )}
        </div>
      </Field>
      <Field data-invalid={form.slugError ? true : undefined}>
        <FieldLabel htmlFor={`${idPrefix}-slug`}>{urlLabel}</FieldLabel>
        <div className={
          "flex h-10 items-center rounded-[var(--uw-radius)] border bg-subtle transition-colors focus-within:border-primary " +
          (form.slugError ? "border-danger" : "border-line")}>
          <span className="select-none pl-3 font-mono text-body text-secondary">{hostPrefix}</span>
          <Input id={`${idPrefix}-slug`} value={form.slug} placeholder={slugPlaceholder} disabled={disabled}
            className="h-full border-0 bg-transparent font-mono text-body shadow-none focus-visible:outline-none"
            onChange={(e) => form.setSlugValue(e.target.value)} onKeyDown={onKey} />
        </div>
        <FieldError>{form.slugError}</FieldError>
      </Field>
      {preview && (
        <Field>
          <FieldTitle>{preview.title}</FieldTitle>
          <FieldDescription>{preview.body}</FieldDescription>
        </Field>
      )}
    </FieldGroup>
  );
}
```

`packages/views/onboarding/steps/step-organization.tsx`:

```tsx
"use client";
import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import { useCreateOrganization } from "@uniwork/core/organizations";
import type { Organization } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { isSlugConflict } from "../../workspace/slug";
import { pickerCardClass, RadioMark } from "../components/option-card";
import { StepFooter, StepHeading } from "../components/step-shell";
import { SlugFields, useSlugForm } from "../slug-field";

export function StepOrganization({ organizations, selected, onSelected, onBusyChange }: {
  organizations: Organization[];
  selected: Organization | null;
  onSelected: (org: Organization) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const host = appHost();
  const form = useSlugForm();
  const create = useCreateOrganization();
  const resume = organizations.length > 0;
  // resume: null = chưa chọn gì → CTA disabled. Click lại card đang chọn = bỏ chọn.
  const [pickedId, setPickedId] = useState<string | "create" | null>(selected?.id ?? null);
  const picked = organizations.find((o) => o.id === pickedId) ?? null;

  const isCreating = create.isPending;
  useEffect(() => { onBusyChange?.(isCreating); return () => onBusyChange?.(false); }, [isCreating, onBusyChange]);

  const handleCreate = () => {
    if (!form.canSubmit || isCreating) return;
    create.mutate({ name: form.name.trim(), slug: form.slug.trim() }, {
      onSuccess: (d) => onSelected(d.organization),
      onError: (err) => {
        if (isSlugConflict(err)) {
          form.setServerError(t("onboarding.step_organization.slug_taken_error"));
          toast.error(t("onboarding.step_organization.slug_conflict_toast"));
          return;
        }
        toast.error(err instanceof Error && err.message ? err.message : t("onboarding.step_workspace.create_failed_toast"));
      },
    });
  };

  const creatingActive = !resume || pickedId === "create";
  let hint: string; let label: string; let disabled: boolean; let onContinue: () => void;
  if (picked) {
    hint = t("onboarding.step_organization.hint_opening", { name: picked.name });
    label = t("onboarding.step_organization.cta_open", { name: picked.name }); disabled = isCreating; onContinue = () => onSelected(picked);
  } else if (creatingActive) {
    if (isCreating) { hint = t("onboarding.step_organization.hint_creating_pending", { name: form.name.trim() }); label = t("onboarding.step_organization.cta_creating"); disabled = true; onContinue = () => {}; }
    else if (form.canSubmit) { hint = t("onboarding.step_organization.hint_creating", { name: form.name.trim() }); label = t("onboarding.step_organization.cta_create_named", { name: form.name.trim() }); disabled = false; onContinue = handleCreate; }
    else { hint = t("onboarding.step_organization.hint_name_first"); label = t("onboarding.step_organization.cta_create"); disabled = true; onContinue = () => {}; }
  } else {
    hint = t("onboarding.step_organization.hint_pick"); label = t("common.continue"); disabled = true; onContinue = () => {};
  }

  const fields = (
    <SlugFields idPrefix="org" form={form} hostPrefix={`${host}/`} withRandom={false} disabled={isCreating}
      nameLabel={t("onboarding.step_organization.name_label")} namePlaceholder={t("onboarding.step_organization.name_placeholder")}
      urlLabel={t("onboarding.step_organization.url_label")} slugPlaceholder={t("onboarding.step_organization.slug_placeholder")}
      onEnter={handleCreate} autoFocus={!resume || pickedId === "create"} />
  );

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading
          title={resume ? t("onboarding.step_organization.headline_resume", { name: organizations[0]!.name }) : t("onboarding.step_organization.headline_first")}
          description={resume ? t("onboarding.step_organization.lede_resume") : t("onboarding.step_organization.lede_first")} />
        {resume ? (
          <div className="flex flex-col gap-3">
            {organizations.map((o) => (
              <PickerCard key={o.id} selected={pickedId === o.id} onSelect={() => setPickedId((p) => (p === o.id ? null : o.id))}
                title={o.name} subtitle={`${host}/${o.slug}`} avatar={o.name.slice(0, 1).toUpperCase()} />
            ))}
            <CollapsibleCreateCard selected={pickedId === "create"} onSelect={() => setPickedId((p) => (p === "create" ? null : "create"))}
              title={t("onboarding.step_organization.create_new_title")} subtitle={t("onboarding.step_organization.create_new_subtitle")}>
              {fields}
            </CollapsibleCreateCard>
          </div>
        ) : fields}
      </div>
      <StepFooter hint={hint}>
        <Button size="lg" className="w-full" disabled={disabled} onClick={onContinue}>{label}</Button>
      </StepFooter>
    </>
  );
}

export function PickerCard({ selected, onSelect, title, subtitle, avatar }: {
  selected: boolean; onSelect: () => void; title: string; subtitle: string; avatar: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={pickerCardClass(selected) + " flex items-center gap-4 px-5 py-4"}>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-body font-semibold text-inverse">{avatar}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-primary">{title}</span>
        <span className="truncate font-mono text-caption text-secondary">{subtitle}</span>
      </span>
      <RadioMark selected={selected} />
    </button>
  );
}

export function CollapsibleCreateCard({ selected, onSelect, title, subtitle, children }: {
  selected: boolean; onSelect: () => void; title: string; subtitle: string; children: ReactNode;
}) {
  return (
    <div className={pickerCardClass(selected) + " overflow-hidden"}>
      <button type="button" role="radio" aria-checked={selected} aria-expanded={selected} onClick={onSelect}
        className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-secondary"><Plus className="size-4" /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-primary">{title}</span>
          <span className="truncate text-caption text-secondary">{subtitle}</span>
        </span>
        <RadioMark selected={selected} />
      </button>
      {selected && <div className="border-t border-line px-5 py-5">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Test PASS. Step 5: Commit** — `git commit -m "feat(views): shared slug fields and organization step"`

### Task 14: StepWorkspace + xoá form cũ

**Files:**
- Create: `packages/views/onboarding/steps/step-workspace.tsx`, test `step-workspace.test.tsx`
- Delete: `packages/views/workspace/create-workspace-form.tsx`

**Interfaces:** `StepWorkspace({ organization: Organization, existing: Workspace[] , onCreated(ws: Workspace), onBusyChange? })` — `existing` = workspace trong org này mà user đã có (resume).

- [ ] **Step 1: Test** (mock `@uniwork/core/api` như Task 13)

```tsx
describe("StepWorkspace", () => {
  it("creates in the given org and reports busy", async () => {
    requestMock.mockResolvedValueOnce({ workspace: { id: "w1", slug: "doi-alpha", name: "Đội Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" } });
    const onCreated = vi.fn(); const onBusy = vi.fn();
    render(wrap(<StepWorkspace organization={{ id: "o1", slug: "unicom", name: "Unicom" }} existing={[]} onCreated={onCreated} onBusyChange={onBusy} />));
    expect(screen.getByText("localhost:3000/unicom/")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: "Đội Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Đội Alpha" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ slug: "doi-alpha" })));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/workspaces", expect.objectContaining({ method: "POST" }));
    expect(onBusy).toHaveBeenCalledWith(true);
  });
  it("409 → inline error", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    render(wrap(<StepWorkspace organization={{ id: "o1", slug: "unicom", name: "Unicom" }} existing={[]} onCreated={() => {}} />));
    fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: "Đội Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Đội Alpha" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement** — cùng khuôn `StepOrganization`: `useCreateWorkspaceInOrg().mutate({orgId: organization.id, name, slug})`; `hostPrefix = \`${host}/${organization.slug}/\``; `withRandom`; preview `{ title: t("onboarding.step_workspace.url_preview_label"), body: <>{prefix}<span className="font-mono text-primary">{host}/{organization.slug}/{form.slug || "…"}</span>{suffix}</> }`; resume cards từ `existing` (`PickerCard` với subtitle `host/org/ws`, avatar chữ cái) + `CollapsibleCreateCard`; copy `onboarding.step_workspace.*`; CTA state machine 5 trạng thái như usf (`hint_opening/cta_open`, `hint_creating_pending/cta_creating`, `hint_creating/cta_create_named`, `hint_name_first/cta_create_workspace`, `hint_pick/common.continue`). Xoá `create-workspace-form.tsx` (picker view viết lại ở Task 19).

- [ ] **Step 4: Test PASS. Step 5: Commit** — `git commit -m "feat(views): workspace step scoped to organization"`

### Task 15: EmailChipsInput + StepInvite

**Files:**
- Create: `packages/views/workspace/email-chips-input.tsx`, `packages/views/onboarding/steps/step-invite.tsx`
- Test: `packages/views/workspace/email-chips-input.test.tsx`, `packages/views/onboarding/steps/step-invite.test.tsx`

**Interfaces:**
- `EmailChipsInput({ id, value: string[], onChange(list), disabled?, placeholder? })` — Enter/`,`/`;`/space/paste tách email; chip có nút xoá; email sai định dạng hiển thị chip đỏ + `aria-invalid`; export `parseEmails(text): string[]`, `EMAIL_RE`.
- `StepInvite({ workspace: Workspace, onFinish(), onSkip(), onBusyChange? })`.

- [ ] **Step 1: Tests**

`email-chips-input.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { EmailChipsInput, parseEmails } from "./email-chips-input";

function H() { const [v, setV] = useState<string[]>([]); return <EmailChipsInput id="e" value={v} onChange={setV} />; }

describe("EmailChipsInput", () => {
  it("parseEmails splits on separators and dedupes", () => {
    expect(parseEmails("a@x.com, B@x.com; a@x.com c@x.com\n")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
  it("Enter and paste add chips; invalid marked", () => {
    render(<H />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { getData: () => "b@x.com, bad" } });
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.getByText("bad").closest("[data-invalid]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Xóa bad/ }));
    expect(screen.queryByText("bad")).toBeNull();
  });
});
```

`step-invite.test.tsx` (mock api):

```tsx
describe("StepInvite", () => {
  const ws = { id: "w1", slug: "doi-alpha", name: "Đội Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" };
  it("finish disabled until sent; skip always available", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "b@x.com", role: "member", token: "tok" }], skipped: [] });
    const onFinish = vi.fn(); const onSkip = vi.fn();
    render(wrap(<StepInvite workspace={ws} onFinish={onFinish} onSkip={onSkip} />));
    expect(screen.getByRole("button", { name: "Hoàn tất" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gửi lời mời" })).toBeDisabled();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "b@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(screen.getByText("Đã tạo 1 lời mời")).toBeInTheDocument());
    expect(screen.getByText(/\/invite\/tok/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoàn tất" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua, mời sau" }));
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement**

`packages/views/workspace/email-chips-input.tsx`:

```tsx
"use client";
import { X } from "lucide-react";
import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export function EmailChipsInput({ id, value, onChange, disabled, placeholder }: {
  id: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const next = parseEmails(text).filter((e) => !value.includes(e));
    if (next.length) onChange([...value, ...next]);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (["Enter", ",", ";", " "].includes(e.key)) { if (draft.trim()) { e.preventDefault(); add(draft); } else if (e.key !== " ") e.preventDefault(); }
    else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); add(e.clipboardData.getData("text")); };
  return (
    <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--uw-radius)] border border-line bg-surface px-2 py-1.5 focus-within:border-primary", disabled && "opacity-60")}
      onClick={() => document.getElementById(id)?.focus()}>
      {value.map((email) => {
        const ok = EMAIL_RE.test(email);
        return (
          <span key={email} data-invalid={ok ? undefined : true}
            className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption",
              ok ? "border-line bg-subtle text-primary" : "border-danger/40 bg-danger/5 text-danger")}>
            {email}
            <button type="button" aria-label={`${t("common.delete")} ${email}`} disabled={disabled}
              className="rounded-full p-0.5 hover:bg-line" onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== email)); }}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input id={id} type="text" value={draft} disabled={disabled} placeholder={value.length ? "" : placeholder}
        className="min-w-[10rem] flex-1 bg-transparent text-body text-primary placeholder:text-tertiary focus:outline-none"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => draft.trim() && add(draft)} />
    </div>
  );
}
```
(`common.delete` = "Xóa" → aria-label "Xóa bad".)

`packages/views/onboarding/steps/step-invite.tsx`:

```tsx
"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { useInvite } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { StepFooter, StepHeading } from "../components/step-shell";

interface Sent { email: string; token: string }

export function StepInvite({ workspace, onFinish, onSkip, onBusyChange }: {
  workspace: Workspace; onFinish: () => void; onSkip: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const invite = useInvite(workspace.id);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [sent, setSent] = useState<Sent[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const valid = emails.filter((e) => EMAIL_RE.test(e));
  const busy = invite.isPending;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  const send = () => {
    if (!valid.length || busy) return;
    invite.mutate({ emails: valid, role }, {
      onSuccess: (d) => {
        setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email, token: i.token }))]);
        setSkipped(d.skipped); setEmails([]);
      },
      onError: () => toast.error(t("onboarding.step_invite.send_failed")),
    });
  };
  const hint = sent.length ? t("onboarding.step_invite.hint_done")
    : valid.length ? t("onboarding.step_invite.hint_ready", { count: valid.length }) : t("onboarding.step_invite.hint_empty");

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading title={t("onboarding.step_invite.headline", { workspace: workspace.name })} description={t("onboarding.step_invite.lede")} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-emails">{t("onboarding.step_invite.emails_label")}</FieldLabel>
            <EmailChipsInput id="invite-emails" value={emails} onChange={setEmails} disabled={busy} placeholder={t("workspace.inviteHint")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-role">{t("onboarding.step_invite.role_label")}</FieldLabel>
            <Select className="h-10" value={role} onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
              items={[{ value: "member", label: t("onboarding.step_invite.role_member") }, { value: "admin", label: t("onboarding.step_invite.role_admin") }]} />
          </Field>
          <Button type="button" variant="outline" size="lg" className="w-full" disabled={!valid.length || busy} onClick={send}>
            {busy ? t("onboarding.step_invite.sending") : t("onboarding.step_invite.send")}
          </Button>
          {sent.length > 0 && (
            <Field>
              <FieldLabel htmlFor="invite-list">{t("onboarding.step_invite.sent_title", { count: sent.length })}</FieldLabel>
              <FieldDescription>{t("onboarding.step_invite.sent_hint")}</FieldDescription>
              <ul id="invite-list" className="flex flex-col gap-2">
                {sent.map((s) => <InviteRow key={s.token} sent={s} />)}
              </ul>
              {skipped.length > 0 && <FieldDescription>{t("onboarding.step_invite.skipped_note", { count: skipped.length })}</FieldDescription>}
            </Field>
          )}
        </FieldGroup>
      </div>
      <StepFooter hint={hint}>
        <Button size="lg" className="w-full" disabled={!sent.length || busy} onClick={onFinish}>{t("onboarding.step_invite.finish")}</Button>
        <Button size="lg" variant="ghost" className="w-full" disabled={busy} onClick={onSkip}>{t("onboarding.step_invite.skip")}</Button>
      </StepFooter>
    </>
  );
}

function InviteRow({ sent }: { sent: Sent }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${sent.token}`;
  return (
    <li className="flex items-center gap-3 rounded-[var(--uw-radius)] border border-line bg-surface px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-primary">{sent.email}</span>
        <span className="block truncate font-mono text-caption text-secondary">{link}</span>
      </span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? t("common.copied") : t("common.copy")}
        onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </li>
  );
}
```
(`Select` hiện có `className` áp lên Trigger — đủ dùng.)

- [ ] **Step 4: Test PASS. Step 5: Commit** — `git commit -m "feat(views): email chips input and invite step"`

### Task 16: OnboardingFlow orchestrator

**Files:**
- Create: `packages/views/onboarding/onboarding-flow.tsx`, test `onboarding-flow.test.tsx`

**Interfaces:**
- `OnboardingFlow({ onComplete(ws?: Workspace), mode?: "first_run"|"new_workspace", onCancel? })`; `export type OnboardingMode`.

- [ ] **Step 1: Test** (mock api; mock `@uniwork/core/auth` `useSession` trả user chưa onboard; mock `@uniwork/core/onboarding` store `saveQuestionnaire`/`completeOnboarding` bằng `vi.fn`)

```tsx
describe("OnboardingFlow", () => {
  it("walks welcome → about you → organization → workspace → invite → complete", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
      if (path === "/api/v1/orgs") return Promise.resolve({ organizations: [] });
      return Promise.resolve({});
    });
    const onComplete = vi.fn();
    render(wrap(<OnboardingFlow onComplete={onComplete} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));
    expect(screen.getByText("Cho chúng tôi biết đôi chút về bạn.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua" }));
    expect(await screen.findByRole("heading", { name: "Đặt tên tổ chức của bạn." })).toBeInTheDocument();
    // Back về "Về bạn" qua rail
    fireEvent.click(screen.getByRole("button", { name: /Về bạn/ }));
    expect(screen.getByText("Cho chúng tôi biết đôi chút về bạn.")).toBeInTheDocument();
  });
  it("new_workspace mode starts at organization and cancels from its back", async () => {
    requestMock.mockResolvedValue({ workspaces: [], organizations: [] });
    const onCancel = vi.fn();
    render(wrap(<OnboardingFlow onComplete={() => {}} mode="new_workspace" onCancel={onCancel} />));
    expect(await screen.findByRole("heading", { name: /tổ chức/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement**

```tsx
"use client";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { completeOnboarding, mergeQuestionnaire, ONBOARDING_STEP_ORDER, saveQuestionnaire, setWelcomeSignal,
  type OnboardingStep, type QuestionnaireAnswers } from "@uniwork/core/onboarding";
import { useOrganizations } from "@uniwork/core/organizations";
import type { Organization, Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";
import { StepShell } from "./components/step-shell";
import { StepAboutYou } from "./steps/step-about-you";
import { StepInvite } from "./steps/step-invite";
import { StepOrganization } from "./steps/step-organization";
import { StepWelcome } from "./steps/step-welcome";
import { StepWorkspace } from "./steps/step-workspace";

export type OnboardingMode = "first_run" | "new_workspace";

/**
 * Orchestrator. Chỉ questionnaire persist qua server; bước đang đứng KHÔNG
 * persist — mỗi lần vào bắt đầu từ Welcome. Một StepShell duy nhất bao mọi
 * bước (hoisted) để rail không remount và không nháy fade mỗi lần chuyển bước.
 */
export function OnboardingFlow({ onComplete, mode = "first_run", onCancel }: {
  onComplete: (workspace?: Workspace) => void; mode?: OnboardingMode; onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  if (!user) throw new Error("OnboardingFlow requires an authenticated user");
  const isNew = mode === "new_workspace";

  const [answers, setAnswers] = useState<QuestionnaireAnswers>(() => mergeQuestionnaire(user.onboarding_questionnaire ?? {}));
  const [step, setStep] = useState<OnboardingStep>(isNew ? "organization" : "welcome");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [stepBusy, setStepBusy] = useState(false);

  const { data: workspaces = [], isFetched: wsFetched } = useWorkspaces();
  const { data: organizations = [] } = useOrganizations();
  const canSkipWelcome = wsFetched && workspaces.length > 0;
  // Resume: workspace đã có trong org đang chọn (lần trước bỏ dở).
  const existingInOrg = organization ? workspaces.filter((w) => w.organization_id === organization.id) : [];

  const next = useCallback((from: OnboardingStep) => {
    const i = ONBOARDING_STEP_ORDER.indexOf(from as (typeof ONBOARDING_STEP_ORDER)[number]);
    const n = ONBOARDING_STEP_ORDER[i + 1];
    if (n) setStep(n);
  }, []);

  const applyAnswers = useCallback((patch: Partial<QuestionnaireAnswers>) => {
    setAnswers((a) => {
      const merged = { ...a, ...patch };
      void saveQuestionnaire(merged).catch(() => toast.error(t("onboarding.errors.save_failed")));
      return merged;
    });
  }, [t]);

  const finish = useCallback(async (path: "full" | "invite_skipped") => {
    if (!workspace) return;
    try { await completeOnboarding(path, workspace.id); }
    catch { toast.error(t("onboarding.errors.complete_failed")); return; }
    setWelcomeSignal(workspace.id);
    onComplete(workspace);
  }, [workspace, onComplete, t]);

  const skipWelcome = useCallback(async () => {
    const first = workspaces[0];
    try { await completeOnboarding("skip_existing", first?.id); }
    catch { toast.error(t("onboarding.errors.skip_failed")); return; }
    onComplete(first);
  }, [workspaces, onComplete, t]);

  const back = (from: OnboardingStep) => {
    if (isNew && from === "organization") { onCancel?.(); return; }
    const i = ONBOARDING_STEP_ORDER.indexOf(from as (typeof ONBOARDING_STEP_ORDER)[number]);
    setStep(i <= 0 ? "welcome" : ONBOARDING_STEP_ORDER[i - 1]!);
  };

  if (step === "welcome") {
    return (
      <>
        <OnboardingLogoutButton />
        <StepWelcome onNext={() => setStep(ONBOARDING_STEP_ORDER[0]!)} onSkip={canSkipWelcome ? skipWelcome : undefined} />
      </>
    );
  }

  // Sau khi workspace tồn tại, bước Mời không có Back (quay lại sẽ tới bước
  // workspace mà back của nó = rời flow → workspace mồ côi không hướng dẫn).
  const stepBack =
    step === "about_you" ? () => back("about_you")
    : step === "organization" ? (isNew && !onCancel ? undefined : () => back("organization"))
    : step === "workspace" ? () => back("workspace")
    : undefined;
  // Rail chỉ đi lùi; new_workspace không có rail nav.
  const onStepChange = isNew ? undefined : (s: OnboardingStep) => setStep(s);

  return (
    <StepShell currentStep={step} onBack={stepBack} backDisabled={stepBusy} onStepChange={onStepChange}
      chromeFooter={<OnboardingLogoutButton inline />}>
      {step === "about_you" && (
        <StepAboutYou answers={answers} onChange={applyAnswers} onAdvance={() => next("about_you")} onSkip={() => next("about_you")} />
      )}
      {step === "organization" && (
        <StepOrganization organizations={organizations} selected={organization}
          onSelected={(o) => { setOrganization(o); next("organization"); }} onBusyChange={setStepBusy} />
      )}
      {step === "workspace" && organization && (
        <StepWorkspace organization={organization} existing={existingInOrg}
          onCreated={(w) => { setWorkspace(w); next("workspace"); }} onBusyChange={setStepBusy} />
      )}
      {step === "invite" && workspace && (
        <StepInvite workspace={workspace} onFinish={() => void finish("full")} onSkip={() => void finish("invite_skipped")} onBusyChange={setStepBusy} />
      )}
    </StepShell>
  );
}
```
Trong `new_workspace` mode, `onCancel` chỉ được truyền khi user đã có ≥1 workspace (page quyết định) — không có thì bước Tổ chức không có Back.

- [ ] **Step 4: Test PASS; `pnpm --filter @uniwork/views typecheck`. Step 5: Commit** — `git commit -m "feat(views): onboarding flow orchestrator"`

### Task 17: WelcomeAfterOnboarding (landing 🎉 + seed task)

**Files:** Create `packages/views/workspace/welcome-after-onboarding.tsx`, test `welcome-after-onboarding.test.tsx`.

**Interfaces:** `WelcomeAfterOnboarding({ workspace: Workspace, onOpenTask(taskId: string) })` — render null khi không có signal cho workspace này.

- [ ] **Step 1: Test** (mock api)

```tsx
describe("WelcomeAfterOnboarding", () => {
  const ws = { id: "w1", slug: "a", name: "A", organization_id: "o", organization_slug: "o", organization_name: "O" };
  it("renders nothing without signal", () => {
    resetWelcome();
    const { container } = render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
  it("seeds task then shows 🎉 dialog; got it opens task", async () => {
    requestMock.mockResolvedValueOnce({ task: { id: "t1", workspace_id: "w1", title: "Bắt đầu với UniWork", description: "", status: "in_progress", priority: "high", position: 1, created_by: "u", created_at: "", updated_at: "", kind: "welcome" } });
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    expect(await screen.findByText("Chào mừng đến UniWork!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đã hiểu" }));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
  it("shows retry dialog on failure", async () => {
    requestMock.mockRejectedValueOnce(new Error("x"));
    setWelcomeSignal("w1");
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(await screen.findByText("Chưa chuẩn bị được workspace")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement**

```tsx
"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dismissWelcome, useSeedWelcomeTask, useWelcomeSignal } from "@uniwork/core/onboarding";
import type { Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent } from "@uniwork/ui/components/ui/dialog";

/** Một lần sau onboarding: seed task hướng dẫn (server idempotent) rồi dialog 🎉. */
export function WelcomeAfterOnboarding({ workspace, onOpenTask }: { workspace: Workspace; onOpenTask: (taskId: string) => void }) {
  const { signal, dismissed } = useWelcomeSignal();
  if (!signal || dismissed || signal.workspaceId !== workspace.id) return null;
  return <Seeder workspaceId={workspace.id} onOpenTask={onOpenTask} />;
}

function Seeder({ workspaceId, onOpenTask }: { workspaceId: string; onOpenTask: (id: string) => void }) {
  const { t } = useTranslation();
  const seed = useSeedWelcomeTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fired = useRef(false); // StrictMode double-mount: server idempotent, nhưng tránh 2 request

  useEffect(() => {
    if (fired.current || taskId || failed) return;
    fired.current = true;
    seed.mutate(workspaceId, { onSuccess: (d) => setTaskId(d.task.id), onError: () => { setFailed(true); fired.current = false; } });
  }, [workspaceId, taskId, failed, seed]);

  if (failed) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) dismissWelcome(); }}>
        <DialogContent title={t("onboarding.welcome_after_onboarding.error_title")}>
          <p className="text-body text-secondary">{t("onboarding.welcome_after_onboarding.error_body")}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={dismissWelcome}>{t("onboarding.welcome_after_onboarding.dismiss")}</Button>
            <Button onClick={() => setFailed(false)}>{t("onboarding.welcome_after_onboarding.retry")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (!taskId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-secondary" />
          <p className="text-body text-secondary">{t("onboarding.welcome_after_onboarding.loading")}</p>
        </div>
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) dismissWelcome(); }}>
      <DialogContent title="" className="w-[560px]">
        <div className="flex flex-col items-center gap-4 pt-2">
          <div className="animate-welcome-emoji-pop text-6xl" aria-hidden>🎉</div>
          <h2 className="text-center text-display-sm font-semibold text-primary">{t("onboarding.welcome_after_onboarding.title")}</h2>
          <p className="max-w-md text-center text-body text-secondary">{t("onboarding.welcome_after_onboarding.subtitle")}</p>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body font-medium text-primary">{t("onboarding.welcome_after_onboarding.card_title")}</p>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-micro font-medium text-brand">{t("onboarding.welcome_after_onboarding.status_in_progress")}</span>
            </div>
            <p className="mt-1 text-caption text-secondary">{t("onboarding.welcome_after_onboarding.card_subtitle")}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={() => { dismissWelcome(); onOpenTask(taskId); }}>{t("onboarding.welcome_after_onboarding.got_it")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
`DialogContent` hiện bắt buộc `title` và render `<BaseDialog.Title>`; sửa `packages/ui/components/ui/dialog.tsx` để khi `title === ""` render `<BaseDialog.Title className="sr-only">` với text từ prop `srTitle` (thêm prop tùy chọn `srTitle?: string`) — ở đây truyền `srTitle={t("onboarding.welcome_after_onboarding.title")}`.

- [ ] **Step 4: Test PASS. Step 5: Commit** — `git commit -m "feat(views): welcome dialog and guide task seeding after onboarding"`

---

## Phase D — Routing app, switcher, members, invitations, e2e

### Task 18: Routes `[orgSlug]/[workspaceSlug]`, guard hai chiều, trang onboarding / workspaces/new / invitations, login/register destination

**Files:**
- Move: `apps/web/app/[workspaceSlug]/**` → `apps/web/app/[orgSlug]/[workspaceSlug]/**` (`git mv`), sửa mọi `router.push(\`/${workspaceSlug}/…\`)` → `paths.workspace(orgSlug, workspaceSlug).…()`.
- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/register/page.tsx`, `apps/web/app/invite/[token]/page.tsx`, `apps/web/app/page.tsx`
- Create: `apps/web/app/(auth)/onboarding/page.tsx`, `apps/web/app/(auth)/workspaces/new/page.tsx`, `apps/web/app/(auth)/invitations/page.tsx`, `apps/web/app/(auth)/layout.tsx`, `packages/views/workspace/invitations-view.tsx`, `packages/views/auth/post-auth-redirect.tsx` (đuôi .tsx dù không có JSX — exports của views chỉ map `./auth/*.tsx`)
- Test: `packages/views/auth/post-auth-redirect.test.ts`

**Interfaces:**
- `useCurrentWorkspace()` (export từ layout) trả `{ organization: {slug, name, id}, workspace, user }`.
- `resolveLoggedInDestination(qc, user, workspaces): Promise<string>` — chưa onboard + có lời mời chờ → `/invitations`; else `resolvePostAuthDestination`.
- `InvitationsView({ onJoined(ws: Workspace), onEmpty() })`.

- [ ] **Step 1: Test resolver có lời mời**

`packages/views/auth/post-auth-redirect.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveLoggedInDestination } from "./post-auth-redirect";

const fetchMy = vi.fn();
vi.mock("@uniwork/core/workspaces", () => ({ fetchMyInvitations: (...a: unknown[]) => fetchMy(...a) }));

describe("resolveLoggedInDestination", () => {
  it("un-onboarded with pending invites → /invitations", async () => {
    fetchMy.mockResolvedValueOnce([{ id: "i" }]);
    expect(await resolveLoggedInDestination(false, [])).toBe("/invitations");
  });
  it("un-onboarded without invites → /onboarding; fetch failure non-fatal", async () => {
    fetchMy.mockRejectedValueOnce(new Error("x"));
    expect(await resolveLoggedInDestination(false, [])).toBe("/onboarding");
  });
  it("onboarded → never checks invites", async () => {
    fetchMy.mockClear();
    expect(await resolveLoggedInDestination(true, [])).toBe("/workspaces/new");
    expect(fetchMy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement**

`packages/views/auth/post-auth-redirect.tsx`:

```ts
import { resolvePostAuthDestination, paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { fetchMyInvitations } from "@uniwork/core/workspaces";

export async function resolveLoggedInDestination(hasOnboarded: boolean, workspaces: Workspace[]): Promise<string> {
  if (!hasOnboarded) {
    try {
      const invites = await fetchMyInvitations();
      if (invites.length > 0) return paths.invitations();
    } catch { /* không chặn đăng nhập vì lỗi phụ */ }
  }
  return resolvePostAuthDestination(workspaces, hasOnboarded);
}
```

`packages/views/auth/login-view.tsx` / `register-view.tsx`: đổi `onSuccess: () => void` thành `onSuccess: (sess: SessionResponse) => void` (truyền `sess` từ mutation). Trang:

`apps/web/app/(auth)/login/page.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { paths, sanitizeNextUrl } from "@uniwork/core/paths";
import { api } from "@uniwork/core";
import { LoginView } from "@uniwork/views/auth/login-view";
import { resolveLoggedInDestination } from "@uniwork/views/auth/post-auth-redirect";

export default function LoginPage() {
  const router = useRouter();
  const next = sanitizeNextUrl(useSearchParams().get("next"));
  return (
    <LoginView onSuccess={async (sess) => {
      if (next) { router.push(next); return; }
      const { workspaces } = await api.request<{ workspaces: import("@uniwork/core/types").Workspace[] }>("/api/v1/workspaces");
      router.push(await resolveLoggedInDestination(sess.user.onboarded_at != null, workspaces));
    }} />
  );
}
```
Register tương tự (`register/page.tsx`) nhưng không có `next`. `apps/web/app/page.tsx` giữ `redirect("/login")`. Bọc `useSearchParams` trong `<Suspense>` nếu Next yêu cầu (tạo `apps/web/app/(auth)/layout.tsx` với `<Suspense>{children}</Suspense>` và `export const metadata = { robots: { index: false, follow: false } }`).

`apps/web/app/(auth)/onboarding/page.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession } from "@uniwork/core/auth";
import { paths, resolvePostAuthDestination, useHasOnboarded } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { OnboardingFlow } from "@uniwork/views/onboarding/onboarding-flow";

export default function OnboardingPage() {
  const router = useRouter();
  const { status } = useSession();
  const hasOnboarded = useHasOnboarded();
  const { data: workspaces = [], isFetched } = useWorkspaces();
  // Latch: khi onComplete đang push, guard (thấy onboarded_at vừa set) không được replace đè.
  const completing = useRef(false);

  useEffect(() => {
    if (status === "anon") router.replace(paths.login());
    if (status === "authed" && hasOnboarded && isFetched && !completing.current) {
      router.replace(resolvePostAuthDestination(workspaces, true));
    }
  }, [status, hasOnboarded, isFetched, workspaces, router]);

  if (status !== "authed" || (hasOnboarded && !completing.current)) return null;
  return (
    <div className="h-dvh overflow-y-auto bg-canvas">
      <OnboardingFlow onComplete={(ws) => {
        completing.current = true;
        router.push(ws ? paths.workspace(ws.organization_slug, ws.slug).tasks() : paths.root());
      }} />
    </div>
  );
}
```

`apps/web/app/(auth)/workspaces/new/page.tsx`: giống trên nhưng không có guard onboarded, `mode="new_workspace"`, `onCancel` chỉ khi `workspaces.length > 0` (→ `router.back()` hoặc `resolvePostAuthDestination`), yêu cầu `status === "authed"`.

`apps/web/app/(auth)/invitations/page.tsx` + `packages/views/workspace/invitations-view.tsx`:

```tsx
"use client";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import type { Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { useEffect } from "react";

export function InvitationsView({ onJoined, onEmpty }: { onJoined: (ws: Workspace) => void; onEmpty: () => void }) {
  const { t } = useTranslation();
  const { data: invites, isFetched } = useMyInvitations();
  const accept = useAcceptInvite();
  useEffect(() => { if (isFetched && invites && invites.length === 0) onEmpty(); }, [isFetched, invites, onEmpty]);
  if (!invites?.length) return null;
  const join = (token: string) => accept.mutate(token, {
    onSuccess: (d) => onJoined(d.workspace), onError: () => toast.error(t("common.error")),
  });
  const joinAll = async () => {
    let last: Workspace | null = null;
    for (const i of invites) { try { last = (await accept.mutateAsync(i.token)).workspace; } catch { toast.error(t("common.error")); } }
    if (last) onJoined(last);
  };
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title-lg font-semibold text-primary">{t("invitations.title")}</h1>
        <p className="text-body text-secondary">{t("invitations.subtitle")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-caption text-secondary">{t("invitations.invitedBy", { name: i.invited_by.display_name })}</div>
              <div className="truncate text-body font-medium text-primary">{i.organization.name} › {i.workspace.name}</div>
              <div className="truncate font-mono text-caption text-secondary">{appHost()}/{i.organization.slug}/{i.workspace.slug} · {t("invitations.role", { role: i.role })}</div>
            </div>
            <Button variant="outline" disabled={accept.isPending} onClick={() => join(i.token)}>{t("invitations.join")}</Button>
          </li>
        ))}
      </ul>
      {invites.length > 1 && <Button size="lg" className="w-full" disabled={accept.isPending} onClick={joinAll}>{t("invitations.joinAll")}</Button>}
    </div>
  );
}
```
Page: `onJoined={(ws) => router.replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}`, `onEmpty={() => router.replace(resolvePostAuthDestination([], hasOnboarded))}` (nếu user chưa onboard → `/onboarding`).

`apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx`:

```tsx
"use client";
import { createContext, useContext, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { useWorkspace } from "@uniwork/core/workspaces";
import { AppShell } from "@uniwork/views/layout/app-shell";
import { WelcomeAfterOnboarding } from "@uniwork/views/workspace/welcome-after-onboarding";

const Ctx = createContext<{ workspace: Workspace; user: User } | null>(null);
export function useCurrentWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCurrentWorkspace outside workspace layout");
  return c;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { user, status } = useSession();
  const { data: workspace, error } = useWorkspace(status === "authed" ? orgSlug : "", workspaceSlug);

  useEffect(() => {
    if (status === "anon") router.replace(`${paths.login()}?next=${encodeURIComponent(pathname)}`);
    // Guard gương với /onboarding: onboarded_at là nguồn sự thật, không phải số workspace.
    if (user && user.onboarded_at == null) router.replace(paths.onboarding());
    if (error) router.replace(paths.workspaces());
  }, [status, user, error, router, pathname]);

  if (status !== "authed" || !workspace || !user || user.onboarded_at == null) return null;
  const active = pathname.split("/")[3] ?? "tasks";
  return (
    <Ctx.Provider value={{ workspace, user }}>
      <AppShell workspace={workspace} user={user} active={active}>
        {children}
        <WelcomeAfterOnboarding workspace={workspace} onOpenTask={(id) => router.push(paths.workspace(orgSlug, workspaceSlug).task(id))} />
      </AppShell>
    </Ctx.Provider>
  );
}
```
Các page con: `useParams<{orgSlug; workspaceSlug}>()` và `paths.workspace(orgSlug, workspaceSlug).task(id)` v.v. `invite/[token]/page.tsx`: `onAccepted={(ws) => router.replace(paths.workspace(ws.organization_slug, ws.slug).tasks())}`, `onAnon={() => router.replace(\`/login?next=/invite/${token}\`)}` (sửa `AcceptInviteView` để `onAccepted` nhận `Workspace`).

- [ ] **Step 4: Test + typecheck + chạy tay** — `pnpm --filter @uniwork/views test && pnpm typecheck` → PASS. `make dev`: đăng ký mới → `/onboarding` → đủ 4 bước → `/{org}/{ws}/tasks` + dialog 🎉 → task hướng dẫn. Đăng nhập user cũ (đã grandfather) → vào thẳng workspace.

- [ ] **Step 5: Commit** — `git add -A apps/web packages/views && git commit -m "feat(web): org-scoped routes, onboarding pages, invitation-aware post-auth routing"`

### Task 19: Workspace picker theo org + switcher trong sidebar

**Files:**
- Rewrite: `packages/views/workspace/workspace-picker-view.tsx`; Create: `packages/views/layout/workspace-switcher.tsx`; Modify: `packages/views/layout/sidebar.tsx`, `apps/web/app/workspaces/page.tsx`
- Test: `packages/views/workspace/workspace-picker-view.test.tsx`

**Interfaces:** `WorkspacePickerView({ onPick(ws), onCreate() })`; `WorkspaceSwitcher({ current: Workspace })` (Base UI Menu: nhóm theo org, item → `paths.workspace(...).tasks()`, cuối menu "Workspace mới" → `/workspaces/new`).

- [ ] **Step 1: Test** — render picker với 2 workspace ở 2 org (mock `useWorkspaces` qua api mock) → có 2 heading org và 2 nút workspace; empty → gọi `onCreate` qua nút "Workspace mới".

- [ ] **Step 2: Fail. Step 3: Implement**

Picker: `mx-auto max-w-2xl p-8`, h1 `text-title-lg font-semibold`, mỗi org một `section` (heading `text-label font-medium text-secondary` = org name + `font-mono text-caption` slug), grid `grid gap-3 sm:grid-cols-2` các card `PickerCard`-style button (tên + `host/org/ws`), cuối trang `<Button variant="outline" size="lg" onClick={onCreate}><Plus/>{t("workspace.new")}</Button>`; empty state (0 workspace) gọi `onCreate` trong `useEffect`.

Switcher (`@base-ui/react/menu`): trigger là khối đầu sidebar hiện tại (org name `text-[12px] text-tertiary` trên, workspace name `text-sm font-semibold` dưới, `ChevronsUpDown` phải); Popup `min-w-60 rounded-[var(--uw-radius)] border border-line bg-surface p-1 shadow-lg`; `Menu.Group` + `Menu.GroupLabel` mỗi org; `Menu.Item` là `<a href>`; `Menu.Separator`; item cuối "Workspace mới". `Sidebar` thay khối header bằng `<WorkspaceSwitcher current={workspace} />` và nav link dùng `paths.workspace(workspace.organization_slug, workspace.slug)`.

- [ ] **Step 4: Test PASS; chạy tay chuyển workspace. Step 5: Commit** — `git commit -m "feat(views): workspace picker grouped by organization and sidebar switcher"`

### Task 20: Members bulk invite + badge task hướng dẫn

**Files:** Modify `packages/views/workspace/members-view.tsx`, `packages/views/tasks/task-card.tsx`, `packages/views/tasks/list-view.tsx`; test `members-view.test.tsx`.

- [ ] **Step 1: Test** — members view: nhập 2 email chip + gửi → hiển thị 2 link mời; role select có "Quản trị"/"Thành viên".
- [ ] **Step 2: Fail. Step 3: Implement** — form mời dùng `EmailChipsInput` + `Select` role + `Button` "Mời thành viên"; kết quả list link với copy (tái dùng `InviteRow` — export từ `step-invite.tsx` sang `packages/views/workspace/invite-row.tsx` và import lại ở step-invite); hiện `skipped` bằng `t("workspace.inviteSkipped", {list})`. Task card/list: nếu `task.kind === "welcome"` thêm `<span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-micro font-medium text-brand">{t("workspace.guideBadge")}</span>` cạnh priority.
- [ ] **Step 4: PASS. Step 5: Commit** — `git commit -m "feat(views): bulk invites on members page, guide badge on welcome task"`

### Task 21: E2E + docs + dọn dẹp

**Files:**
- Modify: `e2e/smoke.spec.ts`; Create: `e2e/onboarding-smoke.spec.ts`, `e2e/onboarding-shell.spec.ts`
- Modify: `README.md`, `.env.example` (+ `NEXT_PUBLIC_APP_URL=http://localhost:3000`)

- [ ] **Step 1: `e2e/onboarding-smoke.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

const stamp = Date.now();
const email = `onb-${stamp}@example.com`;

test("register → onboarding 4 bước → 🎉 → task hướng dẫn", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Onboard Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("một không gian.");
  await expect(page.getByRole("button", { name: "Tôi đã dùng rồi" })).toHaveCount(0);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();

  // Về bạn
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  // Tổ chức
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await page.getByLabel("Tên tổ chức").fill(`Tổ chức ${stamp}`);
  await expect(page.getByLabel("Đường dẫn")).toHaveValue(`to-chuc-${stamp}`);
  await page.getByRole("button", { name: `Tạo Tổ chức ${stamp}` }).click();

  // Workspace
  await page.getByRole("heading", { name: "Đặt tên workspace." }).waitFor();
  await page.getByLabel("Tên workspace").fill("Đội Alpha");
  await expect(page.getByText(`localhost:3000/to-chuc-${stamp}/`)).toBeVisible();
  await page.getByRole("button", { name: "Tạo Đội Alpha" }).click();

  // Mời — bỏ qua
  await page.getByRole("heading", { name: /Mời đồng nghiệp vào Đội Alpha/ }).waitFor();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();

  await expect(page).toHaveURL(new RegExp(`/to-chuc-${stamp}/doi-alpha/tasks$`));
  await expect(page.getByText("Chào mừng đến UniWork!")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9A-Z]+$/);
  await expect(page.getByText("Bắt đầu với UniWork")).toBeVisible();

  // Vào lại /onboarding khi đã onboard → bị đẩy về workspace
  await page.goto("/onboarding");
  await expect(page).toHaveURL(new RegExp(`/to-chuc-${stamp}/doi-alpha/tasks$`));
});
```

- [ ] **Step 2: `e2e/onboarding-shell.spec.ts`** — port usf: `expectFullWidthBlocks` (selector `h1, [data-slot="field-group"], [data-slot="field"]`, column = `main > div`) chạy ở 3 bước Về bạn / Tổ chức / Workspace / Mời; test "shell survives step changes" đánh dấu `aside`/`main` bằng `data-persist-probe` sau bước 1 và kiểm tra còn sau khi sang bước 2. Đăng ký qua UI như smoke (không có token injection).

- [ ] **Step 3: Sửa `e2e/smoke.spec.ts`** — sau đăng ký đi qua onboarding tối thiểu (Bắt đầu → Bỏ qua → tạo org → tạo workspace → Bỏ qua mời → Đã hiểu) rồi tiếp tục task/meeting; mọi URL `/doi-e2e-${stamp}/…` → `/org-e2e-${stamp}/doi-e2e-${stamp}/…`.

- [ ] **Step 4: Chạy** — `make dev` (cổng theo `.env`, máy này 8090) rồi `make e2e` → PASS 3 spec. `make test` → PASS.

- [ ] **Step 5: README** — mục "Cấu trúc" thêm `packages/views/onboarding`, mục chạy dev thêm `NEXT_PUBLIC_APP_URL`; ghi chú URL `/{org}/{ws}`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "test(e2e): onboarding smoke and shell geometry; docs"`

---

## Kiểm tra cuối (trước khi báo xong)

- `cd server && go test ./...` xanh; `pnpm typecheck && pnpm test` xanh; `make e2e` xanh.
- Đăng nhập user grandfather (tạo trước migration) → vào thẳng `/{slug}/{slug}/tasks`, sidebar switcher hiện org.
- Dark mode (`.dark` trên `<html>`): rail vẫn tối, nội dung theo token; toast đúng màu.
- Thu hẹp cửa sổ < 768px: rail ẩn, `StepProgressBar` hiện với Back + Đăng xuất.
- `prefers-reduced-motion`: không có animation, DotSphere vẽ 1 khung tĩnh.
