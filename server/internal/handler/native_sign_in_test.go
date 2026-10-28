package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/auth/appletest"
	"github.com/unicomhub/uniwork/server/internal/auth/googletest"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	testGoogleWebClient = "web.apps.googleusercontent.com"
	testGoogleAppClient = "ios.apps.googleusercontent.com"
)

// nativeKit is a test server with the app's sign-in screen on: the native
// doors, the app's Google (a fake Google behind the real verifier) and the
// iPhone's Apple, beside the desktop clients the doors must refuse.
type nativeKit struct {
	srv    *httptest.Server
	google *googletest.Issuer
	apple  *appletest.Issuer
}

func newNativeTestServer(t *testing.T) *nativeKit {
	t.Helper()
	return newNativeTestServerWithOutbox(t, discardOutbox{})
}

// newNativeTestServerWithOutbox lets a test read the mail the choice
// screen's doors queue (recordOutbox) instead of dropping it.
func newNativeTestServerWithOutbox(t *testing.T, out mail.Enqueuer) *nativeKit {
	t.Helper()
	d, pool := newTestDeps(t, nil, out)
	q := db.New(pool)
	cfg := config.Config{JWTSecret: "test", DesktopAuthClients: []config.DesktopAuthClient{
		{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback"}},
		{ID: "uniwork-chat-desktop", RedirectURIs: []string{"uniworkchat://auth/callback"}},
		{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}},
	}, DesktopAuthDeploymentIDs: []string{"default"}, RefreshTokenTTL: time.Hour}
	desktop := service.NewDesktopAuthService(pool, q, d.Minter, cfg)
	k := &nativeKit{google: googletest.New(t), apple: appletest.New(t)}
	discovery, err := auth.DiscoverGoogle(context.Background(), k.google.URL)
	if err != nil {
		t.Fatal(err)
	}
	d.Auth.SetGoogleNative(discovery.NativeVerifier(testGoogleWebClient, []string{testGoogleAppClient}, nil))
	apple := service.NewAppleAuthService(pool, q, desktop, auth.NewAppleVerifier(auth.AppleIssuer, k.apple.JWKSURL, []string{"com.uniworkos.chat"}, nil), nil, d.Sealer)
	d.Auth.SetApple(apple)
	d.DesktopAuth, d.AppleAuth = desktop, apple
	d.NativeSignIn = service.NewNativeSignInService(pool, q, d.Auth, desktop, d.SignInTickets)
	k.srv = httptest.NewServer(New(d))
	t.Cleanup(k.srv.Close)
	return k
}

// nativeBody is a native door's body: the app's client fields, then fields.
func nativeBody(fields map[string]any) map[string]any {
	b := map[string]any{"client_id": "uniwork-chat-mobile", "deployment_id": "default", "device_label": "iPhone của An", "platform": "ios", "build": "2.1.0"}
	for k, v := range fields {
		b[k] = v
	}
	return b
}

func (k *nativeKit) googleToken(t *testing.T, sub, email string) (token, nonce string) {
	t.Helper()
	nonce = util.NewID()
	return k.google.Token(t, k.google.Claims(testGoogleAppClient, testGoogleAppClient, sub, email, nonce)), nonce
}

// Every door of the app's sign-in screen takes only the native sign-in
// clients (ADR 0049 §8): the desktop apps and Office are configured clients
// too, but sign in through the web page, so their client ids, an unknown
// one, or an unconfigured deployment are 400 before any token, ticket or
// password is looked at — the shipped iPhone app's legacy Apple route
// included.
func TestNativeDoorsTakeOnlyNativeClients(t *testing.T) {
	k := newNativeTestServer(t)
	routes := []string{
		"/api/v1/auth/native/password",
		"/api/v1/auth/native/mfa",
		"/api/v1/auth/native/google",
		"/api/v1/auth/native/apple",
		"/api/v1/auth/native/register",
		"/api/v1/auth/native/sign-in-ticket/create",
		"/api/v1/auth/native/sign-in-ticket/claim-email",
		"/api/v1/auth/native/sign-in-ticket/claim-email/verify",
		"/api/v1/auth/apple/native",
	}
	fields := map[string]any{
		"email": "doors@example.com", "password": "password123", "display_name": "Doors", "mfa_token": "x", "code": "123456",
		"id_token": "x", "identity_token": "x", "nonce": "n", "ticket": "x",
	}
	for _, path := range routes {
		for name, client := range map[string]map[string]any{
			"Office":           {"client_id": "uniwork-office"},
			"the desktop app":  {"client_id": "uniwork-chat-desktop"},
			"an unknown app":   {"client_id": "someone-else"},
			"no client":        {"client_id": ""},
			"another rollout":  {"deployment_id": "beta"},
			"no deployment id": {"deployment_id": ""},
		} {
			body := nativeBody(fields)
			for f, v := range client {
				body[f] = v
			}
			res, out := doJSON(t, k.srv, http.MethodPost, path, "", body)
			if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
				t.Fatalf("%s from %s: %d %v", path, name, res.StatusCode, out)
			}
			if _, ok := out["session"]; ok {
				t.Fatalf("%s from %s answered a session", path, name)
			}
		}
	}
	if n := countRows(t, testPool, context.Background(), `SELECT count(*) FROM users WHERE email = 'doors@example.com'`); n != 0 {
		t.Fatal("a refused door created an account")
	}
	// The app's own client passes the door (and then fails on the made-up
	// password, as it should).
	res, out := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/password", "", nativeBody(fields))
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "invalid_credentials" {
		t.Fatalf("the app's own client: %d %v", res.StatusCode, out)
	}
}

// The app's doors answer one JSON shape (spec §3.6), never a cookie:
// signed_in with the device session the bearer middleware takes, or
// mfa_required with the app's challenge, which only POST /auth/native/mfa
// takes; and no-store.
func TestNativeDoorsAnswerOneShape(t *testing.T) {
	k := newNativeTestServer(t)
	res, out := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/register", "", nativeBody(map[string]any{
		"email": "shape@example.com", "password": "password123", "display_name": "Hình",
	}))
	if res.StatusCode != http.StatusOK || out["status"] != "signed_in" || out["reclaimed"] != false || out["link_skipped"] != "" || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	if len(res.Cookies()) != 0 {
		t.Fatalf("a native door set cookies: %v", res.Cookies())
	}
	sess, _ := out["session"].(map[string]any)
	for _, f := range []string{"account_id", "device_session_id", "access_token", "refresh_token"} {
		if s, _ := sess[f].(string); s == "" {
			t.Fatalf("session.%s missing: %v", f, out)
		}
	}
	if sess["token_type"] != "Bearer" || sess["refresh_rotates"] != true || sess["deployment_id"] != "default" {
		t.Fatalf("session = %v", sess)
	}
	if _, ok := out["mfa_token"]; ok {
		t.Fatalf("a session carries no challenge: %v", out)
	}
	res, me := doJSON(t, k.srv, http.MethodGet, "/api/v1/me", sess["access_token"].(string), nil)
	if user, _ := me["user"].(map[string]any); res.StatusCode != http.StatusOK || user["email"] != "shape@example.com" || user["email_verified_at"] != nil {
		t.Fatalf("/me with the app's session: %d %v", res.StatusCode, me)
	}

	if _, err := testPool.Exec(context.Background(), `UPDATE users SET mfa_enabled_at = now(), totp_secret = 'sealed' WHERE email = 'shape@example.com'`); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/password", "", nativeBody(map[string]any{
		"email": "shape@example.com", "password": "password123",
	}))
	token, _ := out["mfa_token"].(string)
	if res.StatusCode != http.StatusOK || out["status"] != "mfa_required" || token == "" || out["session"] != nil {
		t.Fatalf("an account with a second factor: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/mfa/verify", "", map[string]any{"mfa_token": token, "code": "123456"})
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "invalid_credentials" {
		t.Fatalf("the app's challenge at the browser's second step: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/mfa", "", nativeBody(map[string]any{"mfa_token": token, "code": "000000"}))
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "invalid_credentials" {
		t.Fatalf("a wrong code at the app's second step: %d %v", res.StatusCode, out)
	}

	// A form another site posts never reaches the door.
	req, _ := http.NewRequest(http.MethodPost, k.srv.URL+"/api/v1/auth/native/password", strings.NewReader("email=shape%40example.com&password=password123"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	form, err := k.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = form.Body.Close()
	if form.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("a form post: %d, want 415", form.StatusCode)
	}
}

// The app says its language on every door (NativeClientSDI.locale, spec
// §3.6): it carries no uniwork-locale cookie, so without it every mail a door
// sends — the sign-up's code, the choice screen's — went out in English. vi
// or en is the language of the account a door creates, whose mails follow
// it, and of the code mailed to another address; anything else, or nothing,
// falls back to the cookie as before, then to English.
func TestNativeDoorsMailInTheAppsLanguage(t *testing.T) {
	out := &recordOutbox{}
	k := newNativeTestServerWithOutbox(t, out)
	users := db.New(testPool)
	for email, tc := range map[string]struct {
		locale       any
		cookie, want string
	}{
		"vi.app@example.com":     {"vi", "", "vi"},
		"en.app@example.com":     {"en", "vi", "en"},
		"none.app@example.com":   {nil, "", "en"},
		"cookie.app@example.com": {nil, "vi", "vi"},
		"odd.app@example.com":    {"fr", "vi", "vi"},
	} {
		body := nativeBody(map[string]any{"email": email, "password": "password123", "display_name": "Ngôn ngữ"})
		if tc.locale != nil {
			body["locale"] = tc.locale
		}
		headers := map[string]string{}
		if tc.cookie != "" {
			headers["Cookie"] = "uniwork-locale=" + tc.cookie
		}
		res, got := doJSONHeaders(t, k.srv, http.MethodPost, "/api/v1/auth/native/register", "", headers, body)
		if res.StatusCode != http.StatusOK || got["status"] != "signed_in" {
			t.Fatalf("register %s: %d %v", email, res.StatusCode, got)
		}
		if u, err := users.GetUserByEmail(context.Background(), email); err != nil || u.Locale != tc.want {
			t.Fatalf("register %s (locale %v, cookie %q): the account's language is %q, want %q (%v)", email, tc.locale, tc.cookie, u.Locale, tc.want, err)
		}
	}

	token, nonce := k.googleToken(t, "g-locale", "locale.app@gmail.com")
	_, got := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/google", "", nativeBody(map[string]any{"id_token": token, "nonce": nonce}))
	ticket, _ := got["ticket"].(string)
	if ticket == "" {
		t.Fatalf("an unmatched Google identity: %v", got)
	}
	res, got := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/sign-in-ticket/claim-email", "", nativeBody(map[string]any{
		"ticket": ticket, "nonce": nonce, "email": "an@acme.vn", "locale": "vi",
	}))
	if res.StatusCode != http.StatusOK || got["status"] != "sent" {
		t.Fatalf("claim: %d %v", res.StatusCode, got)
	}
	if m := out.lastMail(t); m.Kind != mail.KindSignInEmailClaim || m.To != "an@acme.vn" || m.Locale != "vi" {
		t.Fatalf("the code to the other address goes out in the app's language: %s %s %s", m.Kind, m.To, m.Locale)
	}
}

// Every door documents the app's language as the closed pair it is, on the
// one client part each door's body embeds.
func TestNativeDoorsDocumentTheAppsLanguage(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]map[string]struct {
			RequestBody struct {
				Content map[string]struct {
					Schema struct {
						Ref string `json:"$ref"`
					} `json:"schema"`
				} `json:"content"`
			} `json:"requestBody"`
		} `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]struct {
					Enum        []string `json:"enum"`
					Example     any      `json:"example"`
					Description string   `json:"description"`
				} `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	for _, door := range []string{
		"password", "mfa", "google", "apple", "register", "sign-in-ticket/create",
		"sign-in-ticket/claim-email", "sign-in-ticket/claim-email/verify", "sign-in-ticket/link",
	} {
		op, ok := spec.Paths["/api/v1/auth/native/"+door]["post"]
		if !ok {
			t.Fatalf("POST /auth/native/%s is not on the spec", door)
		}
		ref := op.RequestBody.Content["application/json"].Schema.Ref
		locale, ok := spec.Components.Schemas[strings.TrimPrefix(ref, "#/components/schemas/")].Properties["locale"]
		if !ok || strings.Join(locale.Enum, ",") != "vi,en" || locale.Example != any("vi") || locale.Description == "" {
			t.Fatalf("POST /auth/native/%s documents locale as %+v (%s)", door, locale, ref)
		}
	}
}

// The app's provider doors and its choice screen over HTTP (spec §3.6): a
// Google identity that matches no account answers identity_unmatched with a
// ticket and what the screen shows; the ticket creates the account only
// with the nonce of that sign-in (400 sign_in_ticket_channel otherwise); a
// token that does not verify is 401 provider_token_invalid. Turned on, the
// door reports google_native.
func TestNativeGoogleSignInOverHTTP(t *testing.T) {
	k := newNativeTestServer(t)
	_, providers := doJSON(t, k.srv, http.MethodGet, "/api/v1/auth/providers", "", nil)
	if providers["google_native"] != true || providers["google"] != false || providers["apple"] != true {
		t.Fatalf("providers = %v", providers)
	}
	token, nonce := k.googleToken(t, "g-http", "http.app@gmail.com")
	res, out := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/google", "", nativeBody(map[string]any{"id_token": token, "nonce": nonce}))
	ticket, _ := out["ticket"].(string)
	identity, _ := out["identity"].(map[string]any)
	if res.StatusCode != http.StatusOK || out["status"] != "identity_unmatched" || ticket == "" || out["session"] != nil ||
		identity["provider"] != "google" || identity["email"] != "http.app@gmail.com" || identity["private_relay"] != false {
		t.Fatalf("an unmatched Google identity: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/sign-in-ticket/create", "", nativeBody(map[string]any{
		"ticket": ticket, "nonce": "not-the-nonce", "display_name": "HTTP",
	}))
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "sign_in_ticket_channel" {
		t.Fatalf("create without the sign-in's nonce: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/sign-in-ticket/create", "", nativeBody(map[string]any{
		"ticket": "garbage", "nonce": nonce, "display_name": "HTTP",
	}))
	if res.StatusCode != http.StatusNotFound || errorCode(out) != "sign_in_ticket_missing" {
		t.Fatalf("no ticket: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/sign-in-ticket/create", "", nativeBody(map[string]any{
		"ticket": ticket, "nonce": nonce, "display_name": "HTTP",
	}))
	if res.StatusCode != http.StatusOK || out["status"] != "signed_in" || out["session"] == nil {
		t.Fatalf("create with the nonce: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/google", "", nativeBody(map[string]any{"id_token": token, "nonce": "other"}))
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "provider_token_invalid" {
		t.Fatalf("a token without its nonce: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/google", "", nativeBody(map[string]any{"id_token": token, "nonce": nonce}))
	if res.StatusCode != http.StatusOK || out["status"] != "signed_in" {
		t.Fatalf("the created account signs in with Google: %d %v", res.StatusCode, out)
	}
}

// The app links Google from its Settings with the SDK's token (spec §3.7):
// only with the app's bearer (a browser's is 400: it links through the
// provider's pages) and a step-up of the app's session; a token that does
// not verify is 403, never 401.
func TestLinkGoogleFromTheAppOverHTTP(t *testing.T) {
	k := newNativeTestServer(t)
	_, out := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/native/register", "", nativeBody(map[string]any{
		"email": "link.app@example.com", "password": "password123", "display_name": "Liên kết",
	}))
	sess, _ := out["session"].(map[string]any)
	bearer, _ := sess["access_token"].(string)
	if _, err := testPool.Exec(context.Background(), `UPDATE users SET email_verified_at = now() WHERE email = 'link.app@example.com'`); err != nil {
		t.Fatal(err)
	}
	token, nonce := k.googleToken(t, "g-link-app", "link.app@gmail.com")
	res, out := doJSON(t, k.srv, http.MethodPost, "/api/v1/me/sign-in-methods/google/native", bearer, map[string]any{"id_token": token, "nonce": nonce})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "proof_required" {
		t.Fatalf("no step-up: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/me/step-up", bearer, map[string]any{"password": "password123"})
	step, _ := out["step_up_token"].(string)
	if res.StatusCode != http.StatusOK || step == "" {
		t.Fatalf("step-up: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/me/sign-in-methods/google/native", bearer, map[string]any{"step_up_token": step, "id_token": token, "nonce": "other"})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "provider_token_invalid" {
		t.Fatalf("a token that does not verify: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/me/sign-in-methods/google/native", bearer, map[string]any{"step_up_token": step, "id_token": token, "nonce": nonce})
	methods, _ := out["sign_in_methods"].(map[string]any)
	google, _ := methods["google"].(map[string]any)
	if res.StatusCode != http.StatusOK || google["linked"] != true || google["email"] != "link.app@gmail.com" {
		t.Fatalf("the app's link: %d %v", res.StatusCode, out)
	}

	_, login := doJSON(t, k.srv, http.MethodPost, "/api/v1/auth/login", "", map[string]any{"email": "link.app@example.com", "password": "password123"})
	web, _ := login["access_token"].(string)
	res, out = doJSON(t, k.srv, http.MethodPost, "/api/v1/me/sign-in-methods/apple/native", web, map[string]any{"step_up_token": "x", "identity_token": "x", "nonce": "n"})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("a browser bearer at the app's link: %d %v", res.StatusCode, out)
	}
}

// Without the app's Google clients the door is closed (503) and
// /auth/providers says so; a server without the native doors answers 503 on
// all of them.
func TestNativeDoorsAnswer503WhileClosed(t *testing.T) {
	srv := newTestServer(t)
	for _, path := range []string{"/api/v1/auth/native/password", "/api/v1/auth/native/google", "/api/v1/auth/native/sign-in-ticket/create"} {
		res, out := doJSON(t, srv, http.MethodPost, path, "", nativeBody(nil))
		if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "native_sign_in_unavailable" || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s without the doors: %d %v", path, res.StatusCode, out)
		}
	}
	rec := httptest.NewRecorder()
	h := &handlers{Deps: Deps{NativeSignIn: &service.NativeSignInService{}, Auth: &service.AuthService{}}}
	body, _ := json.Marshal(nativeBody(map[string]any{"id_token": "x", "nonce": "n"}))
	h.nativeGoogle(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/native/google", bytes.NewReader(body)))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "google_not_configured") {
		t.Fatalf("Google closed: %d %s", rec.Code, rec.Body.String())
	}
}
