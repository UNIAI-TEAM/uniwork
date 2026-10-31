package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// webToken is the access token the auth middleware would put on the context
// of a request from browser session sid, issued at iat.
func webToken(ctx context.Context, uid, sid string, iat time.Time) context.Context {
	return auth.WithAccessToken(ctx, auth.AccessToken{UserID: uid, SessionID: sid, Web: true, IssuedAt: iat})
}

// startWebSession starts a browser session for uid (its first refresh token)
// and answers its id.
func startWebSession(t *testing.T, q *db.Queries, uid string) string {
	t.Helper()
	sid := util.NewID()
	if _, err := q.CreateRefreshToken(context.Background(), db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: uid, TokenHash: hashToken(util.NewID()), SessionID: sid,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return sid
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
// reading until it expires, but the sensitive commands refuse it (ADR 0049
// §5, spec §3.7): approving a desktop or MCP consent would hand whoever held
// the old session a new one. A token of the same second passes (the mark is
// whole seconds, like iat), and a device token is judged by its device
// session instead.
func TestCredentialsRevokedAtRefusesOlderWebTokens(t *testing.T) {
	t.Run("desktop consent", func(t *testing.T) {
		f := newIdentityFixture(t)
		u := registerVerified(t, f.q, f.auth, "creds-desktop@example.com", "Creds")
		sid := startWebSession(t, f.q, u.ID)
		if err := markCredentialsRevoked(f.ctx, f.q, u.ID); err != nil {
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
		_, _, err := f.desktop.Approve(webToken(f.ctx, u.ID, sid, mark.Add(-time.Second)), u.ID, id, csrf)
		refusedAsRevoked(t, err)
		c, err := f.desktop.Consent(f.ctx, u.ID, id)
		if err != nil || c.Status != "pending" {
			t.Fatalf("a refused approval leaves the attempt pending: %+v %v", c, err)
		}
		if _, _, err := f.desktop.Approve(webToken(f.ctx, u.ID, sid, mark), u.ID, id, c.CSRFToken); err != nil {
			t.Fatalf("a token of the mark's own second: %v", err)
		}
		id, csrf = attempt("device")
		d := f.deviceSignIn(t, u.ID, "device-session")
		device := auth.WithAccessToken(f.ctx, auth.AccessToken{UserID: u.ID, SessionID: d.DeviceSessionID, IssuedAt: mark.Add(-time.Hour)})
		if _, _, err := f.desktop.Approve(device, u.ID, id, csrf); err != nil {
			t.Fatalf("a device token is not judged by the mark: %v", err)
		}
	})
	t.Run("verified-only commands", func(t *testing.T) {
		// A reclaim verifies the address, and the gate of what a verified
		// address unlocks (the invitations sent to it, founding an
		// organization) must not open to the squatter's leftover token.
		f := newIdentityFixture(t)
		s := f.squat(t, "verified-only@gmail.com")
		squatter, held := f.browser(t, s.user.ID)
		res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-verified-only", Email: "verified-only@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
		if err != nil || res.Session.AccessToken == "" || !res.Reclaimed {
			t.Fatalf("the owner's reclaim: %+v %v", res, err)
		}
		mark := f.user(t, s.user.ID).CredentialsRevokedAt.Time
		orgs := NewOrganizationService(f.pool, f.q)
		ws := NewWorkspaceService(f.pool, f.q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, f.out)
		_, err = ws.PendingInvitations(squatter, s.user.ID)
		refusedAsRevoked(t, err)
		_, err = orgs.Create(squatter, s.user.ID, "Squat", "squat-org")
		refusedAsRevoked(t, err)
		// The mark's own second holds the owner's new session and, maybe, one
		// the reclaim ended: the session tells them apart.
		_, err = ws.PendingInvitations(webToken(f.ctx, s.user.ID, held.SessionID, mark), s.user.ID)
		refusedAsRevoked(t, err)
		if _, err := ws.PendingInvitations(webToken(f.ctx, s.user.ID, res.Session.SessionID, mark), s.user.ID); err != nil {
			t.Fatalf("the reclaim's own session in the mark's second: %v", err)
		}
		if _, err := orgs.Create(f.bearer(t, res.Session), s.user.ID, "Owner", "owner-org"); err != nil {
			t.Fatalf("the owner founds an organization: %v", err)
		}
	})
	t.Run("mcp consent", func(t *testing.T) {
		w := newMcpWorld(t)
		w.enable(t)
		c := w.publicClient(t, "https://x.test/cb")
		sid := startWebSession(t, w.q, w.owner.ID)
		if err := markCredentialsRevoked(w.ctx, w.q, w.owner.ID); err != nil {
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
		_, err = w.svc.Approve(webToken(w.ctx, w.owner.ID, sid, mark.Add(-time.Second)), w.owner.ID, id, consent.CSRFToken, w.org.ID, false)
		refusedAsRevoked(t, err)
		if n, err := w.q.ListMcpGrantsForUser(w.ctx, w.owner.ID); err != nil || len(n) != 0 {
			t.Fatalf("a refused approval granted something: %v %v", n, err)
		}
		if _, err := w.svc.Approve(webToken(w.ctx, w.owner.ID, sid, mark.Add(time.Second)), w.owner.ID, id, consent.CSRFToken, w.org.ID, false); err != nil {
			t.Fatalf("a newer token approves: %v", err)
		}
	})
}

// approveFrom claims and approves a desktop attempt for uid from the bearer
// on ctx; the error is Approve's.
func (f *identityFixture) approveFrom(t *testing.T, ctx context.Context, uid, state string) (string, error) {
	t.Helper()
	sum := sha256.Sum256([]byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"))
	a, err := f.desktop.Start(f.ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: state, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := f.desktop.Consent(f.ctx, uid, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := f.desktop.Approve(ctx, uid, a.ID, c.CSRFToken)
	return code, err
}

// A reset link is how an owner who fears someone else has the password gets
// the account back (ADR 0049 §5), so it ends whatever the old password let
// in, not only the sessions: the mark refuses a browser token issued before
// on every sensitive command, a consent approved before cannot be redeemed,
// and a token whose session was ended cannot approve a new one in its last
// minutes. "Sign out other sessions" leaves those minutes to nobody either.
// The session the reset hands out is the owner's, and approves.
func TestAResetLinkEndsWhatTheOldPasswordLetIn(t *testing.T) {
	f := newIdentityFixture(t)
	u := registerVerified(t, f.q, f.auth, "reset-ends@example.com", "Reset")
	thief, _ := f.browser(t, u.ID)
	approved, err := f.approveFrom(t, thief, u.ID, "before-reset")
	if err != nil {
		t.Fatal(err)
	}
	mcpAttempt := util.NewID()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO mcp_auth_attempts (id, client_id, redirect_uri, code_challenge, scope, resource, user_id, expires_at)
		VALUES ($1, 'client', 'https://x.test/cb', 'c', 'read', 'https://api.test/mcp', $2, now() + interval '10 minutes')`, mcpAttempt, u.ID); err != nil {
		t.Fatal(err)
	}
	raw := util.NewID() + util.NewID()
	if _, err := f.q.CreatePasswordResetToken(f.ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(raw),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	sess, err := NewPasswordResetService(f.pool, f.q, f.auth, mail.Renderer{AppURL: "http://localhost:3000"}, f.out).Reset(f.ctx, raw, "a-brand-new-password")
	if err != nil {
		t.Fatal(err)
	}
	if !f.user(t, u.ID).CredentialsRevokedAt.Valid {
		t.Fatal("a reset leaves credentials_revoked_at unset")
	}
	_, err = f.approveFrom(t, thief, u.ID, "after-reset")
	refusedAsRevoked(t, err)
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	if _, err := f.desktop.Exchange(f.ctx, "uniwork-office", approved, verifier, "uniwork-office://auth/callback", "default"); err == nil {
		t.Fatal("a consent approved before the reset opened a device session after it")
	}
	if n := f.count(t, `SELECT count(*) FROM mcp_auth_attempts WHERE id = $1 AND cancelled_at IS NOT NULL`, mcpAttempt); n != 1 {
		t.Fatal("an MCP consent opened before the reset is still open")
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'reason' = 'password_reset' AND metadata::jsonb->>'desktop_attempts_cancelled' = '1'
		AND metadata::jsonb->>'mcp_attempts_cancelled' = '1'`, audit.ActionAuthSessionRevoked, u.ID); n != 1 {
		t.Fatal("the reset audits the consents it cancelled")
	}
	owner := f.bearer(t, sess)
	if _, err := f.approveFrom(t, owner, u.ID, "owner"); err != nil {
		t.Fatalf("the reset's own session approves: %v", err)
	}

	// Sign out other sessions marks nothing, but the session it ended can no
	// longer approve: the consent judges the session, not only the token.
	other, _ := f.browser(t, u.ID)
	if _, err := f.auth.RevokeOtherSessions(owner, u.ID, sess.SessionID); err != nil {
		t.Fatal(err)
	}
	_, err = f.approveFrom(t, other, u.ID, "signed-out")
	refusedAsRevoked(t, err)
	if _, err := f.approveFrom(t, owner, u.ID, "kept"); err != nil {
		t.Fatalf("the session that signed the others out approves: %v", err)
	}
}

// The mark and a token's iat are compared at one-second precision, so both
// come from one clock, the server's, which mints every iat (ADR 0049): a
// change marked just before the server's second turns is stamped with that
// second, not the next one because the database's clock runs ahead, which
// would make the session the same change kept, refreshed right after, older
// than its own mark and refused on every sensitive command.
func TestTheCredentialMarkIsTheServersSecond(t *testing.T) {
	f := newIdentityFixture(t)
	u := registerVerified(t, f.q, f.auth, "mark-clock@example.com", "Mark")
	ctx, sess := f.browser(t, u.ID)
	for i := 0; i < 3; i++ {
		time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second - 40*time.Millisecond)))
		before := time.Now().Truncate(time.Second)
		tx, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := signOthersOut(ctx, f.q.WithTx(tx), u.ID, "password_changed"); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		after := time.Now()
		if mark := f.user(t, u.ID).CredentialsRevokedAt.Time; mark.Before(before) || mark.After(after) {
			t.Fatalf("change %d marked %v, outside the server's [%v, %v]", i+1, mark, before, after)
		}
		refreshed, err := f.auth.Refresh(f.ctx, sess.RefreshToken)
		if err != nil {
			t.Fatal(err)
		}
		sess = refreshed
		ctx = WithSessionMeta(f.bearer(t, refreshed), SessionMeta{UserAgent: "Firefox/140", IP: "10.0.0.9"})
		if _, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"}); err != nil {
			t.Fatalf("change %d: the kept session, refreshed, is refused: %v", i+1, err)
		}
	}
}
