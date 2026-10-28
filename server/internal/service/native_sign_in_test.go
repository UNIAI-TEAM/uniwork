package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/auth/googletest"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	googleWebClient = "web.apps.googleusercontent.com"
	googleAppClient = "android.apps.googleusercontent.com"
)

// app is UniChat mobile as the identity fixture's native allowlists know it.
var app = NativeClient{ClientID: "uniwork-chat-mobile", DeploymentID: "default", DeviceLabel: "iPhone của An", Platform: "ios", Build: "2.1.0"}

// nativeFixture is the identity fixture with the app's Google door open (a
// fake Google behind the real verifier) and the app's sign-in doors.
type nativeFixture struct {
	*identityFixture
	googleIssuer *googletest.Issuer
	doors        *NativeSignInService
}

func newNativeFixture(t *testing.T) *nativeFixture {
	t.Helper()
	f := newIdentityFixture(t)
	issuer := googletest.New(t)
	d, err := auth.DiscoverGoogle(context.Background(), issuer.URL)
	if err != nil {
		t.Fatal(err)
	}
	f.auth.SetGoogleNative(d.NativeVerifier(googleWebClient, []string{googleAppClient}, nil))
	return &nativeFixture{identityFixture: f, googleIssuer: issuer, doors: NewNativeSignInService(f.pool, f.q, f.auth, f.desktop, f.tickets())}
}

// request is the context of an app's request, as the handler leaves it.
func (f *nativeFixture) request() context.Context {
	return WithSessionMeta(f.ctx, SessionMeta{UserAgent: "okhttp/4.12", IP: "10.0.0.20"})
}

// googleSheet is what Google's SDK hands the app for sub: an ID token for
// the app (audience the web client, azp the Android client) and its nonce.
func (f *nativeFixture) googleSheet(t *testing.T, sub, email string) (token, nonce string) {
	t.Helper()
	nonce = util.NewID()
	return f.googleIssuer.Token(t, f.googleIssuer.Claims(googleWebClient, googleAppClient, sub, email, nonce)), nonce
}

func (f *nativeFixture) google(t *testing.T, sub, email, intent string) (NativeSignInResult, string, error) {
	t.Helper()
	token, nonce := f.googleSheet(t, sub, email)
	res, err := f.doors.Google(f.request(), NativeProviderSignIn{Token: token, Nonce: nonce, Intent: intent, Locale: "vi", Client: app})
	return res, nonce, err
}

func (f *nativeFixture) apple(t *testing.T, sub, email string, private bool, intent string) (NativeSignInResult, string, error) {
	t.Helper()
	nonce := util.NewID()
	res, err := f.doors.Apple(f.request(), NativeProviderSignIn{
		Token: f.issuer.Token(t, appletest.Claims(appleBundle, sub, email, private, nonce)), Nonce: nonce,
		AuthorizationCode: "native-" + sub, GivenName: "Lan", FamilyName: "Phạm", Intent: intent, Locale: "vi", Client: app,
	})
	return res, nonce, err
}

// wantSignedIn fails unless res is a device session of the app on uid (any
// account when uid is empty) that the bearer middleware would take.
func (f *nativeFixture) wantSignedIn(t *testing.T, res NativeSignInResult, err error, uid string) db.User {
	t.Helper()
	if err != nil || res.Status != NativeSignedIn || res.Session.AccessToken == "" || res.Session.RefreshToken == "" || res.MFAToken != "" || res.Ticket != "" {
		t.Fatalf("want a device session: %+v %v", res, err)
	}
	if uid != "" && res.Session.AccountID != uid {
		t.Fatalf("signed in to %s, want %s", res.Session.AccountID, uid)
	}
	d, err := f.q.GetDeviceSession(f.ctx, res.Session.DeviceSessionID)
	if err != nil || d.ClientID != app.ClientID || d.DeploymentID != app.DeploymentID || d.DeviceLabel != app.DeviceLabel || d.Platform != "ios" || d.RevokedAt.Valid {
		t.Fatalf("the device session: %+v %v", d, err)
	}
	at, err := f.auth.minter.ParseAccessToken(res.Session.AccessToken)
	if err != nil || at.Web || at.SessionID != res.Session.DeviceSessionID {
		t.Fatalf("the access token is the device's: %+v %v", at, err)
	}
	return f.user(t, res.Session.AccountID)
}

// loginAudits counts uid's auth.login_succeeded rows of the app's channel
// with via.
func (f *nativeFixture) loginAudits(t *testing.T, uid, via string) int {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'via' = $3 AND metadata::jsonb->>'channel' = 'native'`, audit.ActionAuthLoginSucceeded, uid, via)
}

// The password door (spec §3.6): the app's device session on a right
// password, audited via password on the app's channel; the app's challenge,
// bound to this app, on an account with a second factor; a wrong address or
// password is the same 401 and the wrong password is audited.
func TestNativePasswordSignsInOnTheAppsDevice(t *testing.T) {
	f := newNativeFixture(t)
	u := registerVerified(t, f.q, f.auth, "native-pw@example.com", "An")
	res, err := f.doors.Password(f.request(), "  Native-PW@example.com ", "password123", app)
	f.wantSignedIn(t, res, err, u.ID)
	if n := f.loginAudits(t, u.ID, nativeViaPassword); n != 1 {
		t.Fatalf("login audits via password: %d", n)
	}
	if _, err := f.doors.Password(f.request(), u.Email, "wrong", app); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a wrong password: %v", err)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'channel' = 'native'`, audit.ActionAuthLoginFailed, u.ID); n != 1 {
		t.Fatalf("the wrong password is audited: %d", n)
	}
	if _, err := f.doors.Password(f.request(), "nobody@example.com", "password123", app); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("no such account: %v", err)
	}

	m, _, _ := f.mfaAccount(t, "native-mfa@example.com")
	res, err = f.doors.Password(f.request(), m.Email, "password123", app)
	if err != nil || res.Status != NativeMFARequired || res.MFAToken == "" || res.Session.AccessToken != "" {
		t.Fatalf("an account with a second factor: %+v %v", res, err)
	}
	ch, err := f.auth.minter.ParseMFA(res.MFAToken)
	if err != nil || ch.Channel != auth.MFAChannelNative || ch.ClientID != app.ClientID || ch.DeploymentID != app.DeploymentID || ch.UserID != m.ID {
		t.Fatalf("the challenge is the app's: %+v %v", ch, err)
	}
}

// The app's second step takes only a challenge minted for this very app
// (ADR 0049 §4): the browser's, or one for another client, is refused like a
// wrong code before the account is read, so it costs nothing from the
// lockout; the browser's second step refuses the app's. The lockout is the
// account's: wrong codes at the app's door and the browser's add up, and
// while it lasts the right code is 429 at either.
func TestNativeSecondStepIsBoundToTheApp(t *testing.T) {
	f := newNativeFixture(t)
	u, secret, _ := f.mfaAccount(t, "native-step@example.com")
	first, err := f.doors.Password(f.request(), u.Email, "password123", app)
	if err != nil || first.MFAToken == "" {
		t.Fatalf("first step: %+v %v", first, err)
	}
	web := f.challenge(t, u.Email)
	other, err := f.auth.minter.MintMFA(auth.MFAChallenge{UserID: u.ID, Channel: auth.MFAChannelNative, ClientID: "uniwork-chat-mobile-staging", DeploymentID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	for name, tok := range map[string]string{"the browser's": web, "another app's": other, "garbage": "x"} {
		if _, err := f.doors.VerifyMFA(f.request(), tok, totpNow(t, secret), app); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("%s challenge at the app's door: %v", name, err)
		}
	}
	if _, err := f.auth.VerifyMFA(f.ctx, first.MFAToken, totpNow(t, secret)); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the app's challenge at the browser's door: %v", err)
	}
	if n := f.failures(t, u.ID); n != 0 {
		t.Fatalf("a refused channel counted as a guess: %d", n)
	}

	res, err := f.doors.VerifyMFA(f.request(), first.MFAToken, totpNow(t, secret), app)
	f.wantSignedIn(t, res, err, u.ID)
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'via' = 'mfa' AND metadata::jsonb->>'mfa' = 'true'`, audit.ActionAuthLoginSucceeded, u.ID); n != 1 {
		t.Fatalf("the second step's login audit: %d", n)
	}

	for i := 0; i < secondFactorMaxFailures/2; i++ {
		if _, err := f.doors.VerifyMFA(f.request(), first.MFAToken, "000000", app); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("wrong code %d at the app: %v", i+1, err)
		}
	}
	for i := 0; i < secondFactorMaxFailures/2-1; i++ {
		if _, err := f.auth.VerifyMFA(f.ctx, web, "000000"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("wrong code %d at the browser: %v", i+1, err)
		}
	}
	_, err = f.doors.VerifyMFA(f.request(), first.MFAToken, "999999", app)
	wantStatusCode(t, err, "second_factor_locked", http.StatusTooManyRequests)
	_, err = f.doors.VerifyMFA(f.request(), first.MFAToken, totpNow(t, secret), app)
	wantStatusCode(t, err, "second_factor_locked", http.StatusTooManyRequests)
	notice := f.mailOfKind(t, u.Email, mail.KindSignInMethodChanged)
	if !strings.Contains(notice.Text, app.DeviceLabel) || !strings.Contains(notice.Text, "10.0.0.20") {
		t.Fatalf("the lockout notice names the app's device: %s", notice.Text)
	}
}

// The app's provider doors follow the rules every provider shares (ADR 0049
// §2): nothing is created for an identity that matches no account — the app
// gets a ticket for its choice screen, bound to its nonce — unless the
// register screen asked (intent sign_up); an address the provider owns joins
// a verified account, after its second factor when it has one; an address it
// does not own needs its owner to sign in (link_required). A token that does
// not verify is 401 provider_token_invalid.
func TestNativeProviderSignInFollowsTheSharedRules(t *testing.T) {
	f := newNativeFixture(t)
	res, nonce, err := f.google(t, "g-native-new", "native.new@gmail.com", "")
	if err != nil || res.Status != NativeIdentityUnmatched || res.Ticket == "" || res.Session.AccessToken != "" {
		t.Fatalf("an unmatched identity: %+v %v", res, err)
	}
	if res.Identity.Provider != ProviderGoogle || res.Identity.Email != "native.new@gmail.com" || res.Identity.Kind != TicketKindUnmatched {
		t.Fatalf("what the choice screen shows: %+v", res.Identity)
	}
	if n := f.usersWith(t, "native.new@gmail.com"); n != 0 {
		t.Fatal("an unmatched identity created an account")
	}
	if _, err := f.tickets().Describe(f.ctx, res.Ticket, app.ticket(nonce)); err != nil {
		t.Fatalf("the ticket is the app's: %v", err)
	}

	res, _, err = f.google(t, "g-native-signup", "native.signup@gmail.com", SignInIntentSignUp)
	created := f.wantSignedIn(t, res, err, "")
	if created.GoogleID.String != "g-native-signup" || !created.EmailVerifiedAt.Valid {
		t.Fatalf("sign_up creates a verified Gmail account: %+v", created)
	}
	res, _, err = f.google(t, "g-native-signup", "native.signup@gmail.com", "")
	f.wantSignedIn(t, res, err, created.ID)
	if n := f.loginAudits(t, created.ID, ProviderGoogle); n != 2 {
		t.Fatalf("login audits via google: %d", n)
	}

	owner := registerVerified(t, f.q, f.auth, "native.owner@gmail.com", "Owner")
	res, _, err = f.google(t, "g-native-owner", owner.Email, "")
	f.wantSignedIn(t, res, err, owner.ID)
	if f.linkAudits(t, owner.ID, ProviderGoogle, linkViaEmailMatch) != 1 || f.user(t, owner.ID).GoogleID.String != "g-native-owner" {
		t.Fatal("a verified Gmail account takes the link")
	}

	m, secret, _ := f.mfaAccount(t, "native.mfa@gmail.com")
	res, _, err = f.google(t, "g-native-mfa", m.Email, "")
	if err != nil || res.Status != NativeMFARequired || res.MFAToken == "" {
		t.Fatalf("a link into an account with a second factor: %+v %v", res, err)
	}
	if f.user(t, m.ID).GoogleID.Valid {
		t.Fatal("linked before the second factor")
	}
	res, err = f.doors.VerifyMFA(f.request(), res.MFAToken, totpNow(t, secret), app)
	f.wantSignedIn(t, res, err, m.ID)
	if res.LinkSkipped != "" || f.user(t, m.ID).GoogleID.String != "g-native-mfa" {
		t.Fatalf("linked once the second factor passed: %+v", res)
	}

	work := registerVerified(t, f.q, f.auth, "an@company.vn", "An")
	res, _, err = f.google(t, "g-native-work", work.Email, "")
	if err != nil || res.Status != NativeLinkRequired || res.Ticket == "" || res.Identity.Kind != TicketKindLinkRequired {
		t.Fatalf("an address Google does not own: %+v %v", res, err)
	}
	if f.user(t, work.ID).GoogleID.Valid {
		t.Fatal("link_required linked")
	}

	token, _ := f.googleSheet(t, "g-native-x", "x@gmail.com")
	_, err = f.doors.Google(f.request(), NativeProviderSignIn{Token: token, Nonce: "not-its-nonce", Client: app})
	wantStatusCode(t, err, "provider_token_invalid", http.StatusUnauthorized)
	_, err = f.doors.Google(f.request(), NativeProviderSignIn{Token: token, Nonce: "n", Intent: "link", Client: app})
	wantInvalid(t, err, "an unknown intent")

	// Apple: an unmatched Apple ID answers a ticket too, unlike the legacy
	// route; the account created from the register screen keeps the consent.
	res, _, err = f.apple(t, "apple-native-new", "lan@privaterelay.appleid.com", true, "")
	if err != nil || res.Status != NativeIdentityUnmatched || !res.Identity.PrivateRelay || res.Identity.Name != "Lan Phạm" {
		t.Fatalf("an unmatched Apple ID: %+v %v", res, err)
	}
	if n := f.usersWith(t, "lan@privaterelay.appleid.com"); n != 0 {
		t.Fatal("an unmatched Apple ID created an account")
	}
	res, _, err = f.apple(t, "apple-native-up", "up@icloud.com", false, SignInIntentSignUp)
	a := f.wantSignedIn(t, res, err, "")
	if a.AppleID.String != "apple-native-up" || a.AppleClientID.String != appleBundle || !a.AppleRefreshTokenEnc.Valid || !a.EmailVerifiedAt.Valid {
		t.Fatalf("the Apple account keeps its consent for the bundle id: %+v", a)
	}
	// Refused: the Apple ID opens no account, so its consent goes back.
	held := registerVerified(t, f.q, f.auth, "held@icloud.com", "H")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET apple_id = 'apple-someone' WHERE id = $1`, held.ID); err != nil {
		t.Fatal(err)
	}
	_, _, err = f.apple(t, "apple-native-thief", "held@icloud.com", false, "")
	wantStatusCode(t, err, "sign_in_account_conflict", http.StatusConflict)
	if !slices.Contains(f.client.revokedNow(), appleBundle+" apple-refresh-for-native-apple-native-thief") {
		t.Fatalf("a refused sign-in gives its consent back: %v", f.client.revokedNow())
	}
	nonce = util.NewID()
	_, err = f.doors.Apple(f.request(), NativeProviderSignIn{Token: f.issuer.Token(t, appletest.Claims(appleServicesID, "s", "s@icloud.com", false, nonce)), Nonce: nonce, Client: app})
	wantStatusCode(t, err, "provider_token_invalid", http.StatusUnauthorized)
}

// A native ticket opens only with the nonce the app handed the provider's
// sheet (ADR 0049 §3): the ticket keeps only its SHA-256, so a ticket copied
// out of a log, sent without the nonce or with another, from another
// deployment, or to the browser's routes, opens nothing. With it, the app's
// choice screen creates the account, claims another address and links.
func TestNativeTicketNeedsTheNonce(t *testing.T) {
	f := newNativeFixture(t)
	res, nonce, err := f.google(t, "g-ticket", "ticket.app@gmail.com", "")
	if err != nil || res.Ticket == "" {
		t.Fatalf("a ticket: %+v %v", res, err)
	}
	if strings.Contains(res.Ticket, nonce) {
		t.Fatal("the ticket carries the nonce")
	}
	for name, n := range map[string]string{"no nonce": "", "another nonce": util.NewID()} {
		_, err := f.doors.CreateFromTicket(f.request(), res.Ticket, n, "", "vi", app)
		if !errors.Is(err, ErrSignInTicketChannel) {
			t.Fatalf("create with %s: %v", name, err)
		}
	}
	if _, err := f.tickets().Create(f.ctx, res.Ticket, WebTicket(), "", "vi"); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("the app's ticket on the browser's route: %v", err)
	}
	if err := f.doors.SendEmailClaim(f.request(), res.Ticket, "", "work@company.vn", "vi", app); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a claim without the nonce: %v", err)
	}
	if _, err := f.doors.CreateFromTicket(f.request(), "not-a-ticket", nonce, "", "vi", app); !errors.Is(err, ErrSignInTicketMissing) {
		t.Fatalf("no ticket at all: %v", err)
	}
	if f.usersWith(t, "ticket.app@gmail.com") != 0 {
		t.Fatal("a refused ticket created")
	}
	if _, err := f.doors.CreateFromTicket(f.request(), res.Ticket, nonce, "", "vi", app); err == nil {
		t.Fatal("Google shared no name, so the screen asks for one")
	}
	created, err := f.doors.CreateFromTicket(f.request(), res.Ticket, nonce, "Vé App", "vi", app)
	u := f.wantSignedIn(t, created, err, "")
	if u.GoogleID.String != "g-ticket" || u.Email != "ticket.app@gmail.com" || u.DisplayName != "Vé App" || f.loginAudits(t, u.ID, linkViaTicket) != 1 {
		t.Fatalf("the account the app's ticket created: %+v", u)
	}
	// The same ticket again signs in to the account it created.
	again, err := f.doors.CreateFromTicket(f.request(), res.Ticket, nonce, "Vé App", "vi", app)
	f.wantSignedIn(t, again, err, u.ID)

	// "I was invited with another address": the code goes to the work
	// address, and proving it opens a new account there.
	res, nonce, err = f.google(t, "g-claim", "claim.personal@gmail.com", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.doors.SendEmailClaim(f.request(), res.Ticket, nonce, "Work@Company.vn", "vi", app); err != nil {
		t.Fatal(err)
	}
	code := f.claimCode(t, "work@company.vn")
	if _, err := f.doors.VerifyEmailClaim(f.request(), res.Ticket, util.NewID(), "work@company.vn", code, "", "vi", app); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("verify without the nonce: %v", err)
	}
	if _, err := f.doors.VerifyEmailClaim(f.request(), res.Ticket, nonce, "work@company.vn", "000000", "", "vi", app); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("a wrong code: %v", err)
	}
	claimed, err := f.doors.VerifyEmailClaim(f.request(), res.Ticket, nonce, "work@company.vn", code, "Công việc", "vi", app)
	w := f.wantSignedIn(t, claimed, err, "")
	if w.Email != "work@company.vn" || w.GoogleID.String != "g-claim" || !w.EmailVerifiedAt.Valid || f.loginAudits(t, w.ID, linkViaEmailClaim) != 1 {
		t.Fatalf("the claimed account: %+v", w)
	}

	// "I already have an account": the app signs in, then links with the
	// device session, which started after the ticket.
	owner := registerVerified(t, f.q, f.auth, "linker@company.vn", "Linker")
	res, nonce, err = f.google(t, "g-link", "linker.personal@gmail.com", "")
	if err != nil {
		t.Fatal(err)
	}
	signed, err := f.doors.Password(f.request(), owner.Email, "password123", app)
	f.wantSignedIn(t, signed, err, owner.ID)
	bearer := f.native(t, signed.Session)
	if _, err := f.doors.LinkTicket(bearer, res.Ticket, "", TicketLink{}, app); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a link without the nonce: %v", err)
	}
	if _, err := f.doors.LinkTicket(f.bearer(t, f.webSession(t, owner.Email)), res.Ticket, nonce, TicketLink{}, app); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a browser bearer on the app's ticket: %v", err)
	}
	linked, err := f.doors.LinkTicket(bearer, res.Ticket, nonce, TicketLink{}, app)
	if err != nil || linked.User.GoogleID.String != "g-link" || !slices.Contains(linked.Methods.Proofs, ProofGoogle) {
		t.Fatalf("the app links its ticket: %+v %v", linked, err)
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, linkViaTicket) != 1 {
		t.Fatal("the link is audited via ticket")
	}
}

// consentDevice is the app's browser sign-in (PKCE) finished by the browser
// session on bearer: the consent it approves, exchanged for a device session
// of the app.
func (f *nativeFixture) consentDevice(t *testing.T, bearer context.Context, uid, state string) DesktopSession {
	t.Helper()
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	sum := sha256.Sum256([]byte(verifier))
	attempt, err := f.desktop.Start(f.ctx, DesktopStartInput{ClientID: app.ClientID, CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: state, RedirectURI: "uniworkchat://auth/callback", DeploymentID: app.DeploymentID, DeviceLabel: "Pixel", Platform: "android", Build: "2.1.0"})
	if err != nil {
		t.Fatal(err)
	}
	consent, err := f.desktop.Consent(f.ctx, uid, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := f.desktop.Approve(bearer, uid, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	d, err := f.desktop.Exchange(f.ctx, app.ClientID, code, verifier, "uniworkchat://auth/callback", app.DeploymentID)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// A device session counts as signed in after an app's ticket by when its
// person signed in (ADR 0049 §3, spec §3.2): the app's own sign-in, or the
// start of the browser session whose consent issued it — never by when its
// row was written, since a consent turns any live browser token into a new
// device session. A stolen browser token exchanged that way after the
// thief's own ticket is no proof of the account (proof_required, nothing
// linked); a consent from a browser that signed in after the ticket (the
// Android app's Apple sign-in goes through the browser) is.
func TestAppTicketLinkNeedsASignInNotAConsent(t *testing.T) {
	f := newNativeFixture(t)
	victim := registerVerified(t, f.q, f.auth, "victim@company.vn", "Victim")
	stolen := f.webSession(t, victim.Email)
	f.backdate(t, stolen)
	res, nonce, err := f.google(t, "g-app-link", "app.link@gmail.com", "")
	if err != nil || res.Ticket == "" {
		t.Fatalf("a ticket in the app: %+v %v", res, err)
	}
	device := f.consentDevice(t, f.bearer(t, stolen), victim.ID, "stolen")
	_, err = f.doors.LinkTicket(f.native(t, device), res.Ticket, nonce, TicketLink{}, app)
	wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	if f.user(t, victim.ID).GoogleID.Valid {
		t.Fatal("a consent from a stolen browser token linked the ticket's Google")
	}

	fresh := f.webSession(t, victim.Email)
	own := f.consentDevice(t, f.bearer(t, fresh), victim.ID, "fresh")
	linked, err := f.doors.LinkTicket(f.native(t, own), res.Ticket, nonce, TicketLink{}, app)
	if err != nil || linked.User.GoogleID.String != "g-app-link" {
		t.Fatalf("a consent from a browser that signed in after the ticket: %+v %v", linked, err)
	}
}

// webSession signs in to email with its password in the browser.
func (f *nativeFixture) webSession(t *testing.T, email string) Session {
	t.Helper()
	sess, err := f.auth.Login(f.ctx, email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	return sess
}

// Sign-up in the app is the web's (the same checks, the address unverified
// until its code is entered, mailed in the language the app asked in),
// ending in the app's device session.
func TestNativeRegisterOpensAnUnverifiedAccount(t *testing.T) {
	f := newNativeFixture(t)
	res, err := f.doors.Register(f.request(), "New@Example.com", "password123", "Người mới", "vi", app)
	u := f.wantSignedIn(t, res, err, "")
	if u.Email != "new@example.com" || u.EmailVerifiedAt.Valid || !u.PasswordHash.Valid || f.loginAudits(t, u.ID, nativeViaRegister) != 1 {
		t.Fatalf("the new account: %+v", u)
	}
	if got := f.mailOfKind(t, u.Email, mail.KindVerificationCode); got.UserID != u.ID || got.Locale != "vi" || u.Locale != "vi" {
		t.Fatalf("the verification code, in the app's language: %+v (account %q)", got, u.Locale)
	}
	if _, err := f.doors.Register(f.request(), "new@example.com", "password123", "Lần hai", "vi", app); !errors.Is(err, ErrConflict) {
		t.Fatalf("an address an account holds: %v", err)
	}
	_, err = f.doors.Register(f.request(), "short@example.com", "short", "N", "vi", app)
	wantInvalid(t, err, "a short password")
}

// An app's sign-in is news to the owner whenever the account had a session
// or a device before (spec §3.6): a browser alerts only on a browser string
// the account has not used, but what an app says it is proves nothing, so
// the same device signing in again alerts again. The account's very first
// session is no news, nor is a reclaim's (it ended the squatter's sessions
// and told the owner on its own).
func TestNativeSignInAlwaysAlertsAnAccountThatHadASession(t *testing.T) {
	f := newNativeFixture(t)
	reg, err := f.doors.Register(f.request(), "alert@example.com", "password123", "Báo", "vi", app)
	u := f.wantSignedIn(t, reg, err, "")
	if n := f.newLogins(u.Email); n != 0 {
		t.Fatalf("the account's first session alerted: %d", n)
	}
	for i := 1; i <= 2; i++ {
		res, err := f.doors.Password(f.request(), u.Email, "password123", app)
		f.wantSignedIn(t, res, err, u.ID)
		if n := f.newLogins(u.Email); n != i {
			t.Fatalf("sign-in %d from the same device: %d alerts, want %d", i, n, i)
		}
	}
	alert := f.mailOfKind(t, u.Email, mail.KindNewLogin)
	if !strings.Contains(alert.Text, "UniChat") || !strings.Contains(alert.Text, app.DeviceLabel+" (ios)") || !strings.Contains(alert.Text, "10.0.0.20") {
		t.Fatalf("the alert names the app, the device, its platform and the address: %s", alert.Text)
	}

	// An account whose only session was the browser's hears of the app.
	web := registerVerified(t, f.q, f.auth, "alert.web@example.com", "Web")
	res, err := f.doors.Password(f.request(), web.Email, "password123", app)
	f.wantSignedIn(t, res, err, web.ID)
	if n := f.newLogins(web.Email); n != 1 {
		t.Fatalf("a browser account's first app session: %d alerts", n)
	}

	// A new account from the register screen's Google: no news.
	res, _, err = f.google(t, "g-alert-new", "alert.new@gmail.com", SignInIntentSignUp)
	f.wantSignedIn(t, res, err, "")
	if n := f.newLogins("alert.new@gmail.com"); n != 0 {
		t.Fatalf("a created account alerted: %d", n)
	}

	// A reclaim ends whatever the squatter left and says so itself.
	s := f.squat(t, "alert.victim@icloud.com")
	res, _, err = f.apple(t, "apple-alert-victim", "alert.victim@icloud.com", false, "")
	f.wantSignedIn(t, res, err, s.user.ID)
	if !res.Reclaimed || f.newLogins("alert.victim@icloud.com") != 0 {
		t.Fatalf("a reclaim: reclaimed %v, %d alerts", res.Reclaimed, f.newLogins("alert.victim@icloud.com"))
	}
	f.assertGone(t, s, "alert.victim@icloud.com")
	if got := f.mailOfKind(t, "alert.victim@icloud.com", mail.KindSignInMethodChanged); !strings.Contains(got.Text, app.DeviceLabel) {
		t.Fatalf("the reclaim notice names the app's device: %s", got.Text)
	}
}

// The app links a provider from its Settings with the provider's own sheet
// (ADR 0049 §6, spec §3.7): only the app's bearer takes this door, only an
// account that proved its address, only with a step-up of the app's
// session, and only a token the app's verifier takes (403, never 401, when
// it does not: the caller is signed in). The identity of an empty account
// moves only when asked; Apple's consent stays with the account linked.
func TestAppLinksAProviderFromSettings(t *testing.T) {
	f := newNativeFixture(t)
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	u := registerVerified(t, f.q, f.auth, "settings.app@company.vn", "App")
	signed, err := f.doors.Password(f.request(), u.Email, "password123", app)
	f.wantSignedIn(t, signed, err, u.ID)
	bearer := f.native(t, signed.Session)
	token, nonce := f.googleSheet(t, "g-settings-app", "settings.app@gmail.com")

	browser, _ := f.browser(t, u.ID)
	wantInvalid(t, func() error {
		_, err := methods.LinkFromApp(browser, u.ID, ProviderGoogle, AppLink{Token: token, Nonce: nonce})
		return err
	}(), "a browser bearer")
	_, err = methods.LinkFromApp(bearer, u.ID, ProviderGoogle, AppLink{Token: token, Nonce: nonce})
	wantProofRequired(t, err, "no step-up")
	grant, err := f.auth.StepUp(bearer, u.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = methods.LinkFromApp(bearer, u.ID, ProviderGoogle, AppLink{StepUpToken: grant.Token, Token: token, Nonce: "not-its-nonce"})
	wantStatusCode(t, err, "provider_token_invalid", http.StatusForbidden)
	if f.user(t, u.ID).GoogleID.Valid {
		t.Fatal("a refused link wrote")
	}
	out, err := methods.LinkFromApp(bearer, u.ID, ProviderGoogle, AppLink{StepUpToken: grant.Token, Token: token, Nonce: nonce})
	if err != nil || out.User.GoogleID.String != "g-settings-app" || !out.Methods.Google.Linked || !slices.Contains(out.Methods.Proofs, ProofGoogle) {
		t.Fatalf("the app's link: %+v %v", out, err)
	}
	if f.linkAudits(t, u.ID, ProviderGoogle, linkViaSettings) != 1 {
		t.Fatal("the link is audited via settings")
	}
	if got := f.mailOfKind(t, u.Email, mail.KindSignInMethodChanged); !strings.Contains(got.Subject+got.Text, "Google") {
		t.Fatalf("the owner is told: %+v", got)
	}

	// An Apple ID that opens an empty account moves only when asked; the
	// consent the sheet's code redeems stays with the account linked.
	if res, _, err := f.apple(t, "apple-settings-empty", "empty.settings@icloud.com", false, SignInIntentSignUp); err != nil || res.Status != NativeSignedIn {
		t.Fatalf("the empty account: %+v %v", res, err)
	}
	sheet := func() AppLink {
		n := util.NewID()
		return AppLink{
			StepUpToken: grant.Token, Token: f.issuer.Token(t, appletest.Claims(appleBundle, "apple-settings-empty", "empty.settings@icloud.com", false, n)),
			Nonce: n, AuthorizationCode: "settings-" + n,
		}
	}
	_, err = methods.LinkFromApp(bearer, u.ID, ProviderApple, sheet())
	wantStatusCode(t, err, "sign_in_method_movable", http.StatusConflict)
	move := sheet()
	move.Move = true
	out, err = methods.LinkFromApp(bearer, u.ID, ProviderApple, move)
	if err != nil || out.User.AppleID.String != "apple-settings-empty" {
		t.Fatalf("the move: %+v %v", out, err)
	}
	if got := f.user(t, u.ID); got.AppleClientID.String != appleBundle || !got.AppleRefreshTokenEnc.Valid {
		t.Fatalf("the moved Apple ID's consent: %+v", got)
	}
	if f.linkAudits(t, u.ID, ProviderApple, linkViaMove) != 1 {
		t.Fatal("the move is audited")
	}
}

// A fresh token of the Google account linked to it proves the account in a
// step-up on the app (spec §3.7), now that the app's Google verifier is
// wired: google is among the proofs on the app's channel, never the
// browser's, and a token of another subject, a stale one or one without its
// nonce is 403 provider_token_invalid, counted like any wrong proof.
func TestGoogleTokenProvesAGoogleLinkedAccountOnTheApp(t *testing.T) {
	f := newNativeFixture(t)
	res, _, err := f.google(t, "g-proof", "proof.app@gmail.com", SignInIntentSignUp)
	u := f.wantSignedIn(t, res, err, "")
	bearer := f.native(t, res.Session)
	m, err := f.auth.SignInMethods(bearer, u.ID)
	if err != nil || !slices.Contains(m.Proofs, ProofGoogle) {
		t.Fatalf("proofs on the app: %+v %v", m.Proofs, err)
	}
	browser, _ := f.browser(t, u.ID)
	if m, _ := f.auth.SignInMethods(browser, u.ID); slices.Contains(m.Proofs, ProofGoogle) {
		t.Fatalf("a provider proof offered to the browser: %v", m.Proofs)
	}
	sheet := func(sub string, iat time.Time, raw string) *ProviderProof {
		nonce := util.NewID()
		c := f.googleIssuer.Claims(googleWebClient, googleAppClient, sub, "proof.app@gmail.com", nonce)
		c["iat"] = iat.Unix()
		if raw == "" {
			raw = nonce
		}
		return &ProviderProof{Provider: ProviderGoogle, Token: f.googleIssuer.Token(t, c), Nonce: raw}
	}
	for why, p := range map[string]*ProviderProof{
		"another Google account": sheet("g-someone-else", time.Now(), ""),
		"an old sign-in":         sheet("g-proof", time.Now().Add(-6*time.Minute), ""),
		"a nonce not its own":    sheet("g-proof", time.Now(), "other"),
	} {
		_, err := f.auth.StepUp(bearer, u.ID, StepUpProof{Provider: p})
		if ce := wantStatusCode(t, err, "provider_token_invalid", http.StatusForbidden); ce.Code == "" {
			t.Fatal(why)
		}
	}
	if n := f.failures(t, u.ID); n != 3 {
		t.Fatalf("wrong provider proofs are counted: %d", n)
	}
	g, err := f.auth.StepUp(bearer, u.ID, StepUpProof{Provider: sheet("g-proof", time.Now(), "")})
	if err != nil || g.Method != ProofGoogle {
		t.Fatalf("a Google step-up: %+v %v", g, err)
	}
}

// The app drops a ticket it will not spend as the browser's "Hủy" does (spec
// §3.2): an Apple ID that opened no account gives its consent back to Apple.
// Only the ticket's own nonce opens it, so a copied ticket gives nothing
// back, and a ticket that does not open is answered the same.
func TestTheAppsDiscardedTicketGivesTheAppleConsentBack(t *testing.T) {
	f := newNativeFixture(t)
	const kept = appleBundle + " apple-refresh-for-native-apple-native-dropped"
	res, nonce, err := f.apple(t, "apple-native-dropped", "dropped@icloud.com", false, "")
	if err != nil || res.Status != NativeIdentityUnmatched || res.Ticket == "" {
		t.Fatalf("want a ticket: %+v %v", res, err)
	}
	if err := f.doors.DiscardTicket(f.request(), res.Ticket, util.NewID(), app); err != nil {
		t.Fatalf("a ticket that does not open answers the same: %v", err)
	}
	if slices.Contains(f.client.revokedNow(), kept) {
		t.Fatal("another nonce gave the consent back")
	}
	if err := f.doors.DiscardTicket(f.request(), res.Ticket, nonce, app); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(f.client.revokedNow(), kept) {
		t.Fatalf("the dropped ticket keeps its consent: %v", f.client.revokedNow())
	}
	if n := f.usersWith(t, "dropped@icloud.com"); n != 0 {
		t.Fatal("a dropped ticket opened an account")
	}
	office := NativeClient{ClientID: "uniwork-office", DeploymentID: "default"}
	if err := f.doors.DiscardTicket(f.request(), res.Ticket, nonce, office); err == nil {
		t.Fatal("a client that is not the app passed the door")
	}
}
