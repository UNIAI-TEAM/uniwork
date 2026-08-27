package config

import "testing"

func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "s")
	t.Setenv("PORT", "")
	t.Setenv("TRUSTED_PROXIES", "")
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
