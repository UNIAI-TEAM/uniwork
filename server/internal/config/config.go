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
	FrontendOrigin  string
	// SecureCookies is derived from FrontendOrigin's scheme: an https origin
	// gets the Secure flag on the refresh cookie, a plain-http dev origin does
	// not (browsers silently drop Secure cookies set over http, which would
	// make every login on localhost look successful and then never refresh).
	SecureCookies bool
	// TrustedProxies is a comma-separated CIDR list; X-Forwarded-For is only
	// honoured for the rate limiter when the peer is inside one of them.
	TrustedProxies   string
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	// MatrixHomeserverURL is the Synapse client API base (e.g. http://127.0.0.1:8008).
	// When set, UniWork registration also creates a Matrix account with the same
	// password and a username derived from the UniWork user id.
	MatrixHomeserverURL string
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
	// APIPublicURL is the origin browsers reach this API on. It builds the
	// Google redirect URI, which Google matches byte for byte.
	APIPublicURL       string
	GoogleClientID     string
	GoogleClientSecret string
	SMTPHost           string
	SMTPPort           string
	SMTPUsername       string
	SMTPPassword       string
	SMTPTLS            string
	SMTPTLSInsecure    bool
	SMTPEHLOName       string
	MailFrom           string
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

func Load() (Config, error) {
	c := Config{
		Port:                getenv("PORT", "8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisURL:            os.Getenv("REDIS_URL"),
		JWTSecret:           os.Getenv("JWT_SECRET"),
		AccessTokenTTL:      15 * time.Minute,
		RefreshTokenTTL:     30 * 24 * time.Hour,
		FrontendOrigin:      getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
		TrustedProxies:      os.Getenv("TRUSTED_PROXIES"),
		LiveKitURL:          os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:       os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret:    os.Getenv("LIVEKIT_API_SECRET"),
		MatrixHomeserverURL: strings.TrimRight(os.Getenv("MATRIX_HOMESERVER_URL"), "/"),
		AppEnv:              getenv("APP_ENV", "development"),
		devVerificationCode: os.Getenv("DEV_VERIFICATION_CODE"),
		APIPublicURL:        getenv("API_PUBLIC_URL", "http://localhost:8080"),
		GoogleClientID:      os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:  os.Getenv("GOOGLE_CLIENT_SECRET"),
		SMTPHost:            os.Getenv("SMTP_HOST"),
		SMTPPort:            getenv("SMTP_PORT", "25"),
		SMTPUsername:        os.Getenv("SMTP_USERNAME"),
		SMTPPassword:        os.Getenv("SMTP_PASSWORD"),
		SMTPTLS:             os.Getenv("SMTP_TLS"),
		SMTPTLSInsecure:     strings.EqualFold(os.Getenv("SMTP_TLS_INSECURE"), "true"),
		SMTPEHLOName:        os.Getenv("SMTP_EHLO_NAME"),
		MailFrom:            getenv("MAIL_FROM", "UniWork <noreply@unicomhub.com>"),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return c, fmt.Errorf("JWT_SECRET is required")
	}
	u, err := url.Parse(c.FrontendOrigin)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return c, fmt.Errorf("FRONTEND_ORIGIN must be an absolute origin like https://app.example.com, got %q", c.FrontendOrigin)
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

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
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
