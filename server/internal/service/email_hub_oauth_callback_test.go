package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const emailHubAccountsOf = `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1`

// emailHubTokenEndpoint stands in for the Google and Microsoft token
// endpoints: every Exchange posts here; a test sets the reply and reads the form.
type emailHubTokenEndpoint struct {
	mu    sync.Mutex
	calls int
	form  url.Values
	reply map[string]any // nil answers 400 invalid_grant, as a replayed code does
}

func (e *emailHubTokenEndpoint) answer(reply map[string]any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.reply = reply
}

func (e *emailHubTokenEndpoint) seen() (int, url.Values) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls, e.form
}

// fakeEmailHubOAuthCallback configures both providers on svc with every
// endpoint on one httptest server, so no test reaches Google or Microsoft.
func fakeEmailHubOAuthCallback(t *testing.T, svc *EmailHubService) *emailHubTokenEndpoint {
	t.Helper()
	e := &emailHubTokenEndpoint{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			return // a revoke (Task 7) answers 200 and is not counted
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		e.mu.Lock()
		e.calls++
		e.form = r.PostForm
		reply := e.reply
		e.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if reply == nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(reply)
	}))
	t.Cleanup(srv.Close)
	svc.oauthHTTP = srv.Client()
	svc.oauth = map[string]*emailHubOAuthProvider{}
	for _, p := range []struct{ name, authKind, preset, prompt string }{
		{"google", "oauth_google", "gmail", "consent"},
		{"microsoft", "oauth_microsoft", "outlook", "select_account"},
	} {
		preset, ok := emailhub.Preset(p.preset)
		if !ok {
			t.Fatalf("no preset %q", p.preset)
		}
		svc.oauth[p.name] = &emailHubOAuthProvider{
			name: p.name, authKind: p.authKind, preset: preset, prompt: p.prompt,
			revokeURL: srv.URL + "/revoke",
			config: oauth2.Config{
				ClientID: "client-" + p.name, ClientSecret: "secret-" + p.name,
				RedirectURL: "http://api.test/api/v1/email-hub-connections/" + p.name + "/callback",
				Endpoint: oauth2.Endpoint{
					AuthURL: srv.URL + "/authorize", TokenURL: srv.URL + "/token",
					AuthStyle: oauth2.AuthStyleInParams, // one POST per Exchange, so counts are exact
				},
			},
		}
	}
	return e
}

// testEmailHubIDToken is an unsigned JWT: the callback reads only the payload
// of an id_token that came straight from the token endpoint (spec §5.4 step 5).
func testEmailHubIDToken(claims map[string]any) string {
	part := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	return part(map[string]string{"alg": "RS256", "typ": "JWT"}) + "." + part(claims) + ".c2ln"
}

// emailHubTokenReply is a full token response whose id_token carries claims.
func emailHubTokenReply(claims map[string]any) map[string]any {
	return map[string]any{
		"access_token": "access-1", "token_type": "Bearer", "expires_in": 3600,
		"refresh_token": "refresh-1", "id_token": testEmailHubIDToken(claims),
	}
}

func googleIDClaims(email string) map[string]any {
	return map[string]any{"email": email, "email_verified": true}
}

// startEmailHubTestOAuth runs the real start and returns the state the
// provider hands back and the nonce the browser holds in its cookie.
func startEmailHubTestOAuth(t *testing.T, svc *EmailHubService, userID, workspaceID, provider string) (state, nonce string) {
	t.Helper()
	authURL, nonce, err := svc.StartOAuth(context.Background(), Human(userID), workspaceID, provider, "")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	state = u.Query().Get("state")
	if state == "" || nonce == "" {
		t.Fatalf("start returned state=%q nonce=%q", state, nonce)
	}
	return state, nonce
}

// sealEmailHubTestOAuthState seals a hand-made state as StartOAuth does
// (base64url of box.Seal(JSON)); the live round trip proves the two agree.
func sealEmailHubTestOAuthState(t *testing.T, svc *EmailHubService, st emailHubOAuthState) string {
	t.Helper()
	seal := func(st emailHubOAuthState) string {
		raw, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := svc.box.Seal(raw)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(sealed)
	}
	live := st
	live.Exp = time.Now().Add(time.Minute).Unix()
	if live.Nonce == "" {
		live.Nonce = "x" // the live check needs an openable state; the empty nonce is the case under test
	}
	if got, ok := svc.openOAuthState(seal(live)); !ok || got != live {
		t.Fatal("this helper must seal the state the way StartOAuth does")
	}
	return seal(st)
}

func TestEmailHubIDTokenEmail(t *testing.T) {
	t.Parallel()
	tok := testEmailHubIDToken
	cases := []struct{ name, provider, idToken, want string }{
		{"google verified", "google", tok(googleIDClaims("me@gmail.com")), "me@gmail.com"},
		{"google case and spaces", "google", tok(googleIDClaims(" Me@Gmail.COM ")), "me@gmail.com"},
		{"google unverified", "google", tok(map[string]any{"email": "me@gmail.com", "email_verified": false}), ""},
		{"google verified missing", "google", tok(map[string]any{"email": "me@gmail.com"}), ""},
		{"google never uses preferred_username", "google", tok(map[string]any{"preferred_username": "me@gmail.com", "email_verified": true}), ""},
		{"microsoft email wins", "microsoft", tok(map[string]any{"email": "Me@Contoso.com", "preferred_username": "upn@contoso.com"}), "me@contoso.com"},
		{"microsoft upn fallback", "microsoft", tok(map[string]any{"preferred_username": "UPN@contoso.com"}), "upn@contoso.com"},
		{"microsoft blank email falls back", "microsoft", tok(map[string]any{"email": "  ", "preferred_username": "upn@contoso.com"}), "upn@contoso.com"},
		{"microsoft nothing", "microsoft", tok(map[string]any{"name": "Me"}), ""},
		{"display-name form", "google", tok(googleIDClaims("Me <me@gmail.com>")), ""},
		{"not an address", "microsoft", tok(map[string]any{"preferred_username": "+84901234567"}), ""},
		{"header injection", "microsoft", tok(map[string]any{"email": "me@contoso.com\r\nBcc: x@evil.test"}), ""},
		{"unknown provider", "yahoo", tok(googleIDClaims("me@yahoo.com")), ""},
		{"empty", "google", "", ""},
		{"two segments", "google", "a.b", ""},
		{"payload not base64", "google", "a.%%%.c", ""},
		{"payload not json", "google", "a." + base64.RawURLEncoding.EncodeToString([]byte("nope")) + ".c", ""},
	}
	for _, tc := range cases {
		got, ok := emailHubIDTokenEmail(tc.provider, tc.idToken)
		if got != tc.want || ok != (tc.want != "") {
			t.Errorf("%s: got (%q, %v), want %q", tc.name, got, ok, tc.want)
		}
	}
}

// A state or cookie fault answers state_invalid before the code is spent: the
// token endpoint never hears of it and no row is written (spec §5.4 steps 1-2).
func TestEmailHubCompleteOAuthStateChecks(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	st, ok := svc.openOAuthState(state)
	if !ok {
		t.Fatal("start must hand back a state the callback can open")
	}
	expired := st
	expired.Exp = time.Now().Add(-time.Second).Unix()
	emptyNonce := st
	emptyNonce.Nonce = ""
	tampered := []byte(state)
	if i := len(tampered) / 2; tampered[i] == 'A' {
		tampered[i] = 'B'
	} else {
		tampered[i] = 'A'
	}
	cases := []struct{ name, provider, state, cookie string }{
		{"not base64", "google", "%%%", nonce},
		{"tampered seal", "google", string(tampered), nonce},
		{"expired", "google", sealEmailHubTestOAuthState(t, svc, expired), nonce},
		{"provider mismatch", "microsoft", state, nonce},
		{"missing cookie", "google", state, ""},
		{"wrong cookie", "google", state, nonce + "x"},
		{"empty nonce, empty cookie", "google", sealEmailHubTestOAuthState(t, svc, emptyNonce), ""},
	}
	for _, tc := range cases {
		if got := svc.CompleteOAuth(ctx, tc.provider, tc.state, "code-1", "", tc.cookie); got != EmailHubOAuthStateInvalid {
			t.Errorf("%s: got %q, want state_invalid", tc.name, got)
		}
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("a refused state must not spend the code, token endpoint called %d times", n)
	}
	if calls.Load() != 0 || emailHubCount(t, pool, emailHubAccountsOf, user.ID) != 0 {
		t.Fatal("a refused state must neither dial nor write a row")
	}
	// The genuine pair still connects: the refusals above consumed nothing.
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
		t.Fatalf("genuine callback: got %q, want connected", got)
	}
}

func TestEmailHubCompleteOAuthDenied(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	if got := svc.CompleteOAuth(ctx, "google", state, "", "access_denied", "wrong"); got != EmailHubOAuthStateInvalid {
		t.Fatalf("the cookie check runs before the provider error: got %q", got)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "", "access_denied", nonce); got != EmailHubOAuthDenied {
		t.Fatalf("access_denied: got %q, want denied", got)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "", "server_error", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("other provider error: got %q, want failed", got)
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("a provider error has no code to exchange, token endpoint called %d times", n)
	}
}

// End to end: the real start's state and cookie, the PKCE verifier on the
// token request, an XOAUTH2 check with the new access token on the provider
// preset, then one row and its audit (spec §5.4).
func TestEmailHubCompleteOAuthCreatesAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	stubEmailHubDial(svc, nil)
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}
	cases := []struct {
		provider, email, authKind, preset string
		claims                            map[string]any
	}{
		{"google", "new@gmail.com", "oauth_google", "gmail", googleIDClaims(" New@Gmail.com ")},
		// A work account whose token has no email claim is named by its UPN.
		{"microsoft", "new@contoso.com", "oauth_microsoft", "outlook", map[string]any{"preferred_username": "New@Contoso.com"}},
	}
	for _, tc := range cases {
		state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, tc.provider)
		st, ok := svc.openOAuthState(state)
		if !ok || st.Verifier == "" {
			t.Fatalf("%s: start must seal a PKCE verifier", tc.provider)
		}
		tokens.answer(emailHubTokenReply(tc.claims))

		if got := svc.CompleteOAuth(ctx, tc.provider, state, "code-"+tc.provider, "", nonce); got != EmailHubOAuthConnected {
			t.Fatalf("%s: got %q, want connected", tc.provider, got)
		}
		_, form := tokens.seen()
		if form.Get("grant_type") != "authorization_code" || form.Get("code") != "code-"+tc.provider || form.Get("code_verifier") != st.Verifier {
			t.Fatalf("%s: token request %v, want the code and the state's verifier", tc.provider, form)
		}
		preset, _ := emailhub.Preset(tc.preset)
		wantIMAP := imapclient.Credentials{Host: preset.IMAPHost, Port: preset.IMAPPort, Email: tc.email, Security: "tls", AccessToken: "access-1"}
		wantSMTP := smtpclient.Credentials{Host: preset.SMTPHost, Port: preset.SMTPPort, Email: tc.email, Security: "starttls", AccessToken: "access-1"}
		if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
			t.Fatalf("%s: verify got imap=%+v smtp=%+v", tc.provider, gotIMAP, gotSMTP)
		}
		row, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
			OrganizationID: ws.OrganizationID, UserID: user.ID, Email: tc.email,
		})
		if err != nil {
			t.Fatal(err)
		}
		if row.AuthKind != tc.authKind || row.Provider != preset.Name || row.PasswordEnc != "" || row.Username != "" || row.AuthFailedAt.Valid {
			t.Fatalf("%s: row auth_kind=%q provider=%q password_enc=%q username=%q", tc.provider, row.AuthKind, row.Provider, row.PasswordEnc, row.Username)
		}
		if rt, err := svc.openPassword(row.OauthRefreshTokenEnc); err != nil || rt != "refresh-1" {
			t.Fatalf("%s: sealed refresh token=%q err=%v", tc.provider, rt, err)
		}
		if at, err := svc.openPassword(row.OauthAccessTokenEnc); err != nil || at != "access-1" {
			t.Fatalf("%s: sealed access token=%q err=%v", tc.provider, at, err)
		}
		if exp := row.OauthAccessExpiresAt; !exp.Valid || exp.Time.Before(time.Now().Add(50*time.Minute)) {
			t.Fatalf("%s: oauth_access_expires_at=%+v, want about an hour ahead", tc.provider, exp)
		}
		if n, kind, reconnected := connectedAudit(t, pool, row.ID); n != 1 || kind != "human" || reconnected != "false" {
			t.Fatalf("%s: connected audit n=%d kind=%q reconnected=%q", tc.provider, n, kind, reconnected)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2
			AND actor_id = $3 AND metadata::jsonb->>'auth_kind' = $4`,
			audit.ActionEmailHubAccountConnected, row.ID, user.ID, tc.authKind); n != 1 {
			t.Fatalf("%s: the connected audit must name the user and auth_kind %s", tc.provider, tc.authKind)
		}
	}
}

// Each of these is known from the token response alone, so no login is tried
// and no row written. An old refresh token is never reused (spec §5.4 step 8).
func TestEmailHubCompleteOAuthRefusesBeforeVerify(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	tokens := fakeEmailHubOAuthCallback(t, svc)
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	noRefresh := emailHubTokenReply(googleIDClaims("me@gmail.com"))
	delete(noRefresh, "refresh_token")
	noIDToken := emailHubTokenReply(nil)
	delete(noIDToken, "id_token")
	cases := []struct {
		name  string
		reply map[string]any
		want  string
	}{
		{"no refresh token", noRefresh, EmailHubOAuthConsentRequired},
		{"unverified google address", emailHubTokenReply(map[string]any{"email": "me@gmail.com", "email_verified": false}), EmailHubOAuthEmailUnavailable},
		{"no id_token", noIDToken, EmailHubOAuthEmailUnavailable},
		{"replayed code", nil, EmailHubOAuthFailed},
	}
	for _, tc := range cases {
		tokens.answer(tc.reply)
		if got := svc.CompleteOAuth(context.Background(), "google", state, "code-1", "", nonce); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("no login may be tried, verify ran %d times", n)
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 0 {
		t.Fatalf("no row may be written, got %d", n)
	}
}

// A brand-new token refused at AUTHENTICATE means IMAP is off for the
// mailbox; the log carries codes, never the address or a token (spec §5.4 step 7, §7).
func TestEmailHubCompleteOAuthVerifyFailures(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"imap bare NO", fmt.Errorf("imap: %w", imapclient.ErrLoginRefused), EmailHubOAuthIMAPNotEnabled},
		{"imap AUTHENTICATIONFAILED", fmt.Errorf("imap: %w", imapclient.ErrAuthFailed), EmailHubOAuthIMAPNotEnabled},
		{"smtp auth disabled", fmt.Errorf("smtp: %w", smtpclient.ErrSMTPAuthDisabled), EmailHubOAuthSMTPDisabled},
		{"smtp refused", fmt.Errorf("smtp: %w", smtpclient.ErrAuthFailed), EmailHubOAuthFailed},
		{"unreachable", fmt.Errorf("dial: %w", &net.DNSError{Err: "no such host", Name: "imap.gmail.com", IsNotFound: true}), EmailHubOAuthFailed},
	}
	for _, tc := range cases {
		stubEmailHubDial(svc, tc.err)
		if got := svc.CompleteOAuth(context.Background(), "google", state, "code-1", "", nonce); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 0 {
		t.Fatalf("a failed login must write no row, got %d", n)
	}
	out := logs.String()
	for _, secret := range []string{"me@gmail.com", "access-1", "refresh-1", nonce} {
		if strings.Contains(out, secret) {
			t.Fatalf("the log carries %q:\n%s", secret, out)
		}
	}
	if !strings.Contains(out, "code=imap_not_enabled") || !strings.Contains(out, "reason=unreachable") {
		t.Fatalf("the log must carry the result and the classified reason:\n%s", out)
	}
}

// Membership is decided again with the state's user, before the code is
// spent: a member deactivated since the start, or a state whose organization
// is not the workspace's, gets failed and no row (spec §5.4 step 6).
func TestEmailHubCompleteOAuthNonMember(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	st, _ := svc.openOAuthState(state)
	otherOrg := st
	otherOrg.OrganizationID = util.NewID()
	if got := svc.CompleteOAuth(ctx, "google", sealEmailHubTestOAuthState(t, svc, otherOrg), "code-1", "", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("organization mismatch: got %q, want failed", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, ws.OrganizationID, user.ID); err != nil {
		t.Fatal(err)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("deactivated member: got %q, want failed", got)
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("membership is checked before the exchange, token endpoint called %d times", n)
	}
	if calls.Load() != 0 || emailHubCount(t, pool, emailHubAccountsOf, user.ID) != 0 {
		t.Fatal("a non-member must neither dial nor write a row")
	}
}

// App Password → OAuth keeps the id and the cache, live or awaiting a
// reconnect (spec Q6, §3).
func TestEmailHubCompleteOAuthUpgradesPasswordInPlace(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	stubEmailHubDial(svc, nil)
	for _, needsReconnect := range []bool{false, true} {
		email := fmt.Sprintf("up-%v@gmail.com", needsReconnect)
		acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, email)
		seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
		if needsReconnect {
			acc = markSeedAccountAuthFailed(t, q, acc)
		}
		state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
		tokens.answer(emailHubTokenReply(googleIDClaims(strings.ToUpper(email))))

		if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
			t.Fatalf("%s: got %q, want connected", email, got)
		}
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.AuthKind != "oauth_google" || row.PasswordEnc != "" || row.OauthRefreshTokenEnc == "" ||
			row.AuthFailedAt.Valid || row.AuthFailedReason != "" || row.DisconnectedAt.Valid {
			t.Fatalf("%s: row auth_kind=%q password_enc=%q auth_failed=%v", email, row.AuthKind, row.PasswordEnc, row.AuthFailedAt.Valid)
		}
		if row.CredentialVersion <= acc.CredentialVersion {
			t.Fatalf("%s: credential_version must move past %d, got %d", email, acc.CredentialVersion, row.CredentialVersion)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
			t.Fatalf("%s: the cache must survive an upgrade on the same server, threads=%d", email, n)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1 AND lower(email_address) = $2`, user.ID, email); n != 1 {
			t.Fatalf("%s: an upgrade must keep one row, got %d", email, n)
		}
		if n, _, reconnected := connectedAudit(t, pool, acc.ID); n != 1 || reconnected != "true" || connectedServerChanged(t, pool, acc.ID) != "false" {
			t.Fatalf("%s: connected audit n=%d reconnected=%q", email, n, reconnected)
		}
	}
}

// A live OAuth row of the same provider is a duplicate, answered before any
// login is tried (spec §3).
func TestEmailHubCompleteOAuthAlreadyConnected(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	prov, _ := emailhub.Preset("gmail")
	if _, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: user.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: "dup@gmail.com", Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
		AuthKind: "oauth_google", OauthRefreshTokenEnc: "sealed-refresh", OauthAccessTokenEnc: "sealed-access",
	}); err != nil {
		t.Fatal(err)
	}
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("DUP@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")

	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthAlreadyConnected {
		t.Fatalf("got %q, want already_connected", got)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 1 {
		t.Fatalf("a duplicate must write nothing, rows=%d", n)
	}
}

// A refusal seen with the password from before the OAuth reconnect matches
// no row: the new credential stays and nothing is audited (spec §8 Race).
func TestEmailHubCompleteOAuthOldVersionMarkIsNoop(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "fence@gmail.com")
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("fence@gmail.com")))
	stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
		t.Fatalf("got %q, want connected", got)
	}

	if svc.markAuthFailed(ctx, acc, acc.CredentialVersion, "imap_auth_failed") {
		t.Fatal("a mark with the pre-reconnect version must match nothing")
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.AuthKind != "oauth_google" || row.OauthRefreshTokenEnc == "" {
		t.Fatalf("the OAuth credential must stay: auth_failed=%v auth_kind=%q", row.AuthFailedAt.Valid, row.AuthKind)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a stale mark must not audit, got %d rows", n)
	}
}
