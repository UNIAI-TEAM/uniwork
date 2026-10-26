package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
)

const (
	// DriveGoogleScope is the only Google Drive scope v1 requests or accepts (spec §5.1).
	DriveGoogleScope     = "https://www.googleapis.com/auth/drive.file"
	driveGoogleAuthURL   = "https://accounts.google.com/o/oauth2/v2/auth"
	driveGoogleTokenURL  = "https://oauth2.googleapis.com/token"
	driveGoogleRevokeURL = "https://oauth2.googleapis.com/revoke"
)

var (
	// ErrDriveRevokeAlreadyInvalid indicates Google answered 400 invalid_token on
	// the revoke endpoint: the grant is already gone, so the revocation attempt
	// resolves as completed (spec §5.3b step 3).
	ErrDriveRevokeAlreadyInvalid = errors.New("drive revoke: invalid_token")
	// errDriveIDTokenInvalid indicates the returned id_token failed OIDC
	// signature, issuer, audience, expiry, nonce, sub or email_verified checks.
	errDriveIDTokenInvalid = errors.New("drive oauth: invalid id_token")
)

// DriveIDTokenClaims are the verified claims extracted from Google's id_token
// during the OAuth callback (spec §5.2 step 4).
type DriveIDTokenClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Nonce         string `json:"nonce"`
}

// DriveTokenResponse is what the Google token endpoint returns on an
// authorization-code exchange or a refresh-token grant.
type DriveTokenResponse struct {
	AccessToken  string
	RefreshToken string
	Expiry       time.Time
	IDToken      string
	Scopes       string
}

// DriveProvider is the seam between DriveConnectionService and Google's OAuth,
// OIDC and revocation endpoints (spec §5, §5.3b). Production uses
// GoogleDriveProvider; unit, handler and E2E tests use FakeDriveProvider.
type DriveProvider interface {
	AuthCodeURL(state, codeChallenge, prompt, loginHint string) string
	Exchange(ctx context.Context, code, codeVerifier string) (DriveTokenResponse, error)
	VerifyIDToken(ctx context.Context, rawIDToken, expectedNonce string) (DriveIDTokenClaims, error)
	RefreshToken(ctx context.Context, refreshToken string) (DriveTokenResponse, error)
	RevokeToken(ctx context.Context, token string) error
}

// GoogleDriveProvider talks to Google's production OAuth2, OIDC discovery/JWKS
// and token revocation endpoints over bounded HTTP clients.
type GoogleDriveProvider struct {
	cfg        oauth2.Config
	issuerURL  string
	revokeURL  string
	oauthHTTP  *http.Client
	revokeHTTP *http.Client

	verifierMu sync.Mutex
	verifier   *oidc.IDTokenVerifier
}

// NewGoogleDriveProvider constructs the real Google Drive OAuth provider for cfg.
func NewGoogleDriveProvider(cfg config.Config) *GoogleDriveProvider {
	return &GoogleDriveProvider{
		cfg: oauth2.Config{
			ClientID:     cfg.GoogleDriveClientID,
			ClientSecret: cfg.GoogleDriveClientSecret,
			RedirectURL:  cfg.DriveGoogleRedirectURL(),
			Endpoint: oauth2.Endpoint{
				AuthURL:  driveGoogleAuthURL,
				TokenURL: driveGoogleTokenURL,
			},
			Scopes: []string{oidc.ScopeOpenID, "email", DriveGoogleScope},
		},
		issuerURL:  auth.GoogleIssuer,
		revokeURL:  driveGoogleRevokeURL,
		oauthHTTP:  &http.Client{Timeout: 15 * time.Second},
		revokeHTTP: &http.Client{Timeout: 15 * time.Second},
	}
}

func (p *GoogleDriveProvider) oauthCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, p.oauthHTTP)
}

func (p *GoogleDriveProvider) AuthCodeURL(state, codeChallenge, prompt, loginHint string) string {
	opts := []oauth2.AuthCodeOption{
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	}
	if prompt != "" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", prompt))
	}
	if loginHint != "" {
		opts = append(opts, oauth2.SetAuthURLParam("login_hint", loginHint))
	}
	return p.cfg.AuthCodeURL(state, opts...)
}

func (p *GoogleDriveProvider) Exchange(ctx context.Context, code, codeVerifier string) (DriveTokenResponse, error) {
	tok, err := p.cfg.Exchange(p.oauthCtx(ctx), code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return DriveTokenResponse{}, err
	}
	idToken, _ := tok.Extra("id_token").(string)
	scopes, _ := tok.Extra("scope").(string)
	return DriveTokenResponse{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		Expiry:       tok.Expiry,
		IDToken:      idToken,
		Scopes:       scopes,
	}, nil
}

func (p *GoogleDriveProvider) oidcVerifier(ctx context.Context) (*oidc.IDTokenVerifier, error) {
	p.verifierMu.Lock()
	defer p.verifierMu.Unlock()
	if p.verifier != nil {
		return p.verifier, nil
	}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, p.oauthHTTP), p.issuerURL)
	if err != nil {
		return nil, fmt.Errorf("drive google oidc discovery: %w", err)
	}
	p.verifier = provider.Verifier(&oidc.Config{ClientID: p.cfg.ClientID})
	return p.verifier, nil
}

func (p *GoogleDriveProvider) VerifyIDToken(ctx context.Context, rawIDToken, expectedNonce string) (DriveIDTokenClaims, error) {
	if rawIDToken == "" || expectedNonce == "" {
		return DriveIDTokenClaims{}, errDriveIDTokenInvalid
	}
	v, err := p.oidcVerifier(ctx)
	if err != nil {
		return DriveIDTokenClaims{}, err
	}
	idToken, err := v.Verify(oidc.ClientContext(ctx, p.oauthHTTP), rawIDToken)
	if err != nil {
		return DriveIDTokenClaims{}, fmt.Errorf("%w: %v", errDriveIDTokenInvalid, err)
	}
	var claims DriveIDTokenClaims
	if err := idToken.Claims(&claims); err != nil {
		return DriveIDTokenClaims{}, fmt.Errorf("%w: %v", errDriveIDTokenInvalid, err)
	}
	if err := validateDriveIDTokenClaims(&claims, expectedNonce); err != nil {
		return DriveIDTokenClaims{}, err
	}
	return claims, nil
}

func (p *GoogleDriveProvider) RefreshToken(ctx context.Context, refreshToken string) (DriveTokenResponse, error) {
	tok, err := p.cfg.TokenSource(p.oauthCtx(ctx), &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil {
		return DriveTokenResponse{}, err
	}
	return DriveTokenResponse{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		Expiry:       tok.Expiry,
	}, nil
}

func (p *GoogleDriveProvider) RevokeToken(ctx context.Context, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.revokeURL,
		strings.NewReader(url.Values{"token": {token}}.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.revokeHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	if resp.StatusCode == http.StatusBadRequest {
		var errBody struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &errBody) == nil && errBody.Error == "invalid_token" {
			return ErrDriveRevokeAlreadyInvalid
		}
	}
	return fmt.Errorf("drive google revoke status_%s", strconv.Itoa(resp.StatusCode))
}

func validateDriveIDTokenClaims(c *DriveIDTokenClaims, expectedNonce string) error {
	c.Sub = strings.TrimSpace(c.Sub)
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if c.Sub == "" || c.Email == "" || !c.EmailVerified || expectedNonce == "" || c.Nonce != expectedNonce {
		return errDriveIDTokenInvalid
	}
	return nil
}

// driveScopesInclude checks whether a space-delimited OAuth scope string contains want.
func driveScopesInclude(scopes, want string) bool {
	return slices.Contains(strings.Fields(scopes), want)
}

// FakeDriveExchangeCall records one Exchange call on FakeDriveProvider.
type FakeDriveExchangeCall struct {
	Code         string
	CodeVerifier string
}

// FakeDriveProvider is a deterministic, concurrency-safe in-memory DriveProvider
// for Go unit tests, handler/isolation tests, and E2E (when APP_ENV != production
// and DRIVE_PROVIDER=fake). It makes zero network calls.
type FakeDriveProvider struct {
	ClientID    string
	RedirectURL string
	AuthURL     string

	mu            sync.Mutex
	exchangeFunc  func(ctx context.Context, code, codeVerifier string) (DriveTokenResponse, error)
	verifyFunc    func(ctx context.Context, rawIDToken, expectedNonce string) (DriveIDTokenClaims, error)
	refreshFunc   func(ctx context.Context, refreshToken string) (DriveTokenResponse, error)
	revokeFunc    func(ctx context.Context, token string) error
	idTokens      map[string]DriveIDTokenClaims
	exchangeCalls []FakeDriveExchangeCall
	refreshCalls  []string
	revokeCalls   []string
}

// NewFakeDriveProvider returns a FakeDriveProvider with sensible defaults for
// local development, E2E and unit tests.
func NewFakeDriveProvider(cfg config.Config) *FakeDriveProvider {
	clientID := cfg.GoogleDriveClientID
	if clientID == "" {
		clientID = "fake-drive-client-id"
	}
	redirect := cfg.DriveGoogleRedirectURL()
	if cfg.APIPublicURL == "" {
		redirect = "http://localhost:8080/api/v1/drive-connections/google/callback"
	}
	return &FakeDriveProvider{
		ClientID:    clientID,
		RedirectURL: redirect,
		AuthURL:     driveGoogleAuthURL,
		idTokens:    make(map[string]DriveIDTokenClaims),
	}
}

func (f *FakeDriveProvider) AuthCodeURL(state, codeChallenge, prompt, loginHint string) string {
	authURL := f.AuthURL
	if authURL == "" {
		authURL = driveGoogleAuthURL
	}
	q := url.Values{
		"client_id":             {f.ClientID},
		"redirect_uri":          {f.RedirectURL},
		"response_type":         {"code"},
		"scope":                 {strings.Join([]string{oidc.ScopeOpenID, "email", DriveGoogleScope}, " ")},
		"access_type":           {"offline"},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
		"state":                 {state},
	}
	if prompt != "" {
		q.Set("prompt", prompt)
	}
	if loginHint != "" {
		q.Set("login_hint", loginHint)
	}
	return authURL + "?" + q.Encode()
}

// SetExchange overrides how Exchange responds.
func (f *FakeDriveProvider) SetExchange(fn func(ctx context.Context, code, codeVerifier string) (DriveTokenResponse, error)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.exchangeFunc = fn
}

// SetVerifyIDToken overrides how VerifyIDToken responds.
func (f *FakeDriveProvider) SetVerifyIDToken(fn func(ctx context.Context, rawIDToken, expectedNonce string) (DriveIDTokenClaims, error)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verifyFunc = fn
}

// SetRefresh overrides how RefreshToken responds.
func (f *FakeDriveProvider) SetRefresh(fn func(ctx context.Context, refreshToken string) (DriveTokenResponse, error)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refreshFunc = fn
}

// SetRevoke overrides how RevokeToken responds.
func (f *FakeDriveProvider) SetRevoke(fn func(ctx context.Context, token string) error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revokeFunc = fn
}

// RegisterIDToken associates a synthetic raw id_token string with claims for VerifyIDToken.
func (f *FakeDriveProvider) RegisterIDToken(raw string, claims DriveIDTokenClaims) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.idTokens == nil {
		f.idTokens = make(map[string]DriveIDTokenClaims)
	}
	f.idTokens[raw] = claims
}

// ExchangeCalls returns a snapshot of all Exchange calls made so far.
func (f *FakeDriveProvider) ExchangeCalls() []FakeDriveExchangeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.exchangeCalls)
}

// RefreshCalls returns a snapshot of all refresh tokens sent to RefreshToken so far.
func (f *FakeDriveProvider) RefreshCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.refreshCalls)
}

// RevokeCalls returns a snapshot of all tokens sent to RevokeToken so far.
func (f *FakeDriveProvider) RevokeCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.revokeCalls)
}

func (f *FakeDriveProvider) Exchange(ctx context.Context, code, codeVerifier string) (DriveTokenResponse, error) {
	f.mu.Lock()
	f.exchangeCalls = append(f.exchangeCalls, FakeDriveExchangeCall{Code: code, CodeVerifier: codeVerifier})
	fn := f.exchangeFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, code, codeVerifier)
	}
	if code == "" {
		return DriveTokenResponse{}, &oauth2.RetrieveError{
			Response:  &http.Response{StatusCode: http.StatusBadRequest},
			ErrorCode: "invalid_grant",
		}
	}
	return DriveTokenResponse{
		AccessToken:  "fake-drive-access-" + code,
		RefreshToken: "fake-drive-refresh-" + code,
		Expiry:       time.Now().UTC().Add(time.Hour),
		IDToken:      "fake-id-token:" + code,
		Scopes:       "openid email " + DriveGoogleScope,
	}, nil
}

func (f *FakeDriveProvider) VerifyIDToken(ctx context.Context, rawIDToken, expectedNonce string) (DriveIDTokenClaims, error) {
	f.mu.Lock()
	fn := f.verifyFunc
	registered, hasRegistered := f.idTokens[rawIDToken]
	f.mu.Unlock()
	if fn != nil {
		claims, err := fn(ctx, rawIDToken, expectedNonce)
		if err != nil {
			return DriveIDTokenClaims{}, err
		}
		if err := validateDriveIDTokenClaims(&claims, expectedNonce); err != nil {
			return DriveIDTokenClaims{}, err
		}
		return claims, nil
	}
	if hasRegistered {
		if err := validateDriveIDTokenClaims(&registered, expectedNonce); err != nil {
			return DriveIDTokenClaims{}, err
		}
		return registered, nil
	}
	if raw, ok := strings.CutPrefix(rawIDToken, "fake-id-token:"); ok && raw != "" {
		claims := DriveIDTokenClaims{
			Sub:           "fake-sub-" + raw,
			Email:         "drive-" + raw + "@example.com",
			EmailVerified: true,
			Nonce:         expectedNonce,
		}
		if err := validateDriveIDTokenClaims(&claims, expectedNonce); err != nil {
			return DriveIDTokenClaims{}, err
		}
		return claims, nil
	}
	return DriveIDTokenClaims{}, errDriveIDTokenInvalid
}

func (f *FakeDriveProvider) RefreshToken(ctx context.Context, refreshToken string) (DriveTokenResponse, error) {
	f.mu.Lock()
	f.refreshCalls = append(f.refreshCalls, refreshToken)
	fn := f.refreshFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, refreshToken)
	}
	return DriveTokenResponse{
		AccessToken:  "fake-drive-refreshed-access",
		RefreshToken: refreshToken,
		Expiry:       time.Now().UTC().Add(time.Hour),
	}, nil
}

func (f *FakeDriveProvider) RevokeToken(ctx context.Context, token string) error {
	f.mu.Lock()
	f.revokeCalls = append(f.revokeCalls, token)
	fn := f.revokeFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, token)
	}
	return nil
}
