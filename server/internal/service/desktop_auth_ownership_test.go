package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newDesktopTestServices(t *testing.T) (*DesktopAuthService, *AuthService) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-test"), TTL: time.Minute}
	authSvc := NewAuthService(pool, q, minter, time.Hour, nil)
	cfg := config.Config{FrontendOrigin: "http://localhost:13380", DesktopAuthClientID: "uniwork-office", DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}, DesktopAuthDeploymentIDs: []string{"default"}, DesktopAuthCodeTTL: 120 * time.Second, DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour}
	return NewDesktopAuthService(pool, q, minter, cfg), authSvc
}

// desktopTestSession registers a fresh user, signs them in through the full
// PKCE flow and returns the user id with the native session it was issued.
func desktopTestSession(t *testing.T, svc *DesktopAuthService, authSvc *AuthService, email string) (string, DesktopSession) {
	t.Helper()
	ctx := context.Background()
	u, err := authSvc.Register(ctx, email, "password123", "Desktop User", "en")
	if err != nil {
		t.Fatal(err)
	}
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	attempt, err := svc.Start(ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: challenge, CodeChallengeMethod: "S256", State: "state-" + email, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default", DeviceLabel: "Laptop", Platform: "windows", Build: "1.0"})
	if err != nil {
		t.Fatal(err)
	}
	consent, err := svc.Consent(ctx, u.User.ID, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := svc.Approve(ctx, u.User.ID, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := svc.Exchange(ctx, "uniwork-office", code, verifier, "uniwork-office://auth/callback", "default")
	if err != nil {
		t.Fatal(err)
	}
	return u.User.ID, sess
}

// Another account's device id must look exactly like a missing one and must
// never be touched.
func TestDesktopRevokeForeignDeviceIsNotFound(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, ownerSess := desktopTestSession(t, svc, authSvc, "desktop-owner@example.com")
	intruder, intruderSess := desktopTestSession(t, svc, authSvc, "desktop-intruder@example.com")

	if err := svc.Revoke(ctx, intruder, ownerSess.DeviceSessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign revoke = %v, want ErrNotFound", err)
	}
	if err := svc.Revoke(ctx, intruder, "01NOSUCHDEVICE0000000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing revoke = %v, want ErrNotFound", err)
	}
	if err := svc.CheckDeviceSession(ctx, owner, ownerSess.DeviceSessionID); err != nil {
		t.Fatalf("foreign revoke touched the owner's device: %v", err)
	}
	if _, err := svc.Refresh(ctx, ownerSess.DeviceSessionID, ownerSess.RefreshToken, "default"); err != nil {
		t.Fatalf("owner refresh after foreign revoke: %v", err)
	}

	// The caller's own device still revokes, and a repeat stays idempotent.
	if err := svc.Revoke(ctx, intruder, intruderSess.DeviceSessionID); err != nil {
		t.Fatalf("own revoke: %v", err)
	}
	if err := svc.Revoke(ctx, intruder, intruderSess.DeviceSessionID); err != nil {
		t.Fatalf("repeated own revoke: %v", err)
	}
	if err := svc.CheckDeviceSession(ctx, intruder, intruderSess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("own revoke did not revoke: %v", err)
	}
}

// A refresh token this device's family never issued is a plain 401: knowing
// a device id must not be enough to log its owner out. A rotated-out token of
// the family presented again still revokes the whole family.
func TestDesktopRefreshUnknownTokenDoesNotRevokeFamily(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-victim@example.com")
	_, other := desktopTestSession(t, svc, authSvc, "desktop-other@example.com")

	for _, tc := range []struct{ name, token string }{
		{"garbage", "not-a-token-this-family-ever-issued"},
		{"other family token", other.RefreshToken},
	} {
		_, err := svc.Refresh(ctx, sess.DeviceSessionID, tc.token, "default")
		var ce CodedError
		if !errors.As(err, &ce) || ce.Status != http.StatusUnauthorized {
			t.Fatalf("%s: refresh = %v, want a 401 coded error", tc.name, err)
		}
		if err := svc.CheckDeviceSession(ctx, owner, sess.DeviceSessionID); err != nil {
			t.Fatalf("%s: unknown token revoked the device: %v", tc.name, err)
		}
	}
	if n := desktopRevokedAuditRows(t, svc, sess.DeviceSessionID); n != 0 {
		t.Fatalf("unknown tokens wrote %d revoke audit rows, want 0", n)
	}
	// The other account's session is untouched as well.
	if _, err := svc.Refresh(ctx, other.DeviceSessionID, other.RefreshToken, "default"); err != nil {
		t.Fatalf("other account refresh: %v", err)
	}

	rotated, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default")
	if err != nil {
		t.Fatalf("real token after unknown attempts: %v", err)
	}

	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); !errors.Is(err, ErrDesktopRefreshReused) {
		t.Fatalf("reused token = %v, want ErrDesktopRefreshReused", err)
	}
	if err := svc.CheckDeviceSession(ctx, owner, sess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("reuse did not revoke the family: %v", err)
	}
	var reason string
	if err := svc.pool.QueryRow(ctx, `SELECT coalesce(string_agg(metadata::jsonb->>'reason', ','), '') FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionAuthDesktopSessionRevoked, sess.DeviceSessionID).Scan(&reason); err != nil {
		t.Fatal(err)
	}
	if reason != "refresh_reuse" {
		t.Fatalf("reuse audit reasons = %q, want one refresh_reuse row", reason)
	}
	if _, err := svc.Refresh(ctx, sess.DeviceSessionID, rotated.RefreshToken, "default"); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("successor token after reuse = %v, want ErrDesktopDeviceRevoked", err)
	}
}
