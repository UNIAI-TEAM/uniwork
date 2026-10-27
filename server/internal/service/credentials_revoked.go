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
// the account's credentials last changed (a reclaim, a password change, an
// unlink), or its session has ended. It still reads, until it expires, but no
// sensitive command takes it.
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
// §5, spec §3.7: step-up and every command that takes its token, the
// sign-in method commands, desktop and MCP consent): a browser access token
// issued before its account's credentials_revoked_at is refused
// (bearerAfterMark). It judges the bearer's own account, the one whose
// credentials the mark is about.
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
	return bearerAfterMark(ctx, q, at, u)
}

// bearerAfterMark judges the browser bearer at against u, its account's row:
// a token issued before u's credentials_revoked_at is refused. The mark and
// a token's iat are both whole seconds, so a token of the mark's own second
// is either the session the change itself handed out or one the change
// ended; only the session tells them apart, so it must still be live
// (liveBearerSession). A token issued after the mark passes unread.
func bearerAfterMark(ctx context.Context, q *db.Queries, at auth.AccessToken, u db.User) error {
	if !u.CredentialsRevokedAt.Valid || at.IssuedAt.After(u.CredentialsRevokedAt.Time) {
		return nil
	}
	if at.IssuedAt.Before(u.CredentialsRevokedAt.Time) {
		return errCredentialsRevoked()
	}
	_, err := liveBearerSession(ctx, q, at)
	return err
}

// requireLiveBearer is requireCurrentCredentials for a command that hands
// out a session of its own — desktop and MCP consent: the bearer's session
// must also still be live (liveBearerSession, 401 invalid_token), so the
// last minutes of an access token whose session was signed out or revoked
// (sign out other sessions, a password change or reset, a reclaim) cannot
// buy a device session or a grant that outlives it. Without a token on the
// context there is nothing to judge, nor in a token that names no session:
// nothing mints one any more (every sign-in names its session), and the
// bearer middleware lets the shape through as it always has.
func requireLiveBearer(ctx context.Context, q *db.Queries) error {
	if err := requireCurrentCredentials(ctx, q); err != nil {
		return err
	}
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok || at.SessionID == "" {
		return nil
	}
	_, err := liveBearerSession(ctx, q, at)
	return err
}
