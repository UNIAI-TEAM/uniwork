package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// requireVerifiedEmail is the backend half of the verify gate: the actions
// that create durable shared state (finishing onboarding, founding an
// organization, inviting people) need a verified address, everything the
// verify screen itself relies on (reading /me, listing workspaces) does not.
func requireVerifiedEmail(ctx context.Context, q *db.Queries, userID string) error {
	u, err := q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !u.EmailVerifiedAt.Valid {
		return ErrEmailUnverified
	}
	return nil
}
