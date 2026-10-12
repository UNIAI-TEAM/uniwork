package service

import (
	"context"
	"errors"
	"testing"
	"time"

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
