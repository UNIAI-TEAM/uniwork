package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
)

// ticketRequest sends a JSON request the way the web app does: same-site,
// with the browser's cookies, and a bearer when one is given.
func ticketRequest(t *testing.T, srv *httptest.Server, method, path, token string, cookies []*http.Cookie, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for _, c := range cookies {
		if c != nil {
			req.AddCookie(c)
		}
	}
	res, err := noRedirectClient(srv).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res, out
}

// googleTicketCookie runs a Google web sign-in for claims and returns the
// ticket cookie it left.
func googleTicketCookie(t *testing.T, srv *httptest.Server, g *fakeGoogle, claims auth.GoogleClaims, next string) (*http.Response, *http.Cookie) {
	t.Helper()
	g.set(claims)
	cookie, st := googleStart(t, srv, next)
	res := googleCallback(t, srv, "code=good&state="+st.State, cookie)
	return res, cookieNamed(res, signInTicketCookie)
}

func cleared(c *http.Cookie) bool { return c != nil && c.Value == "" && c.MaxAge < 0 }

var claimDigits = regexp.MustCompile(`\b\d{6}\b`)

// A Google sign-in that matches no account lands on the choice screen with
// the identity in an HttpOnly ticket cookie and no session (spec §3.2,
// §3.4); the screen reads it back. A missing or broken ticket is 404
// sign_in_ticket_missing and its cookie goes.
func TestGoogleCallbackHandsAnUnmatchedIdentityATicket(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	res, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-new", Email: "new@gmail.com", EmailVerified: true, Name: "Ngọc"}, "/acme/team")
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/auth/continue?next=%2Facme%2Fteam" {
		t.Fatalf("status = %d location = %q", res.StatusCode, res.Header.Get("Location"))
	}
	if ticket == nil || ticket.Value == "" || !ticket.HttpOnly || ticket.Path != "/api/v1/auth" || ticket.SameSite != http.SameSiteLaxMode || ticket.MaxAge != 900 {
		t.Fatalf("ticket cookie = %+v", ticket)
	}
	if cookieNamed(res, refreshCookie) != nil || cookieNamed(res, mfaCookie) != nil {
		t.Fatal("no session and no challenge for an unmatched identity")
	}
	var n int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE google_id = 'g-new' OR email = 'new@gmail.com'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("an account was created: %d %v", n, err)
	}

	res, out := ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", []*http.Cookie{ticket}, nil)
	if res.StatusCode != http.StatusOK || out["provider"] != "google" || out["kind"] != "unmatched" || out["email"] != "new@gmail.com" ||
		out["name"] != "Ngọc" || out["private_relay"] != false || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("read: %d %v", res.StatusCode, out)
	}
	res, out = ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", nil, nil)
	if res.StatusCode != http.StatusNotFound || errorCode(out) != "sign_in_ticket_missing" {
		t.Fatalf("no ticket: %d %v", res.StatusCode, out)
	}
	res, out = ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", []*http.Cookie{{Name: signInTicketCookie, Value: "forged"}}, nil)
	if res.StatusCode != http.StatusNotFound || errorCode(out) != "sign_in_ticket_missing" || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatalf("a forged ticket: %d %v", res.StatusCode, out)
	}

	// From the register screen the account is created at once.
	g.set(auth.GoogleClaims{Sub: "g-up", Email: "up@gmail.com", EmailVerified: true, Name: "Up"})
	cookie, st := googleStartWith(t, srv, "/acme", "sign_up")
	res = googleCallback(t, srv, "code=good&state="+st.State, cookie)
	if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != "http://localhost:3000/auth/callback?next=%2Facme" ||
		cookieNamed(res, refreshCookie) == nil || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatalf("sign_up: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
}

// "Create a new account" over the wire: the body is required JSON, a
// nameless identity needs a display_name, and success answers like a login
// (refresh cookie and session) and drops the ticket.
func TestSignInTicketCreateOverHTTP(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	_, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-create", Email: "create@gmail.com", EmailVerified: true}, "")
	cookies := []*http.Cookie{ticket}

	if res, out := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/create", "", nil, map[string]any{}); res.StatusCode != http.StatusNotFound || errorCode(out) != "sign_in_ticket_missing" {
		t.Fatalf("no ticket: %d %v", res.StatusCode, out)
	}
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/auth/sign-in-ticket/create", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(ticket)
	if res, _ := srv.Client().Do(req); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed body: %d", res.StatusCode)
	}
	if res, out := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/create", "", cookies, map[string]any{"display_name": 7}); res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("a display_name that is not a string: %d %v", res.StatusCode, out)
	}
	if res, out := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/create", "", cookies, map[string]any{}); res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("a nameless identity without display_name: %d %v", res.StatusCode, out)
	}
	res, out := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/create", "", cookies, map[string]any{"display_name": "Tạo Mới"})
	user, _ := out["user"].(map[string]any)
	if res.StatusCode != http.StatusOK || out["access_token"] == nil || user["email"] != "create@gmail.com" || user["display_name"] != "Tạo Mới" {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	if cookieNamed(res, refreshCookie) == nil || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatal("create answers like a login and drops the ticket")
	}
}

// "I was invited with another address" over the wire: the send is always
// 200 sent (429 rate_limited with Retry-After within a minute), a wrong code
// is 400 invalid_code, and the right one answers like a login and drops the
// ticket. Bodies that are not what the route takes are 400.
func TestSignInTicketClaimEmailOverHTTP(t *testing.T) {
	g := &fakeGoogle{}
	out := &recordOutbox{}
	srv := newTestServerWithOutbox(t, g, out)
	_, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-claim", Email: "an.personal@gmail.com", EmailVerified: true, Name: "An"}, "")
	cookies := []*http.Cookie{ticket}
	const claim = "/api/v1/auth/sign-in-ticket/claim-email"

	for _, body := range []any{map[string]any{"email": "not an address"}, map[string]any{"email": 3}, map[string]any{}} {
		if res, got := ticketRequest(t, srv, http.MethodPost, claim, "", cookies, body); res.StatusCode != http.StatusBadRequest || errorCode(got) != "invalid_request" {
			t.Fatalf("%v: %d %v", body, res.StatusCode, got)
		}
	}
	res, got := ticketRequest(t, srv, http.MethodPost, claim, "", cookies, map[string]string{"email": "an@company.vn"})
	if res.StatusCode != http.StatusOK || got["status"] != "sent" {
		t.Fatalf("send: %d %v", res.StatusCode, got)
	}
	m := out.lastMail(t)
	code := claimDigits.FindString(m.Text)
	if m.Kind != mail.KindSignInEmailClaim || m.To != "an@company.vn" || code == "" {
		t.Fatalf("mail = %+v", m)
	}
	res, got = ticketRequest(t, srv, http.MethodPost, claim, "", cookies, map[string]string{"email": "an@company.vn"})
	if res.StatusCode != http.StatusTooManyRequests || errorCode(got) != "rate_limited" || res.Header.Get("Retry-After") == "" {
		t.Fatalf("resend: %d %v", res.StatusCode, got)
	}

	const verify = claim + "/verify"
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if res, got := ticketRequest(t, srv, http.MethodPost, verify, "", cookies, map[string]string{"email": "an@company.vn", "code": wrong}); res.StatusCode != http.StatusBadRequest || errorCode(got) != "invalid_code" {
		t.Fatalf("wrong code: %d %v", res.StatusCode, got)
	}
	if res, got := ticketRequest(t, srv, http.MethodPost, verify, "", cookies, map[string]any{"email": "an@company.vn", "code": 123456}); res.StatusCode != http.StatusBadRequest || errorCode(got) != "invalid_request" {
		t.Fatalf("a code that is not a string: %d %v", res.StatusCode, got)
	}
	res, got = ticketRequest(t, srv, http.MethodPost, verify, "", cookies, map[string]string{"email": "an@company.vn", "code": code, "display_name": "An Công Ty"})
	user, _ := got["user"].(map[string]any)
	if res.StatusCode != http.StatusOK || got["access_token"] == nil || user["email"] != "an@company.vn" || user["email_verified_at"] == nil {
		t.Fatalf("verify: %d %v", res.StatusCode, got)
	}
	if cookieNamed(res, refreshCookie) == nil || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatal("verify answers like a login and drops the ticket")
	}
}

// "Cancel" drops the ticket, whether or not there is one.
func TestSignInTicketDiscardOverHTTP(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	_, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-cancel", Email: "cancel@gmail.com", EmailVerified: true}, "")
	for _, cookies := range [][]*http.Cookie{{ticket}, nil} {
		res, _ := ticketRequest(t, srv, http.MethodDelete, "/api/v1/auth/sign-in-ticket", "", cookies, nil)
		if res.StatusCode != http.StatusNoContent || !cleared(cookieNamed(res, signInTicketCookie)) {
			t.Fatalf("discard: %d %+v", res.StatusCode, res.Cookies())
		}
	}
}

// "I already have an account" over the wire: a bearer route that also
// spends the ticket. Without a bearer it is 401; a session older than the
// ticket is 403 proof_required; one signed in after it links, answers the
// account and its methods, and drops the ticket; an identity an empty
// account holds is 409 sign_in_method_movable with the address masked, and
// moves with move: true.
func TestSignInTicketLinkOverHTTP(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	const link = "/api/v1/auth/sign-in-ticket/link"
	older, _ := filesRegister(t, srv, "an@company.vn")
	if _, err := testPool.Exec(context.Background(), `UPDATE refresh_tokens SET created_at = now() - interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	_, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-link", Email: "an.personal@gmail.com", EmailVerified: true, Name: "An"}, "")
	cookies := []*http.Cookie{ticket}

	if res, _ := ticketRequest(t, srv, http.MethodPost, link, "", cookies, map[string]any{}); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no bearer: %d", res.StatusCode)
	}
	if res, got := ticketRequest(t, srv, http.MethodPost, link, older, cookies, map[string]any{}); res.StatusCode != http.StatusForbidden || errorCode(got) != "proof_required" {
		t.Fatalf("an older session: %d %v", res.StatusCode, got)
	}
	res, got := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/login", "", cookies, map[string]any{"email": "an@company.vn", "password": "password123", "keep_sign_in_ticket": true})
	if res.StatusCode != http.StatusOK || cookieNamed(res, signInTicketCookie) != nil {
		t.Fatalf("the login that links keeps the ticket: %d %v %+v", res.StatusCode, got, res.Cookies())
	}
	fresh := got["access_token"].(string)
	if res, got := ticketRequest(t, srv, http.MethodPost, link, fresh, nil, map[string]any{}); res.StatusCode != http.StatusNotFound || errorCode(got) != "sign_in_ticket_missing" {
		t.Fatalf("no ticket: %d %v", res.StatusCode, got)
	}
	res, got = ticketRequest(t, srv, http.MethodPost, link, fresh, cookies, map[string]any{})
	if res.StatusCode != http.StatusOK || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatalf("link: %d %v", res.StatusCode, got)
	}
	methods, _ := got["sign_in_methods"].(map[string]any)
	google, _ := methods["google"].(map[string]any)
	password, _ := methods["password"].(map[string]any)
	if user, _ := got["user"].(map[string]any); user["email"] != "an@company.vn" || google["linked"] != true || google["email"] != "an.personal@gmail.com" ||
		password["set"] != true || methods["account_email_is_relay"] != false {
		t.Fatalf("link answer = %v", got)
	}
	if proofs, _ := methods["proofs"].([]any); len(proofs) != 2 || proofs[0] != "password" || proofs[1] != "email_code" {
		t.Fatalf("proofs = %v", methods["proofs"])
	}

	// The same ticket created an account in another tab: that empty account
	// holds the identity now.
	_, ticket = googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-empty", Email: "empty@gmail.com", EmailVerified: true, Name: "E"}, "")
	if res, got := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/sign-in-ticket/create", "", []*http.Cookie{ticket}, map[string]any{}); res.StatusCode != http.StatusOK {
		t.Fatalf("create the empty account: %d %v", res.StatusCode, got)
	}
	second, _ := filesRegister(t, srv, "binh@company.vn")
	res, got = ticketRequest(t, srv, http.MethodPost, link, second, []*http.Cookie{ticket}, map[string]any{})
	refusal, _ := got["error"].(map[string]any)
	if fields, _ := refusal["fields"].(map[string]any); res.StatusCode != http.StatusConflict || errorCode(got) != "sign_in_method_movable" || fields["masked_email"] != "e•••@gmail.com" {
		t.Fatalf("movable: %d %v", res.StatusCode, got)
	}
	res, got = ticketRequest(t, srv, http.MethodPost, link, second, []*http.Cookie{ticket}, map[string]any{"move": true})
	methods, _ = got["sign_in_methods"].(map[string]any)
	if google, _ := methods["google"].(map[string]any); res.StatusCode != http.StatusOK || google["email"] != "empty@gmail.com" {
		t.Fatalf("move: %d %v", res.StatusCode, got)
	}
	if res, got := ticketRequest(t, srv, http.MethodPost, link, second, []*http.Cookie{ticket}, map[string]any{"move": "yes"}); res.StatusCode != http.StatusBadRequest || errorCode(got) != "invalid_request" {
		t.Fatalf("a move that is not a bool: %d %v", res.StatusCode, got)
	}
}

// Link mode (/login?link=1, next the link step, spec §3.4, §4.4): the person
// takes the other provider to reach the account a waiting sign-in joins. One
// that finds no account to sign in to either — no account has it, or one
// holds its address that it may not join by itself — never replaces the
// sign-in it came to link: that ticket stays as it was (no Set-Cookie for
// it), the new one is given up, and /login says this way matched nothing,
// next kept. A cookie that is no live ticket waits for nothing, and outside
// link mode a new sign-in is a new choice: either way the new ticket is set.
func TestLinkModeKeepsTheWaitingTicketWhenTheOtherWayMatchesNothing(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	_, waiting := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-waits", Email: "waits@gmail.com", EmailVerified: true}, "")
	next := "/auth/continue?" + url.Values{"step": {"link"}, "next": {"/acme"}}.Encode()
	callback := func(claims auth.GoogleClaims, next string, cookies ...*http.Cookie) *http.Response {
		t.Helper()
		g.set(claims)
		state, st := googleStart(t, srv, next)
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/auth/google/callback?code=good&state="+st.State, nil)
		for _, c := range append([]*http.Cookie{state}, cookies...) {
			if c != nil {
				req.AddCookie(c)
			}
		}
		res, err := noRedirectClient(srv).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	nobody := auth.GoogleClaims{Sub: "g-nobody", Email: "nobody@gmail.com", EmailVerified: true}
	filesRegister(t, srv, "held@company.vn")
	for kind, claims := range map[string]auth.GoogleClaims{
		"unmatched":     nobody,
		"link_required": {Sub: "g-held", Email: "held@company.vn", EmailVerified: true},
	} {
		res := callback(claims, next, waiting)
		want := "http://localhost:3000/login?" + url.Values{"error": {"google_no_account"}, "next": {next}}.Encode()
		if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != want {
			t.Fatalf("link mode, %s: %d %q", kind, res.StatusCode, res.Header.Get("Location"))
		}
		if c := cookieNamed(res, signInTicketCookie); c != nil || cookieNamed(res, refreshCookie) != nil {
			t.Fatalf("link mode, %s: the waiting ticket is neither replaced nor dropped, and no session opens: %+v", kind, res.Cookies())
		}
		res, out := ticketRequest(t, srv, http.MethodGet, "/api/v1/auth/sign-in-ticket", "", []*http.Cookie{waiting}, nil)
		if res.StatusCode != http.StatusOK || out["email"] != "waits@gmail.com" {
			t.Fatalf("link mode, %s: the waiting sign-in: %d %v", kind, res.StatusCode, out)
		}
	}

	choice := func(next string) string {
		return "http://localhost:3000/auth/continue?" + url.Values{"next": {next}}.Encode()
	}
	for why, tc := range map[string]struct {
		next   string
		cookie *http.Cookie
	}{
		"nothing waiting":      {next, nil},
		"no live ticket waits": {next, &http.Cookie{Name: signInTicketCookie, Value: "forged"}},
		"not link mode":        {"/acme", waiting},
	} {
		res := callback(nobody, tc.next, tc.cookie)
		if res.StatusCode != http.StatusSeeOther || res.Header.Get("Location") != choice(tc.next) {
			t.Fatalf("%s: %d %q", why, res.StatusCode, res.Header.Get("Location"))
		}
		if c := cookieNamed(res, signInTicketCookie); c == nil || c.Value == "" || c.Value == waiting.Value {
			t.Fatalf("%s: the new ticket is set: %+v", why, c)
		}
	}
}

// Every sign-in drops a pending ticket unless it says it is the sign-in the
// ticket links into, and every sign-out drops it.
func TestSignInsAndSignOutDropThePendingTicket(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	filesRegister(t, srv, "drop@company.vn")
	_, ticket := googleTicketCookie(t, srv, g, auth.GoogleClaims{Sub: "g-drop", Email: "drop.personal@gmail.com", EmailVerified: true}, "")
	cookies := []*http.Cookie{ticket}
	login := map[string]any{"email": "drop@company.vn", "password": "password123"}
	res, _ := ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/login", "", cookies, login)
	if res.StatusCode != http.StatusOK || !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatalf("a plain login drops it: %d %+v", res.StatusCode, res.Cookies())
	}
	res, _ = ticketRequest(t, srv, http.MethodPost, "/api/v1/auth/logout", "", cookies, nil)
	if !cleared(cookieNamed(res, signInTicketCookie)) {
		t.Fatalf("logout drops it: %+v", res.Cookies())
	}
	// A Google sign-in into the link step keeps it.
	seedGoogleAccount(t, "01GOOGLEKEEPS", "keeps@gmail.com", "g-keeps")
	g.set(auth.GoogleClaims{Sub: "g-keeps", Email: "keeps@gmail.com", EmailVerified: true})
	next := "/auth/continue?" + url.Values{"step": {"link"}, "next": {"/acme"}}.Encode()
	cookie, st := googleStart(t, srv, next)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/auth/google/callback?code=good&state="+st.State, nil)
	req.AddCookie(cookie)
	req.AddCookie(ticket)
	res, err := noRedirectClient(srv).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSeeOther || cookieNamed(res, refreshCookie) == nil || cookieNamed(res, signInTicketCookie) != nil {
		t.Fatalf("the sign-in that links keeps the ticket: %d %q %+v", res.StatusCode, res.Header.Get("Location"), res.Cookies())
	}
}

// Login CSRF (ADR 0049 §9): every public route that opens a session or
// spends a sign-in ticket refuses what another site can make a browser
// send — a request marked Sec-Fetch-Site: cross-site (403
// cross_site_request) and a body that is not JSON, a form among them (415) —
// while the web app's same-site JSON and the native apps' JSON (no fetch
// metadata) reach the handler.
func TestCredentialRoutesRefuseCrossSiteForms(t *testing.T) {
	srv := newTestServer(t)
	_, out := doJSON(t, srv, http.MethodPost, "/api/v1/auth/register", "", map[string]string{"email": "csrf@example.com", "password": "password123", "display_name": "C"})
	token, _ := out["access_token"].(string)
	routes := []struct {
		method, path, token string
	}{
		{http.MethodPost, "/api/v1/auth/login", ""},
		{http.MethodPost, "/api/v1/auth/register", ""},
		{http.MethodPost, "/api/v1/auth/mfa/verify", ""},
		{http.MethodPost, "/api/v1/auth/password/reset", ""},
		{http.MethodGet, "/api/v1/auth/sign-in-ticket", ""},
		{http.MethodDelete, "/api/v1/auth/sign-in-ticket", ""},
		{http.MethodPost, "/api/v1/auth/sign-in-ticket/create", ""},
		{http.MethodPost, "/api/v1/auth/sign-in-ticket/claim-email", ""},
		{http.MethodPost, "/api/v1/auth/sign-in-ticket/claim-email/verify", ""},
		{http.MethodPost, "/api/v1/auth/sign-in-ticket/link", token},
		// The app's doors (ADR 0049 §8): the app posts JSON and sends no
		// fetch metadata, so only another site's forms are refused.
		{http.MethodPost, "/api/v1/auth/native/password", ""},
		{http.MethodPost, "/api/v1/auth/native/mfa", ""},
		{http.MethodPost, "/api/v1/auth/native/google", ""},
		{http.MethodPost, "/api/v1/auth/native/apple", ""},
		{http.MethodPost, "/api/v1/auth/native/register", ""},
		{http.MethodPost, "/api/v1/auth/native/sign-in-ticket/create", ""},
		{http.MethodPost, "/api/v1/auth/native/sign-in-ticket/claim-email", ""},
		{http.MethodPost, "/api/v1/auth/native/sign-in-ticket/claim-email/verify", ""},
		{http.MethodPost, "/api/v1/auth/native/sign-in-ticket/link", token},
	}
	send := func(method, path, token, site, contentType, body string) (int, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if site != "" {
			req.Header.Set("Sec-Fetch-Site", site)
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := noRedirectClient(srv).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = res.Body.Close() }()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, errorCode(out)
	}
	for _, r := range routes {
		body := "{}"
		if r.method != http.MethodPost {
			body = ""
		}
		if status, code := send(r.method, r.path, r.token, "cross-site", "application/json", body); status != http.StatusForbidden || code != "cross_site_request" {
			t.Errorf("%s %s cross-site: %d %s", r.method, r.path, status, code)
		}
		for _, origin := range []string{"same-site", ""} {
			if status, code := send(r.method, r.path, r.token, origin, "application/json", body); status == http.StatusForbidden && code == "cross_site_request" || status == http.StatusUnsupportedMediaType {
				t.Errorf("%s %s from %q: refused %d %s", r.method, r.path, origin, status, code)
			}
		}
		if r.method != http.MethodPost {
			continue
		}
		for _, form := range []struct{ contentType, body string }{
			{"application/x-www-form-urlencoded", "email=a%40b.c&password=x"},
			{"multipart/form-data; boundary=b", "--b--"},
			{"text/plain", `{"email":"a@b.c","password":"x"}`},
			{"", `{"email":"a@b.c","password":"x"}`},
		} {
			if status, code := send(r.method, r.path, r.token, "", form.contentType, form.body); status != http.StatusUnsupportedMediaType || code != "unsupported_media_type" {
				t.Errorf("%s %s as %q: %d %s", r.method, r.path, form.contentType, status, code)
			}
		}
	}
	// The routes that open no session and spend no cookie are not held to it.
	if status, _ := send(http.MethodPost, "/api/v1/auth/password/forgot", "", "", "application/json", `{"email":"a@b.c"}`); status != http.StatusOK {
		t.Fatalf("forgot password: %d", status)
	}
}
