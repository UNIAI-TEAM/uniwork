package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDesktopAuthPKCEConsentExchangeAndReplay(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-test"), TTL: time.Minute}
	authSvc := NewAuthService(pool, q, minter, time.Hour, nil)
	u, err := authSvc.Register(context.Background(), "desktop@example.com", "password123", "Desktop User", "en")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{FrontendOrigin: "http://localhost:13380", DesktopAuthClientID: "uniwork-office", DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}, DesktopAuthDeploymentIDs: []string{"default"}, DesktopAuthCodeTTL: 120 * time.Second, DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour}
	svc := NewDesktopAuthService(pool, q, minter, cfg)
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	attempt, err := svc.Start(context.Background(), DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: challenge, CodeChallengeMethod: "S256", State: "state-1", RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default", DeviceLabel: "Laptop", Platform: "windows", Build: "1.0"})
	if err != nil {
		t.Fatal(err)
	}
	consent, err := svc.Consent(context.Background(), u.User.ID, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Approve(context.Background(), u.User.ID, attempt.ID, "wrong-csrf"); !errors.Is(err, ErrDesktopCSRF) {
		t.Fatalf("wrong csrf: %v", err)
	}
	_, _, err = svc.Approve(context.Background(), u.User.ID, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := svc.Exchange(context.Background(), "uniwork-office", "bad-code", verifier, "uniwork-office://auth/callback", "default")
	if !errors.Is(err, ErrDesktopAuthCodeInvalid) {
		t.Fatalf("bad code: %v", err)
	}
	// The failed exchange did not consume the approved code; approve a second
	// attempt to exercise successful redemption and replay protection.
	attempt2, err := svc.Start(context.Background(), DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: challenge, CodeChallengeMethod: "S256", State: "state-2", RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	consent2, err := svc.Consent(context.Background(), u.User.ID, attempt2.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := svc.Approve(context.Background(), u.User.ID, attempt2.ID, consent2.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	sess, err = svc.Exchange(context.Background(), "uniwork-office", code, verifier, "uniwork-office://auth/callback", "default")
	if err != nil {
		t.Fatal(err)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" || sess.DeviceSessionID == "" {
		t.Fatal("exchange returned incomplete session")
	}
	if _, err := svc.Exchange(context.Background(), "uniwork-office", code, verifier, "uniwork-office://auth/callback", "default"); !errors.Is(err, ErrDesktopAuthCodeInvalid) {
		t.Fatalf("replay: %v", err)
	}
	if err := svc.CheckDeviceSession(context.Background(), u.User.ID, sess.DeviceSessionID); err != nil {
		t.Fatalf("live device: %v", err)
	}
	rotated, err := svc.Refresh(context.Background(), sess.DeviceSessionID, sess.RefreshToken, "default")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if rotated.RefreshToken == sess.RefreshToken || rotated.RefreshToken == "" {
		t.Fatal("refresh did not rotate the refresh token")
	}
	if _, err := svc.Refresh(context.Background(), sess.DeviceSessionID, sess.RefreshToken, "default"); !errors.Is(err, ErrDesktopRefreshReused) {
		t.Fatalf("refresh reuse: %v", err)
	}
	if err := svc.CheckDeviceSession(context.Background(), u.User.ID, sess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("refresh reuse did not revoke family: %v", err)
	}
	// Revoke remains idempotent after reuse detection.
	if err := svc.Revoke(context.Background(), u.User.ID, sess.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	if err := svc.CheckDeviceSession(context.Background(), u.User.ID, sess.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("revoked device check: %v", err)
	}
}
