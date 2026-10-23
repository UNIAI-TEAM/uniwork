package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A device id that belongs to another account answers exactly like a missing
// one (404) and leaves that device alone; the caller's own device still
// revokes with 200, idempotently.
func TestDesktopRevokeDeviceForeignIDIsNotFound(t *testing.T) {
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-handler-test"), TTL: time.Minute}
	authSvc := service.NewAuthService(pool, q, minter, time.Hour, nil)
	cfg := config.Config{FrontendOrigin: "http://localhost:13380", DesktopAuthClientID: "uniwork-office", DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}, DesktopAuthDeploymentIDs: []string{"default"}, RefreshTokenTTL: time.Hour}
	svc := service.NewDesktopAuthService(pool, q, minter, cfg)
	h := &handlers{Deps: Deps{DesktopAuth: svc, Log: slog.Default()}}

	signIn := func(email string) (string, string) {
		t.Helper()
		u, err := authSvc.Register(ctx, email, "password123", "Desktop User", "en")
		if err != nil {
			t.Fatal(err)
		}
		verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
		sum := sha256.Sum256([]byte(verifier))
		attempt, err := svc.Start(ctx, service.DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: "s-" + email, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default"})
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
		return u.User.ID, sess.DeviceSessionID
	}
	owner, ownerDevice := signIn("revoke-owner@example.com")
	caller, callerDevice := signIn("revoke-caller@example.com")

	revoke := func(userID, deviceID string) int {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("deviceSessionID", deviceID)
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/desktop/devices/"+deviceID, nil)
		req = req.WithContext(context.WithValue(middleware.WithUserID(req.Context(), userID), chi.RouteCtxKey, rctx))
		rec := httptest.NewRecorder()
		h.desktopRevokeDevice(rec, req)
		return rec.Code
	}

	if got := revoke(caller, ownerDevice); got != http.StatusNotFound {
		t.Fatalf("foreign device revoke = %d, want 404", got)
	}
	if got := revoke(caller, "01NOSUCHDEVICE0000000000000"); got != http.StatusNotFound {
		t.Fatalf("missing device revoke = %d, want 404", got)
	}
	if err := svc.CheckDeviceSession(ctx, owner, ownerDevice); err != nil {
		t.Fatalf("foreign revoke touched the owner's device: %v", err)
	}
	if got := revoke(caller, callerDevice); got != http.StatusOK {
		t.Fatalf("own device revoke = %d, want 200", got)
	}
	if got := revoke(caller, callerDevice); got != http.StatusOK {
		t.Fatalf("repeated own device revoke = %d, want 200", got)
	}
}
