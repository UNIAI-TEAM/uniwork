package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// enrol turns MFA on for a fresh account and hands back its secret and
// recovery codes, the way the settings screen would.
func enrol(t *testing.T, s *AuthService, ctx context.Context, userID string) (secret string, codes []string) {
	t.Helper()
	setup, err := s.SetupTOTP(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmTOTP(ctx, userID, "000000"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("wrong code must not enable MFA: %v", err)
	}
	code, _ := auth.TOTPCode(setup.Secret, time.Now())
	codes, err = s.ConfirmTOTP(ctx, userID, code)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 8 {
		t.Fatalf("recovery codes: %d", len(codes))
	}
	return setup.Secret, codes
}

func TestMFALoginIsTwoSteps(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()
	sess, err := s.Register(ctx, "mfa@example.com", "password123", "An", "vi")
	if err != nil {
		t.Fatal(err)
	}
	secret, codes := enrol(t, s, ctx, sess.User.ID)
	if _, err := s.SetupTOTP(ctx, sess.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("setup while enabled: %v", err)
	}

	first, err := s.Login(ctx, "mfa@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if !first.MFAPending() || first.AccessToken != "" || first.RefreshToken != "" {
		t.Fatalf("password alone must yield a challenge, got %+v", first)
	}
	if _, err := s.VerifyMFA(ctx, first.MFAToken, "000000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong TOTP: %v", err)
	}
	if _, err := s.VerifyMFA(ctx, first.AccessToken+"junk", "000000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("bad token: %v", err)
	}
	code, _ := auth.TOTPCode(secret, time.Now())
	full, err := s.VerifyMFA(ctx, first.MFAToken, code)
	if err != nil || full.AccessToken == "" || full.RefreshToken == "" {
		t.Fatalf("verify: %+v %v", full, err)
	}

	// A recovery code works exactly once.
	again, _ := s.Login(ctx, "mfa@example.com", "password123")
	if _, err := s.VerifyMFA(ctx, again.MFAToken, codes[0]); err != nil {
		t.Fatalf("recovery code: %v", err)
	}
	again, _ = s.Login(ctx, "mfa@example.com", "password123")
	if _, err := s.VerifyMFA(ctx, again.MFAToken, codes[0]); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("reused recovery code: %v", err)
	}

	// Disable needs a valid second factor, then login is one step again.
	if _, err := s.DisableTOTP(ctx, sess.User.ID, "000000"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("disable with wrong code: %v", err)
	}
	if _, err := s.DisableTOTP(ctx, sess.User.ID, codes[1]); err != nil {
		t.Fatal(err)
	}
	plain, err := s.Login(ctx, "mfa@example.com", "password123")
	if err != nil || plain.MFAPending() {
		t.Fatalf("after disable: %+v %v", plain, err)
	}
}

func TestSessionsListRevokeAndRotate(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}, time.Hour, nil)
	out := &fakeOutbox{}
	s.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, out)
	phone := WithSessionMeta(context.Background(), SessionMeta{UserAgent: "Phone/1", IP: "10.0.0.2"})
	laptop := WithSessionMeta(context.Background(), SessionMeta{UserAgent: "Laptop/1", IP: "10.0.0.3"})

	first, err := s.Register(laptop, "sess@example.com", "password123", "An", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if n := len(out.queued); n != 0 {
		t.Fatalf("registration must not send a new-device mail, got %d", n)
	}
	second, err := s.Login(phone, "sess@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.queued) != 1 || out.queued[0].Kind != "new_login" {
		t.Fatalf("new browser must send new_login, got %+v", out.queued)
	}
	if _, err := s.Login(phone, "sess@example.com", "password123"); err != nil {
		t.Fatal(err)
	}
	if len(out.queued) != 1 {
		t.Fatalf("known browser must not send again, got %d", len(out.queued))
	}

	rotated, err := s.Refresh(WithSessionMeta(context.Background(), SessionMeta{IP: "10.0.0.9"}), second.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.SessionID != second.SessionID {
		t.Fatal("refresh must keep the session id")
	}
	rows, err := s.ListSessions(context.Background(), first.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("sessions: %d, want 3", len(rows))
	}
	if rows[0].SessionID != second.SessionID || rows[0].Ip != "10.0.0.9" || rows[0].UserAgent != "Phone/1" {
		t.Fatalf("rotated row: %+v", rows[0])
	}

	if err := s.RevokeSession(context.Background(), first.User.ID, second.SessionID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeSession(context.Background(), first.User.ID, second.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoking twice: %v", err)
	}
	if _, err := s.Refresh(context.Background(), rotated.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a revoked session must not refresh: %v", err)
	}
	n, err := s.RevokeOtherSessions(context.Background(), first.User.ID, first.SessionID)
	if err != nil || n != 1 {
		t.Fatalf("revoke others: %d %v", n, err)
	}
	rows, _ = s.ListSessions(context.Background(), first.User.ID)
	if len(rows) != 1 || rows[0].SessionID != first.SessionID {
		t.Fatalf("only the current session may survive: %+v", rows)
	}
}

func TestDeleteAccountAnonymisesAndKeepsAudit(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	ctx := f.ctx
	addOrgMember(t, f.q, f.orgID, f.member.ID)

	// The owner must transfer first; the member can go.
	if err := f.auth.DeleteAccount(ctx, f.owner.ID, DeleteAccountInput{Password: auditPassword}); !errors.Is(err, ErrOwnerMustTransfer) {
		t.Fatalf("owner: %v", err)
	}
	if err := f.auth.DeleteAccount(ctx, f.member.ID, DeleteAccountInput{Password: "wrong"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password: %v", err)
	}
	sess, err := f.auth.Login(ctx, f.member.Email, auditPassword)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.auth.DeleteAccount(ctx, f.member.ID, DeleteAccountInput{Password: auditPassword}); err != nil {
		t.Fatal(err)
	}
	u, err := f.q.GetUserByID(ctx, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email == f.member.Email || u.DisplayName != deletedDisplayName || u.PasswordHash.Valid || !u.DeletedAt.Valid {
		t.Fatalf("not anonymised: %+v", u)
	}
	if _, err := f.auth.Login(ctx, f.member.Email, auditPassword); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old email must not log in: %v", err)
	}
	if _, err := f.auth.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("sessions must be revoked: %v", err)
	}
	if _, err := f.orgs.RequireMember(ctx, f.orgID, f.member.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("membership must be deactivated: %v", err)
	}
	var n int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE resource_type = 'user' AND resource_id = $1 AND action = 'user.deleted'`, f.member.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("user.deleted audit rows: %d, want 1", n)
	}
}
