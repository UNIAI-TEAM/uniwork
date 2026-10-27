package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// mfaAccount is a verified password account with the second factor on, the
// way the settings screen enrols it.
func (f *identityFixture) mfaAccount(t *testing.T, email string) (db.User, string, []string) {
	t.Helper()
	u := registerVerified(t, f.q, f.auth, email, "Hai lớp")
	secret, codes := enrol(t, f.auth, f.ctx, u.ID)
	return f.user(t, u.ID), secret, codes
}

// challenge signs in with the password and returns the web challenge token.
func (f *identityFixture) challenge(t *testing.T, email string) string {
	t.Helper()
	first, err := f.auth.Login(f.ctx, email, "password123")
	if err != nil || !first.MFAPending() {
		t.Fatalf("password step: %+v %v", first, err)
	}
	return first.MFAToken
}

func totpNow(t *testing.T, secret string) string {
	t.Helper()
	code, err := auth.TOTPCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return code
}

// A challenge token is bound to the channel it was minted for (ADR 0047 §4):
// the browser's second step takes a web one, and a token minted before
// tokens named a channel reads as web. One minted for the app is refused
// like a wrong code, and costs nothing from the lockout: it never reached
// the account.
func TestMFAChallengeIsBoundToItsChannel(t *testing.T) {
	f := newIdentityFixture(t)
	u, secret, _ := f.mfaAccount(t, "channel@example.com")

	native, err := f.auth.minter.MintMFA(auth.MFAChallenge{UserID: u.ID, Channel: auth.MFAChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.auth.VerifyMFA(f.ctx, native, totpNow(t, secret)); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a native challenge on the web step: %v, want invalid_credentials", err)
	}
	if got := f.user(t, u.ID); got.SecondFactorFailures != 0 {
		t.Fatalf("a refused channel counted as a guess: %d", got.SecondFactorFailures)
	}

	web := f.challenge(t, "channel@example.com")
	if c, err := f.auth.minter.ParseMFA(web); err != nil || c.Channel != auth.MFAChannelWeb || c.PendingLink != "" {
		t.Fatalf("the password step's challenge: %+v %v", c, err)
	}
	if sess, err := f.auth.VerifyMFA(f.ctx, web, totpNow(t, secret)); err != nil || sess.RefreshToken == "" {
		t.Fatalf("a web challenge: %+v %v", sess, err)
	}

	// The shape of a challenge minted before channels existed.
	legacy, err := f.auth.minter.MintMFA(auth.MFAChallenge{UserID: u.ID})
	if err != nil {
		t.Fatal(err)
	}
	if sess, err := f.auth.VerifyMFA(f.ctx, legacy, totpNow(t, secret)); err != nil || sess.RefreshToken == "" {
		t.Fatalf("a challenge without a channel reads as web: %+v %v", sess, err)
	}
}

// Ten wrong second factors in a row lock the factor for fifteen minutes and
// tell the owner once (ADR 0047 §4, spec §3.3). While locked nothing is
// checked — the right code, a fresh challenge, a recovery code: all 429 with
// retry_after, and the recovery code is not spent. A right code after the
// lockout starts the count over.
func TestSecondFactorLocksAfterTenFailures(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Firefox/140", IP: "10.0.0.7"})
	u, secret, codes := f.mfaAccount(t, "lock@example.com")
	token := f.challenge(t, "lock@example.com")

	locked := func(t *testing.T, err error) {
		t.Helper()
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "second_factor_locked" || ce.Status != http.StatusTooManyRequests || !errors.Is(err, ErrSecondFactorLocked) {
			t.Fatalf("want 429 second_factor_locked, got %v", err)
		}
		retry, _ := ce.Fields["retry_after"].(int)
		if retry < 1 || retry > int(secondFactorLockout/time.Second) {
			t.Fatalf("retry_after = %v, want 1..%d", ce.Fields["retry_after"], int(secondFactorLockout/time.Second))
		}
	}

	for i := 1; i < secondFactorMaxFailures; i++ {
		if _, err := f.auth.VerifyMFA(ctx, token, "000000"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("wrong code %d: %v", i, err)
		}
		if got := f.user(t, u.ID); got.SecondFactorFailures != int32(i) || got.SecondFactorLockedUntil.Valid {
			t.Fatalf("after %d wrong codes: failures %d, locked %v", i, got.SecondFactorFailures, got.SecondFactorLockedUntil)
		}
	}
	notices := func() int {
		n := 0
		for _, m := range f.mailsTo("lock@example.com") {
			if m.Kind == mail.KindSignInMethodChanged {
				n++
			}
		}
		return n
	}
	if notices() != 0 {
		t.Fatal("no notice before the lockout")
	}
	// The tenth starts the lockout.
	_, err := f.auth.VerifyMFA(ctx, token, "999999")
	locked(t, err)
	got := f.user(t, u.ID)
	if !got.SecondFactorLockedUntil.Valid || got.SecondFactorFailures != 0 {
		t.Fatalf("the tenth wrong code locks and starts the count over: %+v", got)
	}
	if left := time.Until(got.SecondFactorLockedUntil.Time); left < secondFactorLockout-time.Minute || left > secondFactorLockout {
		t.Fatalf("locked for %v, want about %v", left, secondFactorLockout)
	}
	notice := f.mailOfKind(t, "lock@example.com", mail.KindSignInMethodChanged)
	if notice.UserID != u.ID || !strings.Contains(notice.Subject, "Tạm dừng") || !strings.Contains(notice.Text, "15 phút") || !strings.Contains(notice.Text, "Firefox/140") || !strings.Contains(notice.Text, "10.0.0.7") {
		t.Fatalf("the owner is told, with the length and where from: %+v", notice)
	}

	// Locked: nothing is checked, whatever is presented.
	_, err = f.auth.VerifyMFA(ctx, token, totpNow(t, secret))
	locked(t, err)
	_, err = f.auth.VerifyMFA(ctx, f.challenge(t, "lock@example.com"), totpNow(t, secret))
	locked(t, err)
	_, err = f.auth.VerifyMFA(ctx, token, codes[0])
	locked(t, err)
	if got := f.user(t, u.ID); len(got.MfaRecoveryCodes) != len(codes) {
		t.Fatalf("a recovery code was spent while locked: %d left of %d", len(got.MfaRecoveryCodes), len(codes))
	}
	if n := notices(); n != 1 {
		t.Fatalf("%d notices, want one per lockout", n)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'reason' = 'second_factor_locked'`, audit.ActionAuthLoginFailed, u.ID); n != 3 {
		t.Fatalf("%d refusals while locked audited, want 3", n)
	}

	// The lockout ends: the right code signs in and the count is clear.
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET second_factor_locked_until = now() - interval '1 second' WHERE id = $1`, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.auth.VerifyMFA(ctx, token, "000000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a wrong code after the lockout: %v", err)
	}
	if sess, err := f.auth.VerifyMFA(ctx, token, totpNow(t, secret)); err != nil || sess.RefreshToken == "" {
		t.Fatalf("the right code after the lockout: %+v %v", sess, err)
	}
	if got := f.user(t, u.ID); got.SecondFactorFailures != 0 || got.SecondFactorLockedUntil.Valid {
		t.Fatalf("a right code starts the count over: %+v", got)
	}
}

// An address that resolves to a link into an account with a second factor
// is linked only once that factor passes (ADR 0047 §2, spec §3.3): the
// challenge carries the identity, nothing is written before, and the link
// commits with the session. Resolved again at that point, an identity that
// no longer links into this account is skipped and the sign-in goes on.
func TestLinkWaitsForTheSecondFactor(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Safari/18", IP: "10.0.0.8"})
	u, secret, _ := f.mfaAccount(t, "mfa@gmail.com")

	res, err := f.google.SignIn(ctx, GoogleClaims{Sub: "sub-mfa", Email: "mfa@gmail.com", EmailVerified: true, Picture: "https://img/m.png"}, "vi")
	if err != nil || !res.Session.MFAPending() || res.Session.RefreshToken != "" {
		t.Fatalf("want the challenge: %+v %v", res, err)
	}
	ch, err := f.auth.minter.ParseMFA(res.Session.MFAToken)
	if err != nil || ch.Channel != auth.MFAChannelWeb || ch.PendingLink == "" {
		t.Fatalf("the challenge carries the pending link: %+v %v", ch, err)
	}
	if _, err := f.sealer.OpenFor(auth.PurposeSignInTicket, ch.PendingLink); err == nil {
		t.Fatal("the pending link opens as another purpose")
	}
	if got := f.user(t, u.ID); got.GoogleID.Valid || f.linkAudits(t, u.ID, ProviderGoogle, "email_match") != 0 {
		t.Fatalf("nothing is linked before the second factor: %+v", got)
	}
	if _, err := f.auth.VerifyMFA(ctx, res.Session.MFAToken, "000000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong code: %v", err)
	}
	if f.user(t, u.ID).GoogleID.Valid {
		t.Fatal("a wrong second factor linked the identity")
	}

	sess, err := f.auth.VerifyMFA(ctx, res.Session.MFAToken, totpNow(t, secret))
	if err != nil || sess.RefreshToken == "" || sess.LinkSkipped != "" {
		t.Fatalf("the second factor passes: %+v %v", sess, err)
	}
	got := f.user(t, u.ID)
	if got.GoogleID.String != "sub-mfa" || got.GoogleEmail.String != "mfa@gmail.com" || !got.GoogleLinkedAt.Valid || got.AvatarUrl.String != "https://img/m.png" {
		t.Fatalf("linked with the session: %+v", got)
	}
	if sess.User.GoogleID.String != "sub-mfa" {
		t.Fatalf("the session answers the linked account: %+v", sess.User)
	}
	if f.linkAudits(t, u.ID, ProviderGoogle, "email_match") != 1 {
		t.Fatal("the link is audited as an email match")
	}
	if notice := f.mailOfKind(t, "mfa@gmail.com", mail.KindSignInMethodChanged); !strings.Contains(notice.Text, "Safari/18") {
		t.Fatalf("the owner hears of the link: %+v", notice)
	}
	// The same challenge again (a second tab) links nothing twice.
	if again, err := f.auth.VerifyMFA(ctx, res.Session.MFAToken, totpNow(t, secret)); err != nil || again.LinkSkipped != "" {
		t.Fatalf("the same challenge twice: %+v %v", again, err)
	}
	if f.linkAudits(t, u.ID, ProviderGoogle, "email_match") != 1 {
		t.Fatal("linked twice")
	}

	// The subject went to another account while the challenge was out: the
	// sign-in goes on, the link is skipped and says why.
	taken, takenSecret, _ := f.mfaAccount(t, "taken@gmail.com")
	res, err = f.google.SignIn(ctx, GoogleClaims{Sub: "sub-taken", Email: "taken@gmail.com", EmailVerified: true}, "vi")
	if err != nil || !res.Session.MFAPending() {
		t.Fatalf("challenge: %+v %v", res, err)
	}
	if _, err := f.q.CreateGoogleUser(f.ctx, db.CreateGoogleUserParams{ID: "01TAKENMEANWHILE", Email: "elsewhere@gmail.com", DisplayName: "E", GoogleID: pgtype.Text{String: "sub-taken", Valid: true}, EmailVerified: true, Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	sess, err = f.auth.VerifyMFA(ctx, res.Session.MFAToken, totpNow(t, takenSecret))
	if err != nil || sess.RefreshToken == "" || sess.User.ID != taken.ID || sess.LinkSkipped != linkSkippedTaken {
		t.Fatalf("taken meanwhile: %+v %v", sess, err)
	}
	if f.user(t, taken.ID).GoogleID.Valid || f.linkAudits(t, taken.ID, ProviderGoogle, "email_match") != 0 {
		t.Fatal("a taken identity was linked")
	}

	// The account linked another Google account meanwhile: the resolver's
	// own refusal is the reason.
	other, otherSecret, _ := f.mfaAccount(t, "other@gmail.com")
	res, err = f.google.SignIn(ctx, GoogleClaims{Sub: "sub-other", Email: "other@gmail.com", EmailVerified: true}, "vi")
	if err != nil || !res.Session.MFAPending() {
		t.Fatalf("challenge: %+v %v", res, err)
	}
	if _, err := f.q.LinkGoogleAccount(f.ctx, db.LinkGoogleAccountParams{ID: other.ID, GoogleID: pgtype.Text{String: "sub-settings", Valid: true}, GoogleEmail: pgtype.Text{String: "other@gmail.com", Valid: true}}); err != nil {
		t.Fatal(err)
	}
	sess, err = f.auth.VerifyMFA(ctx, res.Session.MFAToken, totpNow(t, otherSecret))
	if err != nil || sess.RefreshToken == "" || sess.LinkSkipped != "sign_in_account_conflict" {
		t.Fatalf("linked elsewhere meanwhile: %+v %v", sess, err)
	}
	if got := f.user(t, other.ID); got.GoogleID.String != "sub-settings" {
		t.Fatalf("the account's own link was overwritten: %+v", got)
	}
}

// An account that never proved its address cannot set up a second factor
// (ADR 0047 §2): whoever registered someone else's address must not be able
// to plant anything that outlives the owner's reclaim. A secret planted
// before the gate existed is not turned on either. The link half of the rule
// comes with the sign-in methods.
func TestUnverifiedAccountsCannotEnrolMFAOrLink(t *testing.T) {
	f := newIdentityFixture(t)
	reg, err := f.auth.Register(f.ctx, "unproved@example.com", "password123", "Chưa xác minh", "vi")
	if err != nil {
		t.Fatal(err)
	}
	uid := reg.User.ID
	if _, err := f.auth.SetupTOTP(f.ctx, uid); !errors.Is(err, ErrEmailUnverified) {
		t.Fatalf("setup on an unverified account: %v, want email_unverified", err)
	}
	if u := f.user(t, uid); u.TotpSecret.Valid {
		t.Fatal("a refused setup stored a secret")
	}
	secret, _ := auth.NewTOTPSecret()
	sealed, _ := f.sealer.Seal(secret)
	if err := f.q.SetUserTOTPSecret(f.ctx, db.SetUserTOTPSecretParams{ID: uid, TotpSecret: pgtype.Text{String: sealed, Valid: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.auth.ConfirmTOTP(f.ctx, uid, totpNow(t, secret)); !errors.Is(err, ErrEmailUnverified) {
		t.Fatalf("confirm on an unverified account: %v, want email_unverified", err)
	}
	if u := f.user(t, uid); u.MfaEnabledAt.Valid {
		t.Fatal("a refused confirm turned MFA on")
	}
	// Proved, the same account enrols.
	if _, err := f.q.MarkEmailVerified(f.ctx, uid); err != nil {
		t.Fatal(err)
	}
	enrol(t, f.auth, f.ctx, uid)
	if u := f.user(t, uid); !u.MfaEnabledAt.Valid {
		t.Fatal("a verified account enrols")
	}
}
