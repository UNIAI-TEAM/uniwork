package service

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The web door of the identity fixture: its Services ID and the return URL
// registered on it.
const (
	appleServicesID = "com.uniworkos.web"
	appleWebReturn  = "https://api.example.com/api/v1/auth/apple/callback"
)

// appleWebCode is Apple answering one web authorization: a code that
// redeems for an identity token issued to aud with the hash of nonce.
func (f *identityFixture) appleWebCode(t *testing.T, aud, sub, email string, private bool, nonce string) string {
	t.Helper()
	code := "web-" + util.NewID()
	f.client.issueWebCode(code, f.issuer.Token(t, appletest.Claims(aud, sub, email, private, nonce)))
	return code
}

// appleWeb proves an identity at the web door, as the callback does, and
// answers it with the code it was redeemed from.
func (f *identityFixture) appleWeb(t *testing.T, sub, email string, private bool) (ProviderIdentity, string) {
	t.Helper()
	nonce := util.NewID()
	code := f.appleWebCode(t, appleServicesID, sub, email, private, nonce)
	id, err := f.apple.WebIdentity(f.ctx, code, nonce, `{"name":{"firstName":"Lan","lastName":"Phạm"}}`)
	if err != nil {
		t.Fatal(err)
	}
	return id, code
}

// wantRevoked fails unless Apple was told to revoke the web refresh token
// of code, for the Services ID.
func (f *identityFixture) wantRevoked(t *testing.T, code string, want bool) {
	t.Helper()
	got := slices.Contains(f.client.revokedNow(), appleServicesID+" apple-web-refresh-for-"+code)
	if got != want {
		t.Fatalf("revoked %v for %s, want %v: %v", got, code, want, f.client.revokedNow())
	}
}

// The app's door and the web's verify tokens for different audiences (ADR
// 0049 §7): a token Apple issued to the Services ID does not open the app's
// door, and a code whose identity token was issued to the app's bundle id
// opens no web sign-in. Each door takes its own.
func TestWebAndNativeAppleAudiencesStayApart(t *testing.T) {
	f := newIdentityFixture(t)
	nonce := util.NewID()
	_, err := f.apple.SignIn(f.ctx, AppleSignInInput{
		IdentityToken: f.issuer.Token(t, appletest.Claims(appleServicesID, "apart", "apart@icloud.com", false, nonce)), Nonce: nonce,
		ClientID: "uniwork-chat-mobile", DeploymentID: "default", Locale: "vi",
	})
	wantStatusCode(t, err, "apple_token_invalid", http.StatusUnauthorized)

	nonce = util.NewID()
	_, err = f.apple.WebIdentity(f.ctx, f.appleWebCode(t, appleBundle, "apart", "apart@icloud.com", false, nonce), nonce, "")
	if !errors.Is(err, ErrAppleWebSignIn) || !strings.Contains(err.Error(), "audience") {
		t.Fatalf("an app token at the web's door: %v", err)
	}
	if n := f.usersWith(t, "apart@icloud.com"); n != 0 {
		t.Fatalf("a refused token opened %d accounts", n)
	}

	id, _ := f.appleWeb(t, "apart", "apart@icloud.com", false)
	if id.AppleClientID != appleServicesID {
		t.Fatalf("a web identity is the Services ID's: %+v", id)
	}
	if _, err := f.appleSignIn(t, "apart", "apart@icloud.com", false); err != nil {
		t.Fatalf("an app token at the app's door: %v", err)
	}
}

// What the web door proves comes from the identity token Apple handed the
// server for the code, never from the browser: the code is redeemed for the
// Services ID with the return URL it was issued for, the token must carry
// this sign-in's nonce, and the address is the token's. Apple's unsigned
// user field gives only the name.
func TestAppleWebIdentityTrustsOnlyTheTokenItRedeemed(t *testing.T) {
	f := newIdentityFixture(t)
	nonce := util.NewID()
	code := f.appleWebCode(t, appleServicesID, "trust", "Trust@iCloud.com", false, nonce)
	id, err := f.apple.WebIdentity(f.ctx, code, nonce, `{"name":{"firstName":" Lan ","lastName":"Phạm"},"email":"someone.else@example.com"}`)
	if err != nil {
		t.Fatal(err)
	}
	if id.Provider != ProviderApple || id.Subject != "trust" || id.Email != "trust@icloud.com" || !id.EmailAuthoritative || id.Name != "Lan Phạm" {
		t.Fatalf("identity = %+v", id)
	}
	if refresh, err := f.sealer.Open(id.AppleRefresh); err != nil || refresh != "apple-web-refresh-for-"+code || id.AppleClientID != appleServicesID {
		t.Fatalf("the consent rides sealed, for the Services ID: %q %v %+v", refresh, err, id)
	}
	if got := f.client.webExchanges[len(f.client.webExchanges)-1]; got != appleServicesID+" "+code+" "+appleWebReturn {
		t.Fatalf("exchange = %q", got)
	}

	for name, user := range map[string]string{"no user field": "", "not JSON": "{", "too long": `{"name":{"firstName":"` + strings.Repeat("x", 5000) + `"}}`} {
		nonce := util.NewID()
		id, err := f.apple.WebIdentity(f.ctx, f.appleWebCode(t, appleServicesID, "trust", "trust@icloud.com", false, nonce), nonce, user)
		if err != nil || id.Name != "" || id.Email != "trust@icloud.com" {
			t.Fatalf("%s: %+v %v", name, id, err)
		}
	}

	nonce = util.NewID()
	code = f.appleWebCode(t, appleServicesID, "trust", "trust@icloud.com", false, nonce)
	if _, err := f.apple.WebIdentity(f.ctx, code, "another-nonce", ""); !errors.Is(err, ErrAppleWebSignIn) || !strings.Contains(err.Error(), "nonce") {
		t.Fatalf("another sign-in's nonce: %v", err)
	}
	// Whose consent a token that failed carries cannot be told: it is
	// dropped, not revoked on a guess.
	f.wantRevoked(t, code, false)
	if _, err := f.apple.WebIdentity(f.ctx, "never-issued", nonce, ""); !errors.Is(err, ErrAppleWebSignIn) || !strings.Contains(err.Error(), "invalid_grant") {
		t.Fatalf("a code Apple would not redeem: %v", err)
	}
	if _, err := f.apple.WebIdentity(f.ctx, "", nonce, ""); !errors.Is(err, ErrAppleWebSignIn) {
		t.Fatalf("no code: %v", err)
	}
}

// An account the web opens keeps the consent of the sign-in that opened it,
// for the Services ID it was issued to, so account deletion revokes it with
// the right client; a later sign-in keeps its fresher consent instead.
func TestAppleWebSignInKeepsTheConsentForTheServicesID(t *testing.T) {
	f := newIdentityFixture(t)
	id, code := f.appleWeb(t, "keep", "keep7@privaterelay.appleid.com", true)
	res, err := f.apple.WebSignIn(f.ctx, id, "vi", SignInIntentSignUp)
	if err != nil || res.Session.RefreshToken == "" || res.Ticket != "" {
		t.Fatalf("sign-up: %+v %v", res, err)
	}
	u := f.user(t, res.Session.User.ID)
	if !u.EmailVerifiedAt.Valid || u.AppleID.String != "keep" || u.AppleClientID.String != appleServicesID || u.DisplayName != "Lan Phạm" {
		t.Fatalf("account = %+v", u)
	}
	if refresh, _ := f.sealer.Open(u.AppleRefreshTokenEnc.String); refresh != "apple-web-refresh-for-"+code {
		t.Fatalf("kept consent = %q", refresh)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = 'auth.login_succeeded' AND actor_id = $1
		AND metadata::jsonb->>'via' = 'provider' AND metadata::jsonb->>'provider' = 'apple'`, u.ID); n != 1 {
		t.Fatalf("login audits naming Apple = %d", n)
	}

	again, code2 := f.appleWeb(t, "keep", "keep7@privaterelay.appleid.com", true)
	res, err = f.apple.WebSignIn(f.ctx, again, "vi", SignInIntentSignIn)
	if err != nil || res.Session.User.ID != u.ID || res.Ticket != "" {
		t.Fatalf("the subject signs in again: %+v %v", res, err)
	}
	if refresh, _ := f.sealer.Open(f.user(t, u.ID).AppleRefreshTokenEnc.String); refresh != "apple-web-refresh-for-"+code2 {
		t.Fatalf("the fresher consent is kept: %q", refresh)
	}
	if err := f.auth.DeleteAccount(f.ctx, u.ID, DeleteAccountInput{EmailConfirmation: u.Email}); err != nil {
		t.Fatal(err)
	}
	f.wantRevoked(t, code2, true)
}

// An identity no account matches gets a ticket, not an account, and the
// ticket carries its consent on: the account "Create" opens keeps it for the
// Services ID, and "Cancel" gives it back to Apple.
func TestAppleWebSignInWithoutAMatchIssuesATicket(t *testing.T) {
	f := newIdentityFixture(t)
	id, code := f.appleWeb(t, "ticket", "ticket@icloud.com", false)
	res, err := f.apple.WebSignIn(f.ctx, id, "vi", SignInIntentSignIn)
	if err != nil || res.Ticket == "" || res.TicketKind != TicketKindUnmatched || res.Session.AccessToken != "" {
		t.Fatalf("want a ticket: %+v %v", res, err)
	}
	if n := f.usersWith(t, "ticket@icloud.com"); n != 0 {
		t.Fatalf("a sign-in without a match opened %d accounts", n)
	}
	sess, err := f.tickets().Create(f.ctx, res.Ticket, WebTicket(), "", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if u := f.user(t, sess.User.ID); u.AppleClientID.String != appleServicesID || !u.AppleRefreshTokenEnc.Valid {
		t.Fatalf("the created account keeps the consent: %+v", u)
	}
	f.wantRevoked(t, code, false)

	other, code := f.appleWeb(t, "ticket-cancel", "cancel@icloud.com", false)
	res, err = f.apple.WebSignIn(f.ctx, other, "vi", SignInIntentSignIn)
	if err != nil || res.Ticket == "" {
		t.Fatalf("want a ticket: %+v %v", res, err)
	}
	f.tickets().Discard(f.ctx, res.Ticket, WebTicket())
	f.wantRevoked(t, code, true)
}

// A refused sign-in gives the consent it brought back to Apple, unless the
// Apple ID opens an account; an account with a second factor gets its
// challenge first, the link and the consent riding in it until the factor
// passes.
func TestAppleWebSignInGivesBackWhatItDidNotKeep(t *testing.T) {
	f := newIdentityFixture(t)
	if _, err := f.q.CreateAppleUser(f.ctx, db.CreateAppleUserParams{
		ID: util.NewID(), Email: "held@icloud.com", DisplayName: "Held", AppleID: pgtype.Text{String: "another-subject", Valid: true},
		AppleEmail: pgtype.Text{String: "held@icloud.com", Valid: true}, EmailVerified: true, Locale: "vi",
	}); err != nil {
		t.Fatal(err)
	}
	id, code := f.appleWeb(t, "refused", "held@icloud.com", false)
	_, err := f.apple.WebSignIn(f.ctx, id, "vi", SignInIntentSignIn)
	wantStatusCode(t, err, "sign_in_account_conflict", http.StatusConflict)
	f.wantRevoked(t, code, true)

	u, secret, _ := f.mfaAccount(t, "second@icloud.com")
	id, code = f.appleWeb(t, "second", "second@icloud.com", false)
	res, err := f.apple.WebSignIn(f.ctx, id, "vi", SignInIntentSignIn)
	if err != nil || !res.Session.MFAPending() {
		t.Fatalf("want the second step: %+v %v", res, err)
	}
	if got := f.user(t, u.ID); got.AppleID.Valid || got.AppleRefreshTokenEnc.Valid {
		t.Fatalf("written before the second factor: %+v", got)
	}
	f.wantRevoked(t, code, false)
	if _, err := f.auth.VerifyMFA(f.ctx, res.Session.MFAToken, totpNow(t, secret)); err != nil {
		t.Fatal(err)
	}
	got := f.user(t, u.ID)
	if got.AppleID.String != "second" || got.AppleClientID.String != appleServicesID {
		t.Fatalf("linked after the second factor: %+v", got)
	}
	if refresh, _ := f.sealer.Open(got.AppleRefreshTokenEnc.String); refresh != "apple-web-refresh-for-"+code {
		t.Fatalf("the consent rode the challenge: %q", refresh)
	}

	// Matched now: the account's second factor is asked again and its kept
	// consent stays as it was until it passes.
	id, code = f.appleWeb(t, "second", "second@icloud.com", false)
	if res, err = f.apple.WebSignIn(f.ctx, id, "vi", SignInIntentSignIn); err != nil || !res.Session.MFAPending() {
		t.Fatalf("want the second step: %+v %v", res, err)
	}
	if after := f.user(t, u.ID); after.AppleRefreshTokenEnc != got.AppleRefreshTokenEnc {
		t.Fatal("a sign-in still owing its second factor replaced the kept consent")
	}
	f.wantRevoked(t, code, false)
}

// A link from Settings that keeps nothing gives the Apple consent back too,
// unless the Apple ID opens an account (it keeps its own).
func TestBrowserLinkGivesBackAnAppleConsentItDidNotKeep(t *testing.T) {
	f := newIdentityFixture(t)
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	caller := registerVerified(t, f.q, f.auth, "caller@example.com", "Caller")
	bctx, bsess := f.browser(t, caller.ID)
	li := LinkIntent{UserID: caller.ID, SessionID: bsess.SessionID, Provider: ProviderApple, ReturnTo: "/settings?tab=security"}

	id, code := f.appleWeb(t, "link-mismatch", "mismatch@icloud.com", false)
	if _, err := methods.LinkFromBrowser(bctx, li, id, "not-this-browser"); !errors.Is(err, ErrLinkSessionMismatch) {
		t.Fatalf("another browser: %v", err)
	}
	f.wantRevoked(t, code, true)

	held, err := f.appleSignIn(t, "link-held", "held.elsewhere@icloud.com", false)
	if err != nil {
		t.Fatal(err)
	}
	// It belongs to an organization, so the identity cannot move out of it.
	if _, err := NewOrganizationService(f.pool, f.q).Create(f.ctx, held.AccountID, "Công ty", "cong-ty-"+strings.ToLower(util.NewID()[20:])); err != nil {
		t.Fatal(err)
	}
	id, code = f.appleWeb(t, "link-held", "held.elsewhere@icloud.com", false)
	if _, err := methods.LinkFromBrowser(bctx, li, id, bsess.RefreshToken); !errors.Is(err, ErrSignInMethodTaken) {
		t.Fatalf("an Apple ID another account holds: %v", err)
	}
	f.wantRevoked(t, code, false)

	id, code = f.appleWeb(t, "link-ok", "linked.personal@icloud.com", false)
	res, err := methods.LinkFromBrowser(bctx, li, id, bsess.RefreshToken)
	if err != nil || res.Change.User.ID != caller.ID {
		t.Fatalf("link: %+v %v", res, err)
	}
	if u := f.user(t, caller.ID); u.AppleID.String != "link-ok" || u.AppleClientID.String != appleServicesID {
		t.Fatalf("linked with its consent: %+v", u)
	}
	f.wantRevoked(t, code, false)
}
