package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenRoundtrip(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	tok, err := m.Mint("user_123")
	if err != nil {
		t.Fatal(err)
	}
	uid, err := m.Parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user_123" {
		t.Fatalf("uid = %q", uid)
	}
}

// A browser session is marked in the token so RequireAuthWithDevice can skip
// the device-session lookup; desktop tokens never carry the mark.
func TestWebSessionMarkRoundtrip(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	web, err := m.MintWebSession("user_123", "sess_1")
	if err != nil {
		t.Fatal(err)
	}
	at, err := m.ParseAccessToken(web)
	if err != nil || at.UserID != "user_123" || at.SessionID != "sess_1" || !at.Web {
		t.Fatalf("ParseAccessToken(web) = %+v %v", at, err)
	}
	desktop, _ := m.MintSession("user_123", "dev_1")
	if at, err := m.ParseAccessToken(desktop); err != nil || at.Web {
		t.Fatalf("ParseAccessToken(desktop) web=%v err=%v, want false nil", at.Web, err)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: -time.Minute}
	tok, _ := m.Mint("user_123")
	if _, err := m.Parse(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestWrongSecretRejected(t *testing.T) {
	m := TokenMinter{Secret: []byte("a"), TTL: time.Minute}
	tok, _ := m.Mint("u")
	m2 := TokenMinter{Secret: []byte("b"), TTL: time.Minute}
	if _, err := m2.Parse(tok); err == nil {
		t.Fatal("token with wrong secret accepted")
	}
}

func TestMFATokenNeverPassesAsAccessToken(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	challenge, err := m.MintMFA(MFAChallenge{UserID: "user_123"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Parse(challenge); err == nil {
		t.Fatal("a challenge token must not open RequireAuth")
	}
	if c, err := m.ParseMFA(challenge); err != nil || c.UserID != "user_123" || c.Channel != MFAChannelWeb {
		t.Fatalf("ParseMFA: %+v %v", c, err)
	}
	access, _ := m.MintSession("user_123", "sess_1")
	if _, err := m.ParseMFA(access); err == nil {
		t.Fatal("an access token must not verify MFA")
	}
	uid, sid, err := m.ParseSession(access)
	if err != nil || uid != "user_123" || sid != "sess_1" {
		t.Fatalf("ParseSession: %q %q %v", uid, sid, err)
	}
}

// A challenge names its channel, the native client and deployment, and the
// pending link (ADR 0047 §4); a token minted before channels existed reads
// as web, and a channel the server never mints is refused at minting.
func TestMFAChallengeCarriesItsChannelAndPendingLink(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	native, err := m.MintMFA(MFAChallenge{UserID: "u1", Channel: MFAChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default", PendingLink: "sealed"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := m.ParseMFA(native)
	want := MFAChallenge{UserID: "u1", Channel: MFAChannelNative, ClientID: "uniwork-chat-mobile", DeploymentID: "default", PendingLink: "sealed"}
	if err != nil || c != want {
		t.Fatalf("ParseMFA(native) = %+v %v, want %+v", c, err, want)
	}
	// The shape every challenge had before ADR 0047: no chn, cid, dep or pl.
	legacy, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject: "u2", Audience: jwt.ClaimStrings{mfaAudience},
		IssuedAt: jwt.NewNumericDate(time.Now()), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}).SignedString(m.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if c, err := m.ParseMFA(legacy); err != nil || c != (MFAChallenge{UserID: "u2", Channel: MFAChannelWeb}) {
		t.Fatalf("ParseMFA(legacy) = %+v %v, want a web challenge", c, err)
	}
	if _, err := m.MintMFA(MFAChallenge{UserID: "u3", Channel: "desktop"}); err == nil {
		t.Fatal("an unknown channel was minted")
	}
}

// The access token carries its iat, which the credentials_revoked_at gate
// compares at one-second precision.
func TestAccessTokenCarriesItsIssuedAt(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	before := time.Now().Truncate(time.Second)
	tok, err := m.MintWebSession("u1", "s1")
	if err != nil {
		t.Fatal(err)
	}
	at, err := m.ParseAccessToken(tok)
	if err != nil || at.IssuedAt.Before(before) || at.IssuedAt.After(time.Now()) || !at.IssuedAt.Equal(at.IssuedAt.Truncate(time.Second)) {
		t.Fatalf("IssuedAt = %v (minted after %v) %v", at.IssuedAt, before, err)
	}
}
