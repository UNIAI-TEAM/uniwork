package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
)

// ageRefreshRotation moves a rotated-out token's rotation past the retry
// grace window, so presenting it again is plain reuse.
func ageRefreshRotation(t *testing.T, svc *DesktopAuthService, rawToken string) {
	t.Helper()
	tag, err := svc.pool.Exec(context.Background(), `UPDATE refresh_tokens SET revoked_at = now() - interval '1 hour' WHERE token_hash = $1 AND revoked_at IS NOT NULL`, hashToken(rawToken))
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("age rotation: %v (%d rows)", err, tag.RowsAffected())
	}
}

func desktopReplayAuditRows(t *testing.T, svc *DesktopAuthService, deviceID string) int {
	t.Helper()
	var n int
	if err := svc.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'replay' = 'retry_grace'`,
		audit.ActionAuthDesktopTokenRotated, deviceID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// R2-5: a refresh whose response was lost leaves the client on the token it
// just rotated out. Its retry inside the grace window gets the same refresh
// token back, and the device stays signed in.
func TestDesktopRefreshRetryWithinGraceIsIdempotent(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-retry@example.com")

	lost, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default")
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	for i := 0; i < 2; i++ {
		retry, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default")
		if err != nil {
			t.Fatalf("retry %d inside grace: %v", i, err)
		}
		if retry.RefreshToken != lost.RefreshToken || retry.AccessToken == "" || retry.DeviceSessionID != sess.DeviceSessionID || retry.SessionID != lost.SessionID {
			t.Fatalf("retry %d did not answer with the same pair: %+v vs %+v", i, retry, lost)
		}
	}
	if err := svc.CheckDeviceSession(ctx, owner, sess.DeviceSessionID); err != nil {
		t.Fatalf("retry revoked the device: %v", err)
	}
	if n := desktopRevokedAuditRows(t, svc, sess.DeviceSessionID); n != 0 {
		t.Fatalf("retry wrote %d revoke audit rows", n)
	}
	if n := desktopReplayAuditRows(t, svc, sess.DeviceSessionID); n != 2 {
		t.Fatalf("retry audit rows = %d, want 2", n)
	}
	// The replayed token is the live one and rotates on as usual.
	next, err := svc.Refresh(ctx, sess.DeviceSessionID, lost.RefreshToken, "default")
	if err != nil || next.RefreshToken == lost.RefreshToken {
		t.Fatalf("refresh after retry: %v", err)
	}
}

// Reuse detection is unchanged outside that one case: a token two rotations
// old, even inside the window, revokes the family.
func TestDesktopRefreshOlderTokenInsideGraceStillRevokes(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-older@example.com")
	second, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default")
	if err != nil {
		t.Fatal(err)
	}
	third, err := svc.Refresh(ctx, sess.DeviceSessionID, second.RefreshToken, "default")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); !errors.Is(err, ErrDesktopRefreshReused) {
		t.Fatalf("grandparent token = %v, want ErrDesktopRefreshReused", err)
	}
	if err := svc.CheckDeviceSession(ctx, owner, sess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("grandparent token did not revoke the family: %v", err)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, third.RefreshToken, "default"); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("live token after reuse = %v, want ErrDesktopDeviceRevoked", err)
	}
	if n := desktopRevokedAuditRows(t, svc, sess.DeviceSessionID); n != 1 {
		t.Fatalf("revoke audit rows = %d, want 1", n)
	}
}

// The immediately previous token after the window is reuse again.
func TestDesktopRefreshPreviousTokenAfterGraceRevokes(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-late@example.com")
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); err != nil {
		t.Fatal(err)
	}
	ageRefreshRotation(t, svc, sess.RefreshToken)
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); !errors.Is(err, ErrDesktopRefreshReused) {
		t.Fatalf("late retry = %v, want ErrDesktopRefreshReused", err)
	}
	if err := svc.CheckDeviceSession(ctx, owner, sess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("late retry did not revoke the family: %v", err)
	}
	if n := desktopReplayAuditRows(t, svc, sess.DeviceSessionID); n != 0 {
		t.Fatalf("late retry was answered as a replay (%d rows)", n)
	}
}

// The grace is bound to the device: another device's just-rotated token,
// presented with this device id, is an unknown token (401, nothing revoked),
// and with the wrong deployment the device answers device_revoked as before.
func TestDesktopRefreshGraceIsBoundToTheDevice(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-bound@example.com")
	otherOwner, other := desktopTestSession(t, svc, authSvc, "desktop-bound-other@example.com")
	if _, err := svc.Refresh(ctx, other.DeviceSessionID, other.RefreshToken, "default"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, other.RefreshToken, "default"); !errors.Is(err, ErrDesktopRefreshReused) {
		t.Fatalf("foreign previous token = %v, want a plain 401", err)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); err != nil {
		t.Fatalf("own refresh after a foreign token: %v", err)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "other-deployment"); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("retry with another deployment = %v, want ErrDesktopDeviceRevoked", err)
	}
	for id, user := range map[string]string{sess.DeviceSessionID: owner, other.DeviceSessionID: otherOwner} {
		if err := svc.CheckDeviceSession(ctx, user, id); err != nil {
			t.Fatalf("device %s revoked: %v", id, err)
		}
	}
}

func TestNextRefreshTokenIsDeterministicPerDeviceAndKey(t *testing.T) {
	svc := &DesktopAuthService{cfg: config.Config{JWTSecret: "secret-a"}}
	a := svc.nextRefreshToken("device-1", "token")
	if a != svc.nextRefreshToken("device-1", "token") || len(a) != 43 {
		t.Fatalf("successor not stable: %q", a)
	}
	if a == svc.nextRefreshToken("device-2", "token") || a == svc.nextRefreshToken("device-1", "token2") {
		t.Fatal("successor ignores the device or the token")
	}
	if a == (&DesktopAuthService{cfg: config.Config{JWTSecret: "secret-b"}}).nextRefreshToken("device-1", "token") {
		t.Fatal("successor ignores the server key")
	}
}
