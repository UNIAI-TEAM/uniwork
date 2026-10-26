package handler

import (
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

func testDriveSecretBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

// GET /api/v1/config reports drive.available = true only when both the
// drive_connector flag is enabled for the caller AND the server has a
// configured Drive OAuth provider + secretbox (spec §5.1, §10).
func TestConfigPublishesDriveAvailability(t *testing.T) {
	box := testDriveSecretBox(t)

	for _, tc := range []struct {
		name      string
		flagOn    bool
		hasBox    bool
		clientID  string
		secret    string
		fake      bool
		appEnv    string
		wantAvail bool
	}{
		{
			name:      "default off when flag disabled and unconfigured",
			flagOn:    false,
			hasBox:    false,
			wantAvail: false,
		},
		{
			name:      "false when flag enabled but credentials missing",
			flagOn:    true,
			hasBox:    true,
			wantAvail: false,
		},
		{
			name:      "false when credentials present but flag disabled",
			flagOn:    false,
			hasBox:    true,
			clientID:  "drive-cid",
			secret:    "drive-sec",
			wantAvail: false,
		},
		{
			name:      "false when client id and secret present but secretbox nil",
			flagOn:    true,
			hasBox:    false,
			clientID:  "drive-cid",
			secret:    "drive-sec",
			wantAvail: false,
		},
		{
			name:      "true when flag enabled, box present, and Google Drive OAuth configured",
			flagOn:    true,
			hasBox:    true,
			clientID:  "drive-cid",
			secret:    "drive-sec",
			wantAvail: true,
		},
		{
			name:      "true in non-production when DRIVE_FAKE_PROVIDER=1 and box present",
			flagOn:    true,
			hasBox:    true,
			fake:      true,
			appEnv:    "development",
			wantAvail: true,
		},
		{
			name:      "false in production when DriveFakeProvider is true without real client credentials",
			flagOn:    true,
			hasBox:    true,
			fake:      true,
			appEnv:    "production",
			wantAvail: false,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := featureflag.NewStaticProvider()
			provider.Set("drive_connector", featureflag.Rule{Default: tc.flagOn})
			flags := featureflag.NewService(provider)
			cfg := config.Config{
				AppEnv:                  tc.appEnv,
				FrontendOrigin:          "http://localhost:3000",
				APIPublicURL:            "https://api.example.test",
				GoogleDriveClientID:     tc.clientID,
				GoogleDriveClientSecret: tc.secret,
				DriveFakeProvider:       tc.fake,
			}
			var b *secretbox.Box
			if tc.hasBox {
				b = box
			}
			driveSvc := service.NewDriveConnectionService(nil, nil, nil, b)
			driveSvc.ConfigureOAuth(cfg)
			driveSvc.SetFlags(flags)

			h := New(Deps{
				Cfg:              cfg,
				Log:              slog.Default(),
				FeatureFlags:     flags,
				DriveConnections: driveSvc,
			})
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("GET /api/v1/config = %d, want 200", rec.Code)
			}
			var out struct {
				Flags map[string]bool `json:"flags"`
				Drive struct {
					Available bool `json:"available"`
				} `json:"drive"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if out.Flags["drive_connector"] != tc.flagOn {
				t.Fatalf("flags.drive_connector = %v, want %v", out.Flags["drive_connector"], tc.flagOn)
			}
			if out.Drive.Available != tc.wantAvail {
				t.Fatalf("drive.available = %v, want %v", out.Drive.Available, tc.wantAvail)
			}
		})
	}
}

var (
	driveOAuthDataRE   = regexp.MustCompile(`<script id="d" type="application/json">([^<]*)</script>`)
	driveOAuthInlineRE = regexp.MustCompile(`<script>([^<]*)</script>`)
)

type driveOAuthPageData struct {
	Origin string `json:"origin"`
	OK     bool   `json:"ok"`
	Code   string `json:"code"`
}

func parseDriveOAuthPageData(t *testing.T, body string) driveOAuthPageData {
	t.Helper()
	m := driveOAuthDataRE.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("no data block in %q", body)
	}
	var d driveOAuthPageData
	if err := json.Unmarshal([]byte(m[1]), &d); err != nil {
		t.Fatalf("data block %q: %v", m[1], err)
	}
	return d
}

// The callback HTML page always answers 200 with a strict CSP, clears the
// HttpOnly nonce cookie, and posts `{type: "uniwork:drive-oauth", ok, code}`
// for all 10 callback result codes (`connected` and `reconnected` have ok=true;
// all refusal codes have ok=false; spec §5.2).
func TestDriveOAuthCallbackPageAndCookie(t *testing.T) {
	t.Parallel()
	for _, secure := range []bool{false, true} {
		h := &handlers{Deps: Deps{Cfg: config.Config{SecureCookies: secure}}}
		rec := httptest.NewRecorder()
		h.setDriveAuthCookie(rec, httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/w1/drive-connections/google/start", nil), "nonce-123")
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("cookies = %d, want 1", len(cookies))
		}
		c := cookies[0]
		if c.Name != driveAuthCookie || c.Value != "nonce-123" || c.Path != driveAuthCookiePath ||
			!c.HttpOnly || c.Secure != secure || c.SameSite != http.SameSiteLaxMode || c.MaxAge != 600 {
			t.Fatalf("cookie = %+v, want HttpOnly Lax MaxAge=600 Secure=%v Path=%s", c, secure, driveAuthCookiePath)
		}
	}

	codes := []struct {
		code   string
		wantOK bool
	}{
		{sdo.DriveOAuthConnected, true},
		{sdo.DriveOAuthReconnected, true},
		{sdo.DriveOAuthConsentRequired, false},
		{sdo.DriveOAuthScopeNotGranted, false},
		{sdo.DriveOAuthAccountMismatch, false},
		{sdo.DriveOAuthStateInvalid, false},
		{sdo.DriveOAuthRetryConnect, false},
		{sdo.DriveOAuthBlockedByWorkspaceAdmin, false},
		{sdo.DriveOAuthAccessDenied, false},
		{sdo.DriveOAuthProviderError, false},
	}
	for _, tc := range codes {
		rec := httptest.NewRecorder()
		writeDriveOAuthPage(rec, "http://localhost:3000", tc.code)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200", tc.code, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s: Cache-Control = %q, want no-store", tc.code, got)
		}
		if got := rec.Header().Get("Content-Security-Policy"); got != driveOAuthCSP {
			t.Fatalf("%s: CSP = %q, want %q", tc.code, got, driveOAuthCSP)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `type:"uniwork:drive-oauth"`) {
			t.Fatalf("%s: script must post uniwork:drive-oauth message: %s", tc.code, body)
		}
		m := driveOAuthInlineRE.FindStringSubmatch(body)
		if m == nil || m[1] != driveOAuthScript || strings.Count(body, "<script") != 2 {
			t.Fatalf("%s: inline script mismatch in %s", tc.code, body)
		}
		d := parseDriveOAuthPageData(t, body)
		if d.Origin != "http://localhost:3000" || d.Code != tc.code || d.OK != tc.wantOK {
			t.Fatalf("%s: data = %+v, want origin=http://localhost:3000 code=%s ok=%v", tc.code, d, tc.code, tc.wantOK)
		}
	}

	// Hostile origin with `</script>` cannot break out of the JSON script tag.
	rec := httptest.NewRecorder()
	writeDriveOAuthPage(rec, "https://evil.test/</script><script>alert(1)//", sdo.DriveOAuthStateInvalid)
	if strings.Count(rec.Body.String(), "</script>") != 2 {
		t.Fatalf("hostile origin broke out of data block: %s", rec.Body.String())
	}

	// Verify FakeDriveProvider builds an offline local callback URL with fake-cid (no Google host).
	fake := service.NewFakeDriveProvider(config.Config{
		APIPublicURL:   "http://localhost:8080",
		FrontendOrigin: "http://localhost:3000",
	})
	cbURL := fake.CallbackURL("sealed-state-1", "fake-u1", "chal-1", "consent select_account", "", "oidc-n1")
	parsedCB, err := url.Parse(cbURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsedCB.Host != "localhost:8080" || parsedCB.Path != "/api/v1/drive-connections/google/callback" ||
		parsedCB.Query().Get("code") != "fake-u1" || parsedCB.Query().Get("state") != "sealed-state-1" ||
		parsedCB.Query().Get("client_id") != "fake-cid" {
		t.Fatalf("unexpected FakeDriveProvider.CallbackURL = %q", cbURL)
	}
}

// TestDriveFakeProviderOfflineEndToEndFlow (R1-4) verifies that with
// DRIVE_FAKE_PROVIDER=1, StartDriveGoogleOAuth returns an offline local
// callback URL (no Google host), and calling that unmodified URL with the
// nonce cookie through the real HTTP handler completes at the callback HTML
// page with ok=true, followed by List showing the connection and Disconnect
// removing it.
func TestDriveFakeProviderOfflineEndToEndFlow(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	box := testDriveSecretBox(t)
	q := db.New(pool)
	flags, _, err := featureflags.NewService(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Enable drive_connector globally via static provider for this test.
	sp := featureflag.NewStaticProvider()
	sp.Set("drive_connector", featureflag.Rule{Default: true})
	d.FeatureFlags = featureflag.NewService(sp)

	d.Cfg.FrontendOrigin = "http://localhost:3000"
	d.Cfg.DriveFakeProvider = true
	d.DriveConnections = service.NewDriveConnectionService(pool, q, d.Workspaces, box)
	d.DriveConnections.SetFlags(d.FeatureFlags)
	_ = flags

	var srv *httptest.Server
	srv = httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	d.Cfg.APIPublicURL = srv.URL
	d.DriveConnections.ConfigureOAuth(d.Cfg)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "drive-fake-e2e@example.com", "password": "password123", "display_name": "Drive Fake E2E",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	tag := strings.ToLower(util.NewID()[:8])
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "Drive Org", "slug": "drive-fake-org-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "Drive WS", "slug": "drive-fake-ws-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	// 1. StartOAuth via POST /api/v1/workspaces/{workspaceID}/drive-connections/google/start.
	startRes, startOut := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/drive-connections/google/start", token, map[string]any{})
	if startRes.StatusCode != http.StatusOK {
		t.Fatalf("StartDriveGoogleOAuth: %d %v", startRes.StatusCode, startOut)
	}
	authURL, _ := startOut["authorization_url"].(string)
	parsedURL, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parse authorization_url %q: %v", authURL, err)
	}
	if strings.Contains(parsedURL.Host, "google.com") || strings.Contains(parsedURL.Host, "googleapis.com") {
		t.Fatalf("DRIVE_FAKE_PROVIDER=1 authorization_url must not point at Google: %q", authURL)
	}
	if parsedURL.Path != "/api/v1/drive-connections/google/callback" || parsedURL.Query().Get("code") == "" || parsedURL.Query().Get("state") == "" {
		t.Fatalf("unexpected fake authorization_url: %q", authURL)
	}
	if parsedURL.Query().Get("client_id") != "fake-cid" {
		t.Fatalf("expected default fake client_id fake-cid, got %q", parsedURL.Query().Get("client_id"))
	}
	var nonceCookie *http.Cookie
	for _, c := range startRes.Cookies() {
		if c.Name == driveAuthCookie {
			nonceCookie = c
		}
	}
	if nonceCookie == nil || nonceCookie.Value == "" {
		t.Fatalf("expected %s cookie on StartDriveGoogleOAuth, got %v", driveAuthCookie, startRes.Cookies())
	}

	// 2. Call the unmodified authorization_url through the real HTTP server with the nonce cookie.
	cbReq, err := http.NewRequest(http.MethodGet, authURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	cbReq.AddCookie(nonceCookie)
	cbRes, err := srv.Client().Do(cbReq)
	if err != nil {
		t.Fatalf("GET authorization_url: %v", err)
	}
	cbBodyBytes, _ := io.ReadAll(cbRes.Body)
	_ = cbRes.Body.Close()
	if cbRes.StatusCode != http.StatusOK {
		t.Fatalf("callback status = %d, body = %s", cbRes.StatusCode, string(cbBodyBytes))
	}
	pageData := parseDriveOAuthPageData(t, string(cbBodyBytes))
	if !pageData.OK || pageData.Code != sdo.DriveOAuthConnected {
		t.Fatalf("callback page data = %+v, want ok=true code=connected", pageData)
	}

	// 3. List shows the connected account.
	listRes, listOut := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/drive-connections", token, nil)
	if listRes.StatusCode != http.StatusOK {
		t.Fatalf("ListDriveConnections: %d %v", listRes.StatusCode, listOut)
	}
	conns := jsonArrayAt(t, listOut, "connections")
	if len(conns) != 1 {
		t.Fatalf("connections len = %d, want 1: %v", len(conns), conns)
	}
	connMap := conns[0].(map[string]any)
	connID, _ := connMap["id"].(string)
	if connID == "" || connMap["status"] != "active" {
		t.Fatalf("unexpected connection DTO: %v", connMap)
	}

	// 4. Disconnect removes the connection from List.
	discRes, discOut := doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/drive-connections/"+connID, token, nil)
	if discRes.StatusCode != http.StatusOK || discOut["status"] != "ok" {
		t.Fatalf("DisconnectDriveConnection: %d %v", discRes.StatusCode, discOut)
	}
	listAfterRes, listAfterOut := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/drive-connections", token, nil)
	if listAfterRes.StatusCode != http.StatusOK || len(jsonArrayAt(t, listAfterOut, "connections")) != 0 {
		t.Fatalf("ListDriveConnections after disconnect: %d %v", listAfterRes.StatusCode, listAfterOut)
	}
}
