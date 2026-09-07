package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Suspending closes the tenant to its own members on both membership gates,
// and the admin_actions row, the audit row and the owner event commit together.
func TestSuspendClosesBothMembershipGates(t *testing.T) {
	f := newAuditFixture(t)
	w := f.build(t)
	ctx := context.Background()

	if _, err := f.admin.SetOrganizationStatus(ctx, f.third.ID, f.orgID, OrganizationSuspended, "short"); !errors.Is(err, ErrReasonTooShort) {
		t.Fatalf("short reason: %v", err)
	}
	f.suspend(t, OrganizationSuspended)

	if _, err := f.orgs.RequireMember(ctx, f.orgID, f.owner.ID); !errors.Is(err, ErrOrganizationSuspended) {
		t.Fatalf("org gate: %v", err)
	}
	if _, err := f.ws.RequireMember(ctx, w.ID, f.owner.ID); !errors.Is(err, ErrOrganizationSuspended) {
		t.Fatalf("workspace gate: %v", err)
	}
	// The slug lookup the web shell boots from must say "suspended", not 404,
	// or the client redirects to the workspace list instead of the notice.
	if _, err := f.ws.GetBySlugs(ctx, f.owner.ID, "audit-org", "audit-ws"); !errors.Is(err, ErrOrganizationSuspended) {
		t.Fatalf("GetBySlugs during suspension: %v", err)
	}
	actions, err := f.q.ListAdminActionsByTarget(ctx, db.ListAdminActionsByTargetParams{TargetType: "organization", TargetID: f.orgID, Limit: 10})
	if err != nil || len(actions) != 1 || actions[0].Action != audit.ActionOrganizationSuspended || actions[0].ActorID != f.third.ID {
		t.Fatalf("admin_actions: %v %+v", err, actions)
	}
	rows, err := f.q.AdminListAuditEventsByCorrelation(ctx, actions[0].TraceID.String)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, r := range rows {
		if r.Action == audit.ActionOrganizationSuspended && r.ResourceID == f.orgID {
			found = true
		}
	}
	if !found {
		t.Fatalf("audit row with the action's trace id missing: %+v", rows)
	}
	// Idempotent: suspending twice writes nothing new.
	f.suspend(t, OrganizationSuspended)
	if again, _ := f.q.ListAdminActionsByTarget(ctx, db.ListAdminActionsByTargetParams{TargetType: "organization", TargetID: f.orgID, Limit: 10}); len(again) != 1 {
		t.Fatalf("second suspend wrote %d rows", len(again))
	}

	f.suspend(t, OrganizationActive)
	if _, err := f.ws.RequireMember(ctx, w.ID, f.owner.ID); err != nil {
		t.Fatalf("after unsuspend: %v", err)
	}
	d, err := f.admin.GetOrganization(ctx, f.orgID)
	if err != nil || d.Organization.Status != OrganizationActive || len(d.Actions) != 2 || len(d.Entitlements) == 0 {
		t.Fatalf("detail: %v %+v", err, d.Organization)
	}
}

func TestPlatformRoleGrantRevoke(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	ctx := context.Background()
	if _, err := f.admin.SetPlatformRole(ctx, CLIActor, "nobody@example.com", PlatformRoleAdmin, "onboarding the ops team"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown email: %v", err)
	}
	if _, err := f.admin.SetPlatformRole(ctx, CLIActor, f.third.Email, "root", "onboarding the ops team"); err == nil {
		t.Fatal("invalid role accepted")
	}
	u, err := f.admin.SetPlatformRole(ctx, CLIActor, f.third.Email, PlatformRoleSupport, "onboarding the ops team")
	if err != nil || u.PlatformRole.String != PlatformRoleSupport || u.PlatformRoleGrantedBy.String != CLIActor || !u.PlatformRoleGrantedAt.Valid {
		t.Fatalf("grant: %v %+v", err, u)
	}
	if role, _ := f.admin.PlatformRole(ctx, f.third.ID); role != PlatformRoleSupport {
		t.Fatalf("PlatformRole = %q", role)
	}
	u, err = f.admin.SetPlatformRole(ctx, CLIActor, f.third.Email, "", "left the team")
	if err != nil || u.PlatformRole.Valid || u.PlatformRoleGrantedAt.Valid {
		t.Fatalf("revoke: %v %+v", err, u)
	}
	list, _ := f.admin.ListPlatformRoles(ctx)
	if len(list) != 0 {
		t.Fatalf("list after revoke: %+v", list)
	}
}

func TestAdminListAndTrace(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	ctx := context.Background()
	page, err := f.admin.ListOrganizations(ctx, ListOrganizationsInput{Query: "audit"})
	rows := page.Organizations
	if err != nil || len(rows) != 1 || rows[0].MemberCount != 1 || rows[0].WorkspaceCount != 1 || !rows[0].LastActivityAt.Valid {
		t.Fatalf("list: %v %+v", err, rows)
	}
	if page.Total != 1 || page.Limit != 50 {
		t.Fatalf("page meta: %+v", page)
	}
	// The window count answers for the whole filtered set, not the page.
	if narrow, _ := f.admin.ListOrganizations(ctx, ListOrganizationsInput{Query: "audit", Limit: 1, Sort: SortOrganizationsActivityAsc}); narrow.Total != 1 || len(narrow.Organizations) != 1 {
		t.Fatalf("paged: %+v", narrow)
	}
	// An unknown sort falls back instead of reaching the database.
	if bad, err := f.admin.ListOrganizations(ctx, ListOrganizationsInput{Sort: "; drop table organizations"}); err != nil || bad.Total == 0 {
		t.Fatalf("unknown sort: %v %+v", err, bad)
	}
	if suspended, _ := f.admin.ListOrganizations(ctx, ListOrganizationsInput{Status: OrganizationSuspended}); len(suspended.Organizations) != 0 || suspended.Total != 0 {
		t.Fatalf("status filter: %+v", suspended)
	}
	if _, err := f.admin.Trace(ctx, "bad id!"); err == nil {
		t.Fatal("invalid trace id accepted")
	}
	f.suspend(t, OrganizationSuspended)
	actions, _ := f.q.ListAdminActionsByTarget(ctx, db.ListAdminActionsByTargetParams{TargetType: "organization", TargetID: f.orgID, Limit: 1})
	tr, err := f.admin.Trace(ctx, actions[0].TraceID.String)
	if err != nil || len(tr.Actions) != 1 || len(tr.Audit) != 1 || len(tr.Outbox) != 1 {
		t.Fatalf("trace: %v audit=%d outbox=%d actions=%d", err, len(tr.Audit), len(tr.Outbox), len(tr.Actions))
	}
	sys, err := f.admin.System(ctx, "v", "c")
	if err != nil || sys.MigrationEmbedded == "" || sys.OutboxPending < 1 {
		t.Fatalf("system: %v %+v", err, sys)
	}
}
