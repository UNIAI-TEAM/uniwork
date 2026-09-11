package service

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
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

func TestPasswordResetIgnoresGoogleOnly(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	out := &fakeOutbox{}
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	s := NewPasswordResetService(pool, q, as, mail.Renderer{AppURL: "x"}, out)
	ctx := context.Background()
	if _, err := q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{ID: "g1", Email: "g@example.com", DisplayName: "G", GoogleID: pgtype.Text{String: "sub", Valid: true}, Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Request(ctx, "g@example.com"); err != nil || len(out.queued) != 0 {
		t.Fatalf("google-only: %v %d", err, len(out.queued))
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
