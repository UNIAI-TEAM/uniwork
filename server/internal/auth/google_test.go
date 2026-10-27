package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
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
		"hd": "example.com", "nonce": "n0nce",
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

// pkceVerifier is a fixed RFC 7636 verifier; its S256 challenge is below.
const pkceVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

func TestGoogleAuthCodeURLCarriesStateNonceChallengeAndScopes(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	u, err := url.Parse(g.AuthCodeURL("st4te", "n0nce", pkceVerifier))
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
	// RFC 7636 appendix B: this verifier's S256 challenge.
	if q.Get("nonce") != "n0nce" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" {
		t.Fatalf("nonce and PKCE = %v", q)
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
	c, err := g.Exchange(context.Background(), "good-code", pkceVerifier, "n0nce")
	if err != nil {
		t.Fatal(err)
	}
	if c.Sub != "sub-1" || c.Email != "a@example.com" || !c.EmailVerified || c.Name != "A" || c.Picture != "https://img/a.png" || c.HD != "example.com" {
		t.Fatalf("claims = %+v", c)
	}
	if f.lastForm.Get("redirect_uri") != "http://api.test/api/v1/auth/google/callback" || f.lastForm.Get("grant_type") != "authorization_code" ||
		f.lastForm.Get("code_verifier") != pkceVerifier {
		t.Fatalf("token request = %v", f.lastForm)
	}
}

// The ID token must echo the nonce this sign-in put in the authorization
// request (ADR 0047): a token minted for another sign-in, or with none, is
// refused even though Google signed it.
func TestGoogleExchangeRefusesAnotherNonce(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	if _, err := g.Exchange(context.Background(), "good-code", pkceVerifier, "another"); !errors.Is(err, ErrGoogleNonce) {
		t.Fatalf("another nonce: %v", err)
	}
	if _, err := g.Exchange(context.Background(), "good-code", pkceVerifier, ""); !errors.Is(err, ErrGoogleNonce) {
		t.Fatalf("no nonce expected: %v", err)
	}
	delete(f.claims, "nonce")
	if _, err := g.Exchange(context.Background(), "good-code", pkceVerifier, "n0nce"); !errors.Is(err, ErrGoogleNonce) {
		t.Fatalf("token without a nonce: %v", err)
	}
}

func TestGoogleExchangeRejectsBadCodeAndWrongAudience(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	if _, err := g.Exchange(context.Background(), "bad-code", pkceVerifier, "n0nce"); err == nil {
		t.Fatal("bad code accepted")
	}
	f.claims["aud"] = "someone-else"
	if _, err := g.Exchange(context.Background(), "good-code", pkceVerifier, "n0nce"); err == nil {
		t.Fatal("token for another audience accepted")
	}
}

func TestGoogleExchangeRejectsExpiredToken(t *testing.T) {
	f := newFakeOIDC(t)
	g := newGoogle(t, f)
	f.claims["exp"] = time.Now().Add(-time.Hour).Unix()
	if _, err := g.Exchange(context.Background(), "good-code", pkceVerifier, "n0nce"); err == nil {
		t.Fatal("expired token accepted")
	}
}

// sign signs claims with the fake provider's key, as Google signs the ID
// token its SDK hands the app.
func (f *fakeOIDC) sign(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "k1"
	signed, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

const (
	nativeWebClient     = "client-id"
	nativeIOSClient     = "ios-client"
	nativeAndroidClient = "android-client"
	nativeRawNonce      = "raw-n0nce"
)

// appClaims is an ID token the app's SDK got: aud and azp as the platform
// sets them, the hash of the raw nonce the app handed the SDK.
func (f *fakeOIDC) appClaims(aud, azp string) jwt.MapClaims {
	sum := sha256.Sum256([]byte(nativeRawNonce))
	return jwt.MapClaims{
		"iss": f.srv.URL, "aud": aud, "azp": azp, "sub": "sub-app",
		"email": "an@gmail.com", "email_verified": true, "name": "An", "hd": "",
		"nonce": hex.EncodeToString(sum[:]),
		"iat":   time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}
}

func nativeVerifier(t *testing.T, f *fakeOIDC) *GoogleNativeVerifier {
	t.Helper()
	d, err := DiscoverGoogle(context.Background(), f.srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return d.NativeVerifier(nativeWebClient, []string{nativeIOSClient, nativeAndroidClient}, nil)
}

func wantGoogleRefusal(t *testing.T, err error, reason string) {
	t.Helper()
	var te GoogleTokenError
	if !errors.As(err, &te) || te.Reason != reason || !errors.Is(err, ErrGoogleToken) {
		t.Fatalf("got %v, want the %s refusal", err, reason)
	}
}

// The web and the app take Google tokens through different doors (ADR 0047
// §8): the app's verifier takes an audience among the web and app clients
// but only an app client as the authorized party (azp), so a token the web's
// code flow was issued never opens the app's door; the web's code flow takes
// only its own client, as audience and as azp, so a token the app's SDK got
// never finishes a browser sign-in.
func TestWebAndNativeGoogleAudiencesStayApart(t *testing.T) {
	f := newFakeOIDC(t)
	v := nativeVerifier(t, f)
	ctx := context.Background()
	// Android asks for the web client as audience; iOS for its own client.
	for name, c := range map[string]jwt.MapClaims{
		"android": f.appClaims(nativeWebClient, nativeAndroidClient),
		"ios":     f.appClaims(nativeIOSClient, nativeIOSClient),
	} {
		got, err := v.Verify(ctx, f.sign(t, c), nativeRawNonce)
		if err != nil || got.Sub != "sub-app" || got.Email != "an@gmail.com" || !got.EmailVerified || got.IssuedAt.IsZero() {
			t.Fatalf("%s token at the app's door: %+v %v", name, got, err)
		}
	}
	// The web's token: its own client as audience and as authorized party.
	_, err := v.Verify(ctx, f.sign(t, f.appClaims(nativeWebClient, nativeWebClient)), nativeRawNonce)
	wantGoogleRefusal(t, err, "azp")
	// An audience none of this server's clients is.
	_, err = v.Verify(ctx, f.sign(t, f.appClaims("someone-else", nativeAndroidClient)), nativeRawNonce)
	wantGoogleRefusal(t, err, "audience")

	// The other way: the app's token never finishes the web's code flow.
	g := newGoogle(t, f)
	f.claims["azp"] = nativeAndroidClient
	if _, err := g.Exchange(ctx, "good-code", pkceVerifier, "n0nce"); err == nil || errors.Is(err, ErrGoogleNonce) {
		t.Fatalf("a token issued to the app at the web's callback: %v", err)
	}
	f.claims["azp"] = nativeWebClient
	if _, err := g.Exchange(ctx, "good-code", pkceVerifier, "n0nce"); err != nil {
		t.Fatalf("the web's own token: %v", err)
	}
}

// The app's Google token proves this sign-in only with the nonce the app
// handed the SDK (ADR 0047 §8): the token must carry the SHA-256 (hex) of
// the raw nonce the request sends, so a token lifted from another sign-in, or
// one with no nonce at all, opens nothing. The authorized party is the app
// itself, and the token is one the SDK just returned.
func TestGoogleNativeNeedsANonceAndTheAppAzp(t *testing.T) {
	f := newFakeOIDC(t)
	v := nativeVerifier(t, f)
	ctx := context.Background()
	good := f.appClaims(nativeWebClient, nativeAndroidClient)

	noNonce := f.appClaims(nativeWebClient, nativeAndroidClient)
	delete(noNonce, "nonce")
	_, err := v.Verify(ctx, f.sign(t, noNonce), nativeRawNonce)
	wantGoogleRefusal(t, err, "nonce")
	_, err = v.Verify(ctx, f.sign(t, good), "")
	wantGoogleRefusal(t, err, "nonce")
	_, err = v.Verify(ctx, f.sign(t, good), "another-nonce")
	wantGoogleRefusal(t, err, "nonce")
	plain := f.appClaims(nativeWebClient, nativeAndroidClient)
	plain["nonce"] = nativeRawNonce
	_, err = v.Verify(ctx, f.sign(t, plain), nativeRawNonce)
	wantGoogleRefusal(t, err, "nonce")

	noAZP := f.appClaims(nativeWebClient, nativeAndroidClient)
	delete(noAZP, "azp")
	_, err = v.Verify(ctx, f.sign(t, noAZP), nativeRawNonce)
	wantGoogleRefusal(t, err, "azp")

	stale := f.appClaims(nativeWebClient, nativeAndroidClient)
	stale["iat"] = time.Now().Add(-googleNativeMaxAge - time.Minute).Unix()
	_, err = v.Verify(ctx, f.sign(t, stale), nativeRawNonce)
	wantGoogleRefusal(t, err, "stale")
	future := f.appClaims(nativeWebClient, nativeAndroidClient)
	future["iat"] = time.Now().Add(googleClockSkew + time.Minute).Unix()
	_, err = v.Verify(ctx, f.sign(t, future), nativeRawNonce)
	wantGoogleRefusal(t, err, "stale")

	expired := f.appClaims(nativeWebClient, nativeAndroidClient)
	expired["exp"] = time.Now().Add(-time.Minute).Unix()
	_, err = v.Verify(ctx, f.sign(t, expired), nativeRawNonce)
	wantGoogleRefusal(t, err, "expired")

	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	forged := jwt.NewWithClaims(jwt.SigningMethodRS256, good)
	forged.Header["kid"] = "k1"
	raw, _ := forged.SignedString(other)
	_, err = v.Verify(ctx, raw, nativeRawNonce)
	wantGoogleRefusal(t, err, "signature")
	_, err = v.Verify(ctx, "not-a-token", nativeRawNonce)
	wantGoogleRefusal(t, err, "signature")

	if got, err := v.Verify(ctx, f.sign(t, good), nativeRawNonce); err != nil || got.Sub != "sub-app" {
		t.Fatalf("the app's own fresh token with its nonce: %+v %v", got, err)
	}
}
