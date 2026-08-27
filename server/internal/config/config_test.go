package config

import "testing"

func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "s")
	t.Setenv("PORT", "")
	t.Setenv("TRUSTED_PROXIES", "")
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
