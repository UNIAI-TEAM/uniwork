package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Close is the sole owner's way out of an organization nobody else uses
// (ADR 0032, spec §4.5). The organization is archived, not erased: its
// workspaces, their memberships and every business row stay for a later
// restore (D4). The owner's row is deactivated, so they belong nowhere and
// may join or found another organization.
func (s *OrganizationMemberService) Close(ctx context.Context, actorID, orgID, confirmSlug string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := lockMembership(ctx, q, actorID); err != nil {
		return err
	}
	mailboxes, err := s.closeQ(ctx, q, actorID, orgID, confirmSlug)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.emailHub, mailboxes)
	return nil
}

// closeQ is Close's transaction body, for a caller that already holds the
// account's membership lock in q's transaction (the invitation switch reuses
// it). The decision is made under the owner's row lock, the same order Leave
// takes, so a transfer racing the close either lands first and the caller is
// no longer the owner, or waits and finds the organization archived. The
// caller cleans up the returned mailboxes after commit.
func (s *OrganizationMemberService) closeQ(ctx context.Context, q *db.Queries, actorID, orgID, confirmSlug string) ([]db.DisconnectEmailHubAccountsForUserRow, error) {
	m, err := q.LockOrganizationMemberForUpdate(ctx, db.LockOrganizationMemberForUpdateParams{
		OrganizationID: orgID, UserID: actorID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrForbidden
	}
	if err != nil {
		return nil, err
	}
	// The organization row next: an acceptance into it holds the row shared
	// from before it locks the invitation, so the count below either sees
	// that member or the acceptance waits and finds the organization closed.
	org, err := q.LockOrganizationForUpdate(ctx, orgID)
	if err != nil {
		return nil, err
	}
	switch {
	case m.DeactivatedAt.Valid:
		return nil, errMemberDeactivated()
	case m.Role != OrgRoleOwner:
		return nil, ErrForbidden
	case org.Status != OrganizationActive:
		return nil, errOrganizationSuspended()
	case confirmSlug != org.Slug:
		return nil, errCloseConfirmMismatch()
	}
	others, err := q.CountActiveOtherMembers(ctx, db.CountActiveOtherMembersParams{
		OrganizationID: orgID, UserID: actorID,
	})
	if err != nil {
		return nil, err
	}
	if others > 0 {
		return nil, errOrganizationHasMembers()
	}
	closed, err := q.CloseOrganization(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if closed == 0 {
		// Unreachable while the row is locked; kept as the write's own guard.
		return nil, ErrConflict
	}
	if _, err := q.SetOrganizationMemberDeactivated(ctx, db.SetOrganizationMemberDeactivatedParams{
		OrganizationID: orgID, UserID: actorID,
		DeactivatedBy: pgtype.Text{String: actorID, Valid: true},
	}); err != nil {
		return nil, err
	}
	revoked, err := q.RevokePendingInvitationsForOrg(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if err := q.CancelOrganizationSubscriptions(ctx, db.CancelOrganizationSubscriptionsParams{
		OrganizationID: orgID, UpdatedBy: actorID, UpdatedByKind: string(audit.KindHuman),
	}); err != nil {
		return nil, err
	}
	// Like Leave: the owner takes no AI connector access or mailbox with them.
	if err := revokeMcpGrantsForUserInOrg(ctx, q, orgID, actorID); err != nil {
		return nil, err
	}
	mailboxes, err := q.DisconnectEmailHubAccountsForUser(ctx, db.DisconnectEmailHubAccountsForUserParams{
		UserID: actorID, OrganizationID: pgtype.Text{String: orgID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionOrganizationClosed,
		ResourceType:   "organization", ResourceID: orgID,
		Changes:  audit.Diff(map[string]any{"status": OrganizationActive}, map[string]any{"status": "archived"}),
		Metadata: map[string]any{"invitations_revoked": revoked},
	}, audit.Event{Topic: "organization.closed", Payload: map[string]string{
		"organization_id": orgID,
	}}); err != nil {
		return nil, err
	}
	return mailboxes, nil
}
