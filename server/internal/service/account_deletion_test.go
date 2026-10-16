package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// A wrong proof at account deletion is a refusal to someone already signed
// in, never 401: the client reads 401 as an expired session, refreshes and
// replays the request, so the secret would be checked, and sent, twice.
// Each of the three proofs answers its own code.
func TestDeleteAccountRefusesAWrongProofWithout401(t *testing.T) {
	g, as, _ := newGoogleFixture(t)
	ctx := context.Background()

	refused := func(t *testing.T, err error, sentinel error, code string, status int) {
		t.Helper()
		var ce CodedError
		if !errors.Is(err, sentinel) || !errors.As(err, &ce) || ce.Code != code || ce.Status != status {
			t.Fatalf("got %#v, want %s %d", err, code, status)
		}
		if errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("a deletion refusal must not read as invalid_credentials: %v", err)
		}
	}

	t.Run("password", func(t *testing.T) {
		sess, err := as.Register(ctx, "xoa-mk@example.com", "password123", "An", "vi")
		if err != nil {
			t.Fatal(err)
		}
		err = as.DeleteAccount(ctx, sess.User.ID, DeleteAccountInput{Password: "wrong-password"})
		refused(t, err, ErrPasswordIncorrect, "password_incorrect", http.StatusForbidden)
	})

	t.Run("two-factor code", func(t *testing.T) {
		sess, err := g.SignIn(ctx, GoogleClaims{Sub: "xoa-mfa", Email: "xoa-mfa@example.com", EmailVerified: true}, "vi")
		if err != nil {
			t.Fatal(err)
		}
		enrol(t, as, ctx, sess.User.ID)
		err = as.DeleteAccount(ctx, sess.User.ID, DeleteAccountInput{Code: "000000"})
		refused(t, err, ErrMfaCodeIncorrect, "mfa_code_incorrect", http.StatusForbidden)
	})

	t.Run("typed email", func(t *testing.T) {
		sess, err := g.SignIn(ctx, GoogleClaims{Sub: "xoa-email", Email: "xoa-email@example.com", EmailVerified: true}, "vi")
		if err != nil {
			t.Fatal(err)
		}
		err = as.DeleteAccount(ctx, sess.User.ID, DeleteAccountInput{EmailConfirmation: "someone-else@example.com"})
		refused(t, err, ErrEmailConfirmationMismatch, "email_confirmation_mismatch", http.StatusBadRequest)
		// The typed address is compared without case or surrounding spaces.
		if err := as.DeleteAccount(ctx, sess.User.ID, DeleteAccountInput{EmailConfirmation: "  XOA-EMAIL@example.com "}); err != nil {
			t.Fatalf("matching address: %v", err)
		}
	})
}
