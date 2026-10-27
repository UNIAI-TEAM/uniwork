package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The browser token's iat reaches the consent command from the bearer: a
// mark set after the token was issued refuses the approval with 401
// invalid_token, and the same token approves once the mark predates it.
func TestCredentialsRevokedAtReachesTheConsentThroughTheBearer(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.DesktopAuthClientID = "uniwork-office"
	d.Cfg.DesktopAuthRedirectURIs = []string{"uniwork-office://auth/callback"}
	d.Cfg.DesktopAuthDeploymentIDs = []string{"default"}
	d.Cfg.DesktopAuthCodeTTL = 2 * time.Minute
	d.Cfg.DesktopAuthAttemptTTL = 10 * time.Minute
	d.Cfg.RefreshTokenTTL = time.Hour
	d.DesktopAuth = service.NewDesktopAuthService(pool, db.New(pool), d.Minter, d.Cfg)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, uid := filesRegister(t, srv, "consent-mark@example.com")

	attempt, err := d.DesktopAuth.Start(context.Background(), service.DesktopStartInput{
		ClientID: "uniwork-office", CodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", CodeChallengeMethod: "S256",
		State: "st", RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default",
	})
	if err != nil {
		t.Fatal(err)
	}
	res, consent := doJSON(t, srv, "GET", "/api/v1/auth/desktop/authorize?attempt_id="+attempt.ID, token, nil)
	if res.StatusCode != 200 || consent["csrf_token"] == "" {
		t.Fatalf("consent: %d %v", res.StatusCode, consent)
	}
	approve := map[string]string{"decision": "approve", "attempt_id": attempt.ID, "csrf_token": consent["csrf_token"].(string)}
	if _, err := pool.Exec(context.Background(), `UPDATE users SET credentials_revoked_at = now() + interval '1 hour' WHERE id = $1`, uid); err != nil {
		t.Fatal(err)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/auth/desktop/authorize", token, approve); res.StatusCode != http.StatusUnauthorized || errorCode(out) != "invalid_token" {
		t.Fatalf("approve with a token older than the mark: %d %v", res.StatusCode, out)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE users SET credentials_revoked_at = now() - interval '1 hour' WHERE id = $1`, uid); err != nil {
		t.Fatal(err)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/auth/desktop/authorize", token, approve); res.StatusCode != 200 || out["status"] != "approved" {
		t.Fatalf("approve with a token newer than the mark: %d %v", res.StatusCode, out)
	}
}
