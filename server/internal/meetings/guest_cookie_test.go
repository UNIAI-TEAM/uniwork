package meetings

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"testing"
)

func TestGuestCookieRoundTrip(t *testing.T) {
	key := []byte("test-secret-key")
	guestID := "01J8X4GUEST1P2Q3R4S5T6U7V8"
	signed := SignGuestCookie(guestID, key)
	got, ok := VerifyGuestCookie(signed, key)
	if !ok || got != guestID {
		t.Fatalf("verify: ok=%v got=%q", ok, got)
	}
	if _, bad := VerifyGuestCookie(guestID+".deadbeef", key); bad {
		t.Fatal("bad sig accepted")
	}
}

func TestGuestCookieTamper(t *testing.T) {
	key := []byte("k")
	signed := SignGuestCookie("guest1", key)
	tampered := "guest2" + signed[len("guest1"):]
	if _, ok := VerifyGuestCookie(tampered, key); ok {
		t.Fatal("tampered cookie accepted")
	}
}

func TestGuestCookieUsesHMAC(t *testing.T) {
	key := []byte("k")
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("g1"))
	want := "g1." + hex.EncodeToString(mac.Sum(nil))
	if SignGuestCookie("g1", key) != want {
		t.Fatal("sign format mismatch")
	}
	if subtle.ConstantTimeCompare([]byte("a"), []byte("b")) != 0 {
		t.Fatal("sanity")
	}
}

func TestGuestIDFromRequestHeader(t *testing.T) {
	key := []byte("test-secret-key")
	signed := SignGuestCookie("guest-header", key)
	r, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	r.Header.Set(GuestSessionHeader, signed)
	got := GuestIDFromRequest(r, key)
	if got != "guest-header" {
		t.Fatalf("header guest id = %q", got)
	}
}
