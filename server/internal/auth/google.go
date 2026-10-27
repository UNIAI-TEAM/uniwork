package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
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
	// HD is the Google Workspace domain of the account, empty for a consumer
	// account: with it equal to the address's domain, Google owns the address
	// (ADR 0047).
	HD string `json:"hd"`
	// IssuedAt is the token's iat: a step-up takes only a token the app just
	// got from Google's SDK (ADR 0047 §5). The app's verifier fills it.
	IssuedAt time.Time `json:"-"`
}

// ErrGoogleNonce: the ID token does not carry the nonce this sign-in sent.
var ErrGoogleNonce = errors.New("google id_token: nonce mismatch")

// ErrGoogleToken is what every ID token the app's verifier rejects matches
// with errors.Is; GoogleTokenError carries the reason, which is safe to log
// (never the token).
var ErrGoogleToken = errors.New("google id token rejected")

// GoogleTokenError says why the app's ID token was refused: signature (bad
// signature, issuer or shape), expired, audience, azp, stale, nonce or
// claims.
type GoogleTokenError struct{ Reason string }

func (e GoogleTokenError) Error() string        { return "google id token: " + e.Reason }
func (e GoogleTokenError) Is(target error) bool { return target == ErrGoogleToken }

// GoogleDiscovery is Google's OpenID configuration, fetched once at start:
// the web's code flow and the app's ID token verifier share its endpoints
// and its key set.
type GoogleDiscovery struct {
	provider *oidc.Provider
}

// DiscoverGoogle performs discovery. issuer is GoogleIssuer in production and
// a fake provider in tests.
func DiscoverGoogle(ctx context.Context, issuer string) (*GoogleDiscovery, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("google discovery: %w", err)
	}
	return &GoogleDiscovery{provider: provider}, nil
}

// GoogleOAuth runs the authorization-code flow against Google and verifies
// the returned ID token (signature, issuer, audience, expiry). The handler
// only ever sees claims that passed that check.
type GoogleOAuth struct {
	cfg      oauth2.Config
	verifier *oidc.IDTokenVerifier
}

// NewGoogleOAuth performs discovery and builds the web's code flow on it.
func NewGoogleOAuth(ctx context.Context, issuer, clientID, clientSecret, redirectURL string) (*GoogleOAuth, error) {
	d, err := DiscoverGoogle(ctx, issuer)
	if err != nil {
		return nil, err
	}
	return d.OAuth(clientID, clientSecret, redirectURL), nil
}

// OAuth is the web's code flow for the web client (GOOGLE_CLIENT_ID).
func (d *GoogleDiscovery) OAuth(clientID, clientSecret, redirectURL string) *GoogleOAuth {
	return &GoogleOAuth{
		cfg: oauth2.Config{
			ClientID: clientID, ClientSecret: clientSecret, RedirectURL: redirectURL,
			Endpoint: d.provider.Endpoint(),
			Scopes:   []string{oidc.ScopeOpenID, "email", "profile"},
		},
		verifier: d.provider.Verifier(&oidc.Config{ClientID: clientID}),
	}
}

// AuthCodeURL is Google's authorization request for one sign-in: the CSRF
// state, the nonce the ID token must echo, the S256 challenge of the PKCE
// verifier (ADR 0047), and the account chooser every time so a shared
// browser never signs into whichever Google account it last used.
func (g *GoogleOAuth) AuthCodeURL(state, nonce, verifier string) string {
	return g.cfg.AuthCodeURL(state,
		oauth2.SetAuthURLParam("prompt", "select_account"),
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.S256ChallengeOption(verifier),
	)
}

// Exchange trades the code and the PKCE verifier for tokens and returns the
// verified ID token's claims, refusing a token whose nonce is not the one
// this sign-in sent, or that names another client as its authorized party
// (an app's token never stands in for the web's). The whole round trip is
// bounded so a slow Google cannot pin a handler goroutine.
func (g *GoogleOAuth) Exchange(ctx context.Context, code, verifier, nonce string) (GoogleClaims, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tok, err := g.cfg.Exchange(ctx, code, oauth2.VerifierOption(verifier))
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
	if nonce == "" || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		return GoogleClaims{}, ErrGoogleNonce
	}
	var c struct {
		GoogleClaims
		AZP string `json:"azp"`
	}
	if err := idToken.Claims(&c); err != nil {
		return GoogleClaims{}, fmt.Errorf("google id_token claims: %w", err)
	}
	if c.AZP != "" && c.AZP != g.cfg.ClientID {
		return GoogleClaims{}, fmt.Errorf("google id_token: issued to another client")
	}
	c.GoogleClaims.IssuedAt = idToken.IssuedAt
	return c.GoogleClaims, nil
}

// googleNativeMaxAge: the app hands over the ID token its SDK just returned;
// Google's own expiry is an hour.
const googleNativeMaxAge = 10 * time.Minute

// googleClockSkew is how far in the future an iat may be and still pass.
const googleClockSkew = time.Minute

// GoogleNativeVerifier checks an ID token the app's Google SDK returned (ADR
// 0047 §8): Google's signature against the discovered key set, iss and exp;
// an aud among the web client and the app clients (the Android SDK asks for
// the web client as audience, iOS for its own); an azp that is one of the app
// clients, so a token the web was issued never opens the app's door; an iat
// no older than ten minutes; and a nonce equal to SHA-256 (hex) of the raw
// nonce the app handed the SDK — required, as for Apple.
type GoogleNativeVerifier struct {
	verifier  *oidc.IDTokenVerifier
	audiences []string
	apps      []string
	now       func() time.Time
}

// NativeVerifier is the app's verifier: webClientID may be empty when the
// server has no web Google sign-in; appClientIDs are the iOS and Android
// clients (GOOGLE_NATIVE_CLIENT_IDS). now is nil outside tests.
func (d *GoogleDiscovery) NativeVerifier(webClientID string, appClientIDs []string, now func() time.Time) *GoogleNativeVerifier {
	if now == nil {
		now = time.Now
	}
	audiences := append([]string(nil), appClientIDs...)
	if webClientID != "" {
		audiences = append(audiences, webClientID)
	}
	return &GoogleNativeVerifier{
		// Several clients share the server: aud is checked against the list
		// below instead.
		verifier:  d.provider.Verifier(&oidc.Config{SkipClientIDCheck: true, Now: now}),
		audiences: audiences,
		apps:      append([]string(nil), appClientIDs...),
		now:       now,
	}
}

// Verify returns the token's claims, IssuedAt filled, or a GoogleTokenError.
func (v *GoogleNativeVerifier) Verify(ctx context.Context, rawToken, rawNonce string) (GoogleClaims, error) {
	tok, err := v.verifier.Verify(ctx, rawToken)
	if err != nil {
		var expired *oidc.TokenExpiredError
		if errors.As(err, &expired) {
			return GoogleClaims{}, GoogleTokenError{Reason: "expired"}
		}
		return GoogleClaims{}, GoogleTokenError{Reason: "signature"}
	}
	if !slices.ContainsFunc(tok.Audience, func(a string) bool { return slices.Contains(v.audiences, a) }) {
		return GoogleClaims{}, GoogleTokenError{Reason: "audience"}
	}
	var c struct {
		GoogleClaims
		AZP string `json:"azp"`
	}
	if err := tok.Claims(&c); err != nil || tok.Subject == "" {
		return GoogleClaims{}, GoogleTokenError{Reason: "claims"}
	}
	if c.AZP == "" || !slices.Contains(v.apps, c.AZP) {
		return GoogleClaims{}, GoogleTokenError{Reason: "azp"}
	}
	now := v.now()
	if tok.IssuedAt.IsZero() || now.Sub(tok.IssuedAt) > googleNativeMaxAge || tok.IssuedAt.After(now.Add(googleClockSkew)) {
		return GoogleClaims{}, GoogleTokenError{Reason: "stale"}
	}
	sum := sha256.Sum256([]byte(rawNonce))
	if rawNonce == "" || subtle.ConstantTimeCompare([]byte(tok.Nonce), []byte(hex.EncodeToString(sum[:]))) != 1 {
		return GoogleClaims{}, GoogleTokenError{Reason: "nonce"}
	}
	c.GoogleClaims.Sub, c.GoogleClaims.IssuedAt = tok.Subject, tok.IssuedAt
	return c.GoogleClaims, nil
}
