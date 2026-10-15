# Sửa thông tin workspace — Implementation Plan

> **Trạng thái:** in-progress — đã triển khai trên nhánh, chờ review/PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner/admin sửa được mô tả, icon (emoji hoặc ảnh), slug và tiền tố mã task của workspace; link cũ và mã task cũ vẫn chạy.

**Architecture:** Thêm cột `description`, `icon_emoji`, `icon_file_id` vào `workspaces` và bảng `workspace_aliases (kind slug|task_prefix)`. `PATCH /workspaces/{id}` nhận thêm các trường tuỳ chọn, ghi một dòng audit `workspace.updated`. Ảnh icon đi theo FileService như avatar. Tra slug/mã task cũ đi qua alias. Client redirect slug cũ trong `useDashboardGuard`, nghe `workspace.updated` để làm mới.

**Tech Stack:** Go (Chi, pgx, sqlc), PostgreSQL, TypeScript (React, TanStack Query, zod, Vitest, Testing Library), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-workspace-info-edit-design.md`

## Global Constraints

- Migration mới tên `999<13 chữ số unix-ms>_<name>`, prefix lớn hơn `9991792000000001` (migration đã áp dụng của nhánh MCP). Plan dùng `9991792100000000`–`9991792100000005`; nếu nhánh khác đã chiếm, tăng lên, giữ thứ tự.
- Không `FOREIGN KEY`/`REFERENCES`, không cascade. Mỗi index một file, `CREATE [UNIQUE] INDEX CONCURRENTLY`. Mỗi `.up.sql` có `.down.sql`.
- Bảng tenant mới có `organization_id TEXT NOT NULL` ngay migration đầu. Id là ULID `util.NewID()`.
- Query sqlc chạm bảng tenant: có `organization_id = sqlc.arg(...)`/`workspace_id = sqlc.arg(...)`, **hoặc** dòng `-- tenant: <by-id|self|token|system|platform|parent col>`, **không bao giờ cả hai** (`TestEveryQueryNamesItsTenant`). `sqlc.narg` không được tính là tham số tenant.
- Sau khi sửa `server/pkg/db/queries/*.sql`: chạy `make sqlc` và commit `server/pkg/db/generated/`.
- Mọi lệnh đổi trạng thái ghi audit + outbox qua `auditRecorder.Record` trong cùng transaction. Event `workspace.updated` giữ payload `workspace_id`, `organization_id`; catalogue không đổi.
- Giới hạn: mô tả ≤ 500 rune (trim); emoji 1–16 rune, không khoảng trắng; tiền tố `^[A-Z][A-Z0-9]{1,9}$` (upper-case trước khi kiểm); slug theo `ValidateSlug` (2–40, `[a-z0-9]+(-[a-z0-9]+)*`, không reserved); ảnh ≤ 2 MiB, PNG/JPEG/GIF/WebP.
- Quyền: owner hoặc admin workspace (org owner/admin được tính là admin qua `RequireMember`).
- Frontend: không cast JSON mạng; chỉ `packages/core/api/endpoints/` parse bằng `parseWithFallback`; mỗi endpoint có ca malformed-response. Trường mới của `WorkspaceSchema` là `z.string().optional().catch(undefined)`.
- `packages/views/`: không `next/*`; mọi text JSX qua `t()`; khoá i18n thêm ở cả `vi.json` và `en.json`; file `.ts/.tsx` ≤ 500 dòng; không export thừa (`pnpm knip`).
- Comment code bằng tiếng Anh. Commit `feat(scope)|fix(scope)|test(scope)|docs|…`, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Không chạy `make check` (yêu cầu của người dùng). Mỗi task chạy lệnh test hẹp ghi trong task. Lệnh Go chạy trong `server/`, cần DB test của worktree (`make test-go` dựng DB test nếu chưa có).
- PR phải nêu issue UniAI `UNI-nnn` (`.github/workflows/uniai-link.yml`). Chưa có issue: tạo trước khi mở PR.

## Review Focus

- Mô tả tiếng Việt dài đúng 500 ký tự (`ệ` = 3 byte) phải được nhận; 501 bị từ chối. Đếm theo rune, không theo byte. Test: Task 1.
- Emoji ghép (`👩🏽‍💻` = 5 rune, cờ `🇻🇳` = 2 rune) phải được nhận làm icon. Test: Task 1.
- Mô tả chỉ có khoảng trắng phải lưu thành `""` và không vẽ dòng phụ rỗng ở picker/switcher. Test: Task 1 (server), Task 5 (picker, switcher).
- Slug gõ có chữ hoa hoặc khoảng trắng (`" Doi-Moi "`) được chuẩn hoá thành `doi-moi` trước khi gửi, không bị server trả 400. Test: Task 10.
- Link cũ sâu kèm query (`/acme/team/tasks/01J8?view=board`) chuyển sang slug mới, giữ nguyên phần sau và query. Test: Task 10, Task 11.

---

## Bản đồ file

| File | Trách nhiệm | Task |
|---|---|---|
| `server/migrations/9991792100000000_workspace_description_icon_emoji.{up,down}.sql` | cột `description`, `icon_emoji` | 1 |
| `server/migrations/9991792100000001_workspace_icon_file.{up,down}.sql` | cột `icon_file_id` + `workspaces_one_icon` | 2 |
| `server/migrations/9991792100000002_file_upload_sessions_workspace_icon.{up,down}.sql` | purpose `workspace_icon` trong 2 CHECK | 2 |
| `server/migrations/9991792100000003_workspace_aliases.{up,down}.sql` | bảng `workspace_aliases` | 7 |
| `server/migrations/9991792100000004_workspace_aliases_slug_idx.{up,down}.sql` | unique index alias slug | 7 |
| `server/migrations/9991792100000005_workspace_aliases_task_prefix_idx.{up,down}.sql` | index alias tiền tố | 7 |
| `server/pkg/db/queries/workspaces.sql` | `UpdateWorkspaceProfile`, `SetWorkspaceIcon…`, query icon, lock slug | 1, 2, 9 |
| `server/pkg/db/queries/workspace_aliases.sql` (mới) | insert/delete/tra alias | 7, 9 |
| `server/pkg/db/queries/file_gc.sql`, `tasks.sql` | tham chiếu file icon; tra mã qua alias | 2, 7 |
| `server/internal/service/workspace.go` | `Update`, tra slug qua alias, lock trong `CreateInOrg` | 1, 2, 7, 9 |
| `server/internal/service/workspace_icon.go` (mới) | `UploadIcon`, `RemoveIcon`, `WorkspaceIconProvider`, `withIconURL` | 2 |
| `server/internal/files/types.go`, `registry.go` | purpose `WorkspaceIcon` | 2 |
| `server/internal/service/file_references.go`, `file_wiring.go` | đăng ký `workspaces.icon_file_id` | 2 |
| `server/internal/handler/workspace.go`, `workspace_icon.go` (mới), `dto/sdi/workspace.go`, `dto/sdo/workspace.go`, `router/workspaces.go`, `router/routes.go`, `router.go` | HTTP | 3, 7, 9 |
| `server/internal/handler/isolation_routes_test.go`, `isolation_world_test.go` | route icon multipart; seed alias | 3, 7, 9 |
| `packages/core/types/workspace.ts`, `api/endpoints/workspaces.ts`, `workspaces/hooks.ts`, `workspaces/keys.ts`, `realtime/use-realtime-sync.ts` | client core | 4 |
| `packages/views/layout/workspace-icon.tsx` (mới), `workspace-switcher.tsx`, `workspace/workspace-picker-view.tsx` | hiển thị icon + mô tả | 5 |
| `packages/views/settings/components/workspace-tab.tsx`, `workspace-icon-field.tsx` (mới), `workspace-task-prefix-dialog.tsx` (mới), `workspace-slug-dialog.tsx` (mới) | tab Cài đặt | 6, 8, 10 |
| `packages/views/layout/use-dashboard-guard.ts` | redirect slug cũ | 10 |
| `packages/core/i18n/locales/{vi,en}.json` | khoá `settings.workspace.*` | 6, 8, 10 |
| `e2e/workspace-settings.spec.ts` (mới) | đổi slug end-to-end | 11 |

---

### Task 1: Backend — mô tả và icon emoji

**Files:**
- Create: `server/migrations/9991792100000000_workspace_description_icon_emoji.up.sql`, `.down.sql`
- Modify: `server/pkg/db/queries/workspaces.sql` (thay `UpdateWorkspaceName`)
- Modify: `server/internal/service/workspace.go:64-70` (`viewFromInOrgRow`), `:287-348` (`UpdateWorkspaceInput`, `Update`)
- Regenerate: `server/pkg/db/generated/`
- Test: `server/internal/service/workspace_test.go`

**Interfaces:**
- Consumes: không.
- Produces:
  - `type UpdateWorkspaceInput struct { Name, Description, IconEmoji *string }` (Task 7 thêm `TaskPrefix`, Task 9 thêm `Slug`).
  - `func (s *WorkspaceService) requireWorkspaceAdmin(ctx context.Context, userID, workspaceID string) (db.Workspace, error)`
  - `func recordWorkspaceUpdated(ctx context.Context, q *db.Queries, userID string, w db.Workspace, from, to map[string]any) error`
  - `func normalizeWorkspaceInput(in UpdateWorkspaceInput) (UpdateWorkspaceInput, error)`
  - `func workspaceChanges(before db.Workspace, in UpdateWorkspaceInput) (from, to map[string]any)`
  - `func (s *WorkspaceService) applyWorkspaceChanges(ctx context.Context, q *db.Queries, before db.Workspace, in UpdateWorkspaceInput, to map[string]any) error`
  - sqlc: `UpdateWorkspaceProfile(ctx, db.UpdateWorkspaceProfileParams{ID, OrganizationID string; Name, Description pgtype.Text})`, `SetWorkspaceIconEmoji(ctx, db.SetWorkspaceIconEmojiParams{ID, OrganizationID string; IconEmoji pgtype.Text})`
  - `db.Workspace` có thêm `Description string`, `IconEmoji pgtype.Text`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `server/internal/service/workspace_test.go`:

```go
func TestWorkspaceUpdateDescriptionAndEmoji(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	desc, emoji := "  Nhóm làm sản phẩm  ", "🚀"
	got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Description: &desc, IconEmoji: &emoji})
	if err != nil {
		t.Fatal(err)
	}
	if got.Description != "Nhóm làm sản phẩm" || got.IconEmoji.String != "🚀" {
		t.Fatalf("after update: %+v", got.Workspace)
	}
	clear, blank := "", "   "
	got, err = f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &clear, Description: &blank})
	if err != nil {
		t.Fatal(err)
	}
	if got.IconEmoji.Valid || got.Description != "" {
		t.Fatalf("after clearing: %+v", got.Workspace)
	}
}

func TestWorkspaceUpdateCountsRunesAndAcceptsComposedEmoji(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	// 500 Vietnamese letters are 1500 bytes: the cap is on runes.
	long := strings.Repeat("ệ", 500)
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Description: &long}); err != nil {
		t.Fatalf("500 runes: %v", err)
	}
	for _, e := range []string{"👩🏽‍💻", "🇻🇳", "1️⃣"} {
		e := e
		if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &e}); err != nil {
			t.Fatalf("emoji %q: %v", e, err)
		}
	}
}

func TestWorkspaceUpdateRejectsBadInput(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	tooLong := strings.Repeat("ệ", 501)
	spaced, longEmoji := "a b", strings.Repeat("🚀", 17)
	cases := map[string]UpdateWorkspaceInput{
		"nothing sent":         {},
		"description too long": {Description: &tooLong},
		"emoji with a space":   {IconEmoji: &spaced},
		"emoji too long":       {IconEmoji: &longEmoji},
	}
	for name, in := range cases {
		var ve ValidationError
		if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, in); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
}

func TestWorkspaceUpdateSameValueWritesNoAudit(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	same := "Đội Alpha"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Name: &same}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.updated'`, w.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("audit rows for an unchanged name = %d, want 0", n)
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspaceUpdate' -count=1`
Expected: FAIL, lỗi biên dịch `unknown field Description in struct literal of type UpdateWorkspaceInput`.

- [ ] **Step 3: Migration**

`server/migrations/9991792100000000_workspace_description_icon_emoji.up.sql`:

```sql
-- What a workspace says about itself (spec 2026-10-14 §4.1): a short
-- description shown under its name, and an emoji icon. The uploaded image
-- icon comes in its own migration with its file purpose.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon_emoji  TEXT;
```

`server/migrations/9991792100000000_workspace_description_icon_emoji.down.sql`:

```sql
ALTER TABLE workspaces DROP COLUMN IF EXISTS icon_emoji;
ALTER TABLE workspaces DROP COLUMN IF EXISTS description;
```

- [ ] **Step 4: Query**

Trong `server/pkg/db/queries/workspaces.sql`, thay khối `UpdateWorkspaceName` (gồm dòng `-- tenant: by-id`) bằng:

```sql
-- name: UpdateWorkspaceProfile :one
-- A NULL argument keeps the column as it is.
UPDATE workspaces SET
  name        = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  updated_at  = now()
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id')
RETURNING *;

-- name: SetWorkspaceIconEmoji :one
UPDATE workspaces SET icon_emoji = sqlc.narg('icon_emoji'), updated_at = now()
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id')
RETURNING *;
```

Run: `make sqlc`
Expected: `server/pkg/db/generated/workspaces.sql.go` có `UpdateWorkspaceProfileParams`, `SetWorkspaceIconEmojiParams`; `models.go` `Workspace` có `Description string`, `IconEmoji pgtype.Text`; `UpdateWorkspaceName` biến mất.

- [ ] **Step 5: Service**

Trong `server/internal/service/workspace.go`, thêm `"unicode"` vào import. Sửa `viewFromInOrgRow`:

```go
func viewFromInOrgRow(r db.ListWorkspacesInOrgRow) WorkspaceView {
	return WorkspaceView{Workspace: db.Workspace{
		ID: r.ID, OrganizationID: r.OrganizationID, Slug: r.Slug, Name: r.Name,
		CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		MatrixRoomID: r.MatrixRoomID, TaskPrefix: r.TaskPrefix, TaskCounter: r.TaskCounter,
		Description: r.Description, IconEmoji: r.IconEmoji,
	}, OrganizationSlug: r.OrganizationSlug, OrganizationName: r.OrganizationName}
}
```

Nếu `go build` báo lỗi tại `db.ListWorkspacesInOrgRow(r)`: một trong `GetWorkspaceWithOrg`, `GetWorkspaceBySlugs`, `ListWorkspacesForUser` (`queries/workspaces.sql`), `ListWorkspacesInOrg` (`queries/organizations.sql`) liệt kê cột tay thay vì `w.*`. Đổi nó sang `w.*` rồi `make sqlc` lại.

Thay toàn bộ từ `type UpdateWorkspaceInput struct` tới hết hàm `Update` bằng:

```go
type UpdateWorkspaceInput struct {
	Name        *string
	Description *string
	IconEmoji   *string
}

const (
	maxWorkspaceNameRunes        = 100
	maxWorkspaceDescriptionRunes = 500
	maxWorkspaceIconEmojiRunes   = 16
)

// Update changes what an owner or admin may edit about a workspace (spec
// 2026-10-14 §5.1). A nil field keeps its value; a field sent with its
// current value is not a change, and a call that changes nothing writes no
// audit row and no event.
func (s *WorkspaceService) Update(ctx context.Context, userID, workspaceID string, in UpdateWorkspaceInput) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	in, err = normalizeWorkspaceInput(in)
	if err != nil {
		return WorkspaceView{}, err
	}
	from, to := workspaceChanges(before, in)
	if len(to) == 0 {
		return s.GetView(ctx, userID, workspaceID)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if err := s.applyWorkspaceChanges(ctx, q, before, in, to); err != nil {
		return WorkspaceView{}, err
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, before, from, to); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

// requireWorkspaceAdmin is the gate every workspace-settings write shares:
// owner or admin of the workspace (organization owners and admins count as
// admin through RequireMember). It returns the row as it stands.
func (s *WorkspaceService) requireWorkspaceAdmin(ctx context.Context, userID, workspaceID string) (db.Workspace, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.Workspace{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return db.Workspace{}, ErrForbidden
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return w, err
}

// normalizeWorkspaceInput trims and validates every field that was sent.
func normalizeWorkspaceInput(in UpdateWorkspaceInput) (UpdateWorkspaceInput, error) {
	if in.Name == nil && in.Description == nil && in.IconEmoji == nil {
		return in, Invalid("không có thông tin nào để đổi")
	}
	out := UpdateWorkspaceInput{}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return out, Invalid("tên workspace không được để trống")
		}
		if utf8.RuneCountInString(name) > maxWorkspaceNameRunes {
			return out, Invalid("tên workspace quá dài")
		}
		out.Name = &name
	}
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(d) > maxWorkspaceDescriptionRunes {
			return out, Invalid("mô tả workspace tối đa 500 ký tự")
		}
		out.Description = &d
	}
	if in.IconEmoji != nil {
		e := strings.TrimSpace(*in.IconEmoji)
		// shortcut: any short run of non-space characters passes; nothing
		// checks it is really an emoji. Upgrade if people put words here.
		if utf8.RuneCountInString(e) > maxWorkspaceIconEmojiRunes || strings.ContainsFunc(e, unicode.IsSpace) {
			return out, Invalid("icon workspace phải là một emoji")
		}
		out.IconEmoji = &e
	}
	return out, nil
}

// workspaceChanges compares the validated input with the row. from and to
// hold only the fields that change, keyed as the audit diff names them.
func workspaceChanges(before db.Workspace, in UpdateWorkspaceInput) (from, to map[string]any) {
	from, to = map[string]any{}, map[string]any{}
	change := func(key, old, next string) {
		if old != next {
			from[key], to[key] = old, next
		}
	}
	if in.Name != nil {
		change("name", before.Name, *in.Name)
	}
	if in.Description != nil {
		change("description", before.Description, *in.Description)
	}
	if in.IconEmoji != nil {
		change("icon_emoji", before.IconEmoji.String, *in.IconEmoji)
	}
	return from, to
}

// applyWorkspaceChanges writes the changed fields inside the caller's
// transaction; to holds only fields whose value really changes.
func (s *WorkspaceService) applyWorkspaceChanges(ctx context.Context, q *db.Queries, before db.Workspace, in UpdateWorkspaceInput, to map[string]any) error {
	profile := db.UpdateWorkspaceProfileParams{ID: before.ID, OrganizationID: before.OrganizationID}
	if _, ok := to["name"]; ok {
		profile.Name = pgtype.Text{String: *in.Name, Valid: true}
	}
	if _, ok := to["description"]; ok {
		profile.Description = pgtype.Text{String: *in.Description, Valid: true}
	}
	if profile.Name.Valid || profile.Description.Valid {
		if _, err := q.UpdateWorkspaceProfile(ctx, profile); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
	}
	if _, ok := to["icon_emoji"]; ok {
		emoji := pgtype.Text{String: *in.IconEmoji, Valid: *in.IconEmoji != ""}
		if _, err := q.SetWorkspaceIconEmoji(ctx, db.SetWorkspaceIconEmojiParams{
			ID: before.ID, OrganizationID: before.OrganizationID, IconEmoji: emoji,
		}); err != nil {
			return err
		}
	}
	return nil
}

// recordWorkspaceUpdated writes the one audit row and outbox event of a
// workspace-settings change, in the caller's transaction.
func recordWorkspaceUpdated(ctx context.Context, q *db.Queries, userID string, w db.Workspace, from, to map[string]any) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceUpdated,
		ResourceType: "workspace", ResourceID: w.ID,
		Changes: audit.Diff(from, to),
	}, audit.Event{Topic: "workspace.updated", Payload: map[string]string{
		"workspace_id": w.ID, "organization_id": w.OrganizationID,
	}})
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspace|TestEveryAuditedCommandWritesItsRow' -count=1 && go test ./migrations/ -count=1 && go build ./...`
Expected: PASS. `go build ./...` phải biên dịch được cả `internal/handler` (vẫn truyền `Name`).

- [ ] **Step 7: Commit**

```bash
git add server/migrations/9991792100000000_* server/pkg/db/queries/workspaces.sql server/pkg/db/generated server/internal/service/workspace.go server/internal/service/workspace_test.go
git commit -m "feat(workspace): edit description and emoji icon in WorkspaceService.Update

Update now takes optional name, description and icon_emoji; a field sent
with its current value is not a change and writes no audit row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — ảnh icon qua FileService

**Files:**
- Create: `server/migrations/9991792100000001_workspace_icon_file.{up,down}.sql`, `server/migrations/9991792100000002_file_upload_sessions_workspace_icon.{up,down}.sql`
- Create: `server/internal/service/workspace_icon.go`, `server/internal/service/workspace_icon_test.go`
- Modify: `server/internal/files/types.go` (hằng + `purposes`), `server/internal/files/registry.go` (dòng registry)
- Modify: `server/pkg/db/queries/workspaces.sql`, `server/pkg/db/queries/file_gc.sql`
- Modify: `server/internal/service/file_references.go` (`managedFileReferenceSources`), `server/internal/service/file_wiring.go` (`FileReferenceProviders`)
- Modify: `server/internal/service/workspace.go` (`WorkspaceView`, `viewFromInOrgRow`, `applyWorkspaceChanges`, `GetView`, `ListForUser`, `GetBySlugs`)

**Interfaces:**
- Consumes (Task 1): `requireWorkspaceAdmin`, `recordWorkspaceUpdated`, `applyWorkspaceChanges`.
- Produces:
  - `files.WorkspaceIcon UploadPurpose = "workspace_icon"`
  - `type WorkspaceView struct { db.Workspace; OrganizationSlug, OrganizationName string; IconURL string }`
  - `func (s *WorkspaceService) UploadIcon(ctx context.Context, userID, workspaceID, filename string, body io.Reader) (WorkspaceView, error)`
  - `func (s *WorkspaceService) RemoveIcon(ctx context.Context, userID, workspaceID string) (WorkspaceView, error)`
  - `type WorkspaceIconProvider struct{}` (`Name() == "workspaces.icon"`)
  - sqlc: `SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{ID, OrganizationID string; IconEmoji, IconFileID pgtype.Text})` thay `SetWorkspaceIconEmoji`; `GetWorkspaceIconFileIDForUpdate`, `ListWorkspaceIconFileIDs`, `FileGCWorkspaceIconRefTenants`.
  - `db.Workspace.IconFileID pgtype.Text`.

- [ ] **Step 1: Viết test thất bại**

`server/internal/service/workspace_icon_test.go`:

```go
package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// workspaceIconPNG is a 1x1 PNG: the smallest file the image allowlist takes.
var workspaceIconPNG = func() []byte {
	b, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==")
	if err != nil {
		panic(err)
	}
	return b
}()

func iconFixture(t *testing.T) (wsFix, WorkspaceView) {
	t.Helper()
	f := wsFixture(t)
	f.ws.SetFiles(filesfake.New(filesfake.Options{}))
	w, err := f.ws.CreateInOrg(context.Background(), f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	return f, w
}

func TestWorkspaceUploadIconReplacesEmojiAndOldFile(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	emoji := "🚀"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &emoji}); err != nil {
		t.Fatal(err)
	}
	first, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	if first.IconEmoji.Valid || !first.IconFileID.Valid {
		t.Fatalf("after upload: %+v", first.Workspace)
	}
	if first.IconURL != "fake://presign/"+first.IconFileID.String {
		t.Fatalf("icon url = %q", first.IconURL)
	}
	second, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo2.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	oldID, newID := files.FileID(first.IconFileID.String), files.FileID(second.IconFileID.String)
	held, err := WorkspaceIconProvider{}.HeldBy(ctx, f.q, []files.FileID{oldID, newID})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[oldID]; ok || len(held) != 1 {
		t.Fatalf("held = %v, want only the current icon %s", held, newID)
	}
}

func TestWorkspaceEmojiReplacesUploadedIcon(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	up, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	emoji := "🎯"
	got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &emoji})
	if err != nil {
		t.Fatal(err)
	}
	if got.IconFileID.Valid || got.IconURL != "" || got.IconEmoji.String != "🎯" {
		t.Fatalf("after emoji: %+v url=%q", got.Workspace, got.IconURL)
	}
	held, err := WorkspaceIconProvider{}.HeldBy(ctx, f.q, []files.FileID{files.FileID(up.IconFileID.String)})
	if err != nil || len(held) != 0 {
		t.Fatalf("released file still held: %v %v", held, err)
	}
}

func TestWorkspaceRemoveIcon(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	// Nothing to remove is a no-op, not an error and not an audit row.
	if _, err := f.ws.RemoveIcon(ctx, f.ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	got, err := f.ws.RemoveIcon(ctx, f.ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.IconFileID.Valid || got.IconEmoji.Valid {
		t.Fatalf("after remove: %+v", got.Workspace)
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.updated'`, w.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("audit rows = %d, want 2 (upload, remove)", n)
	}
}

func TestWorkspaceIconRejectsNonImagesAndNonMembers(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	var ce CodedError
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "x.png", bytes.NewReader([]byte("not a picture"))); !errors.As(err, &ce) || ce.Status != 415 {
		t.Fatalf("text upload: %v", err)
	}
	if _, err := f.ws.UploadIcon(ctx, f.ub.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG)); err == nil {
		t.Fatal("a non-member uploaded an icon")
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspace.*Icon' -count=1`
Expected: FAIL, `f.ws.UploadIcon undefined`.

- [ ] **Step 3: Migrations**

`server/migrations/9991792100000001_workspace_icon_file.up.sql`:

```sql
-- The uploaded workspace icon (spec 2026-10-14 §4.1), a file of purpose
-- workspace_icon. A workspace shows an emoji or a file, never both.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon_file_id TEXT,
  ADD CONSTRAINT workspaces_one_icon CHECK (icon_emoji IS NULL OR icon_file_id IS NULL);
```

`server/migrations/9991792100000001_workspace_icon_file.down.sql`:

```sql
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_one_icon;
ALTER TABLE workspaces DROP COLUMN IF EXISTS icon_file_id;
```

`server/migrations/9991792100000002_file_upload_sessions_workspace_icon.up.sql`:

```sql
-- workspace_icon joins the org + workspace branch (spec 2026-10-14 §5.4).
-- Both checks are restated in full, as every purpose change before this did.
ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_purpose_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_purpose_check
  CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                     'task_comment_attachment', 'chat_attachment', 'chat_voice',
                     'chat_call_recording', 'meeting_recording', 'audit_export',
                     'document_file', 'document_asset', 'tenant_export',
                     'workspace_icon'));

ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_scope_matches_purpose;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_scope_matches_purpose
  CHECK (
       (purpose = 'user_avatar'
        AND organization_id IS NULL AND workspace_id IS NULL AND user_id IS NOT NULL)
    OR (purpose IN ('audit_export', 'tenant_export')
        AND organization_id IS NOT NULL AND workspace_id IS NULL)
    OR (purpose IN ('task_attachment', 'task_description_image',
                    'task_comment_attachment', 'meeting_recording',
                    'document_file', 'document_asset', 'workspace_icon')
        AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
    OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording')
        AND organization_id IS NOT NULL)
  );
```

`server/migrations/9991792100000002_file_upload_sessions_workspace_icon.down.sql`:

```sql
-- Sessions of the purpose being removed would fail the narrower checks.
DELETE FROM file_upload_sessions WHERE purpose = 'workspace_icon';

ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_purpose_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_purpose_check
  CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                     'task_comment_attachment', 'chat_attachment', 'chat_voice',
                     'chat_call_recording', 'meeting_recording', 'audit_export',
                     'document_file', 'document_asset', 'tenant_export'));

ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_scope_matches_purpose;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_scope_matches_purpose
  CHECK (
       (purpose = 'user_avatar'
        AND organization_id IS NULL AND workspace_id IS NULL AND user_id IS NOT NULL)
    OR (purpose IN ('audit_export', 'tenant_export')
        AND organization_id IS NOT NULL AND workspace_id IS NULL)
    OR (purpose IN ('task_attachment', 'task_description_image',
                    'task_comment_attachment', 'meeting_recording',
                    'document_file', 'document_asset')
        AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
    OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording')
        AND organization_id IS NOT NULL)
  );
```

So file down với `server/migrations/9991791800000000_data_subject_requests.up.sql`: down phải khôi phục đúng văn bản ràng buộc đó.

- [ ] **Step 4: Purpose**

`server/internal/files/types.go`: thêm `WorkspaceIcon UploadPurpose = "workspace_icon"` vào cuối khối `const`, và `WorkspaceIcon,` vào cuối slice `purposes`.

`server/internal/files/registry.go`: thêm vào cuối slice `[]PurposeSpec{...}` mà `DefaultRegistry` trả về:

```go
		{
			Purpose: WorkspaceIcon,
			Prefix:  "workspace-icons",
			Scope:   ScopeOrgWorkspace,
			Policy:  Policy{MaxBytes: 2 << 20, MIMEAllowlist: imageMIMETypes, ReadMode: ReadPresign},
		},
```

- [ ] **Step 5: Query**

Trong `server/pkg/db/queries/workspaces.sql`, thay khối `SetWorkspaceIconEmoji` bằng:

```sql
-- name: SetWorkspaceIcon :one
-- Writes both icon columns at once: a workspace shows an emoji or a file,
-- never both (workspaces_one_icon).
UPDATE workspaces
SET icon_emoji = sqlc.narg('icon_emoji'), icon_file_id = sqlc.narg('icon_file_id'), updated_at = now()
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id')
RETURNING *;

-- name: GetWorkspaceIconFileIDForUpdate :one
SELECT icon_file_id FROM workspaces
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id')
FOR UPDATE;

-- name: ListWorkspaceIconFileIDs :many
-- tenant: system
-- FileService asks which of these files a workspace still shows.
SELECT icon_file_id FROM workspaces
WHERE icon_file_id = ANY(sqlc.arg('file_ids')::text[]);
```

Thêm vào cuối `server/pkg/db/queries/file_gc.sql`:

```sql
-- name: FileGCWorkspaceIconRefTenants :many
-- tenant: system
-- workspaces.icon_file_id: the uploaded workspace icon (spec 2026-10-14 §5.4).
SELECT w.icon_file_id AS file_id, w.organization_id
FROM workspaces w
WHERE w.icon_file_id = ANY(sqlc.arg('file_ids')::text[]);
```

Run: `make sqlc`

- [ ] **Step 6: Service**

`server/internal/service/workspace.go`:
- `WorkspaceView` thêm trường cuối:

```go
	// IconURL is the presigned uploaded icon, resolved at read time; "" when
	// there is no file or presigning failed.
	IconURL string
```

- `viewFromInOrgRow` thêm `IconFileID: r.IconFileID,` cạnh `IconEmoji: r.IconEmoji,`.
- `GetView`: thay `return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil` bằng `return s.withIconURL(ctx, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r))), nil`.
- `ListForUser`: thay `out = append(out, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)))` bằng `out = append(out, s.withIconURL(ctx, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r))))`.
- `GetBySlugs`: dòng return cuối thành `return s.withIconURL(ctx, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r))), nil`.
- Trong `applyWorkspaceChanges`, thay khối `if _, ok := to["icon_emoji"]; ok { ... }` bằng:

```go
	if _, ok := to["icon_emoji"]; ok {
		// An emoji replaces an uploaded icon; the file is released in this
		// transaction (spec 2026-10-14 §5.1).
		if before.IconFileID.Valid {
			if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(before.IconFileID.String)}); err != nil {
				return err
			}
		}
		emoji := pgtype.Text{String: *in.IconEmoji, Valid: *in.IconEmoji != ""}
		if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{
			ID: before.ID, OrganizationID: before.OrganizationID, IconEmoji: emoji,
		}); err != nil {
			return err
		}
	}
```

`server/internal/service/workspace_icon.go`:

```go
package service

// Workspace icon file half (spec 2026-10-14 §5.4): the image a workspace
// shows in place of its initial. It mirrors the account avatar
// (avatar_fs.go): upload outside the transaction, claim and release inside
// it, presign when a view is read.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UploadIcon makes an image the workspace icon and drops its emoji. Any
// failure after the upload cancels it, so no claim is left behind.
func (s *WorkspaceService) UploadIcon(ctx context.Context, userID, workspaceID, filename string, body io.Reader) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if s.files == nil {
		return WorkspaceView{}, collaborationUnavailable("workspace_icon_storage_missing", "icon workspace chưa khả dụng")
	}
	scope := files.Scope{OrganizationID: before.OrganizationID, WorkspaceID: workspaceID}
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.WorkspaceIcon,
		Scope:          scope,
		IdempotencyKey: "workspace-icon-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return WorkspaceView{}, workspaceIconUploadError(err)
	}
	newID := up.File.ID
	cancel := func() {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: newID})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// As for the avatar, claim and release lock files rows before this
	// transaction locks the workspace row: the first read is plain, and the
	// FOR UPDATE re-read after the files calls serializes a concurrent swap.
	prev, err := q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkspaceView{}, ErrNotFound
		}
		return WorkspaceView{}, err
	}
	var replaces []files.FileID
	if prev.IconFileID.Valid && prev.IconFileID.String != "" {
		replaces = []files.FileID{files.FileID(prev.IconFileID.String)}
	}
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.WorkspaceIcon, Scope: scope,
		FileIDs: []files.FileID{newID}, Replaces: replaces,
	}); err != nil {
		cancel()
		return WorkspaceView{}, filesError(err)
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	cur, err := q.GetWorkspaceIconFileIDForUpdate(ctx, db.GetWorkspaceIconFileIDForUpdateParams{ID: workspaceID, OrganizationID: prev.OrganizationID})
	if err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	if cur != prev.IconFileID {
		cancel()
		return WorkspaceView{}, ErrConflict
	}
	if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{
		ID: workspaceID, OrganizationID: prev.OrganizationID,
		IconFileID: pgtype.Text{String: string(newID), Valid: true},
	}); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, prev,
		map[string]any{"icon": workspaceIconLabel(prev)}, map[string]any{"icon": "file:" + string(newID)},
	); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

// RemoveIcon drops the emoji or the file, so the workspace shows its initial
// again. A workspace with no icon is left alone and nothing is recorded.
func (s *WorkspaceService) RemoveIcon(ctx context.Context, userID, workspaceID string) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if !before.IconEmoji.Valid && !before.IconFileID.Valid {
		return s.GetView(ctx, userID, workspaceID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if before.IconFileID.Valid {
		if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(before.IconFileID.String)}); err != nil {
			return WorkspaceView{}, err
		}
	}
	if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{ID: before.ID, OrganizationID: before.OrganizationID}); err != nil {
		return WorkspaceView{}, err
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, before,
		map[string]any{"icon": workspaceIconLabel(before)}, map[string]any{"icon": ""},
	); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

// workspaceIconLabel names the icon in an audit diff: the emoji, the file id,
// or "" for the initial.
func workspaceIconLabel(w db.Workspace) string {
	switch {
	case w.IconFileID.Valid:
		return "file:" + w.IconFileID.String
	case w.IconEmoji.Valid:
		return w.IconEmoji.String
	default:
		return ""
	}
}

// workspaceIconUploadError keeps the codes the avatar endpoint publishes, so
// the client reads one vocabulary for both images.
func workspaceIconUploadError(err error) error {
	var fe *files.Error
	if errors.As(err, &fe) {
		switch fe.Code {
		case files.CodeTooLarge:
			return coded(http.StatusRequestEntityTooLarge, "too_large", "icon workspace vượt quá giới hạn 2 MiB")
		case files.CodeTypeRejected:
			return coded(http.StatusUnsupportedMediaType, "unsupported_media_type", "icon must be a PNG, JPEG, GIF or WebP image")
		}
	}
	return filesError(err)
}

// withIconURL presigns the uploaded icon, if any. A failure leaves IconURL
// empty and the client falls back to the emoji or the initial (spec §7.5).
func (s *WorkspaceService) withIconURL(ctx context.Context, v WorkspaceView) WorkspaceView {
	if s.files == nil || !v.IconFileID.Valid || v.IconFileID.String == "" {
		return v
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       files.Scope{OrganizationID: v.OrganizationID, WorkspaceID: v.ID},
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(v.IconFileID.String)},
	})
	if err != nil {
		slog.Warn("workspace icon resolve", "workspace_id", v.ID, "err", err)
		return v
	}
	for _, r := range resolved {
		if r.Err == nil && r.URL != "" {
			v.IconURL = r.URL
		}
	}
	return v
}

// WorkspaceIconProvider tells FileService which workspace_icon files a
// workspace still shows.
type WorkspaceIconProvider struct{}

func (WorkspaceIconProvider) Name() string { return "workspaces.icon" }

func (WorkspaceIconProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.WorkspaceIcon}
}

func (WorkspaceIconProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListWorkspaceIconFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		if id.Valid && id.String != "" {
			out[files.FileID(id.String)] = files.HoldActive
		}
	}
	return out, nil
}
```

`server/internal/service/file_wiring.go`: thêm `WorkspaceIconProvider{},` ngay sau `NewUserAvatarProvider(),`.

`server/internal/service/file_references.go`: thêm vào slice của `managedFileReferenceSources()`, ngay sau dòng `users.avatar_file_id`:

```go
		{
			Table: "workspaces", Column: "icon_file_id", Provider: WorkspaceIconProvider{}.Name(),
			tenants: func(ctx context.Context, q *db.Queries, ids []string) ([]fileReferenceTenant, error) {
				rows, err := q.FileGCWorkspaceIconRefTenants(ctx, ids)
				out := make([]fileReferenceTenant, 0, len(rows))
				for _, r := range rows {
					out = append(out, fileReferenceTenant{FileID: files.FileID(r.FileID.String), OrganizationID: r.OrganizationID, Known: true})
				}
				return out, err
			},
		},
```

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspace|TestEveryFileIDColumnHasAReferenceSource|TestFileReference' -count=1 && go test ./internal/files/... ./migrations/ -count=1 && go build ./...`
Expected: PASS. Nếu một test trong `internal/files/filescontract`, `file_service_test.go` hoặc `file_key_root_test.go` liệt kê purpose theo prefix và báo thiếu `workspace_icon`, thêm `workspace_icon` → `workspace-icons` vào bảng của test đó.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/9991792100000001_* server/migrations/9991792100000002_* server/internal/files server/pkg/db server/internal/service
git commit -m "feat(workspace): upload an image as the workspace icon

New files purpose workspace_icon (org + workspace scope, 2 MiB image,
presigned). UploadIcon/RemoveIcon mirror the account avatar flow, and an
emoji releases the uploaded file.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Backend — HTTP cho mô tả, emoji, icon

**Files:**
- Modify: `server/internal/handler/dto/sdi/workspace.go`, `server/internal/handler/dto/sdo/workspace.go`
- Modify: `server/internal/handler/workspace.go` (`toWorkspaceDTO`, `patchWorkspace`)
- Create: `server/internal/handler/workspace_icon.go`, `server/internal/handler/workspace_icon_test.go`
- Modify: `server/internal/handler/router/workspaces.go`, `server/internal/handler/router/routes.go` (~dòng 128), `server/internal/handler/router.go` (~dòng 346)
- Modify: `server/internal/handler/isolation_routes_test.go` (~dòng 489)

**Interfaces:**
- Consumes: `UpdateWorkspaceInput{Name, Description, IconEmoji}`, `UploadIcon`, `RemoveIcon`, `WorkspaceView.IconURL`.
- Produces (HTTP):
  - `PATCH /api/v1/workspaces/{workspaceID}` body `{name?, description?, icon_emoji?}` → `{workspace}`.
  - `POST /api/v1/workspaces/{workspaceID}/icon` multipart `file` → `{workspace}`.
  - `DELETE /api/v1/workspaces/{workspaceID}/icon` → `{workspace}` (200).
  - `WorkspaceDTO` thêm `description`, `icon_emoji`, `icon_url`, `task_prefix` (luôn có, chuỗi rỗng nếu chưa đặt).

- [ ] **Step 1: Viết test thất bại**

`server/internal/handler/workspace_icon_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

var workspaceIconPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==")

// workspaceForProfileTest registers a verified owner with one workspace on a
// server whose WorkspaceService has a fake FileService.
func workspaceForProfileTest(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Workspaces.SetFiles(filesfake.New(filesfake.Options{}))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "profile@example.com", "password": "password123", "display_name": "Profile",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if res.StatusCode != 201 {
		t.Fatalf("create workspace: %d %v", res.StatusCode, out)
	}
	return srv, token, out["workspace"].(map[string]any)["id"].(string)
}

func postWorkspaceIcon(t *testing.T, srv *httptest.Server, token, wsID string, content []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", "logo.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/workspaces/"+wsID+"/icon", &body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestPatchWorkspaceProfileFields(t *testing.T) {
	srv, token, wsID := workspaceForProfileTest(t)
	res, out := doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID, token, map[string]string{
		"description": "Nhóm làm sản phẩm", "icon_emoji": "🚀",
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}
	ws := out["workspace"].(map[string]any)
	if ws["description"] != "Nhóm làm sản phẩm" || ws["icon_emoji"] != "🚀" || ws["icon_url"] != "" || ws["task_prefix"] == "" {
		t.Fatalf("workspace = %v", ws)
	}
	if res, _ := doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID, token, map[string]string{}); res.StatusCode != 400 {
		t.Fatalf("empty patch: %d, want 400", res.StatusCode)
	}
}

func TestWorkspaceIconUploadAndRemove(t *testing.T) {
	srv, token, wsID := workspaceForProfileTest(t)
	if res := postWorkspaceIcon(t, srv, token, wsID, workspaceIconPNG); res.StatusCode != 200 {
		t.Fatalf("upload: %d", res.StatusCode)
	}
	if res := postWorkspaceIcon(t, srv, token, wsID, []byte("not a picture")); res.StatusCode != 415 {
		t.Fatalf("text upload: %d, want 415", res.StatusCode)
	}
	res, out := doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/icon", token, nil)
	if res.StatusCode != 200 || out["workspace"].(map[string]any)["icon_url"] != "" {
		t.Fatalf("remove: %d %v", res.StatusCode, out)
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd server && go test ./internal/handler/ -run 'TestPatchWorkspaceProfileFields|TestWorkspaceIconUploadAndRemove' -count=1`
Expected: FAIL (`description` không có trong response; route icon 404/405).

- [ ] **Step 3: DTO**

`server/internal/handler/dto/sdi/workspace.go`, thay `PatchWorkspaceSDI` và thêm SDI upload:

```go
// PatchWorkspaceSDI is PATCH /api/v1/workspaces/{workspaceID}. A field left
// out keeps its value.
type PatchWorkspaceSDI struct {
	Name        *string `json:"name" description:"Tên workspace mới" example:"Team"`
	Description *string `json:"description" description:"Mô tả ngắn, tối đa 500 ký tự; chuỗi rỗng để xoá" example:"Nhóm làm sản phẩm"`
	IconEmoji   *string `json:"icon_emoji" description:"Emoji làm icon; chuỗi rỗng để xoá. Đặt emoji sẽ bỏ ảnh icon" example:"🚀"`
}

// UploadWorkspaceIconSDI is POST /api/v1/workspaces/{workspaceID}/icon (multipart).
type UploadWorkspaceIconSDI struct {
	File []byte `formData:"file" description:"Ảnh PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB"`
}
```

`server/internal/handler/dto/sdo/workspace.go`, thêm vào `WorkspaceDTO` sau `OrganizationName`:

```go
	Description string `json:"description" description:"Mô tả workspace, rỗng nếu chưa có" example:"Nhóm làm sản phẩm"`
	IconEmoji   string `json:"icon_emoji" description:"Emoji icon, rỗng nếu không dùng" example:"🚀"`
	IconURL     string `json:"icon_url" description:"URL ảnh icon đã ký, rỗng nếu không có ảnh" example:"https://cdn.example.com/workspace-icons/01J8X4.png"`
	TaskPrefix  string `json:"task_prefix" description:"Tiền tố mã task, ví dụ TASK trong TASK-12" example:"TASK"`
```

- [ ] **Step 4: Handler**

`server/internal/handler/workspace.go`:

```go
func toWorkspaceDTO(w service.WorkspaceView) sdo.WorkspaceDTO {
	return sdo.WorkspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name, OrganizationID: w.OrganizationID,
		OrganizationSlug: w.OrganizationSlug, OrganizationName: w.OrganizationName,
		Description: w.Description, IconEmoji: w.IconEmoji.String, IconURL: w.IconURL, TaskPrefix: w.TaskPrefix}
}
```

Trong `patchWorkspace`, thay `service.UpdateWorkspaceInput{Name: in.Name}` bằng `service.UpdateWorkspaceInput{Name: in.Name, Description: in.Description, IconEmoji: in.IconEmoji}`.

`server/internal/handler/workspace_icon.go` (chép đúng khối import `chi`/`middleware`/`sdo` từ `workspace.go` nếu đường dẫn khác):

```go
package handler

import (
	"errors"
	"fmt"
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxWorkspaceIconBytes mirrors the workspace_icon purpose cap.
const maxWorkspaceIconBytes = 2 << 20

func (h *handlers) uploadWorkspaceIcon(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWorkspaceIconBytes+64<<10)
	file, header, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("icon must be at most %d bytes", maxWorkspaceIconBytes))
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	filename := "icon"
	if header != nil {
		if base := path.Base(header.Filename); base != "" && base != "." && base != ".." {
			filename = base
		}
	}
	ws, err := h.Workspaces.UploadIcon(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), filename, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}

func (h *handlers) removeWorkspaceIcon(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.RemoveIcon(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.WorkspaceSDO{Workspace: toWorkspaceDTO(ws)})
}
```

- [ ] **Step 5: Route**

`server/internal/handler/router/workspaces.go`: đổi `description` của route PATCH thành `"Đổi tên, mô tả hoặc icon emoji của workspace; trường không gửi giữ nguyên. Cần admin workspace (hoặc owner/admin tổ chức)."` và thêm ngay sau nó:

```go
	r.Post("/workspaces/{workspaceID}/icon", h.UploadWorkspaceIcon, apiOp{
		summary:     "Upload workspace icon",
		description: "Đặt ảnh làm icon workspace, bỏ emoji nếu có. Tên field multipart là file. PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB. Cần admin workspace.",
		tags:        []string{"workspaces"},
		sdi:         sdi.UploadWorkspaceIconSDI{},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/icon", h.RemoveWorkspaceIcon, apiOp{
		summary:     "Remove workspace icon",
		description: "Bỏ icon workspace (emoji hoặc ảnh); workspace hiện lại chữ cái đầu của tên. Cần admin workspace.",
		tags:        []string{"workspaces"},
		sdo:         sdo.WorkspaceSDO{},
		auth:        true,
	})
```

`server/internal/handler/router/routes.go`: thêm `UploadWorkspaceIcon http.HandlerFunc` và `RemoveWorkspaceIcon http.HandlerFunc` ngay dưới `PatchWorkspace`. `server/internal/handler/router.go` (trong `handler.New`): thêm `UploadWorkspaceIcon: h.uploadWorkspaceIcon,` và `RemoveWorkspaceIcon: h.removeWorkspaceIcon,` ngay dưới `PatchWorkspace: h.patchWorkspace,`.

`server/internal/handler/isolation_routes_test.go`: thêm vào `isoRoutes`, cạnh dòng `"POST /api/v1/workspaces/{workspaceID}/attachments"`:

```go
	"POST /api/v1/workspaces/{workspaceID}/icon": {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `cd server && go test ./internal/handler/ -run 'TestPatchWorkspaceProfileFields|TestWorkspaceIconUploadAndRemove|TestIsolationMatrix' -count=1 && go test ./internal/handler/router/ -count=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/handler
git commit -m "feat(workspace): HTTP for description, emoji and image icon

PATCH /workspaces/{id} takes description and icon_emoji; POST/DELETE
/workspaces/{id}/icon upload and remove the image. WorkspaceDTO now
carries description, icon_emoji, icon_url and task_prefix.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core — schema, endpoint, hook, realtime

**Files:**
- Modify: `packages/core/types/workspace.ts`, `packages/core/api/endpoints/workspaces.ts`, `packages/core/workspaces/hooks.ts`, `packages/core/workspaces/keys.ts`, `packages/core/realtime/use-realtime-sync.ts`
- Test: `packages/core/api/endpoints/workspaces.test.ts`, `packages/core/workspaces/hooks.profile.test.tsx` (mới), `packages/core/realtime/use-realtime-sync.test.tsx`

**Interfaces:**
- Consumes (HTTP, Task 3).
- Produces:
  - `Workspace` có thêm `description?: string; icon_emoji?: string; icon_url?: string; task_prefix?: string`.
  - `export interface WorkspacePatch { name?: string; description?: string; icon_emoji?: string; slug?: string; task_prefix?: string }`
  - `patchWorkspace(workspaceId: string, body: WorkspacePatch): Promise<Workspace | null>`
  - `uploadWorkspaceIcon(workspaceId: string, file: File): Promise<Workspace | null>`, `removeWorkspaceIcon(workspaceId: string): Promise<Workspace | null>`
  - `usePatchWorkspace(orgSlug, wsSlug)` → mutation nhận `{ wsId: string } & WorkspacePatch`
  - `useUploadWorkspaceIcon(orgSlug, wsSlug)` → `{ wsId, file }`; `useRemoveWorkspaceIcon(orgSlug, wsSlug)` → `{ wsId }`
  - `workspaceKeys.allBySlugs(): readonly ["workspace"]`

- [ ] **Step 1: Viết test thất bại**

Trong `packages/core/api/endpoints/workspaces.test.ts`, thêm `removeWorkspaceIcon, uploadWorkspaceIcon` vào import từ `./workspaces`, rồi thêm vào trong `describe`:

```ts
  it("patchWorkspace sends only the fields it is given", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, description: "Mô tả", icon_emoji: "🚀" } }));
    const got = await patchWorkspace("ws1", { description: "Mô tả", icon_emoji: "🚀" });
    expect(got?.description).toBe("Mô tả");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ description: "Mô tả", icon_emoji: "🚀" });
  });

  it("parses a workspace from a server that does not send the profile fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: ws }));
    const got = await getBySlugs("acme", "team");
    expect(got?.id).toBe("ws1");
    expect(got?.description).toBeUndefined();
    expect(got?.icon_url).toBeUndefined();
  });

  it("drops a profile field of the wrong type instead of dropping the workspace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, description: 42, icon_url: null } }));
    const got = await getBySlugs("acme", "team");
    expect(got?.id).toBe("ws1");
    expect(got?.description).toBeUndefined();
    expect(got?.icon_url).toBeUndefined();
  });

  it("uploadWorkspaceIcon posts multipart and returns the workspace or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, icon_url: "https://cdn/i.png" } }));
    const file = new File(["x"], "i.png", { type: "image/png" });
    expect((await uploadWorkspaceIcon("ws1", file))?.icon_url).toBe("https://cdn/i.png");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/ws1/icon");
    expect(init.body).toBeInstanceOf(FormData);
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(uploadWorkspaceIcon("ws1", file)).resolves.toBeNull();
  });

  it("removeWorkspaceIcon sends DELETE and returns the workspace or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: ws }));
    expect((await removeWorkspaceIcon("ws1"))?.id).toBe("ws1");
    expect(vi.mocked(fetch).mock.calls[0]![1]!.method).toBe("DELETE");
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(removeWorkspaceIcon("ws1")).resolves.toBeNull();
  });
```

`packages/core/workspaces/hooks.profile.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/endpoints/workspaces")>();
  return { ...actual, patchWorkspace: vi.fn(), uploadWorkspaceIcon: vi.fn(), removeWorkspaceIcon: vi.fn() };
});

import * as workspaces from "../api/endpoints/workspaces";
import { usePatchWorkspace, useRemoveWorkspaceIcon, useUploadWorkspaceIcon } from "./hooks";
import { workspaceKeys } from "./keys";

function setup<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  return { result, invalidate };
}

function expectWorkspaceRefreshed(invalidate: { mock: { calls: unknown[][] } }) {
  expect(invalidate.mock.calls).toContainEqual([{ queryKey: workspaceKeys.list() }]);
  expect(invalidate.mock.calls).toContainEqual([{ queryKey: workspaceKeys.bySlugs("acme", "team") }]);
}

describe("workspace profile mutations", () => {
  beforeEach(() => {
    vi.mocked(workspaces.patchWorkspace).mockReset().mockResolvedValue(null);
    vi.mocked(workspaces.uploadWorkspaceIcon).mockReset().mockResolvedValue(null);
    vi.mocked(workspaces.removeWorkspaceIcon).mockReset().mockResolvedValue(null);
  });

  it("patches any profile field and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => usePatchWorkspace("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1", description: "Mô tả" });
    expect(workspaces.patchWorkspace).toHaveBeenCalledWith("ws1", { description: "Mô tả" });
    expectWorkspaceRefreshed(invalidate);
  });

  it("uploads the icon and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => useUploadWorkspaceIcon("acme", "team"));
    const file = new File(["x"], "i.png", { type: "image/png" });
    await result.current.mutateAsync({ wsId: "ws1", file });
    expect(workspaces.uploadWorkspaceIcon).toHaveBeenCalledWith("ws1", file);
    expectWorkspaceRefreshed(invalidate);
  });

  it("removes the icon and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => useRemoveWorkspaceIcon("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1" });
    expect(workspaces.removeWorkspaceIcon).toHaveBeenCalledWith("ws1");
    expectWorkspaceRefreshed(invalidate);
  });
});
```

Trong `packages/core/realtime/use-realtime-sync.test.tsx`, thêm vào `describe("useRealtimeSync")`:

```tsx
  it("refreshes the workspace list and every open workspace on workspace.updated", () => {
    vi.useFakeTimers();
    const { invalidate, client } = setup();
    client.emit({ type: "workspace.updated", payload: { workspace_id: "ws1", organization_id: "o1" } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(keysCalled(invalidate)).toEqual(
      expect.arrayContaining([JSON.stringify(["workspaces"]), JSON.stringify(["workspace"])]),
    );
  });
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/workspaces.test.ts workspaces/hooks.profile.test.tsx realtime/use-realtime-sync.test.tsx`
Expected: FAIL (`uploadWorkspaceIcon` không export; `useUploadWorkspaceIcon` không tồn tại; realtime không invalidate `["workspace"]`).

- [ ] **Step 3: Schema và endpoint**

`packages/core/types/workspace.ts`, thêm vào cuối `WorkspaceSchema` (sau `organization_name`):

```ts
  // Workspace profile (spec 2026-10-14). Optional and forgiving: a server that
  // does not send them, or sends the wrong type, yields undefined, never a
  // dropped workspace. The UI reads undefined as "not set".
  description: z.string().optional().catch(undefined),
  icon_emoji: z.string().optional().catch(undefined),
  icon_url: z.string().optional().catch(undefined),
  task_prefix: z.string().optional().catch(undefined),
```

`packages/core/api/endpoints/workspaces.ts`, thay `patchWorkspace` bằng:

```ts
/** PATCH /workspaces/{id}: a field left out keeps its value. */
export interface WorkspacePatch {
  name?: string;
  description?: string;
  icon_emoji?: string;
  slug?: string;
  task_prefix?: string;
}

export async function patchWorkspace(workspaceId: string, body: WorkspacePatch): Promise<Workspace | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}`, { method: "PATCH", body });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}",
  })?.workspace ?? null;
}

export async function uploadWorkspaceIcon(workspaceId: string, file: File): Promise<Workspace | null> {
  const form = new FormData();
  form.append("file", file);
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/icon`, { method: "POST", body: form });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/icon",
  })?.workspace ?? null;
}

export async function removeWorkspaceIcon(workspaceId: string): Promise<Workspace | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/icon`, { method: "DELETE" });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/icon",
  })?.workspace ?? null;
}
```

- [ ] **Step 4: Hook, key, realtime**

`packages/core/workspaces/keys.ts`, thêm sau `bySlugs`:

```ts
  /** Prefix of every by-slug workspace query, old slugs included. */
  allBySlugs: () => ["workspace"] as const,
```

`packages/core/workspaces/hooks.ts`: đổi import đầu thành `import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";`, thay `usePatchWorkspace` bằng:

```ts
function refreshWorkspace(qc: QueryClient, orgSlug: string, wsSlug: string) {
  void qc.invalidateQueries({ queryKey: workspaceKeys.list() });
  void qc.invalidateQueries({ queryKey: workspaceKeys.bySlugs(orgSlug, wsSlug) });
}

export function usePatchWorkspace(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId, ...body }: { wsId: string } & workspaces.WorkspacePatch) =>
      workspaces.patchWorkspace(wsId, body),
    onSuccess: () => refreshWorkspace(qc, orgSlug, wsSlug),
  });
}

export function useUploadWorkspaceIcon(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId, file }: { wsId: string; file: File }) => workspaces.uploadWorkspaceIcon(wsId, file),
    onSuccess: () => refreshWorkspace(qc, orgSlug, wsSlug),
  });
}

export function useRemoveWorkspaceIcon(orgSlug: string, wsSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wsId }: { wsId: string }) => workspaces.removeWorkspaceIcon(wsId),
    onSuccess: () => refreshWorkspace(qc, orgSlug, wsSlug),
  });
}
```

`packages/core/realtime/use-realtime-sync.ts`: thêm `import { workspaceKeys } from "../workspaces/keys";` vào khối import (theo thứ tự đường dẫn), và thêm case đầu tiên trong `switch (type)`:

```ts
    case "workspace.updated": {
      // Name, description, icon, slug or task prefix changed: the switcher,
      // the picker and the open workspace refetch. The by-slug prefix also
      // covers a workspace opened under an old slug.
      push(workspaceKeys.list());
      push(workspaceKeys.allBySlugs());
      break;
    }
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/workspaces.test.ts workspaces/hooks.profile.test.tsx realtime/use-realtime-sync.test.tsx && pnpm typecheck`
Expected: PASS. `pnpm typecheck` toàn repo xanh vì các trường mới là optional (fixture `Workspace` cũ vẫn hợp lệ).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): workspace profile fields, icon endpoints, realtime refresh

WorkspaceSchema reads description, icon_emoji, icon_url and task_prefix
leniently; patchWorkspace takes any profile field; workspace.updated now
invalidates the workspace list and every by-slug query.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Views — `WorkspaceIcon`, switcher, picker

**Files:**
- Create: `packages/views/layout/workspace-icon.tsx`, `packages/views/layout/workspace-icon.test.tsx`, `packages/views/layout/workspace-switcher.test.tsx`
- Modify: `packages/views/layout/workspace-switcher.tsx`, `packages/views/workspace/workspace-picker-view.tsx:44-61`
- Test: `packages/views/workspace/workspace-picker-view.test.tsx`

**Interfaces:**
- Consumes (Task 4): `Workspace.icon_emoji`, `icon_url`, `description`.
- Produces: `export function WorkspaceIcon({ workspace, className }: { workspace: Pick<Workspace, "name" | "icon_emoji" | "icon_url">; className?: string })` — trang trí (`aria-hidden`), caller lo kích thước/màu qua `className`.

- [ ] **Step 1: Viết test thất bại**

`packages/views/layout/workspace-icon.test.tsx`:

```tsx
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceIcon } from "./workspace-icon";

describe("WorkspaceIcon", () => {
  it("prefers the image, then the emoji, then the initial", () => {
    const { container, rerender } = render(
      <WorkspaceIcon workspace={{ name: "alpha", icon_emoji: "🚀", icon_url: "https://cdn/i.png" }} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn/i.png");
    rerender(<WorkspaceIcon workspace={{ name: "alpha", icon_emoji: "🚀", icon_url: "" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("🚀");
    rerender(<WorkspaceIcon workspace={{ name: " alpha" }} />);
    expect(container).toHaveTextContent("A");
  });

  it("falls back to the emoji or the initial when the image does not load", () => {
    const { container } = render(<WorkspaceIcon workspace={{ name: "alpha", icon_url: "https://cdn/broken.png" }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("A");
  });
});
```

`packages/views/layout/workspace-switcher.test.tsx` (nếu `SidebarProvider` export ở chỗ khác, lấy đúng từ `packages/ui/components/ui/sidebar.tsx`):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceSwitcher } from "./workspace-switcher";

initI18n();

const alpha: Workspace = {
  id: "w1", slug: "alpha", name: "Alpha", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "Nhóm làm sản phẩm", icon_emoji: "🚀",
};
const beta: Workspace = {
  id: "w2", slug: "beta", name: "Beta", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "",
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/workspaces") ? { workspaces: [alpha, beta] } : {}),
  );
});

describe("WorkspaceSwitcher", () => {
  it("shows the emoji on the trigger and each description under its name", async () => {
    render(wrapWithNav(<SidebarProvider><WorkspaceSwitcher current={alpha} /></SidebarProvider>));
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    expect(trigger).toHaveTextContent("🚀");
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /Alpha/ })).toHaveTextContent("Nhóm làm sản phẩm");
    // An empty description draws no second line.
    expect(screen.getByRole("menuitem", { name: /Beta/ }).querySelector(".text-caption")).toBeNull();
  });
});
```

Trong `packages/views/workspace/workspace-picker-view.test.tsx`, thêm vào `describe("WorkspacePickerView")`:

```tsx
  it("shows a description under the workspace name, and no empty line without one", async () => {
    requestMock.mockResolvedValueOnce({
      workspaces: [
        { id: "w1", slug: "a", name: "Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom", description: "Nhóm làm sản phẩm" },
        { id: "w2", slug: "b", name: "Beta", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom", description: "" },
      ],
    });
    render(wrap(<WorkspacePickerView onPick={vi.fn()} onCreate={() => {}} />));
    expect(await screen.findByRole("button", { name: /Alpha/ })).toHaveTextContent("Nhóm làm sản phẩm");
    expect(screen.getByRole("button", { name: /Beta/ }).querySelectorAll("span.block")).toHaveLength(2);
  });
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pnpm --filter @uniwork/views exec vitest run layout/workspace-icon.test.tsx layout/workspace-switcher.test.tsx workspace/workspace-picker-view.test.tsx`
Expected: FAIL (`./workspace-icon` không tồn tại; switcher không hiện emoji; picker không hiện mô tả).

- [ ] **Step 3: Component**

`packages/views/layout/workspace-icon.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A workspace's face: its uploaded image, else its emoji, else the first
 * letter of its name (spec 2026-10-14 §6.3). The caller owns size, shape and
 * colours through className, so each surface keeps the tile it had.
 * Decorative: every caller names the workspace in text or an aria-label.
 */
export function WorkspaceIcon({
  workspace,
  className,
}: {
  workspace: Pick<Workspace, "name" | "icon_emoji" | "icon_url">;
  className?: string;
}) {
  // The URL that failed to load, so a new URL gets its own chance.
  const [broken, setBroken] = useState<string | null>(null);
  const url = workspace.icon_url && workspace.icon_url !== broken ? workspace.icon_url : "";
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center overflow-hidden", className)}>
      {url ? (
        <img src={url} alt="" className="size-full object-cover" onError={() => setBroken(url)} />
      ) : workspace.icon_emoji ? (
        <span className="leading-none">{workspace.icon_emoji}</span>
      ) : (
        workspace.name.trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
```

- [ ] **Step 4: Switcher và picker**

`packages/views/layout/workspace-switcher.tsx`: thêm `import { WorkspaceIcon } from "./workspace-icon";`. Thay span ô chữ cái (khối `<span aria-hidden className="flex size-8 items-center …">{current.name.trim().slice(0, 1).toUpperCase()}</span>`) bằng:

```tsx
          <WorkspaceIcon
            workspace={current}
            className="size-8 rounded-lg bg-sidebar-primary text-body font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:size-6 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:text-caption"
          />
```

Trong `DropdownMenuItem` của từng workspace, thay `<span className="min-w-0 flex-1 truncate">{w.name}</span>` bằng:

```tsx
                <WorkspaceIcon
                  workspace={w}
                  className="size-5 rounded-sm bg-muted text-caption font-semibold text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{w.name}</span>
                  {w.description ? (
                    <span className="block truncate text-caption text-muted-foreground">{w.description}</span>
                  ) : null}
                </span>
```

`packages/views/workspace/workspace-picker-view.tsx`: thêm `import { WorkspaceIcon } from "../layout/workspace-icon";`. Thay span chữ cái (`<span aria-hidden className="flex size-9 …">{w.name.slice(0, 1).toUpperCase()}</span>`) bằng:

```tsx
                <WorkspaceIcon
                  workspace={w}
                  className="size-9 rounded-md bg-primary text-body font-semibold text-primary-foreground"
                />
```

và chèn giữa dòng tên và dòng địa chỉ:

```tsx
                  {w.description ? (
                    <span className="block truncate text-caption text-muted-foreground">{w.description}</span>
                  ) : null}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `pnpm --filter @uniwork/views exec vitest run layout/ workspace/ && pnpm lint`
Expected: PASS; `pnpm lint` không có lỗi mới ở file đã chạm (đọc output: ở `GATE_LEVEL=fast` lint không làm fail exit code).

- [ ] **Step 6: Commit**

```bash
git add packages/views/layout packages/views/workspace
git commit -m "feat(views): workspace icon and description in switcher and picker

WorkspaceIcon draws the uploaded image, the emoji or the initial, falling
back when the image fails to load.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Views — tab Cài đặt: icon và mô tả

**Files:**
- Create: `packages/views/settings/components/workspace-icon-field.tsx`
- Modify: `packages/views/settings/components/workspace-tab.tsx` (viết lại toàn file)
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json` (`settings.workspace`)
- Test: `packages/views/settings/components/workspace-tab.test.tsx`

**Interfaces:**
- Consumes (Task 4, 5): `usePatchWorkspace`, `useUploadWorkspaceIcon`, `useRemoveWorkspaceIcon`, `WorkspaceIcon`.
- Produces: `export function WorkspaceIconField({ workspace }: { workspace: Workspace })`; test helper `renderAs(role, ws?, opts?)`, `callsWith(method)`, `patchBodies()` trong `workspace-tab.test.tsx` (Task 8, 10 dùng lại).

- [ ] **Step 1: Viết test thất bại**

Trong `packages/views/settings/components/workspace-tab.test.tsx`:
- Đổi import đầu: `import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";`.
- Thay `renderAs` bằng:

```tsx
function renderAs(role: string, ws: Workspace = workspace, opts: { patch?: unknown; patchError?: unknown } = {}) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u1", role, source: "membership" } });
    if (init?.method === "PATCH") return opts.patchError ? Promise.reject(opts.patchError) : Promise.resolve(opts.patch ?? {});
    return Promise.resolve({});
  });
  return render(
    wrap(
      <WorkspaceProvider workspace={ws} user={user}>
        <WorkspaceTab />
      </WorkspaceProvider>,
    ),
  );
}

const callsWith = (method: string) =>
  requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === method);
const patchBodies = () => callsWith("PATCH").map(([, init]) => (init as { body?: unknown }).body);
```

- Trong test "flags an empty name…", thay hai dòng cuối (`const patches = …` và `expect(patches)…`) bằng `expect(patchBodies()).toHaveLength(0);`.
- Thêm các test:

```tsx
  it("autosaves the description for an admin", async () => {
    renderAs("admin");
    const box = await screen.findByRole("textbox", { name: "Mô tả" });
    fireEvent.change(box, { target: { value: "Nhóm làm sản phẩm" } });
    fireEvent.blur(box);
    await waitFor(() => expect(patchBodies()).toContainEqual({ description: "Nhóm làm sản phẩm" }));
  });

  it("shows a member the description as text, without icon actions", async () => {
    renderAs("member", { ...workspace, description: "Nhóm làm sản phẩm" });
    expect(await screen.findByText("Nhóm làm sản phẩm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chọn emoji" })).not.toBeInTheDocument();
  });

  it("uploads an image icon and removes an emoji icon", async () => {
    renderAs("admin", { ...workspace, icon_emoji: "🚀" });
    const input = await screen.findByLabelText("Tải ảnh lên", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["x"], "i.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsWith("POST").map(([path]) => path)).toContain("/api/v1/workspaces/ws1/icon"));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ icon" }));
    await waitFor(() => expect(callsWith("DELETE").map(([path]) => path)).toContain("/api/v1/workspaces/ws1/icon"));
  });
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pnpm --filter @uniwork/views exec vitest run settings/components/workspace-tab.test.tsx`
Expected: FAIL (không có textbox "Mô tả", không có input "Tải ảnh lên").

- [ ] **Step 3: i18n**

Đọc `docs/conventions.md` (glossary vi–en, giọng văn) trước khi chốt câu chữ.

`packages/core/i18n/locales/vi.json`, object `settings.workspace`: đổi `"description"` thành `"Tên, mô tả, icon, địa chỉ và tổ chức của workspace này."` và thêm (trước `"name_required"`):

```json
      "about": "Mô tả",
      "about_hint": "Hiện dưới tên workspace ở trang chọn workspace và menu chuyển workspace.",
      "about_placeholder": "Workspace này dùng để làm gì?",
      "about_read_only": "Chỉ chủ sở hữu và quản trị workspace đổi được mô tả.",
      "about_empty": "Chưa có mô tả",
      "about_count": "{{used}}/{{max}}",
      "icon": "Icon",
      "icon_hint": "Emoji hoặc ảnh PNG, JPEG, GIF, WebP tối đa 2 MB. Không có icon thì hiện chữ cái đầu của tên.",
      "icon_pick_emoji": "Chọn emoji",
      "icon_upload": "Tải ảnh lên",
      "icon_remove": "Bỏ icon",
      "icon_error": "Chưa đổi được icon. Thử lại.",
      "icon_upload_error": "Chưa tải được ảnh. Dùng PNG, JPEG, GIF hoặc WebP, tối đa 2 MB.",
```

`packages/core/i18n/locales/en.json`, object `settings.workspace`: đổi `"description"` thành `"This workspace's name, description, icon, address and organization."` và thêm:

```json
      "about": "Description",
      "about_hint": "Shown under the workspace name in the workspace picker and the workspace switcher.",
      "about_placeholder": "What is this workspace for?",
      "about_read_only": "Only workspace owners and admins can change the description.",
      "about_empty": "No description yet",
      "about_count": "{{used}}/{{max}}",
      "icon": "Icon",
      "icon_hint": "An emoji, or a PNG, JPEG, GIF or WebP image up to 2 MB. Without one, the first letter of the name is shown.",
      "icon_pick_emoji": "Choose emoji",
      "icon_upload": "Upload image",
      "icon_remove": "Remove icon",
      "icon_error": "Couldn't change the icon. Try again.",
      "icon_upload_error": "Couldn't upload the image. Use a PNG, JPEG, GIF or WebP up to 2 MB.",
```

- [ ] **Step 4: Icon field**

`packages/views/settings/components/workspace-icon-field.tsx` (nếu lint báo một trong ba icon là alias, dùng tên canonical mà lint gợi ý; xem `docs/conventions.md` › Icons):

```tsx
"use client";

import { ImageUp, SmilePlus, Trash2 } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { usePatchWorkspace, useRemoveWorkspaceIcon, useUploadWorkspaceIcon } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { WorkspaceIcon } from "../../layout/workspace-icon";
import { toastApiError } from "../../toast-api-error";

// emoji-mart ships its whole dataset; load it when the picker opens.
const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((m) => ({ default: m.EmojiPicker })),
);

/** The image types the workspace_icon files purpose accepts. */
const ICON_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** Preview plus the three icon actions an owner or admin has (spec §6.4). */
export function WorkspaceIconField({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const upload = useUploadWorkspaceIcon(workspace.organization_slug, workspace.slug);
  const remove = useRemoveWorkspaceIcon(workspace.organization_slug, workspace.slug);
  const busy = patch.isPending || upload.isPending || remove.isPending;
  const hasIcon = !!workspace.icon_emoji || !!workspace.icon_url;

  const pickEmoji = (emoji: string) => {
    setPickerOpen(false);
    patch.mutate(
      { wsId: workspace.id, icon_emoji: emoji },
      { onError: (err) => toastApiError(err, t("workspace.icon_error")) },
    );
  };

  const uploadFile = (file: File | undefined) => {
    // Clear the input so choosing the same file again still fires change.
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    upload.mutate({ wsId: workspace.id, file }, { onError: (err) => toastApiError(err, t("workspace.icon_upload_error")) });
  };

  return (
    <div className="flex items-center gap-2 sm:justify-end">
      <WorkspaceIcon
        workspace={workspace}
        className="size-10 rounded-lg bg-primary text-title font-semibold text-primary-foreground"
      />
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger render={<Button type="button" variant="outline" size="sm" disabled={busy} />}>
          <SmilePlus aria-hidden />
          {t("workspace.icon_pick_emoji")}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Suspense fallback={<div className="h-80 w-72" aria-hidden />}>
            <EmojiPicker onSelect={pickEmoji} />
          </Suspense>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
        <ImageUp aria-hidden />
        {t("workspace.icon_upload")}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept={ICON_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("workspace.icon_upload")}
        onChange={(e) => uploadFile(e.target.files?.[0])}
      />
      {hasIcon ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("workspace.icon_remove")}
          title={t("workspace.icon_remove")}
          disabled={busy}
          onClick={() =>
            remove.mutate({ wsId: workspace.id }, { onError: (err) => toastApiError(err, t("workspace.icon_error")) })
          }
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Tab**

Thay toàn bộ `packages/views/settings/components/workspace-tab.tsx` bằng:

```tsx
"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { toast } from "sonner";
import { WorkspaceIcon } from "../../layout/workspace-icon";
import { useWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import {
  SettingsCard,
  SettingsFieldError,
  SettingsRow,
  SettingsSaveState,
  type SettingsSaveStatus,
  SettingsTab,
  SettingsValue,
} from "./settings-layout";
import { useAutoSave } from "./use-auto-save";
import { WorkspaceIconField } from "./workspace-icon-field";

function namesEqual(left: string, right: string) {
  return left === right;
}

// The server trims the description, so trailing spaces are not a change.
function descriptionsEqual(left: string, right: string) {
  return left.trim() === right.trim();
}

/** Mirrors maxWorkspaceNameRunes in server/internal/service/workspace.go. */
const MAX_NAME_LENGTH = 100;
/** Mirrors maxWorkspaceDescriptionRunes in server/internal/service/workspace.go. */
const MAX_DESCRIPTION_LENGTH = 500;

/** One indicator for the tab's autosaved fields: the busiest state wins. */
function combinedStatus(...all: SettingsSaveStatus[]): SettingsSaveStatus {
  for (const s of ["saving", "error", "saved"] as const) {
    if (all.includes(s)) return s;
  }
  return "idle";
}

/**
 * What the workspace is called, how it presents itself, where it lives and
 * whom it belongs to (spec 2026-10-14 §6.4). There is no endpoint to delete
 * or archive a workspace, so this tab carries no danger zone.
 */
export function WorkspaceTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const { canUpdateSettings, isLoading: permissionsLoading } = useWorkspacePermissions(workspace.id);
  const patchWorkspace = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const savedDescription = workspace.description ?? "";
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(savedDescription);
  const canEdit = canUpdateSettings.allowed;
  const nameEmpty = name.trim().length === 0;
  const hintId = useId();
  const errorId = useId();
  const aboutHintId = useId();
  const path = paths.workspace(workspace.organization_slug, workspace.slug).root();
  const url = navigation?.getShareableUrl(path) ?? path;

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.id, workspace.name]);

  useEffect(() => {
    setDescription(savedDescription);
  }, [workspace.id, savedDescription]);

  const saveName = useCallback(
    async (nextName: string) => {
      const updated = await patchWorkspace.mutateAsync({ wsId: workspace.id, name: nextName });
      if (!updated) throw new Error(t("save.error"));
    },
    [patchWorkspace, t, workspace.id],
  );

  const saveDescription = useCallback(
    async (next: string) => {
      const updated = await patchWorkspace.mutateAsync({ wsId: workspace.id, description: next });
      if (!updated) throw new Error(t("save.error"));
    },
    [patchWorkspace, t, workspace.id],
  );

  // Autosave reports itself inline; only a failure also raises a toast.
  const nameSave = useAutoSave({
    value: name,
    savedValue: workspace.name,
    onSave: saveName,
    onError: (err) => toastApiError(err, t("save.error")),
    // An empty name is refused by the server; it is flagged inline instead
    // and put back on blur, never sent.
    enabled: canEdit && !nameEmpty,
    isEqual: namesEqual,
  });

  const descriptionSave = useAutoSave({
    value: description,
    savedValue: savedDescription,
    onSave: saveDescription,
    onError: (err) => toastApiError(err, t("save.error")),
    enabled: canEdit,
    isEqual: descriptionsEqual,
  });

  const onNameBlur = () => {
    if (nameEmpty) {
      setName(workspace.name);
      return;
    }
    nameSave.flush();
  };

  const copyUrl = async () => {
    if (await copyText(url)) {
      toast.success(t("workspace.url_copied"));
    } else {
      toast.error(t("workspace.copy_failed"));
    }
  };

  return (
    <SettingsTab
      title={t("page.tabs.workspace")}
      description={t("workspace.description")}
      actions={
        canEdit ? (
          <SettingsSaveState
            status={combinedStatus(nameSave.status, descriptionSave.status)}
            savingLabel={t("save.saving")}
            savedLabel={t("save.saved")}
            errorLabel={t("save.error")}
          />
        ) : null
      }
    >
      <SettingsCard>
        <SettingsRow label={t("workspace.icon")} description={t("workspace.icon_hint")} size="none">
          {canEdit ? (
            <WorkspaceIconField workspace={workspace} />
          ) : (
            <WorkspaceIcon
              workspace={workspace}
              className="size-10 rounded-lg bg-primary text-title font-semibold text-primary-foreground sm:ml-auto"
            />
          )}
        </SettingsRow>
        <SettingsRow
          label={t("workspace.name")}
          description={canEdit || permissionsLoading ? t("workspace.name_hint") : t("workspace.name_read_only")}
          descriptionId={hintId}
          size="text"
        >
          {permissionsLoading ? (
            // Input-sized, so the row does not jump when the field arrives.
            <Skeleton aria-hidden className="h-8 w-full" />
          ) : canEdit ? (
            <div className="space-y-1.5">
              <Input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                aria-label={t("workspace.name")}
                aria-invalid={nameEmpty || undefined}
                aria-describedby={nameEmpty ? `${errorId} ${hintId}` : hintId}
                onChange={(e) => setName(e.target.value)}
                onBlur={onNameBlur}
              />
              {nameEmpty ? <SettingsFieldError id={errorId}>{t("workspace.name_required")}</SettingsFieldError> : null}
            </div>
          ) : (
            <SettingsValue>{workspace.name}</SettingsValue>
          )}
        </SettingsRow>
        <SettingsRow
          label={t("workspace.about")}
          description={canEdit || permissionsLoading ? t("workspace.about_hint") : t("workspace.about_read_only")}
          descriptionId={aboutHintId}
          size="text"
          align="start"
        >
          {permissionsLoading ? (
            <Skeleton aria-hidden className="h-20 w-full" />
          ) : canEdit ? (
            <div className="space-y-1">
              <Textarea
                value={description}
                rows={3}
                maxLength={MAX_DESCRIPTION_LENGTH}
                placeholder={t("workspace.about_placeholder")}
                aria-label={t("workspace.about")}
                aria-describedby={aboutHintId}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => descriptionSave.flush()}
              />
              <p className="text-right text-caption tabular-nums text-muted-foreground">
                {t("workspace.about_count", { used: description.length, max: MAX_DESCRIPTION_LENGTH })}
              </p>
            </div>
          ) : (
            <SettingsValue>{workspace.description || t("workspace.about_empty")}</SettingsValue>
          )}
        </SettingsRow>
        <SettingsRow label={t("workspace.url")} description={t("workspace.url_hint")} size="none">
          <div className="flex min-w-0 items-center gap-2 sm:justify-end">
            <SettingsValue className="min-w-0 font-mono text-caption">{url}</SettingsValue>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("workspace.copy_url")}
              title={t("workspace.copy_url")}
              onClick={() => void copyUrl()}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={t("workspace.organization")} description={t("workspace.organization_hint")} size="text">
          <SettingsValue>{workspace.organization_name}</SettingsValue>
        </SettingsRow>
      </SettingsCard>
    </SettingsTab>
  );
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `pnpm --filter @uniwork/views exec vitest run settings/components/workspace-tab.test.tsx && pnpm lint && pnpm knip`
Expected: PASS. Test "shows a member…" cũ vẫn pass (`getAllByRole("heading")` vẫn là 1). Đọc output lint/knip và sửa mọi lỗi ở file đã chạm.

- [ ] **Step 7: Commit**

```bash
git add packages/views/settings packages/core/i18n/locales
git commit -m "feat(settings): workspace icon and description in the workspace tab

Owners and admins pick an emoji, upload an image or remove the icon, and
the description autosaves like the name; members read both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backend — tiền tố mã task và bảng alias

**Files:**
- Create: `server/migrations/9991792100000003_workspace_aliases.{up,down}.sql`, `9991792100000004_workspace_aliases_slug_idx.{up,down}.sql`, `9991792100000005_workspace_aliases_task_prefix_idx.{up,down}.sql`
- Create: `server/pkg/db/queries/workspace_aliases.sql`
- Modify: `server/pkg/db/queries/workspaces.sql` (`UpdateWorkspaceProfile`), `server/pkg/db/queries/tasks.sql` (`ListTasksByIdentifier`)
- Modify: `server/internal/service/workspace.go` (input, normalize, changes, apply)
- Modify: `server/internal/handler/dto/sdi/workspace.go`, `server/internal/handler/workspace.go`, `server/internal/handler/router/workspaces.go`
- Modify: `server/internal/handler/isolation_world_test.go` (seed alias)
- Test: `server/internal/service/task_query_test.go`, `server/internal/service/workspace_test.go`

**Interfaces:**
- Consumes (Task 1): `normalizeWorkspaceInput`, `workspaceChanges`, `applyWorkspaceChanges`.
- Produces:
  - `UpdateWorkspaceInput.TaskPrefix *string`; SDI `task_prefix`.
  - `func moveWorkspaceAlias(ctx context.Context, q *db.Queries, w db.Workspace, kind, from, to string) error` (Task 9 dùng với `kind = "slug"`).
  - sqlc: `InsertWorkspaceAlias(ctx, db.InsertWorkspaceAliasParams{ID, OrganizationID, WorkspaceID, Kind, Value string})`, `DeleteWorkspaceAlias(ctx, db.DeleteWorkspaceAliasParams{OrganizationID, WorkspaceID, Kind, Value string})`; `UpdateWorkspaceProfileParams` thêm `Slug`, `TaskPrefix pgtype.Text`.
  - `func (w *isoWorld) buildWorkspaceAliases(t *testing.T, tn *isoTenant)` (Task 9 mở rộng).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `server/internal/service/task_query_test.go`:

```go
func TestGetTaskByIdentifierAfterPrefixChange(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Old ref"})
	if err != nil {
		t.Fatal(err)
	}
	n := strconv.FormatInt(task.Number, 10)
	oldRef := w.TaskPrefix + "-" + n
	next := "ZQX"
	if _, err := s.ws.Update(ctx, ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &next}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{"ZQX-" + n, oldRef, strings.ToLower(oldRef)} {
		got, err := s.GetByRef(ctx, actor, ref)
		if err != nil || got.ID != task.ID {
			t.Fatalf("GetByRef(%q) after the change: err=%v id=%s", ref, err, got.ID)
		}
	}
	// Taking the old prefix back keeps both refs working, each matching once.
	back := w.TaskPrefix
	if _, err := s.ws.Update(ctx, ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &back}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{oldRef, "zqx-" + n} {
		got, err := s.GetByRef(ctx, actor, ref)
		if err != nil || got.ID != task.ID {
			t.Fatalf("GetByRef(%q) after going back: err=%v id=%s", ref, err, got.ID)
		}
	}
}
```

Thêm vào `server/internal/service/workspace_test.go`:

```go
func TestWorkspaceTaskPrefixAliases(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	aliases := func() []string {
		rows, err := f.pool.Query(ctx, `SELECT value FROM workspace_aliases WHERE workspace_id = $1 AND kind = 'task_prefix' ORDER BY value`, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		vals, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return vals
	}
	original := w.TaskPrefix
	lower := "mkt"
	got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &lower})
	if err != nil || got.TaskPrefix != "MKT" {
		t.Fatalf("lower-case prefix: %v %q", err, got.TaskPrefix)
	}
	if a := aliases(); len(a) != 1 || a[0] != original {
		t.Fatalf("aliases after %s→MKT = %v", original, a)
	}
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &original}); err != nil {
		t.Fatal(err)
	}
	if a := aliases(); len(a) != 1 || a[0] != "MKT" {
		t.Fatalf("aliases after going back = %v", a)
	}
	for _, bad := range []string{"1AB", "A", "ABCDEFGHIJK", "A-B"} {
		bad := bad
		var ve ValidationError
		if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &bad}); !errors.As(err, &ve) {
			t.Errorf("prefix %q: err = %v, want ValidationError", bad, err)
		}
	}
}
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd server && go test ./internal/service/ -run 'TestGetTaskByIdentifierAfterPrefixChange|TestWorkspaceTaskPrefixAliases' -count=1`
Expected: FAIL, `unknown field TaskPrefix in struct literal of type UpdateWorkspaceInput`.

- [ ] **Step 3: Migrations**

`server/migrations/9991792100000003_workspace_aliases.up.sql`:

```sql
-- Old slugs and task prefixes a workspace still answers to (spec 2026-10-14
-- §4.2): an old slug redirects to the current one, and an old task prefix
-- still resolves PREFIX-N. No FK (ADR 0001): the service writes and deletes
-- rows in the same transaction as the workspace change. No created_by: who
-- made the change is in audit_events.
CREATE TABLE workspace_aliases (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_aliases_kind_check CHECK (kind IN ('slug', 'task_prefix'))
);
```

`server/migrations/9991792100000003_workspace_aliases.down.sql`:

```sql
-- The two indexes are dropped in their own files: DROP INDEX CONCURRENTLY
-- cannot share a file with another statement.
DROP TABLE IF EXISTS workspace_aliases;
```

`server/migrations/9991792100000004_workspace_aliases_slug_idx.up.sql`:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_aliases_slug
  ON workspace_aliases (organization_id, value) WHERE kind = 'slug';
```

`server/migrations/9991792100000004_workspace_aliases_slug_idx.down.sql`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_workspace_aliases_slug;
```

`server/migrations/9991792100000005_workspace_aliases_task_prefix_idx.up.sql`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_aliases_task_prefix
  ON workspace_aliases (upper(value)) WHERE kind = 'task_prefix';
```

`server/migrations/9991792100000005_workspace_aliases_task_prefix_idx.down.sql`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_workspace_aliases_task_prefix;
```

- [ ] **Step 4: Query**

`server/pkg/db/queries/workspace_aliases.sql`:

```sql
-- name: InsertWorkspaceAlias :exec
INSERT INTO workspace_aliases (id, organization_id, workspace_id, kind, value)
VALUES ($1, $2, $3, $4, $5);

-- name: DeleteWorkspaceAlias :exec
-- Case-insensitive, so a task prefix matches in any case; slugs are always
-- lower-case.
DELETE FROM workspace_aliases
WHERE organization_id = sqlc.arg('organization_id') AND workspace_id = sqlc.arg('workspace_id')
  AND kind = sqlc.arg('kind') AND upper(value) = upper(sqlc.arg('value'));
```

Trong `server/pkg/db/queries/workspaces.sql`, `UpdateWorkspaceProfile` thêm hai dòng sau dòng `description = …`:

```sql
  slug        = COALESCE(sqlc.narg('slug'), slug),
  task_prefix = COALESCE(sqlc.narg('task_prefix'), task_prefix),
```

Trong `server/pkg/db/queries/tasks.sql`, thay `WHERE` của `ListTasksByIdentifier` bằng (giữ các dòng comment phía trên):

```sql
WHERE (
    upper(w.task_prefix) = upper(sqlc.arg('prefix'))
    -- An old prefix the workspace keeps (spec 2026-10-14 §5.3).
    OR EXISTS (
      SELECT 1 FROM workspace_aliases a
      WHERE a.workspace_id = w.id AND a.organization_id = w.organization_id
        AND a.kind = 'task_prefix' AND upper(a.value) = upper(sqlc.arg('prefix'))
    )
  )
  AND t.number = sqlc.arg('number');
```

Run: `make sqlc`

- [ ] **Step 5: Service**

`server/internal/service/workspace.go`:
- Thêm `"regexp"` vào import và, sau khối `const (maxWorkspace… )`:

```go
// taskPrefixPattern: an upper-case letter, then 1-9 letters or digits.
var taskPrefixPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)
```

- `UpdateWorkspaceInput` thêm `TaskPrefix *string`.
- `normalizeWorkspaceInput`: dòng kiểm tra rỗng thành `if in.Name == nil && in.Description == nil && in.IconEmoji == nil && in.TaskPrefix == nil {`, và thêm trước `return out, nil`:

```go
	if in.TaskPrefix != nil {
		p := strings.ToUpper(strings.TrimSpace(*in.TaskPrefix))
		if !taskPrefixPattern.MatchString(p) {
			return out, Invalid("tiền tố mã task gồm 2–10 ký tự A-Z, 0-9 và bắt đầu bằng chữ")
		}
		out.TaskPrefix = &p
	}
```

- `workspaceChanges` thêm trước `return`:

```go
	if in.TaskPrefix != nil {
		change("task_prefix", before.TaskPrefix, *in.TaskPrefix)
	}
```

- `applyWorkspaceChanges`: thêm sau khối `description`:

```go
	if _, ok := to["task_prefix"]; ok {
		profile.TaskPrefix = pgtype.Text{String: *in.TaskPrefix, Valid: true}
	}
```

  đổi điều kiện gọi profile thành `if profile.Name.Valid || profile.Description.Valid || profile.TaskPrefix.Valid {`, và thêm ngay sau khối gọi `UpdateWorkspaceProfile`:

```go
	if _, ok := to["task_prefix"]; ok {
		if err := moveWorkspaceAlias(ctx, q, before, "task_prefix", before.TaskPrefix, *in.TaskPrefix); err != nil {
			return err
		}
	}
```

- Thêm hàm:

```go
// moveWorkspaceAlias keeps the value a workspace is leaving answering for
// it, and drops the alias of the value it takes back (spec 2026-10-14 §4.4).
// Deleting before inserting keeps one row per value.
func moveWorkspaceAlias(ctx context.Context, q *db.Queries, w db.Workspace, kind, from, to string) error {
	for _, v := range []string{to, from} {
		if err := q.DeleteWorkspaceAlias(ctx, db.DeleteWorkspaceAliasParams{
			OrganizationID: w.OrganizationID, WorkspaceID: w.ID, Kind: kind, Value: v,
		}); err != nil {
			return err
		}
	}
	return q.InsertWorkspaceAlias(ctx, db.InsertWorkspaceAliasParams{
		ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, Kind: kind, Value: from,
	})
}
```

- [ ] **Step 6: HTTP và seed isolation**

`server/internal/handler/dto/sdi/workspace.go`, `PatchWorkspaceSDI` thêm:

```go
	TaskPrefix *string `json:"task_prefix" description:"Tiền tố mã task mới, 2–10 ký tự A-Z/0-9, bắt đầu bằng chữ; mã cũ vẫn tra được" example:"MKT"`
```

`server/internal/handler/workspace.go`, `patchWorkspace`: thêm `TaskPrefix: in.TaskPrefix` vào `service.UpdateWorkspaceInput{…}`. Route PATCH trong `router/workspaces.go`: thêm "tiền tố mã task" vào `description`.

`server/internal/handler/isolation_world_test.go`: thêm `w.buildWorkspaceAliases(t, tn)` ngay sau `w.buildActivity(t, tn)` trong `buildTenant`, và thêm hàm:

```go
// buildWorkspaceAliases leaves an old task prefix on record and the current
// one unchanged, so workspace_aliases holds a row of each tenant's.
func (w *isoWorld) buildWorkspaceAliases(t *testing.T, tn *isoTenant) {
	t.Helper()
	ws := "/api/v1/workspaces/" + tn.wsID
	out := w.call(t, "GET", "/api/v1/orgs/"+tn.orgSlug+"/workspaces/"+tn.wsSlug, tn.token, nil)
	prefix, _ := out["workspace"].(map[string]any)["task_prefix"].(string)
	if prefix == "" {
		t.Fatal("workspace has no task_prefix")
	}
	w.call(t, "PATCH", ws, tn.token, map[string]string{"task_prefix": "ISO" + strings.ToUpper(tn.tag[:1]) + "OLD"})
	w.call(t, "PATCH", ws, tn.token, map[string]string{"task_prefix": prefix})
}
```

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `cd server && go test ./internal/service/ -run 'TestGetTaskByIdentifier|TestWorkspace' -count=1 && go test ./migrations/ -count=1 && go test ./internal/handler/ -run 'TestIsolation' -count=1`
Expected: PASS (`TestNewTablesCarryOrganizationID`, `TestEveryQueryNamesItsTenant`, `TestIsolationMatrix` nhận bảng mới).

- [ ] **Step 8: Commit**

```bash
git add server
git commit -m "feat(workspace): change the task prefix, old identifiers still resolve

workspace_aliases keeps the prefixes a workspace leaves; ListTasksByIdentifier
matches them, so TASK-12 still opens the task after the prefix becomes MKT.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Views — dialog đổi tiền tố mã task

**Files:**
- Create: `packages/views/settings/components/workspace-task-prefix-dialog.tsx`
- Modify: `packages/views/settings/components/workspace-tab.tsx`, `packages/core/i18n/locales/{vi,en}.json`
- Test: `packages/views/settings/components/workspace-tab.test.tsx`

**Interfaces:**
- Consumes: `usePatchWorkspace` (`task_prefix`), `Workspace.task_prefix`, helpers `renderAs`/`patchBodies` (Task 6).
- Produces: `export function WorkspaceTaskPrefixDialog({ workspace, open, onOpenChange }: { workspace: Workspace; open: boolean; onOpenChange: (open: boolean) => void })`; khoá i18n `settings.workspace.cancel` (Task 10 dùng lại).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `workspace-tab.test.tsx`:

```tsx
  it("changes the task prefix with a preview of the new identifier", async () => {
    renderAs("admin", { ...workspace, task_prefix: "TASK" }, { patch: { workspace: { ...workspace, task_prefix: "MKT" } } });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi tiền tố" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiền tố mới" }), { target: { value: "mkt" } });
    expect(within(dialog).getByText("TASK-12 → MKT-12")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi tiền tố" }));
    await waitFor(() => expect(patchBodies()).toContainEqual({ task_prefix: "MKT" }));
  });

  it("flags a task prefix the server would refuse instead of sending it", async () => {
    renderAs("admin", { ...workspace, task_prefix: "TASK" });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi tiền tố" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiền tố mới" }), { target: { value: "1ab" } });
    expect(within(dialog).getByText("Dùng 2–10 ký tự A–Z hoặc 0–9, bắt đầu bằng chữ.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi tiền tố" }));
    expect(patchBodies()).toHaveLength(0);
  });

  it("does not offer a member the prefix change", async () => {
    renderAs("member", { ...workspace, task_prefix: "TASK" });
    expect(await screen.findByText("TASK")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi tiền tố" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pnpm --filter @uniwork/views exec vitest run settings/components/workspace-tab.test.tsx`
Expected: FAIL (không có nút "Đổi tiền tố").

- [ ] **Step 3: i18n**

`vi.json` › `settings.workspace` thêm:

```json
      "task_prefix": "Tiền tố mã task",
      "task_prefix_hint": "Đứng trước số của mỗi task, ví dụ {{example}}.",
      "task_prefix_change": "Đổi tiền tố",
      "task_prefix_dialog_title": "Đổi tiền tố mã task",
      "task_prefix_dialog_body": "Mọi task sẽ hiện mã mới. Mã cũ vẫn tìm được, nên link và chỗ nhắc tới task cũ không bị gãy.",
      "task_prefix_new": "Tiền tố mới",
      "task_prefix_preview": "{{from}} → {{to}}",
      "task_prefix_invalid": "Dùng 2–10 ký tự A–Z hoặc 0–9, bắt đầu bằng chữ.",
      "task_prefix_saved": "Đã đổi tiền tố mã task",
      "cancel": "Huỷ",
```

`en.json` › `settings.workspace` thêm:

```json
      "task_prefix": "Task ID prefix",
      "task_prefix_hint": "Comes before each task's number, for example {{example}}.",
      "task_prefix_change": "Change prefix",
      "task_prefix_dialog_title": "Change the task ID prefix",
      "task_prefix_dialog_body": "Every task will show the new ID. Old IDs still work, so links and mentions of older tasks don't break.",
      "task_prefix_new": "New prefix",
      "task_prefix_preview": "{{from}} → {{to}}",
      "task_prefix_invalid": "Use 2–10 characters A–Z or 0–9, starting with a letter.",
      "task_prefix_saved": "Task ID prefix changed",
      "cancel": "Cancel",
```

- [ ] **Step 4: Dialog**

`packages/views/settings/components/workspace-task-prefix-dialog.tsx`:

```tsx
"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError } from "./settings-layout";

/** Mirrors taskPrefixPattern in server/internal/service/workspace.go. */
const TASK_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** Confirms a task prefix change and shows what an identifier becomes (spec §6.4). */
export function WorkspaceTaskPrefixDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const patch = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const current = workspace.task_prefix ?? "";
  const [value, setValue] = useState(current);
  const errorId = useId();
  const next = value.trim().toUpperCase();
  const valid = TASK_PREFIX_PATTERN.test(next);
  const invalid = next !== "" && !valid;

  useEffect(() => {
    if (open) setValue(current);
  }, [open, current]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || next === current) return;
    try {
      await patch.mutateAsync({ wsId: workspace.id, task_prefix: next });
      onOpenChange(false);
      toast.success(t("workspace.task_prefix_saved"));
    } catch (err) {
      toastApiError(err, t("save.error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("workspace.task_prefix_dialog_title")}</DialogTitle>
            <DialogDescription>{t("workspace.task_prefix_dialog_body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={value}
              maxLength={10}
              autoComplete="off"
              className="font-mono uppercase"
              aria-label={t("workspace.task_prefix_new")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="font-mono text-caption text-muted-foreground">
              {t("workspace.task_prefix_preview", { from: `${current}-12`, to: `${valid ? next : current}-12` })}
            </p>
            {invalid ? <SettingsFieldError id={errorId}>{t("workspace.task_prefix_invalid")}</SettingsFieldError> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("workspace.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || next === current || patch.isPending}>
              {t("workspace.task_prefix_change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Hàng trong tab**

`workspace-tab.tsx`: thêm `import { WorkspaceTaskPrefixDialog } from "./workspace-task-prefix-dialog";`, và sau dòng `const savedDescription = …`:

```tsx
  const prefix = workspace.task_prefix ?? "";
  const [prefixOpen, setPrefixOpen] = useState(false);
```

Chèn hàng mới ngay trước hàng `workspace.organization`:

```tsx
        {prefix ? (
          <SettingsRow
            label={t("workspace.task_prefix")}
            description={t("workspace.task_prefix_hint", { example: `${prefix}-12` })}
            size="none"
          >
            <div className="flex items-center gap-2 sm:justify-end">
              <SettingsValue className="font-mono">{prefix}</SettingsValue>
              {canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPrefixOpen(true)}>
                  {t("workspace.task_prefix_change")}
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
```

và ngay sau `</SettingsCard>`:

```tsx
      {canEdit ? <WorkspaceTaskPrefixDialog workspace={workspace} open={prefixOpen} onOpenChange={setPrefixOpen} /> : null}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `pnpm --filter @uniwork/views exec vitest run settings/components/workspace-tab.test.tsx && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/views/settings packages/core/i18n/locales
git commit -m "feat(settings): change the task ID prefix from the workspace tab

The dialog previews TASK-12 → MKT-12 and refuses a prefix the server would.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Backend — đổi slug, giữ slug cũ

**Files:**
- Modify: `server/pkg/db/queries/workspaces.sql` (`LockWorkspaceSlugs`), `server/pkg/db/queries/workspace_aliases.sql` (`GetWorkspaceSlugAliasOwner`, `GetWorkspaceBySlugAlias`)
- Modify: `server/internal/service/workspace.go` (`CreateInOrg`, `ResolveSlugs`, `GetBySlugs`, input/normalize/changes/apply)
- Modify: `server/internal/handler/dto/sdi/workspace.go`, `server/internal/handler/workspace.go`, `server/internal/handler/router/workspaces.go`
- Modify: `server/internal/handler/isolation_world_test.go` (`buildWorkspaceAliases`)
- Test: `server/internal/service/workspace_test.go`

**Interfaces:**
- Consumes (Task 7): `moveWorkspaceAlias`, `UpdateWorkspaceProfileParams.Slug`, `buildWorkspaceAliases`.
- Produces:
  - `UpdateWorkspaceInput.Slug *string`; SDI `slug`.
  - `func (s *WorkspaceService) workspaceBySlugs(ctx context.Context, orgSlug, wsSlug string) (db.ListWorkspacesInOrgRow, error)` — slug hiện tại hoặc alias; `ErrNotFound` khi không có.
  - `func slugFreeFor(ctx context.Context, q *db.Queries, orgID, slug, workspaceID string) error`
  - sqlc: `LockWorkspaceSlugs(ctx, organizationID string)`, `GetWorkspaceSlugAliasOwner(ctx, db.GetWorkspaceSlugAliasOwnerParams{OrganizationID, Value string}) (string, error)`, `GetWorkspaceBySlugAlias(ctx, db.GetWorkspaceBySlugAliasParams{OrgSlug, Value string})`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `server/internal/service/workspace_test.go`:

```go
func TestWorkspaceSlugChangeKeepsOldSlugAsAlias(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	next := "doi-beta"
	if got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Slug: &next}); err != nil || got.Slug != next {
		t.Fatalf("change slug: %v %+v", err, got.Workspace)
	}
	old, err := f.ws.GetBySlugs(ctx, f.ua.ID, "unicom", "doi-alpha")
	if err != nil || old.ID != w.ID || old.Slug != "doi-beta" {
		t.Fatalf("old slug: %v %+v", err, old.Workspace)
	}
	if id, err := f.ws.ResolveSlugs(ctx, "unicom", "doi-alpha"); err != nil || id != w.ID {
		t.Fatalf("ResolveSlugs(old): %v %q", err, id)
	}
	// An outsider learns nothing from an old slug.
	if _, err := f.ws.GetBySlugs(ctx, f.uc.ID, "unicom", "doi-alpha"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider on old slug: %v", err)
	}
	back := "doi-alpha"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Slug: &back}); err != nil {
		t.Fatalf("going back: %v", err)
	}
	rows, err := f.pool.Query(ctx, `SELECT value FROM workspace_aliases WHERE workspace_id = $1 AND kind = 'slug'`, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	vals, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(vals) != 1 || vals[0] != "doi-beta" {
		t.Fatalf("slug aliases after going back = %v %v", vals, err)
	}
}

func TestWorkspaceOldSlugIsReservedInTheOrganization(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w1, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	w2, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Gamma", "doi-gamma")
	if err != nil {
		t.Fatal(err)
	}
	next := "doi-beta"
	if _, err := f.ws.Update(ctx, f.ua.ID, w1.ID, UpdateWorkspaceInput{Slug: &next}); err != nil {
		t.Fatal(err)
	}
	old, taken := "doi-alpha", "doi-beta"
	if _, err := f.ws.Update(ctx, f.ua.ID, w2.ID, UpdateWorkspaceInput{Slug: &old}); !errors.Is(err, ErrConflict) {
		t.Fatalf("another workspace takes the old slug: %v", err)
	}
	if _, err := f.ws.Update(ctx, f.ua.ID, w2.ID, UpdateWorkspaceInput{Slug: &taken}); !errors.Is(err, ErrConflict) {
		t.Fatalf("another workspace takes the current slug: %v", err)
	}
	if _, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Mới", "doi-alpha"); !errors.Is(err, ErrConflict) {
		t.Fatalf("a new workspace takes the old slug: %v", err)
	}
}

func TestWorkspaceConcurrentSlugChangesConflict(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w1, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	w2, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Gamma", "doi-gamma")
	if err != nil {
		t.Fatal(err)
	}
	slug := "cung-slug"
	errs := make(chan error, 2)
	for _, id := range []string{w1.ID, w2.ID} {
		id := id
		go func() {
			_, err := f.ws.Update(ctx, f.ua.ID, id, UpdateWorkspaceInput{Slug: &slug})
			errs <- err
		}()
	}
	var ok, conflict int
	for range 2 {
		switch err := <-errs; {
		case err == nil:
			ok++
		case errors.Is(err, ErrConflict):
			conflict++
		default:
			t.Fatalf("unexpected: %v", err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("ok=%d conflict=%d, want 1 and 1", ok, conflict)
	}
}
```

Nếu `CreateInOrg` thứ hai bị quota `workspaces.max` từ chối, nâng quota trong test theo cách các test entitlement khác làm (tìm `FeatureWorkspacesMax` trong `server/internal/service/*_test.go`).

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspaceSlug|TestWorkspaceOldSlug|TestWorkspaceConcurrentSlug' -count=1`
Expected: FAIL, `unknown field Slug in struct literal of type UpdateWorkspaceInput`.

- [ ] **Step 3: Query**

Thêm vào `server/pkg/db/queries/workspaces.sql`:

```sql
-- name: LockWorkspaceSlugs :exec
-- Serializes slug changes and workspace creation in one organization, so the
-- check that a slug is nobody else's alias and the write that follows see
-- the same rows (spec 2026-10-14 §4.4).
SELECT pg_advisory_xact_lock(hashtextextended('workspace-slug:' || sqlc.arg(organization_id)::text, 0));
```

Thêm vào `server/pkg/db/queries/workspace_aliases.sql`:

```sql
-- name: GetWorkspaceSlugAliasOwner :one
SELECT workspace_id FROM workspace_aliases
WHERE organization_id = sqlc.arg('organization_id') AND kind = 'slug' AND value = sqlc.arg('value');

-- name: GetWorkspaceBySlugAlias :one
-- tenant: by-id
-- An old slug: the workspace it belongs to, with its current slug, in the
-- shape of GetWorkspaceBySlugs.
SELECT w.*, o.slug AS organization_slug, o.name AS organization_name
FROM workspace_aliases a
JOIN workspaces w ON w.id = a.workspace_id AND w.organization_id = a.organization_id
JOIN organizations o ON o.id = w.organization_id
WHERE o.slug = sqlc.arg('org_slug') AND a.kind = 'slug' AND a.value = sqlc.arg('value');
```

Run: `make sqlc`. `GetWorkspaceBySlugAliasRow` phải có đúng các trường của `ListWorkspacesInOrgRow` để ép kiểu được.

- [ ] **Step 4: Service**

`server/internal/service/workspace.go`:
- `UpdateWorkspaceInput` thêm `Slug *string`.
- `normalizeWorkspaceInput`: dòng kiểm tra rỗng thêm `&& in.Slug == nil`; thêm trước `return out, nil`:

```go
	if in.Slug != nil {
		slug := strings.TrimSpace(*in.Slug)
		if err := ValidateSlug(slug); err != nil {
			return out, err
		}
		out.Slug = &slug
	}
```

- `workspaceChanges` thêm `if in.Slug != nil { change("slug", before.Slug, *in.Slug) }` trước `return`.
- `applyWorkspaceChanges`: thêm ở **đầu** hàm (trước khi dựng `profile`):

```go
	if _, ok := to["slug"]; ok {
		if err := q.LockWorkspaceSlugs(ctx, before.OrganizationID); err != nil {
			return err
		}
		if err := slugFreeFor(ctx, q, before.OrganizationID, *in.Slug, before.ID); err != nil {
			return err
		}
	}
```

  thêm `if _, ok := to["slug"]; ok { profile.Slug = pgtype.Text{String: *in.Slug, Valid: true} }` cạnh khối `task_prefix`; đổi điều kiện gọi profile thành `if profile.Name.Valid || profile.Description.Valid || profile.TaskPrefix.Valid || profile.Slug.Valid {`; trong nhánh lỗi của `UpdateWorkspaceProfile` thêm trước `return err`:

```go
			if isUniqueViolation(err) {
				return ErrConflict
			}
```

  và thêm sau khối alias `task_prefix`:

```go
	if _, ok := to["slug"]; ok {
		if err := moveWorkspaceAlias(ctx, q, before, "slug", before.Slug, *in.Slug); err != nil {
			return err
		}
	}
```

- Thêm hàm:

```go
// slugFreeFor refuses a slug another workspace of the organization keeps as
// an old slug. The caller holds LockWorkspaceSlugs; current slugs are
// guarded by the unique index on workspaces.
func slugFreeFor(ctx context.Context, q *db.Queries, orgID, slug, workspaceID string) error {
	owner, err := q.GetWorkspaceSlugAliasOwner(ctx, db.GetWorkspaceSlugAliasOwnerParams{OrganizationID: orgID, Value: slug})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if owner != workspaceID {
		return ErrConflict
	}
	return nil
}

// workspaceBySlugs reads the workspace a URL pair names: by its current
// slug, or by an old one it keeps (spec 2026-10-14 §5.3). The row carries
// the current slug either way, so the client can move the URL.
func (s *WorkspaceService) workspaceBySlugs(ctx context.Context, orgSlug, wsSlug string) (db.ListWorkspacesInOrgRow, error) {
	r, err := s.q.GetWorkspaceBySlugs(ctx, db.GetWorkspaceBySlugsParams{Slug: orgSlug, Slug_2: wsSlug})
	if err == nil {
		return db.ListWorkspacesInOrgRow(r), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.ListWorkspacesInOrgRow{}, err
	}
	a, err := s.q.GetWorkspaceBySlugAlias(ctx, db.GetWorkspaceBySlugAliasParams{OrgSlug: orgSlug, Value: wsSlug})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ListWorkspacesInOrgRow{}, ErrNotFound
	}
	return db.ListWorkspacesInOrgRow(a), err
}
```

- `ResolveSlugs`: thân hàm thành

```go
	r, err := s.workspaceBySlugs(ctx, orgSlug, wsSlug)
	if err != nil {
		return "", err
	}
	return r.ID, nil
```

- `GetBySlugs`: thay khối `r, err := s.q.GetWorkspaceBySlugs(...)` cùng hai `if` ngay sau nó bằng

```go
	r, err := s.workspaceBySlugs(ctx, orgSlug, wsSlug)
	if err != nil {
		return WorkspaceView{}, err
	}
```

  và dòng return cuối thành `return s.withIconURL(ctx, viewFromInOrgRow(r)), nil`.
- `CreateInOrg`: ngay sau `q := s.q.WithTx(tx)`, thêm

```go
	// A slug another workspace keeps as an old slug is taken (spec §4.4).
	if err := q.LockWorkspaceSlugs(ctx, orgID); err != nil {
		return WorkspaceView{}, err
	}
	if err := slugFreeFor(ctx, q, orgID, slug, ""); err != nil {
		return WorkspaceView{}, err
	}
```

- [ ] **Step 5: HTTP và seed isolation**

`sdi.PatchWorkspaceSDI` thêm:

```go
	Slug *string `json:"slug" description:"Slug mới trên URL, 2–40 ký tự a-z, 0-9, gạch ngang; slug cũ tự chuyển sang slug mới" example:"team-moi"`
```

`patchWorkspace`: thêm `Slug: in.Slug`. Route PATCH: thêm "slug" vào `description`.

`buildWorkspaceAliases` thêm vào cuối hàm:

```go
	w.call(t, "PATCH", ws, tn.token, map[string]string{"slug": tn.wsSlug + "-old"})
	w.call(t, "PATCH", ws, tn.token, map[string]string{"slug": tn.wsSlug})
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `cd server && go test ./internal/service/ -run 'TestWorkspace|TestCreateInOrg' -count=1 && go test ./migrations/ -count=1 && go test ./internal/handler/ -run 'TestIsolation|TestPatchWorkspace' -count=1`
Expected: PASS (`TestIsolationRealtime` vẫn xanh vì slug cuối cùng không đổi).

- [ ] **Step 7: Commit**

```bash
git add server
git commit -m "feat(workspace): change the workspace slug, old links still resolve

The old slug stays as an alias the organization cannot reuse; GetBySlugs
and the WebSocket handshake resolve it to the workspace's current slug.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Views — redirect slug cũ và dialog đổi địa chỉ

**Files:**
- Modify: `packages/views/layout/use-dashboard-guard.ts`
- Create: `packages/views/settings/components/workspace-slug-dialog.tsx`
- Modify: `packages/views/settings/components/workspace-tab.tsx`, `packages/core/i18n/locales/{vi,en}.json`
- Test: `packages/views/layout/use-dashboard-guard.test.tsx`, `packages/views/settings/components/workspace-tab.test.tsx`

**Interfaces:**
- Consumes: `GetBySlugs` trả slug hiện tại cho slug cũ (Task 9); `usePatchWorkspace` (`slug`); `isSlugConflict`, `SLUG_REGEX`, `isSlugLengthValid`, `SLUG_MAX_LENGTH` từ `packages/views/workspace/slug.ts`; khoá `settings.workspace.cancel` (Task 8).
- Produces: `export function WorkspaceSlugDialog({ workspace, open, onOpenChange }: { workspace: Workspace; open: boolean; onOpenChange: (open: boolean) => void })`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `packages/views/layout/use-dashboard-guard.test.tsx` (dùng `nav`, `renderGuard`, `user`, `useAuthStore`, `requestMock` có sẵn trong file):

```tsx
  it("moves an old slug to the workspace's current slug, keeping the path and the query", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({
      workspace: { id: "ws1", slug: "team-new", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" },
    });
    const adapter = nav("/acme/team/tasks/01J8TASK");
    adapter.searchParams = new URLSearchParams("view=board");
    renderGuard(adapter);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/acme/team-new/tasks/01J8TASK?view=board"));
  });

  it("leaves the URL alone when the slug is current", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({
      workspace: { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" },
    });
    const adapter = nav("/acme/team/tasks");
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.workspace?.id).toBe("ws1"));
    expect(adapter.replace).not.toHaveBeenCalled();
  });
```

Trong `workspace-tab.test.tsx`, thêm `import { ApiError } from "@uniwork/core/api";` và:

```tsx
  it("changes the address in a dialog, normalising what is typed", async () => {
    renderAs("admin", workspace, { patch: { workspace: { ...workspace, slug: "doi-moi" } } });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: " Doi-Moi " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi địa chỉ" }));
    await waitFor(() => expect(patchBodies()).toContainEqual({ slug: "doi-moi" }));
  });

  it("says the address is taken when the server answers 409", async () => {
    renderAs("admin", workspace, { patchError: new ApiError("already exists", "conflict", 409) });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi địa chỉ" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Địa chỉ mới" }), { target: { value: "doi-khac" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đổi địa chỉ" }));
    expect(await within(dialog).findByText("Địa chỉ này đã được dùng trong tổ chức.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pnpm --filter @uniwork/views exec vitest run layout/use-dashboard-guard.test.tsx settings/components/workspace-tab.test.tsx`
Expected: FAIL (không gọi `replace`; không có nút "Đổi địa chỉ").

- [ ] **Step 3: Redirect**

`packages/views/layout/use-dashboard-guard.ts`: đổi `const { pathname, replace } = useNavigation();` thành `const { pathname, searchParams, replace } = useNavigation();`. Thêm ngay sau `useEffect` đầu tiên:

```ts
  // An old slug resolves through its alias (spec 2026-10-14 §6.2): move the
  // URL to the workspace's current slug, keeping the rest of the path and the
  // query, so links and bookmarks from before a rename keep working.
  const currentSlug = workspace?.slug;
  useEffect(() => {
    if (!currentSlug || currentSlug === wsSlug) return;
    const query = searchParams.toString();
    replace(withWorkspaceSlug(pathname, currentSlug) + (query ? `?${query}` : ""));
  }, [currentSlug, wsSlug, pathname, searchParams, replace]);
```

và thêm cuối file:

```ts
/** /{org}/{oldSlug}/rest → /{org}/{slug}/rest. */
function withWorkspaceSlug(pathname: string, slug: string): string {
  const parts = pathname.split("/");
  if (parts.length < 3) return pathname;
  parts[2] = encodeURIComponent(slug);
  return parts.join("/");
}
```

- [ ] **Step 4: i18n**

`vi.json` › `settings.workspace`: đổi `"url_hint"` thành `"Đổi tên không làm đổi địa chỉ. Đổi địa chỉ thì link cũ vẫn tự chuyển sang địa chỉ mới."` và thêm:

```json
      "url_change": "Đổi địa chỉ",
      "url_dialog_title": "Đổi địa chỉ workspace",
      "url_dialog_body": "Link cũ sẽ tự chuyển sang địa chỉ mới. Địa chỉ cũ được giữ cho workspace này; workspace khác trong tổ chức không dùng được.",
      "url_new": "Địa chỉ mới",
      "url_invalid": "Chỉ dùng a–z, 0–9 và dấu gạch ngang, 2–40 ký tự.",
      "url_taken": "Địa chỉ này đã được dùng trong tổ chức.",
      "url_saved": "Đã đổi địa chỉ workspace",
```

`en.json` › `settings.workspace`: đổi `"url_hint"` thành `"Renaming doesn't change the address. If you change the address, old links still lead to the new one."` và thêm:

```json
      "url_change": "Change address",
      "url_dialog_title": "Change the workspace address",
      "url_dialog_body": "Old links will lead to the new address. The old address stays reserved for this workspace; no other workspace in the organization can use it.",
      "url_new": "New address",
      "url_invalid": "Use only a–z, 0–9 and hyphens, 2–40 characters.",
      "url_taken": "This address is already used in the organization.",
      "url_saved": "Workspace address changed",
```

- [ ] **Step 5: Dialog**

`packages/views/settings/components/workspace-slug-dialog.tsx`:

```tsx
"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { isSlugConflict, isSlugLengthValid, SLUG_MAX_LENGTH, SLUG_REGEX } from "../../workspace/slug";
import { SettingsFieldError } from "./settings-layout";

/**
 * Confirms a slug change (spec §6.4). The URL moves by itself afterwards:
 * the mutation refetches the workspace under its old slug, the server
 * answers with the new one, and useDashboardGuard replaces the URL.
 */
export function WorkspaceSlugDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const patch = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const [value, setValue] = useState(workspace.slug);
  const [taken, setTaken] = useState(false);
  const errorId = useId();
  const next = value.trim().toLowerCase();
  const valid = SLUG_REGEX.test(next) && isSlugLengthValid(next);
  const error = taken ? t("workspace.url_taken") : next !== "" && !valid ? t("workspace.url_invalid") : null;

  useEffect(() => {
    if (!open) return;
    setValue(workspace.slug);
    setTaken(false);
  }, [open, workspace.slug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || next === workspace.slug) return;
    try {
      await patch.mutateAsync({ wsId: workspace.id, slug: next });
      onOpenChange(false);
      toast.success(t("workspace.url_saved"));
    } catch (err) {
      if (isSlugConflict(err)) setTaken(true);
      else toastApiError(err, t("save.error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("workspace.url_dialog_title")}</DialogTitle>
            <DialogDescription>{t("workspace.url_dialog_body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={value}
              // Room for spaces around the slug, which are trimmed.
              maxLength={SLUG_MAX_LENGTH + 2}
              autoComplete="off"
              className="font-mono"
              aria-label={t("workspace.url_new")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setTaken(false);
              }}
            />
            {error ? <SettingsFieldError id={errorId}>{error}</SettingsFieldError> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("workspace.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || next === workspace.slug || patch.isPending}>
              {t("workspace.url_change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Nút trong tab**

`workspace-tab.tsx`: thêm `import { WorkspaceSlugDialog } from "./workspace-slug-dialog";` và `const [slugOpen, setSlugOpen] = useState(false);` cạnh `prefixOpen`. Trong hàng `workspace.url`, thêm sau nút copy:

```tsx
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSlugOpen(true)}>
                {t("workspace.url_change")}
              </Button>
            ) : null}
```

và cạnh `WorkspaceTaskPrefixDialog`:

```tsx
      {canEdit ? <WorkspaceSlugDialog workspace={workspace} open={slugOpen} onOpenChange={setSlugOpen} /> : null}
```

File phải còn dưới 500 dòng (không tính dòng trống/comment; `pnpm lint` báo `max-lines`).

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `pnpm --filter @uniwork/views exec vitest run layout/ settings/components/workspace-tab.test.tsx && pnpm lint && pnpm knip && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/views packages/core/i18n/locales
git commit -m "feat(settings): change the workspace address; old URLs redirect

useDashboardGuard moves an old slug to the current one, keeping the path
and the query; the dialog normalises the slug and reports a taken one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: E2E — đổi địa chỉ, link cũ chuyển hướng

**Files:**
- Create: `e2e/workspace-settings.spec.ts`

**Interfaces:**
- Consumes: `onboardToWorkspace`, `workspaceSeed` từ `e2e/onboard.ts`; nhãn UI từ Task 10.
- Produces: không.

- [ ] **Step 1: Viết test**

`e2e/workspace-settings.spec.ts` (nếu tab Cài đặt workspace dùng giá trị khác `tab=workspace`, lấy đúng từ `packages/views/settings/components/settings-page.tsx`):

```ts
import { expect, test } from "@playwright/test";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

test.describe.configure({ timeout: 180_000 });

const stamp = Date.now();

test("workspace settings: đổi địa chỉ, link cũ tự chuyển sang địa chỉ mới", async ({ page }) => {
  const w = workspaceSeed("wsinfo", "slug", stamp);
  await onboardToWorkspace(page, w);
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/settings?tab=workspace`);

  await page.getByRole("button", { name: "Đổi địa chỉ" }).click();
  const dialog = page.getByRole("dialog");
  const next = `${w.wsSlug}-moi`;
  await dialog.getByRole("textbox", { name: "Địa chỉ mới" }).fill(next);
  await dialog.getByRole("button", { name: "Đổi địa chỉ" }).click();
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${next}/settings`), { timeout: 20_000 });

  // A link from before the change still opens the workspace, under the new address.
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/tasks?view=board`);
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${next}/tasks\\?view=board`), { timeout: 20_000 });
});
```

- [ ] **Step 2: Chạy**

App phải đang chạy (`make start` hoặc `make start-worktree`), migration đã áp dụng (`make migrate-up`).

Run: `pnpm exec playwright test e2e/workspace-settings.spec.ts`
Expected: PASS. Chạy lại một lần nếu lần đầu rơi vào lúc Next đang biên dịch lại.

- [ ] **Step 3: Commit**

```bash
git add e2e/workspace-settings.spec.ts
git commit -m "test(e2e): changing the workspace address redirects old links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Kiểm tra cuối (không chạy `make check`)

- [ ] `cd server && go test ./internal/service/ ./internal/handler/... ./internal/files/... ./migrations/ -count=1`
- [ ] `pnpm typecheck && pnpm lint && pnpm knip`
- [ ] `pnpm --filter @uniwork/core exec vitest run && pnpm --filter @uniwork/views exec vitest run`
- [ ] `node --test scripts/events-catalogue.test.mjs scripts/governance.test.mjs`
- [ ] Đổi dòng trạng thái plan và spec sang `shipped` khi merge.
