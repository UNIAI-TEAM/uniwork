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
	if got.IssuedAt.IsZero() || time.Since(got.IssuedAt) > time.Minute {
		t.Fatalf("iat = %v, want the token's", got.IssuedAt)
	}
	if got.IssuedAt = (time.Time{}); got != want {
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
	c, err := NewAppleClient("XJAM488A6D\n", "KEY123\n", p8+"\n", AppleIssuer)
	if err != nil {
		t.Fatalf("multi-line PEM: %v", err)
	}
	// A key id file written with echo ends in a newline; the client secret
	// must still name the bare ids, or Apple refuses it.
	secret, err := c.clientSecret("com.uniworkos.chat")
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := jwt.NewParser().ParseUnverified(secret, &jwt.RegisteredClaims{})
	if err != nil {
		t.Fatal(err)
	}
	iss, _ := tok.Claims.GetIssuer()
	if tok.Header["kid"] != "KEY123" || iss != "XJAM488A6D" {
		t.Fatalf("kid %q, iss %q; want the trimmed ids", tok.Header["kid"], iss)
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

// A web authorization code was issued for the return URL, and Apple refuses
// the exchange unless it names that URI again (ADR 0047 §7): the form carries
// redirect_uri and a client secret signed for the Services ID; the answer is
// the identity token to verify and the refresh token to keep.
func TestAppleClientExchangesAWebCodeForItsReturnURL(t *testing.T) {
	p8, key := testP8(t)
	var form url.Values
	answer := `{"access_token":"a","refresh_token":"r-web","id_token":"id.token.web"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		form = r.PostForm
		if _, err := jwt.Parse(r.PostForm.Get("client_secret"), func(*jwt.Token) (any, error) { return &key.PublicKey, nil },
			jwt.WithValidMethods([]string{"ES256"}), jwt.WithSubject("com.uniworkos.web")); err != nil {
			t.Errorf("the client secret is signed for the Services ID: %v", err)
		}
		if r.URL.Path != "/auth/token" || r.PostForm.Get("code") != "web-code" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_, _ = w.Write([]byte(answer))
	}))
	defer srv.Close()
	c, err := NewAppleClient("XJAM488A6D", "KEY123", p8, srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	const back = "https://api.example.com/api/v1/auth/apple/callback"
	got, err := c.ExchangeWebCode(context.Background(), "com.uniworkos.web", "web-code", back)
	if err != nil || got != (AppleWebTokens{IDToken: "id.token.web", RefreshToken: "r-web"}) {
		t.Fatalf("tokens = %+v err = %v", got, err)
	}
	if form.Get("redirect_uri") != back || form.Get("grant_type") != "authorization_code" || form.Get("client_id") != "com.uniworkos.web" {
		t.Fatalf("token form = %v", form)
	}
	_, err = c.ExchangeWebCode(context.Background(), "com.uniworkos.web", "spent-code", back)
	var ce AppleClientError
	if !errors.As(err, &ce) || ce.Code != "invalid_grant" || strings.Contains(err.Error(), "spent-code") {
		t.Fatalf("bad code: %v", err)
	}
	// An answer without an identity token proves no one.
	answer = `{"access_token":"a","refresh_token":"r"}`
	if _, err = c.ExchangeWebCode(context.Background(), "com.uniworkos.web", "web-code", back); !errors.As(err, &ce) || ce.Code != "no_id_token" {
		t.Fatalf("no id_token: %v", err)
	}
	// A refresh token is best effort: its absence is not a failure.
	answer = `{"id_token":"id.only"}`
	if got, err = c.ExchangeWebCode(context.Background(), "com.uniworkos.web", "web-code", back); err != nil || got.RefreshToken != "" || got.IDToken != "id.only" {
		t.Fatalf("no refresh token: %+v %v", got, err)
	}
}

// The authorize URL asks for the name and the address, answered as a form
// POST to the return URL, with the nonce's hash, never the raw nonce.
func TestAppleWebAuthorizeURLAsksForAFormPost(t *testing.T) {
	raw := AppleWebAuthorizeURL(AppleIssuer+"/", "com.uniworkos.web", "https://api.example.com/api/v1/auth/apple/callback", "st+te", AppleNonceHash("raw"))
	if !strings.HasPrefix(raw, "https://appleid.apple.com/auth/authorize?") || !strings.Contains(raw, "scope=name%20email") {
		t.Fatalf("url = %s", raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("response_type") != "code" || q.Get("response_mode") != "form_post" || q.Get("client_id") != "com.uniworkos.web" ||
		q.Get("redirect_uri") != "https://api.example.com/api/v1/auth/apple/callback" || q.Get("scope") != "name email" ||
		q.Get("state") != "st+te" || q.Get("nonce") != AppleNonceHash("raw") {
		t.Fatalf("query = %v", q)
	}
}

// The app's verifier takes its bundle ids and the web's only the Services ID
// (ADR 0047 §7): a token issued to one door is refused at the other.
func TestAppleVerifiersOfTheTwoDoorsRefuseEachOthersTokens(t *testing.T) {
	keys := newAppleTestKeys(t)
	native := NewAppleVerifier(AppleIssuer, keys.srv.URL, []string{"com.uniworkos.chat"}, nil)
	web := NewAppleVerifier(AppleIssuer, keys.srv.URL, []string{"com.uniworkos.web"}, nil)
	app := keys.sign(t, appleClaims("n", nil))
	site := keys.sign(t, appleClaims("n", func(c jwt.MapClaims) { c["aud"] = "com.uniworkos.web" }))
	if c, err := native.Verify(context.Background(), app, "n"); err != nil || c.Audience != "com.uniworkos.chat" {
		t.Fatalf("app token at the app's door: %+v %v", c, err)
	}
	if c, err := web.Verify(context.Background(), site, "n"); err != nil || c.Audience != "com.uniworkos.web" {
		t.Fatalf("web token at the web's door: %+v %v", c, err)
	}
	for name, try := range map[string]func() error{
		"web token at the app's door": func() error { _, err := native.Verify(context.Background(), site, "n"); return err },
		"app token at the web's door": func() error { _, err := web.Verify(context.Background(), app, "n"); return err },
	} {
		var te AppleTokenError
		if err := try(); !errors.As(err, &te) || te.Reason != "audience" {
			t.Fatalf("%s: %v", name, err)
		}
	}
}
