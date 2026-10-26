package handler

import (
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
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
}
