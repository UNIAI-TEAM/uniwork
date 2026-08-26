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
}

func Load() (Config, error) {
	c := Config{
		Port:             getenv("PORT", "8080"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		RedisURL:         os.Getenv("REDIS_URL"),
		JWTSecret:        os.Getenv("JWT_SECRET"),
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  30 * 24 * time.Hour,
		FrontendOrigin:   getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
		TrustedProxies:   os.Getenv("TRUSTED_PROXIES"),
		LiveKitURL:       os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:    os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret: os.Getenv("LIVEKIT_API_SECRET"),
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
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
