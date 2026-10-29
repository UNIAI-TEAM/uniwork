package service

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestTenantDeletionRetainsAuditAndInvoices(t *testing.T) {
	for _, name := range tenantDeleteTables() {
		if tenantDeleteRetain[name] {
			t.Fatalf("%s is both deleted and retained", name)
		}
	}
	for _, kept := range []string{"audit_events", "invoices", "billing_payment_intents", "organization_members"} {
		if !tenantDeleteRetain[kept] {
			t.Fatalf("%s should be retained", kept)
		}
	}
	foundTask := false
	for _, name := range tenantDeleteTables() {
		if name == "tasks" {
			foundTask = true
		}
	}
	if !foundTask {
		t.Fatal("tasks are business content and must be deleted")
	}
}

type tenantDeleteRecorderDBTX struct {
	workspaces []string
	ops        []string
}

func (r *tenantDeleteRecorderDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "-- name: LockDriveFolderGraph ") {
		wsID, _ := args[0].(string)
		r.ops = append(r.ops, "lock:"+wsID)
		return pgconn.NewCommandTag("SELECT 1"), nil
	}
	if strings.HasPrefix(sql, "DELETE FROM ") {
		rest := strings.TrimPrefix(sql, "DELETE FROM ")
		table, _, _ := strings.Cut(rest, " ")
		r.ops = append(r.ops, "delete:"+table)
		return pgconn.NewCommandTag("DELETE 1"), nil
	}
	return pgconn.NewCommandTag(""), errors.New("unexpected Exec in tenantDeleteRecorderDBTX: " + sql)
}

func (r *tenantDeleteRecorderDBTX) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	if strings.Contains(sql, "-- name: ListOrganizationWorkspaceIDs ") {
		return &memDriveStringRows{vals: append([]string(nil), r.workspaces...)}, nil
	}
	return nil, errors.New("unexpected Query in tenantDeleteRecorderDBTX: " + sql)
}

func (r *tenantDeleteRecorderDBTX) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	return driveUnitRowFunc(func(...any) error { return errors.New("unexpected QueryRow in tenantDeleteRecorderDBTX: " + sql) })
}

// TestDeleteTenantTablesLocksWorkspaceDriveFolderGraphsFirstUnit (UNI-2291 RB3-1)
// verifies without a database that deleteTenantTables acquires LockDriveFolderGraph
// for every workspace of the organization in deterministic workspace-id order
// BEFORE executing any DELETE statement (and specifically before deleting any
// Drive table).
func TestDeleteTenantTablesLocksWorkspaceDriveFolderGraphsFirstUnit(t *testing.T) {
	t.Parallel()
	rec := &tenantDeleteRecorderDBTX{
		workspaces: []string{"ws-03", "ws-01", "ws-02"},
	}
	removed, err := deleteTenantTables(context.Background(), rec, "org-rb3-1")
	if err != nil {
		t.Fatalf("deleteTenantTables: %v", err)
	}
	expectedTables := tenantDeleteTables()
	if removed != int64(len(expectedTables)) {
		t.Fatalf("removed = %d, want %d", removed, len(expectedTables))
	}
	wantLocks := []string{"lock:ws-01", "lock:ws-02", "lock:ws-03"}
	if len(rec.ops) != len(wantLocks)+len(expectedTables) {
		t.Fatalf("recorded ops len = %d, want %d", len(rec.ops), len(wantLocks)+len(expectedTables))
	}
	if !reflect.DeepEqual(rec.ops[:len(wantLocks)], wantLocks) {
		t.Fatalf("initial lock ops = %v, want %v", rec.ops[:len(wantLocks)], wantLocks)
	}
	firstDriveDeleteIdx := -1
	for i, op := range rec.ops {
		if strings.HasPrefix(op, "delete:drive_") {
			firstDriveDeleteIdx = i
			break
		}
	}
	if firstDriveDeleteIdx < len(wantLocks) {
		t.Fatalf("first Drive delete at index %d (%v), must follow all %d workspace graph locks", firstDriveDeleteIdx, rec.ops, len(wantLocks))
	}
}

func TestPrivacyDeletionRequiresTheSlug(t *testing.T) {
	f := newAuditServiceFixture(t)
	svc := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RequestDeletion(f.ctx, f.memberA.ID, f.orgA, org.Slug); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member: %v", err)
	}
	if _, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, "khong-dung"); !codedIs(err, "privacy_delete_confirm") {
		t.Fatalf("wrong slug: %v", err)
	}
	if _, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug); !codedIs(err, "privacy_export_in_flight") {
		t.Fatalf("second request: %v", err)
	}
}

func TestPrivacyDeletionRemovesContentAndKeepsAudit(t *testing.T) {
	f := newAuditServiceFixture(t)
	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc sẽ mất"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO organization_member_profiles (organization_id, user_id, title, phone, search_text, updated_by)
		VALUES ($1, $2, 'Hiệu trưởng', '0901234567', '', $2)
		ON CONFLICT (organization_id, user_id) DO UPDATE SET title = EXCLUDED.title, phone = EXCLUDED.phone`,
		f.orgA, f.memberA.ID); err != nil {
		t.Fatal(err)
	}
	var subID string
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgA).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := f.svc.pool.Exec(f.ctx, `INSERT INTO invoices (
		id, organization_id, subscription_id, provider, number, status,
		amount_due, amount_paid, currency, period_start, period_end, paid_at
	) VALUES ($1, $2, $3, 'manual', 'UW-DELETE', 'paid', 1000, 1000, 'VND', $4, $4, $4)`,
		util.NewID(), f.orgA, subID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO graph_nodes (id, organization_id, node_type, source_id, title, visibility)
		VALUES ($1, $2, 'TASK', $3, 'Việc bí mật', 'workspace')`, util.NewID(), f.orgA, task.ID); err != nil {
		t.Fatal(err)
	}
	var auditBefore int
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, f.orgA).Scan(&auditBefore); err != nil {
		t.Fatal(err)
	}
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	row, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug)
	if err != nil {
		t.Fatal(err)
	}
	consumer := NewPrivacyDeletionConsumer(f.svc.pool, f.q)
	consumer.SetFileService(filesfake.New(filesfake.Options{}))
	consumer.SetGraphForget(projector.ForgetOrganization)
	ev := outbox.Row{ID: "ev-privacy-delete", Topic: "privacy.deletion_requested", Payload: `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}

	var tasks, invoices, auditAfter int
	var phone, orgName, orgStatus, otherName, email, title string
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE organization_id = $1`, f.orgA).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE organization_id = $1`, f.orgA).Scan(&invoices); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, f.orgA).Scan(&auditAfter); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT phone FROM organization_member_profiles WHERE organization_id = $1 AND user_id = $2`, f.orgA, f.memberA.ID).Scan(&phone); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT name, status FROM organizations WHERE id = $1`, f.orgA).Scan(&orgName, &orgStatus); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT name FROM organizations WHERE id = $1`, f.orgB).Scan(&otherName); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT email FROM users WHERE id = $1`, f.ownerA.ID).Scan(&email); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT title FROM graph_nodes WHERE organization_id = $1 AND source_id = $2`, f.orgA, task.ID).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if tasks != 0 || invoices != 1 || auditAfter < auditBefore || phone != "" || orgName != deletedOrganizationName || orgStatus != "archived" {
		t.Fatalf("tasks=%d invoices=%d audit %d→%d phone=%q org=%q status=%q", tasks, invoices, auditBefore, auditAfter, phone, orgName, orgStatus)
	}
	if otherName != "Org B" || email != f.ownerA.Email || title != "" {
		t.Fatalf("other=%q email=%q graph title=%q", otherName, email, title)
	}
	if _, err := svc.Export(f.ctx, f.ownerA.ID, f.orgA, row.ID); !errors.Is(err, ErrOrganizationSuspended) {
		t.Fatalf("owner after erasure: %v", err)
	}
}

func TestPrivacyDeletionWaitsFiveDaysAndCanBeCancelled(t *testing.T) {
	f := newAuditServiceFixture(t)
	orgs := NewOrganizationService(f.svc.pool, f.q)
	svc := NewPrivacyExportService(f.svc.pool, f.q, orgs)
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc còn lại"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug)
	if err != nil {
		t.Fatal(err)
	}
	var tasks int
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE id = $1`, task.ID).Scan(&tasks); err != nil || tasks != 1 {
		t.Fatalf("task should stay until the delay elapses: %d %v", tasks, err)
	}
	var available time.Time
	if err := f.svc.pool.QueryRow(f.ctx, `
		SELECT available_at FROM outbox_events
		WHERE topic = 'privacy.deletion_requested' AND payload LIKE $1`, "%"+row.ID+"%").Scan(&available); err != nil {
		t.Fatal(err)
	}
	if available.Before(time.Now().Add(privacyDeletionDelay - time.Hour)) {
		t.Fatalf("available_at %s is not five days out", available)
	}
	if _, err := orgs.RequireMember(f.ctx, f.orgA, f.memberA.ID); !errors.Is(err, ErrOrganizationDeletionScheduled) {
		t.Fatalf("member during the wait: %v", err)
	}
	if _, err := f.ws.RequireMember(f.ctx, f.wsA.ID, f.memberA.ID); !errors.Is(err, ErrOrganizationDeletionScheduled) {
		t.Fatalf("member workspace during the wait: %v", err)
	}
	if _, err := orgs.RequireMember(f.ctx, f.orgA, f.ownerA.ID); err != nil {
		t.Fatalf("owner during the wait: %v", err)
	}
	if _, err := svc.CancelDeletion(f.ctx, f.ownerA.ID, f.orgA); err != nil {
		t.Fatal(err)
	}
	if _, err := orgs.RequireMember(f.ctx, f.orgA, f.memberA.ID); err != nil {
		t.Fatalf("member after cancel: %v", err)
	}
	consumer := NewPrivacyDeletionConsumer(f.svc.pool, f.q)
	consumer.SetFileService(filesfake.New(filesfake.Options{}))
	consumer.SetGraphForget(projector.ForgetOrganization)
	ev := outbox.Row{ID: "ev-privacy-cancel", Topic: "privacy.deletion_requested", Payload: `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE id = $1`, task.ID).Scan(&tasks); err != nil || tasks != 1 {
		t.Fatalf("cancelled deletion still removed the task: %d %v", tasks, err)
	}
}

// privacyReleaseFail fails the file release so the erasure transaction rolls
// back after the claim has been committed.
type privacyReleaseFail struct{ files.Service }

func (privacyReleaseFail) ReleaseInTx(context.Context, *db.Queries, []files.FileID) error {
	return errors.New("storage down")
}

func TestPrivacyDeletionResumesAfterARolledBackAttempt(t *testing.T) {
	f := newAuditServiceFixture(t)
	orgs := NewOrganizationService(f.svc.pool, f.q)
	svc := NewPrivacyExportService(f.svc.pool, f.q, orgs)
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc còn lại"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO files (id, organization_id, storage, object_key, original_filename)
		VALUES ($1, $2, 'local', 'privacy-delete-resume', 'a.png')`, util.NewID(), f.orgA); err != nil {
		t.Fatal(err)
	}
	row, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug)
	if err != nil {
		t.Fatal(err)
	}
	ev := outbox.Row{
		ID: "ev-privacy-retry", Topic: "privacy.deletion_requested",
		Payload: `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`,
	}
	failed := NewPrivacyDeletionConsumer(f.svc.pool, f.q)
	failed.SetFileService(privacyReleaseFail{})
	if err := failed.Handle(f.ctx, ev); err == nil {
		t.Fatal("a failed attempt was treated as done")
	}
	var tasks int
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE id = $1`, task.ID).Scan(&tasks); err != nil || tasks != 1 {
		t.Fatalf("rolled-back attempt removed the task: %d %v", tasks, err)
	}
	if _, err := orgs.RequireMember(f.ctx, f.orgA, f.memberA.ID); !errors.Is(err, ErrOrganizationDeletionScheduled) {
		t.Fatalf("member after a failed attempt: %v", err)
	}

	again := NewPrivacyDeletionConsumer(f.svc.pool, f.q)
	again.SetFileService(filesfake.New(filesfake.Options{}))
	again.SetGraphForget(projector.ForgetOrganization)
	if err := again.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE id = $1`, task.ID).Scan(&tasks); err != nil || tasks != 0 {
		t.Fatalf("retry left the task in place: %d %v", tasks, err)
	}
}

func TestPrivacyDeletionGivesUpOnTheLastAttempt(t *testing.T) {
	f := newAuditServiceFixture(t)
	orgs := NewOrganizationService(f.svc.pool, f.q)
	svc := NewPrivacyExportService(f.svc.pool, f.q, orgs)
	org, err := f.q.GetOrganizationByID(f.ctx, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc còn lại"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO files (id, organization_id, storage, object_key, original_filename)
		VALUES ($1, $2, 'local', 'privacy-delete-give-up', 'a.png')`, util.NewID(), f.orgA); err != nil {
		t.Fatal(err)
	}
	row, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug)
	if err != nil {
		t.Fatal(err)
	}
	ev := outbox.Row{
		ID: "ev-privacy-give-up", Topic: "privacy.deletion_requested",
		Payload:  `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`,
		Attempts: outbox.MaxAttempts - 1,
	}
	consumer := NewPrivacyDeletionConsumer(f.svc.pool, f.q)
	consumer.SetFileService(privacyReleaseFail{})
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	var tasks int
	var failedAt *time.Time
	var scheduled *time.Time
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM tasks WHERE id = $1`, task.ID).Scan(&tasks); err != nil || tasks != 1 {
		t.Fatalf("last attempt removed the task: %d %v", tasks, err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT failed_at FROM data_subject_requests WHERE id = $1`, row.ID).Scan(&failedAt); err != nil || failedAt == nil {
		t.Fatalf("request was not failed: %v %v", failedAt, err)
	}
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT deletion_scheduled_at FROM organizations WHERE id = $1`, f.orgA).Scan(&scheduled); err != nil || scheduled != nil {
		t.Fatalf("schedule still set: %v %v", scheduled, err)
	}
	if _, err := orgs.RequireMember(f.ctx, f.orgA, f.memberA.ID); err != nil {
		t.Fatalf("member after give-up: %v", err)
	}
	if _, err := svc.RequestDeletion(f.ctx, f.ownerA.ID, f.orgA, org.Slug); err != nil {
		t.Fatalf("owner could not ask again: %v", err)
	}
}

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

func orgDeletionScheduledAt(t *testing.T, f *auditServiceFixture) *time.Time {
	t.Helper()
	var scheduled *time.Time
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT deletion_scheduled_at FROM organizations WHERE id = $1`, f.orgA).Scan(&scheduled); err != nil {
		t.Fatal(err)
	}
	return scheduled
}

type adminDeletionRow struct {
	before, after         string
	beforeType, afterType string
}

// adminDeletionAction reads the one admin_actions row for action on orgA and
// fails unless it carries a trace id.
func adminDeletionAction(t *testing.T, f *auditServiceFixture, action string) adminDeletionRow {
	t.Helper()
	var row adminDeletionRow
	var traceID, before, after, beforeType, afterType *string
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT trace_id,
			before->>'deletion_scheduled_at', after->>'deletion_scheduled_at',
			jsonb_typeof(before->'deletion_scheduled_at'), jsonb_typeof(after->'deletion_scheduled_at')
		FROM admin_actions WHERE target_id = $1 AND action = $2`, f.orgA, action).Scan(&traceID, &before, &after, &beforeType, &afterType); err != nil {
		t.Fatal(err)
	}
	if traceID == nil || *traceID == "" {
		t.Fatalf("%s admin_actions row has no trace_id", action)
	}
	for _, p := range []struct {
		dst *string
		src *string
	}{{&row.before, before}, {&row.after, after}, {&row.beforeType, beforeType}, {&row.afterType, afterType}} {
		if p.src != nil {
			*p.dst = *p.src
		}
	}
	return row
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
		scheduled := orgDeletionScheduledAt(t, f)
		if scheduled == nil {
			t.Fatal("organization has no deletion_scheduled_at")
		}
		act := adminDeletionAction(t, f, "organization.deletion_scheduled")
		if act.beforeType != "null" || act.afterType != "string" {
			t.Fatalf("schedule before/after: %+v", act)
		}
		if after, err := time.Parse(time.RFC3339, act.after); err != nil || !after.Equal(scheduled.Truncate(time.Second)) {
			t.Fatalf("schedule after %q, organization erases at %s: %v", act.after, scheduled, err)
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
		for _, status := range []struct{ name, sql string }{
			{"suspended", `UPDATE organizations SET status = 'suspended', suspended_reason = 'pilot' WHERE id = $1`},
			{"closed", `UPDATE organizations SET status = 'archived', suspended_reason = 'organization_closed' WHERE id = $1`},
		} {
			// Each fixture holds the test database lock until its test ends.
			t.Run(status.name, func(t *testing.T) {
				f, _, admin, org := newAdminDeletion(t)
				if _, err := f.svc.pool.Exec(f.ctx, status.sql, f.orgA); err != nil {
					t.Fatal(err)
				}
				if _, err := admin.ScheduleOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, org.Slug, reason); err != nil {
					t.Fatalf("%s: %v", status.sql, err)
				}
			})
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
		previous := orgDeletionScheduledAt(t, f)
		if previous == nil {
			t.Fatal("organization has no deletion_scheduled_at before the cancel")
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, reason); err != nil {
			t.Fatal(err)
		}
		var actions int
		if scheduled := orgDeletionScheduledAt(t, f); scheduled != nil {
			t.Fatalf("schedule: %v", scheduled)
		}
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1 AND action = 'organization.deletion_cancelled'`, f.orgA).Scan(&actions); err != nil || actions != 1 {
			t.Fatalf("cancel actions: %d %v", actions, err)
		}
		act := adminDeletionAction(t, f, "organization.deletion_cancelled")
		if act.beforeType != "string" || act.afterType != "null" {
			t.Fatalf("cancel before/after: %+v", act)
		}
		if before, err := time.Parse(time.RFC3339, act.before); err != nil || !before.Equal(previous.Truncate(time.Second)) {
			t.Fatalf("cancel before %q, organization erased at %s: %v", act.before, previous, err)
		}
		var meta string
		if err := f.svc.pool.QueryRow(f.ctx, `SELECT metadata::text FROM audit_events WHERE organization_id = $1 AND action = 'privacy.deletion_cancelled' AND actor_id = $2`, f.orgA, f.adminA.ID).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		compact := strings.ReplaceAll(meta, " ", "")
		if !strings.Contains(compact, `"platform_admin":true`) || !strings.Contains(compact, strings.ReplaceAll(reason, " ", "")) {
			t.Fatalf("cancel audit metadata: %s", meta)
		}
		if err := admin.CancelOrganizationDeletion(f.ctx, f.adminA.ID, f.orgA, reason); !errors.Is(err, ErrNotFound) {
			t.Fatalf("second cancel: %v", err)
		}
	})
}
