package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ListSessions returns the live sessions of one user, newest activity first.
func (s *AuthService) ListSessions(ctx context.Context, userID string) ([]db.ListActiveSessionsForUserRow, error) {
	return s.q.ListActiveSessionsForUser(ctx, userID)
}

// RevokeSession ends one session of the caller. ErrNotFound when the id is
// not theirs or already gone — a foreign id must look the same as a stale one.
func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID string) error {
	n, err := s.q.RevokeSessionForUser(ctx, db.RevokeSessionForUserParams{UserID: userID, SessionID: sessionID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.recordAuth(ctx, audit.ActionAuthSessionRevoked, userID, map[string]any{"scope": "one", "session_id": sessionID},
		sessionRevoked(userID, sessionID))
	return nil
}

// sessionRevoked tells the realtime access revoker to close the sockets of
// one session, or every one of userID's when sessionID is "".
func sessionRevoked(userID, sessionID string) audit.Event {
	return audit.Event{Topic: "session.revoked", Payload: map[string]string{"user_id": userID, "session_id": sessionID}}
}

// RevokeOtherSessions keeps only the caller's current session alive: every
// other browser session and every device session outside the caller's
// family (the phone and desktop apps, with their pushes and offline leases),
// through revokeOtherUserSessions. It answers how many sessions it ended.
func (s *AuthService) RevokeOtherSessions(ctx context.Context, userID, currentSessionID string) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	tokens, devices, leases, err := revokeOtherUserSessions(ctx, q, userID, currentSessionID)
	if err != nil {
		return 0, err
	}
	if tokens > 0 || devices > 0 {
		// The ended sessions are not named here, so every socket closes; the
		// caller's own reconnects once it has refreshed.
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
			Action: audit.ActionAuthSessionRevoked, ResourceType: "user", ResourceID: userID,
			Metadata: map[string]any{"scope": "others", "count": tokens, "device_sessions": devices},
		}, sessionRevoked(userID, "")); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, leases)
	return tokens, nil
}
