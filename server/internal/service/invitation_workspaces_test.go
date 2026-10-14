package service

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// orgWorkspace creates a workspace in the fixture's organization as its owner.
// The workspace cap is lifted: the grant, not the plan, is the subject.
func (f *orgInviteFixture) orgWorkspace(t *testing.T, name, slug string) WorkspaceView {
	t.Helper()
	if _, err := f.orgs.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"members.max": null, "workspaces.max": null}'::jsonb WHERE organization_id = $1`, f.org.ID); err != nil {
		t.Fatal(err)
	}
	v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, name, slug)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func (f *orgInviteFixture) workspaceRole(t *testing.T, workspaceID, userID string) string {
	t.Helper()
	m, err := f.q.GetWorkspaceMember(f.ctx, db.GetWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return m.Role
}

func refIDs(refs []WorkspaceRef) []string {
	out := make([]string, 0, len(refs))
	for _, r := range refs {
		out = append(out, r.ID)
	}
	return out
}

// UNI-1582: an organization invitation may carry workspaces; accepting it
// grants the organization and, in the same transaction, each of them as a
// plain member (with its default channel). The workspaces left out stay
// closed: organization membership does not open every workspace.
func TestOrganizationInvitationGrantsTheChosenWorkspaces(t *testing.T) {
	f := newOrgInviteFixture(t)
	sales := f.orgWorkspace(t, "Kinh doanh", "kinh-doanh")
	ops := f.orgWorkspace(t, "Vận hành", "van-hanh")
	other := f.orgWorkspace(t, "Ban giám đốc", "ban-giam-doc")
	chat := NewChatService(f.orgs.pool, f.q, f.ws, &capturePublisher{})
	room, err := chat.EnsureWorkspaceRoom(f.ctx, f.owner.ID, ops.ID)
	if err != nil {
		t.Fatal(err)
	}

	invs, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember,
		[]string{ops.ID, sales.ID, ops.ID})
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite: %v %d", err, len(invs))
	}
	if got := refIDs(invs[0].Workspaces); !slices.Equal(got, []string{sales.ID, ops.ID}) {
		t.Fatalf("invitation grants %v, want the two chosen, oldest first", got)
	}

	p, err := f.ws.PreviewInvitation(f.ctx, f.invitee.ID, invs[0].Token)
	if err != nil {
		t.Fatal(err)
	}
	if p.Workspace != nil || len(p.Workspaces) != 2 || p.Workspaces[0].Name != "Kinh doanh" || p.Workspaces[1].Slug != "van-hanh" {
		t.Fatalf("preview workspaces: %+v / %+v", p.Workspace, p.Workspaces)
	}
	mine, err := f.ws.PendingInvitations(f.ctx, f.invitee.ID)
	if err != nil || len(mine) != 1 || !slices.Equal(refIDs(mine[0].Workspaces), []string{sales.ID, ops.ID}) {
		t.Fatalf("my invitations: %v %+v", err, mine)
	}
	listed, err := f.svc.PendingInvitations(f.ctx, f.admin.ID, f.org.ID)
	if err != nil || len(listed) != 1 || !slices.Equal(refIDs(listed[0].Workspaces), []string{sales.ID, ops.ID}) {
		t.Fatalf("admin's pending list: %v %+v", err, listed)
	}

	result, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Workspace == nil || result.Workspace.ID != sales.ID {
		t.Fatalf("lands in %+v, want the oldest granted workspace", result.Workspace)
	}
	if m, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.invitee.ID); err != nil || m.Role != OrgRoleMember {
		t.Fatalf("organization membership: %v %+v", err, m)
	}
	for _, w := range []string{sales.ID, ops.ID} {
		if got := f.workspaceRole(t, w, f.invitee.ID); got != "member" {
			t.Fatalf("workspace %s role %q, want member", w, got)
		}
	}
	if got := f.workspaceRole(t, other.ID, f.invitee.ID); got != "" {
		t.Fatalf("a workspace nobody chose was opened: role %q", got)
	}
	if _, err := f.ws.GetView(f.ctx, f.invitee.ID, other.ID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("the unchosen workspace answers %v", err)
	}
	if got := defaultChannelRole(t, f.q, room.RoomID, f.invitee.ID); got != "member" {
		t.Fatalf("default channel role %q, want member", got)
	}
	// One audit row per workspace joined, beside the organization's.
	var rows int
	if err := f.orgs.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'member.joined' AND resource_type = 'workspace_member' AND resource_id = $1`, f.invitee.ID).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("workspace member.joined audit rows = %d, %v; want 2", rows, err)
	}

	// The retry of a lost response answers the same landing (EC-12).
	again, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token, nil)
	if err != nil || again.Workspace == nil || again.Workspace.ID != sales.ID {
		t.Fatalf("retried accept: %v %+v", err, again.Workspace)
	}
}

// A workspace of another organization is refused like any other row of a
// tenant the admin does not hold, and nothing is written (ADR 0008).
func TestOrganizationInvitationRefusesAnotherTenantsWorkspace(t *testing.T) {
	f := newOrgInviteFixture(t)
	mine := f.orgWorkspace(t, "Của mình", "cua-minh")
	stranger := registerVerified(t, f.q, NewAuthService(f.orgs.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "stranger-owner@example.com", "Lạ")
	theirOrg, err := f.orgs.Create(f.ctx, stranger.ID, "Khác", "to-chuc-khac")
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := f.ws.CreateInOrg(f.ctx, stranger.ID, theirOrg.ID, "Của họ", "cua-ho")
	if err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{{theirs.ID}, {mine.ID, theirs.ID}, {"01J8X4NOSUCHWORKSPACE0000"}} {
		_, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, ids)
		if !codedIs(err, "workspace_not_in_organization") || codedStatus(err) != 400 {
			t.Fatalf("invite with %v = %v, want 400 workspace_not_in_organization", ids, err)
		}
	}
	var n int
	if err := f.orgs.pool.QueryRow(f.ctx, `SELECT count(*) FROM invitations WHERE organization_id = $1`, f.org.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a refused invite wrote %d invitations (%v)", n, err)
	}
}

// Inviting an address that already has a pending invitation keeps its token
// (the link in the first email must keep working) and replaces the workspaces
// with the latest choice: the admin's last word is what the invitee gets.
func TestReinvitingReplacesTheWorkspaceChoice(t *testing.T) {
	f := newOrgInviteFixture(t)
	first := f.orgWorkspace(t, "Một", "mot")
	second := f.orgWorkspace(t, "Hai", "hai")
	a, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, []string{first.ID})
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := f.svc.InviteToOrg(f.ctx, f.admin.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, []string{second.ID})
	if err != nil {
		t.Fatal(err)
	}
	if b[0].Token != a[0].Token {
		t.Fatal("re-inviting minted a second token")
	}
	if got := refIDs(b[0].Workspaces); !slices.Equal(got, []string{second.ID}) {
		t.Fatalf("re-invite answers %v, want the latest choice", got)
	}
	p, err := f.ws.PreviewInvitation(f.ctx, f.invitee.ID, a[0].Token)
	if err != nil || !slices.Equal(refIDs(p.Workspaces), []string{second.ID}) {
		t.Fatalf("preview after re-invite: %v %+v", err, p.Workspaces)
	}
	var changed int
	if err := f.orgs.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'member.invited' AND resource_id = $1`, a[0].ID).Scan(&changed); err != nil || changed != 2 {
		t.Fatalf("member.invited audit rows = %d, %v; want the invite and the change", changed, err)
	}
	// The same choice again changes nothing and writes nothing.
	if _, _, err := f.svc.InviteToOrg(f.ctx, f.admin.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, []string{second.ID}); err != nil {
		t.Fatal(err)
	}
	if err := f.orgs.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'member.invited' AND resource_id = $1`, a[0].ID).Scan(&changed); err != nil || changed != 2 {
		t.Fatalf("an unchanged re-invite was audited: %d rows", changed)
	}
	// And no workspace at all is a choice too.
	c, _, err := f.svc.InviteToOrg(f.ctx, f.admin.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, nil)
	if err != nil || len(c[0].Workspaces) != 0 {
		t.Fatalf("cleared choice: %v %+v", err, c)
	}
	result, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, a[0].Token, nil)
	if err != nil || result.Workspace != nil {
		t.Fatalf("accept with no workspace: %v %+v", err, result.Workspace)
	}
	for _, w := range []string{first.ID, second.ID} {
		if got := f.workspaceRole(t, w, f.invitee.ID); got != "" {
			t.Fatalf("workspace %s opened with role %q after the choice was cleared", w, got)
		}
	}
}

// A workspace that disappears between the invitation and the accept is
// skipped: the person still joins the organization and the rest.
func TestAcceptSkipsAWorkspaceThatIsGone(t *testing.T) {
	f := newOrgInviteFixture(t)
	gone := f.orgWorkspace(t, "Sắp xóa", "sap-xoa")
	kept := f.orgWorkspace(t, "Còn lại", "con-lai")
	invs, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleMember, []string{gone.ID, kept.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.orgs.pool.Exec(f.ctx, `DELETE FROM workspaces WHERE id = $1`, gone.ID); err != nil {
		t.Fatal(err)
	}
	result, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Workspace == nil || result.Workspace.ID != kept.ID {
		t.Fatalf("lands in %+v, want the workspace still there", result.Workspace)
	}
	if got := f.workspaceRole(t, gone.ID, f.invitee.ID); got != "" {
		t.Fatalf("a membership was written for a deleted workspace: %q", got)
	}
}

// An admin of the organization may open every workspace in it, so an admin
// invited without a workspace still lands in one instead of being asked to
// create it (UNI-1472); a plain member invited without one lands nowhere.
func TestAcceptLandsAnAdminInTheOrganizationsFirstWorkspace(t *testing.T) {
	f := newOrgInviteFixture(t)
	home := f.orgWorkspace(t, "Trang chủ", "trang-chu")
	invs, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{f.invitee.Email}, OrgRoleAdmin, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token, nil)
	if err != nil || result.Workspace == nil || result.Workspace.ID != home.ID {
		t.Fatalf("admin lands in %+v (%v), want the organization's workspace", result.Workspace, err)
	}
	if got := f.workspaceRole(t, home.ID, f.invitee.ID); got != "" {
		t.Fatalf("an admin invited without a workspace got a membership row %q", got)
	}
}

// The switch path (ADR 0032) grants the workspaces too, in the same
// transaction that gives the old organization up.
func TestSwitchingOrganizationsGrantsTheInvitationsWorkspaces(t *testing.T) {
	f := newOrgMembersFixture(t)
	founder := registerVerified(t, f.q, f.auth, "b-founder@example.com", "Founder B")
	b, err := f.orgs.Create(f.ctx, founder.ID, "Tổ chức B", "to-chuc-b")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := f.ws.CreateInOrg(f.ctx, founder.ID, b.ID, "Nhóm B", "nhom-b")
	if err != nil {
		t.Fatal(err)
	}
	f.inviteToOrg(t, b.ID, founder.ID, "warmup@example.com") // wires mail, lifts the seat cap
	invs, _, err := f.svc.InviteToOrg(f.ctx, founder.ID, b.ID, []string{f.member.Email}, OrgRoleMember, []string{ws.ID})
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.ws.AcceptInvite(f.ctx, f.member.ID, invs[0].Token,
		[]SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionLeave}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Organization.ID != b.ID || result.Workspace == nil || result.Workspace.ID != ws.ID {
		t.Fatalf("switch lands in %s / %+v", result.Organization.ID, result.Workspace)
	}
	if got := f.activeOrgIDs(t, f.member.ID); !slices.Equal(got, []string{b.ID}) {
		t.Fatalf("active organizations after the switch: %v", got)
	}
	if m, err := f.q.GetWorkspaceMember(f.ctx, db.GetWorkspaceMemberParams{WorkspaceID: ws.ID, UserID: f.member.ID}); err != nil || m.Role != "member" {
		t.Fatalf("workspace membership after the switch: %v %+v", err, m)
	}
}
