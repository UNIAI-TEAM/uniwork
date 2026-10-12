package config

import (
	"strings"
	"testing"
	"time"
)

func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "s")
	t.Setenv("PORT", "")
	t.Setenv("TRUSTED_PROXIES", "")
	// The preview cases compare against this origin; a worktree .env sets its own port.
	t.Setenv("FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("PREVIEW_ORIGIN", "http://localhost:3001")
	t.Setenv("PREVIEW_CAPABILITY_SECRET", "preview-test-secret-that-is-at-least-32-chars")
	t.Setenv("PREVIEW_ASSET_TTL", "10m")
	t.Setenv("PREVIEW_ASSET_MAX_BYTES", "10485760")
	// make check exports the app's .env; pin everything Load reads so a local
	// value (API_PUBLIC_URL on another port, a dev code) cannot leak in.
	for _, k := range []string{"APP_ENV", "DEV_VERIFICATION_CODE", "API_PUBLIC_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM"} {
		t.Setenv(k, "")
	}
}

func TestLoadDerivesSecureCookiesFromFrontendOrigin(t *testing.T) {
	cases := []struct {
		origin string
		secure bool
	}{
		{"http://localhost:3000", false},
		{"https://app.example.com", true},
		{"HTTPS://app.example.com", true},
	}
	for _, tc := range cases {
		t.Run(tc.origin, func(t *testing.T) {
			setRequired(t)
			t.Setenv("FRONTEND_ORIGIN", tc.origin)
			c, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if c.SecureCookies != tc.secure {
				t.Fatalf("SecureCookies = %v, want %v", c.SecureCookies, tc.secure)
			}
		})
	}
}

func TestLoadRejectsRelativeFrontendOrigin(t *testing.T) {
	setRequired(t)
	t.Setenv("FRONTEND_ORIGIN", "app.example.com")
	if _, err := Load(); err == nil {
		t.Fatal("expected an error for an origin without a scheme")
	}
}

func TestLoadRejectsMissingOrInvalidPreviewConfig(t *testing.T) {
	cases := []struct {
		name string
		set  func(*testing.T)
	}{
		{"missing origin", func(t *testing.T) { t.Setenv("PREVIEW_ORIGIN", "") }},
		{"same origin", func(t *testing.T) { t.Setenv("PREVIEW_ORIGIN", "http://localhost:3000") }},
		{"wrong scheme", func(t *testing.T) { t.Setenv("PREVIEW_ORIGIN", "ftp://preview.example") }},
		{"missing secret", func(t *testing.T) { t.Setenv("PREVIEW_CAPABILITY_SECRET", "") }},
		{"invalid ttl", func(t *testing.T) { t.Setenv("PREVIEW_ASSET_TTL", "nonsense") }},
		{"invalid max bytes", func(t *testing.T) { t.Setenv("PREVIEW_ASSET_MAX_BYTES", "0") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			tc.set(t)
			if _, err := Load(); err == nil {
				t.Fatal("expected preview configuration to fail closed")
			}
		})
	}
}

func TestLoadEnableSwaggerDefaultsOnForLocalhost(t *testing.T) {
	setRequired(t)
	t.Setenv("FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("ENABLE_SWAGGER", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !c.EnableSwagger {
		t.Fatal("EnableSwagger must default on for a localhost origin")
	}
}

func TestLoadEnableSwaggerDefaultsOffInProduction(t *testing.T) {
	setRequired(t)
	t.Setenv("FRONTEND_ORIGIN", "https://app.example.com")
	t.Setenv("ENABLE_SWAGGER", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.EnableSwagger {
		t.Fatal("EnableSwagger must be off when ENABLE_SWAGGER is unset in production")
	}
}

// The relay stays on unless a single-replica deployment says false.
func TestLoadRealtimeRelayIsOnUnlessFalse(t *testing.T) {
	setRequired(t)
	for raw, want := range map[string]bool{"": true, "true": true, "false": false, " FALSE ": false} {
		t.Setenv("REALTIME_RELAY", raw)
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.RealtimeRelay != want {
			t.Fatalf("REALTIME_RELAY=%q: RealtimeRelay = %v, want %v", raw, c.RealtimeRelay, want)
		}
	}
}

func TestLoadEnableSwaggerTruthy(t *testing.T) {
	setRequired(t)
	for _, v := range []string{"1", "true", "TRUE", "yes"} {
		t.Run(v, func(t *testing.T) {
			t.Setenv("ENABLE_SWAGGER", v)
			c, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if !c.EnableSwagger {
				t.Fatalf("EnableSwagger = false for ENABLE_SWAGGER=%q", v)
			}
		})
	}
	t.Setenv("ENABLE_SWAGGER", "0")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.EnableSwagger {
		t.Fatal("EnableSwagger must be off for ENABLE_SWAGGER=0")
	}
}

func TestLoadRequiresDatabaseAndSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "s")
	if _, err := Load(); err == nil {
		t.Fatal("expected an error without DATABASE_URL")
	}
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected an error without JWT_SECRET")
	}
}

func TestLoadRejectsRelativeAPIPublicURL(t *testing.T) {
	setRequired(t)
	t.Setenv("API_PUBLIC_URL", "api.example.com")
	if _, err := Load(); err == nil {
		t.Fatal("expected an error for an API_PUBLIC_URL without a scheme")
	}
}

func TestDevVerificationCodeOnlyOutsideProduction(t *testing.T) {
	cases := []struct {
		name, env, code, want string
	}{
		{"development", "development", "123456", "123456"},
		{"unset env", "", "123456", "123456"},
		{"production", "production", "123456", ""},
		{"Production case-insensitive", "Production", "123456", ""},
		{"not six digits", "development", "12345", ""},
		{"letters", "development", "12345a", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("APP_ENV", tc.env)
			t.Setenv("DEV_VERIFICATION_CODE", tc.code)
			c, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if got := c.DevVerificationCode(); got != tc.want {
				t.Fatalf("DevVerificationCode() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGoogleEnabledNeedsBothCredentials(t *testing.T) {
	setRequired(t)
	t.Setenv("GOOGLE_CLIENT_ID", "id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.GoogleEnabled() {
		t.Fatal("enabled without a secret")
	}
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	c, _ = Load()
	if !c.GoogleEnabled() {
		t.Fatal("not enabled with both set")
	}
	if got := c.GoogleRedirectURL(); got != "http://localhost:8080/api/v1/auth/google/callback" {
		t.Fatalf("GoogleRedirectURL() = %q", got)
	}
}

func TestPushEnabledNeedsBothVAPIDKeys(t *testing.T) {
	setRequired(t)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.PushEnabled() {
		t.Fatal("enabled without VAPID")
	}
	t.Setenv("VAPID_PUBLIC_KEY", "pub")
	t.Setenv("VAPID_PRIVATE_KEY", "")
	c, _ = Load()
	if c.PushEnabled() {
		t.Fatal("enabled without private")
	}
	t.Setenv("VAPID_PRIVATE_KEY", "priv")
	c, _ = Load()
	if !c.PushEnabled() {
		t.Fatal("not enabled with both")
	}
}

func TestParseHelpersFallback(t *testing.T) {
	if parseDuration("", time.Second) != time.Second || parseDuration("nope", time.Second) != time.Second || parseDuration("0s", time.Second) != time.Second {
		t.Fatal("parseDuration fallback")
	}
	if parseDuration("2s", time.Second) != 2*time.Second {
		t.Fatal("parseDuration ok")
	}
	if parseRatio("", 0.5) != 0.5 || parseRatio("x", 0.5) != 0.5 || parseRatio("2", 0.5) != 0.5 || parseRatio("-0.1", 0.5) != 0.5 {
		t.Fatal("parseRatio fallback")
	}
	if parseRatio("0.25", 0.5) != 0.25 {
		t.Fatal("parseRatio ok")
	}
	if parseInt32("", 7) != 7 || parseInt32("x", 7) != 7 || parseInt32("0", 7) != 7 || parseInt32("-1", 7) != 7 {
		t.Fatal("parseInt32 fallback")
	}
	if parseInt32("9", 7) != 9 {
		t.Fatal("parseInt32 ok")
	}
}

// Email Hub's callback sits beside the calendar's, one path per provider; a
// trailing slash on API_PUBLIC_URL must not double up (providers match byte for byte).
func TestEmailHubRedirectURL(t *testing.T) {
	t.Parallel()
	c := Config{APIPublicURL: "https://api.example.com/"}
	for provider, want := range map[string]string{
		"google":    "https://api.example.com/api/v1/email-hub-connections/google/callback",
		"microsoft": "https://api.example.com/api/v1/email-hub-connections/microsoft/callback",
	} {
		if got := c.EmailHubRedirectURL(provider); got != want {
			t.Errorf("EmailHubRedirectURL(%q) = %q, want %q", provider, got, want)
		}
	}
}

// BE-F1-11: OFFICE_CHANGE_SNAPSHOT_TTL has a dev default, but a value that is
// SET must parse - a misspelled TTL fails the load instead of silently keeping
// the 15m default in production.
func TestLoadRejectsMalformedOfficeChangeSnapshotTTL(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"unset keeps the dev default", "", true},
		{"valid duration", "30m", true},
		{"nonsense text", "nonsense", false},
		{"missing unit", "15", false},
		{"zero", "0", false},
		{"negative", "-5m", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("OFFICE_CHANGE_SNAPSHOT_TTL", tc.raw)
			c, err := Load()
			if tc.want && err != nil {
				t.Fatalf("Load() error = %v, want success", err)
			}
			if !tc.want {
				if err == nil {
					t.Fatal("Load() accepted a malformed OFFICE_CHANGE_SNAPSHOT_TTL")
				}
				if !strings.Contains(err.Error(), "OFFICE_CHANGE_SNAPSHOT_TTL") {
					t.Fatalf("error %q does not name the variable", err)
				}
				return
			}
			if tc.raw == "" && c.OfficeChangeSnapshotTTL != 0 {
				t.Fatalf("OfficeChangeSnapshotTTL = %v for unset, want 0 (the service default)", c.OfficeChangeSnapshotTTL)
			}
			if tc.raw != "" && c.OfficeChangeSnapshotTTL != 30*time.Minute {
				t.Fatalf("OfficeChangeSnapshotTTL = %v, want the parsed 30m", c.OfficeChangeSnapshotTTL)
			}
		})
	}
}

// Load reads Email Hub's own OAuth clients (spec Q3) and sends Microsoft
// sign-in to the common directory unless a tenant is named.
func TestLoadEmailHubOAuthClients(t *testing.T) {
	setRequired(t)
	t.Setenv("EMAIL_HUB_GOOGLE_CLIENT_ID", "hub-google-id")
	t.Setenv("EMAIL_HUB_GOOGLE_CLIENT_SECRET", "hub-google-secret")
	t.Setenv("EMAIL_HUB_MICROSOFT_CLIENT_ID", "hub-ms-id")
	t.Setenv("EMAIL_HUB_MICROSOFT_CLIENT_SECRET", "hub-ms-secret")
	t.Setenv("EMAIL_HUB_MICROSOFT_TENANT", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.EmailHubGoogleClientID != "hub-google-id" || c.EmailHubGoogleClientSecret != "hub-google-secret" ||
		c.EmailHubMicrosoftClientID != "hub-ms-id" || c.EmailHubMicrosoftClientSecret != "hub-ms-secret" {
		t.Fatalf("email hub clients: %+v", c)
	}
	if c.EmailHubMicrosoftTenant != "common" {
		t.Fatalf("EmailHubMicrosoftTenant = %q, want common", c.EmailHubMicrosoftTenant)
	}
	t.Setenv("EMAIL_HUB_MICROSOFT_TENANT", "contoso.onmicrosoft.com")
	if c, _ = Load(); c.EmailHubMicrosoftTenant != "contoso.onmicrosoft.com" {
		t.Fatalf("EmailHubMicrosoftTenant = %q, want the named tenant", c.EmailHubMicrosoftTenant)
	}
}
