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

const (
	stableClient   = "uniwork-office"
	stableRedirect = "uniwork-office://auth/callback"
	devClient      = "uniwork-office-dev"
	devRedirect    = "uniwork-office-dev://auth/callback"
	clientVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
)

func twoClientConfig() config.Config {
	return config.Config{
		FrontendOrigin: "http://localhost:13380",
		DesktopAuthClients: []config.DesktopAuthClient{
			{ID: stableClient, RedirectURIs: []string{stableRedirect}},
			{ID: devClient, RedirectURIs: []string{devRedirect}},
		},
		DesktopAuthDeploymentIDs: []string{"default"}, DesktopAuthCodeTTL: 120 * time.Second,
		DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour,
	}
}

// approveDesktopCode runs Start → Consent → Approve for one client and returns
// the authorization code the browser would hand back to the desktop app.
func approveDesktopCode(t *testing.T, svc *DesktopAuthService, userID, clientID, redirect, state string) string {
	t.Helper()
	ctx := context.Background()
	sum := sha256.Sum256([]byte(clientVerifier))
	attempt, err := svc.Start(ctx, DesktopStartInput{ClientID: clientID, CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: state, RedirectURI: redirect, DeploymentID: "default"})
	if err != nil {
		t.Fatalf("start %s: %v", clientID, err)
	}
	consent, err := svc.Consent(ctx, userID, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if consent.ClientID != clientID || consent.RedirectURI != redirect {
		t.Fatalf("consent shows client %q redirect %q", consent.ClientID, consent.RedirectURI)
	}
	code, callback, err := svc.Approve(ctx, userID, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	if len(callback) < len(redirect) || callback[:len(redirect)] != redirect {
		t.Fatalf("callback %q is not on %q", callback, redirect)
	}
	return code
}

func TestDesktopAuthAcceptsEachConfiguredClientOnItsOwnRedirect(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-test"), TTL: time.Minute}
	u, err := NewAuthService(pool, q, minter, time.Hour, nil).Register(context.Background(), "desktop-clients@example.com", "password123", "Desktop Clients", "en")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewDesktopAuthService(pool, q, minter, twoClientConfig())
	ctx := context.Background()

	for _, c := range []struct{ id, redirect string }{{stableClient, stableRedirect}, {devClient, devRedirect}} {
		code := approveDesktopCode(t, svc, u.User.ID, c.id, c.redirect, "state-"+c.id)
		sess, err := svc.Exchange(ctx, c.id, code, clientVerifier, c.redirect, "default")
		if err != nil {
			t.Fatalf("exchange %s: %v", c.id, err)
		}
		rotated, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default")
		if err != nil || rotated.RefreshToken == "" {
			t.Fatalf("refresh %s: %v", c.id, err)
		}
		row, err := q.GetDeviceSession(ctx, sess.DeviceSessionID)
		if err != nil {
			t.Fatal(err)
		}
		if row.ClientID != c.id {
			t.Fatalf("device session stored client %q, want %q", row.ClientID, c.id)
		}
	}

	sum := sha256.Sum256([]byte(clientVerifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	for _, c := range []struct{ id, redirect string }{{stableClient, devRedirect}, {devClient, stableRedirect}, {"uniwork-office-beta", devRedirect}} {
		if _, err := svc.Start(ctx, DesktopStartInput{ClientID: c.id, CodeChallenge: challenge, CodeChallengeMethod: "S256", State: "cross", RedirectURI: c.redirect, DeploymentID: "default"}); !errors.As(err, new(ValidationError)) {
			t.Fatalf("start %s on %s: %v, want invalid input", c.id, c.redirect, err)
		}
	}
}

func TestDesktopAuthCodeOnlyRedeemsForTheClientThatStartedIt(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-test"), TTL: time.Minute}
	u, err := NewAuthService(pool, q, minter, time.Hour, nil).Register(context.Background(), "desktop-cross@example.com", "password123", "Desktop Cross", "en")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewDesktopAuthService(pool, q, minter, twoClientConfig())
	ctx := context.Background()

	code := approveDesktopCode(t, svc, u.User.ID, devClient, devRedirect, "state-dev")
	for _, c := range []struct{ id, redirect string }{{stableClient, stableRedirect}, {stableClient, devRedirect}, {devClient, stableRedirect}} {
		if _, err := svc.Exchange(ctx, c.id, code, clientVerifier, c.redirect, "default"); !errors.Is(err, ErrDesktopAuthCodeInvalid) {
			t.Fatalf("exchange as %s on %s: %v, want auth_code_invalid", c.id, c.redirect, err)
		}
	}
	// The refused attempts did not burn the code for its own client.
	if _, err := svc.Exchange(ctx, devClient, code, clientVerifier, devRedirect, "default"); err != nil {
		t.Fatalf("own client exchange after cross attempts: %v", err)
	}
}

func TestDesktopAuthLegacySingleClientRefusesOtherClients(t *testing.T) {
	cfg := config.Config{DesktopAuthClientID: stableClient, DesktopAuthRedirectURIs: []string{stableRedirect}, DesktopAuthDeploymentIDs: []string{"default"}}
	svc := NewDesktopAuthService(nil, nil, auth.TokenMinter{}, cfg)
	if !svc.allowed(stableClient, stableRedirect, "default") {
		t.Fatal("legacy client refused on its own redirect")
	}
	if svc.allowed(devClient, devRedirect, "default") || svc.allowed(devClient, stableRedirect, "default") {
		t.Fatal("legacy config accepted a client it does not list")
	}
}
