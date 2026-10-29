package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// browser opens a browser session for uid and answers the context of a
// request carrying its access token, as the bearer middleware and the
// handler's session meta leave it.
func (f *identityFixture) browser(t *testing.T, uid string) (context.Context, Session) {
	t.Helper()
	sess, _, err := f.auth.openSession(f.ctx, f.q, f.user(t, uid), "", "")
	if err != nil {
		t.Fatal(err)
	}
	return WithSessionMeta(f.bearer(t, sess), SessionMeta{UserAgent: "Firefox/140", IP: "10.0.0.9"}), sess
}

// native is the context of a request from the app's device session.
func (f *identityFixture) native(t *testing.T, d DesktopSession) context.Context {
	t.Helper()
	at, err := f.auth.minter.ParseAccessToken(d.AccessToken)
	if err != nil || at.Web {
		t.Fatalf("device token: %+v %v", at, err)
	}
	return WithSessionMeta(auth.WithAccessToken(f.ctx, at), SessionMeta{UserAgent: "UniChat/2.0 (iOS)", IP: "10.0.0.10"})
}

// googleOnly is a verified account that signs in only with Google.
func (f *identityFixture) googleOnly(t *testing.T, email string) db.User {
	t.Helper()
	u, err := f.q.CreateGoogleUser(f.ctx, db.CreateGoogleUserParams{
		ID: util.NewID(), Email: email, DisplayName: "Google", Locale: "vi",
		GoogleID: pgtype.Text{String: "sub-" + email, Valid: true}, GoogleEmail: pgtype.Text{String: email, Valid: true},
		EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// stepUpCode is the last step-up code mailed to addr.
func (f *identityFixture) stepUpCode(t *testing.T, addr string) string {
	t.Helper()
	var last mail.Message
	for _, m := range f.mailsTo(addr) {
		if m.Kind == mail.KindStepUpCode {
			last = m
		}
	}
	if last.Kind == "" {
		t.Fatalf("no step-up code mailed to %s; queued: %v", addr, f.mailsTo(addr))
	}
	return codeFrom(t, last)
}

// stepUpByMail asks for a code for action and trades it for a token.
func (f *identityFixture) stepUpByMail(t *testing.T, ctx context.Context, u db.User, action string) StepUpGrant {
	t.Helper()
	if err := f.auth.SendStepUpCode(ctx, u.ID, action); err != nil {
		t.Fatal(err)
	}
	g, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Code: f.stepUpCode(t, u.Email), Action: action})
	if err != nil || g.Method != ProofEmailCode {
		t.Fatalf("step-up by mail: %+v %v", g, err)
	}
	return g
}

// letNextCode moves uid's step-up codes a couple of minutes back, so the
// next one is not refused as asked too soon.
func (f *identityFixture) letNextCode(t *testing.T, uid string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE email_verification_codes SET created_at = created_at - interval '2 minutes'
		WHERE user_id = $1 AND purpose = 'step_up'`, uid); err != nil {
		t.Fatal(err)
	}
}

func (f *identityFixture) failures(t *testing.T, uid string) int {
	t.Helper()
	return int(f.user(t, uid).SecondFactorFailures)
}

func wantProofRequired(t *testing.T, err error, what string) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "proof_required" || ce.Status != http.StatusForbidden {
		t.Fatalf("%s: got %v, want 403 proof_required", what, err)
	}
}

func wantInvalid(t *testing.T, err error, what string) {
	t.Helper()
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("%s: got %v, want 400 invalid_request", what, err)
	}
}

func proofsOf(t *testing.T, err error) string {
	t.Helper()
	ce := wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	proofs, _ := ce.Fields["proofs"].([]string)
	return strings.Join(proofs, ",")
}

// Every change to how an account signs in, and every command that cannot be
// undone alone, takes a step-up token of the very session that asks (ADR
// 0049 §5, spec §3.7): none, one minted for another session, one sealed for
// another purpose and one that expired are all 403 proof_required — never
// 401, the caller is signed in. The token comes from POST /me/step-up,
// which takes only a proof the account has: its password or a mailed code
// on the web, never a provider token there; a wrong one is refused with its
// own code and counted against the second-factor lockout.
func TestSignInMethodChangesNeedAProof(t *testing.T) {
	f := newIdentityFixture(t)
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	u := registerVerified(t, f.q, f.auth, "proof@example.com", "Proof")
	ctx, _ := f.browser(t, u.ID)
	other, _ := f.browser(t, u.ID)

	_, err := f.auth.StepUp(ctx, u.ID, StepUpProof{})
	if got := proofsOf(t, err); got != "password,email_code" {
		t.Fatalf("proofs on the web: %q", got)
	}
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "not-it"})
	wantStatusCode(t, err, "password_incorrect", http.StatusForbidden)
	if n := f.failures(t, u.ID); n != 1 {
		t.Fatalf("a wrong password is a counted guess: %d", n)
	}
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Provider: &ProviderProof{Provider: ProviderApple, Token: "x", Nonce: "y"}})
	wantProofRequired(t, err, "a provider token on the web")
	_, err = f.auth.StepUp(f.ctx, u.ID, StepUpProof{Password: "password123"})
	wantProofRequired(t, err, "no bearer")
	grant, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"})
	if err != nil || grant.Method != ProofPassword || grant.Token == "" {
		t.Fatalf("step-up: %+v %v", grant, err)
	}
	if d := time.Until(grant.ExpiresAt); d < 9*time.Minute || d > 10*time.Minute+time.Second {
		t.Fatalf("token lives %v, want ten minutes", d)
	}
	if n := f.failures(t, u.ID); n != 0 {
		t.Fatalf("a right proof starts the count over: %d", n)
	}
	foreign, err := f.auth.StepUp(other, u.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := f.sealer.OpenFor(auth.PurposeStepUp, grant.Token)
	otherPurpose, _ := f.sealer.SealFor(auth.PurposeLinkToken, raw)

	commands := []struct {
		name string
		run  func(ctx context.Context, token string) error
	}{
		{"set up the second factor", func(c context.Context, tok string) error {
			_, err := f.auth.SetupTOTP(c, u.ID, tok)
			return err
		}},
		{"start a Google link", func(c context.Context, tok string) error {
			_, err := methods.StartLink(c, u.ID, ProviderGoogle, tok, "/settings?tab=security")
			return err
		}},
		{"unlink Google", func(c context.Context, tok string) error {
			_, err := methods.Unlink(c, u.ID, ProviderGoogle, tok)
			return err
		}},
		{"delete the account", func(c context.Context, tok string) error {
			return f.auth.DeleteAccount(c, u.ID, DeleteAccountInput{StepUpToken: tok})
		}},
		{"set the password with a token", func(c context.Context, tok string) error {
			_, err := methods.SetPassword(c, u.ID, PasswordInput{New: "another-password-1", StepUpToken: tok})
			return err
		}},
	}
	for _, c := range commands {
		for why, tok := range map[string]string{"no token": "", "another session's": foreign.Token, "another purpose's": otherPurpose, "garbage": "x"} {
			wantProofRequired(t, c.run(ctx, tok), c.name+" with "+why)
		}
	}
	// The app's link from Settings takes a token of the app's own session:
	// none, the browser session's or garbage is proof_required, and the
	// provider's token is not looked at.
	app := f.native(t, f.deviceSignIn(t, u.ID, "proof-app"))
	nonce := util.NewID()
	sheet := AppLink{Token: f.issuer.Token(t, appletest.Claims(appleBundle, "apple-proof", "proof@icloud.com", false, nonce)), Nonce: nonce}
	for why, tok := range map[string]string{"no token": "", "the browser session's": grant.Token, "garbage": "x"} {
		sheet.StepUpToken = tok
		_, err := methods.LinkFromApp(app, u.ID, ProviderApple, sheet)
		wantProofRequired(t, err, "an app link with "+why)
	}
	if got := f.user(t, u.ID); got.TotpSecret.Valid || got.DeletedAt.Valid || got.PasswordChangedAt.Valid || got.AppleID.Valid {
		t.Fatalf("a refused command wrote: %+v", got)
	}
	// Expired: the same token ten minutes on.
	f.auth.now = func() time.Time { return time.Now().Add(stepUpTokenTTL + time.Second) }
	wantProofRequired(t, commands[0].run(ctx, grant.Token), "an expired token")
	f.auth.now = time.Now
	// The right token, and it is not spent by use: one serves the window.
	for _, c := range commands[:3] {
		if err := c.run(ctx, grant.Token); err != nil {
			t.Fatalf("%s with its token: %v", c.name, err)
		}
	}
	// A browser token older than the account's last credential change is
	// refused before anything is weighed (401: the client refreshes).
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET credentials_revoked_at = now() + interval '1 hour' WHERE id = $1`, u.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"})
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
	wantStatusCode(t, commands[0].run(ctx, grant.Token), "invalid_token", http.StatusUnauthorized)
}

// Turning the second factor on is a sign-in method change like any other
// (ADR 0049 §5): a stolen session alone must not lock the owner out with a
// factor only the thief holds. Setup and confirm both take the step-up
// token; a code mailed for enable_mfa buys one as well as the password.
func TestMFAEnrolmentNeedsAProof(t *testing.T) {
	f := newIdentityFixture(t)
	u := registerVerified(t, f.q, f.auth, "enrol@example.com", "Enrol")
	ctx, _ := f.browser(t, u.ID)
	_, err := f.auth.SetupTOTP(ctx, u.ID, "")
	if got := proofsOf(t, err); got != "password,email_code" {
		t.Fatalf("setup without a proof: proofs %q", got)
	}
	if f.user(t, u.ID).TotpSecret.Valid {
		t.Fatal("a refused setup stored a secret")
	}
	g := f.stepUpByMail(t, ctx, u, mail.StepUpActionEnableMFA)
	setup, err := f.auth.SetupTOTP(ctx, u.ID, g.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.ConfirmTOTP(ctx, u.ID, totpNow(t, setup.Secret), "")
	wantProofRequired(t, err, "confirm without a proof")
	if f.user(t, u.ID).MfaEnabledAt.Valid {
		t.Fatal("a refused confirm turned MFA on")
	}
	if _, err := f.auth.ConfirmTOTP(ctx, u.ID, totpNow(t, setup.Secret), g.Token); err != nil {
		t.Fatal(err)
	}
	// From now on the factor is the only proof the account takes.
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"})
	if got := proofsOf(t, err); got != "totp" {
		t.Fatalf("proofs with MFA on: %q", got)
	}
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Code: "000000"})
	wantStatusCode(t, err, "mfa_code_incorrect", http.StatusForbidden)
	if g, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Code: totpNow(t, setup.Secret)}); err != nil || g.Method != ProofTOTP {
		t.Fatalf("TOTP step-up: %+v %v", g, err)
	}
	err = f.auth.SendStepUpCode(ctx, u.ID, mail.StepUpActionDeleteAccount)
	if got := proofsOf(t, err); got != "totp" {
		t.Fatalf("a mailed code on an MFA account: %q", got)
	}
}

// A step-up token is bound to the session that proved it (spec §3.7): once
// that session is signed out or revoked the token opens nothing (401, the
// session itself is gone), and no other session of the same account can
// present it. An app's token is bound to its device session the same way.
func TestStepUpTokenDiesWithItsSession(t *testing.T) {
	f := newIdentityFixture(t)
	u := registerVerified(t, f.q, f.auth, "dies@example.com", "Dies")
	ctx, sess := f.browser(t, u.ID)
	other, _ := f.browser(t, u.ID)
	g, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.SetupTOTP(other, u.ID, g.Token)
	wantProofRequired(t, err, "another session presenting it")
	if err := f.auth.Logout(f.ctx, sess.RefreshToken); err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.SetupTOTP(ctx, u.ID, g.Token)
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "password123"})
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)

	device := f.deviceSignIn(t, u.ID, "state-step-up")
	app := f.native(t, device)
	ng, err := f.auth.StepUp(app, u.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.SetupTOTP(other, u.ID, ng.Token)
	wantProofRequired(t, err, "a browser presenting the app's token")
	if err := f.desktop.Revoke(f.ctx, u.ID, device.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	_, err = f.auth.SetupTOTP(app, u.ID, ng.Token)
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
}

// A mailed step-up code proves the mailbox for one named action (spec §3.7):
// the mail says what it allows, where it was asked from and not to share
// it; it opens nothing for another action; it is never the development code
// (which still verifies an address); it is spent once used; and it goes out
// once a minute and five times a day.
func TestStepUpCodeNamesItsActionAndIgnoresTheDevCode(t *testing.T) {
	f := newIdentityFixture(t)
	renderer := mail.Renderer{AppURL: "http://localhost:3000"}
	f.auth.verification = NewVerificationService(f.q, renderer, f.out, "000000")
	u := f.googleOnly(t, "code@gmail.com")
	ctx, _ := f.browser(t, u.ID)

	wantInvalid(t, f.auth.SendStepUpCode(ctx, u.ID, "disable_mfa"), "an action nobody defined")
	if err := f.auth.SendStepUpCode(ctx, u.ID, mail.StepUpActionDeleteAccount); err != nil {
		t.Fatal(err)
	}
	m := f.mailOfKind(t, u.Email, mail.KindStepUpCode)
	for _, want := range []string{"xóa tài khoản", "Firefox/140", "10.0.0.9", "Không chia sẻ mã này"} {
		if !strings.Contains(m.Text, want) {
			t.Fatalf("the code mail misses %q: %s", want, m.Text)
		}
	}
	ce := wantStatusCode(t, f.auth.SendStepUpCode(ctx, u.ID, mail.StepUpActionDeleteAccount), "rate_limited", http.StatusTooManyRequests)
	if ce.Fields["retry_after"] == nil {
		t.Fatalf("too soon names no wait: %+v", ce.Fields)
	}
	code := f.stepUpCode(t, u.Email)
	_, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Code: "000000", Action: mail.StepUpActionDeleteAccount})
	wantStatusCode(t, err, "step_up_code_incorrect", http.StatusForbidden)
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Code: code, Action: mail.StepUpActionSetPassword})
	wantStatusCode(t, err, "step_up_code_incorrect", http.StatusForbidden)
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Code: code, Action: "nothing"})
	wantInvalid(t, err, "a code with no action")
	if n := f.failures(t, u.ID); n != 2 {
		t.Fatalf("wrong codes are counted guesses: %d", n)
	}
	g, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Code: code, Action: mail.StepUpActionDeleteAccount})
	if err != nil || g.Method != ProofEmailCode {
		t.Fatalf("the right code for its action: %+v %v", g, err)
	}
	_, err = f.auth.StepUp(ctx, u.ID, StepUpProof{Code: code, Action: mail.StepUpActionDeleteAccount})
	wantStatusCode(t, err, "step_up_code_incorrect", http.StatusForbidden)
	// The token a code buys serves the action its mail named, and nothing
	// else: the owner who read the code out for one thing gave no other.
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	_, err = methods.SetPassword(ctx, u.ID, PasswordInput{New: "not-what-the-mail-said", StepUpToken: g.Token})
	wantProofRequired(t, err, "a delete_account code's token setting a password")
	_, err = methods.Unlink(ctx, u.ID, ProviderGoogle, g.Token)
	wantProofRequired(t, err, "a delete_account code's token unlinking Google")
	wantProofRequired(t, f.auth.proveOwner(ctx, u.ID, OwnerProof{StepUpToken: g.Token}), "a delete_account code's token handing an organization over")
	if err := f.auth.proveDeletion(ctx, f.user(t, u.ID), DeleteAccountInput{StepUpToken: g.Token}); err != nil {
		t.Fatalf("the token for the action its code named: %v", err)
	}
	if got := f.user(t, u.ID); got.PasswordHash.Valid || !got.GoogleID.Valid {
		t.Fatalf("a refused command wrote: %+v", got)
	}

	// Five a day: four more sent hours ago, and the sixth waits.
	for i := 0; i < 4; i++ {
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO email_verification_codes (id, user_id, code_hash, expires_at, created_at, purpose, action)
			VALUES ($1, $2, 'x', now() - interval '1 hour', now() - interval '2 hours', 'step_up', 'delete_account')`, util.NewID(), u.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE email_verification_codes SET created_at = now() - interval '3 hours' WHERE user_id = $1 AND code_hash <> 'x'`, u.ID); err != nil {
		t.Fatal(err)
	}
	ce = wantStatusCode(t, f.auth.SendStepUpCode(ctx, u.ID, mail.StepUpActionDeleteAccount), "rate_limited", http.StatusTooManyRequests)
	if retry, _ := ce.Fields["retry_after"].(int); retry < 20*3600 {
		t.Fatalf("the day's cap waits for the oldest code to leave the window: %v", ce.Fields)
	}
	// The cleanup that runs with every verification mail keeps a day of them.
	if err := f.q.DeleteExpiredEmailVerificationCodes(f.ctx); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM email_verification_codes WHERE user_id = $1 AND purpose = 'step_up'`, u.ID); n != 5 {
		t.Fatalf("step-up codes of the day kept: %d", n)
	}

	// The development code still verifies an address: it is configured, and
	// only the step-up refuses it.
	reg, err := f.auth.Register(f.ctx, "dev-code@example.com", "password123", "Dev", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.auth.verification.Confirm(f.ctx, reg.User.ID, "000000"); err != nil {
		t.Fatalf("the development code verifies an address: %v", err)
	}
}

// An account never loses its last way in (spec §3.7): a Google-only
// account cannot unlink Google until it has a password; with one it can,
// and then the subject is remembered as unlinked, every other session is
// signed out, and the owner is told.
func TestTheLastSignInMethodCannotBeRemoved(t *testing.T) {
	f := newIdentityFixture(t)
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	u := f.googleOnly(t, "last@gmail.com")
	ctx, own := f.browser(t, u.ID)
	_, otherSess := f.browser(t, u.ID)
	g := f.stepUpByMail(t, ctx, u, mail.StepUpActionUnlinkGoogle)

	_, err := methods.Unlink(ctx, u.ID, ProviderGoogle, g.Token)
	wantStatusCode(t, err, "sign_in_method_last", http.StatusConflict)
	if !f.user(t, u.ID).GoogleID.Valid {
		t.Fatal("the last way in was removed")
	}
	f.letNextCode(t, u.ID)
	set, err := methods.SetPassword(ctx, u.ID, PasswordInput{New: "first-password-1", StepUpToken: f.stepUpByMail(t, ctx, u, mail.StepUpActionSetPassword).Token})
	if err != nil || !set.Methods.PasswordSet || !set.Methods.Google.Linked {
		t.Fatalf("set a password: %+v %v", set.Methods, err)
	}
	if !f.live(t, "refresh_tokens", f.tokenID(t, otherSess)) {
		t.Fatal("setting a first password signs nobody out")
	}
	out, err := methods.Unlink(ctx, u.ID, ProviderGoogle, g.Token)
	if err != nil || out.Methods.Google.Linked || !out.Methods.PasswordSet {
		t.Fatalf("unlink with a password left: %+v %v", out.Methods, err)
	}
	got := f.user(t, u.ID)
	if got.GoogleID.Valid || got.GoogleUnlinkedSub.String != "sub-last@gmail.com" || !got.CredentialsRevokedAt.Valid {
		t.Fatalf("after the unlink: %+v", got)
	}
	if f.live(t, "refresh_tokens", f.tokenID(t, otherSess)) {
		t.Fatal("an unlink signs every other session out")
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'provider' = 'google' AND metadata::jsonb->>'via' = 'settings'`, audit.ActionAuthSignInMethodUnlinked, u.ID); n != 1 {
		t.Fatalf("unlink audit rows: %d", n)
	}
	told := false
	for _, m := range f.mailsTo(u.Email) {
		told = told || (m.Kind == mail.KindSignInMethodChanged && strings.Contains(m.Subject, "Google đã được gỡ"))
	}
	if !told {
		t.Fatalf("the owner is not told of the unlink: %v", f.mailsTo(u.Email))
	}
	// Unlinking what is not linked writes nothing and answers how it is. The
	// unlink marked the account, so the session that made it refreshes first:
	// its older access token is refused on sensitive commands.
	refreshed, err := f.auth.Refresh(f.ctx, own.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	ctx = f.bearer(t, refreshed)
	before := f.count(t, `SELECT count(*) FROM audit_events WHERE actor_id = $1`, u.ID)
	if again, err := methods.Unlink(ctx, u.ID, ProviderGoogle, g.Token); err != nil || again.Methods.Google.Linked {
		t.Fatalf("unlink twice: %+v %v", again.Methods, err)
	}
	if after := f.count(t, `SELECT count(*) FROM audit_events WHERE actor_id = $1`, u.ID); after != before {
		t.Fatalf("a no-op unlink wrote %d audit rows", after-before)
	}
}

// tokenID is the id of sess's refresh token row.
func (f *identityFixture) tokenID(t *testing.T, sess Session) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM refresh_tokens WHERE token_hash = $1`, hashToken(sess.RefreshToken)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// An account whose own address is Apple's private relay, on either of its
// domains, reaches its owner only while Apple keeps relaying for this app, so
// Apple stays linked even when a password would still sign it in (spec §3.7).
func TestARelayAccountKeepsApple(t *testing.T) {
	for _, relay := range []string{"k2x9@privaterelay.appleid.com", "k2x9@private.icloud.com"} {
		t.Run(relay, func(t *testing.T) {
			f := newIdentityFixture(t)
			methods := NewSignInMethodsService(f.pool, f.q, f.auth)
			device, err := f.appleSignIn(t, "apple-relay", relay, true)
			if err != nil {
				t.Fatal(err)
			}
			u := f.user(t, device.AccountID)
			ctx, _ := f.browser(t, u.ID)
			g := f.stepUpByMail(t, ctx, u, mail.StepUpActionSetPassword)
			set, err := methods.SetPassword(ctx, u.ID, PasswordInput{New: "relay-password-1", StepUpToken: g.Token})
			if err != nil || !set.Methods.AccountEmailIsRelay || !set.Methods.Apple.PrivateRelay {
				t.Fatalf("set a password: %+v %v", set.Methods, err)
			}
			byPassword, err := f.auth.StepUp(ctx, u.ID, StepUpProof{Password: "relay-password-1"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = methods.Unlink(ctx, u.ID, ProviderApple, byPassword.Token)
			wantStatusCode(t, err, "sign_in_method_relay_email", http.StatusConflict)
			if !f.user(t, u.ID).AppleID.Valid {
				t.Fatal("Apple was unlinked from a relay account")
			}
			// The app may prove such an account with a fresh Apple token instead
			// of a mail that only the relay delivers.
			app := f.native(t, device)
			m, err := f.auth.SignInMethods(app, u.ID)
			if err != nil || strings.Join(m.Proofs, ",") != "password,email_code,apple" {
				t.Fatalf("app proofs: %v %v", m.Proofs, err)
			}
		})
	}
}

// A password change signs every other session out (ADR 0049 §5): the
// browser sessions, the app's device sessions with their pushes and Office
// leases, every MCP grant; browser tokens issued before it are refused on
// sensitive commands. The session that changed it stays. Setting the first
// password takes nothing away.
func TestPasswordChangeRevokesEveryOtherSession(t *testing.T) {
	f := newIdentityFixture(t)
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	u := registerVerified(t, f.q, f.auth, "change@example.com", "Change")
	ctx, current := f.browser(t, u.ID)
	_, other := f.browser(t, u.ID)
	device := f.deviceSignIn(t, u.ID, "state-change")
	push := f.push(t, u.ID, device.SessionID)
	lease := f.lease(t, u.ID, device.DeviceSessionID)

	_, err := methods.SetPassword(ctx, u.ID, PasswordInput{New: "brand-new-pass-1", Current: "wrong"})
	wantStatusCode(t, err, "password_incorrect", http.StatusForbidden)
	_, err = methods.SetPassword(ctx, u.ID, PasswordInput{New: "brand-new-pass-1"})
	wantProofRequired(t, err, "a change without the current password")
	_, err = methods.SetPassword(ctx, u.ID, PasswordInput{New: "short", Current: "password123"})
	wantInvalid(t, err, "a weak password")
	if !f.live(t, "refresh_tokens", f.tokenID(t, other)) {
		t.Fatal("a refused change signed someone out")
	}

	out, err := methods.SetPassword(ctx, u.ID, PasswordInput{New: "brand-new-pass-1", Current: "password123"})
	if err != nil || !out.Methods.PasswordSet || out.Methods.PasswordChangedAt == nil {
		t.Fatalf("change: %+v %v", out.Methods, err)
	}
	if !f.live(t, "refresh_tokens", f.tokenID(t, current)) {
		t.Fatal("the session that changed the password must stay")
	}
	if f.live(t, "refresh_tokens", f.tokenID(t, other)) || f.live(t, "device_sessions", device.DeviceSessionID) ||
		f.live(t, "push_subscriptions", push) || f.live(t, "office_offline_leases", lease) {
		t.Fatal("every other session, its pushes and its leases end")
	}
	if !f.user(t, u.ID).CredentialsRevokedAt.Valid {
		t.Fatal("older browser tokens must be refused on sensitive commands")
	}
	if _, err := f.auth.Login(f.ctx, u.Email, "password123"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the old password: %v", err)
	}
	if _, err := f.auth.Login(f.ctx, u.Email, "brand-new-pass-1"); err != nil {
		t.Fatalf("the new password: %v", err)
	}
	var meta map[string]any
	var raw []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT metadata FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'reason' = 'password_changed'`, audit.ActionAuthSessionRevoked, u.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(raw, &meta)
	if meta["scope"] != "others" || meta["device_sessions"] != float64(1) {
		t.Fatalf("session revoke audit: %v", meta)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'via' = 'settings'`,
		audit.ActionAuthPasswordChanged, u.ID); n != 1 {
		t.Fatalf("password_changed rows: %d", n)
	}
	m := f.mailOfKind(t, u.Email, mail.KindSignInMethodChanged)
	if !strings.Contains(m.Text, "Các thiết bị khác đã được đăng xuất") {
		t.Fatalf("the owner's notice: %s", m.Text)
	}

	// The current password is a proof only while the session asking is live,
	// and only on an account without a second factor: with one on, that
	// factor alone proves the owner (ADR 0049 §5), through a step-up token.
	gone, err := f.auth.Login(f.ctx, u.Email, "brand-new-pass-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.auth.Logout(f.ctx, gone.RefreshToken); err != nil {
		t.Fatal(err)
	}
	_, err = methods.SetPassword(f.bearer(t, gone), u.ID, PasswordInput{New: "signed-out-pass-1", Current: "brand-new-pass-1"})
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
	mfa, secret, _ := f.mfaAccount(t, "change-mfa@example.com")
	mctx, _ := f.browser(t, mfa.ID)
	_, other = f.browser(t, mfa.ID)
	_, err = methods.SetPassword(mctx, mfa.ID, PasswordInput{New: "brand-new-pass-1", Current: "password123"})
	if got := proofsOf(t, err); got != ProofTOTP {
		t.Fatalf("an account with a second factor changing its password by the current one: proofs %q", got)
	}
	if !f.live(t, "refresh_tokens", f.tokenID(t, other)) || f.user(t, mfa.ID).CredentialsRevokedAt.Valid {
		t.Fatal("a refused change signed someone out")
	}
	g, err := f.auth.StepUp(mctx, mfa.ID, StepUpProof{Code: totpNow(t, secret)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := methods.SetPassword(mctx, mfa.ID, PasswordInput{New: "brand-new-pass-1", StepUpToken: g.Token}); err != nil {
		t.Fatalf("with the second factor's step-up: %v", err)
	}
}

// The doors kept only for shipped apps — the legacy proofs they send in
// place of a step-up token, and the legacy Apple route POST
// /auth/apple/native with its old codes (AppleAuthService.SignIn) — are
// reviewed together (ADR 0049 §8, spec §3.6): once the date passes this
// fails until they are removed or the date is moved with a reason.
func TestLegacyProofDoorsAreReviewed(t *testing.T) {
	by, err := time.Parse("2006-01-02", legacyProofReviewBy)
	if err != nil {
		t.Fatal(err)
	}
	if time.Now().After(by.Add(24 * time.Hour)) {
		t.Fatalf("the shipped apps' doors (POST /me/delete password/code/email_confirmation, an owner's password on a hand-over, POST /auth/apple/native) were due for review on %s", legacyProofReviewBy)
	}
}

// Deleting the account takes a step-up token bought with any proof the
// account has (ADR 0049 §5): a password, a mailed code (an account that
// signs in only with a provider), the second factor, and on the app a fresh
// token from the provider's own sheet, which must be the linked subject's
// and fresh. Without a token or a legacy proof it is proof_required.
func TestDeleteAccountTakesEveryProofTheAccountHas(t *testing.T) {
	f := newIdentityFixture(t)
	del := func(ctx context.Context, u db.User, token string) {
		t.Helper()
		if err := f.auth.DeleteAccount(ctx, u.ID, DeleteAccountInput{StepUpToken: token}); err != nil {
			t.Fatalf("delete %s: %v", u.Email, err)
		}
		if !f.user(t, u.ID).DeletedAt.Valid {
			t.Fatalf("%s not deleted", u.Email)
		}
	}
	pw := registerVerified(t, f.q, f.auth, "del-password@example.com", "P")
	ctx, _ := f.browser(t, pw.ID)
	wantProofRequired(t, f.auth.DeleteAccount(ctx, pw.ID, DeleteAccountInput{}), "no proof at all")
	g, err := f.auth.StepUp(ctx, pw.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	del(ctx, pw, g.Token)

	gu := f.googleOnly(t, "del-google@gmail.com")
	ctx, _ = f.browser(t, gu.ID)
	del(ctx, gu, f.stepUpByMail(t, ctx, gu, mail.StepUpActionDeleteAccount).Token)

	mfa, secret, _ := f.mfaAccount(t, "del-mfa@example.com")
	ctx, _ = f.browser(t, mfa.ID)
	g, err = f.auth.StepUp(ctx, mfa.ID, StepUpProof{Code: totpNow(t, secret)})
	if err != nil {
		t.Fatal(err)
	}
	del(ctx, mfa, g.Token)

	device, err := f.appleSignIn(t, "apple-del", "del@icloud.com", false)
	if err != nil {
		t.Fatal(err)
	}
	au := f.user(t, device.AccountID)
	app := f.native(t, device)
	sheet := func(sub string, iat time.Time) *ProviderProof {
		nonce := util.NewID()
		c := appletest.Claims(appleBundle, sub, "del@icloud.com", false, nonce)
		c["iat"] = iat.Unix()
		return &ProviderProof{Provider: ProviderApple, Token: f.issuer.Token(t, c), Nonce: nonce}
	}
	for why, p := range map[string]*ProviderProof{
		"another Apple ID":    sheet("apple-someone-else", time.Now()),
		"an old sign-in":      sheet("apple-del", time.Now().Add(-10*time.Minute)),
		"a nonce not its own": {Provider: ProviderApple, Token: sheet("apple-del", time.Now()).Token, Nonce: "other"},
	} {
		_, err := f.auth.StepUp(app, au.ID, StepUpProof{Provider: p})
		if ce := wantStatusCode(t, err, "provider_token_invalid", http.StatusForbidden); ce.Code == "" {
			t.Fatal(why)
		}
	}
	g, err = f.auth.StepUp(app, au.ID, StepUpProof{Provider: sheet("apple-del", time.Now())})
	if err != nil || g.Method != ProofApple {
		t.Fatalf("Apple step-up: %+v %v", g, err)
	}
	del(app, au, g.Token)
}

// Handing an organization over takes the owner's proof (ADR 0049 §5): a
// step-up token from any proof the owner has — an owner who signs in only
// with Google proves it with a mailed code, which used to be a dead end
// (password_required) — or the password shipped apps send. Without either
// it is proof_required, never password_required. The invitation switch
// that hands the old organization over takes the same proof.
func TestHandOversTakeEveryProofTheOwnerHas(t *testing.T) {
	f := newIdentityFixture(t)
	orgs := NewOrganizationService(f.pool, f.q)
	members := NewOrganizationMemberService(f.pool, f.q, orgs)
	members.SetStepUp(f.auth)
	org := func(owner db.User, slug string) (db.Organization, db.User) {
		t.Helper()
		o, err := orgs.Create(f.ctx, owner.ID, "Org "+slug, slug)
		if err != nil {
			t.Fatal(err)
		}
		heir := registerVerified(t, f.q, f.auth, slug+"-heir@example.com", "Heir")
		if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: o.ID, UserID: heir.ID, Role: OrgRoleAdmin}); err != nil {
			t.Fatal(err)
		}
		return o, heir
	}
	transfer := func(ctx context.Context, owner db.User, o db.Organization, heir db.User, p OwnerProof) error {
		_, err := members.TransferOwnership(ctx, owner.ID, o.ID, heir.ID, p)
		return err
	}

	gu := f.googleOnly(t, "owner-google@gmail.com")
	o, heir := org(gu, "hand-google")
	ctx, _ := f.browser(t, gu.ID)
	if got := proofsOf(t, transfer(ctx, gu, o, heir, OwnerProof{})); got != "email_code" {
		t.Fatalf("a Google-only owner's proofs: %q", got)
	}
	wantProofRequired(t, transfer(ctx, gu, o, heir, OwnerProof{Password: "anything"}), "a password on an account without one")
	if err := transfer(ctx, gu, o, heir, OwnerProof{StepUpToken: f.stepUpByMail(t, ctx, gu, mail.StepUpActionTransferOwnership).Token}); err != nil {
		t.Fatalf("a Google-only owner with a mailed code: %v", err)
	}

	mfa, secret, _ := f.mfaAccount(t, "owner-mfa@example.com")
	o, heir = org(mfa, "hand-mfa")
	ctx, _ = f.browser(t, mfa.ID)
	g, err := f.auth.StepUp(ctx, mfa.ID, StepUpProof{Code: totpNow(t, secret)})
	if err != nil {
		t.Fatal(err)
	}
	if err := transfer(ctx, mfa, o, heir, OwnerProof{StepUpToken: g.Token}); err != nil {
		t.Fatalf("an MFA owner with TOTP: %v", err)
	}

	pw := registerVerified(t, f.q, f.auth, "owner-pw@example.com", "PW")
	o, heir = org(pw, "hand-pw")
	ctx, _ = f.browser(t, pw.ID)
	wantStatusCode(t, transfer(ctx, pw, o, heir, OwnerProof{Password: "wrong"}), "password_incorrect", http.StatusForbidden)
	if n := f.failures(t, pw.ID); n != 1 {
		t.Fatalf("a wrong legacy password is a counted guess: %d", n)
	}
	if err := transfer(ctx, pw, o, heir, OwnerProof{Password: "password123"}); err != nil {
		t.Fatalf("the legacy password: %v", err)
	}

	// The switch: an owner invited elsewhere hands the organization over.
	sw := registerVerified(t, f.q, f.auth, "owner-switch@example.com", "Switch")
	o, heir = org(sw, "hand-switch")
	ws := NewWorkspaceService(f.pool, f.q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ws.SetStepUp(f.auth)
	founder := registerVerified(t, f.q, f.auth, "switch-founder@example.com", "Founder")
	target, err := orgs.Create(f.ctx, founder.ID, "Đích", "hand-target")
	if err != nil {
		t.Fatal(err)
	}
	invMembers := NewOrganizationMemberService(f.pool, f.q, orgs)
	invMembers.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	invs, _, err := invMembers.InviteToOrg(f.ctx, founder.ID, target.ID, []string{sw.Email}, OrgRoleMember, nil)
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite: %v %v", invs, err)
	}
	ctx, _ = f.browser(t, sw.ID)
	resolve := []SwitchResolution{{OrganizationID: o.ID, Action: SwitchActionTransfer, TransferToUserID: heir.ID}}
	_, err = ws.AcceptInvite(ctx, sw.ID, invs[0].Token, resolve)
	wantProofRequired(t, err, "a switch without a proof")
	resolve[0].StepUpToken = f.stepUpByMail(t, ctx, sw, mail.StepUpActionTransferOwnership).Token
	if _, err := ws.AcceptInvite(ctx, sw.ID, invs[0].Token, resolve); err != nil {
		t.Fatalf("a switch with a step-up token: %v", err)
	}
}
