package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// fakeOIDC is a minimal OpenID provider: discovery, JWKS and a token endpoint
// that returns an RS256 id_token for whatever claims the test asked for.
type fakeOIDC struct {
	srv    *httptest.Server
	key    *rsa.PrivateKey
	claims jwt.MapClaims
	// lastForm is the body of the last token request, for assertions.
	lastForm url.Values
}

func newFakeOIDC(t *testing.T) *fakeOIDC {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeOIDC{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                f.srv.URL,
			"authorization_endpoint":                f.srv.URL + "/auth",
			"token_endpoint":                        f.srv.URL + "/token",
			"jwks_uri":                              f.srv.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		n := f.key.PublicKey.N.Bytes()
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "k1",
			"n": base64.RawURLEncoding.EncodeToString(n), "e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
		}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = r.ParseForm()
		f.lastForm = r.PostForm
		if r.PostForm.Get("code") != "good-code" {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, f.claims)
		tok.Header["kid"] = "k1"
		signed, err := tok.SignedString(f.key)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": signed,
		})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	f.claims = jwt.MapClaims{
		"iss": f.srv.URL, "aud": "client-id", "sub": "sub-1",
		"email": "a@example.com", "email_verified": true, "name": "A", "picture": "https://img/a.png",
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}
	return f
}

func newGoogle(t *testing.T, f *fakeOIDC) *GoogleOAuth {
	t.Helper()
	g, err := NewGoogleOAuth(context.Background(), f.srv.URL, "client-id", "secret", "http://api.test/api/v1/auth/google/callback")
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGoogleAuthCodeURLCarriesStateAndScopes(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	u, err := url.Parse(g.AuthCodeURL("st4te"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if !strings.HasPrefix(u.String(), f.srv.URL+"/auth") || q.Get("state") != "st4te" || q.Get("client_id") != "client-id" {
		t.Fatalf("url = %s", u)
	}
	if q.Get("redirect_uri") != "http://api.test/api/v1/auth/google/callback" || q.Get("prompt") != "select_account" {
		t.Fatalf("query = %v", q)
	}
	for _, scope := range []string{"openid", "email", "profile"} {
		if !strings.Contains(q.Get("scope"), scope) {
			t.Fatalf("scope %q missing from %q", scope, q.Get("scope"))
		}
	}
}

func TestGoogleExchangeVerifiesIDTokenAndReturnsClaims(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	c, err := g.Exchange(context.Background(), "good-code")
	if err != nil {
		t.Fatal(err)
	}
	if c.Sub != "sub-1" || c.Email != "a@example.com" || !c.EmailVerified || c.Name != "A" || c.Picture != "https://img/a.png" {
		t.Fatalf("claims = %+v", c)
	}
	if f.lastForm.Get("redirect_uri") != "http://api.test/api/v1/auth/google/callback" || f.lastForm.Get("grant_type") != "authorization_code" {
		t.Fatalf("token request = %v", f.lastForm)
	}
}

func TestGoogleExchangeRejectsBadCodeAndWrongAudience(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	if _, err := g.Exchange(context.Background(), "bad-code"); err == nil {
		t.Fatal("bad code accepted")
	}
	f.claims["aud"] = "someone-else"
	if _, err := g.Exchange(context.Background(), "good-code"); err == nil {
		t.Fatal("token for another audience accepted")
	}
}

func TestGoogleExchangeRejectsExpiredToken(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	f.claims["exp"] = time.Now().Add(-time.Hour).Unix()
	if _, err := g.Exchange(context.Background(), "good-code"); err == nil {
		t.Fatal("expired token accepted")
	}
}
