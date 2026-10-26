// Package appletest stands in for Sign in with Apple in tests: a JWKS server
// like https://appleid.apple.com/auth/keys and identity tokens signed with
// its key, with whatever claims a test needs.
package appletest

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Issuer is a fake Apple: JWKSURL serves its key, Token signs.
type Issuer struct {
	JWKSURL string
	key     *rsa.PrivateKey
}

// New starts the JWKS server; it stops with the test.
func New(t testing.TB) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test-apple",
			"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
		}}})
	}))
	t.Cleanup(srv.Close)
	return &Issuer{JWKSURL: srv.URL, key: key}
}

// Claims are an identity token's: Apple's issuer, a ten-minute expiry, and the
// SHA-256 (hex) of rawNonce. Change the map before signing.
func Claims(aud, sub, email string, private bool, rawNonce string) jwt.MapClaims {
	sum := sha256.Sum256([]byte(rawNonce))
	return jwt.MapClaims{
		"iss": "https://appleid.apple.com", "aud": aud, "sub": sub,
		"iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(),
		"nonce": hex.EncodeToString(sum[:]), "nonce_supported": true,
		"email": email, "email_verified": "true", "is_private_email": map[bool]string{true: "true", false: "false"}[private],
	}
}

// Token signs claims with the key the JWKS serves.
func (i *Issuer) Token(t testing.TB, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "test-apple"
	s, err := tok.SignedString(i.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
