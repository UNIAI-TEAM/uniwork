package service

import (
	"context"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

// emailHubOAuthProvider is one sign-in provider Email Hub's own OAuth client
// is registered with (spec Q3). The mailbox behind it is a preset server.
type emailHubOAuthProvider struct {
	name      string // the {provider} path segment: google | microsoft
	authKind  string // email_hub_accounts.auth_kind it stores
	preset    emailhub.Provider
	config    oauth2.Config
	revokeURL string // empty: the provider has no refresh-token revoke for apps
	prompt    string
}

// ConfigureOAuth registers each provider whose client id and secret are both
// set. Without the credential box nothing is offered: it seals the state and
// the tokens (spec §5.6). main calls it once, before serving.
func (s *EmailHubService) ConfigureOAuth(cfg config.Config) {
	if s.box == nil {
		return
	}
	gmail, _ := emailhub.Preset("gmail")
	outlook, _ := emailhub.Preset("outlook")
	microsoft := "https://login.microsoftonline.com/" + cfg.EmailHubMicrosoftTenant + "/oauth2/v2.0/"
	all := []*emailHubOAuthProvider{
		{
			name: "google", authKind: "oauth_google", preset: gmail, prompt: "consent",
			revokeURL: "https://oauth2.googleapis.com/revoke",
			config: oauth2.Config{
				ClientID: cfg.EmailHubGoogleClientID, ClientSecret: cfg.EmailHubGoogleClientSecret,
				Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"},
				Scopes:   []string{"openid", "email", "https://mail.google.com/"},
			},
		},
		{
			name: "microsoft", authKind: "oauth_microsoft", preset: outlook, prompt: "select_account",
			config: oauth2.Config{
				ClientID: cfg.EmailHubMicrosoftClientID, ClientSecret: cfg.EmailHubMicrosoftClientSecret,
				Endpoint: oauth2.Endpoint{AuthURL: microsoft + "authorize", TokenURL: microsoft + "token"},
				Scopes: []string{"openid", "email", "offline_access",
					"https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"},
			},
		},
	}
	s.oauth = map[string]*emailHubOAuthProvider{}
	for _, p := range all {
		if p.config.ClientID == "" || p.config.ClientSecret == "" {
			continue
		}
		p.config.RedirectURL = cfg.EmailHubRedirectURL(p.name)
		s.oauth[p.name] = p
	}
}

func (s *EmailHubService) oauthProvider(name string) (*emailHubOAuthProvider, bool) {
	p, ok := s.oauth[name]
	return p, ok
}

func (s *EmailHubService) oauthByKind(authKind string) (*emailHubOAuthProvider, bool) {
	for _, p := range s.oauth {
		if p.authKind == authKind {
			return p, true
		}
	}
	return nil, false
}

// oauthCtx carries the bounded client oauth2 uses for every token call.
func (s *EmailHubService) oauthCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, s.oauthHTTP)
}

// EmailHubProviders says which sign-in buttons the connect dialog shows.
type EmailHubProviders struct{ Google, Microsoft bool }

// Providers answers membership first, so a stranger learns nothing about the
// deployment's OAuth clients (spec §5.1).
func (s *EmailHubService) Providers(ctx context.Context, actor Actor, workspaceID string) (EmailHubProviders, error) {
	if _, err := s.workspace(ctx, actor, workspaceID); err != nil {
		return EmailHubProviders{}, err
	}
	_, google := s.oauthProvider("google")
	_, microsoft := s.oauthProvider("microsoft")
	return EmailHubProviders{Google: google, Microsoft: microsoft}, nil
}
