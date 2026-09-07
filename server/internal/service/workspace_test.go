package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type wsFix struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ws   *WorkspaceService
	out  *fakeOutbox
	ua   db.User
	ub   db.User
	uc   db.User
	org  db.Organization
}

// fixture: 3 user; A tạo org "unicom".
func wsFixture(t *testing.T) wsFix {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ctx := context.Background()
	reg := func(email, name string) db.User { return registerVerified(t, q, as, email, name) }
	ua, ub, uc := reg("a@example.com", "A"), reg("b@example.com", "B"), reg("c@example.com", "C")
	orgs := NewOrganizationService(pool, q)
	org, err := orgs.Create(ctx, ua.ID, "Unicom", "unicom")
	if err != nil {
		t.Fatal(err)
	}
	out := &fakeOutbox{}
	return wsFix{pool: pool, q: q, orgs: orgs, ws: NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, out), out: out, ua: ua, ub: ub, uc: uc, org: org}
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
	f.out.mu.Lock()
	queued := append([]mail.Message(nil), f.out.queued...)
	f.out.mu.Unlock()
	if len(queued) != 2 {
		t.Fatalf("want 2 invite mails, got %d", len(queued))
	}
	if queued[0].Kind != mail.KindWorkspaceInvite || queued[0].Locale != f.ua.Locale ||
		!strings.Contains(queued[0].HTML, "/invite/"+invs[0].Token) {
		t.Fatalf("invite mail %+v", queued[0])
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
	if err != nil || got.Workspace == nil || got.Workspace.ID != w.ID {
		t.Fatalf("accept: %v %+v", err, got)
	}
	if got.Organization.ID != f.org.ID {
		t.Fatalf("accept should name the organization too: %+v", got.Organization)
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

func TestWorkspaceUpdateName(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: f.ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	name := "Đội Beta"
	if _, err := f.ws.Update(ctx, f.ub.ID, w.ID, UpdateWorkspaceInput{Name: &name}); err != ErrForbidden {
		t.Fatalf("member update: %v", err)
	}
	got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Name: &name})
	if err != nil || got.Name != name {
		t.Fatalf("owner update: %v %+v", err, got)
	}
}

func TestCurrentMembership_ExplicitAndOrgAdmin(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	m, err := f.ws.CurrentMembership(ctx, f.ua.ID, w.ID)
	if err != nil || m.Role != "owner" || m.Source != MembershipSourceMembership {
		t.Fatalf("owner: %+v %v", m, err)
	}
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: f.ub.ID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	m, err = f.ws.CurrentMembership(ctx, f.ub.ID, w.ID)
	if err != nil || m.Role != "admin" || m.Source != MembershipSourceOrgAdmin {
		t.Fatalf("org admin: %+v %v", m, err)
	}
	if _, err := f.ws.CurrentMembership(ctx, f.uc.ID, w.ID); err != ErrForbidden {
		t.Fatalf("outsider: %v", err)
	}
}

func TestUpdateMemberRoleAndRemove(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Beta", "beta")
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.uc.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := f.ws.UpdateMemberRole(ctx, f.ub.ID, w.ID, f.uc.ID, "admin"); err != ErrForbidden {
		t.Fatalf("member promote: %v", err)
	}
	got, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ub.ID, "admin")
	if err != nil || got.Role != "admin" {
		t.Fatalf("promote: %+v %v", got, err)
	}
	if _, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ub.ID, "owner"); err == nil {
		t.Fatal("expected invalid owner role")
	}
	if _, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ua.ID, "admin"); err != ErrForbidden {
		t.Fatalf("demote owner: %v", err)
	}
	if err := f.ws.RemoveMember(ctx, f.ua.ID, w.ID, f.ub.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := f.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("still member: %v", err)
	}
	if err := f.ws.RemoveMember(ctx, f.ua.ID, w.ID, f.ua.ID); err != ErrForbidden {
		t.Fatalf("remove owner: %v", err)
	}
	// member may leave themselves
	if err := f.ws.RemoveMember(ctx, f.uc.ID, w.ID, f.uc.ID); err != nil {
		t.Fatalf("self leave: %v", err)
	}
}

func TestOrgAdminCanManageMembersWithoutMembershipRow(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Gamma", "gamma")
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: f.uc.ID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := f.ws.UpdateMemberRole(ctx, f.uc.ID, w.ID, f.ub.ID, "admin")
	if err != nil || got.Role != "admin" {
		t.Fatalf("org admin promote: %+v %v", got, err)
	}
	if err := f.ws.RemoveMember(ctx, f.uc.ID, w.ID, f.ub.ID); err != nil {
		t.Fatalf("org admin remove: %v", err)
	}
}

func TestWorkspaceCreateSeedsTaskStatuses(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if w.TaskPrefix != "ALP" {
		t.Fatalf("WorkspaceView.TaskPrefix = %q, want ALP", w.TaskPrefix)
	}
	row, err := f.q.GetWorkspaceByID(ctx, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.TaskPrefix != "ALP" {
		t.Fatalf("task_prefix = %q, want ALP", row.TaskPrefix)
	}
	statuses, err := f.q.ListTaskStatuses(ctx, db.ListTaskStatusesParams{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := BuiltInTaskStatuses()
	if len(statuses) != len(want) {
		t.Fatalf("len = %d, want %d", len(statuses), len(want))
	}
	for i, st := range statuses {
		if !st.IsSystem || st.Key != want[i].Key || st.Category != want[i].Category ||
			st.Position != want[i].Position || st.CreatedByKind != "system" || st.CreatedBy != w.CreatedBy {
			t.Fatalf("status[%d] = %+v, want key=%s system created_by=%s", i, st, want[i].Key, w.CreatedBy)
		}
	}
}
