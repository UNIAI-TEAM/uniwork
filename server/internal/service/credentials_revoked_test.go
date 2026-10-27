package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// webToken is the access token the auth middleware would put on the context
// of a browser request issued at iat.
func webToken(ctx context.Context, uid string, iat time.Time) context.Context {
	return auth.WithAccessToken(ctx, auth.AccessToken{UserID: uid, SessionID: "web-session", Web: true, IssuedAt: iat})
}

func refusedAsRevoked(t *testing.T, err error) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "invalid_token" || ce.Status != http.StatusUnauthorized || !errors.Is(err, ErrCredentialsRevoked) {
		t.Fatalf("want 401 invalid_token, got %v", err)
	}
}

// Once an account's credentials change (a reclaim marks
// credentials_revoked_at), a browser access token issued before keeps
// reading until it expires, but the sensitive commands refuse it (ADR 0047
// §5, spec §3.7): approving a desktop or MCP consent would hand whoever held
// the old session a new one. A token of the same second passes (the mark is
// whole seconds, like iat), and a device token is judged by its device
// session instead.
func TestCredentialsRevokedAtRefusesOlderWebTokens(t *testing.T) {
	t.Run("desktop consent", func(t *testing.T) {
		f := newIdentityFixture(t)
		u := registerVerified(t, f.q, f.auth, "creds-desktop@example.com", "Creds")
		if err := f.q.MarkCredentialsRevoked(f.ctx, u.ID); err != nil {
			t.Fatal(err)
		}
		mark := f.user(t, u.ID).CredentialsRevokedAt.Time
		sum := sha256.Sum256([]byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"))
		attempt := func(state string) (string, string) {
			a, err := f.desktop.Start(f.ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: state, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default"})
			if err != nil {
				t.Fatal(err)
			}
			c, err := f.desktop.Consent(f.ctx, u.ID, a.ID)
			if err != nil {
				t.Fatal(err)
			}
			return a.ID, c.CSRFToken
		}

		id, csrf := attempt("older")
		_, _, err := f.desktop.Approve(webToken(f.ctx, u.ID, mark.Add(-time.Second)), u.ID, id, csrf)
		refusedAsRevoked(t, err)
		c, err := f.desktop.Consent(f.ctx, u.ID, id)
		if err != nil || c.Status != "pending" {
			t.Fatalf("a refused approval leaves the attempt pending: %+v %v", c, err)
		}
		if _, _, err := f.desktop.Approve(webToken(f.ctx, u.ID, mark), u.ID, id, c.CSRFToken); err != nil {
			t.Fatalf("a token of the mark's own second: %v", err)
		}
		id, csrf = attempt("device")
		device := auth.WithAccessToken(f.ctx, auth.AccessToken{UserID: u.ID, SessionID: "device", IssuedAt: mark.Add(-time.Hour)})
		if _, _, err := f.desktop.Approve(device, u.ID, id, csrf); err != nil {
			t.Fatalf("a device token is not judged by the mark: %v", err)
		}
	})
	t.Run("mcp consent", func(t *testing.T) {
		w := newMcpWorld(t)
		w.enable(t)
		c := w.publicClient(t, "https://x.test/cb")
		if err := w.q.MarkCredentialsRevoked(w.ctx, w.owner.ID); err != nil {
			t.Fatal(err)
		}
		owner, err := w.q.GetUserByID(w.ctx, w.owner.ID)
		if err != nil {
			t.Fatal(err)
		}
		mark := owner.CredentialsRevokedAt.Time
		consentURL, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", State: "st"})
		if err != nil {
			t.Fatal(err)
		}
		id := attemptID(t, consentURL)
		consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		_, err = w.svc.Approve(webToken(w.ctx, w.owner.ID, mark.Add(-time.Second)), w.owner.ID, id, consent.CSRFToken, w.org.ID, false)
		refusedAsRevoked(t, err)
		if n, err := w.q.ListMcpGrantsForUser(w.ctx, w.owner.ID); err != nil || len(n) != 0 {
			t.Fatalf("a refused approval granted something: %v %v", n, err)
		}
		if _, err := w.svc.Approve(webToken(w.ctx, w.owner.ID, mark.Add(time.Second)), w.owner.ID, id, consent.CSRFToken, w.org.ID, false); err != nil {
			t.Fatalf("a newer token approves: %v", err)
		}
	})
}
