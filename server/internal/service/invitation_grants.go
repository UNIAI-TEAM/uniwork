package service

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The workspaces an organization invitation grants (UNI-1582). An invitation
// sent from a workspace keeps its single invitations.workspace_id; one sent to
// the organization itself lists zero or more workspaces in
// invitation_workspaces, and accepting it makes the person a plain member of
// each one that still exists. Organization membership on its own opens no
// workspace: these rows are the only grant that rides on the invitation.

// grantedWorkspaceRole is the role an invitation grants in each workspace:
// a plain member; an admin promotes them afterwards if needed.
const grantedWorkspaceRole = "member"

func errWorkspaceNotInOrganization() error {
	return coded(http.StatusBadRequest, "workspace_not_in_organization", "workspace không thuộc tổ chức này")
}

// grantableWorkspaces checks the ids an admin chose against the organization's
// own workspaces and returns them oldest first, without duplicates. An id that
// is not one of them - another tenant's, or none at all - refuses the whole
// request with the same answer, so it reveals nothing about that id.
func grantableWorkspaces(ctx context.Context, q *db.Queries, orgID string, ids []string) ([]WorkspaceRef, error) {
	wanted := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && !slices.Contains(wanted, id) {
			wanted = append(wanted, id)
		}
	}
	if len(wanted) == 0 {
		return []WorkspaceRef{}, nil
	}
	if len(wanted) > maxInviteWorkspaces {
		return nil, Invalid("tối đa 100 workspace mỗi lời mời")
	}
	rows, err := q.ListWorkspacesInOrgByIDs(ctx, db.ListWorkspacesInOrgByIDsParams{OrganizationID: orgID, Ids: wanted})
	if err != nil {
		return nil, err
	}
	if len(rows) != len(wanted) {
		return nil, errWorkspaceNotInOrganization()
	}
	out := make([]WorkspaceRef, 0, len(rows))
	for _, r := range rows {
		out = append(out, WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}

func refIDList(refs []WorkspaceRef) []string {
	out := make([]string, 0, len(refs))
	for _, r := range refs {
		out = append(out, r.ID)
	}
	return out
}

// invitationGrants reads the workspaces each invitation grants, keyed by
// invitation id, oldest workspace first. A workspace that no longer exists is
// not listed.
func invitationGrants(ctx context.Context, q *db.Queries, invitationIDs, orgIDs []string) (map[string][]WorkspaceRef, error) {
	out := map[string][]WorkspaceRef{}
	if len(invitationIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListInvitationWorkspaces(ctx, db.ListInvitationWorkspacesParams{
		InvitationIds: invitationIDs, OrganizationIds: orgIDs,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.InvitationID] = append(out[r.InvitationID], WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}

// grantedWorkspaces is what one invitation leads into: its own workspace when
// it was sent from one, otherwise the workspaces the admin picked.
func grantedWorkspaces(ctx context.Context, q *db.Queries, invitationID, orgID string, own *WorkspaceRef) ([]WorkspaceRef, error) {
	if own != nil {
		return []WorkspaceRef{*own}, nil
	}
	byInvitation, err := invitationGrants(ctx, q, []string{invitationID}, []string{orgID})
	if err != nil {
		return nil, err
	}
	if refs := byInvitation[invitationID]; refs != nil {
		return refs, nil
	}
	return []WorkspaceRef{}, nil
}

// regrantInvitation gives a pending invitation the latest workspace choice.
// An unchanged choice writes nothing; a changed one is a change to what the
// invitation grants, so it is audited like the invitation itself.
func regrantInvitation(ctx context.Context, q *db.Queries, actorID string, inv db.Invitation, ids []string) error {
	current, err := grantedWorkspaces(ctx, q, inv.ID, inv.OrganizationID, nil)
	if err != nil {
		return err
	}
	before := refIDList(current)
	after := slices.Clone(ids)
	slices.Sort(before)
	slices.Sort(after)
	if slices.Equal(before, after) {
		return nil
	}
	if err := q.DeleteInvitationWorkspaces(ctx, db.DeleteInvitationWorkspacesParams{
		InvitationID: inv.ID, OrganizationID: inv.OrganizationID,
	}); err != nil {
		return err
	}
	for _, id := range ids {
		if err := q.AddInvitationWorkspace(ctx, db.AddInvitationWorkspaceParams{
			InvitationID: inv.ID, WorkspaceID: id, OrganizationID: inv.OrganizationID,
		}); err != nil {
			return err
		}
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: inv.OrganizationID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMemberInvited,
		ResourceType:   "invitation", ResourceID: inv.ID,
		Changes:  audit.Diff(map[string]any{"workspace_ids": before}, map[string]any{"workspace_ids": after}),
		Metadata: map[string]any{"reinvited": true},
	}, audit.Event{Topic: "member.invited", Payload: map[string]string{
		"organization_id": inv.OrganizationID, "invitation_id": inv.ID,
	}})
}

// grantInvitationWorkspaces makes the person a plain member of every
// workspace an organization invitation grants, inside the accept's
// transaction, each with its default channel and its own audit row. A
// workspace deleted since the invitation was sent is not listed, so it is
// skipped rather than failing the accept. An existing membership keeps its
// role (AddWorkspaceMember does nothing on conflict).
func grantInvitationWorkspaces(ctx context.Context, q *db.Queries, userID, invitationID, orgID string) ([]string, error) {
	refs, err := grantedWorkspaces(ctx, q, invitationID, orgID, nil)
	if err != nil {
		return nil, err
	}
	joined := make([]string, 0, len(refs))
	for _, w := range refs {
		if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
			WorkspaceID: w.ID, OrganizationID: orgID, UserID: userID, Role: grantedWorkspaceRole,
		}); err != nil {
			return nil, err
		}
		if err := syncDefaultChatRoomMembers(ctx, q, w.ID); err != nil {
			return nil, err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, WorkspaceID: w.ID,
			Actor:        audit.User(userID),
			Action:       audit.ActionMemberJoined,
			ResourceType: "workspace_member", ResourceID: userID,
			Changes:  audit.Diff(nil, map[string]any{"role": grantedWorkspaceRole}),
			Metadata: map[string]any{"invitation_id": invitationID},
		}, audit.Event{Topic: "member.joined", Payload: map[string]string{
			"organization_id": orgID, "workspace_id": w.ID, "user_id": userID,
		}}); err != nil {
			return nil, err
		}
		joined = append(joined, w.ID)
	}
	return joined, nil
}
