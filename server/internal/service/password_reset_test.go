package service

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var resetToken = regexp.MustCompile(`token=([A-Za-z0-9]+)`)

func TestPasswordResetFlow(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	r := mail.Renderer{AppURL: "http://localhost:3000"}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, r, out)
	ctx := context.Background()
	u := registerVerified(t, q, as, "p@example.com", "P")
	old, _ := as.Login(ctx, "p@example.com", "password123")

	// Email lạ: im lặng, không mail.
	if err := s.Request(ctx, "nobody@example.com"); err != nil || len(out.queued) != 0 {
		t.Fatalf("unknown email: %v %d", err, len(out.queued))
	}
	if err := s.Request(ctx, "P@example.com "); err != nil || len(out.queued) != 1 {
		t.Fatalf("request: %v %d", err, len(out.queued))
	}
	m := out.queued[0]
	if m.Kind != mail.KindPasswordReset || m.UserID != u.ID {
		t.Fatalf("envelope %+v", m)
	}
	// Rate limit 60s: không mail thứ hai.
	if err := s.Request(ctx, "p@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("rate limit: %v %d", err, len(out.queued))
	}
	tok := resetToken.FindStringSubmatch(m.Text)[1]

	if _, err := s.Reset(ctx, tok, "short"); err == nil {
		t.Fatal("weak password accepted")
	}
	if _, err := s.Reset(ctx, "bogus", "newpassword1"); err != ErrInvalidToken {
		t.Fatalf("bogus token: %v", err)
	}
	sess, err := s.Reset(ctx, tok, "newpassword1")
	if err != nil || sess.AccessToken == "" {
		t.Fatalf("reset: %v", err)
	}
	if _, err := as.Login(ctx, "p@example.com", "password123"); err != ErrInvalidCredentials {
		t.Fatal("old password still works")
	}
	if _, err := as.Login(ctx, "p@example.com", "newpassword1"); err != nil {
		t.Fatal("new password rejected")
	}
	if _, err := as.Refresh(ctx, old.RefreshToken); err != ErrInvalidCredentials {
		t.Fatal("old refresh token not revoked")
	}
	if _, err := s.Reset(ctx, tok, "newpassword2"); err != ErrInvalidToken {
		t.Fatal("token reusable")
	}
}

// An account that signs in only with a provider is not left out of forgot
// password (ADR 0047, spec §3.7): the answer is the same as for any address,
// and the mail it gets says the account signs in with Google, offers that
// sign-in, and carries the same one-time link to set a first password, which
// is audited as auth.password_set, not a change.
func TestForgotPasswordOnAPasswordlessAccountOffersToSetOne(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	ctx := context.Background()
	u, err := q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{ID: "g1", Email: "g@example.com", DisplayName: "G", GoogleID: pgtype.Text{String: "sub", Valid: true}, EmailVerified: true, Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Request(ctx, "G@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("google-only: %v %d", err, len(out.queued))
	}
	m := out.queued[0]
	if m.Kind != mail.KindPasswordReset || m.UserID != u.ID || m.Subject != "Đặt mật khẩu UniWork" {
		t.Fatalf("envelope %+v", m)
	}
	for _, want := range []string{"đăng nhập bằng Google", "http://localhost:3000/login?provider=google", "/reset-password?token="} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("mail misses %q: %s", want, m.Text)
		}
	}
	if strings.Contains(m.Text, "provider=apple") {
		t.Fatal("offers a provider the account does not have")
	}
	tok := resetToken.FindStringSubmatch(m.Text)[1]
	sess, err := s.Reset(ctx, tok, "first-password-1")
	if err != nil || sess.AccessToken == "" {
		t.Fatalf("set: %v", err)
	}
	if _, err := as.Login(ctx, "g@example.com", "first-password-1"); err != nil {
		t.Fatalf("the password set by the link: %v", err)
	}
	if got, _ := q.GetUserByID(ctx, u.ID); !got.GoogleID.Valid || !got.PasswordChangedAt.Valid {
		t.Fatalf("the link must add a password and keep Google: %+v", got)
	}
	count := func(action string) int {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
			AND metadata::jsonb->>'via' = 'reset_token'`, action, u.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if set, changed := count(audit.ActionAuthPasswordSet), count(audit.ActionAuthPasswordChanged); set != 1 || changed != 0 {
		t.Fatalf("audit: password_set %d, password_changed %d", set, changed)
	}
}

// TestPasswordResetResendWindowUsesInjectedClock proves the 60s resend gate
// reads s.now rather than wall-clock sleep: advancing the fake clock past
// the window is enough to unblock a second mail without a real sleep.
func TestPasswordResetResendWindowUsesInjectedClock(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	ctx := context.Background()
	registerVerified(t, q, as, "clock@example.com", "C")

	base := time.Now()
	s.now = func() time.Time { return base }
	if err := s.Request(ctx, "clock@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("first request: %v %d", err, len(out.queued))
	}

	s.now = func() time.Time { return base.Add(30 * time.Second) }
	if err := s.Request(ctx, "clock@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("still inside window: %v %d", err, len(out.queued))
	}

	s.now = func() time.Time { return base.Add(61 * time.Second) }
	if err := s.Request(ctx, "clock@example.com"); err != nil || len(out.queued) != 2 {
		t.Fatalf("past window must send: %v %d", err, len(out.queued))
	}
}

// TestPasswordResetExpiredTokenIsInvalid proves an expired token is
// rejected. expires_at is DB-computed from s.now at creation time (the
// active-token query compares against the database's own now(), not
// s.now), so the deterministic way to force expiry is to mint the token
// with a clock already an hour in the past.
func TestPasswordResetExpiredTokenIsInvalid(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	ctx := context.Background()
	registerVerified(t, q, as, "expired@example.com", "E")

	s.now = func() time.Time { return time.Now().Add(-2 * time.Hour) }
	if err := s.Request(ctx, "expired@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("request: %v %d", err, len(out.queued))
	}
	tok := resetToken.FindStringSubmatch(out.queued[0].Text)[1]

	if _, err := s.Reset(ctx, tok, "newpassword1"); err != ErrInvalidToken {
		t.Fatalf("expired token: %v", err)
	}
}

// TestPasswordResetDailyCap proves the 6th request within 24h is silently
// dropped (same as unknown-email and rate-limited paths), while the first
// five all send.
func TestPasswordResetDailyCap(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	ctx := context.Background()
	registerVerified(t, q, as, "cap@example.com", "Cap")

	base := time.Now()
	for i := 0; i < passwordResetDailyCap; i++ {
		s.now = func() time.Time { return base.Add(time.Duration(i) * 61 * time.Second) }
		if err := s.Request(ctx, "cap@example.com"); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if len(out.queued) != passwordResetDailyCap {
		t.Fatalf("expected %d mails, got %d", passwordResetDailyCap, len(out.queued))
	}

	s.now = func() time.Time { return base.Add(time.Duration(passwordResetDailyCap) * 61 * time.Second) }
	if err := s.Request(ctx, "cap@example.com"); err != nil || len(out.queued) != passwordResetDailyCap {
		t.Fatalf("6th request must be silently dropped: %v %d", err, len(out.queued))
	}
}

// A reset link mailed before the account was erased sets no password on the
// anonymised row (spec 2026-10-27 §2): the deletion expires every link, and
// the password write refuses a deleted account even for a link that slipped
// past it. A reset records when the password changed.
func TestAResetLinkMailedBeforeDeletionIsDead(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "http://localhost:3000"}, out)
	ctx := context.Background()

	kept := registerVerified(t, q, as, "kept@example.com", "K")
	if err := s.Request(ctx, "kept@example.com"); err != nil {
		t.Fatal(err)
	}
	sess, err := s.Reset(ctx, resetToken.FindStringSubmatch(out.last(t).Text)[1], "newpassword1")
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := q.GetUserByID(ctx, kept.ID); !u.PasswordChangedAt.Valid || sess.User.ID != kept.ID {
		t.Fatalf("a reset records when the password changed: %+v", u)
	}

	gone := registerVerified(t, q, as, "gone@example.com", "G")
	if err := s.Request(ctx, "gone@example.com"); err != nil {
		t.Fatal(err)
	}
	mailed := resetToken.FindStringSubmatch(out.last(t).Text)[1]
	if err := as.DeleteAccount(ctx, gone.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reset(ctx, mailed, "newpassword1"); err != ErrInvalidToken {
		t.Fatalf("a link mailed before the deletion: %v", err)
	}
	// A link the deletion did not see (written after it, as a race would).
	late := util.NewID() + util.NewID()
	if _, err := q.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: gone.ID, TokenHash: hashToken(late),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reset(ctx, late, "newpassword1"); err != ErrInvalidToken {
		t.Fatalf("a link to a deleted account: %v", err)
	}
	if u, _ := q.GetUserByID(ctx, gone.ID); u.PasswordHash.Valid {
		t.Fatal("a deleted account got a password")
	}
}

// A reset link is the first proof of the mailbox an unverified account ever
// got, so the reset takes the account back from whoever registered the
// address (ADR 0047 §2, spec §3.1): everything they left goes — their
// second factor, provider links, sessions, devices, pushes, consents — the
// address is verified, the owner is told, and the session comes without the
// squatter's second factor.
func TestAResetLinkReclaimsAnUnverifiedAccount(t *testing.T) {
	f := newIdentityFixture(t)
	reset := NewPasswordResetService(f.pool, f.q, f.auth, mail.Renderer{AppURL: "http://localhost:3000"}, f.out)
	s := f.squat(t, "mailbox@example.com")
	if !s.user.MfaEnabledAt.Valid {
		t.Fatal("the squatter has a second factor")
	}
	sess, err := reset.Reset(f.ownerBrowser(), s.resetTokenRaw, "owner-password")
	if err != nil {
		t.Fatal(err)
	}
	if !sess.Reclaimed || sess.MFAPending() || sess.RefreshToken == "" || sess.User.ID != s.user.ID {
		t.Fatalf("the owner is signed in, no second factor asked: %+v", sess)
	}
	f.assertTakenBack(t, s, "mailbox@example.com")
	if n := f.newLogins("mailbox@example.com"); n != 0 {
		t.Fatalf("the reclaim also sent %d new-login alerts", n)
	}
	u := f.user(t, s.user.ID)
	if !u.PasswordHash.Valid || !u.PasswordChangedAt.Valid || u.GoogleID.Valid || u.AppleID.Valid || u.AppleRefreshTokenEnc.Valid {
		t.Fatalf("the owner's password is the one way in: %+v", u)
	}
	if _, err := f.auth.Login(f.ctx, "mailbox@example.com", "owner-password"); err != nil {
		t.Fatalf("the owner's password: %v", err)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'via' = 'reset_token' AND metadata::jsonb->>'reclaimed' = 'true'`, audit.ActionAuthPasswordChanged, u.ID); n != 1 {
		t.Fatalf("%d reclaiming password_changed rows, want 1", n)
	}
	if notice := f.mailOfKind(t, "mailbox@example.com", mail.KindSignInMethodChanged); !strings.Contains(notice.Text, "liên kết đặt lại mật khẩu") {
		t.Fatalf("the notice names the reset link as the proof: %+v", notice)
	}
	// The link is spent: it cannot take the account a second time.
	if _, err := reset.Reset(f.ctx, s.resetTokenRaw, "another-password"); err != ErrInvalidToken {
		t.Fatalf("the link reused: %v", err)
	}
}
