package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// postWithCookie posts JSON with one cookie and no bearer: the browser's
// second step after a redirect sign-in, whose challenge is the uniwork_mfa
// cookie.
func postWithCookie(t *testing.T, srv *httptest.Server, path string, cookie *http.Cookie, body any) (*http.Response, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res, out
}

// The lockout over the wire (spec §3.3): nine wrong codes are 401
// invalid_credentials like any wrong code, the tenth and everything while
// locked is 429 second_factor_locked with Retry-After and retry_after, the
// right code included.
func TestSecondFactorLockoutAnswers429OverHTTP(t *testing.T) {
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)
	secret, _ := enrolMFA(t, srv, w.token)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "audit@example.com", "password": "password123"})
	if res.StatusCode != 200 || out["mfa_required"] != true {
		t.Fatalf("login: %d %v", res.StatusCode, out)
	}
	token := out["mfa_token"].(string)
	for i := 1; i < 10; i++ {
		if res, out := doJSON(t, srv, "POST", "/api/v1/auth/mfa/verify", "", map[string]string{"mfa_token": token, "code": "000000"}); res.StatusCode != 401 || errorCode(out) != "invalid_credentials" {
			t.Fatalf("wrong code %d: %d %v", i, res.StatusCode, out)
		}
	}
	lockedAnswer := func(code string) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/auth/mfa/verify", "", map[string]string{"mfa_token": token, "code": code})
		if res.StatusCode != http.StatusTooManyRequests || errorCode(out) != "second_factor_locked" {
			t.Fatalf("locked: %d %v", res.StatusCode, out)
		}
		header, err := strconv.Atoi(res.Header.Get("Retry-After"))
		fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
		if err != nil || header < 1 || header > 900 || fields["retry_after"] != float64(header) {
			t.Fatalf("Retry-After %q, fields %v", res.Header.Get("Retry-After"), fields)
		}
	}
	lockedAnswer("111111")
	code, _ := auth.TOTPCode(secret, time.Now())
	lockedAnswer(code)
}

// The Google web flow's pending link, end to end through the cookie (spec
// §3.3, §3.4): the callback leaves the challenge with the identity in
// uniwork_mfa, the second step posts only the code, and the link commits
// with the session. When the identity went elsewhere meanwhile the second
// step still signs in and says link_skipped.
func TestGooglePendingLinkFinishesThroughTheMFACookie(t *testing.T) {
	g := &fakeGoogle{}
	srv := newTestServerWithGoogle(t, g)
	webToken, uid := filesRegister(t, srv, "pending@gmail.com")
	secret, _ := enrolMFA(t, srv, webToken)

	g.set(auth.GoogleClaims{Sub: "sub-pending", Email: "pending@gmail.com", EmailVerified: true})
	cookie, st := googleStart(t, srv, "/acme")
	res := googleCallback(t, srv, "code=good&state="+st.State, cookie)
	challenge := cookieNamed(res, mfaCookie)
	if res.StatusCode != http.StatusSeeOther || challenge == nil || challenge.Value == "" {
		t.Fatalf("callback: %d %q %+v", res.StatusCode, res.Header.Get("Location"), challenge)
	}
	q := db.New(testPool)
	if u, _ := q.GetUserByID(context.Background(), uid); u.GoogleID.Valid {
		t.Fatal("linked before the second factor")
	}
	code, _ := auth.TOTPCode(secret, time.Now())
	res, out := postWithCookie(t, srv, "/api/v1/auth/mfa/verify", challenge, map[string]string{"code": code})
	if res.StatusCode != 200 || out["access_token"] == nil || out["link_skipped"] != nil {
		t.Fatalf("verify: %d %v", res.StatusCode, out)
	}
	if u, _ := q.GetUserByID(context.Background(), uid); u.GoogleID.String != "sub-pending" {
		t.Fatalf("not linked after the second factor: %+v", u)
	}

	otherToken, otherID := filesRegister(t, srv, "skipped@gmail.com")
	otherSecret, _ := enrolMFA(t, srv, otherToken)
	g.set(auth.GoogleClaims{Sub: "sub-skipped", Email: "skipped@gmail.com", EmailVerified: true})
	cookie, st = googleStart(t, srv, "")
	challenge = cookieNamed(googleCallback(t, srv, "code=good&state="+st.State, cookie), mfaCookie)
	if _, err := q.CreateGoogleUser(context.Background(), db.CreateGoogleUserParams{
		ID: "01SKIPPEDELSEWHERE00000000", Email: "elsewhere@gmail.com", DisplayName: "E",
		GoogleID: pgtype.Text{String: "sub-skipped", Valid: true}, EmailVerified: true, Locale: "vi",
	}); err != nil {
		t.Fatal(err)
	}
	code, _ = auth.TOTPCode(otherSecret, time.Now())
	res, out = postWithCookie(t, srv, "/api/v1/auth/mfa/verify", challenge, map[string]string{"code": code})
	if res.StatusCode != 200 || out["access_token"] == nil || out["link_skipped"] != "sign_in_method_taken" {
		t.Fatalf("verify with the identity taken: %d %v", res.StatusCode, out)
	}
	if u, _ := q.GetUserByID(context.Background(), otherID); u.GoogleID.Valid {
		t.Fatalf("a taken identity was linked: %+v", u)
	}
}

// An unverified account is refused the enrolment over the wire as 403
// email_unverified (ADR 0049 §2).
func TestMFAEnrolmentNeedsAVerifiedEmailOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{"email": "unproved@example.com", "password": "password123", "display_name": "U"})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	if res, out := doJSON(t, srv, "POST", "/api/v1/me/mfa/setup", token, nil); res.StatusCode != http.StatusForbidden || errorCode(out) != "email_unverified" {
		t.Fatalf("setup: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/me/mfa/confirm", token, map[string]string{"code": "123456"}); res.StatusCode != http.StatusForbidden || errorCode(out) != "email_unverified" {
		t.Fatalf("confirm: %d %v", res.StatusCode, out)
	}
}
