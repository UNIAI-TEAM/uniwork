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
	got, err := f.ws.AcceptInvite(ctx, f.ub.ID, pend[0].Token, nil)
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
	// A retry after a lost response answers the same (EC-12).
	if again, err := f.ws.AcceptInvite(ctx, f.ub.ID, pend[0].Token, nil); err != nil || again.Workspace == nil || again.Workspace.ID != w.ID {
		t.Fatalf("retried token: %v %+v", err, again)
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
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: f.ub.ID, Role: "member"}); err != nil {
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
		WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: f.ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: f.uc.ID, Role: "member",
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
		WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: f.ub.ID, Role: "member",
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
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID, IncludeArchived: false,
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

// A second change computed from a row read before the first one committed
// must still diff against the locked row: the first change's alias survives
// and the audit row names the real old value.
func TestWorkspaceUpdateDiffsAgainstTheLockedRow(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Beta", "doi-beta")
	if err != nil {
		t.Fatal(err)
	}
	a := w.TaskPrefix
	stale, err := f.q.GetWorkspaceByID(ctx, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	b, c := "BBB", "CCC"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &b}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.updateFrom(ctx, f.ua.ID, stale, UpdateWorkspaceInput{TaskPrefix: &c}); err != nil {
		t.Fatal(err)
	}
	rows, err := f.pool.Query(ctx, `SELECT value FROM workspace_aliases WHERE workspace_id = $1 AND kind = 'task_prefix' ORDER BY value`, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	want := []string{a, "BBB"}
	if want[0] > want[1] {
		want[0], want[1] = want[1], want[0]
	}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("aliases = %v, want %v", got, want)
	}
	var changes string
	if err := f.pool.QueryRow(ctx, `SELECT changes FROM audit_events WHERE resource_id = $1 AND action = 'workspace.updated' ORDER BY occurred_at DESC, id DESC LIMIT 1`, w.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(changes, `"BBB"`) || !strings.Contains(changes, `"CCC"`) || strings.Contains(changes, `"`+a+`"`) {
		t.Fatalf("audit changes = %s, want BBB -> CCC", changes)
	}
}

func TestWorkspaceUnchangedLegacyPrefixIsNotRevalidated(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Gamma", "doi-gamma")
	if err != nil {
		t.Fatal(err)
	}
	// A derived prefix can be one letter, which the pattern would refuse.
	if _, err := f.pool.Exec(ctx, `UPDATE workspaces SET task_prefix = 'G' WHERE id = $1`, w.ID); err != nil {
		t.Fatal(err)
	}
	same, name := "g", "Đội Gamma 2"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &same, Name: &name}); err != nil {
		t.Fatalf("re-sent prefix: %v", err)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM workspace_aliases WHERE workspace_id = $1`, w.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("aliases = %d, err %v; want none", n, err)
	}
}

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

func TestWorkspaceSlugChangeRejectsBadAndIgnoresUnchanged(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"A", "Có Dấu", "-x-", "admin"} {
		bad := bad
		var ve ValidationError
		if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Slug: &bad}); !errors.As(err, &ve) {
			t.Errorf("slug %q: err = %v, want ValidationError", bad, err)
		}
	}
	// A legacy slug that no longer passes validation is not a change when re-sent.
	if _, err := f.pool.Exec(ctx, `UPDATE workspaces SET slug = 'x' WHERE id = $1`, w.ID); err != nil {
		t.Fatal(err)
	}
	same, name := "x", "Đội Alpha 2"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{Slug: &same, Name: &name}); err != nil {
		t.Fatalf("re-sent slug: %v", err)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM workspace_aliases WHERE workspace_id = $1`, w.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("aliases = %d, err %v; want none", n, err)
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

// A slug the unlocked row already had skips the format check; if the locked
// row has moved on, the re-sent old value is a real change and is validated.
func TestWorkspaceSlugRevalidatedAgainstTheLockedRow(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Delta", "doi-delta")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE workspaces SET slug = 'x' WHERE id = $1`, w.ID); err != nil {
		t.Fatal(err)
	}
	stale, err := f.q.GetWorkspaceByID(ctx, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE workspaces SET slug = 'doi-delta-2' WHERE id = $1`, w.ID); err != nil {
		t.Fatal(err)
	}
	// The name keeps the unlocked hint non-empty, so the locked diff runs.
	same, name := "x", "Đội Delta 2"
	var ve ValidationError
	if _, err := f.ws.updateFrom(ctx, f.ua.ID, stale, UpdateWorkspaceInput{Slug: &same, Name: &name}); !errors.As(err, &ve) {
		t.Fatalf("stale legacy slug: err = %v, want ValidationError", err)
	}
}
