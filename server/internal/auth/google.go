package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// GoogleIssuer is the OpenID issuer Google's discovery document lives under.
const GoogleIssuer = "https://accounts.google.com"

// GoogleClaims is what a verified Google ID token says about the person.
type GoogleClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// GoogleOAuth runs the authorization-code flow against Google and verifies
// the returned ID token (signature, issuer, audience, expiry). The handler
// only ever sees claims that passed that check.
type GoogleOAuth struct {
	cfg      oauth2.Config
	verifier *oidc.IDTokenVerifier
}

// NewGoogleOAuth performs discovery once. issuer is GoogleIssuer in
// production and a fake provider in tests.
func NewGoogleOAuth(ctx context.Context, issuer, clientID, clientSecret, redirectURL string) (*GoogleOAuth, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("google discovery: %w", err)
	}
	return &GoogleOAuth{
		cfg: oauth2.Config{
			ClientID: clientID, ClientSecret: clientSecret, RedirectURL: redirectURL,
			Endpoint: provider.Endpoint(),
			Scopes:   []string{oidc.ScopeOpenID, "email", "profile"},
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: clientID}),
	}, nil
}

func (g *GoogleOAuth) AuthCodeURL(state string) string {
	return g.cfg.AuthCodeURL(state, oauth2.SetAuthURLParam("prompt", "select_account"))
}

// Exchange trades the code for tokens and returns the verified ID token's
// claims. The whole round trip is bounded so a slow Google cannot pin a
// handler goroutine.
func (g *GoogleOAuth) Exchange(ctx context.Context, code string) (GoogleClaims, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tok, err := g.cfg.Exchange(ctx, code)
	if err != nil {
		return GoogleClaims{}, fmt.Errorf("google token exchange: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return GoogleClaims{}, fmt.Errorf("google token exchange: no id_token")
	}
	idToken, err := g.verifier.Verify(ctx, raw)
	if err != nil {
		return GoogleClaims{}, fmt.Errorf("google id_token: %w", err)
	}
	var c GoogleClaims
	if err := idToken.Claims(&c); err != nil {
		return GoogleClaims{}, fmt.Errorf("google id_token claims: %w", err)
	}
	return c, nil
}
