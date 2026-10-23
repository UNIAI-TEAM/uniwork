package auth

import (
	"testing"
	"time"
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
	challenge, err := m.MintMFA("user_123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Parse(challenge); err == nil {
		t.Fatal("a challenge token must not open RequireAuth")
	}
	if uid, err := m.ParseMFA(challenge); err != nil || uid != "user_123" {
		t.Fatalf("ParseMFA: %q %v", uid, err)
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
