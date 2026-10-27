package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// AppleIssuer is the iss of every identity token Sign in with Apple issues.
const AppleIssuer = "https://appleid.apple.com"

// AppleJWKSURL is where Apple publishes the keys its identity tokens are
// signed with (ADR 0041).
const AppleJWKSURL = "https://appleid.apple.com/auth/keys"

// ErrAppleToken is what every rejected identity token matches with errors.Is;
// AppleTokenError carries the reason, which is safe to log (never the token).
var ErrAppleToken = errors.New("apple identity token rejected")

// AppleTokenError says why an identity token was refused: signature (bad
// signature, issuer or shape), expired, audience, nonce or claims.
type AppleTokenError struct{ Reason string }

func (e AppleTokenError) Error() string        { return "apple identity token: " + e.Reason }
func (e AppleTokenError) Is(target error) bool { return target == ErrAppleToken }

// AppleClaims is what a verified identity token says about the person.
type AppleClaims struct {
	Sub string
	// Email is the address Apple vouches for; a private relay address when
	// the person chose Hide My Email (PrivateEmail).
	Email         string
	EmailVerified bool
	PrivateEmail  bool
	// Audience is the bundle id the token was issued to, one of the
	// configured audiences: the client id the code exchange and the revoke use.
	Audience string
	// IssuedAt is the token's iat: a step-up takes only a token the app just
	// got from Apple's sheet (ADR 0047 §5).
	IssuedAt time.Time
}

// AppleVerifier checks a native Sign in with Apple identity token: Apple's
// signature against its JWKS (cached by the key set, refetched when a token
// names a key it has not seen), iss, exp, an aud among the app's bundle ids,
// and a nonce equal to SHA-256 (hex) of the raw nonce the app generated.
type AppleVerifier struct {
	verifier  *oidc.IDTokenVerifier
	audiences []string
}

// NewAppleVerifier fetches keys lazily from jwksURL (AppleJWKSURL in
// production, a test server in tests); now is nil outside tests.
func NewAppleVerifier(issuer, jwksURL string, audiences []string, now func() time.Time) *AppleVerifier {
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 10 * time.Second})
	keys := oidc.NewRemoteKeySet(ctx, jwksURL)
	return &AppleVerifier{
		verifier: oidc.NewVerifier(issuer, keys, &oidc.Config{
			// Several bundle ids (production, staging) share the server: aud
			// is checked against the list below instead.
			SkipClientIDCheck:    true,
			SupportedSigningAlgs: []string{oidc.RS256},
			Now:                  now,
		}),
		audiences: append([]string(nil), audiences...),
	}
}

// AppleNonceHash is what the app puts in the authorization request and Apple
// copies into the token: SHA-256 of the raw nonce, lowercase hex.
func AppleNonceHash(rawNonce string) string {
	sum := sha256.Sum256([]byte(rawNonce))
	return hex.EncodeToString(sum[:])
}

// Verify returns the token's claims, or an AppleTokenError.
func (v *AppleVerifier) Verify(ctx context.Context, rawToken, rawNonce string) (AppleClaims, error) {
	tok, err := v.verifier.Verify(ctx, rawToken)
	if err != nil {
		var expired *oidc.TokenExpiredError
		if errors.As(err, &expired) {
			return AppleClaims{}, AppleTokenError{Reason: "expired"}
		}
		return AppleClaims{}, AppleTokenError{Reason: "signature"}
	}
	audience := ""
	for _, got := range tok.Audience {
		for _, want := range v.audiences {
			if got == want {
				audience = got
			}
		}
	}
	if audience == "" {
		return AppleClaims{}, AppleTokenError{Reason: "audience"}
	}
	want := AppleNonceHash(rawNonce)
	if rawNonce == "" || subtle.ConstantTimeCompare([]byte(tok.Nonce), []byte(want)) != 1 {
		return AppleClaims{}, AppleTokenError{Reason: "nonce"}
	}
	var c struct {
		Email         string   `json:"email"`
		EmailVerified flexBool `json:"email_verified"`
		PrivateEmail  flexBool `json:"is_private_email"`
	}
	if err := tok.Claims(&c); err != nil || tok.Subject == "" {
		return AppleClaims{}, AppleTokenError{Reason: "claims"}
	}
	return AppleClaims{
		Sub: tok.Subject, Email: c.Email, EmailVerified: bool(c.EmailVerified),
		PrivateEmail: bool(c.PrivateEmail), Audience: audience, IssuedAt: tok.IssuedAt,
	}, nil
}

// flexBool reads Apple's boolean claims, which arrive as true or as "true".
type flexBool bool

func (b *flexBool) UnmarshalJSON(raw []byte) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	switch x := v.(type) {
	case bool:
		*b = flexBool(x)
	case string:
		*b = flexBool(x == "true")
	default:
		*b = false
	}
	return nil
}
