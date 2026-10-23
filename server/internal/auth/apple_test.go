package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// appleTestKeys serves a JWKS the way https://appleid.apple.com/auth/keys
// does and signs identity tokens with the matching key.
type appleTestKeys struct {
	srv     *httptest.Server
	key     *rsa.PrivateKey
	fetches atomic.Int32
}

func newAppleTestKeys(t *testing.T) *appleTestKeys {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	k := &appleTestKeys{key: key}
	k.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		k.fetches.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "apple-1",
			"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
		}}})
	}))
	t.Cleanup(k.srv.Close)
	return k
}

func (k *appleTestKeys) sign(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "apple-1"
	s, err := tok.SignedString(k.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func appleClaims(nonce string, mutate func(jwt.MapClaims)) jwt.MapClaims {
	c := jwt.MapClaims{
		"iss": AppleIssuer, "aud": "com.uniworkos.chat", "sub": "001234.abc.0987",
		"iat": time.Now().Unix(), "exp": time.Now().Add(10 * time.Minute).Unix(),
		"nonce": AppleNonceHash(nonce), "nonce_supported": true,
		"email": "x7ab@privaterelay.appleid.com", "email_verified": "true", "is_private_email": "true",
	}
	if mutate != nil {
		mutate(c)
	}
	return c
}

func TestAppleVerifierAcceptsAGoodTokenAndReadsStringBooleans(t *testing.T) {
	keys := newAppleTestKeys(t)
	v := NewAppleVerifier(AppleIssuer, keys.srv.URL, []string{"com.uniworkos.chat", "com.uniworkos.chat.staging"}, nil)
	got, err := v.Verify(context.Background(), keys.sign(t, appleClaims("raw-nonce", nil)), "raw-nonce")
	if err != nil {
		t.Fatal(err)
	}
	want := AppleClaims{Sub: "001234.abc.0987", Email: "x7ab@privaterelay.appleid.com", EmailVerified: true, PrivateEmail: true, Audience: "com.uniworkos.chat"}
	if got != want {
		t.Fatalf("claims = %+v, want %+v", got, want)
	}
	// Booleans as JSON booleans, and the staging bundle id as audience.
	got, err = v.Verify(context.Background(), keys.sign(t, appleClaims("n2", func(c jwt.MapClaims) {
		c["aud"] = "com.uniworkos.chat.staging"
		c["email"] = "mai@example.com"
		c["email_verified"] = true
		c["is_private_email"] = false
	})), "n2")
	if err != nil || got.PrivateEmail || !got.EmailVerified || got.Audience != "com.uniworkos.chat.staging" {
		t.Fatalf("claims = %+v err = %v", got, err)
	}
	// The key set is cached: two tokens, one fetch.
	if n := keys.fetches.Load(); n != 1 {
		t.Fatalf("JWKS fetched %d times, want 1", n)
	}
}

func TestAppleVerifierRefusesWhatAppleDidNotIssueForThisApp(t *testing.T) {
	keys := newAppleTestKeys(t)
	v := NewAppleVerifier(AppleIssuer, keys.srv.URL, []string{"com.uniworkos.chat"}, nil)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	forged := jwt.NewWithClaims(jwt.SigningMethodRS256, appleClaims("n", nil))
	forged.Header["kid"] = "apple-1"
	forgedRaw, err := forged.SignedString(other)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, token, nonce, reason string
	}{
		{"wrong audience", keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { c["aud"] = "com.example.other" })), "n", "audience"},
		{"expired", keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Minute).Unix() })), "n", "expired"},
		{"bad nonce", keys.sign(t, appleClaims("n", nil)), "another-nonce", "nonce"},
		{"raw nonce in the token", keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { c["nonce"] = "n" })), "n", "nonce"},
		{"no nonce sent", keys.sign(t, appleClaims("", nil)), "", "nonce"},
		{"wrong issuer", keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { c["iss"] = "https://accounts.google.com" })), "n", "signature"},
		{"forged signature", forgedRaw, "n", "signature"},
		{"not a token", "not-a-jwt", "n", "signature"},
		{"no subject", keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { delete(c, "sub") })), "n", "claims"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := v.Verify(context.Background(), tc.token, tc.nonce)
			var te AppleTokenError
			if !errors.Is(err, ErrAppleToken) || !errors.As(err, &te) || te.Reason != tc.reason {
				t.Fatalf("err = %v, want reason %q", err, tc.reason)
			}
		})
	}
}

func TestFlexBoolReadsOnlyTrue(t *testing.T) {
	for raw, want := range map[string]bool{`true`: true, `"true"`: true, `false`: false, `"false"`: false, `1`: false, `null`: false} {
		var b flexBool
		if err := json.Unmarshal([]byte(raw), &b); err != nil || bool(b) != want {
			t.Fatalf("%s → %v (%v), want %v", raw, b, err, want)
		}
	}
	var b flexBool
	if err := b.UnmarshalJSON([]byte(`{`)); err == nil {
		t.Fatal("broken JSON must fail")
	}
}

func testP8(t *testing.T) (string, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), key
}

func TestAppleClientExchangesTheCodeAndRevokesWithASignedSecret(t *testing.T) {
	p8, key := testP8(t)
	var forms []url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		forms = append(forms, r.PostForm)
		secret, err := jwt.Parse(r.PostForm.Get("client_secret"), func(tok *jwt.Token) (any, error) {
			if tok.Header["kid"] != "KEY123" {
				t.Errorf("kid = %v", tok.Header["kid"])
			}
			return &key.PublicKey, nil
		}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithAudience(AppleIssuer), jwt.WithIssuer("XJAM488A6D"), jwt.WithSubject("com.uniworkos.chat"))
		if err != nil || !secret.Valid {
			t.Errorf("client secret: %v", err)
		}
		switch r.URL.Path {
		case "/auth/token":
			if r.PostForm.Get("code") != "good-code" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"a","refresh_token":"r-123","id_token":"x"}`))
		case "/auth/revoke":
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()
	// The env form: line breaks written as \n.
	c, err := NewAppleClient("XJAM488A6D", "KEY123", strings.ReplaceAll(p8, "\n", `\n`), srv.URL+"/")
	if err != nil {
		t.Fatal(err)
	}
	rt, err := c.RefreshTokenForCode(context.Background(), "com.uniworkos.chat", "good-code")
	if err != nil || rt != "r-123" {
		t.Fatalf("refresh token = %q err = %v", rt, err)
	}
	if f := forms[0]; f.Get("grant_type") != "authorization_code" || f.Get("client_id") != "com.uniworkos.chat" {
		t.Fatalf("token form = %v", f)
	}
	_, err = c.RefreshTokenForCode(context.Background(), "com.uniworkos.chat", "used-code")
	var ce AppleClientError
	if !errors.As(err, &ce) || ce.Status != http.StatusBadRequest || ce.Code != "invalid_grant" || strings.Contains(err.Error(), "used-code") {
		t.Fatalf("bad code: %v", err)
	}
	if err := c.Revoke(context.Background(), "com.uniworkos.chat", "r-123"); err != nil {
		t.Fatal(err)
	}
	if f := forms[2]; f.Get("token") != "r-123" || f.Get("token_type_hint") != "refresh_token" {
		t.Fatalf("revoke form = %v", f)
	}
}

func TestAppleClientRefusesAKeyItCannotSignWith(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(rsaKey)
	rsaPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	for name, pemText := range map[string]string{
		"missing": "", "not pem": "hello", "rsa": rsaPEM,
		"garbage": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("x")})),
	} {
		if _, err := NewAppleClient("T", "K", pemText, AppleIssuer); err == nil {
			t.Fatalf("%s: want an error", name)
		}
	}
}

// The production Secret (deploy/app/env/README.md › Apple) carries the .p8 file
// as written, real line breaks and a trailing newline included.
func TestAppleClientTakesThePEMAsTheSecretFileCarriesIt(t *testing.T) {
	p8, _ := testP8(t)
	if _, err := NewAppleClient("XJAM488A6D", "KEY123", p8+"\n", AppleIssuer); err != nil {
		t.Fatalf("multi-line PEM: %v", err)
	}
}

func TestAppleClientReportsAnAnswerWithoutRefreshToken(t *testing.T) {
	p8, _ := testP8(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/auth/revoke" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"a"}`))
	}))
	defer srv.Close()
	c, err := NewAppleClient("T", "K", p8, srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.RefreshTokenForCode(context.Background(), "com.uniworkos.chat", "c"); err == nil {
		t.Fatal("no refresh_token must be an error")
	}
	if err := c.Revoke(context.Background(), "com.uniworkos.chat", "r"); err == nil {
		t.Fatal("a 400 revoke must be an error")
	}
	srv.Close()
	if err := c.Revoke(context.Background(), "com.uniworkos.chat", "r"); err == nil {
		t.Fatal("an unreachable Apple must be an error")
	}
}
