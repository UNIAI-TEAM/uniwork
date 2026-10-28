package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// tickets is the choice screen's service on the identity fixture, its claim
// codes recorded with every other mail.
func (f *identityFixture) tickets() *SignInTicketService {
	return NewSignInTicketService(f.pool, f.q, f.auth, mail.Renderer{AppURL: "http://localhost:3000"}, f.out)
}

// googleTicket signs in with Google on the web and expects a ticket of kind.
func (f *identityFixture) googleTicket(t *testing.T, c GoogleClaims, kind string) string {
	t.Helper()
	res, err := f.google.SignIn(f.ctx, c, "vi", SignInIntentSignIn)
	if err != nil || res.Ticket == "" || res.TicketKind != kind || res.Session.AccessToken != "" || res.Session.MFAToken != "" {
		t.Fatalf("want a %s ticket and no session: %+v %v", kind, res, err)
	}
	return res.Ticket
}

// bearer is the context of a request carrying sess's access token, as the
// bearer middleware leaves it.
func (f *identityFixture) bearer(t *testing.T, sess Session) context.Context {
	t.Helper()
	at, err := f.auth.minter.ParseAccessToken(sess.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	return auth.WithAccessToken(f.ctx, at)
}

// backdate makes a browser session look older than anything issued since.
func (f *identityFixture) backdate(t *testing.T, sess Session) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE refresh_tokens SET created_at = now() - interval '1 hour' WHERE session_id = $1`, sess.SessionID); err != nil {
		t.Fatal(err)
	}
}

// claimCode is the last email-claim code mailed to addr.
func (f *identityFixture) claimCode(t *testing.T, addr string) string {
	t.Helper()
	var last mail.Message
	for _, m := range f.mailsTo(addr) {
		if m.Kind == mail.KindSignInEmailClaim {
			last = m
		}
	}
	if last.Kind == "" {
		t.Fatalf("no claim code mailed to %s; queued: %v", addr, f.mailsTo(addr))
	}
	return codeFrom(t, last)
}

func (f *identityFixture) usersWith(t *testing.T, email string) int {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM users WHERE email = $1`, email)
}

func wantStatusCode(t *testing.T, err error, code string, status int) CodedError {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != code || ce.Status != status {
		t.Fatalf("got %v, want %d %s", err, status, code)
	}
	return ce
}

// A provider identity that matches no account opens none (ADR 0049 §2c): the
// sign-in answers a ticket for the choice screen, and only "Create a new
// account" on that screen creates one, with the identity's own address
// (verified when the provider owns it, mailed a code when not). An address
// an account holds that the identity may not join by itself is a
// link_required ticket, which never creates.
func TestProviderSignInWithoutAMatchIssuesATicketNotAnAccount(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()

	ticket := f.googleTicket(t, GoogleClaims{Sub: "g-new", Email: "New@Gmail.com", EmailVerified: true, Name: "Ngọc", Picture: "https://img/n.png"}, TicketKindUnmatched)
	if f.usersWith(t, "new@gmail.com") != 0 || f.count(t, `SELECT count(*) FROM users WHERE google_id = 'g-new'`) != 0 {
		t.Fatal("a sign-in without a match created an account")
	}
	if strings.Contains(ticket, "new@gmail.com") || strings.Contains(ticket, "g-new") {
		t.Fatal("the ticket carries the identity in clear")
	}
	if _, err := f.sealer.OpenFor(auth.PurposeMFAPendingLink, ticket); err == nil {
		t.Fatal("a ticket opens as another purpose")
	}
	got, err := tickets.Describe(f.ctx, ticket, WebTicket())
	if err != nil || got != (SignInTicket{Provider: ProviderGoogle, Kind: TicketKindUnmatched, Email: "new@gmail.com", Name: "Ngọc"}) {
		t.Fatalf("describe = %+v %v", got, err)
	}

	// "Create a new account": the identity's address, verified because
	// Google owns it, linked from the start; a session, audited via ticket.
	sess, err := tickets.Create(f.ctx, ticket, WebTicket(), "", "vi")
	if err != nil || sess.RefreshToken == "" || sess.MFAPending() {
		t.Fatalf("create: %+v %v", sess, err)
	}
	u := f.user(t, sess.User.ID)
	if u.Email != "new@gmail.com" || u.DisplayName != "Ngọc" || !u.EmailVerifiedAt.Valid || u.PasswordHash.Valid ||
		u.GoogleID.String != "g-new" || u.GoogleEmail.String != "new@gmail.com" || u.AvatarUrl.String != "https://img/n.png" || u.OnboardedAt.Valid {
		t.Fatalf("created account = %+v", u)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'via' = 'ticket' AND metadata::jsonb->>'account' = 'created'`, audit.ActionAuthLoginSucceeded, u.ID); n != 1 {
		t.Fatalf("%d ticket sign-ins audited", n)
	}
	// The same ticket again (a second tab) signs in to that account: the
	// subject's unique index makes create idempotent.
	again, err := tickets.Create(f.ctx, ticket, WebTicket(), "", "vi")
	if err != nil || again.User.ID != u.ID || f.usersWith(t, "new@gmail.com") != 1 {
		t.Fatalf("create twice: %+v %v", again, err)
	}

	// The provider shared no name: the screen asks for one.
	nameless := f.googleTicket(t, GoogleClaims{Sub: "g-nameless", Email: "nameless@gmail.com", EmailVerified: true}, TicketKindUnmatched)
	if _, err := tickets.Create(f.ctx, nameless, WebTicket(), "  ", "vi"); !errors.As(err, new(ValidationError)) {
		t.Fatalf("a nameless create without a name: %v", err)
	}
	if _, err := tickets.Create(f.ctx, nameless, WebTicket(), strings.Repeat("a", maxDisplayNameRunes+1), "vi"); !errors.As(err, new(ValidationError)) {
		t.Fatalf("an overlong name: %v", err)
	}
	if sess, err := tickets.Create(f.ctx, nameless, WebTicket(), " Minh  Anh ", "vi"); err != nil || sess.User.DisplayName != "Minh Anh" {
		t.Fatalf("the typed name: %+v %v", sess.User, err)
	}

	// An address Google does not own starts unverified and gets its code.
	yahoo := f.googleTicket(t, GoogleClaims{Sub: "g-yahoo", Email: "an@yahoo.com", EmailVerified: true, Name: "An"}, TicketKindUnmatched)
	sess, err = tickets.Create(f.ctx, yahoo, WebTicket(), "", "en")
	if err != nil || sess.User.EmailVerifiedAt.Valid {
		t.Fatalf("an address Google does not own: %+v %v", sess.User, err)
	}
	f.mailOfKind(t, "an@yahoo.com", mail.KindVerificationCode)

	// The address became an account's after the ticket was issued.
	late := f.googleTicket(t, GoogleClaims{Sub: "g-late", Email: "late@gmail.com", EmailVerified: true, Name: "L"}, TicketKindUnmatched)
	if _, err := f.auth.Register(f.ctx, "late@gmail.com", "password123", "Đến trước", "vi"); err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Create(f.ctx, late, WebTicket(), "", "vi")
	wantStatusCode(t, err, "sign_in_account_conflict", http.StatusConflict)
	if f.count(t, `SELECT count(*) FROM users WHERE google_id = 'g-late'`) != 0 {
		t.Fatal("the late address was linked")
	}

	// link_required: the address has an account the identity may not join
	// by itself (Google does not own company.vn), so the ticket asks its
	// owner to sign in, and it creates nothing.
	work := registerVerified(t, f.q, f.auth, "an@company.vn", "An")
	required := f.googleTicket(t, GoogleClaims{Sub: "g-consumer", Email: "an@company.vn", EmailVerified: true}, TicketKindLinkRequired)
	if got, err := tickets.Describe(f.ctx, required, WebTicket()); err != nil || got.Kind != TicketKindLinkRequired {
		t.Fatalf("describe = %+v %v", got, err)
	}
	_, err = tickets.Create(f.ctx, required, WebTicket(), "Ai đó", "vi")
	wantStatusCode(t, err, "sign_in_account_conflict", http.StatusConflict)
	if f.usersWith(t, "an@company.vn") != 1 || f.user(t, work.ID).GoogleID.Valid {
		t.Fatal("a link_required ticket created or linked")
	}
}

// From the register screen (intent sign_up) a provider identity that
// matches nothing opens its account at once, without the choice screen; an
// address that has an account still gets the ticket, and an identity that
// opens an account signs in to it.
func TestSignUpIntentCreatesWithoutTheChoice(t *testing.T) {
	f := newIdentityFixture(t)
	res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-up", Email: "up@gmail.com", EmailVerified: true, Name: "Up"}, "vi", SignInIntentSignUp)
	if err != nil || res.Ticket != "" || res.Session.RefreshToken == "" || res.Session.User.Email != "up@gmail.com" || !res.Session.User.EmailVerifiedAt.Valid {
		t.Fatalf("sign_up creates: %+v %v", res, err)
	}
	again, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-up", Email: "up@gmail.com", EmailVerified: true}, "vi", SignInIntentSignUp)
	if err != nil || again.Session.User.ID != res.Session.User.ID || f.usersWith(t, "up@gmail.com") != 1 {
		t.Fatalf("sign_up on a matched identity signs in: %+v %v", again, err)
	}
	registerVerified(t, f.q, f.auth, "an@company.vn", "An")
	required, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-company", Email: "an@company.vn", EmailVerified: true}, "vi", SignInIntentSignUp)
	if err != nil || required.TicketKind != TicketKindLinkRequired || required.Session.AccessToken != "" || f.usersWith(t, "an@company.vn") != 1 {
		t.Fatalf("sign_up on an address with an account: %+v %v", required, err)
	}
}

// A ticket is bound to the channel it was issued on (ADR 0049 §3): a web
// ticket is taken only by the browser's routes, a native one only by the
// app's, with its client, deployment and the nonce whose hash it keeps. A
// blob of another purpose, a changed byte or an expired ticket is no ticket
// at all. Linking takes a bearer of the ticket's channel.
func TestSignInTicketIsBoundToItsChannel(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	web := f.googleTicket(t, GoogleClaims{Sub: "g-web", Email: "web@gmail.com", EmailVerified: true, Name: "W"}, TicketKindUnmatched)
	nativeApp := TicketBinding{Channel: SignInChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default", Nonce: "raw-nonce-1"}

	if _, err := tickets.Describe(f.ctx, web, nativeApp); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a web ticket on the app's route: %v", err)
	}
	native, err := f.auth.issueSignInTicket(googleIdentity(GoogleClaims{Sub: "g-app", Email: "app@gmail.com", EmailVerified: true}), TicketKindUnmatched, SignInIntentSignIn, nativeApp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(native, "raw-nonce-1") {
		t.Fatal("the ticket carries the nonce")
	}
	for name, b := range map[string]TicketBinding{
		"the browser":      WebTicket(),
		"no nonce":         {Channel: SignInChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default"},
		"another nonce":    {Channel: SignInChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default", Nonce: "raw-nonce-2"},
		"another client":   {Channel: SignInChannelNative, ClientID: "uniwork-office", DeploymentID: "default", Nonce: "raw-nonce-1"},
		"another rollout":  {Channel: SignInChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "beta", Nonce: "raw-nonce-1"},
		"no channel named": {},
	} {
		if _, err := tickets.Describe(f.ctx, native, b); !errors.Is(err, ErrSignInTicketChannel) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if got, err := tickets.Describe(f.ctx, native, nativeApp); err != nil || got.Email != "app@gmail.com" {
		t.Fatalf("the app that holds the nonce: %+v %v", got, err)
	}
	if _, err := f.auth.issueSignInTicket(googleIdentity(GoogleClaims{Sub: "g-x", Email: "x@gmail.com", EmailVerified: true}), TicketKindUnmatched, "", TicketBinding{Channel: SignInChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default"}); err == nil {
		t.Fatal("a native ticket without a nonce was issued")
	}

	// No ticket at all.
	pending, _ := f.sealer.SealFor(auth.PurposeMFAPendingLink, `{"v":1}`)
	for name, blob := range map[string]string{
		"none": "", "another purpose": pending, "changed": web[:len(web)-2] + "AA", "garbage": "not-a-ticket",
	} {
		if _, err := tickets.Describe(f.ctx, blob, WebTicket()); !errors.Is(err, ErrSignInTicketMissing) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	f.auth.now = func() time.Time { return time.Now().Add(signInTicketTTL + time.Second) }
	if _, err := tickets.Describe(f.ctx, web, WebTicket()); !errors.Is(err, ErrSignInTicketMissing) {
		t.Fatalf("an expired ticket: %v", err)
	}
	f.auth.now = time.Now

	// Linking: the bearer is of the ticket's channel.
	owner := registerVerified(t, f.q, f.auth, "owner@company.vn", "Owner")
	sess, err := f.auth.Login(f.ctx, owner.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tickets.Link(f.bearer(t, sess), native, nativeApp, TicketLink{}); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a native ticket with a browser bearer: %v", err)
	}
	device := f.deviceSignIn(t, owner.ID, "state-device")
	at, err := f.auth.minter.ParseAccessToken(device.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tickets.Link(auth.WithAccessToken(f.ctx, at), web, WebTicket(), TicketLink{}); !errors.Is(err, ErrSignInTicketChannel) {
		t.Fatalf("a web ticket with a device bearer: %v", err)
	}
	if f.user(t, owner.ID).GoogleID.Valid {
		t.Fatal("a refused link wrote")
	}
}

// "I already have an account" links into the account the person signs in to
// after the identity was proved (ADR 0049 §3): a session that started before
// the ticket is no proof the same person holds both, so it needs one (403
// proof_required, never 401). A session that ended is no session. The link
// is audited via ticket and told to the owner and to the provider's address.
func TestTicketLinkNeedsASessionStartedAfterTheTicket(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	ctx := WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Firefox/140", IP: "10.0.0.7"})
	owner := registerVerified(t, f.q, f.auth, "an@company.vn", "An")
	before, err := f.auth.Login(ctx, owner.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	f.backdate(t, before)
	ticket := f.googleTicket(t, GoogleClaims{Sub: "g-an", Email: "an.personal@gmail.com", EmailVerified: true, Name: "An"}, TicketKindUnmatched)

	_, err = tickets.Link(f.bearer(t, before), ticket, WebTicket(), TicketLink{})
	wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	if _, err := tickets.Link(f.ctx, ticket, WebTicket(), TicketLink{}); !errors.Is(err, ErrProofRequired) {
		t.Fatalf("no bearer on the context: %v", err)
	}
	if f.user(t, owner.ID).GoogleID.Valid {
		t.Fatal("an older session linked")
	}
	// An older session may still link once it proves it is the owner now
	// (spec §3.7): with a step-up token of that very session, not another's.
	dung := registerVerified(t, f.q, f.auth, "dung@company.vn", "Dũng")
	older, err := f.auth.Login(ctx, dung.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	f.backdate(t, older)
	dungTicket := f.googleTicket(t, GoogleClaims{Sub: "g-dung", Email: "dung.personal@gmail.com", EmailVerified: true, Name: "D"}, TicketKindUnmatched)
	otherCtx, _ := f.browser(t, dung.ID)
	otherGrant, err := f.auth.StepUp(otherCtx, dung.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Link(f.bearer(t, older), dungTicket, WebTicket(), TicketLink{StepUpToken: otherGrant.Token})
	wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	grant, err := f.auth.StepUp(f.bearer(t, older), dung.ID, StepUpProof{Password: "password123"})
	if err != nil {
		t.Fatal(err)
	}
	if out, err := tickets.Link(f.bearer(t, older), dungTicket, WebTicket(), TicketLink{StepUpToken: grant.Token}); err != nil || !out.Methods.Google.Linked {
		t.Fatalf("an older session with its own step-up token: %+v %v", out.Methods, err)
	}

	after, err := f.auth.Login(ctx, owner.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	out, err := tickets.Link(WithSessionMeta(f.bearer(t, after), SessionMeta{UserAgent: "Firefox/140", IP: "10.0.0.7"}), ticket, WebTicket(), TicketLink{})
	if err != nil {
		t.Fatal(err)
	}
	u := f.user(t, owner.ID)
	if out.User.ID != owner.ID || u.GoogleID.String != "g-an" || u.GoogleEmail.String != "an.personal@gmail.com" || u.Email != "an@company.vn" {
		t.Fatalf("linked = %+v / %+v", out.User, u)
	}
	if !out.Methods.Google.Linked || out.Methods.Google.Email != "an.personal@gmail.com" || !out.Methods.PasswordSet ||
		strings.Join(out.Methods.Proofs, ",") != "password,email_code" || out.Methods.Apple.Linked {
		t.Fatalf("methods = %+v", out.Methods)
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, "ticket") != 1 {
		t.Fatal("the link is audited via ticket")
	}
	for _, addr := range []string{"an@company.vn", "an.personal@gmail.com"} {
		notice := f.mailOfKind(t, addr, mail.KindSignInMethodChanged)
		if !strings.Contains(notice.Subject, "Google") || !strings.Contains(notice.Text, "Firefox/140") {
			t.Fatalf("%s hears of the link: %+v", addr, notice)
		}
	}
	// Twice (a second tab) is nothing new.
	if _, err := tickets.Link(f.bearer(t, after), ticket, WebTicket(), TicketLink{}); err != nil || f.linkAudits(t, owner.ID, ProviderGoogle, "ticket") != 1 {
		t.Fatalf("the same link twice: %v", err)
	}

	// A session signed out since is no session.
	other := registerVerified(t, f.q, f.auth, "binh@company.vn", "Bình")
	ticket = f.googleTicket(t, GoogleClaims{Sub: "g-binh", Email: "binh.personal@gmail.com", EmailVerified: true, Name: "B"}, TicketKindUnmatched)
	gone, err := f.auth.Login(f.ctx, other.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.auth.Logout(f.ctx, gone.RefreshToken); err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Link(f.bearer(t, gone), ticket, WebTicket(), TicketLink{})
	wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)

	// An account that never proved its address takes no link.
	unproved, err := f.auth.Register(f.ctx, "chi@company.vn", "password123", "Chi", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tickets.Link(f.bearer(t, unproved), ticket, WebTicket(), TicketLink{}); !errors.Is(err, ErrEmailUnverified) {
		t.Fatalf("an unverified account: %v", err)
	}
	// An account linked to another Google account already.
	fresh, err := f.auth.Login(f.ctx, owner.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Link(f.bearer(t, fresh), ticket, WebTicket(), TicketLink{})
	wantStatusCode(t, err, "sign_in_method_already_linked", http.StatusConflict)
	if f.count(t, `SELECT count(*) FROM users WHERE google_id = 'g-binh'`) != 0 {
		t.Fatal("refused links wrote")
	}
}

// "I was invited with another address" (spec §3.2): a code mailed to the
// address typed proves it, and the identity then joins the verified account
// the address holds (after its second factor when it has one), takes back
// the unverified account someone registered with it, or opens a new account
// with the address verified. Every way is audited via email_claim. The send
// answers the same for every address and one ticket mails a code a minute
// at most; five wrong guesses spend the code; a code is good for its own
// ticket only.
func TestEmailClaimLinksCreatesOrReclaims(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	ctx := WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Safari/19", IP: "10.0.0.5"})
	personal := GoogleClaims{Sub: "g-personal", Email: "an.personal@gmail.com", EmailVerified: true, Name: "An"}

	t.Run("link", func(t *testing.T) {
		owner := registerVerified(t, f.q, f.auth, "an@company.vn", "An")
		ticket := f.googleTicket(t, personal, TicketKindUnmatched)
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), " AN@Company.vn ", "vi"); err != nil {
			t.Fatal(err)
		}
		claim := f.mailOfKind(t, "an@company.vn", mail.KindSignInEmailClaim)
		if claim.UserID != "" || !strings.Contains(claim.Text, "Google") {
			t.Fatalf("the code names no user and the provider: %+v", claim)
		}
		err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "other@company.vn", "vi")
		if ce := wantStatusCode(t, err, "rate_limited", http.StatusTooManyRequests); ce.Fields["retry_after"] == nil {
			t.Fatalf("the resend gate says when: %+v", ce)
		}
		if _, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "an@company.vn", "000000", "", "vi"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("wrong code: %v", err)
		}
		other := f.googleTicket(t, GoogleClaims{Sub: "g-stranger", Email: "stranger@gmail.com", EmailVerified: true, Name: "S"}, TicketKindUnmatched)
		code := f.claimCode(t, "an@company.vn")
		if _, err := tickets.VerifyEmailClaim(ctx, other, WebTicket(), "an@company.vn", code, "", "vi"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("the code of another ticket: %v", err)
		}
		sess, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "an@company.vn", code, "", "vi")
		if err != nil || sess.User.ID != owner.ID || sess.RefreshToken == "" || sess.Reclaimed {
			t.Fatalf("verify: %+v %v", sess, err)
		}
		u := f.user(t, owner.ID)
		if u.GoogleID.String != "g-personal" || u.GoogleEmail.String != "an.personal@gmail.com" || u.Email != "an@company.vn" || !u.PasswordHash.Valid {
			t.Fatalf("linked = %+v", u)
		}
		if f.linkAudits(t, owner.ID, ProviderGoogle, "email_claim") != 1 {
			t.Fatal("audited via email_claim")
		}
		f.mailOfKind(t, "an@company.vn", mail.KindSignInMethodChanged)
		f.mailOfKind(t, "an.personal@gmail.com", mail.KindSignInMethodChanged)
		if _, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "an@company.vn", code, "", "vi"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("a code works once: %v", err)
		}
		// Google now opens the work account.
		res, err := f.google.SignIn(f.ctx, personal, "vi", SignInIntentSignIn)
		if err != nil || res.Session.User.ID != owner.ID {
			t.Fatalf("signing in with Google again: %+v %v", res, err)
		}
	})

	t.Run("create", func(t *testing.T) {
		ticket := f.googleTicket(t, GoogleClaims{Sub: "g-new", Email: "binh.personal@gmail.com", EmailVerified: true}, TicketKindUnmatched)
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "binh@company.vn", "en"); err != nil {
			t.Fatal(err)
		}
		if m := f.mailOfKind(t, "binh@company.vn", mail.KindSignInEmailClaim); m.Locale != "en" {
			t.Fatalf("the code speaks the screen's language: %+v", m)
		}
		sess, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "binh@company.vn", f.claimCode(t, "binh@company.vn"), "Trần Bình", "en")
		if err != nil || sess.RefreshToken == "" {
			t.Fatalf("verify: %+v %v", sess, err)
		}
		u := f.user(t, sess.User.ID)
		if u.Email != "binh@company.vn" || !u.EmailVerifiedAt.Valid || u.DisplayName != "Trần Bình" || u.GoogleID.String != "g-new" || u.GoogleEmail.String != "binh.personal@gmail.com" || u.PasswordHash.Valid {
			t.Fatalf("created = %+v", u)
		}
		if f.linkAudits(t, u.ID, ProviderGoogle, "email_claim") != 1 || f.usersWith(t, "binh.personal@gmail.com") != 0 {
			t.Fatal("one account, with the claimed address, audited via email_claim")
		}
	})

	t.Run("reclaim", func(t *testing.T) {
		s := f.squat(t, "victim@company.vn")
		ticket := f.googleTicket(t, GoogleClaims{Sub: "g-victim", Email: "victim.personal@gmail.com", EmailVerified: true, Name: "V"}, TicketKindUnmatched)
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "victim@company.vn", "vi"); err != nil {
			t.Fatal(err)
		}
		sess, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "victim@company.vn", f.claimCode(t, "victim@company.vn"), "", "vi")
		if err != nil || sess.User.ID != s.user.ID || !sess.Reclaimed || sess.MFAPending() {
			t.Fatalf("the mailbox's owner takes the account back without its second factor: %+v %v", sess, err)
		}
		f.assertGone(t, s, "victim@company.vn")
		if u := f.user(t, s.user.ID); u.GoogleID.String != "g-victim" || u.AppleID.Valid {
			t.Fatalf("only the owner's Google identity opens it now: %+v", u)
		}
		if f.linkAudits(t, s.user.ID, ProviderGoogle, "email_claim") != 1 {
			t.Fatal("the reclaim is audited via email_claim")
		}
	})

	t.Run("second factor", func(t *testing.T) {
		owner, secret, _ := f.mfaAccount(t, "mfa@company.vn")
		ticket := f.googleTicket(t, GoogleClaims{Sub: "g-mfa", Email: "mfa.personal@gmail.com", EmailVerified: true, Name: "M"}, TicketKindUnmatched)
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "mfa@company.vn", "vi"); err != nil {
			t.Fatal(err)
		}
		challenge, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "mfa@company.vn", f.claimCode(t, "mfa@company.vn"), "", "vi")
		if err != nil || !challenge.MFAPending() || challenge.RefreshToken != "" {
			t.Fatalf("the account's second factor is asked: %+v %v", challenge, err)
		}
		if f.user(t, owner.ID).GoogleID.Valid {
			t.Fatal("linked before the second factor")
		}
		sess, err := f.auth.VerifyMFA(ctx, challenge.MFAToken, totpNow(t, secret))
		if err != nil || sess.LinkSkipped != "" || sess.User.GoogleID.String != "g-mfa" {
			t.Fatalf("linked after it: %+v %v", sess, err)
		}
		if f.linkAudits(t, owner.ID, ProviderGoogle, "email_claim") != 1 {
			t.Fatal("audited via email_claim")
		}
	})

	t.Run("five wrong guesses", func(t *testing.T) {
		ticket := f.googleTicket(t, GoogleClaims{Sub: "g-guess", Email: "guess.personal@gmail.com", EmailVerified: true, Name: "G"}, TicketKindUnmatched)
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "guess@company.vn", "vi"); err != nil {
			t.Fatal(err)
		}
		code := f.claimCode(t, "guess@company.vn")
		wrong := "000000"
		if code == wrong {
			wrong = "111111"
		}
		for i := 0; i < 5; i++ {
			if _, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "guess@company.vn", wrong, "", "vi"); !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("guess %d: %v", i+1, err)
			}
		}
		if _, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), "guess@company.vn", code, "", "vi"); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("the code survived five wrong guesses: %v", err)
		}
		if f.usersWith(t, "guess@company.vn") != 0 {
			t.Fatal("a spent code created an account")
		}
		if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), "not an address", "vi"); !errors.As(err, new(ValidationError)) {
			t.Fatalf("an address that cannot be one: %v", err)
		}
	})

	t.Run("an address's day", func(t *testing.T) {
		// Tickets cost nothing (every provider round trip mints one), so the
		// address bounds what any number of them can do to it: five codes a
		// day, and once ten wrong guesses were spent on it, no more codes
		// and no code checked — not even the right one.
		owner := registerVerified(t, f.q, f.auth, "boss@company.vn", "Boss")
		fresh := func(i int) string {
			return f.googleTicket(t, GoogleClaims{Sub: fmt.Sprintf("g-flood-%d", i), Email: fmt.Sprintf("flood%d@gmail.com", i), EmailVerified: true, Name: "F"}, TicketKindUnmatched)
		}
		for i := 0; i < 5; i++ {
			if err := tickets.SendEmailClaim(ctx, fresh(i), WebTicket(), "boss@company.vn", "vi"); err != nil {
				t.Fatalf("code %d: %v", i+1, err)
			}
		}
		err := tickets.SendEmailClaim(ctx, fresh(5), WebTicket(), "Boss@Company.vn", "vi")
		if ce := wantStatusCode(t, err, "rate_limited", http.StatusTooManyRequests); ce.Fields["retry_after"] == nil {
			t.Fatalf("the address's day names its wait: %+v", ce)
		}
		codes := 0
		for _, m := range f.mailsTo("boss@company.vn") {
			if m.Kind == mail.KindSignInEmailClaim {
				codes++
			}
		}
		if codes != 5 {
			t.Fatalf("the address got %d codes, want 5", codes)
		}

		target := "guessed@company.vn"
		guessed := registerVerified(t, f.q, f.auth, target, "Guessed")
		// A code mailed earlier on a third ticket, still live, and known
		// here: it stands for the one the guesses below are after.
		pending := fresh(12)
		if _, err := f.q.CreateSignInEmailClaim(f.ctx, db.CreateSignInEmailClaimParams{
			ID: util.NewID(), TicketHash: ticketHash(pending), Email: target, CodeHash: hashToken("123456"),
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(emailClaimTTL), Valid: true},
			CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 2; i++ {
			ticket := fresh(10 + i)
			if err := tickets.SendEmailClaim(ctx, ticket, WebTicket(), target, "vi"); err != nil {
				t.Fatal(err)
			}
			wrong := "000000"
			if f.claimCode(t, target) == wrong {
				wrong = "111111"
			}
			for j := 0; j < 5; j++ {
				if _, err := tickets.VerifyEmailClaim(ctx, ticket, WebTicket(), target, wrong, "", "vi"); !errors.Is(err, ErrInvalidCode) {
					t.Fatalf("guess %d: %v", 5*i+j+1, err)
				}
			}
		}
		_, err = tickets.VerifyEmailClaim(ctx, pending, WebTicket(), target, "123456", "", "vi")
		wantStatusCode(t, err, "rate_limited", http.StatusTooManyRequests)
		err = tickets.SendEmailClaim(ctx, fresh(20), WebTicket(), target, "vi")
		wantStatusCode(t, err, "rate_limited", http.StatusTooManyRequests)
		if u := f.user(t, guessed.ID); u.GoogleID.Valid {
			t.Fatalf("a guessed address took an identity: %+v", u)
		}
		if f.user(t, owner.ID).GoogleID.Valid {
			t.Fatal("a flooded address took an identity")
		}
		// The cleanup keeps the day the budget counts.
		if err := f.q.DeleteExpiredSignInEmailClaims(f.ctx); err != nil {
			t.Fatal(err)
		}
		if n := f.count(t, `SELECT count(*) FROM sign_in_email_claims WHERE email = 'boss@company.vn'`); n != 5 {
			t.Fatalf("the day's claims kept: %d", n)
		}
	})
}

// The identity a person proves may already open another account — the empty
// one a provider sign-in used to create without asking (ADR 0049 §2c). It
// moves into the account they are signed in to only when that account never
// belonged to an organization, and only when they say so (move): the empty
// account is erased, its sessions end, both sides are audited via move and
// told. An account with an organization in its history keeps it
// (sign_in_method_taken, its address masked so the person knows where to
// sign in to unlink).
func TestAProviderIdentityMovesOnlyFromAnEmptyAccount(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	owner := registerVerified(t, f.q, f.auth, "an@company.vn", "An")

	// The ticket created an account in another tab: an empty account now
	// holds the identity, with a session, a phone and a push.
	ticket := f.googleTicket(t, GoogleClaims{Sub: "g-move", Email: "move@gmail.com", EmailVerified: true, Name: "M"}, TicketKindUnmatched)
	empty, err := tickets.Create(f.ctx, ticket, WebTicket(), "", "vi")
	if err != nil {
		t.Fatal(err)
	}
	device := f.deviceSignIn(t, empty.User.ID, "state-empty")
	pushID := f.push(t, empty.User.ID, "")

	sess, err := f.auth.Login(f.ctx, owner.Email, "password123")
	if err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Link(f.bearer(t, sess), ticket, WebTicket(), TicketLink{})
	if ce := wantStatusCode(t, err, "sign_in_method_movable", http.StatusConflict); ce.Fields["masked_email"] != "m•••@gmail.com" {
		t.Fatalf("masked = %v", ce.Fields)
	}
	if f.user(t, empty.User.ID).GoogleID.String != "g-move" || f.user(t, owner.ID).GoogleID.Valid {
		t.Fatal("nothing moves without move")
	}

	out, err := tickets.Link(f.bearer(t, sess), ticket, WebTicket(), TicketLink{Move: true})
	if err != nil || out.User.GoogleID.String != "g-move" {
		t.Fatalf("move: %+v %v", out, err)
	}
	gone := f.user(t, empty.User.ID)
	if !gone.DeletedAt.Valid || gone.GoogleID.Valid || gone.Email == "move@gmail.com" || !gone.CredentialsRevokedAt.Valid {
		t.Fatalf("the empty account is erased: %+v", gone)
	}
	if _, err := f.auth.Refresh(f.ctx, empty.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("its browser session: %v", err)
	}
	if err := f.desktop.CheckDeviceSession(f.ctx, empty.User.ID, device.DeviceSessionID); err == nil {
		t.Fatal("its phone is still signed in")
	}
	if f.live(t, "push_subscriptions", pushID) {
		t.Fatal("its push is live")
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, "move") != 1 {
		t.Fatal("the link is audited via move")
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'provider' = 'google' AND metadata::jsonb->>'via' = 'move' AND metadata::jsonb->>'moved_to' = $3`,
		audit.ActionAuthSignInMethodUnlinked, empty.User.ID, owner.ID); n != 1 {
		t.Fatalf("%d unlinks via move on the empty account", n)
	}
	for _, action := range []string{audit.ActionUserDeleted, audit.ActionAuthSessionRevoked} {
		if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'reason' = 'moved'`, action, empty.User.ID); n != 1 {
			t.Fatalf("%d %s rows (reason moved) on the empty account", n, action)
		}
	}
	if n := f.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'session.revoked' AND payload::jsonb->>'user_id' = $1 AND payload::jsonb->>'session_id' = ''`, empty.User.ID); n != 1 {
		t.Fatal("every socket of the empty account closes")
	}
	if m := f.mailOfKind(t, "move@gmail.com", mail.KindSignInMethodChanged); m.UserID != empty.User.ID || !strings.Contains(m.Subject, "sang một tài khoản") {
		t.Fatalf("the empty account is told where it went: %+v", m)
	}
	if m := f.mailOfKind(t, "an@company.vn", mail.KindSignInMethodChanged); !strings.Contains(m.Subject, "chuyển vào") {
		t.Fatalf("the owner is told it moved in: %+v", m)
	}
	res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-move", Email: "move@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	if err != nil || res.Session.User.ID != owner.ID {
		t.Fatalf("Google opens the owner's account now: %+v %v", res, err)
	}

	// An account that belongs to an organization, or ever did, keeps it.
	for name, history := range map[string]func(uid string){
		"member": func(uid string) {
			if _, err := NewOrganizationService(f.pool, f.q).Create(f.ctx, uid, "Công ty", "cong-ty-"+strings.ToLower(util.NewID()[20:])); err != nil {
				t.Fatal(err)
			}
		},
		"left one": func(uid string) {
			if err := auditRecorder.Record(f.ctx, f.q, audit.Entry{
				OrganizationID: util.NewID(), Actor: audit.User(uid), Action: audit.ActionMemberLeft,
				ResourceType: "organization_member", ResourceID: uid,
			}); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			sub := "g-busy-" + strings.ReplaceAll(name, " ", "-")
			ticket := f.googleTicket(t, GoogleClaims{Sub: sub, Email: sub + "@gmail.com", EmailVerified: true, Name: "B"}, TicketKindUnmatched)
			busy, err := tickets.Create(f.ctx, ticket, WebTicket(), "", "vi")
			if err != nil {
				t.Fatal(err)
			}
			history(busy.User.ID)
			other := registerVerified(t, f.q, f.auth, sub+"@company.vn", "O")
			sess, err := f.auth.Login(f.ctx, other.Email, "password123")
			if err != nil {
				t.Fatal(err)
			}
			for _, move := range []bool{false, true} {
				_, err := tickets.Link(f.bearer(t, sess), ticket, WebTicket(), TicketLink{Move: move})
				if ce := wantStatusCode(t, err, "sign_in_method_taken", http.StatusConflict); ce.Fields["masked_email"] != "g•••@gmail.com" {
					t.Fatalf("masked = %v", ce.Fields)
				}
			}
			if u := f.user(t, busy.User.ID); u.DeletedAt.Valid || u.GoogleID.String != sub {
				t.Fatalf("an account with a history was touched: %+v", u)
			}
		})
	}
}

// A link from Settings that answers movable leaves a ticket bound to the
// browser session that started the link (spec §3.7): that session bought
// the link's step-up and carried the provider round trip, so it confirms the
// move without another proof while the ticket lives. Any other session, a
// ticket that names no session, or one past its fifteen minutes still needs
// what any ticket link needs.
func TestASettingsMoveIsProvedByTheSessionThatStartedTheLink(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	methods := NewSignInMethodsService(f.pool, f.q, f.auth)
	claims := GoogleClaims{Sub: "g-settings-move", Email: "settings.move@gmail.com", EmailVerified: true, Name: "M"}
	if _, err := tickets.Create(f.ctx, f.googleTicket(t, claims, TicketKindUnmatched), WebTicket(), "", "vi"); err != nil {
		t.Fatal(err)
	}
	owner := registerVerified(t, f.q, f.auth, "chi@company.vn", "Chi")
	// Both sessions began before the ticket: freshness proves nothing here.
	bctx, bsess := f.browser(t, owner.ID)
	f.backdate(t, bsess)
	otherCtx, other := f.browser(t, owner.ID)
	f.backdate(t, other)
	li := LinkIntent{UserID: owner.ID, SessionID: bsess.SessionID, Provider: ProviderGoogle, ReturnTo: "/settings?tab=security"}
	id := googleIdentity(claims)

	res, err := methods.LinkFromBrowser(bctx, li, id, bsess.RefreshToken)
	if !errors.Is(err, ErrSignInMethodMovable) || res.Ticket == "" {
		t.Fatalf("want movable with a ticket: %+v %v", res, err)
	}
	_, err = tickets.Link(otherCtx, res.Ticket, WebTicket(), TicketLink{Move: true})
	wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	plain, err := f.auth.issueSignInTicket(id, TicketKindLinkRequired, SignInIntentSignIn, WebTicket())
	if err != nil {
		t.Fatal(err)
	}
	_, err = tickets.Link(bctx, plain, WebTicket(), TicketLink{Move: true})
	wantStatusCode(t, err, "proof_required", http.StatusForbidden)
	f.auth.now = func() time.Time { return time.Now().Add(signInTicketTTL + time.Second) }
	_, err = tickets.Link(bctx, res.Ticket, WebTicket(), TicketLink{Move: true})
	wantStatusCode(t, err, "sign_in_ticket_missing", http.StatusNotFound)
	f.auth.now = time.Now
	if f.user(t, owner.ID).GoogleID.Valid {
		t.Fatal("a refused move wrote")
	}

	// The session that started the link: still asked first, then moved.
	_, err = tickets.Link(bctx, res.Ticket, WebTicket(), TicketLink{})
	wantStatusCode(t, err, "sign_in_method_movable", http.StatusConflict)
	out, err := tickets.Link(bctx, res.Ticket, WebTicket(), TicketLink{Move: true})
	if err != nil || out.User.GoogleID.String != claims.Sub || !out.Methods.Google.Linked {
		t.Fatalf("the move from the session that started the link: %+v %v", out, err)
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, "move") != 1 {
		t.Fatal("the move is audited via move")
	}
}

// maskEmail keeps the first character of the mailbox and the domain.
func TestMaskEmailShowsOnlyEnoughToRecognise(t *testing.T) {
	for in, want := range map[string]string{
		"an@icloud.com": "a•••@icloud.com", "ngọc@company.vn": "n•••@company.vn",
		"q7x2@privaterelay.appleid.com": "q•••@privaterelay.appleid.com", "": "•••", "nobody": "•••", "@x.vn": "•••",
	} {
		if got := maskEmail(in); got != want {
			t.Errorf("maskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

// The ways in a Settings row shows: an account with a second factor proves
// itself with the factor only; the app's provider proofs are the app's.
func TestSignInMethodsListTheProofsAnAccountTakes(t *testing.T) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	relay := db.User{
		Email: "q7x@privaterelay.appleid.com", AppleID: pgtype.Text{String: "a", Valid: true},
		AppleEmail: pgtype.Text{String: "q7x@privaterelay.appleid.com", Valid: true}, AppleLinkedAt: now,
	}
	m := signInMethodsOf(relay, SignInChannelNative)
	if m.PasswordSet || !m.Apple.Linked || !m.Apple.PrivateRelay || !m.AccountEmailIsRelay || m.Apple.LinkedAt == nil ||
		strings.Join(m.Proofs, ",") != "email_code,apple" {
		t.Fatalf("relay on the app = %+v", m)
	}
	if web := signInMethodsOf(relay, SignInChannelWeb); strings.Join(web.Proofs, ",") != "email_code" {
		t.Fatalf("relay on the web = %+v", web)
	}
	relay.MfaEnabledAt = now
	if m := signInMethodsOf(relay, SignInChannelNative); strings.Join(m.Proofs, ",") != "totp" {
		t.Fatalf("with a second factor = %+v", m.Proofs)
	}
}

// "Cancel" gives back to Apple the consent an Apple ticket carries: it opens
// no account. One the Apple ID's account holds by now (the same ticket
// created it in another tab) stays.
func TestCancellingTheChoiceGivesTheAppleConsentBack(t *testing.T) {
	f := newIdentityFixture(t)
	tickets := f.tickets()
	revoked := func() string {
		f.client.mu.Lock()
		defer f.client.mu.Unlock()
		return strings.Join(f.client.revoked, ",")
	}
	issue := func(sub, token string) string {
		t.Helper()
		sealed, err := f.sealer.Seal(token)
		if err != nil {
			t.Fatal(err)
		}
		id := appleIdentity(auth.AppleClaims{Sub: sub, Email: sub + "@icloud.com", EmailVerified: true, Audience: appleBundle}, "An", "", sealed)
		ticket, err := f.auth.issueSignInTicket(id, TicketKindUnmatched, SignInIntentSignIn, WebTicket())
		if err != nil {
			t.Fatal(err)
		}
		return ticket
	}

	tickets.Discard(f.ctx, issue("a-cancel", "refresh-cancel"), WebTicket())
	if !strings.Contains(revoked(), appleBundle+" refresh-cancel") {
		t.Fatalf("the consent of a cancelled sign-in is given back: %q", revoked())
	}

	kept := issue("a-kept", "refresh-kept")
	sess, err := tickets.Create(f.ctx, kept, WebTicket(), "", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if u := f.user(t, sess.User.ID); u.AppleClientID.String != appleBundle || u.AppleRefreshTokenEnc.String == "" {
		t.Fatalf("the account created from an Apple ticket keeps its consent: %+v", u)
	}
	tickets.Discard(f.ctx, kept, WebTicket())
	if strings.Contains(revoked(), "refresh-kept") {
		t.Fatalf("an account's consent was given back: %q", revoked())
	}
	tickets.Discard(f.ctx, "not-a-ticket", WebTicket())
}
