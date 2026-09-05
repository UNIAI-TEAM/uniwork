package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	meetingspkg "github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// testDevCode is the development verification code the test server accepts.
const testDevCode = "123456"

var resetToken = regexp.MustCompile(`token=([A-Za-z0-9]+)`)

// discardOutbox drops mail: the handler tests verify through the dev code.
type discardOutbox struct{}

func (discardOutbox) Enqueue(context.Context, *db.Queries, mail.Message) (string, error) {
	return "e", nil
}
func (discardOutbox) Kick() {}

// recordOutbox keeps the last enqueued mail so a test can pull the reset
// token out of its body instead of hitting the database directly.
type recordOutbox struct {
	mu   sync.Mutex
	last mail.Message
}

func (o *recordOutbox) Enqueue(_ context.Context, _ *db.Queries, m mail.Message) (string, error) {
	o.mu.Lock()
	o.last = m
	o.mu.Unlock()
	return "e", nil
}
func (o *recordOutbox) Kick() {}

func (o *recordOutbox) lastMail(t *testing.T) mail.Message {
	t.Helper()
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.last.Kind == "" {
		t.Fatal("no mail queued")
	}
	return o.last
}

// newTestServer dựng handler đầy đủ trên DB test. Các task sau mở rộng
// hàm này khi Deps thêm service mới.
func newTestServer(t *testing.T) *httptest.Server {
	return newTestServerWithGoogle(t, nil)
}

// newTestServerWithGoogle wires a Google exchanger; nil leaves Google off.
func newTestServerWithGoogle(t *testing.T, google GoogleExchanger) *httptest.Server {
	return newTestServerWithOutbox(t, google, discardOutbox{})
}

// newTestServerWithOutbox lets a test observe what password-reset mail was
// queued (recordOutbox) instead of dropping it (discardOutbox).
func newTestServerWithOutbox(t *testing.T, google GoogleExchanger, out mail.Enqueuer) *httptest.Server {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	orgs := service.NewOrganizationService(pool, q)
	ws := service.NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{})
	verification := service.NewVerificationService(q, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}, testDevCode)
	authSvc := service.NewAuthService(pool, q, minter, time.Hour, verification)
	d := Deps{
		Cfg:           config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: "test"},
		Log:           slog.Default(),
		Minter:        minter,
		Auth:          authSvc,
		GoogleAuth:    service.NewGoogleAuthService(q, authSvc),
		Verification:  verification,
		PasswordReset: service.NewPasswordResetService(pool, q, authSvc, mail.Renderer{AppURL: "http://localhost:3000"}, out),
		Google:        google,
		Organizations: orgs,
		Workspaces:    ws,
		Onboarding:    service.NewOnboardingService(q, ws, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}),
		Tasks:         service.NewTaskService(pool, q, ws),
		Agents:        service.NewAgentService(pool, q, orgs, ws),
		Actors:        service.NewActorService(q),
		Audit:         service.NewAuditService(pool, q, orgs, ws),
		Meetings:      service.NewMeetingService(pool, q, ws, service.NopPublisher{}, &meetingspkg.FakeProvider{}, service.MeetingRuntime{HMACKey: []byte("test")}),
		Hub:           realtime.NewHub(),
		// LOCAL_UPLOAD_DIR is set per test to a temp dir by the tests that upload.
		Storage: storage.NewLocalStorageFromEnv(),
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

func postJSON(t *testing.T, srv *httptest.Server, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := srv.Client().Post(srv.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestRegisterAndMe(t *testing.T) {
	srv := newTestServer(t)

	res := postJSON(t, srv, "/api/v1/auth/register", map[string]string{
		"email": "h@example.com", "password": "password123", "display_name": "Hà",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register status = %d", res.StatusCode)
	}
	var out struct {
		User        struct{ ID, Email string } `json:"user"`
		AccessToken string                     `json:"access_token"`
	}
	json.NewDecoder(res.Body).Decode(&out)
	if out.AccessToken == "" {
		t.Fatal("no access token")
	}
	// refresh cookie được set
	found := false
	for _, c := range res.Cookies() {
		if c.Name == "uniwork_refresh" && c.HttpOnly {
			found = true
		}
	}
	if !found {
		t.Fatal("refresh cookie not set")
	}

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+out.AccessToken)
	res2, _ := srv.Client().Do(req)
	if res2.StatusCode != 200 {
		t.Fatalf("me status = %d", res2.StatusCode)
	}
}

func TestMeWithoutTokenIs401(t *testing.T) {
	srv := newTestServer(t)
	res, _ := srv.Client().Get(srv.URL + "/api/v1/me")
	if res.StatusCode != 401 {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
}

func TestPatchMe(t *testing.T) {
	srv := newTestServer(t)
	res := postJSON(t, srv, "/api/v1/auth/register", map[string]string{
		"email": "patch@example.com", "password": "password123", "display_name": "Before",
	})
	var out struct {
		AccessToken string `json:"access_token"`
	}
	json.NewDecoder(res.Body).Decode(&out)

	patchRes, patchOut := doJSON(t, srv, "PATCH", "/api/v1/me", out.AccessToken, map[string]string{"display_name": "After"})
	if patchRes.StatusCode != 200 {
		t.Fatalf("patch status = %d", patchRes.StatusCode)
	}
	user, _ := patchOut["user"].(map[string]any)
	if user["display_name"] != "After" {
		t.Fatalf("display_name = %v", user["display_name"])
	}
}

func TestRefreshCookieSecureFollowsConfig(t *testing.T) {
	for _, secure := range []bool{false, true} {
		h := &handlers{Deps: Deps{Cfg: config.Config{SecureCookies: secure}}}
		rec := httptest.NewRecorder()
		h.setRefreshCookie(rec, "tok", time.Now().Add(time.Hour))
		res := rec.Result()
		var found *http.Cookie
		for _, c := range res.Cookies() {
			if c.Name == refreshCookie {
				found = c
			}
		}
		if found == nil {
			t.Fatal("refresh cookie not set")
		}
		if found.Secure != secure || !found.HttpOnly || found.SameSite != http.SameSiteLaxMode || found.Path != "/api/v1/auth" {
			t.Fatalf("secure=%v: cookie = %+v", secure, found)
		}
	}
}

// verifyEmail confirms the registered user's address with the test server's
// development code, the step every fixture needs before onboarding.
func verifyEmail(t *testing.T, srv *httptest.Server, token string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/me/email/verify", token, map[string]string{"code": testDevCode})
	if res.StatusCode != 200 {
		t.Fatalf("verify email: %d %v", res.StatusCode, out)
	}
}

func TestEmailVerificationFlow(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "v@example.com", "password": "password123", "display_name": "V"})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	if v, ok := out["user"].(map[string]any)["email_verified_at"]; !ok || v != nil {
		t.Fatalf("register must expose email_verified_at=null, got %v", out["user"])
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/me/onboarding/complete", token, map[string]string{})
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "email_unverified" {
		t.Fatalf("complete before verify: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/email/resend", token, nil)
	if res.StatusCode != 429 || out["error"].(map[string]any)["code"] != "rate_limited" {
		t.Fatalf("resend right after register: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/email/verify", token, map[string]string{"code": "000000"})
	if res.StatusCode != 400 || out["error"].(map[string]any)["code"] != "invalid_code" {
		t.Fatalf("wrong code: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/email/verify", token, map[string]string{"code": testDevCode})
	if res.StatusCode != 200 {
		t.Fatalf("verify: %d %v", res.StatusCode, out)
	}
	if out["user"].(map[string]any)["email_verified_at"] == nil {
		t.Fatalf("verified user must carry email_verified_at, got %v", out["user"])
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/email/resend", token, nil)
	if res.StatusCode != 409 {
		t.Fatalf("resend after verified: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/me/onboarding/complete", token, map[string]string{})
	if res.StatusCode != 200 {
		t.Fatalf("complete after verify: %d %v", res.StatusCode, out)
	}
}

func TestForgotPasswordAlwaysOKAndResetChangesPassword(t *testing.T) {
	out := &recordOutbox{}
	srv := newTestServerWithOutbox(t, nil, out)
	res, body := doJSON(t, srv, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "ghost@example.com"})
	if res.StatusCode != 200 || body["status"] != "ok" {
		t.Fatalf("unknown email must be 200 ok: %d %v", res.StatusCode, body)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "not-an-email"})
	if res.StatusCode != 400 {
		t.Fatalf("malformed email: %d", res.StatusCode)
	}
	res, body = doJSON(t, srv, "POST", "/api/v1/auth/password/reset", "", map[string]string{"token": "nope", "password": "newpassword1"})
	if res.StatusCode != 400 || body["error"].(map[string]any)["code"] != "invalid_token" {
		t.Fatalf("bad token: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "reset@example.com", "password": "password123", "display_name": "R",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/auth/password/forgot", "", map[string]string{"email": "reset@example.com"})
	if res.StatusCode != 200 || body["status"] != "ok" {
		t.Fatalf("forgot for real user: %d %v", res.StatusCode, body)
	}
	tok := resetToken.FindStringSubmatch(out.lastMail(t).Text)
	if tok == nil {
		t.Fatalf("no token in queued mail: %+v", out.lastMail(t))
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/auth/password/reset", "", map[string]string{"token": tok[1], "password": "brandnewpass1"})
	if res.StatusCode != 200 || body["access_token"] == "" || body["access_token"] == nil {
		t.Fatalf("reset: %d %v", res.StatusCode, body)
	}
	found := false
	for _, c := range res.Cookies() {
		if c.Name == refreshCookie && c.HttpOnly {
			found = true
		}
	}
	if !found {
		t.Fatal("reset must set refresh cookie")
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "reset@example.com", "password": "brandnewpass1"})
	if res.StatusCode != 200 {
		t.Fatalf("login with new password: %d %v", res.StatusCode, body)
	}
}

func TestAuthProvidersReflectsGoogleConfig(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "GET", "/api/v1/auth/providers", "", nil)
	if res.StatusCode != 200 || out["google"] != false {
		t.Fatalf("providers without google: %d %v", res.StatusCode, out)
	}
}

func TestRegisterPicksLocaleFromCookieThenAcceptLanguage(t *testing.T) {
	srv := newTestServer(t)
	body, _ := json.Marshal(map[string]string{"email": "loc@example.com", "password": "password123", "display_name": "L"})
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if got := out["user"].(map[string]any)["locale"]; got != "en" {
		t.Fatalf("locale from Accept-Language: want en, got %v", got)
	}

	body, _ = json.Marshal(map[string]string{"email": "loc2@example.com", "password": "password123", "display_name": "L"})
	req, _ = http.NewRequest("POST", srv.URL+"/api/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "en")
	req.AddCookie(&http.Cookie{Name: "uniwork-locale", Value: "vi"})
	res, _ = http.DefaultClient.Do(req)
	_ = json.NewDecoder(res.Body).Decode(&out)
	if got := out["user"].(map[string]any)["locale"]; got != "vi" {
		t.Fatalf("cookie wins: want vi, got %v", got)
	}
	token := out["access_token"].(string)

	res, out = doJSON(t, srv, "PATCH", "/api/v1/me", token, map[string]string{"locale": "en"})
	if res.StatusCode != 200 || out["user"].(map[string]any)["locale"] != "en" {
		t.Fatalf("patch locale: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "PATCH", "/api/v1/me", token, map[string]string{"locale": "fr"})
	if res.StatusCode != 400 {
		t.Fatalf("unsupported locale must be 400, got %d", res.StatusCode)
	}

	// A display_name paired with an invalid locale must not partially apply:
	// the whole request fails and the display name stays unchanged.
	res, out = doJSON(t, srv, "PATCH", "/api/v1/me", token, map[string]string{"display_name": "Changed", "locale": "fr"})
	if res.StatusCode != 400 {
		t.Fatalf("display_name + invalid locale must be 400, got %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", "/api/v1/me", token, nil)
	if got := out["user"].(map[string]any)["display_name"]; got == "Changed" {
		t.Fatalf("display_name must not persist when locale in the same request is invalid, got %v", got)
	}
}
