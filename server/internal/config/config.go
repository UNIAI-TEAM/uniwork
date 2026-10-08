package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	Port            string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	// Desktop auth is a public PKCE client. Redirects and deployments are
	// explicit allowlists; an empty allowlist is rejected by Load.
	DesktopAuthClientID      string
	DesktopAuthRedirectURIs  []string
	DesktopAuthDeploymentIDs []string
	DesktopAuthCodeTTL       time.Duration
	DesktopAuthAttemptTTL    time.Duration
	FrontendOrigin           string
	// PreviewOrigin is the separate, cookie-less origin used by isolated
	// Markdown/HTML frames. It must never be the frontend origin.
	PreviewOrigin string
	// PreviewCapabilitySecret signs short-lived, document-bound asset scopes.
	// It is deliberately separate from JWT_SECRET so a preview deployment can
	// rotate its broker credentials without logging every user out.
	PreviewCapabilitySecret string
	PreviewAssetTTL         time.Duration
	PreviewAssetMaxBytes    int64
	// SecureCookies is derived from FrontendOrigin's scheme: an https origin
	// gets the Secure flag on the refresh cookie, a plain-http dev origin does
	// not (browsers silently drop Secure cookies set over http, which would
	// make every login on localhost look successful and then never refresh).
	SecureCookies bool
	// TrustedProxies is a comma-separated CIDR list; X-Forwarded-For is only
	// honoured for the rate limiter when the peer is inside one of them.
	TrustedProxies            string
	LiveKitURL                string
	LiveKitAPIKey             string
	LiveKitAPISecret          string
	LiveKitTokenTTL           time.Duration
	LiveKitEmptyTimeout       time.Duration
	LiveKitDepartureTimeout   time.Duration
	MeetingProvider           string
	BillingProvider           string
	MeetingWorkerTick         time.Duration
	MeetingOutboxBatch        int32
	MeetingWebhookBatch       int32
	MeetingWebhookConcurrency int
	// AnthropicAPIKey enables AI meeting summaries; empty turns the feature off.
	AnthropicAPIKey string
	AnthropicModel  string
	// LiveKitRecordingBucket enables room recording via LiveKit Egress; the
	// AWS_* storage settings supply credentials and endpoint.
	LiveKitRecordingBucket string
	// MeetingSTTAgentSecret authenticates POST .../transcript/agent from a
	// LiveKit Agents worker; empty turns server-side STT ingestion off.
	MeetingSTTAgentSecret string
	// EnableSwagger serves /swagger/* (UI + OpenAPI JSON). Off unless
	// ENABLE_SWAGGER is 1/true/yes — the spec describes the whole API
	// surface and must not ship on a public listener by default.
	EnableSwagger bool
	// AppEnv is "production" in production; the only thing it gates today is
	// the development verification code.
	AppEnv string
	// devVerificationCode is the raw DEV_VERIFICATION_CODE; read it through
	// DevVerificationCode(), which applies the production and format guards.
	devVerificationCode string
	// APIPublicURL is the origin browsers reach this API on. It builds OAuth
	// redirect URIs, which providers match byte for byte.
	APIPublicURL                  string
	GoogleClientID                string
	GoogleClientSecret            string
	MicrosoftCalendarClientID     string
	MicrosoftCalendarClientSecret string
	SMTPHost                      string
	SMTPPort                      string
	SMTPUsername                  string
	SMTPPassword                  string
	SMTPTLS                       string
	SMTPTLSInsecure               bool
	SMTPEHLOName                  string
	MailFrom                      string
	// TenorAPIKey enables Tenor GIF search in chat; empty uses a small built-in catalog.
	TenorAPIKey string
	// VAPID keys enable Web Push (F-07). Both empty turns push off: the push
	// consumer acknowledges rows without sending and the client hides the
	// option. VAPID_SUBJECT is a mailto: or https origin the push service can
	// contact about abuse; it defaults to the frontend origin.
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	// RUMSampleRate is the share of web sessions that report web-vitals to
	// POST /api/v1/rum (F-11 §2.8); 0 turns reporting off client-side.
	RUMSampleRate             float64
	OfficeInstallerDevURL     string
	OfficeInstallerBetaURL    string
	OfficeInstallerStableURL  string
	OfficeInstallerDevURLs    string
	OfficeInstallerBetaURLs   string
	OfficeInstallerStableURLs string
	// OfficeDesktopChannelSetting is OFFICE_DESKTOP_CHANNEL as written; read
	// the effective channel through OfficeDesktopChannel().
	OfficeDesktopChannelSetting string
	// AdminRateLimitPerMin bounds /api/v1/admin/* per IP (spec §5.2).
	AdminRateLimitPerMin int
}

// PushEnabled: both VAPID keys present.
func (c Config) PushEnabled() bool {
	return c.VAPIDPublicKey != "" && c.VAPIDPrivateKey != ""
}

// DevVerificationCode is the code accepted in place of a mailed one. Empty
// unless APP_ENV is not production and the value is exactly six digits.
func (c Config) DevVerificationCode() string {
	if strings.EqualFold(c.AppEnv, "production") {
		return ""
	}
	code := strings.TrimSpace(c.devVerificationCode)
	if len(code) != 6 {
		return ""
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return code
}

// GoogleEnabled: both credentials present. Without them the Google routes
// answer 503 and the login page hides the button.
func (c Config) GoogleEnabled() bool {
	return c.GoogleClientID != "" && c.GoogleClientSecret != ""
}

func (c Config) GoogleRedirectURL() string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/auth/google/callback"
}

func (c Config) CalendarRedirectURL(provider string) string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/calendar-connections/" + provider + "/callback"
}

func Load() (Config, error) {
	c := Config{
		Port:                          getenv("PORT", "8080"),
		DatabaseURL:                   os.Getenv("DATABASE_URL"),
		RedisURL:                      os.Getenv("REDIS_URL"),
		JWTSecret:                     os.Getenv("JWT_SECRET"),
		AccessTokenTTL:                15 * time.Minute,
		RefreshTokenTTL:               30 * 24 * time.Hour,
		DesktopAuthClientID:           getenv("DESKTOP_AUTH_CLIENT_ID", "uniwork-office"),
		DesktopAuthRedirectURIs:       splitList(getenv("DESKTOP_AUTH_REDIRECT_URIS", "uniwork-office://auth/callback")),
		DesktopAuthDeploymentIDs:      splitList(getenv("DESKTOP_AUTH_DEPLOYMENT_IDS", "default")),
		DesktopAuthCodeTTL:            parseDuration(os.Getenv("DESKTOP_AUTH_CODE_TTL"), 120*time.Second),
		DesktopAuthAttemptTTL:         parseDuration(os.Getenv("DESKTOP_AUTH_ATTEMPT_TTL"), 10*time.Minute),
		FrontendOrigin:                getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
		PreviewOrigin:                 os.Getenv("PREVIEW_ORIGIN"),
		PreviewCapabilitySecret:       os.Getenv("PREVIEW_CAPABILITY_SECRET"),
		PreviewAssetTTL:               parseRequiredDuration(os.Getenv("PREVIEW_ASSET_TTL")),
		PreviewAssetMaxBytes:          parseRequiredInt64(os.Getenv("PREVIEW_ASSET_MAX_BYTES")),
		TrustedProxies:                os.Getenv("TRUSTED_PROXIES"),
		LiveKitURL:                    os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:                 os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:              os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitTokenTTL:               parseDuration(os.Getenv("LIVEKIT_TOKEN_TTL"), 30*time.Minute),
		LiveKitEmptyTimeout:           parseDuration(os.Getenv("LIVEKIT_ROOM_EMPTY_TIMEOUT"), 0),
		LiveKitDepartureTimeout:       parseDuration(os.Getenv("LIVEKIT_ROOM_DEPARTURE_TIMEOUT"), 20*time.Second),
		MeetingProvider:               getenv("MEETING_PROVIDER", "livekit"),
		BillingProvider:               getenv("BILLING_PROVIDER", "manual"),
		MeetingWorkerTick:             parseDuration(os.Getenv("MEETING_WORKER_TICK"), time.Second),
		MeetingOutboxBatch:            parseInt32(os.Getenv("MEETING_OUTBOX_BATCH"), 50),
		MeetingWebhookBatch:           parseInt32(os.Getenv("MEETING_WEBHOOK_BATCH"), 50),
		MeetingWebhookConcurrency:     int(parseInt32(os.Getenv("MEETING_WEBHOOK_CONCURRENCY"), 8)),
		AnthropicAPIKey:               os.Getenv("ANTHROPIC_API_KEY"),
		AnthropicModel:                os.Getenv("ANTHROPIC_MODEL"),
		LiveKitRecordingBucket:        os.Getenv("LIVEKIT_RECORDING_BUCKET"),
		MeetingSTTAgentSecret:         os.Getenv("MEETING_STT_AGENT_SECRET"),
		AppEnv:                        getenv("APP_ENV", "development"),
		devVerificationCode:           os.Getenv("DEV_VERIFICATION_CODE"),
		APIPublicURL:                  getenv("API_PUBLIC_URL", "http://localhost:8080"),
		GoogleClientID:                os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:            os.Getenv("GOOGLE_CLIENT_SECRET"),
		MicrosoftCalendarClientID:     os.Getenv("MICROSOFT_CALENDAR_CLIENT_ID"),
		MicrosoftCalendarClientSecret: os.Getenv("MICROSOFT_CALENDAR_CLIENT_SECRET"),
		SMTPHost:                      os.Getenv("SMTP_HOST"),
		SMTPPort:                      getenv("SMTP_PORT", "25"),
		SMTPUsername:                  os.Getenv("SMTP_USERNAME"),
		SMTPPassword:                  os.Getenv("SMTP_PASSWORD"),
		SMTPTLS:                       os.Getenv("SMTP_TLS"),
		SMTPTLSInsecure:               strings.EqualFold(os.Getenv("SMTP_TLS_INSECURE"), "true"),
		SMTPEHLOName:                  os.Getenv("SMTP_EHLO_NAME"),
		MailFrom:                      getenv("MAIL_FROM", "UniWork <noreply@unicomhub.com>"),
		TenorAPIKey:                   os.Getenv("TENOR_API_KEY"),
		VAPIDPublicKey:                os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:               os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:                  os.Getenv("VAPID_SUBJECT"),
		RUMSampleRate:                 parseRatio(os.Getenv("RUM_SAMPLE_RATE"), 0.2),
		OfficeInstallerDevURL:         os.Getenv("OFFICE_INSTALLER_DEV_URL"),
		OfficeInstallerBetaURL:        os.Getenv("OFFICE_INSTALLER_BETA_URL"),
		OfficeInstallerStableURL:      os.Getenv("OFFICE_INSTALLER_STABLE_URL"),
		OfficeInstallerDevURLs:        os.Getenv("OFFICE_INSTALLER_DEV_URLS"),
		OfficeInstallerBetaURLs:       os.Getenv("OFFICE_INSTALLER_BETA_URLS"),
		OfficeInstallerStableURLs:     os.Getenv("OFFICE_INSTALLER_STABLE_URLS"),
		OfficeDesktopChannelSetting:   strings.TrimSpace(os.Getenv("OFFICE_DESKTOP_CHANNEL")),
		AdminRateLimitPerMin:          int(parseInt32(os.Getenv("ADMIN_RATE_LIMIT_PER_MIN"), 60)),
	}
	if c.VAPIDSubject == "" {
		c.VAPIDSubject = c.FrontendOrigin
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return c, fmt.Errorf("JWT_SECRET is required")
	}
	if strings.TrimSpace(c.DesktopAuthClientID) == "" || len(c.DesktopAuthRedirectURIs) == 0 || len(c.DesktopAuthDeploymentIDs) == 0 {
		return c, fmt.Errorf("desktop auth client, redirect and deployment allowlists are required")
	}
	if err := c.validateOfficeDesktopChannel(); err != nil {
		return c, err
	}
	if c.DesktopAuthCodeTTL <= 0 || c.DesktopAuthCodeTTL > 10*time.Minute {
		return c, fmt.Errorf("DESKTOP_AUTH_CODE_TTL must be between 1s and 10m")
	}
	if c.DesktopAuthAttemptTTL <= 0 || c.DesktopAuthAttemptTTL > time.Hour {
		return c, fmt.Errorf("DESKTOP_AUTH_ATTEMPT_TTL must be between 1s and 1h")
	}
	u, err := url.Parse(c.FrontendOrigin)
	if err != nil || !isHTTPOrigin(u) {
		return c, fmt.Errorf("FRONTEND_ORIGIN must be an absolute origin like https://app.example.com, got %q", c.FrontendOrigin)
	}
	p, err := url.Parse(c.PreviewOrigin)
	if err != nil || !isHTTPOrigin(p) {
		return c, fmt.Errorf("PREVIEW_ORIGIN must be an absolute http(s) origin, got %q", c.PreviewOrigin)
	}
	if strings.EqualFold(p.Scheme, u.Scheme) && strings.EqualFold(p.Host, u.Host) {
		return c, fmt.Errorf("PREVIEW_ORIGIN must be different from FRONTEND_ORIGIN")
	}
	if len(strings.TrimSpace(c.PreviewCapabilitySecret)) < 32 {
		return c, fmt.Errorf("PREVIEW_CAPABILITY_SECRET must be at least 32 characters")
	}
	if c.PreviewAssetTTL <= 0 || c.PreviewAssetTTL > time.Hour {
		return c, fmt.Errorf("PREVIEW_ASSET_TTL must be between 1s and 1h")
	}
	if c.PreviewAssetMaxBytes <= 0 {
		return c, fmt.Errorf("PREVIEW_ASSET_MAX_BYTES must be positive")
	}
	c.SecureCookies = strings.EqualFold(u.Scheme, "https")
	if a, err := url.Parse(c.APIPublicURL); err != nil || a.Scheme == "" || a.Host == "" {
		return c, fmt.Errorf("API_PUBLIC_URL must be an absolute origin like https://api.example.com, got %q", c.APIPublicURL)
	}
	// Swagger is opt-in in production (ENABLE_SWAGGER=1). Locally it is on
	// unless the operator sets ENABLE_SWAGGER=0: GNU Make 3.81 (macOS stock)
	// also drops a last .env line that has no trailing newline, so a
	// localhost default is the only reliable local path.
	c.EnableSwagger = swaggerEnabled(c.FrontendOrigin)
	return c, nil
}

func isHTTPOrigin(u *url.URL) bool {
	return u != nil && (strings.EqualFold(u.Scheme, "http") || strings.EqualFold(u.Scheme, "https")) && u.Host != "" && (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == "" && u.User == nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func parseRequiredDuration(raw string) time.Duration {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

func parseRequiredInt64(raw string) int64 {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	var n int64
	if _, err := fmt.Sscan(strings.TrimSpace(raw), &n); err != nil || n <= 0 {
		return 0
	}
	return n
}

func parseRatio(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	var f float64
	if _, err := fmt.Sscanf(raw, "%g", &f); err != nil || f < 0 || f > 1 {
		return fallback
	}
	return f
}

func parseInt32(raw string, fallback int32) int32 {
	if raw == "" {
		return fallback
	}
	var n int
	_, err := fmt.Sscanf(raw, "%d", &n)
	if err != nil || n <= 0 {
		return fallback
	}
	return int32(n)
}

func splitList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func swaggerEnabled(frontendOrigin string) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_SWAGGER")))
	switch raw {
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	case "":
		return isLocalDevOrigin(frontendOrigin)
	default:
		return false
	}
}

func isLocalDevOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
