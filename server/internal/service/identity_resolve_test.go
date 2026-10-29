package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// identityFixture wires both provider sign-ins on one database, with mail
// recorded, the shared sealer, a fake Apple and the desktop flow (for the
// device sessions and approved codes a reclaim must end).
type identityFixture struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	q       *db.Queries
	auth    *AuthService
	google  *GoogleAuthService
	apple   *AppleAuthService
	desktop *DesktopAuthService
	issuer  *appletest.Issuer
	client  *fakeAppleClient
	out     *fakeOutbox
	sealer  auth.SecretSealer
}

const identitySecret = "identity-test"

func newIdentityFixture(t *testing.T) *identityFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte(identitySecret), TTL: time.Minute}
	out := &fakeOutbox{}
	renderer := mail.Renderer{AppURL: "http://localhost:3000"}
	as := NewAuthService(pool, q, minter, time.Hour, NewVerificationService(q, renderer, out, ""))
	as.SetMail(renderer, out)
	sealer, err := auth.NewSecretSealer(minter.Secret)
	if err != nil {
		t.Fatal(err)
	}
	as.SetSealer(sealer)
	cfg := config.Config{
		JWTSecret: identitySecret, FrontendOrigin: "http://localhost:3000",
		DesktopAuthClients: []config.DesktopAuthClient{
			{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback"}},
			{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}},
		},
		DesktopAuthDeploymentIDs: []string{"default"}, DesktopAuthCodeTTL: 2 * time.Minute,
		DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour,
	}
	desktop := NewDesktopAuthService(pool, q, minter, cfg)
	issuer := appletest.New(t)
	client := &fakeAppleClient{}
	verifier := auth.NewAppleVerifier(auth.AppleIssuer, issuer.JWKSURL, []string{appleBundle}, nil)
	apple := NewAppleAuthService(pool, q, desktop, verifier, client, sealer)
	apple.SetMail(renderer, out)
	apple.SetWeb(as, AppleWeb{
		ServicesID: appleServicesID, RedirectURI: appleWebReturn, Client: client,
		Verifier: auth.NewAppleVerifier(auth.AppleIssuer, issuer.JWKSURL, []string{appleServicesID}, nil),
	})
	as.SetApple(apple)
	return &identityFixture{
		ctx: context.Background(), pool: pool, q: q, auth: as, google: NewGoogleAuthService(as),
		apple: apple, desktop: desktop, issuer: issuer, client: client, out: out, sealer: sealer,
	}
}

// appleSignIn is the shipped iPhone app's POST /auth/apple/native.
func (f *identityFixture) appleSignIn(t *testing.T, sub, email string, private bool) (DesktopSession, error) {
	t.Helper()
	nonce := util.NewID()
	return f.apple.SignIn(f.ctx, AppleSignInInput{
		IdentityToken: f.issuer.Token(t, appletest.Claims(appleBundle, sub, email, private, nonce)), Nonce: nonce,
		AuthorizationCode: "code-" + sub, ClientID: "uniwork-chat-mobile", DeploymentID: "default",
		DeviceLabel: "UniChat (iOS)", Platform: "ios", Locale: "vi",
	})
}

func (f *identityFixture) user(t *testing.T, id string) db.User {
	t.Helper()
	u, err := f.q.GetUserByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func (f *identityFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// linkAudits counts the sign_in_method_linked rows of userID for provider and via.
func (f *identityFixture) linkAudits(t *testing.T, userID, provider, via string) int {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'provider' = $3 AND metadata::jsonb->>'via' = $4`,
		audit.ActionAuthSignInMethodLinked, userID, provider, via)
}

// newLogins counts the new-login alerts queued for an address.
func (f *identityFixture) newLogins(to string) int {
	n := 0
	for _, m := range f.mailsTo(to) {
		if m.Kind == mail.KindNewLogin {
			n++
		}
	}
	return n
}

// ownerBrowser is a request from a browser the squatter never used, whose
// first session on the account would otherwise read as a new device.
func (f *identityFixture) ownerBrowser() context.Context {
	return WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Mozilla/5.0 (Owner's Mac) Safari/18", IP: "198.51.100.7"})
}

// mailsTo lists the kinds queued for an address.
func (f *identityFixture) mailsTo(to string) []mail.Message {
	f.out.mu.Lock()
	defer f.out.mu.Unlock()
	var out []mail.Message
	for _, m := range f.out.queued {
		if m.To == to {
			out = append(out, m)
		}
	}
	return out
}

func (f *identityFixture) mailOfKind(t *testing.T, to, kind string) mail.Message {
	t.Helper()
	for _, m := range f.mailsTo(to) {
		if m.Kind == kind {
			return m
		}
	}
	t.Fatalf("no %s mail to %s; queued: %v", kind, to, f.mailsTo(to))
	return mail.Message{}
}

func refused(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
}

// Linking by address joins two accounts' worth of trust, so both sides must
// have proved the mailbox (ADR 0049): the provider vouches for the address,
// and the account verified it. Neither half alone links anything, and the
// link queries themselves refuse an unverified account.
func TestProviderSignInLinksByEmailOnlyWhenBothSidesVerified(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := WithSessionMeta(f.ctx, SessionMeta{UserAgent: "Firefox", IP: "10.0.0.9"})

	owner := registerVerified(t, f.q, f.auth, "an@gmail.com", "An")
	res, err := f.google.SignIn(ctx, GoogleClaims{Sub: "g-an", Email: " AN@gmail.com ", EmailVerified: true, Picture: "https://img/a.png"}, "vi", SignInIntentSignIn)
	if err != nil {
		t.Fatal(err)
	}
	u := f.user(t, owner.ID)
	if res.Session.User.ID != owner.ID || res.Reclaimed || u.GoogleID.String != "g-an" || u.GoogleEmail.String != "an@gmail.com" || !u.GoogleLinkedAt.Valid {
		t.Fatalf("verified on both sides links: %+v / %+v", res, u)
	}
	if u.DisplayName != "An" || u.AvatarUrl.String != "https://img/a.png" || !u.PasswordHash.Valid {
		t.Fatalf("the link keeps the account as it was, filling an empty avatar: %+v", u)
	}
	if _, err := f.auth.Login(ctx, "an@gmail.com", "password123"); err != nil {
		t.Fatalf("the password still works: %v", err)
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, "email_match") != 1 {
		t.Fatal("the link is audited as an email match")
	}
	notice := f.mailOfKind(t, "an@gmail.com", mail.KindSignInMethodChanged)
	if !strings.Contains(notice.Subject, "Google") || !strings.Contains(notice.Text, "Firefox") || !strings.Contains(notice.Text, "10.0.0.9") {
		t.Fatalf("the owner hears of the new way in, and from where: %+v", notice)
	}

	// The provider does not vouch for the address.
	binh := registerVerified(t, f.q, f.auth, "binh@gmail.com", "Bình")
	_, err = f.google.SignIn(ctx, GoogleClaims{Sub: "g-binh", Email: "binh@gmail.com", EmailVerified: false}, "vi", SignInIntentSignIn)
	refused(t, err, ErrSignInEmailUnverified)
	if f.user(t, binh.ID).GoogleID.Valid {
		t.Fatal("an address Google does not vouch for links nothing")
	}

	// The account never proved the address (and Google does not own it, so
	// this is not a reclaim either).
	typed, err := f.auth.Register(ctx, "chi@example.com", "password123", "Chi", "vi")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.google.SignIn(ctx, GoogleClaims{Sub: "g-chi", Email: "chi@example.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	refused(t, err, ErrSignInAccountUnverified)
	if u := f.user(t, typed.User.ID); u.GoogleID.Valid || u.EmailVerifiedAt.Valid || !u.PasswordHash.Valid {
		t.Fatalf("an unverified account is neither linked nor verified by a sign-in: %+v", u)
	}

	// Apple, through the shipped app's route: the same rule.
	dung := registerVerified(t, f.q, f.auth, "dung@icloud.com", "Dũng")
	sess, err := f.appleSignIn(t, "a-dung", "dung@icloud.com", false)
	if err != nil || sess.AccountID != dung.ID {
		t.Fatalf("verified on both sides links Apple too: %+v %v", sess, err)
	}
	if u := f.user(t, dung.ID); u.AppleID.String != "a-dung" || u.AppleEmail.String != "dung@icloud.com" || !u.AppleLinkedAt.Valid {
		t.Fatalf("apple link = %+v", u)
	}
	if f.linkAudits(t, dung.ID, ProviderApple, "email_match") != 1 {
		t.Fatal("the Apple link is audited as an email match")
	}

	// The queries hold it too: no link ever lands on an unverified account,
	// and none verifies an address.
	email := pgtype.Text{String: "chi@example.com", Valid: true}
	if _, err := f.q.LinkGoogleAccount(ctx, db.LinkGoogleAccountParams{ID: typed.User.ID, GoogleID: pgtype.Text{String: "x", Valid: true}, GoogleEmail: email}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("LinkGoogleAccount on an unverified account: %v", err)
	}
	if _, err := f.q.LinkAppleAccount(ctx, db.LinkAppleAccountParams{ID: typed.User.ID, AppleID: pgtype.Text{String: "x", Valid: true}, AppleEmail: email}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("LinkAppleAccount on an unverified account: %v", err)
	}
}

// Only a provider that owns the address's domain speaks for its mailbox
// (ADR 0049): Gmail or the Workspace hd for Google, iCloud or the relay for
// Apple. Any other address the provider "verified" joins no account by
// itself and reclaims none.
func TestProviderSignInTrustsOnlyAuthoritativeEmail(t *testing.T) {
	for _, tc := range []struct {
		c    auth.GoogleClaims
		want bool
	}{
		{auth.GoogleClaims{Email: "a@gmail.com"}, true},
		{auth.GoogleClaims{Email: "A@GoogleMail.com"}, true},
		{auth.GoogleClaims{Email: "a@company.vn", HD: "company.vn"}, true},
		{auth.GoogleClaims{Email: "a@company.vn", HD: "COMPANY.VN"}, true},
		{auth.GoogleClaims{Email: "a@company.vn"}, false},
		{auth.GoogleClaims{Email: "a@company.vn", HD: "other.vn"}, false},
		{auth.GoogleClaims{Email: "a@mail.company.vn", HD: "company.vn"}, false},
		{auth.GoogleClaims{Email: "a@gmail.com.evil.vn"}, false},
	} {
		if got := googleIdentity(tc.c).EmailAuthoritative; got != tc.want {
			t.Errorf("google %+v: authoritative = %v, want %v", tc.c, got, tc.want)
		}
	}
	for _, tc := range []struct {
		email          string
		private        bool
		want, wantRely bool
	}{
		{"a@icloud.com", false, true, false},
		{"a@me.com", false, true, false},
		{"a@mac.com", false, true, false},
		{"Q7x@PrivateRelay.AppleID.com", true, true, true},
		// The relay addresses Apple issues from late 2026 on.
		{"q7x@private.icloud.com", true, true, true},
		// The relay's domain marks the address even when the token leaves
		// is_private_email out.
		{"Q7x@Private.iCloud.com", false, true, true},
		{"q7x@privaterelay.appleid.com", false, true, true},
		{"a@mail.private.icloud.com", false, false, false},
		{"a@private.icloud.com.evil.vn", false, false, false},
		{"a@gmail.com", false, false, false},
		{"a@icloud.com.evil.vn", false, false, false},
	} {
		id := appleIdentity(auth.AppleClaims{Email: tc.email, PrivateEmail: tc.private}, "", "", "")
		if id.EmailAuthoritative != tc.want || id.PrivateRelay != tc.wantRely || id.Email != strings.ToLower(tc.email) {
			t.Errorf("apple %s: %+v", tc.email, id)
		}
	}

	f := newIdentityFixture(t)
	work := registerVerified(t, f.q, f.auth, "an@company.vn", "An")
	// A consumer Google account that uses a company address: Google does not
	// own company.vn, so the account is not joined; the choice screen asks
	// its owner to sign in to it and link from there.
	consumer, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-consumer", Email: "an@company.vn", EmailVerified: true}, "vi", SignInIntentSignIn)
	if err != nil || consumer.TicketKind != TicketKindLinkRequired || consumer.Session.AccessToken != "" {
		t.Fatalf("a non-authoritative address gets the link_required ticket: %+v %v", consumer, err)
	}
	if f.user(t, work.ID).GoogleID.Valid {
		t.Fatal("a non-authoritative address linked")
	}
	// The company's own Workspace account: its hd is the address's domain.
	res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-workspace", Email: "an@company.vn", EmailVerified: true, HD: "company.vn"}, "vi", SignInIntentSignIn)
	if err != nil || res.Session.User.ID != work.ID {
		t.Fatalf("the Workspace account links: %+v %v", res, err)
	}
	// An Apple ID that uses a Gmail address does not speak for Gmail.
	gmail := registerVerified(t, f.q, f.auth, "binh@gmail.com", "Bình")
	_, err = f.appleSignIn(t, "a-binh", "binh@gmail.com", false)
	refused(t, err, ErrAppleAccountConflict)
	if f.user(t, gmail.ID).AppleID.Valid {
		t.Fatal("an Apple ID on a Gmail address linked")
	}
	// Nor does it reclaim an account that never proved its address.
	typed, err := f.auth.Register(f.ctx, "chi@outlook.com", "password123", "Chi", "vi")
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-chi", Email: "chi@outlook.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	refused(t, err, ErrSignInAccountUnverified)
	if u := f.user(t, typed.User.ID); !u.PasswordHash.Valid || u.EmailVerifiedAt.Valid {
		t.Fatalf("a non-authoritative address reclaimed: %+v", u)
	}
}

// A relay address is one whose domain, after the last "@", is one of Apple's
// relay domains exactly, whatever its case: a subdomain, a lookalike or a
// mention of the domain is not, and neither is an iCloud address (iCloud+'s
// own Hide My Email stays on icloud.com). packages/core/auth/sign-in-rules.ts
// holds the same cases.
func TestRelayAddressIsExactlyAtAnAppleRelayDomain(t *testing.T) {
	for email, want := range map[string]bool{
		"q7x@privaterelay.appleid.com": true, "q7x@private.icloud.com": true,
		"Q7X@PrivateRelay.AppleID.com ": true, " Q7x@Private.iCloud.com": true,
		"a@icloud.com": false, "a@mail.private.icloud.com": false, "a@private.icloud.com.evil.vn": false,
		"private.icloud.com@example.com": false, "@private.icloud.com": false, " @privaterelay.appleid.com": false,
		"private.icloud.com": false, "": false,
	} {
		if got := isRelayAddress(email); got != want {
			t.Errorf("isRelayAddress(%q) = %v, want %v", email, got, want)
		}
	}
}

// squatter is an account someone registered with the victim's address before
// its owner arrived, with everything that person could have left on it.
type squatter struct {
	user          db.User
	webRefresh    string
	device        DesktopSession
	approvedCode  string
	codeVerifier  string
	mcpAttemptID  string
	resetTokenRaw string
	firstIssuedAt time.Time
}

func (f *identityFixture) squat(t *testing.T, email string) squatter {
	t.Helper()
	ctx := f.ctx
	var s squatter
	s.firstIssuedAt = time.Now().Truncate(time.Second)
	reg, err := f.auth.Register(ctx, email, "squatter-pass", "Kẻ chiếm", "vi")
	if err != nil {
		t.Fatal(err)
	}
	s.webRefresh = reg.RefreshToken
	uid := reg.User.ID
	if f.count(t, `SELECT count(*) FROM email_verification_codes WHERE user_id = $1`, uid) == 0 {
		t.Fatal("the squatter has a pending verification code")
	}

	// A device session through the PKCE flow, and a second attempt approved
	// whose code nobody redeemed yet.
	s.codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	sum := sha256.Sum256([]byte(s.codeVerifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	approve := func(state string) string {
		attempt, err := f.desktop.Start(ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: challenge, CodeChallengeMethod: "S256", State: state, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default", DeviceLabel: "Laptop", Platform: "windows", Build: "1.0"})
		if err != nil {
			t.Fatal(err)
		}
		consent, err := f.desktop.Consent(ctx, uid, attempt.ID)
		if err != nil {
			t.Fatal(err)
		}
		code, _, err := f.desktop.Approve(ctx, uid, attempt.ID, consent.CSRFToken)
		if err != nil {
			t.Fatal(err)
		}
		return code
	}
	if s.device, err = f.desktop.Exchange(ctx, "uniwork-office", approve("state-1"), s.codeVerifier, "uniwork-office://auth/callback", "default"); err != nil {
		t.Fatal(err)
	}
	s.approvedCode = approve("state-2")

	// A browser push and the device's push.
	for i, session := range []pgtype.Text{{}, {String: s.device.SessionID, Valid: true}} {
		if _, err := f.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
			ID: util.NewID(), UserID: uid, Endpoint: "https://push.example/" + uid + string(rune('a'+i)), P256dh: "p", Auth: "a", SessionID: session,
		}); err != nil {
			t.Fatal(err)
		}
	}
	// An MCP consent the squatter opened, and a reset link mailed to the box.
	s.mcpAttemptID = util.NewID()
	if _, err := f.pool.Exec(ctx, `INSERT INTO mcp_auth_attempts (id, client_id, redirect_uri, code_challenge, scope, resource, user_id, expires_at)
		VALUES ($1, 'client', 'https://x.test/cb', 'c', 'read', 'https://api.test/mcp', $2, now() + interval '10 minutes')`, s.mcpAttemptID, uid); err != nil {
		t.Fatal(err)
	}
	s.resetTokenRaw = util.NewID() + util.NewID()
	if _, err := f.q.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: uid, TokenHash: hashToken(s.resetTokenRaw),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	// A second factor, an Apple ID and another Google account, an AI answer:
	// set straight in the row, as an account from before the verified-email
	// gates would carry them.
	totp, _ := auth.NewTOTPSecret()
	sealedTOTP, _ := f.sealer.Seal(totp)
	sealedApple, _ := f.sealer.Seal("squatter-apple-refresh")
	if _, err := f.pool.Exec(ctx, `UPDATE users SET
		totp_secret = $2, mfa_enabled_at = now(), mfa_recovery_codes = ARRAY[$3],
		apple_id = 'squatter-apple', apple_email = 'squatter@privaterelay.appleid.com', apple_linked_at = now(),
		apple_client_id = $4, apple_refresh_token_enc = $5,
		google_id = 'squatter-google', google_email = 'squatter@gmail.com', google_linked_at = now(),
		ai_consent_version = 'v1', ai_consent_at = now(), ai_opt_out_at = now()
		WHERE id = $1`, uid, sealedTOTP, auth.HashRecoveryCode("aaaaa-bbbbb"), appleBundle, sealedApple); err != nil {
		t.Fatal(err)
	}
	s.user = f.user(t, uid)
	return s
}

// assertGone checks that nothing the squatter left on the account survived
// a provider's reclaim, which leaves no password at all, and that the
// account is now the owner's.
func (f *identityFixture) assertGone(t *testing.T, s squatter, email string) {
	t.Helper()
	if u := f.user(t, s.user.ID); u.PasswordHash.Valid || u.PasswordChangedAt.Valid {
		t.Fatalf("the squatter's password survived: %+v", u)
	}
	f.assertTakenBack(t, s, email)
}

// assertTakenBack is what every reclaim leaves, whichever proof of the
// mailbox it followed: the squatter's second factor, sessions, devices,
// pushes, consents, links and codes are gone and the owner was told.
func (f *identityFixture) assertTakenBack(t *testing.T, s squatter, email string) {
	t.Helper()
	ctx := f.ctx
	u := f.user(t, s.user.ID)
	if u.TotpSecret.Valid || u.MfaEnabledAt.Valid || len(u.MfaRecoveryCodes) != 0 {
		t.Fatalf("the squatter's second factor survived: %+v", u)
	}
	if u.AiConsentVersion.Valid || u.AiConsentAt.Valid || u.AiOptOutAt.Valid {
		t.Fatalf("the squatter's AI answer survived: %+v", u)
	}
	if !u.EmailVerifiedAt.Valid || !u.CredentialsRevokedAt.Valid || u.CredentialsRevokedAt.Time.Before(s.firstIssuedAt) {
		t.Fatalf("the reclaimed address is verified and older tokens are refused from now: %+v", u)
	}
	if _, err := f.auth.Login(ctx, email, "squatter-pass"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the squatter's password still signs in: %v", err)
	}
	if _, err := f.auth.Refresh(ctx, s.webRefresh); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the squatter's browser session refreshes: %v", err)
	}
	if err := f.desktop.CheckDeviceSession(ctx, u.ID, s.device.DeviceSessionID); err == nil {
		t.Fatal("the squatter's device session is alive")
	}
	if _, err := f.desktop.Exchange(ctx, "uniwork-office", s.approvedCode, s.codeVerifier, "uniwork-office://auth/callback", "default"); err == nil {
		t.Fatal("the desktop code the squatter approved still opens a device session")
	}
	if n := f.count(t, `SELECT count(*) FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL`, u.ID); n != 0 {
		t.Fatalf("%d of the squatter's push subscriptions (browser included) are live", n)
	}
	if n := f.count(t, `SELECT count(*) FROM mcp_auth_attempts WHERE id = $1 AND cancelled_at IS NOT NULL`, s.mcpAttemptID); n != 1 {
		t.Fatal("the squatter's MCP consent is open")
	}
	if _, err := f.q.GetActivePasswordResetTokenByHash(ctx, hashToken(s.resetTokenRaw)); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a reset link mailed before the reclaim still works: %v", err)
	}
	if n := f.count(t, `SELECT count(*) FROM email_verification_codes WHERE user_id = $1`, u.ID); n != 0 {
		t.Fatalf("%d mailed codes survived", n)
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2 AND metadata::jsonb->>'reason' = 'reclaimed'`, audit.ActionAuthSessionRevoked, u.ID); n != 1 {
		t.Fatal("the reclaim audits the sessions it ended")
	}
	if n := f.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'session.revoked' AND payload::jsonb->>'user_id' = $1 AND payload::jsonb->>'session_id' = ''`, u.ID); n != 1 {
		t.Fatal("every socket of the account closes")
	}
	notice := f.mailOfKind(t, email, mail.KindSignInMethodChanged)
	if !strings.Contains(notice.Subject, "lấy lại") || notice.UserID != u.ID {
		t.Fatalf("the owner is told the account was taken back: %+v", notice)
	}
	f.client.mu.Lock()
	revoked := strings.Join(f.client.revoked, ",")
	f.client.mu.Unlock()
	if !strings.Contains(revoked, appleBundle+" squatter-apple-refresh") {
		t.Fatalf("the squatter's Apple consent is given back: %q", revoked)
	}
}

// An account registered with an address its holder never proved belongs to
// whoever proves the mailbox (ADR 0049): a provider that owns the address
// takes it back, whatever the squatter set up — a second factor, an Apple ID,
// another Google account, sessions and devices, browser pushes, approved
// desktop codes, MCP consents, reset links — and none of it survives.
func TestProviderSignInReclaimsAnUnverifiedAccount(t *testing.T) {
	t.Run("google", func(t *testing.T) {
		f := newIdentityFixture(t)
		s := f.squat(t, "victim@gmail.com")
		res, err := f.google.SignIn(f.ownerBrowser(), GoogleClaims{Sub: "victim-google", Email: "victim@gmail.com", EmailVerified: true, Name: "Nạn nhân"}, "vi", SignInIntentSignIn)
		if err != nil {
			t.Fatal(err)
		}
		if !res.Reclaimed || res.Session.MFAPending() || res.Session.User.ID != s.user.ID || res.Session.AccessToken == "" || res.Session.RefreshToken == "" {
			t.Fatalf("the owner is signed in to the account taken back: %+v", res)
		}
		f.assertGone(t, s, "victim@gmail.com")
		// The reclaim notice is the owner's news: the squatter's sessions it
		// ended make no new-login alert out of the owner's own browser.
		if n := f.newLogins("victim@gmail.com"); n != 0 {
			t.Fatalf("the reclaim also sent %d new-login alerts", n)
		}
		u := f.user(t, s.user.ID)
		if u.GoogleID.String != "victim-google" || u.GoogleEmail.String != "victim@gmail.com" || u.AppleID.Valid || u.AppleEmail.Valid || u.AppleClientID.Valid || u.AppleRefreshTokenEnc.Valid {
			t.Fatalf("only the owner's Google identity opens it now: %+v", u)
		}
		if f.linkAudits(t, u.ID, ProviderGoogle, "reclaim") != 1 {
			t.Fatal("the reclaim is audited as a link")
		}
		// The new session is the owner's own and refreshes.
		if _, err := f.auth.Refresh(f.ctx, res.Session.RefreshToken); err != nil {
			t.Fatalf("the owner's session: %v", err)
		}
		// The identities the squatter linked no longer open the account: the
		// Google one matches nothing now, the Apple one opens a new account
		// on the shipped app's route.
		other, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "squatter-google", Email: "squatter@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
		if err != nil || other.TicketKind != TicketKindUnmatched || other.Session.User.ID == u.ID {
			t.Fatalf("the squatter's Google account: %+v %v", other, err)
		}
		if sess, err := f.appleSignIn(t, "squatter-apple", "squatter@privaterelay.appleid.com", true); err != nil || sess.AccountID == u.ID {
			t.Fatalf("the squatter's Apple ID: %+v %v", sess, err)
		}
	})
	// Apple owns its relay domains as it owns iCloud: an account someone
	// registered on a relay address goes back to the Apple ID it forwards for.
	for _, tc := range []struct {
		name, email string
		private     bool
	}{
		{"apple", "victim@icloud.com", false},
		{"apple relay", "victim@private.icloud.com", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newIdentityFixture(t)
			s := f.squat(t, tc.email)
			sess, err := f.appleSignIn(t, "victim-apple", tc.email, tc.private)
			if err != nil || sess.AccountID != s.user.ID || sess.AccessToken == "" {
				t.Fatalf("the owner is signed in on the phone: %+v %v", sess, err)
			}
			f.assertGone(t, s, tc.email)
			u := f.user(t, s.user.ID)
			if u.AppleID.String != "victim-apple" || u.AppleEmail.String != tc.email || u.GoogleID.Valid || u.GoogleEmail.Valid {
				t.Fatalf("only the owner's Apple ID opens it now: %+v", u)
			}
			if u.AppleRefreshTokenEnc.String == "" || u.AppleRefreshTokenEnc.String == s.user.AppleRefreshTokenEnc.String {
				t.Fatalf("the owner's own Apple consent is kept: %+v", u)
			}
			if f.linkAudits(t, u.ID, ProviderApple, "reclaim") != 1 {
				t.Fatal("the reclaim is audited as a link")
			}
			if err := f.desktop.CheckDeviceSession(f.ctx, u.ID, sess.DeviceSessionID); err != nil {
				t.Fatalf("the owner's device session: %v", err)
			}
		})
	}
}

// The second factor on an unverified account was set up by whoever
// registered it, so the reclaim never asks for it (ADR 0049): asking would
// hand the squatter the account. A verified account's second factor is
// asked for as always.
func TestReclaimNeverAsksTheSquattersSecondFactor(t *testing.T) {
	f := newIdentityFixture(t)
	s := f.squat(t, "owner@gmail.com")
	if !s.user.MfaEnabledAt.Valid {
		t.Fatal("the squatter has a second factor")
	}
	// The squatter keeps a challenge of their own at hand, on the web and on
	// the app, from the password the reclaim is about to clear.
	held, err := f.auth.Login(f.ctx, "owner@gmail.com", "squatter-pass")
	if err != nil || !held.MFAPending() {
		t.Fatalf("the squatter's first step: %+v %v", held, err)
	}
	doors := NewNativeSignInService(f.pool, f.q, f.auth, f.desktop, f.tickets())
	heldApp, err := doors.Password(f.ctx, "owner@gmail.com", "squatter-pass", app)
	if err != nil || heldApp.MFAToken == "" {
		t.Fatalf("the squatter's first step on the app: %+v %v", heldApp, err)
	}
	res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "owner-google", Email: "owner@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	if err != nil || res.Session.MFAPending() || res.Session.RefreshToken == "" {
		t.Fatalf("the reclaim asks no second factor: %+v %v", res, err)
	}
	if u := f.user(t, s.user.ID); u.MfaEnabledAt.Valid || u.TotpSecret.Valid {
		t.Fatalf("the squatter's second factor is gone: %+v", u)
	}
	// With the factor gone there is nothing left to ask, and the challenge
	// does not stand in for it: the reclaimed account opens to no code.
	if sess, err := f.auth.VerifyMFA(f.ctx, held.MFAToken, "000000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the squatter's challenge opened the reclaimed account: %+v %v", sess, err)
	}
	if out, err := doors.VerifyMFA(f.ctx, heldApp.MFAToken, "000000", app); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the squatter's app challenge opened the reclaimed account: %+v %v", out, err)
	}
	if n := f.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, s.user.ID); n != 1 {
		t.Fatalf("%d live sessions on the reclaimed account, want the owner's one", n)
	}

	phone := f.squat(t, "owner@icloud.com")
	if _, err := f.appleSignIn(t, "owner-apple", "owner@icloud.com", false); err != nil {
		t.Fatalf("the phone reclaim asks no second factor either: %v", err)
	}
	if u := f.user(t, phone.user.ID); u.MfaEnabledAt.Valid {
		t.Fatalf("the squatter's second factor is gone: %+v", u)
	}

	// The account is the owner's now: a second factor they set up is asked.
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, s.user.ID); err != nil {
		t.Fatal(err)
	}
	again, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "owner-google", Email: "owner@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	if err != nil || !again.Session.MFAPending() || again.Reclaimed {
		t.Fatalf("a verified account's second factor is asked: %+v %v", again, err)
	}
}

// Unlinking a provider is the owner saying "not this one" (ADR 0049): the
// same identity is never linked back by its address, by Google or Apple,
// until the owner links it again on purpose.
func TestAnUnlinkedProviderIsNotRelinkedByEmail(t *testing.T) {
	f := newIdentityFixture(t)
	owner := registerVerified(t, f.q, f.auth, "an@gmail.com", "An")
	if _, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-an", Email: "an@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn); err != nil {
		t.Fatal(err)
	}
	u, err := f.q.UnlinkGoogleAccount(f.ctx, owner.ID)
	if err != nil || u.GoogleID.Valid || u.GoogleEmail.Valid || u.GoogleUnlinkedSub.String != "g-an" {
		t.Fatalf("unlink = %+v %v", u, err)
	}
	again, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-an", Email: "an@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
	if err != nil || again.TicketKind != TicketKindLinkRequired || again.Session.AccessToken != "" {
		t.Fatalf("an unlinked subject gets the link_required ticket, not the account: %+v %v", again, err)
	}
	if f.user(t, owner.ID).GoogleID.Valid {
		t.Fatal("an unlinked Google account was linked back by its address")
	}
	if f.linkAudits(t, owner.ID, ProviderGoogle, "email_match") != 1 {
		t.Fatal("no second link was recorded")
	}

	apple := registerVerified(t, f.q, f.auth, "binh@icloud.com", "Bình")
	if _, err := f.appleSignIn(t, "a-binh", "binh@icloud.com", false); err != nil {
		t.Fatal(err)
	}
	if u, err := f.q.UnlinkAppleAccount(f.ctx, apple.ID); err != nil || u.AppleID.Valid || u.AppleRefreshTokenEnc.Valid || u.AppleUnlinkedSub.String != "a-binh" {
		t.Fatalf("unlink apple = %+v %v", u, err)
	}
	_, err = f.appleSignIn(t, "a-binh", "binh@icloud.com", false)
	refused(t, err, ErrAppleAccountConflict)
	if f.user(t, apple.ID).AppleID.Valid {
		t.Fatal("an unlinked Apple ID was linked back by its address")
	}

	// Linking again on purpose (the query the Settings link runs) forgets
	// the unlink.
	if u, err := f.q.LinkGoogleAccount(f.ctx, db.LinkGoogleAccountParams{ID: owner.ID, GoogleID: pgtype.Text{String: "g-an", Valid: true}, GoogleEmail: pgtype.Text{String: "an@gmail.com", Valid: true}}); err != nil || u.GoogleUnlinkedSub.Valid || u.GoogleID.String != "g-an" {
		t.Fatalf("relink = %+v %v", u, err)
	}
}
