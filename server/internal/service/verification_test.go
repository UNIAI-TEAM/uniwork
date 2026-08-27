package service

import (
	"context"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type fakeSender struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (f *fakeSender) Send(_ context.Context, m mail.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return nil
}

func (f *fakeSender) last(t *testing.T) mail.Message {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sent) == 0 {
		t.Fatal("no mail sent")
	}
	return f.sent[len(f.sent)-1]
}

var sixDigits = regexp.MustCompile(`\b\d{6}\b`)

func codeFrom(t *testing.T, m mail.Message) string {
	t.Helper()
	code := sixDigits.FindString(m.Text)
	if code == "" {
		t.Fatalf("no 6-digit code in %q", m.Text)
	}
	return code
}

type verificationFixture struct {
	auth   *AuthService
	verify *VerificationService
	sender *fakeSender
	q      *db.Queries
}

func newVerificationFixture(t *testing.T, devCode string) verificationFixture {
	pool := testutil.DB(t)
	q := db.New(pool)
	sender := &fakeSender{}
	verify := NewVerificationService(q, sender, devCode)
	m := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	return verificationFixture{auth: NewAuthService(q, m, time.Hour, verify), verify: verify, sender: sender, q: q}
}

func (f verificationFixture) registered(t *testing.T) db.User {
	t.Helper()
	sess, err := f.auth.Register(context.Background(), "v@example.com", "password123", "V")
	if err != nil {
		t.Fatal(err)
	}
	return sess.User
}

func TestRegisterSendsVerificationCodeAndConfirmVerifies(t *testing.T) {
	f := newVerificationFixture(t, "")
	ctx := context.Background()
	u := f.registered(t)
	if u.EmailVerifiedAt.Valid {
		t.Fatal("new user must start unverified")
	}
	m := f.sender.last(t)
	if m.To != "v@example.com" {
		t.Fatalf("mail to %q", m.To)
	}
	code := codeFrom(t, m)

	got, err := f.verify.Confirm(ctx, u.ID, code)
	if err != nil {
		t.Fatal(err)
	}
	if !got.EmailVerifiedAt.Valid {
		t.Fatal("email_verified_at not set")
	}
	// The code is single-use.
	if _, err := f.verify.Confirm(ctx, u.ID, code); err != ErrInvalidCode {
		t.Fatalf("reuse: want ErrInvalidCode, got %v", err)
	}
	// And the user cannot ask for another.
	if err := f.verify.Send(ctx, u.ID); err != ErrConflict {
		t.Fatalf("send after verified: want ErrConflict, got %v", err)
	}
}

func TestVerificationResendGate(t *testing.T) {
	f := newVerificationFixture(t, "")
	ctx := context.Background()
	u := f.registered(t)
	if err := f.verify.Send(ctx, u.ID); err != ErrRateLimited {
		t.Fatalf("second send within 60s: want ErrRateLimited, got %v", err)
	}
	f.verify.now = func() time.Time { return time.Now().Add(61 * time.Second) }
	if err := f.verify.Send(ctx, u.ID); err != nil {
		t.Fatalf("send after gap: %v", err)
	}
	if len(f.sender.sent) != 2 {
		t.Fatalf("want 2 mails, got %d", len(f.sender.sent))
	}
}

func TestVerificationWrongCodeFiveTimesInvalidatesCode(t *testing.T) {
	f := newVerificationFixture(t, "")
	ctx := context.Background()
	u := f.registered(t)
	code := codeFrom(t, f.sender.last(t))
	wrong := "000000"
	if wrong == code {
		wrong = "111111"
	}
	for i := 0; i < 5; i++ {
		if _, err := f.verify.Confirm(ctx, u.ID, wrong); err != ErrInvalidCode {
			t.Fatalf("attempt %d: want ErrInvalidCode, got %v", i, err)
		}
	}
	if _, err := f.verify.Confirm(ctx, u.ID, code); err != ErrInvalidCode {
		t.Fatalf("correct code after 5 misses: want ErrInvalidCode, got %v", err)
	}
}

func TestVerificationExpiredCode(t *testing.T) {
	f := newVerificationFixture(t, "")
	ctx := context.Background()
	u := f.registered(t)
	if err := f.q.DeleteEmailVerificationCodesForUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	// Issue a code from 20 minutes "ago": its 10-minute expiry has passed.
	f.verify.now = func() time.Time { return time.Now().Add(-20 * time.Minute) }
	if err := f.verify.Send(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	code := codeFrom(t, f.sender.last(t))
	if _, err := f.verify.Confirm(ctx, u.ID, code); err != ErrInvalidCode {
		t.Fatalf("expired code: want ErrInvalidCode, got %v", err)
	}
}

func TestVerificationDevCodeNeedsAnActiveCode(t *testing.T) {
	f := newVerificationFixture(t, "123456")
	ctx := context.Background()
	u := f.registered(t)
	if _, err := f.verify.Confirm(ctx, u.ID, "123456"); err != nil {
		t.Fatalf("dev code with active code: %v", err)
	}

	// A user that never asked for a code cannot use the dev code either.
	u2, err := f.q.CreateUser(ctx, db.CreateUserParams{ID: "01NOCODE", Email: "n@example.com", DisplayName: "N"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.verify.Confirm(ctx, u2.ID, "123456"); err != ErrInvalidCode {
		t.Fatalf("dev code without active code: want ErrInvalidCode, got %v", err)
	}
}

func TestVerificationMailCarriesExpiry(t *testing.T) {
	f := newVerificationFixture(t, "")
	f.registered(t)
	m := f.sender.last(t)
	if m.Subject == "" || m.HTML == "" || m.Text == "" {
		t.Fatalf("incomplete message: %+v", m)
	}
	if !regexp.MustCompile(`10 phút`).MatchString(m.Text) {
		t.Fatalf("text body should state the 10 minute expiry: %q", m.Text)
	}
}

func TestUnverifiedUserCannotCompleteOnboardingOrCreateOrganization(t *testing.T) {
	f := newVerificationFixture(t, "")
	ctx := context.Background()
	u := f.registered(t)
	onboarding := NewOnboardingService(f.q, NewWorkspaceService(nil, f.q, NewOrganizationService(f.q)), NopPublisher{})
	if _, err := onboarding.Complete(ctx, u.ID, "invite_skipped", ""); err != ErrEmailUnverified {
		t.Fatalf("complete onboarding: want ErrEmailUnverified, got %v", err)
	}
	if _, err := NewOrganizationService(f.q).Create(ctx, u.ID, "Org", "org"); err != ErrEmailUnverified {
		t.Fatalf("create organization: want ErrEmailUnverified, got %v", err)
	}
	if _, err := f.verify.Confirm(ctx, u.ID, codeFrom(t, f.sender.last(t))); err != nil {
		t.Fatal(err)
	}
	if _, err := NewOrganizationService(f.q).Create(ctx, u.ID, "Org", "org"); err != nil {
		t.Fatalf("create organization after verify: %v", err)
	}
}
