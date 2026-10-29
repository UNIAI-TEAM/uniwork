// Package googletest stands in for Google's OpenID provider in tests: the
// discovery document and key set https://accounts.google.com serves, and ID
// tokens signed with its key, with whatever claims a test needs, as the app's
// Google SDK hands them over.
package googletest

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

// Issuer is a fake Google: URL is the issuer discovery runs against, Token
// signs.
type Issuer struct {
	URL string
	key *rsa.PrivateKey
}

// New starts the discovery and key set server; it stops with the test.
func New(t testing.TB) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	i := &Issuer{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer": i.URL, "authorization_endpoint": i.URL + "/auth", "token_endpoint": i.URL + "/token",
			"jwks_uri": i.URL + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test-google",
			"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
		}}})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	i.URL = srv.URL
	return i
}

// Claims are an ID token's as the app's SDK gets it: this issuer, aud and
// azp as the platform sets them, a verified address, issued now with Google's
// hour of expiry, and the SHA-256 (hex) of rawNonce. Change the map before
// signing.
func (i *Issuer) Claims(aud, azp, sub, email, rawNonce string) jwt.MapClaims {
	sum := sha256.Sum256([]byte(rawNonce))
	return jwt.MapClaims{
		"iss": i.URL, "aud": aud, "azp": azp, "sub": sub,
		"email": email, "email_verified": true,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		"nonce": hex.EncodeToString(sum[:]),
	}
}

// Token signs claims with the key the key set serves.
func (i *Issuer) Token(t testing.TB, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "test-google"
	s, err := tok.SignedString(i.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
