package config

import (
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
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
	for _, k := range []string{"APP_ENV", "EXPO_ACCESS_TOKEN", "DEV_VERIFICATION_CODE", "API_PUBLIC_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "DOCUMENT_COMMIT_INTENT_CLAIM_TTL", "DOCUMENT_COMMIT_INTENT_RETENTION", "DOCUMENT_COMMIT_INTENT_SWEEP_TICK", "FOLDER_UPLOAD_MAX_FILES", "FOLDER_UPLOAD_MAX_BYTES", "APPLE_SIWA_AUDIENCES", "APPLE_SIWA_TEAM_ID", "APPLE_SIWA_KEY_ID", "APPLE_SIWA_PRIVATE_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_VOIP_TOPIC"} {
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

// The file collector deletes by default; dry_run and off are the switches
// back, and a typo fails startup instead of silently picking one.
func TestLoadFileGCModeDefaultsToDestructive(t *testing.T) {
	setRequired(t)
	for raw, want := range map[string]string{"": "destructive", "destructive": "destructive", " DRY_RUN ": "dry_run", "off": "off"} {
		t.Setenv("FILE_GC_MODE", raw)
		c, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if c.FileGCMode != want {
			t.Fatalf("FILE_GC_MODE=%q: FileGCMode = %q, want %q", raw, c.FileGCMode, want)
		}
	}
	t.Setenv("FILE_GC_MODE", "delete")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "FILE_GC_MODE") {
		t.Fatalf("FILE_GC_MODE=delete: err = %v, want a FILE_GC_MODE error", err)
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
			t.Setenv("EXPO_ACCESS_TOKEN", "expo-test-token")
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

// UNI-1645 addendum §7: the edit-lock settings are read strictly. A mistyped
// value must stop the server instead of silently behaving like the default,
// and the two cross checks keep a client from losing the lock on one missed
// heartbeat or holding offline longer than the chain cap.
func TestLoadRejectsBadEditLockConfig(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want string // substring of the error; empty = Load must succeed
	}{
		{"all unset keeps the defaults", nil, ""},
		{"valid overrides", map[string]string{"DOCUMENT_EDIT_LOCK_TTL": "4m", "DOCUMENT_EDIT_LOCK_HEARTBEAT": "1m", "DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR": "9"}, ""},
		{"TTL typo", map[string]string{"DOCUMENT_EDIT_LOCK_TTL": "2mn"}, "DOCUMENT_EDIT_LOCK_TTL"},
		{"TTL zero", map[string]string{"DOCUMENT_EDIT_LOCK_TTL": "0"}, "DOCUMENT_EDIT_LOCK_TTL"},
		{"heartbeat typo", map[string]string{"DOCUMENT_EDIT_LOCK_HEARTBEAT": "30"}, "DOCUMENT_EDIT_LOCK_HEARTBEAT"},
		{"sweep negative", map[string]string{"DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL": "-30s"}, "DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL"},
		{"hold max typo", map[string]string{"DOCUMENT_EDIT_HOLD_MAX": "eight hours"}, "DOCUMENT_EDIT_HOLD_MAX"},
		{"hold chain max typo", map[string]string{"DOCUMENT_EDIT_HOLD_CHAIN_MAX": "1d"}, "DOCUMENT_EDIT_HOLD_CHAIN_MAX"},
		{"request TTL typo", map[string]string{"DOCUMENT_EDIT_REQUEST_TTL": "15 minutes"}, "DOCUMENT_EDIT_REQUEST_TTL"},
		{"heartbeat x2 above TTL", map[string]string{"DOCUMENT_EDIT_LOCK_TTL": "1m", "DOCUMENT_EDIT_LOCK_HEARTBEAT": "40s"}, "DOCUMENT_EDIT_LOCK_HEARTBEAT must be at most half"},
		{"hold max above chain max", map[string]string{"DOCUMENT_EDIT_HOLD_MAX": "25h"}, "DOCUMENT_EDIT_HOLD_MAX must not exceed"},
		{"max per hour zero", map[string]string{"DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR": "0"}, "DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR"},
		{"max per hour not a number", map[string]string{"DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR": "five"}, "DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR"},
	}
	keys := []string{
		"DOCUMENT_EDIT_LOCK_TTL", "DOCUMENT_EDIT_LOCK_HEARTBEAT", "DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL",
		"DOCUMENT_EDIT_HOLD_MAX", "DOCUMENT_EDIT_HOLD_CHAIN_MAX", "DOCUMENT_EDIT_REQUEST_TTL",
		"DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR",
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			for _, k := range keys {
				t.Setenv(k, tc.env[k])
			}
			c, err := Load()
			if tc.want != "" {
				if err == nil {
					t.Fatalf("Load() accepted %v", tc.env)
				}
				if !strings.Contains(err.Error(), tc.want) {
					t.Fatalf("error %q does not contain %q", err, tc.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error = %v, want success", err)
			}
			if len(tc.env) == 0 {
				if c.DocumentEditLockTTL != 2*time.Minute || c.DocumentEditLockHeartbeat != 30*time.Second ||
					c.DocumentEditLockSweepInterval != 30*time.Second || c.DocumentEditHoldMax != 8*time.Hour ||
					c.DocumentEditHoldChainMax != 24*time.Hour || c.DocumentEditRequestTTL != 15*time.Minute ||
					c.DocumentEditRequestMaxPerHour != 5 {
					t.Fatalf("defaults wrong: %+v", c)
				}
				return
			}
			if c.DocumentEditLockTTL != 4*time.Minute || c.DocumentEditLockHeartbeat != time.Minute || c.DocumentEditRequestMaxPerHour != 9 {
				t.Fatalf("overrides not applied: ttl=%v hb=%v max=%d", c.DocumentEditLockTTL, c.DocumentEditLockHeartbeat, c.DocumentEditRequestMaxPerHour)
			}
		})
	}
}

func TestLoadDocumentCommitIntentSweepTick(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"unset keeps the 10m default", "", 10 * time.Minute},
		{"valid duration override", "250ms", 250 * time.Millisecond},
		{"invalid falls back to default", "nonsense", 10 * time.Minute},
		{"zero falls back to default", "0s", 10 * time.Minute},
		{"negative falls back to default", "-5s", 10 * time.Minute},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("DOCUMENT_COMMIT_INTENT_SWEEP_TICK", tc.raw)
			c, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if c.DocumentCommitIntentSweepTick != tc.want {
				t.Fatalf("DocumentCommitIntentSweepTick = %v, want %v", c.DocumentCommitIntentSweepTick, tc.want)
			}
		})
	}
}

func TestLoadIdempotencyKeyRetention(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"unset keeps the 168h default", "", 7 * 24 * time.Hour},
		{"valid duration override", "336h", 14 * 24 * time.Hour},
		{"invalid falls back to default", "nonsense", 7 * 24 * time.Hour},
		{"zero falls back to default", "0s", 7 * 24 * time.Hour},
		{"negative falls back to default", "-5s", 7 * 24 * time.Hour},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("IDEMPOTENCY_KEY_RETENTION", tc.raw)
			c, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if c.IdempotencyKeyRetention != tc.want {
				t.Fatalf("IdempotencyKeyRetention = %v, want %v", c.IdempotencyKeyRetention, tc.want)
			}
		})
	}
}

func TestLoadIdempotencyKeySweepTick(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"unset keeps the 10m default", "", 10 * time.Minute},
		{"valid duration override", "250ms", 250 * time.Millisecond},
		{"invalid falls back to default", "nonsense", 10 * time.Minute},
		{"zero falls back to default", "0s", 10 * time.Minute},
		{"negative falls back to default", "-5s", 10 * time.Minute},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("IDEMPOTENCY_KEY_SWEEP_TICK", tc.raw)
			c, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if c.IdempotencyKeySweepTick != tc.want {
				t.Fatalf("IdempotencyKeySweepTick = %v, want %v", c.IdempotencyKeySweepTick, tc.want)
			}
		})
	}
}

func TestLoadDocumentMaxBytes(t *testing.T) {
	t.Run("unset defaults to 200 MiB", func(t *testing.T) {
		setRequired(t)
		t.Setenv("DOCUMENT_MAX_BYTES", "")
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		if cfg.DocumentMaxBytes != 209715200 {
			t.Fatalf("DocumentMaxBytes = %d, want 209715200", cfg.DocumentMaxBytes)
		}
	})

	for _, tc := range []struct {
		name string
		val  string
		want int64
	}{
		{"min 1 MiB", "1048576", 1 << 20},
		{"default 200 MiB", "209715200", 200 << 20},
		{"max 2 GiB", "2147483648", 2 << 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("DOCUMENT_MAX_BYTES", tc.val)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() with DOCUMENT_MAX_BYTES=%s failed: %v", tc.val, err)
			}
			if cfg.DocumentMaxBytes != tc.want {
				t.Fatalf("DocumentMaxBytes = %d, want %d", cfg.DocumentMaxBytes, tc.want)
			}
		})
	}

	for _, tc := range []struct {
		name string
		val  string
	}{
		{"zero", "0"},
		{"negative", "-1"},
		{"below 1 MiB", "1048575"},
		{"above 2 GiB", "2147483649"},
		{"non-integer", "200MB"},
	} {
		t.Run("invalid "+tc.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv("DOCUMENT_MAX_BYTES", tc.val)
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), "DOCUMENT_MAX_BYTES") {
				t.Fatalf("Load() with DOCUMENT_MAX_BYTES=%q = %v, want error mentioning DOCUMENT_MAX_BYTES", tc.val, err)
			}
		})
	}
}

func TestDefaultDocumentMaxBytesMatchesFilesRegistry(t *testing.T) {
	if DefaultDocumentMaxBytes != files.DefaultDocumentMaxBytes {
		t.Fatalf("config.DefaultDocumentMaxBytes = %d, files.DefaultDocumentMaxBytes = %d", DefaultDocumentMaxBytes, files.DefaultDocumentMaxBytes)
	}
}

// Audit "Security & privacy", push-preview-plaintext: a production server
// without an Expo access token says so, but still loads. A boot error here
// stopped every CLI that calls Load (cmd/migrate in the rollout and the
// nightly perf jobs) over a push setting they never use.
func TestProductionWithoutAnExpoAccessTokenLoadsAndReportsIt(t *testing.T) {
	setRequired(t)
	t.Setenv("APP_ENV", "production")
	c, err := Load()
	if err != nil {
		t.Fatalf("production without a token must still load (migrate, perf jobs): %v", err)
	}
	if !c.UnauthenticatedMobilePush() {
		t.Fatal("production without a token must report unauthenticated mobile push")
	}
	t.Setenv("EXPO_ACCESS_TOKEN", "  ")
	if c, err = Load(); err != nil || !c.UnauthenticatedMobilePush() {
		t.Fatalf("a blank token must not count: %v", err)
	}
	t.Setenv("EXPO_ACCESS_TOKEN", "expo-test-token")
	c, err = Load()
	if err != nil || c.ExpoAccessToken != "expo-test-token" || c.UnauthenticatedMobilePush() {
		t.Fatalf("production with a token: %+v %v", c.ExpoAccessToken, err)
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("EXPO_ACCESS_TOKEN", "")
	if c, err = Load(); err != nil || c.UnauthenticatedMobilePush() {
		t.Fatalf("development without a token: %v", err)
	}
}

// The Apple settings of UniChat on the iPhone (ADR 0038, 0041) never stop the
// server: unset, Sign in with Apple and its revoke are off; the production
// ConfigMap alone (team ids, audiences, no uniwork-apple Secret) turns sign-in
// on without revoke; the Secret's multi-line PEMs pass through untouched.
func TestAppleSettingsLoadAndStayOffWhenUnset(t *testing.T) {
	setRequired(t)
	t.Setenv("APP_ENV", "production")
	c, err := Load()
	if err != nil {
		t.Fatalf("no Apple settings must still load: %v", err)
	}
	if c.AppleSignInEnabled() || c.AppleRevokeConfigured() || c.APNSKeyID != "" || c.APNSTeamID != "" || c.APNSPrivateKey != "" {
		t.Fatalf("unset Apple settings = %+v %v %v", c.AppleSignInAudiences, c.APNSKeyID, c.APNSTeamID)
	}

	t.Setenv("APPLE_SIWA_AUDIENCES", "com.uniworkos.chat, com.uniworkos.chat.staging,")
	t.Setenv("APPLE_SIWA_TEAM_ID", "XJAM488A6D")
	t.Setenv("APNS_TEAM_ID", "XJAM488A6D")
	if c, err = Load(); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.AppleSignInAudiences, "|"); got != "com.uniworkos.chat|com.uniworkos.chat.staging" {
		t.Fatalf("audiences = %q", got)
	}
	if !c.AppleSignInEnabled() || c.AppleRevokeConfigured() {
		t.Fatalf("ConfigMap without the Secret: sign-in %v, revoke %v; want on, off", c.AppleSignInEnabled(), c.AppleRevokeConfigured())
	}

	const pemText = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"
	t.Setenv("APPLE_SIWA_KEY_ID", "SIWAKEY123")
	t.Setenv("APPLE_SIWA_PRIVATE_KEY", pemText)
	t.Setenv("APNS_KEY_ID", "APNSKEY123")
	t.Setenv("APNS_PRIVATE_KEY", pemText)
	if c, err = Load(); err != nil {
		t.Fatal(err)
	}
	if !c.AppleRevokeConfigured() || c.AppleSignInPrivateKey != pemText || c.APNSPrivateKey != pemText || c.APNSKeyID != "APNSKEY123" {
		t.Fatalf("with the Secret: revoke %v, keys %q %q", c.AppleRevokeConfigured(), c.AppleSignInPrivateKey, c.APNSPrivateKey)
	}
}

func TestLoadFolderUploadLimits(t *testing.T) {
	setRequired(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.FolderUploadMaxFiles != 500 || cfg.FolderUploadMaxBytes != 2<<30 {
		t.Fatalf("defaults = %d files, %d bytes; want 500, 2 GiB", cfg.FolderUploadMaxFiles, cfg.FolderUploadMaxBytes)
	}
	t.Setenv("FOLDER_UPLOAD_MAX_FILES", "100")
	t.Setenv("FOLDER_UPLOAD_MAX_BYTES", "1048576")
	if cfg, err = Load(); err != nil || cfg.FolderUploadMaxFiles != 100 || cfg.FolderUploadMaxBytes != 1<<20 {
		t.Fatalf("configured = %d, %d, %v", cfg.FolderUploadMaxFiles, cfg.FolderUploadMaxBytes, err)
	}
	for _, bad := range []string{"0", "-1", "many"} {
		t.Setenv("FOLDER_UPLOAD_MAX_FILES", bad)
		if _, err := Load(); err == nil {
			t.Fatalf("FOLDER_UPLOAD_MAX_FILES=%q loaded", bad)
		}
	}
}
