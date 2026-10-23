package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A device-scope logout (and the owner's revoke) of the last live device
// session of a family closes the family's refresh token too; while a sibling
// device session is still live the token stays.
func TestDesktopDeviceLogoutClosesFamilyTokenWithLastSession(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-last-session@example.com")
	// Production code never makes a sibling: Exchange starts one family per
	// device (session_family_id = the device id). The sibling is inserted by
	// hand to pin the family rule for when one can exist.
	sibling, err := svc.q.CreateDeviceSession(ctx, db.CreateDeviceSessionParams{
		ID: util.NewID(), UserID: owner, SessionFamilyID: sess.SessionID, ClientID: "uniwork-office",
		DeploymentID: "default", DeviceLabel: "Sibling", Platform: "windows", Build: "1.0",
		RefreshTokenDigest: hashToken("sibling-token"),
		ExpiresAt:          pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedByKind:      "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	liveTokens := func() int {
		t.Helper()
		rows, err := svc.q.ListActiveSessionsForUser(ctx, owner)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, r := range rows {
			if r.SessionID == sess.SessionID {
				n++
			}
		}
		return n
	}

	if err := svc.Logout(ctx, owner, sess.DeviceSessionID, "default", "device"); err != nil {
		t.Fatal(err)
	}
	if n := liveTokens(); n != 1 {
		t.Fatalf("family token with a live sibling = %d live, want 1", n)
	}
	if err := svc.Revoke(ctx, owner, sibling.ID); err != nil {
		t.Fatal(err)
	}
	if n := liveTokens(); n != 0 {
		t.Fatalf("family token after its last device session closed = %d live, want 0", n)
	}
	if _, err := authSvc.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("browser refresh with the family token: %v", err)
	}
}

// desktopTestSibling inserts a second live device session into a family by
// hand (no production path makes one today, see above).
func desktopTestSibling(t *testing.T, svc *DesktopAuthService, owner, familyID string) db.DeviceSession {
	t.Helper()
	sibling, err := svc.q.CreateDeviceSession(context.Background(), db.CreateDeviceSessionParams{
		ID: util.NewID(), UserID: owner, SessionFamilyID: familyID, ClientID: "uniwork-office",
		DeploymentID: "default", DeviceLabel: "Sibling", Platform: "windows", Build: "1.0",
		RefreshTokenDigest: hashToken("sibling-token-" + util.NewID()),
		ExpiresAt:          pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedByKind:      "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return sibling
}

func desktopLiveFamilyTokens(t *testing.T, svc *DesktopAuthService, owner, familyID string) int {
	t.Helper()
	rows, err := svc.q.ListActiveSessionsForUser(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, r := range rows {
		if r.SessionID == familyID {
			n++
		}
	}
	return n
}

func desktopRevokedAuditRows(t *testing.T, svc *DesktopAuthService, deviceID string) int {
	t.Helper()
	var n int
	if err := svc.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionAuthDesktopSessionRevoked, deviceID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// BE-6: two sibling device-scope logouts of one family running at once must
// not both count the other as live. The test plays the first logout by hand
// (row lock, family lock, revoke, uncommitted) and starts the real Logout of
// the other device: it must wait for the family lock, then see the first one
// gone and close the family token.
func TestDesktopSiblingLogoutsSerializeOnTheFamily(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-sibling-race@example.com")
	sibling := desktopTestSibling(t, svc, owner, sess.SessionID)

	tx, err := svc.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := svc.q.WithTx(tx)
	if _, err := q.GetDeviceSessionForUpdate(ctx, sibling.ID); err != nil {
		t.Fatal(err)
	}
	if err := q.LockDeviceSessionFamily(ctx, sess.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := q.RevokeDeviceSession(ctx, db.RevokeDeviceSessionParams{ID: sibling.ID, UserID: owner}); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() { done <- svc.Logout(ctx, owner, sess.DeviceSessionID, "default", "device") }()
	select {
	case err := <-done:
		t.Fatalf("Logout finished (%v) while a sibling logout held the family lock", err)
	case <-time.After(300 * time.Millisecond):
	}

	// The hand-played logout counts the other device as still live, so it
	// keeps the token, as the real code would.
	if closed, err := closeOrphanFamilyTokens(ctx, q, owner, sess.SessionID); err != nil || closed != 0 {
		t.Fatalf("first logout closed %d tokens (%v), want 0 while the sibling is live", closed, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Logout: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Logout did not finish after the family lock was released")
	}
	if n := desktopLiveFamilyTokens(t, svc, owner, sess.SessionID); n != 0 {
		t.Fatalf("family token after both sibling logouts = %d live, want 0", n)
	}
}

// BE-7: a device logged out before the last-session rule existed left its
// family token live. A repeat owner revoke closes it (one audit row) and a
// further repeat writes nothing.
func TestDesktopRepeatRevokeClosesALeftoverFamilyToken(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-leftover@example.com")
	// The pre-fix device-scope logout: device closed, token untouched.
	if _, err := svc.q.RevokeDeviceSession(ctx, db.RevokeDeviceSessionParams{ID: sess.DeviceSessionID, UserID: owner}); err != nil {
		t.Fatal(err)
	}
	if n := desktopLiveFamilyTokens(t, svc, owner, sess.SessionID); n != 1 {
		t.Fatalf("legacy state: %d live family tokens, want 1", n)
	}

	if err := svc.Revoke(ctx, owner, sess.DeviceSessionID); err != nil {
		t.Fatalf("repeat revoke: %v", err)
	}
	if n := desktopLiveFamilyTokens(t, svc, owner, sess.SessionID); n != 0 {
		t.Fatalf("repeat revoke left %d live family tokens, want 0", n)
	}
	if _, err := authSvc.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("browser refresh with the leftover token: %v", err)
	}
	if n := desktopRevokedAuditRows(t, svc, sess.DeviceSessionID); n != 1 {
		t.Fatalf("audit rows after closing the leftover = %d, want 1", n)
	}

	if err := svc.Logout(ctx, owner, sess.DeviceSessionID, "default", "device"); err != nil {
		t.Fatalf("second repeat: %v", err)
	}
	if n := desktopRevokedAuditRows(t, svc, sess.DeviceSessionID); n != 1 {
		t.Fatalf("audit rows after a repeat with nothing to close = %d, want 1", n)
	}

	// A live sibling still keeps the token on a repeat.
	owner2, sess2 := desktopTestSession(t, svc, authSvc, "desktop-leftover-sibling@example.com")
	desktopTestSibling(t, svc, owner2, sess2.SessionID)
	if _, err := svc.q.RevokeDeviceSession(ctx, db.RevokeDeviceSessionParams{ID: sess2.DeviceSessionID, UserID: owner2}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Revoke(ctx, owner2, sess2.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	if n := desktopLiveFamilyTokens(t, svc, owner2, sess2.SessionID); n != 1 {
		t.Fatalf("repeat revoke with a live sibling = %d live family tokens, want 1", n)
	}
}
