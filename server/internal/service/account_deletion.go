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
// else the typed email address.
type DeleteAccountInput struct {
	Password          string
	Code              string
	EmailConfirmation string
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
	switch {
	case u.PasswordHash.Valid:
		if !auth.CheckPassword(u.PasswordHash.String, in.Password) {
			return ErrInvalidCredentials
		}
	case u.MfaEnabledAt.Valid:
		if !s.secondFactorMatches(ctx, u, in.Code) {
			return ErrInvalidCredentials
		}
	default:
		// ponytail: a Google-only account without MFA has no secret to ask
		// for; typing the address is the confirmation. Add an emailed code
		// when a product owner asks for it.
		if !strings.EqualFold(strings.TrimSpace(in.EmailConfirmation), u.Email) {
			return ErrInvalidCredentials
		}
	}
	owned, err := s.q.CountOwnedOrganizationsForUser(ctx, userID)
	if err != nil {
		return err
	}
	if owned > 0 {
		return errOwnerMustTransfer()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
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
	if err := qtx.DeactivateAllOrganizationMembershipsForUser(ctx, pgtype.Text{String: userID, Valid: true}); err != nil {
		return err
	}
	if err := qtx.ScrubMemberProfilesForUser(ctx, userID); err != nil {
		return err
	}
	if err := qtx.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return err
	}
	if err := qtx.RevokeAllPushSubscriptionsForUser(ctx, userID); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionUserDeleted, ResourceType: "user", ResourceID: userID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
