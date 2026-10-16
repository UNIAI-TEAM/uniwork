package service

import (
	"context"
	"errors"
	"time"
)

// WorkspaceRef names the workspace an invitation leads into.
type WorkspaceRef struct {
	ID   string
	Name string
	Slug string
}

// InvitationPreview is what the invitation page shows before anything is
// accepted (spec §4.3): the invitation in whatever state it is, and - only
// while it is pending - what each of the person's organizations needs before
// they can join. It changes nothing.
type InvitationPreview struct {
	ID           string
	Status       string
	ExpiresAt    time.Time
	Organization OrganizationRef
	Workspace    *WorkspaceRef
	// Workspaces is every workspace accepting grants (UNI-1582): the
	// invitation's own, or the ones the admin chose; empty when none.
	Workspaces  []WorkspaceRef
	OrgRole     string
	InviterName string
	Conflicts   []MembershipConflict
}

// PreviewInvitation reads an invitation for the account it was sent to, with
// the same verified-mailbox checks as accepting it. The conflicts are the
// ones AcceptInvite will compute again under its locks; a gate that would
// refuse the accept itself (a deactivated row in the organization) shows no
// conflicts here and answers on accept. A pending invitation into an
// organization that admits nobody new (suspended, or being deleted) answers
// that refusal, so nobody walks through a switch the accept would refuse.
func (s *WorkspaceService) PreviewInvitation(ctx context.Context, userID, token string) (InvitationPreview, error) {
	inv, err := s.invitationFor(ctx, userID, token)
	if err != nil {
		return InvitationPreview{}, err
	}
	p := InvitationPreview{
		ID:           inv.ID,
		Status:       invitationStatus(inv.AcceptedAt, inv.RevokedAt, inv.ExpiresAt),
		ExpiresAt:    inv.ExpiresAt.Time,
		Organization: OrganizationRef{ID: inv.OrganizationID, Name: inv.OrganizationName, Slug: inv.OrganizationSlug},
		OrgRole:      orgRoleOrMember(inv.OrgRole),
		InviterName:  inv.InvitedByName.String,
		Conflicts:    []MembershipConflict{},
	}
	if inv.WorkspaceID.Valid && inv.WorkspaceSlug.Valid {
		p.Workspace = &WorkspaceRef{ID: inv.WorkspaceID.String, Name: inv.WorkspaceName.String, Slug: inv.WorkspaceSlug.String}
	}
	if p.Workspaces, err = grantedWorkspaces(ctx, s.q, inv.ID, inv.OrganizationID, p.Workspace); err != nil {
		return InvitationPreview{}, err
	}
	if p.Status != InvitationPending {
		return p, nil
	}
	org, err := s.q.GetOrganizationByID(ctx, inv.OrganizationID)
	if err != nil {
		return InvitationPreview{}, err
	}
	if err := admitsNewMembers(org); err != nil {
		return InvitationPreview{}, err
	}
	_, conflicts, err := s.joinConflicts(ctx, s.q, inv.OrganizationID, userID)
	switch {
	case err == nil:
		p.Conflicts = conflicts
	case errors.Is(err, ErrMemberDeactivated), errors.Is(err, ErrOrganizationSuspended), errors.Is(err, ErrOrganizationDeletionScheduled):
	default:
		return InvitationPreview{}, err
	}
	return p, nil
}
