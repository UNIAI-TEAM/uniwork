package service

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// emailHubOAuthTestConfig enables both providers with Email Hub's own clients.
// The login and calendar clients are set too, so a registry that read them
// would show in the client ids.
func emailHubOAuthTestConfig() config.Config {
	return config.Config{
		APIPublicURL:                  "https://api.example.com/",
		GoogleClientID:                "login-google-id",
		GoogleClientSecret:            "login-google-secret",
		MicrosoftCalendarClientID:     "calendar-ms-id",
		MicrosoftCalendarClientSecret: "calendar-ms-secret",
		EmailHubGoogleClientID:        "hub-google-id",
		EmailHubGoogleClientSecret:    "hub-google-secret",
		EmailHubMicrosoftClientID:     "hub-ms-id",
		EmailHubMicrosoftClientSecret: "hub-ms-secret",
		EmailHubMicrosoftTenant:       "contoso.example",
	}
}

// Each provider uses Email Hub's own client (spec Q3), its preset servers, the
// scopes of spec §5.6 and a callback under /email-hub-connections/.
func TestEmailHubConfigureOAuthUsesItsOwnClients(t *testing.T) {
	t.Parallel()
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	svc.ConfigureOAuth(emailHubOAuthTestConfig())

	g, ok := svc.oauthProvider("google")
	if !ok {
		t.Fatal("google not registered")
	}
	if g.authKind != "oauth_google" || g.preset.Name != "gmail" || g.prompt != "consent" ||
		g.revokeURL != "https://oauth2.googleapis.com/revoke" ||
		g.config.ClientID != "hub-google-id" || g.config.ClientSecret != "hub-google-secret" ||
		g.config.RedirectURL != "https://api.example.com/api/v1/email-hub-connections/google/callback" ||
		g.config.Endpoint.AuthURL != "https://accounts.google.com/o/oauth2/v2/auth" ||
		g.config.Endpoint.TokenURL != "https://oauth2.googleapis.com/token" ||
		!slices.Equal(g.config.Scopes, []string{"openid", "email", "https://mail.google.com/"}) {
		t.Fatalf("google: %+v", g)
	}
	m, ok := svc.oauthProvider("microsoft")
	if !ok {
		t.Fatal("microsoft not registered")
	}
	if m.authKind != "oauth_microsoft" || m.preset.Name != "outlook" || m.prompt != "select_account" || m.revokeURL != "" ||
		m.config.ClientID != "hub-ms-id" || m.config.ClientSecret != "hub-ms-secret" ||
		m.config.RedirectURL != "https://api.example.com/api/v1/email-hub-connections/microsoft/callback" ||
		m.config.Endpoint.AuthURL != "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/authorize" ||
		m.config.Endpoint.TokenURL != "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/token" ||
		!slices.Equal(m.config.Scopes, []string{"openid", "email", "offline_access",
			"https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"}) {
		t.Fatalf("microsoft: %+v", m)
	}
	if p, ok := svc.oauthByKind("oauth_microsoft"); !ok || p != m {
		t.Fatalf("oauthByKind(oauth_microsoft) = %+v ok=%v", p, ok)
	}
	if _, ok := svc.oauthByKind("password"); ok {
		t.Fatal("a password account has no OAuth provider")
	}
	if _, ok := svc.oauthProvider("yahoo"); ok {
		t.Fatal("only google and microsoft are OAuth providers")
	}
	hc, _ := svc.oauthCtx(context.Background()).Value(oauth2.HTTPClient).(*http.Client)
	if hc == nil || hc != svc.oauthHTTP || hc.Timeout != 15*time.Second {
		t.Fatalf("oauthCtx must carry the bounded client, got %+v", hc)
	}
}

// Membership answers before anything about the deployment's OAuth clients
// (spec §5.1: without the gate a stranger would read the flags).
func TestEmailHubProvidersRequiresMember(t *testing.T) {
	svc, _, _, ws, _ := emailHubFixture(t)
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	if _, err := svc.Providers(context.Background(), Human(util.NewID()), ws.ID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member must get the membership answer, got %v", err)
	}
}

// A provider is offered only with its own id and secret and the credential
// box that seals its state and tokens (spec §5.6, Q9).
func TestEmailHubProvidersFlags(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	full := emailHubOAuthTestConfig()
	googleNoSecret := full
	googleNoSecret.EmailHubGoogleClientSecret = ""
	microsoftNoID := full
	microsoftNoID.EmailHubMicrosoftClientID = ""
	sharedOnly := full
	sharedOnly.EmailHubGoogleClientID, sharedOnly.EmailHubGoogleClientSecret = "", ""
	sharedOnly.EmailHubMicrosoftClientID, sharedOnly.EmailHubMicrosoftClientSecret = "", ""

	cases := []struct {
		name      string
		configure bool
		box       bool
		cfg       config.Config
		want      EmailHubProviders
	}{
		{"ConfigureOAuth never called", false, true, full, EmailHubProviders{}},
		{"no credential box", true, false, full, EmailHubProviders{}},
		{"google id without secret", true, true, googleNoSecret, EmailHubProviders{Microsoft: true}},
		{"microsoft secret without id", true, true, microsoftNoID, EmailHubProviders{Google: true}},
		{"login and calendar clients only", true, true, sharedOnly, EmailHubProviders{}},
		{"both", true, true, full, EmailHubProviders{Google: true, Microsoft: true}},
	}
	for _, tc := range cases {
		box := svc.box
		if !tc.box {
			box = nil
		}
		s := NewEmailHubService(q, svc.ws, box)
		if tc.configure {
			s.ConfigureOAuth(tc.cfg)
		}
		got, err := s.Providers(context.Background(), Human(user.ID), ws.ID)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %+v err=%v, want %+v", tc.name, got, err, tc.want)
		}
	}
}
