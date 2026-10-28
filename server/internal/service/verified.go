package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// requireVerifiedEmail is the backend half of the verify gate: the actions
// that create durable shared state (finishing onboarding, founding an
// organization, inviting people) need a verified address, everything the
// verify screen itself relies on (reading /me, listing workspaces) does not.
//
// A reclaim is what verifies an address someone else registered first (ADR
// 0049 §2), so the request's own browser token is judged against the
// account's credentials_revoked_at as well (bearerAfterMark, 401
// invalid_token): the squatter's leftover token must not unlock what the
// owner's proof of the mailbox just did — the invitations sent to it among
// them.
func requireVerifiedEmail(ctx context.Context, q *db.Queries, userID string) error {
	u, err := q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if at, ok := auth.AccessTokenFrom(ctx); ok && at.Web && at.UserID == userID {
		if err := bearerAfterMark(ctx, q, at, u); err != nil {
			return err
		}
	}
	if !u.EmailVerifiedAt.Valid {
		return ErrEmailUnverified
	}
	return nil
}
