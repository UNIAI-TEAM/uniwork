package handler

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// newTestServer dựng handler đầy đủ trên DB test. Các task sau mở rộng
// hàm này khi Deps thêm service mới.
func newTestServer(t *testing.T) *httptest.Server {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	orgs := service.NewOrganizationService(q)
	ws := service.NewWorkspaceService(pool, q, orgs)
	d := Deps{
		Cfg:           config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: "test"},
		Log:           slog.Default(),
		Minter:        minter,
		Auth:          service.NewAuthService(q, minter, time.Hour),
		Organizations: orgs,
		Workspaces:    ws,
		Onboarding:    service.NewOnboardingService(q, ws, service.NopPublisher{}),
		Tasks:         service.NewTaskService(q, ws, service.NopPublisher{}),
		Meetings:      service.NewMeetingService(q, ws, service.NopPublisher{}),
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
