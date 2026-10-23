package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const appleBundle = "com.uniworkos.chat"

// fakeAppleClient records what would have gone to Apple's token and revoke
// endpoints.
type fakeAppleClient struct {
	mu        sync.Mutex
	exchanges []string
	revoked   []string
	failCode  bool
}

func (f *fakeAppleClient) RefreshTokenForCode(_ context.Context, clientID, code string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exchanges = append(f.exchanges, clientID+" "+code)
	if f.failCode {
		return "", auth.AppleClientError{Op: "token", Status: http.StatusBadRequest, Code: "invalid_grant"}
	}
	return "apple-refresh-for-" + code, nil
}

func (f *fakeAppleClient) Revoke(_ context.Context, clientID, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revoked = append(f.revoked, clientID+" "+token)
	return nil
}

type appleFixture struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	auth   *AuthService
	apple  *AppleAuthService
	issuer *appletest.Issuer
	client *fakeAppleClient
	out    *fakeOutbox
}

func newAppleFixture(t *testing.T) *appleFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("apple-test"), TTL: time.Minute}
	as := NewAuthService(pool, q, minter, time.Hour, nil)
	cfg := config.Config{JWTSecret: "apple-test", DesktopAuthClients: []config.DesktopAuthClient{{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback"}}}, DesktopAuthDeploymentIDs: []string{"default"}, RefreshTokenTTL: time.Hour}
	desktop := NewDesktopAuthService(pool, q, minter, cfg)
	issuer := appletest.New(t)
	client := &fakeAppleClient{}
	verifier := auth.NewAppleVerifier(auth.AppleIssuer, issuer.JWKSURL, []string{appleBundle, appleBundle + ".staging"}, nil)
	apple := NewAppleAuthService(pool, q, desktop, verifier, client)
	as.SetApple(apple)
	out := &fakeOutbox{}
	apple.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, out)
	return &appleFixture{pool: pool, q: q, auth: as, apple: apple, issuer: issuer, client: client, out: out}
}

// input is a sign-in as the app sends it: the token for claims, the nonce
// whose hash the claims carry, a code and the device fields.
func (f *appleFixture) input(t *testing.T, claims jwt.MapClaims, nonce string) AppleSignInInput {
	return AppleSignInInput{
		IdentityToken: f.issuer.Token(t, claims), Nonce: nonce, AuthorizationCode: "code-" + nonce,
		ClientID: "uniwork-chat-mobile", DeploymentID: "default", DeviceLabel: "UniChat (iOS)", Platform: "ios", Locale: "vi",
	}
}

func (f *appleFixture) auditCount(t *testing.T, action, userID, via string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND ($3 = '' OR metadata::jsonb->>'via' = $3)`, action, userID, via).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAppleSignInCreatesARelayAccountAndFindsItAgainBySubject(t *testing.T) {
	f := newAppleFixture(t)
	ctx := context.Background()
	in := f.input(t, appletest.Claims(appleBundle, "apple-sub-1", "Q7x@PrivateRelay.AppleID.com", true, "n1"), "n1")
	in.GivenName, in.FamilyName = " Ngọc ", "Trần"
	sess, err := f.apple.SignIn(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" || sess.DeviceSessionID == "" || sess.DeploymentID != "default" {
		t.Fatalf("session = %+v", sess)
	}
	if err := f.apple.desktop.CheckDeviceSession(ctx, sess.AccountID, sess.DeviceSessionID); err != nil {
		t.Fatalf("the native session is a live device session: %v", err)
	}
	u, err := f.q.GetUserByID(ctx, sess.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "q7x@privaterelay.appleid.com" || u.DisplayName != "Ngọc Trần" || u.AppleID.String != "apple-sub-1" ||
		!u.EmailVerifiedAt.Valid || u.PasswordHash.Valid || u.OnboardedAt.Valid || u.Locale != "vi" {
		t.Fatalf("created user = %+v", u)
	}
	if u.AppleClientID.String != appleBundle || u.AppleRefreshTokenEnc.String == "" || strings.Contains(u.AppleRefreshTokenEnc.String, "apple-refresh") {
		t.Fatalf("the kept token is sealed with its client id: %q %q", u.AppleClientID.String, u.AppleRefreshTokenEnc.String)
	}
	if f.auditCount(t, audit.ActionAuthLoginSucceeded, u.ID, "apple") != 1 || f.auditCount(t, audit.ActionAuthDesktopSessionCreated, u.ID, "") != 1 {
		t.Fatal("a sign-in audits the login and the device session")
	}
	// Later sign-ins carry no name and may carry another address: the subject decides.
	again, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle+".staging", "apple-sub-1", "other@example.com", false, "n2"), "n2"))
	if err != nil || again.AccountID != u.ID || again.DeviceSessionID == sess.DeviceSessionID {
		t.Fatalf("second sign-in: %+v %v", again, err)
	}
	u, _ = f.q.GetUserByID(ctx, u.ID)
	if u.DisplayName != "Ngọc Trần" || u.AppleClientID.String != appleBundle+".staging" {
		t.Fatalf("the name stays; the token follows the latest client: %+v", u)
	}
	// A linked subject does without the address.
	noEmail := appletest.Claims(appleBundle, "apple-sub-1", "", false, "n3")
	noEmail["email_verified"] = "false"
	if third, err := f.apple.SignIn(ctx, f.input(t, noEmail, "n3")); err != nil || third.AccountID != u.ID {
		t.Fatalf("linked subject without email: %+v %v", third, err)
	}
}

func TestAppleSignInLinksOnlyAVerifiedAddressThatIsNotARelay(t *testing.T) {
	f := newAppleFixture(t)
	ctx := context.Background()
	verified, err := f.auth.Register(ctx, "mai@example.com", "password123", "Mai", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE users SET email_verified_at = now() WHERE id = $1`, verified.User.ID); err != nil {
		t.Fatal(err)
	}
	sess, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-mai", "MAI@example.com", false, "n"), "n"))
	if err != nil || sess.AccountID != verified.User.ID {
		t.Fatalf("verified address links: %+v %v", sess, err)
	}
	if u, _ := f.q.GetUserByID(ctx, verified.User.ID); u.AppleID.String != "apple-mai" || u.DisplayName != "Mai" {
		t.Fatalf("linked user = %+v", u)
	}
	if _, err := f.auth.Login(ctx, "mai@example.com", "password123"); err != nil {
		t.Fatalf("the password still works: %v", err)
	}

	conflict := func(t *testing.T, err error) {
		t.Helper()
		var ce CodedError
		if !errors.Is(err, ErrAppleAccountConflict) || !errors.As(err, &ce) || ce.Status != http.StatusConflict {
			t.Fatalf("want apple_account_conflict, got %v", err)
		}
	}
	t.Run("unverified address", func(t *testing.T) {
		reg, err := f.auth.Register(ctx, "typed@example.com", "password123", "T", "vi")
		if err != nil {
			t.Fatal(err)
		}
		_, err = f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-typed", "typed@example.com", false, "n"), "n"))
		conflict(t, err)
		if u, _ := f.q.GetUserByID(ctx, reg.User.ID); u.AppleID.Valid {
			t.Fatal("no link on a conflict")
		}
	})
	t.Run("relay address someone registered", func(t *testing.T) {
		reg, err := f.auth.Register(ctx, "abc@privaterelay.appleid.com", "password123", "R", "vi")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `UPDATE users SET email_verified_at = now() WHERE id = $1`, reg.User.ID); err != nil {
			t.Fatal(err)
		}
		_, err = f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-relay", "abc@privaterelay.appleid.com", true, "n"), "n"))
		conflict(t, err)
	})
	t.Run("address linked to another Apple subject", func(t *testing.T) {
		_, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-other", "mai@example.com", false, "n"), "n"))
		conflict(t, err)
	})
}

func TestAppleSignInRefusesTokensNotMeantForThisSignIn(t *testing.T) {
	f := newAppleFixture(t)
	ctx := context.Background()
	invalid := func(t *testing.T, in AppleSignInInput) {
		t.Helper()
		_, err := f.apple.SignIn(ctx, in)
		var ce CodedError
		if !errors.Is(err, ErrAppleTokenInvalid) || !errors.As(err, &ce) || ce.Status != http.StatusUnauthorized || ce.Code != "apple_token_invalid" {
			t.Fatalf("want apple_token_invalid, got %v", err)
		}
	}
	good := appletest.Claims(appleBundle, "apple-x", "x@example.com", false, "n")
	wrongAud := appletest.Claims("com.example.other", "apple-x", "x@example.com", false, "n")
	expired := appletest.Claims(appleBundle, "apple-x", "x@example.com", false, "n")
	expired["exp"] = time.Now().Add(-time.Minute).Unix()
	unverified := appletest.Claims(appleBundle, "apple-x", "x@example.com", false, "n")
	unverified["email_verified"] = "false"
	noEmail := appletest.Claims(appleBundle, "apple-x", "", false, "n")

	invalid(t, f.input(t, wrongAud, "n"))
	invalid(t, f.input(t, expired, "n"))
	bad := f.input(t, good, "n")
	bad.Nonce = "a-replayed-token-with-another-nonce"
	invalid(t, bad)
	invalid(t, f.input(t, unverified, "n"))
	invalid(t, f.input(t, noEmail, "n"))

	other := f.input(t, good, "n")
	other.ClientID = "not-a-client"
	if _, err := f.apple.SignIn(ctx, other); !errors.As(err, new(ValidationError)) {
		t.Fatalf("unknown client: %v", err)
	}
	other = f.input(t, good, "n")
	other.DeploymentID = "elsewhere"
	if _, err := f.apple.SignIn(ctx, other); !errors.As(err, new(ValidationError)) {
		t.Fatalf("unknown deployment: %v", err)
	}
	var users int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = 'x@example.com'`).Scan(&users); err != nil || users != 0 {
		t.Fatalf("a refused sign-in creates nothing: %d %v", users, err)
	}
	if len(f.client.exchanges) != 0 {
		t.Fatalf("a refused token never reaches Apple's token endpoint: %v", f.client.exchanges)
	}
}

// Linking by address adds a way into an account someone already has, and
// every later sign-in on an account with sessions opens one more: the owner
// hears of both, as a browser sign-in from a new device tells them (F-01).
func TestAppleSignInTellsTheOwnerOfTheLinkAndOfEveryNewSession(t *testing.T) {
	f := newAppleFixture(t)
	ctx := WithSessionMeta(context.Background(), SessionMeta{UserAgent: "UniChat/1 CFNetwork", IP: "10.0.0.7"})
	kinds := func() []string {
		f.out.mu.Lock()
		defer f.out.mu.Unlock()
		var k []string
		for _, m := range f.out.queued {
			k = append(k, m.Kind+" "+m.To)
		}
		return k
	}

	// A new account is told nothing: it has no other session to protect.
	in := f.input(t, appletest.Claims(appleBundle, "apple-new", "new@privaterelay.appleid.com", true, "a"), "a")
	if _, err := f.apple.SignIn(ctx, in); err != nil {
		t.Fatal(err)
	}
	if got := kinds(); len(got) != 0 {
		t.Fatalf("a new account gets no alert, got %v", got)
	}
	// The next sign-in on it is a new phone session: the new-login alert names the device.
	if _, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-new", "new@privaterelay.appleid.com", true, "c"), "c")); err != nil {
		t.Fatal(err)
	}
	if got := kinds(); len(got) != 1 || got[0] != "new_login new@privaterelay.appleid.com" {
		t.Fatalf("a sign-in on an account with sessions sends new_login, got %v", got)
	}
	if m := f.out.last(t); !strings.Contains(m.Text, "UniChat (iOS)") || !strings.Contains(m.Text, "10.0.0.7") {
		t.Fatalf("the alert names the device and the address: %s", m.Text)
	}

	// Linking an account made with a password tells its owner once, with the device.
	reg, err := f.auth.Register(ctx, "owner@example.com", "password123", "O", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE users SET email_verified_at = now() WHERE id = $1`, reg.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-owner", "owner@example.com", false, "d"), "d")); err != nil {
		t.Fatal(err)
	}
	if got := kinds(); len(got) != 2 || got[1] != "apple_linked owner@example.com" {
		t.Fatalf("the link is told to the owner, and only once: %v", got)
	}
	if m := f.out.last(t); !strings.Contains(m.Text, "UniChat (iOS)") || !strings.Contains(m.Text, "/settings?tab=security") || m.UserID != reg.User.ID {
		t.Fatalf("the link mail names the device and the sessions page: %+v", m)
	}

	// A refused sign-in tells nobody anything.
	if _, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-thief", "owner@example.com", false, "e"), "e")); !errors.Is(err, ErrAppleAccountConflict) {
		t.Fatalf("want conflict, got %v", err)
	}
	if got := kinds(); len(got) != 2 {
		t.Fatalf("a refused sign-in sends nothing: %v", got)
	}
}

func TestAppleSignInSendsAnMFAAccountToTheBrowserWithoutLinking(t *testing.T) {
	f := newAppleFixture(t)
	ctx := context.Background()
	reg, err := f.auth.Register(ctx, "mfa@example.com", "password123", "M", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE users SET email_verified_at = now(), mfa_enabled_at = now() WHERE id = $1`, reg.User.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-mfa", "mfa@example.com", false, "n"), "n"))
	var ce CodedError
	if !errors.Is(err, ErrMFARequired) || !errors.As(err, &ce) || ce.Status != http.StatusForbidden {
		t.Fatalf("want mfa_required, got %v", err)
	}
	if u, _ := f.q.GetUserByID(ctx, reg.User.ID); u.AppleID.Valid || u.AppleRefreshTokenEnc.Valid {
		t.Fatalf("nothing is linked or kept: %+v", u)
	}
	if len(f.client.revoked) != 1 || f.client.revoked[0] != appleBundle+" apple-refresh-for-code-n" {
		t.Fatalf("the token Apple handed out for the refused sign-in goes back: %v", f.client.revoked)
	}
}

func TestAppleSignInSurvivesAFailedCodeExchange(t *testing.T) {
	f := newAppleFixture(t)
	f.client.failCode = true
	sess, err := f.apple.SignIn(context.Background(), f.input(t, appletest.Claims(appleBundle, "apple-nocode", "nocode@example.com", false, "n"), "n"))
	if err != nil {
		t.Fatal(err)
	}
	u, _ := f.q.GetUserByID(context.Background(), sess.AccountID)
	if u.AppleRefreshTokenEnc.Valid || u.AppleClientID.Valid {
		t.Fatalf("nothing kept without a token: %+v", u)
	}
	// Without a code, nothing is asked of Apple.
	f.client.failCode = false
	in := f.input(t, appletest.Claims(appleBundle, "apple-nocode", "nocode@example.com", false, "m"), "m")
	in.AuthorizationCode = ""
	if _, err := f.apple.SignIn(context.Background(), in); err != nil || len(f.client.exchanges) != 1 {
		t.Fatalf("no code, no exchange: %v %v", err, f.client.exchanges)
	}
}

func TestDeleteAccountRevokesTheAppleToken(t *testing.T) {
	f := newAppleFixture(t)
	ctx := context.Background()
	sess, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-del", "del@privaterelay.appleid.com", true, "n"), "n"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.auth.DeleteAccount(ctx, sess.AccountID, DeleteAccountInput{EmailConfirmation: "del@privaterelay.appleid.com"}); err != nil {
		t.Fatal(err)
	}
	if len(f.client.revoked) != 1 || f.client.revoked[0] != appleBundle+" apple-refresh-for-code-n" {
		t.Fatalf("revoked = %v", f.client.revoked)
	}
	u, _ := f.q.GetUserByID(ctx, sess.AccountID)
	if u.AppleID.Valid || u.AppleClientID.Valid || u.AppleRefreshTokenEnc.Valid {
		t.Fatalf("the erasure clears the Apple columns: %+v", u)
	}
	// The subject is free again: a new sign-in is a new account.
	again, err := f.apple.SignIn(ctx, f.input(t, appletest.Claims(appleBundle, "apple-del", "del2@privaterelay.appleid.com", true, "m"), "m"))
	if err != nil || again.AccountID == sess.AccountID {
		t.Fatalf("after deletion: %+v %v", again, err)
	}
}

func TestAppleRevokeIsBestEffort(t *testing.T) {
	var none *AppleAuthService
	none.revokeAfterCommit(context.Background(), "u", appleBundle, "sealed") // not wired: nothing happens
	f := newAppleFixture(t)
	f.apple.revokeAfterCommit(context.Background(), "u", appleBundle, "not-sealed-by-us")
	f.apple.revokeAfterCommit(context.Background(), "u", "", "")
	if len(f.client.revoked) != 0 {
		t.Fatalf("an unreadable or missing token is not sent: %v", f.client.revoked)
	}
	for err, want := range map[error]string{
		auth.AppleClientError{Code: "invalid_client"}: "invalid_client",
		auth.AppleClientError{Status: 500}:            "status",
		context.DeadlineExceeded:                      "timeout",
		errors.New("dial"):                            "unreachable",
	} {
		if got := appleErrorCode(err); got != want {
			t.Fatalf("appleErrorCode(%v) = %q, want %q", err, got, want)
		}
	}
}

func TestAppleDisplayNameFallsBackToTheAddress(t *testing.T) {
	if got := appleDisplayName("", " ", "hidden@privaterelay.appleid.com"); got != "hidden" {
		t.Fatalf("got %q", got)
	}
	if got := appleDisplayName(strings.Repeat("a", 120), "", "a@b.c"); len([]rune(got)) != maxDisplayNameRunes {
		t.Fatalf("capped to %d runes, got %d", maxDisplayNameRunes, len([]rune(got)))
	}
}
