# Nút xóa tổ chức trên console admin — Implementation Plan

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vai trò nền tảng `admin` xếp và hoàn tác lệnh xóa 5 ngày của một tổ chức từ trang chi tiết console; sau khi xóa cứng thì nút khóa.

**Architecture:** `RequestDeletion` và `CancelDeletion` gọi hai hàm dùng chung trong `PrivacyExportService`. Hàm nhận một hook chạy trong cùng transaction, sau nhật ký riêng tư và trước commit. `AdminService` truyền `recordAdmin` vào hook đó. Consumer `privacy-deletion` không đổi. Trang chi tiết đọc `deletion_scheduled_at` và `erased` để đổi nút.

**Tech Stack:** Go (Chi, pgx, sqlc), PostgreSQL, TypeScript (React, TanStack Query, zod, Vitest, Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-23-admin-organization-deletion-design.md`

## Global Constraints

- Không migration mới. Không topic outbox mới. Không sửa `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`, consumer `privacy-deletion`, `tenantDeleteRetain`, hay `tenant_export_tables.go`.
- Không `FOREIGN KEY`. Id mới vẫn là `util.NewID()`.
- `PrivacyExportService` không gọi query trong `admin.sql`. Dòng `admin_actions` chỉ do `recordAdmin` ghi.
- Lý do admin: `checkReason`, sàn 10 rune sau trim. Slug: `strings.TrimSpace`, phân biệt hoa thường.
- Cửa sổ xóa là `privacyDeletionDelay` (5 ngày). Test chấp nhận `deletion_scheduled_at` trong một phút quanh thời điểm ghi nhận cộng 5 ngày.
- `erased` đúng khi `suspended_reason = organization_deleted`. Tổ chức `suspended` hoặc `archived` với `organization_closed` vẫn xếp được lệnh.
- Hoàn tác không mở lại thành viên mà lệnh đóng tổ chức đã vô hiệu.
- Route admin mới: nhóm ghi của `registerAdmin`, `isoPlatform`, lý do `reasonPlatform`. Không vai trò nền tảng → 404. `support` → 403 `platform_role_insufficient`.
- `PrivacyExportService` chưa gắn: 503 `privacy_unavailable`, câu `xuất dữ liệu chưa khả dụng`. Kiểm tra lý do đứng trước kiểm tra này.
- Client: không cast JSON; `parseWithFallback`; response hỏng của POST trả `null`. `deletion_scheduled_at` thiếu thì `null`, `erased` thiếu thì `false`.
- `packages/views/`: không `next/*`; mọi chữ JSX qua `t()`; khóa thêm ở cả `vi.json` và `en.json`; file `.tsx` ≤ 500 dòng. Icon `Trash2`.
- Comment code bằng tiếng Anh. Commit theo `.githooks/commit-msg`. Không `--no-verify`.
- Mỗi task chạy đúng lệnh test của task. Go chạy trong `server/` với DB test mà `make test-go` dùng (`TEST_DATABASE_URL`). Chưa có issue UniAI: không mở PR; nhánh code là `feature/UNI-nnn-admin-org-deletion` sau khi có issue.
- Không e2e.

## File structure

- `server/internal/service/tenant_delete.go` — `queueDeletion`, `cancelDeletion`. `RequestDeletion` và `CancelDeletion` trở thành lớp quyền chủ sở hữu.
- `server/internal/service/admin.go` — `SetOrganizationDeletionQueue`, `ScheduleOrganizationDeletion`, `CancelOrganizationDeletion`.
- `server/internal/service/tenant_delete_test.go` — test dịch vụ của spec.
- `server/pkg/db/queries/admin.sql` — `AdminGetOrganization` chọn thêm `o.deletion_scheduled_at`. Generated đi theo `make sqlc`.
- `server/internal/handler/dto/sdi/admin.go`, `dto/sdo/admin.go` — body và response.
- `server/internal/handler/admin.go`, `router/admin.go`, `router/routes.go`, `handler/router.go` — hai route và hai trường của GET.
- `server/internal/handler/isolation_routes_test.go` — `isoPlatform`.
- `server/internal/handler/admin_test.go` — 404, 403, 202, hoàn tác, `erased`.
- `server/cmd/server/main.go`, `server/internal/handler/auth_test.go` — gắn setter.
- `packages/core/types/admin.ts`, `packages/core/api/endpoints/admin.ts`, `admin.test.ts`, `packages/core/admin/hooks.ts` — schema, endpoint, hook.
- `packages/views/admin/organization-deletion.tsx` và `organization-deletion.test.tsx` — nút và banner.
- `packages/views/admin/organization-detail.tsx` — gắn banner và nút.
- `packages/core/i18n/locales/vi.json`, `en.json` — khóa `admin.detail`.

---

### Task 1: Hàm xếp hàng dùng chung và AdminService

**Files:**
- Modify: `server/internal/service/tenant_delete.go`
- Modify: `server/internal/service/admin.go`
- Test: `server/internal/service/tenant_delete_test.go`

**Interfaces:**
- Consumes: `PrivacyExportService.RequestDeletion`, `CancelDeletion`, `Exports`, `RequestExport`; `AdminService.recordAdmin`, `checkReason`, `ensureTrace`; `coded`, `codedIs`, `ErrReasonTooShort`, `ErrNotFound`.
- Produces:
  - `func (s *PrivacyExportService) queueDeletion(ctx context.Context, actorID, orgID, confirmSlug string, meta map[string]any, hook func(ctx context.Context, q *db.Queries, row db.DataSubjectRequest, eraseAt time.Time) error) (db.DataSubjectRequest, error)`
  - `func (s *PrivacyExportService) cancelDeletion(ctx context.Context, actorID, orgID string, meta map[string]any, hook func(ctx context.Context, q *db.Queries, row db.DataSubjectRequest) error) (db.DataSubjectRequest, error)`
  - `func (s *AdminService) SetOrganizationDeletionQueue(d OrganizationDeletionQueue)` (interface hẹp `OrganizationDeletionQueue{queueDeletion, cancelDeletion}`, ADR 0046)
  - `func (s *AdminService) ScheduleOrganizationDeletion(ctx context.Context, adminID, orgID, confirmSlug, reason string) (time.Time, error)`
  - `func (s *AdminService) CancelOrganizationDeletion(ctx context.Context, adminID, orgID, reason string) error`

- [ ] **Step 1: Write the failing tests**

Thêm vào cuối `server/internal/service/tenant_delete_test.go`. Import thêm `"strings"` nếu file chưa có.

```go
func newAdminDeletion(t *testing.T) (*auditServiceFixture, *PrivacyExportService, *AdminService, db.Organization) {
	t.Helper()
	f := newAuditServiceFixture(t)
	privacy := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	admin := NewAdminService(f.svc.pool, f.q, nil, nil)
	admin.SetOrganizationDeletionQueue(privacy)
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	return f, privacy, admin, org
}

func TestAdminOrganizationDeletionNeedsPrivacy(t *testing.T) {
	f, _, _, org := newAdminDeletion(t)
	bare := NewAdminService(f.svc.pool, f.q, nil, nil)
	_, err := bare.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, "lý do đủ mười ký tự")
	if !codedIs(err, "privacy_unavailable") {
		t.Fatalf("unwired: %v", err)
	}
}

func TestPrivacyDeletionQueueHookRollsBack(t *testing.T) {
	f, privacy, _, org := newAdminDeletion(t)
	_, err := privacy.queueDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, nil, func(context.Context, *db.Queries, db.DataSubjectRequest, time.Time) error {
		return errors.New("admin_actions")
	})
	if err == nil || !strings.Contains(err.Error(), "admin_actions") {
		t.Fatalf("hook: %v", err)
	}
	var scheduled *time.Time
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT deletion_scheduled_at FROM organizations WHERE id = $1`, f.orgA).Scan(&scheduled); err != nil {
		t.Fatal(err)
	}
	if scheduled != nil {
		t.Fatalf("schedule survived a failed hook: %v", scheduled)
	}
}

func TestAdminOrganizationDeletion(t *testing.T) {
	const reason = "khách yêu cầu xóa tổ chức này"

	t.Run("schedules the shared dossier", func(t *testing.T) {
		f, privacy, admin, org := newAdminDeletion(t)
		at, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, "  "+org.Slug+"  ", reason)
		if err != nil {
			t.Fatal(err)
		}
		if delta := at.Sub(time.Now().UTC().Add(privacyDeletionDelay)); delta < -time.Minute || delta > time.Minute {
			t.Fatalf("erase at %s is not about five days out", at)
		}
		rows, err := privacy.Exports(f.ctx, f.ownerA.ID, f.orgA)
		if err != nil || len(rows) != 1 || rows[0].Kind != "delete" || rows[0].RequestedBy != f.adminA.ID {
			t.Fatalf("owner dossier: %+v %v", rows, err)
		}
		var actions int
		var gotReason string
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*), max(reason) FROM admin_actions WHERE target_id = $1 AND action = 'organization.deletion_scheduled'`, f.orgA).Scan(&actions, &gotReason); err != nil {
			t.Fatal(err)
		}
		if actions != 1 || gotReason != reason {
			t.Fatalf("admin_actions = %d %q", actions, gotReason)
		}
		var meta string
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT metadata::text FROM audit_events WHERE organization_id = $1 AND action = 'privacy.deletion_requested' AND actor_id = $2`, f.orgA, f.adminA.ID).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		compact := strings.ReplaceAll(meta, " ", "")
		if !strings.Contains(compact, `"platform_admin":true`) || !strings.Contains(meta, reason) {
			t.Fatalf("audit metadata: %s", meta)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); !codedIs(err, "privacy_export_in_flight") {
			t.Fatalf("second deletion: %v", err)
		}
		var topic string
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT topic FROM outbox_events WHERE topic = 'privacy.deletion_requested' AND payload LIKE $1`, "%"+f.orgA+"%").Scan(&topic); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("owner request has no platform metadata", func(t *testing.T) {
		f, privacy, _, org := newAdminDeletion(t)
		if _, err := privacy.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug); err != nil {
			t.Fatal(err)
		}
		var meta string
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT COALESCE(metadata::text, '') FROM audit_events WHERE organization_id = $1 AND action = 'privacy.deletion_requested' AND actor_id = $2`, f.orgA, f.ownerA.ID).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(meta, "platform_admin") {
			t.Fatalf("owner metadata: %s", meta)
		}
	})

	t.Run("rejects a short reason, a bad slug, and a second request", func(t *testing.T) {
		f, privacy, admin, org := newAdminDeletion(t)
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, "ngắn"); !errors.Is(err, ErrReasonTooShort) {
			t.Fatalf("short: %v", err)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, "missing", org.Slug, reason); !errors.Is(err, ErrNotFound) {
			t.Fatalf("missing: %v", err)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, "sai-slug", reason); !codedIs(err, "privacy_delete_confirm") {
			t.Fatalf("slug: %v", err)
		}
		if _, err := privacy.RequestExport(f.ctx, f.ownerA.ID, f.orgA); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); !codedIs(err, "privacy_export_in_flight") {
			t.Fatalf("export: %v", err)
		}
	})

	t.Run("rejects an erased organization before the slug", func(t *testing.T) {
		f, _, admin, _ := newAdminDeletion(t)
		if _, err := f.svc.pool.Exec(f.ctx, `UPDATE organizations SET status = 'archived', suspended_reason = 'organization_deleted', slug = 'd-' || lower(id) WHERE id = $1`, f.orgA); err != nil {
			t.Fatal(err)
		}
		org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); !codedIs(err, "organization_already_deleted") {
			t.Fatalf("erased slug: %v", err)
		}
	})

	t.Run("allows suspended and closed organizations", func(t *testing.T) {
		for _, status := range []struct{ sql string }{
			{`UPDATE organizations SET status = 'suspended', suspended_reason = 'pilot' WHERE id = $1`},
			{`UPDATE organizations SET status = 'archived', suspended_reason = 'organization_closed' WHERE id = $1`},
		} {
			f, _, admin, org := newAdminDeletion(t)
			if _, err := f.svc.pool.Exec(f.ctx, status.sql, f.orgA); err != nil {
				t.Fatal(err)
			}
			if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); err != nil {
				t.Fatalf("%s: %v", status.sql, err)
			}
		}
	})

	t.Run("cancel before start and refuse after start", func(t *testing.T) {
		f, privacy, admin, org := newAdminDeletion(t)
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); err != nil {
			t.Fatal(err)
		}
		if _, err := privacy.CancelDeletion(f.ctx, f.ownerA.ID, f.orgA); err != nil {
			t.Fatal(err)
		}
		var ownerCancels int
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1 AND action = 'organization.deletion_cancelled'`, f.orgA).Scan(&ownerCancels); err != nil || ownerCancels != 0 {
			t.Fatalf("owner cancel wrote admin_actions: %d %v", ownerCancels, err)
		}
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.pool.Exec(f.ctx, `UPDATE data_subject_requests SET started_at = now() WHERE organization_id = $1 AND kind = 'delete' AND cancelled_at IS NULL`, f.orgA); err != nil {
			t.Fatal(err)
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, reason); !codedIs(err, "privacy_delete_started") {
			t.Fatalf("started: %v", err)
		}
		var scheduled *time.Time
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT deletion_scheduled_at FROM organizations WHERE id = $1`, f.orgA).Scan(&scheduled); err != nil || scheduled == nil {
			t.Fatalf("schedule cleared while the job had started: %v %v", scheduled, err)
		}
	})

	t.Run("admin cancel clears the schedule", func(t *testing.T) {
		f, _, admin, org := newAdminDeletion(t)
		if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); err != nil {
			t.Fatal(err)
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, "ngắn"); !errors.Is(err, ErrReasonTooShort) {
			t.Fatalf("short cancel: %v", err)
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, reason); err != nil {
			t.Fatal(err)
		}
		var scheduled *time.Time
		var actions int
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT deletion_scheduled_at FROM organizations WHERE id = $1`, f.orgA).Scan(&scheduled); err != nil || scheduled != nil {
			t.Fatalf("schedule: %v %v", scheduled, err)
		}
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1 AND action = 'organization.deletion_cancelled'`, f.orgA).Scan(&actions); err != nil || actions != 1 {
			t.Fatalf("cancel actions: %d %v", actions, err)
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, reason); !errors.Is(err, ErrNotFound) {
			t.Fatalf("second cancel: %v", err)
		}
	})
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && go test ./internal/service/ -count=1 -run 'TestAdminOrganizationDeletion|TestPrivacyDeletionQueueHookRollsBack'`

Expected: FAIL compiling, `SetOrganizationDeletionQueue` and `ScheduleOrganizationDeletion` undefined.

- [ ] **Step 3: Implement the shared queue and the admin methods**

Trong `tenant_delete.go`, thay thân `RequestDeletion` và `CancelDeletion` bằng lớp quyền, rồi thêm hai hàm dưới. Giữ nguyên `requireOwner`, `privacyDeletionDelay`, và câu lỗi đang có.

```go
func (s *PrivacyExportService) RequestDeletion(ctx context.Context, userID, orgID, confirmSlug string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	return s.queueDeletion(ctx, userID, orgID, confirmSlug, nil, nil)
}

func (s *PrivacyExportService) queueDeletion(ctx context.Context, actorID, orgID, confirmSlug string, meta map[string]any, hook func(ctx context.Context, q *db.Queries, row db.DataSubjectRequest, eraseAt time.Time) error) (db.DataSubjectRequest, error) {
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, ErrNotFound
	}
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if org.SuspendedReason.Valid && org.SuspendedReason.String == "organization_deleted" {
		return db.DataSubjectRequest{}, coded(http.StatusConflict, "organization_already_deleted", "tổ chức đã bị xóa cứng")
	}
	if strings.TrimSpace(confirmSlug) != org.Slug {
		return db.DataSubjectRequest{}, coded(http.StatusBadRequest, "privacy_delete_confirm", "nhập đúng định danh tổ chức để xác nhận")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	running, err := q.CountOpenDataSubjectRequests(ctx, orgID)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if running > 0 {
		return db.DataSubjectRequest{}, errPrivacyExportInFlight()
	}
	eraseAt := time.Now().UTC().Add(privacyDeletionDelay)
	row, err := q.InsertDataSubjectDeletion(ctx, db.InsertDataSubjectDeletionParams{
		ID: util.NewID(), OrganizationID: orgID,
		RequestedBy: actorID, RequestedByKind: string(audit.KindHuman),
		EraseAt: pgtype.Timestamptz{Time: eraseAt, Valid: true},
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return db.DataSubjectRequest{}, errPrivacyExportInFlight()
		}
		return db.DataSubjectRequest{}, err
	}
	if err := q.ScheduleOrganizationDeletion(ctx, db.ScheduleOrganizationDeletionParams{
		ID: orgID, DeletionScheduledAt: pgtype.Timestamptz{Time: eraseAt, Valid: true},
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionPrivacyDeletionRequested,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
		Metadata:       meta,
	}, audit.Event{
		Topic:          "privacy.deletion_requested",
		Payload:        map[string]string{"request_id": row.ID, "organization_id": orgID},
		OrganizationID: orgID,
		AvailableAt:    eraseAt,
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if hook != nil {
		if err := hook(ctx, q, row, eraseAt); err != nil {
			return db.DataSubjectRequest{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DataSubjectRequest{}, err
	}
	return row, nil
}

func (s *PrivacyExportService) CancelDeletion(ctx context.Context, userID, orgID string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	return s.cancelDeletion(ctx, userID, orgID, nil, nil)
}

func (s *PrivacyExportService) cancelDeletion(ctx context.Context, actorID, orgID string, meta map[string]any, hook func(ctx context.Context, q *db.Queries, row db.DataSubjectRequest) error) (db.DataSubjectRequest, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.GetOpenDataSubjectDeletion(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, ErrNotFound
	}
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if _, err := q.CancelDataSubjectDeletion(ctx, db.CancelDataSubjectDeletionParams{
		ID: row.ID, OrganizationID: orgID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, coded(http.StatusConflict, "privacy_delete_started", "lệnh xóa đã bắt đầu, không hủy được")
	} else if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := q.ClearOrganizationDeletionSchedule(ctx, orgID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionPrivacyDeletionCancelled,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
		Metadata:       meta,
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if hook != nil {
		if err := hook(ctx, q, row); err != nil {
			return db.DataSubjectRequest{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DataSubjectRequest{}, err
	}
	row.CancelledAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	return row, nil
}
```

Trong `admin.go`, thêm interface `OrganizationDeletionQueue` cạnh `ReportedContentRemover` và field `deletion OrganizationDeletionQueue` vào `AdminService`, setter cạnh `SetReportedContentRemover`, và hai method. Import `net/http` nếu file chưa có.

```go
func (s *AdminService) SetOrganizationDeletionQueue(d OrganizationDeletionQueue) { s.deletion = d }

func (s *AdminService) ScheduleOrganizationDeletion(ctx context.Context, adminID, orgID, confirmSlug, reason string) (time.Time, error) {
	if err := checkReason(reason); err != nil {
		return time.Time{}, err
	}
	if s.deletion == nil {
		return time.Time{}, coded(http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
	}
	ctx, traceID := ensureTrace(ctx)
	trimmed := strings.TrimSpace(reason)
	row, err := s.deletion.queueDeletion(ctx, adminID, orgID, confirmSlug, map[string]any{
		"platform_admin": true,
		"reason":         trimmed,
	}, func(ctx context.Context, q *db.Queries, _ db.DataSubjectRequest, eraseAt time.Time) error {
		return s.recordAdmin(ctx, q, traceID, adminID, "organization.deletion_scheduled", "organization", orgID,
			map[string]any{"deletion_scheduled_at": nil},
			map[string]any{"deletion_scheduled_at": eraseAt.Format(time.RFC3339)},
			trimmed)
	})
	if err != nil {
		return time.Time{}, err
	}
	return row.EraseAt.Time, nil
}

func (s *AdminService) CancelOrganizationDeletion(ctx context.Context, adminID, orgID, reason string) error {
	if err := checkReason(reason); err != nil {
		return err
	}
	if s.deletion == nil {
		return coded(http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
	}
	ctx, traceID := ensureTrace(ctx)
	trimmed := strings.TrimSpace(reason)
	_, err := s.deletion.cancelDeletion(ctx, adminID, orgID, map[string]any{
		"platform_admin": true,
		"reason":         trimmed,
	}, func(ctx context.Context, q *db.Queries, row db.DataSubjectRequest) error {
		var before any
		if row.EraseAt.Valid {
			before = row.EraseAt.Time.UTC().Format(time.RFC3339)
		}
		return s.recordAdmin(ctx, q, traceID, adminID, "organization.deletion_cancelled", "organization", orgID,
			map[string]any{"deletion_scheduled_at": before},
			map[string]any{"deletion_scheduled_at": nil},
			trimmed)
	})
	return err
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && go test ./internal/service/ -count=1 -run 'TestAdminOrganizationDeletion|TestPrivacyDeletionQueueHookRollsBack|TestPrivacyDeletion'`

Expected: PASS, gồm các test xóa của chủ sở hữu đang có.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/tenant_delete.go server/internal/service/admin.go server/internal/service/tenant_delete_test.go
git commit -m "$(cat <<'EOF'
feat(admin): xếp xóa tổ chức bằng hàng đợi riêng tư đang có

Console và chủ sở hữu dùng một transaction. Hook ghi admin_actions; đường chủ sở hữu không thêm metadata.

EOF
)"
```

---

### Task 2: Route admin, GET chi tiết, isolation

**Files:**
- Modify: `server/pkg/db/queries/admin.sql` (câu `AdminGetOrganization`)
- Modify: `server/pkg/db/generated/admin.sql.go` (chỉ bằng `make sqlc`)
- Modify: `server/internal/handler/dto/sdi/admin.go`
- Modify: `server/internal/handler/dto/sdo/admin.go`
- Modify: `server/internal/handler/admin.go`
- Modify: `server/internal/handler/router/admin.go`
- Modify: `server/internal/handler/router/routes.go`
- Modify: `server/internal/handler/router.go`
- Modify: `server/internal/handler/isolation_routes_test.go`
- Modify: `server/internal/handler/admin_test.go`
- Modify: `server/cmd/server/main.go` (ngay sau `adminSvc.SetReportedContentRemover(chatSvc)`)
- Modify: `server/internal/handler/auth_test.go` (`newTestDeps`)

**Interfaces:**
- Consumes: `ScheduleOrganizationDeletion`, `CancelOrganizationDeletion` từ Task 1. `optTimePtr`. `middleware.UserID`. `decode`, `mapServiceError`, `respondJSON`.
- Produces:
  - `POST /api/v1/admin/organizations/{orgID}/deletion` → 202 `{"deletion_scheduled_at":"<RFC3339>"}`
  - `POST /api/v1/admin/organizations/{orgID}/deletion/cancel` → 200 `{"deletion_scheduled_at":null}`
  - `GET /api/v1/admin/organizations/{orgID}` thêm `deletion_scheduled_at` và `erased`

- [ ] **Step 1: Write the failing handler test**

Thêm vào `server/internal/handler/admin_test.go`:

```go
func TestAdminOrganizationDeletionRoute(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)
	enrolMFA(t, srv, w.token)
	grant := func(role string) {
		t.Helper()
		if _, err := d.Admin.SetPlatformRole(context.Background(), service.CLIActor, "audit@example.com", role, "test fixture grant"); err != nil {
			t.Fatal(err)
		}
	}
	path := "/api/v1/admin/organizations/" + w.orgID + "/deletion"
	res, _ := doJSON(t, srv, "POST", path, w.token, map[string]string{"reason": "khách yêu cầu xóa tổ chức", "confirm_slug": "unicom"})
	if res.StatusCode != 404 {
		t.Fatalf("no role: %d", res.StatusCode)
	}
	grant("support")
	res, out := doJSON(t, srv, "POST", path, w.token, map[string]string{"reason": "khách yêu cầu xóa tổ chức", "confirm_slug": "unicom"})
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "platform_role_insufficient" {
		t.Fatalf("support: %d %v", res.StatusCode, out)
	}
	grant("admin")
	res, out = doJSON(t, srv, "POST", path, w.token, map[string]string{"reason": "khách yêu cầu xóa tổ chức", "confirm_slug": "unicom"})
	if res.StatusCode != 202 || out["deletion_scheduled_at"] == nil {
		t.Fatalf("schedule: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/organizations/"+w.orgID, w.token, nil)
	if res.StatusCode != 200 || out["deletion_scheduled_at"] == nil || out["erased"] != false {
		t.Fatalf("detail: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", path+"/cancel", w.token, map[string]string{"reason": "khách rút lại yêu cầu xóa"})
	if res.StatusCode != 200 || out["deletion_scheduled_at"] != nil {
		t.Fatalf("cancel: %d %v", res.StatusCode, out)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE organizations SET status = 'archived', suspended_reason = 'organization_deleted' WHERE id = $1`, w.orgID); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/organizations/"+w.orgID, w.token, nil)
	if res.StatusCode != 200 || out["erased"] != true {
		t.Fatalf("erased: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", path, w.token, map[string]string{"reason": "khách yêu cầu xóa tổ chức", "confirm_slug": "d-ignored"})
	if res.StatusCode != 409 || out["error"].(map[string]any)["code"] != "organization_already_deleted" {
		t.Fatalf("deleted: %d %v", res.StatusCode, out)
	}
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd server && go test ./internal/handler/ -count=1 -run TestAdminOrganizationDeletionRoute`

Expected: FAIL, 404 không phải là lỗi compile nếu route chưa có (Chi trả 404). Sau khi route tồn tại mà setter chưa gắn, kỳ vọng 503. Lần chạy đầu, trước khi đăng ký route, status 404 cho cả nhánh admin là chưa đủ: assert `erased` sẽ fail khi GET chưa có trường. Đó là tín hiệu đúng để sang Step 3.

- [ ] **Step 3: Select the column, register the routes, wire the setter**

`server/pkg/db/queries/admin.sql`, câu `AdminGetOrganization`, thêm `o.deletion_scheduled_at` vào danh sách SELECT, ngay sau `o.suspended_reason`. Rồi `make sqlc` từ gốc repo. Không sửa tay file generated. Field mới trên `AdminGetOrganizationRow` là `DeletionScheduledAt pgtype.Timestamptz`.

`sdi/admin.go`:

```go
// AdminScheduleOrganizationDeletionSDI is POST /api/v1/admin/organizations/{orgID}/deletion.
type AdminScheduleOrganizationDeletionSDI struct {
	Reason      string `json:"reason" minLength:"10" description:"Lý do xóa (≥ 10 ký tự), ghi vào admin_actions" example:"Khách yêu cầu xóa tổ chức sau khi xuất dữ liệu"`
	ConfirmSlug string `json:"confirm_slug" description:"Định danh tổ chức, gõ lại để xác nhận" example:"truong-tieu-hoc" required:"true"`
}
```

`sdo/admin.go`, thêm vào `AdminOrganizationDetailSDO`:

```go
DeletionScheduledAt *string `json:"deletion_scheduled_at" description:"Thời điểm job xóa cứng; null khi không có lệnh" example:"2026-10-28T09:30:00Z"`
Erased              bool    `json:"erased" description:"true khi tổ chức đã bị xóa cứng" example:"false"`
```

Và type mới:

```go
// AdminOrganizationDeletionSDO is the schedule and cancel answer.
type AdminOrganizationDeletionSDO struct {
	DeletionScheduledAt *string `json:"deletion_scheduled_at" example:"2026-10-28T09:30:00Z"`
}
```

`admin.go`, trong `adminGetOrganization`, sau khi gán `SuspendedReason`:

```go
out.DeletionScheduledAt = optTimePtr(o.DeletionScheduledAt)
out.Erased = o.SuspendedReason.Valid && o.SuspendedReason.String == "organization_deleted"
```

Hai handler mới trong cùng file:

```go
func (h *handlers) adminScheduleOrganizationDeletion(w http.ResponseWriter, r *http.Request) {
	var in sdi.AdminScheduleOrganizationDeletionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	at, err := h.Admin.ScheduleOrganizationDeletion(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.ConfirmSlug, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	s := at.UTC().Format(time.RFC3339)
	respondJSON(w, http.StatusAccepted, sdo.AdminOrganizationDeletionSDO{DeletionScheduledAt: &s})
}

func (h *handlers) adminCancelOrganizationDeletion(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReasonSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Admin.CancelOrganizationDeletion(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.Reason); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AdminOrganizationDeletionSDO{})
}
```

`router/routes.go`, cạnh `AdminSuspendOrganization`:

```go
AdminScheduleOrganizationDeletion http.HandlerFunc
AdminCancelOrganizationDeletion   http.HandlerFunc
```

`handler/router.go`, trong literal `rt.Routes`, cạnh suspend:

```go
AdminScheduleOrganizationDeletion: h.adminScheduleOrganizationDeletion,
AdminCancelOrganizationDeletion:   h.adminCancelOrganizationDeletion,
```

`router/admin.go`, trong group `w.Use(admin)`, ngay sau unsuspend. Cập nhật comment đầu file với hai dòng route.

```go
w.Post("/organizations/{orgID}/deletion", h.AdminScheduleOrganizationDeletion, apiOp{
	summary: "Admin: delete an organization",
	description: "Ghi nhận xóa tổ chức. Job xóa cứng chạy sau 5 ngày. reason ≥ 10 ký tự và confirm_slug khớp định danh hiện tại. Đã xóa cứng → 409 organization_already_deleted.",
	tags: tags, sdi: sdi.AdminScheduleOrganizationDeletionSDI{}, sdo: sdo.AdminOrganizationDeletionSDO{}, status: 202, auth: true,
})
w.Post("/organizations/{orgID}/deletion/cancel", h.AdminCancelOrganizationDeletion, apiOp{
	summary: "Admin: cancel an organization deletion",
	description: "Hủy lệnh xóa khi job chưa chạy. reason ≥ 10 ký tự. Job đã bắt đầu → 409 privacy_delete_started.",
	tags: tags, sdi: sdi.ReasonSDI{}, sdo: sdo.AdminOrganizationDeletionSDO{}, auth: true,
})
```

`isolation_routes_test.go`, cạnh suspend:

```go
"POST /api/v1/admin/organizations/{orgID}/deletion":        {class: isoPlatform, reason: reasonPlatform},
"POST /api/v1/admin/organizations/{orgID}/deletion/cancel": {class: isoPlatform, reason: reasonPlatform},
```

`cmd/server/main.go`, sau `adminSvc.SetReportedContentRemover(chatSvc)`:

```go
adminSvc.SetOrganizationDeletionQueue(privacySvc)
```

`auth_test.go` `newTestDeps`: tạo `privacy := service.NewPrivacyExportService(pool, q, orgs)`, gọi `adminSvc.SetOrganizationDeletionQueue(privacy)`, và đặt `Privacy: privacy` trong `Deps`.

- [ ] **Step 4: Run the handler tests**

Run: `cd server && go test ./internal/handler/ -count=1 -run 'TestAdminOrganizationDeletionRoute|TestAdminRoutesGuardedByPlatformRole|TestIsolationMatrix'`

Expected: PASS. `TestIsolationMatrix` lâu hơn hai test kia; nếu DB test không có, dừng và nói rõ, không đổi test cho khớp lỗi.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/queries/admin.sql server/pkg/db/generated/admin.sql.go \
  server/internal/handler/dto/sdi/admin.go server/internal/handler/dto/sdo/admin.go \
  server/internal/handler/admin.go server/internal/handler/admin_test.go \
  server/internal/handler/router/admin.go server/internal/handler/router/routes.go \
  server/internal/handler/router.go server/internal/handler/isolation_routes_test.go \
  server/internal/handler/auth_test.go server/cmd/server/main.go
git commit -m "$(cat <<'EOF'
feat(admin): route xóa và hoàn tác tổ chức trên console

GET chi tiết trả deletion_scheduled_at và erased. Support không ghi được.

EOF
)"
```

---

### Task 3: Endpoint và hook phía client

**Files:**
- Modify: `packages/core/types/admin.ts` (`AdminOrganizationDetailSchema`)
- Modify: `packages/core/api/endpoints/admin.ts`
- Modify: `packages/core/api/endpoints/admin.test.ts`
- Modify: `packages/core/admin/hooks.ts`

**Interfaces:**
- Consumes: JSON của Task 2.
- Produces:
  - `scheduleAdminOrganizationDeletion(orgId: string, body: { reason: string; confirm_slug: string }): Promise<{ deletion_scheduled_at: string | null } | null>`
  - `cancelAdminOrganizationDeletion(orgId: string, reason: string): Promise<{ deletion_scheduled_at: string | null } | null>`
  - `useScheduleAdminOrganizationDeletion(orgId: string)`
  - `useCancelAdminOrganizationDeletion(orgId: string)`
  - `AdminOrganizationDetail.deletion_scheduled_at: string | null` và `erased: boolean`

- [ ] **Step 1: Write the failing endpoint tests**

Trong `packages/core/api/endpoints/admin.test.ts`, thêm một `it` theo kiểu các ca admin đang có (mock `fetch`, `configureRuntime` đã có trong file):

```ts
it("schedules and cancels organization deletion, and degrades a malformed body", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ deletion_scheduled_at: "2026-10-28T09:30:00Z" }), { status: 202 }));
  await expect(scheduleAdminOrganizationDeletion("o1", { reason: "khách yêu cầu xóa tổ chức", confirm_slug: "acme" })).resolves.toEqual({
    deletion_scheduled_at: "2026-10-28T09:30:00Z",
  });
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/admin/organizations/o1/deletion");
  vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 202 }));
  await expect(scheduleAdminOrganizationDeletion("o1", { reason: "khách yêu cầu xóa tổ chức", confirm_slug: "acme" })).resolves.toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ deletion_scheduled_at: null }), { status: 200 }));
  await expect(cancelAdminOrganizationDeletion("o1", "khách rút lại yêu cầu xóa")).resolves.toEqual({ deletion_scheduled_at: null });
});

it("reads deletion_scheduled_at and erased, defaulting when the server omits them", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
    organization: { id: "o1", slug: "acme", name: "Acme", status: "active" },
  }), { status: 200 }));
  const detail = await getAdminOrganization("o1");
  expect(detail?.deletion_scheduled_at).toBeNull();
  expect(detail?.erased).toBe(false);
});
```

Import hai hàm mới cạnh import admin endpoint đang có trong file đó.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/admin.test.ts`

Expected: FAIL, hai hàm chưa export.

- [ ] **Step 3: Add the schema, functions, and hooks**

`AdminOrganizationDetailSchema` thêm:

```ts
deletion_scheduled_at: z.string().nullable().optional().default(null),
erased: z.boolean().optional().default(false),
```

`packages/core/api/endpoints/admin.ts`:

```ts
const OrganizationDeletionResponse = z.object({
  deletion_scheduled_at: z.string().nullable().optional().default(null),
});

export async function scheduleAdminOrganizationDeletion(
  orgId: string,
  body: { reason: string; confirm_slug: string },
): Promise<{ deletion_scheduled_at: string | null } | null> {
  const raw = await request(`/api/v1/admin/organizations/${enc(orgId)}/deletion`, { method: "POST", body });
  return parseWithFallback(raw, OrganizationDeletionResponse, null, {
    endpoint: "POST /api/v1/admin/organizations/{org}/deletion",
  });
}

export async function cancelAdminOrganizationDeletion(
  orgId: string,
  reason: string,
): Promise<{ deletion_scheduled_at: string | null } | null> {
  const raw = await request(`/api/v1/admin/organizations/${enc(orgId)}/deletion/cancel`, {
    method: "POST",
    body: { reason },
  });
  return parseWithFallback(raw, OrganizationDeletionResponse, null, {
    endpoint: "POST /api/v1/admin/organizations/{org}/deletion/cancel",
  });
}
```

`packages/core/admin/hooks.ts`, cạnh `useChangeOrganizationPlan`:

```ts
export function useScheduleAdminOrganizationDeletion(orgId: string) {
  return useOrganizationMutation(orgId, (body: { reason: string; confirm_slug: string }) =>
    admin.scheduleAdminOrganizationDeletion(orgId, body),
  );
}

export function useCancelAdminOrganizationDeletion(orgId: string) {
  return useOrganizationMutation(orgId, (reason: string) => admin.cancelAdminOrganizationDeletion(orgId, reason));
}
```

`useOrganizationMutation` đã invalidate `adminKeys.organization(orgId)` và `adminKeys.organizationsRoot`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/types/admin.ts packages/core/api/endpoints/admin.ts packages/core/api/endpoints/admin.test.ts packages/core/admin/hooks.ts
git commit -m "$(cat <<'EOF'
feat(core): endpoint xóa và hoàn tác tổ chức cho console

Response hỏng trả null. Chi tiết thiếu lịch xóa thì erased là false.

EOF
)"
```

---

### Task 4: Nút và banner trên trang chi tiết

**Files:**
- Create: `packages/views/admin/organization-deletion.tsx`
- Create: `packages/views/admin/organization-deletion.test.tsx`
- Modify: `packages/views/admin/organization-detail.tsx`
- Modify: `packages/core/i18n/locales/vi.json` (khối `admin.detail`, ngay sau `"change_plan"`)
- Modify: `packages/core/i18n/locales/en.json` (cùng vị trí)

**Interfaces:**
- Consumes: `useScheduleAdminOrganizationDeletion`, `useCancelAdminOrganizationDeletion`, `useAdminMe`, `ReasonDialog`, `formatDateTime`, `apiErrorMessage`.
- Produces:
  - `OrganizationDeletionBanner({ scheduledAt, erased }: { scheduledAt: string | null; erased: boolean })`
  - `OrganizationDeletionButton({ orgId, name, slug, scheduledAt, erased }: { orgId: string; name: string; slug: string; scheduledAt: string | null; erased: boolean })`

- [ ] **Step 1: Add the copy and write the failing view test**

`vi.json`, sau `"change_plan": "Đổi gói",`:

```json
"delete": "Xóa tổ chức",
"delete_title": "Xóa {{name}}?",
"delete_description": "Job xóa cứng chạy sau 5 ngày. Trong thời gian đó có thể hoàn tác. Thành viên thường không vào được; chủ sở hữu vẫn vào để tải tệp và hủy.",
"slug_label": "Định danh tổ chức",
"slug_hint": "Gõ lại {{slug}} để xác nhận.",
"slug_mismatch": "Định danh chưa khớp.",
"delete_toast": "Đã ghi nhận xóa tổ chức",
"scheduled_banner": "Sẽ xóa cứng lúc {{at}}.",
"undo_delete": "Hoàn tác xóa",
"undo_delete_title": "Hoàn tác xóa {{name}}?",
"undo_delete_description": "Lệnh xóa bị hủy. Thành viên vào lại được.",
"undo_delete_toast": "Đã hoàn tác lệnh xóa",
"erased_banner": "Tổ chức đã bị xóa cứng.",
```

`en.json`, sau `"change_plan": "Change plan",`, dùng đúng cột English trong spec mục 5.

`packages/views/admin/organization-deletion.test.tsx` render `AdminOrganizationDetailView` với mock giống `organization-detail.test.tsx`. `requestMock` trả `/api/v1/admin/me` là `{ platform_role }` và GET chi tiết là body truyền vào.

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminOrganizationDetailView } from "./organization-detail";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const org = { id: "o1", slug: "acme", name: "Acme", status: "active", plan_code: "free", member_count: 3, workspace_count: 1, created_at: "2026-09-01T00:00:00Z", last_activity_at: null };

function detail(extra: Record<string, unknown> = {}) {
  return { organization: org, suspended_at: null, suspended_reason: null, entitlements: [], actions: [], deletion_scheduled_at: null, erased: false, ...extra };
}

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/organizations/o1", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

function mockApi(role: string, body: unknown) {
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/admin/me") return Promise.resolve({ platform_role: role });
    if (path === "/api/v1/admin/organizations/o1" && !opts?.method) return Promise.resolve(body);
    if (path === "/api/v1/plans") return Promise.resolve({ plans: [] });
    if (path === "/api/v1/admin/flags") return Promise.resolve({ flags: [] });
    if (path.endsWith("/deletion") && opts?.method === "POST") return Promise.resolve({ deletion_scheduled_at: "2026-10-28T09:30:00Z" });
    if (path.endsWith("/deletion/cancel")) return Promise.resolve({ deletion_scheduled_at: null });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("organization deletion on the admin detail", () => {
  it("requires the slug and a long reason before it schedules", async () => {
    mockApi("admin", detail());
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tổ chức" }));
    const slug = await screen.findByLabelText("Định danh tổ chức");
    fireEvent.change(slug, { target: { value: "sai" } });
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "khách yêu cầu xóa tổ chức" } });
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    expect(screen.getByText("Định danh chưa khớp.")).toBeInTheDocument();
    fireEvent.change(slug, { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations/o1/deletion", expect.objectContaining({
      method: "POST",
      body: { reason: "khách yêu cầu xóa tổ chức", confirm_slug: "acme" },
    })));
  });

  it("cancels a scheduled deletion with a reason and no slug", async () => {
    mockApi("admin", detail({ deletion_scheduled_at: "2026-10-28T09:30:00Z" }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText(/Sẽ xóa cứng lúc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác xóa" }));
    expect(screen.queryByLabelText("Định danh tổ chức")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "khách rút lại yêu cầu xóa" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations/o1/deletion/cancel", expect.objectContaining({
      method: "POST",
      body: { reason: "khách rút lại yêu cầu xóa" },
    })));
  });

  it("disables deletion after the organization is erased", async () => {
    mockApi("admin", detail({ erased: true }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    const button = await screen.findByRole("button", { name: "Xóa tổ chức" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Tổ chức đã bị xóa cứng.")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the button from support and still shows the banner", async () => {
    mockApi("support", detail({ deletion_scheduled_at: "2026-10-28T09:30:00Z" }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText(/Sẽ xóa cứng lúc/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hoàn tác xóa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa tổ chức" })).not.toBeInTheDocument();
  });

  it("shows support the erased banner and no button", async () => {
    mockApi("support", detail({ erased: true }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText("Tổ chức đã bị xóa cứng.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa tổ chức" })).not.toBeInTheDocument();
  });
});
```

Banner chờ và banner đã xóa đều `role="status"`. Test chờ bằng chữ trên banner, không bằng role, vì trang còn status khác.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @uniwork/views exec vitest run admin/organization-deletion.test.tsx`

Expected: FAIL, không có nút «Xóa tổ chức».

- [ ] **Step 3: Add the component and mount it**

`packages/views/admin/organization-deletion.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminMe,
  useCancelAdminOrganizationDeletion,
  useScheduleAdminOrganizationDeletion,
} from "@uniwork/core/admin";
import { apiErrorMessage } from "@uniwork/core/api";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { formatDateTime } from "./status-badge";
import { ReasonDialog } from "./reason-dialog";

export function OrganizationDeletionBanner({ scheduledAt, erased }: { scheduledAt: string | null; erased: boolean }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  if (erased) {
    return (
      <div role="status" className="border-b border-border bg-muted px-4 py-2 text-body text-muted-foreground">
        {t("erased_banner")}
      </div>
    );
  }
  if (!scheduledAt) return null;
  return (
    <div role="status" className="border-b border-border bg-destructive/10 px-4 py-2 text-body text-destructive">
      {t("scheduled_banner", { at: formatDateTime(scheduledAt, i18n.language) })}
    </div>
  );
}

export function OrganizationDeletionButton({
  orgId, name, slug, scheduledAt, erased,
}: {
  orgId: string;
  name: string;
  slug: string;
  scheduledAt: string | null;
  erased: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  const me = useAdminMe();
  const schedule = useScheduleAdminOrganizationDeletion(orgId);
  const cancel = useCancelAdminOrganizationDeletion(orgId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pending = schedule.isPending || cancel.isPending;
  const scheduled = !erased && !!scheduledAt;
  const matched = draft.trim() === slug;
  if (me.data !== "admin") return null;

  const submit = async (reason: string) => {
    try {
      if (scheduled) {
        await cancel.mutateAsync(reason);
        toast.success(t("undo_delete_toast"));
      } else {
        await schedule.mutateAsync({ reason, confirm_slug: draft.trim() });
        toast.success(t("delete_toast"));
      }
      setOpen(false);
      setDraft("");
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? t("error_write"));
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={scheduled || erased ? "outline" : "destructive"}
        disabled={erased || pending}
        onClick={() => setOpen(true)}
      >
        {scheduled ? t("undo_delete") : (
          <>
            <Trash2 data-icon="inline-start" aria-hidden />
            {t("delete")}
          </>
        )}
      </Button>
      <ReasonDialog
        open={open && !erased}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraft("");
        }}
        title={scheduled ? t("undo_delete_title", { name }) : t("delete_title", { name })}
        description={scheduled ? t("undo_delete_description") : t("delete_description")}
        destructive={!scheduled}
        submitDisabled={!scheduled && !matched}
        pending={pending}
        onSubmit={(reason) => void submit(reason)}
      >
        {scheduled ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-delete-slug">{t("slug_label")}</Label>
            <Input
              id="admin-delete-slug"
              value={draft}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="admin-delete-slug-hint"
              onChange={(e) => setDraft(e.target.value)}
            />
            <p id="admin-delete-slug-hint" className="text-caption text-muted-foreground">
              {draft.trim().length > 0 && !matched ? t("slug_mismatch") : t("slug_hint", { slug })}
            </p>
          </div>
        )}
      </ReasonDialog>
    </>
  );
}
```

`organization-detail.tsx`: import hai export. Trong `actions` của `BreadcrumbHeader`, sau nút đổi gói:

```tsx
<OrganizationDeletionButton
  orgId={orgId}
  name={org.name}
  slug={org.slug}
  scheduledAt={detail.deletion_scheduled_at}
  erased={detail.erased}
/>
```

Ngay sau banner tạm ngưng:

```tsx
<OrganizationDeletionBanner scheduledAt={detail.deletion_scheduled_at} erased={detail.erased} />
```

Banner tạm ngưng ở trên, banner xóa ở dưới. Không đổi handler của «Tạm ngưng» và «Đổi gói».

Mock `/api/v1/admin/me` của test chi tiết cũ trả `{}` qua nhánh mặc định, `getAdminMe` thành `""`, nên nút xóa không hiện và các test đó vẫn qua.

- [ ] **Step 4: Run the view tests**

Run: `pnpm --filter @uniwork/views exec vitest run admin/organization-deletion.test.tsx admin/organization-detail.test.tsx`

Expected: PASS. Nếu nút «Xác nhận» bị disabled khi slug đã khớp, kiểm tra `draft.trim() === slug` và `submitDisabled`. Nếu toast làm test kẹt, assertion chỉ cần `requestMock`, không cần chờ toast.

- [ ] **Step 5: Commit**

```bash
git add packages/views/admin/organization-deletion.tsx packages/views/admin/organization-deletion.test.tsx \
  packages/views/admin/organization-detail.tsx \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "$(cat <<'EOF'
feat(admin): nút xóa và hoàn tác tổ chức trên trang chi tiết

Support không thấy nút. Tổ chức đã xóa cứng thì nút khóa.

EOF
)"
```
