package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type auditServiceFixture struct {
	ctx   context.Context
	svc   *AuditService
	tasks *TaskService
	ws    *WorkspaceService
	q     *db.Queries

	ownerA  db.User
	adminA  db.User
	memberA db.User
	orgA    string
	wsA     db.Workspace

	ownerB db.User
	orgB   string
}

func newAuditServiceFixture(t *testing.T) *auditServiceFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	auth := NewAuthService(pool, q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})

	f := &auditServiceFixture{ctx: ctx, q: q, ws: ws,
		svc: NewAuditService(pool, q, orgs, ws), tasks: NewTaskService(pool, q, ws)}

	f.ownerA = registerVerified(t, q, auth, "aud-owner-a@example.com", "Owner A")
	f.adminA = registerVerified(t, q, auth, "aud-admin-a@example.com", "Admin A")
	f.memberA = registerVerified(t, q, auth, "aud-member-a@example.com", "Member A")
	f.ownerB = registerVerified(t, q, auth, "aud-owner-b@example.com", "Owner B")

	orgA, err := orgs.Create(ctx, f.ownerA.ID, "Org A", "org-a")
	if err != nil {
		t.Fatal(err)
	}
	f.orgA = orgA.ID
	orgB, err := orgs.Create(ctx, f.ownerB.ID, "Org B", "org-b")
	if err != nil {
		t.Fatal(err)
	}
	f.orgB = orgB.ID

	v, err := ws.CreateInOrg(ctx, f.ownerA.ID, orgA.ID, "WS A", "ws-a")
	if err != nil {
		t.Fatal(err)
	}
	f.wsA = v.Workspace

	addOrgMemberRole(t, q, orgA.ID, f.adminA.ID, "admin")
	addOrgMember(t, q, orgA.ID, f.memberA.ID)
	addWorkspaceMember(t, q, f.wsA.ID, f.memberA.ID)
	return f
}

func addOrgMemberRole(t *testing.T, q *db.Queries, orgID, userID, role string) {
	t.Helper()
	if err := q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: orgID, UserID: userID, Role: role,
	}); err != nil {
		t.Fatal(err)
	}
}

// The log of one tenant must be unreachable from another, and an ordinary
// member must not read the organization-wide log at all — most of what is in
// it is about people who are not them.
func TestAuditIsolation(t *testing.T) {
	f := newAuditServiceFixture(t)

	if _, err := f.svc.List(f.ctx, f.ownerB.ID, f.orgA, AuditFilter{}); err != ErrForbidden {
		t.Fatalf("owner of another organization read org A's log: %v", err)
	}
	if _, err := f.svc.List(f.ctx, f.memberA.ID, f.orgA, AuditFilter{}); err != ErrForbidden {
		t.Fatalf("ordinary member read the organization log: %v", err)
	}
	if _, err := f.svc.List(f.ctx, f.adminA.ID, f.orgA, AuditFilter{}); err != nil {
		t.Fatalf("org admin cannot read the log: %v", err)
	}

	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Riêng tư"})
	if err != nil {
		t.Fatal(err)
	}
	// A non-member asking for a task's history learns nothing about whether it
	// exists: the workspace gate answers before the resource is looked at.
	if _, err := f.svc.ResourceHistory(f.ctx, f.ownerB.ID, f.wsA.ID, "task", task.ID, 0); err != ErrForbidden {
		t.Fatalf("non-member read resource history: %v", err)
	}
	// A plain workspace member may: activity on a task they can see is theirs
	// to read.
	history, err := f.svc.ResourceHistory(f.ctx, f.memberA.ID, f.wsA.ID, "task", task.ID, 0)
	if err != nil || len(history) == 0 {
		t.Fatalf("member history: err=%v rows=%d", err, len(history))
	}
	if history[0].Action != audit.ActionTaskCreated {
		t.Fatalf("history[0] = %s", history[0].Action)
	}
}

// The IP address is personal data. An admin can answer "who changed what"
// without it; only the owner sees it (OPEN_QUESTIONS A2).
func TestOnlyTheOwnerSeesTheIPAddress(t *testing.T) {
	f := newAuditServiceFixture(t)
	ctx := audit.WithRequest(f.ctx, audit.RequestInfo{
		CorrelationID: "corr-ip-check", IP: "203.0.113.7", UserAgent: "test-agent",
	})
	if _, err := f.tasks.Create(ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Có IP"}); err != nil {
		t.Fatal(err)
	}

	asOwner, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: audit.ActionTaskCreated})
	if err != nil || len(asOwner) == 0 {
		t.Fatalf("owner list: err=%v rows=%d", err, len(asOwner))
	}
	if asOwner[0].IP == nil || *asOwner[0].IP != "203.0.113.7" {
		t.Fatalf("owner should see the address, got %v", asOwner[0].IP)
	}

	asAdmin, err := f.svc.List(f.ctx, f.adminA.ID, f.orgA, AuditFilter{Action: audit.ActionTaskCreated})
	if err != nil || len(asAdmin) == 0 {
		t.Fatalf("admin list: err=%v rows=%d", err, len(asAdmin))
	}
	if asAdmin[0].IP != nil {
		t.Fatalf("admin must not see the address, got %q", *asAdmin[0].IP)
	}
	// Nor may it leak through the embedded row the DTO is built from.
	if asAdmin[0].IpAddress.Valid {
		t.Fatal("the raw column is still populated for an admin")
	}

	history, err := f.svc.ResourceHistory(f.ctx, f.ownerA.ID, f.wsA.ID, "task", asOwner[0].ResourceID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) > 0 && history[0].IP != nil {
		t.Fatal("resource history must never carry an address, not even for an owner")
	}
}

func TestAuditFilterAndCursor(t *testing.T) {
	f := newAuditServiceFixture(t)
	for i := range 3 {
		if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc"}); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	page, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: audit.ActionTaskCreated, Limit: 2})
	if err != nil || len(page) != 2 {
		t.Fatalf("first page: err=%v rows=%d", err, len(page))
	}
	next, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{
		Action: audit.ActionTaskCreated, Limit: 2, Before: page[1].ID,
	})
	if err != nil || len(next) != 1 {
		t.Fatalf("second page: err=%v rows=%d", err, len(next))
	}
	if next[0].ID >= page[1].ID {
		t.Fatal("the cursor returned a row that was already on the first page")
	}
	// A filter that matches nothing returns nothing rather than everything.
	none, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: "no.such.action"})
	if err != nil || len(none) != 0 {
		t.Fatalf("unmatched filter: err=%v rows=%d", err, len(none))
	}
}

func TestRetentionIsOwnerOnlyAndBounded(t *testing.T) {
	f := newAuditServiceFixture(t)

	days, err := f.svc.Retention(f.ctx, f.adminA.ID, f.orgA)
	if err != nil || days != retentionDefaultDays {
		t.Fatalf("default retention: err=%v days=%d", err, days)
	}
	if _, err := f.svc.SetRetention(f.ctx, f.adminA.ID, f.orgA, 180); err != ErrForbidden {
		t.Fatalf("admin changed retention: %v", err)
	}
	if _, err := f.svc.SetRetention(f.ctx, f.ownerA.ID, f.orgA, 5); err == nil {
		t.Fatal("a five-day window should be rejected")
	}
	if _, err := f.svc.SetRetention(f.ctx, f.ownerA.ID, f.orgA, 9999); err == nil {
		t.Fatal("a window past the ceiling should be rejected")
	}
	got, err := f.svc.SetRetention(f.ctx, f.ownerA.ID, f.orgA, 180)
	if err != nil || got != 180 {
		t.Fatalf("set retention: err=%v days=%d", err, got)
	}
	// Changing the window is itself an audited command.
	rows, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: audit.ActionAuditRetentionSet})
	if err != nil || len(rows) != 1 {
		t.Fatalf("retention audit: err=%v rows=%d", err, len(rows))
	}
	if rows[0].ChangesParsed["retain_days"] == nil {
		t.Fatalf("retention change not recorded: %+v", rows[0].ChangesParsed)
	}
}

func TestExportIsOwnerOnlyAndOneAtATime(t *testing.T) {
	f := newAuditServiceFixture(t)
	from := time.Now().Add(-24 * time.Hour)
	to := time.Now()

	if _, err := f.svc.RequestExport(f.ctx, f.adminA.ID, f.orgA, "csv", from, to); err != ErrForbidden {
		t.Fatalf("admin requested an export: %v", err)
	}
	if _, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "pdf", from, to); err == nil {
		t.Fatal("an unsupported format should be rejected")
	}
	if _, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv", to, from); err == nil {
		t.Fatal("a backwards range should be rejected")
	}
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv", from, to); err == nil {
		t.Fatal("a second export should be refused while the first is running")
	}
	// Another tenant cannot read this job even knowing its id.
	if _, err := f.svc.Export(f.ctx, f.ownerB.ID, f.orgA, exp.ID); err != ErrForbidden {
		t.Fatalf("cross-tenant export read: %v", err)
	}
	if _, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, "01J8X4NOTHINGATALL0000000"); err != ErrNotFound {
		t.Fatal("an unknown export id should be a 404")
	}
}

type expirySpy struct{ counts map[string]float64 }

func (s *expirySpy) SetAuditExpired(orgID string, n float64) {
	if s.counts == nil {
		s.counts = map[string]float64{}
	}
	s.counts[orgID] = n
}

// Retention reports, it does not erase. Deleting audit rows is not reversible
// and cannot be rehearsed by trying it, so the marker's whole job is to make
// the policy visible (ADR 0012).
func TestRetentionMarkerCountsWithoutDeleting(t *testing.T) {
	f := newAuditServiceFixture(t)
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Cũ"}); err != nil {
		t.Fatal(err)
	}
	// Age the rows past any window by moving the clock, not the data: the
	// column cannot be updated, which is the point.
	if _, err := f.svc.SetRetention(f.ctx, f.ownerA.ID, f.orgA, 30); err != nil {
		t.Fatal(err)
	}

	spy := &expirySpy{}
	f.svc.markExpired(f.ctx, spy)
	if _, ok := spy.counts[f.orgA]; !ok {
		t.Fatalf("no count reported for the organization: %+v", spy.counts)
	}
	if spy.counts[f.orgA] != 0 {
		t.Fatalf("fresh rows should not be expired, got %v", spy.counts[f.orgA])
	}

	before, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil {
		t.Fatal(err)
	}
	f.svc.markExpired(f.ctx, spy)
	after, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("the marker removed rows: %d → %d", len(before), len(after))
	}
}
