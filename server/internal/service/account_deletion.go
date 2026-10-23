package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DeleteAccountInput is the re-authentication for erasure (spec F-01 §2 I9):
// the password when the account has one, else a TOTP code when MFA is on,
// else the typed email address. CloseOrganization is the slug of the
// organization the account owns alone, typed again: that organization is
// closed (archived, as OrganizationMemberService.Close does) in the same
// transaction as the erasure.
type DeleteAccountInput struct {
	Password          string
	Code              string
	EmailConfirmation string
	CloseOrganization string
}

const deletedDisplayName = "Người dùng đã xóa"

// DeleteAccount anonymises the user (Nghị định 13) and closes every door:
// memberships deactivated, profiles scrubbed, sessions and push revoked.
// Content they authored stays under the anonymised row; audit_events stay
// untouched (ADR 0012).
func (s *AuthService) DeleteAccount(ctx context.Context, userID string, in DeleteAccountInput) error {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return err
	}
	// The caller is signed in, so a wrong proof is never 401 (see
	// ErrPasswordIncorrect): each one answers its own code.
	switch {
	case u.PasswordHash.Valid:
		if !auth.CheckPassword(u.PasswordHash.String, in.Password) {
			return errPasswordIncorrect()
		}
	case u.MfaEnabledAt.Valid:
		if !s.secondFactorMatches(ctx, u, in.Code) {
			return errMfaCodeIncorrect()
		}
	default:
		// ponytail: a Google-only account without MFA has no secret to ask
		// for; typing the address is the confirmation. Add an emailed code
		// when a product owner asks for it.
		if !strings.EqualFold(strings.TrimSpace(in.EmailConfirmation), u.Email) {
			return errEmailConfirmationMismatch()
		}
	}
	owned, err := s.q.CountOwnedOrganizationsForUser(ctx, userID)
	if err != nil {
		return err
	}
	closeSlug := strings.TrimSpace(in.CloseOrganization)
	if owned > 0 && closeSlug == "" {
		return s.ownerMustTransfer(ctx, s.q, userID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	var closedMailboxes []db.DisconnectEmailHubAccountsForUserRow
	if owned > 0 {
		if closedMailboxes, err = closeSoleOrganization(ctx, qtx, userID, closeSlug); err != nil {
			return err
		}
		// Anything still owned (a second organization from before ADR 0032,
		// or one that gained a member meanwhile) keeps the old answer.
		if still, err := qtx.CountOwnedOrganizationsForUser(ctx, userID); err != nil {
			return err
		} else if still > 0 {
			return s.ownerMustTransfer(ctx, qtx, userID)
		}
	}
	if s.files != nil {
		// FS-C1 §5.4: the release locks the files row before this transaction
		// locks the user row, so avatar_file_id is read non-locking, released,
		// then re-read FOR UPDATE — an avatar swap landing in between aborts
		// the deletion instead of releasing the wrong file.
		prev, err := qtx.GetUserAvatarFileID(ctx, userID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if prev.Valid && prev.String != "" {
			if err := releaseFilesInTx(ctx, s.files, qtx, []files.FileID{files.FileID(prev.String)}); err != nil {
				return err
			}
		}
		cur, err := qtx.GetUserAvatarFileIDForUpdate(ctx, userID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if cur.String != prev.String || cur.Valid != prev.Valid {
			return ErrConflict
		}
	}
	if _, err := qtx.AnonymizeUser(ctx, db.AnonymizeUserParams{
		ID: userID, Email: "deleted-" + strings.ToLower(userID) + "@deleted.uniwork.invalid", DisplayName: deletedDisplayName,
	}); err != nil {
		return err
	}
	// Read before the update: these are the organizations whose membership
	// this deletion switches off, and each one records it as Deactivate does.
	// Archived organizations included: their audit trail and Work Graph
	// still carry the name this erasure removes.
	memberships, err := qtx.ListOrganizationMembershipsForUser(ctx, userID)
	if err != nil {
		return err
	}
	if err := qtx.DeactivateAllOrganizationMembershipsForUser(ctx, pgtype.Text{String: userID, Valid: true}); err != nil {
		return err
	}
	if err := qtx.ScrubMemberProfilesForUser(ctx, userID); err != nil {
		return err
	}
	leases, err := revokeAllUserSessions(ctx, qtx, userID)
	if err != nil {
		return err
	}
	if _, err := revokeAllMcpGrantsForUser(ctx, qtx, userID); err != nil {
		return err
	}
	if err := qtx.RevokeAllPushSubscriptionsForUser(ctx, userID); err != nil {
		return err
	}
	mailboxes, err := qtx.DisconnectEmailHubAccountsForUser(ctx, db.DisconnectEmailHubAccountsForUserParams{UserID: userID})
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionUserDeleted, ResourceType: "user", ResourceID: userID,
	}); err != nil {
		return err
	}
	// user.deleted sits on the credential sentinel, which no organization
	// reads. Each organization gets its own row and event: an active
	// membership the member.deactivated an admin's Deactivate writes, one an
	// admin already switched off a profile.updated. Either event makes the
	// Work Graph marker re-read the ACTOR node, so the real name does not
	// outlive the erasure in graph_nodes.title.
	for _, m := range memberships {
		if m.DeactivatedAt.Valid {
			// An admin switched this membership off earlier; a second
			// member.deactivated would claim a transition that did not
			// happen. The profile scrub and the anonymised name still change
			// what this organization shows, so it records profile.updated,
			// which the marker also maps to the ACTOR node. No Changes: the
			// old values are what the erasure removes.
			if err := auditRecorder.Record(ctx, qtx, audit.Entry{
				OrganizationID: m.OrganizationID,
				Actor:          audit.User(userID),
				Action:         audit.ActionProfileUpdated,
				ResourceType:   "organization_member_profile", ResourceID: userID,
				Metadata: map[string]any{"reason": "account_deleted"},
			}, audit.Event{Topic: "profile.updated", Payload: map[string]string{
				"organization_id": m.OrganizationID, "user_id": userID,
			}}); err != nil {
				return err
			}
			continue
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: m.OrganizationID,
			Actor:          audit.User(userID),
			Action:         audit.ActionMemberDeactivated,
			ResourceType:   "organization_member", ResourceID: userID,
			Changes:  audit.Diff(map[string]any{"status": MemberStatusActive}, map[string]any{"status": MemberStatusDeactivated}),
			Metadata: map[string]any{"sessions_revoked": true, "reason": "account_deleted"},
		}, audit.Event{Topic: "member.deactivated", Payload: map[string]string{
			"organization_id": m.OrganizationID, "user_id": userID,
		}}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, leases)
	cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.emailHub, append(closedMailboxes, mailboxes...))
	// u was read before AnonymizeUser cleared the Apple columns.
	s.apple.revokeAfterCommit(ctx, userID, u.AppleClientID.String, u.AppleRefreshTokenEnc.String)
	return nil
}

// closeSoleOrganization closes the organization whose slug the owner typed,
// under the account's membership lock (ADR 0032), with closeOrganizationQ's
// checks: the caller owns it, it is active, nobody else is an active member,
// the slug matches. Its organization.closed row says the account deletion
// closed it. A slug naming no organization the account owns is a mismatch.
func closeSoleOrganization(ctx context.Context, q *db.Queries, userID, slug string) ([]db.DisconnectEmailHubAccountsForUserRow, error) {
	if err := lockMembership(ctx, q, userID); err != nil {
		return nil, err
	}
	orgs, err := activeOrganizations(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	for _, o := range orgs {
		if o.Role == OrgRoleOwner && o.Slug == slug {
			return closeOrganizationQ(ctx, q, userID, o.ID, slug, map[string]any{"reason": "account_deleted"})
		}
	}
	return nil, errCloseConfirmMismatch()
}

// ownerMustTransfer is owner_must_transfer naming the first organization the
// account owns (errOwnerMustTransferFor).
func (s *AuthService) ownerMustTransfer(ctx context.Context, q *db.Queries, userID string) error {
	orgs, err := activeOrganizations(ctx, q, userID)
	if err != nil {
		return err
	}
	for _, o := range orgs {
		if o.Role == OrgRoleOwner {
			return errOwnerMustTransferFor(o)
		}
	}
	return errOwnerMustTransfer()
}

// errOwnerMustTransferFor names the organization the account owns, so the
// client can offer the way out that fits it (Apple 5.1.1(v): deletion
// completes in the app): can_close when the owner is its only active member
// and it is active, so closing it and erasing the account is one request
// (DeleteAccountInput.CloseOrganization); otherwise ownership goes to
// another member first. The name and slug are the caller's own organization.
func errOwnerMustTransferFor(org db.ListActiveOrganizationsForUserRow) error {
	e := errOwnerMustTransfer().(CodedError)
	e.Fields = map[string]any{
		"organization_name": org.Name,
		"organization_slug": org.Slug,
		"can_close":         org.Status == OrganizationActive && org.OtherActiveMembers == 0,
	}
	return e
}
