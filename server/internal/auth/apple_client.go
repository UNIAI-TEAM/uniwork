package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AppleClient talks to Apple's token and revoke endpoints with a client secret
// it signs itself: an ES256 JWT over the Sign in with Apple key (.p8) of the
// team. Account deletion needs it (ADR 0041): Apple requires an app that
// offers Sign in with Apple to revoke the person's tokens when they delete
// their account, and revoking needs a token, which only the authorization
// code exchange hands out.
type AppleClient struct {
	teamID  string
	keyID   string
	key     *ecdsa.PrivateKey
	baseURL string
	http    *http.Client
	now     func() time.Time
}

// NewAppleClient parses the PEM (PKCS #8, as Apple's .p8 downloads are);
// a value pasted into an env file with literal \n line breaks is accepted.
// baseURL is AppleIssuer in production.
func NewAppleClient(teamID, keyID, privateKeyPEM, baseURL string) (*AppleClient, error) {
	if teamID == "" || keyID == "" || privateKeyPEM == "" {
		return nil, errors.New("apple client: team id, key id and private key are required")
	}
	block, _ := pem.Decode([]byte(strings.ReplaceAll(privateKeyPEM, `\n`, "\n")))
	if block == nil {
		return nil, errors.New("apple client: private key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("apple client: private key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("apple client: private key is not an EC key")
	}
	return &AppleClient{
		teamID: teamID, keyID: keyID, key: key, baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{Timeout: 10 * time.Second}, now: time.Now,
	}, nil
}

// clientSecret is the JWT Apple takes as client_secret for clientID (the
// bundle id the identity token was issued to). Short-lived: one per call.
func (c *AppleClient) clientSecret(clientID string) (string, error) {
	now := c.now()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    c.teamID,
		Subject:   clientID,
		Audience:  jwt.ClaimStrings{AppleIssuer},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	})
	tok.Header["kid"] = c.keyID
	return tok.SignedString(c.key)
}

// AppleClientError carries Apple's status and OAuth error code, never a token.
type AppleClientError struct {
	Op     string
	Status int
	Code   string
}

func (e AppleClientError) Error() string {
	return fmt.Sprintf("apple %s: status %d %s", e.Op, e.Status, e.Code)
}

func (c *AppleClient) post(ctx context.Context, op, path string, form url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apple %s: %w", op, err)
	}
	if resp.StatusCode != http.StatusOK {
		var body struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		return nil, AppleClientError{Op: op, Status: resp.StatusCode, Code: body.Error}
	}
	return resp, nil
}

// RefreshTokenForCode redeems the authorization code a native sign-in
// returned (valid five minutes, once) for the refresh token Apple ties to the
// person's consent. A native app's code needs no redirect_uri.
func (c *AppleClient) RefreshTokenForCode(ctx context.Context, clientID, code string) (string, error) {
	secret, err := c.clientSecret(clientID)
	if err != nil {
		return "", err
	}
	resp, err := c.post(ctx, "token", "/auth/token", url.Values{
		"client_id": {clientID}, "client_secret": {secret},
		"code": {code}, "grant_type": {"authorization_code"},
	})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.RefreshToken == "" {
		return "", AppleClientError{Op: "token", Status: resp.StatusCode, Code: "no_refresh_token"}
	}
	return out.RefreshToken, nil
}

// Revoke tells Apple the refresh token, and with it the person's consent for
// this app, is no longer wanted.
func (c *AppleClient) Revoke(ctx context.Context, clientID, refreshToken string) error {
	secret, err := c.clientSecret(clientID)
	if err != nil {
		return err
	}
	resp, err := c.post(ctx, "revoke", "/auth/revoke", url.Values{
		"client_id": {clientID}, "client_secret": {secret},
		"token": {refreshToken}, "token_type_hint": {"refresh_token"},
	})
	if err != nil {
		return err
	}
	return resp.Body.Close()
}
