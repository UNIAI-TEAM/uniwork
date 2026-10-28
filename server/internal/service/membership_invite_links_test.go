package service

import (
	"context"
	"errors"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestWorkspaceInviteLinkCreatePreviewJoin(t *testing.T) {
	SetMembershipInviteKey([]byte("test-membership-invite-hmac-key"))
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}

	link, err := f.ws.CreateWorkspaceInviteLink(ctx, f.ua.ID, w.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if link.Status != "active" || link.Secret == "" || link.Link.ID == "" {
		t.Fatalf("expected active link with secret, got %+v", link)
	}

	listed, err := f.ws.ListWorkspaceInviteLinks(ctx, f.ua.ID, w.ID)
	if err != nil || len(listed) == 0 || listed[0].Secret == "" {
		t.Fatalf("list should re-derive secret: %v %+v", err, listed)
	}

	preview, err := f.ws.PreviewMembershipInviteLink(ctx, f.ub.ID, link.Link.ID, link.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.NeedsJoin || preview.AlreadyMember || preview.Status != "active" {
		t.Fatalf("outsider should need join: %+v", preview)
	}

	joined, err := f.ws.JoinMembershipInviteLink(ctx, f.ub.ID, link.Link.ID, link.Secret, nil)
	if err != nil {
		t.Fatal(err)
	}
	if joined.AlreadyAll || len(joined.JoinedIDs) != 1 || joined.JoinedIDs[0] != w.ID {
		t.Fatalf("expected one joined workspace: %+v", joined)
	}
	if _, err := f.ws.RequireMember(ctx, w.ID, f.ub.ID); err != nil {
		t.Fatal(err)
	}

	again, err := f.ws.JoinMembershipInviteLink(ctx, f.ub.ID, link.Link.ID, link.Secret, nil)
	if err != nil || !again.AlreadyAll {
		t.Fatalf("member should redirect without re-join: %v %+v", err, again)
	}

	if _, err := f.ws.RevokeWorkspaceInviteLink(ctx, f.ua.ID, w.ID, link.Link.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.JoinMembershipInviteLink(ctx, f.uc.ID, link.Link.ID, link.Secret, nil); !codedIs(err, "invite_link_revoked") {
		t.Fatalf("revoked link must refuse new joins: %v", err)
	}
}

func TestOrganizationInviteLinkMultiWorkspace(t *testing.T) {
	SetMembershipInviteKey([]byte("test-membership-invite-hmac-key"))
	f := newOrgInviteFixture(t)
	w1, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, "Một", "ws-mot")
	if err != nil {
		t.Fatal(err)
	}
	w2, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, "Hai", "ws-hai")
	if err != nil {
		t.Fatal(err)
	}
	ttl := 3 * 24 * time.Hour
	link, err := f.svc.CreateOrganizationInviteLink(f.ctx, f.owner.ID, f.org.ID, []string{w1.ID, w2.ID}, &ttl)
	if err != nil {
		t.Fatal(err)
	}
	if len(link.Workspaces) != 2 || link.Secret == "" {
		t.Fatalf("expected two workspaces and secret: %+v", link)
	}

	preview, err := f.ws.PreviewMembershipInviteLink(f.ctx, f.invitee.ID, link.Link.ID, link.Secret)
	if err != nil || !preview.NeedsJoin || len(preview.Workspaces) != 2 {
		t.Fatalf("preview: %v %+v", err, preview)
	}
	joined, err := f.ws.JoinMembershipInviteLink(f.ctx, f.invitee.ID, link.Link.ID, link.Secret, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(joined.JoinedIDs) != 2 {
		t.Fatalf("expected both workspaces joined: %+v", joined)
	}
}

func TestMembershipInviteLinkPreviewReportsSwitchConflicts(t *testing.T) {
	SetMembershipInviteKey([]byte("test-membership-invite-hmac-key"))
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	link, err := f.ws.CreateWorkspaceInviteLink(ctx, f.ua.ID, w.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	// ub already owns another organization (created below), so joining Alpha needs a switch.
	if _, err := f.orgs.Create(ctx, f.ub.ID, "Org B", "org-b-invite-link"); err != nil {
		t.Fatal(err)
	}
	preview, err := f.ws.PreviewMembershipInviteLink(ctx, f.ub.ID, link.Link.ID, link.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.NeedsJoin || len(preview.Conflicts) == 0 {
		t.Fatalf("expected switch conflicts for a person already in another org: %+v", preview)
	}
	if _, err := f.ws.JoinMembershipInviteLink(ctx, f.ub.ID, link.Link.ID, link.Secret, nil); !codedIs(err, "organization_switch_required") {
		t.Fatalf("join without resolve must require a switch: %v", err)
	}
}

func TestWorkspaceInviteLinkRejectsNonAdmin(t *testing.T) {
	SetMembershipInviteKey([]byte("test-membership-invite-hmac-key"))
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: f.ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, OrganizationID: f.org.ID, UserID: f.ub.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.CreateWorkspaceInviteLink(ctx, f.ub.ID, w.ID, nil); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member must be refused: %v", err)
	}
}
