package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ErrCredentialsRevoked: the bearer is a browser access token issued before
// the account's credentials last changed (a reclaim today; a password change
// or an unlink with the sign-in methods). It still reads, until it expires,
// but no sensitive command takes it.
var ErrCredentialsRevoked = errors.New("credentials_revoked")

// errCredentialsRevoked is 401 invalid_token: the client refreshes, which
// only the session the change kept can do, and its newer token passes.
func errCredentialsRevoked() error {
	return CodedError{
		Code: "invalid_token", Status: http.StatusUnauthorized,
		Msg: "this session started before the account's sign-in changed; sign in again", Err: ErrCredentialsRevoked,
	}
}

// requireCurrentCredentials is the gate of the sensitive commands (ADR 0047
// §5, spec §3.7: desktop and MCP consent today; step-up and the sign-in
// method commands with them): a browser access token issued before its
// account's credentials_revoked_at is refused. The mark and a token's iat
// are both whole seconds, so a token is refused only when strictly older:
// the session the same command hands out passes. It judges the bearer's own
// account, the one whose credentials the mark is about.
//
// A native device token is not judged here: a revoke ends its device
// session, which the auth middleware checks on every request. Without a
// token on the context (a job, a test calling the service) there is nothing
// to judge; the auth middleware puts one on every bearer request.
func requireCurrentCredentials(ctx context.Context, q *db.Queries) error {
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok || !at.Web {
		return nil
	}
	u, err := q.GetUserByID(ctx, at.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if u.CredentialsRevokedAt.Valid && at.IssuedAt.Before(u.CredentialsRevokedAt.Time) {
		return errCredentialsRevoked()
	}
	return nil
}
