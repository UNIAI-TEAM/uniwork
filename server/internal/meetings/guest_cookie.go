package meetings

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

const GuestCookieName = "uw_guest"

// GuestSessionHeader carries the signed uw_guest value when cross-origin
// fetches cannot attach HttpOnly cookies (localhost:3000 → :8080 dev).
const GuestSessionHeader = "X-Guest-Session"

const guestCookieMaxAge = 30 * 24 * time.Hour

// SignGuestCookie returns a signed cookie value for a guest ULID.
func SignGuestCookie(guestID string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(guestID))
	sig := hex.EncodeToString(mac.Sum(nil))
	return guestID + "." + sig
}

// VerifyGuestCookie validates the HMAC and returns the guest id.
func VerifyGuestCookie(value string, key []byte) (string, bool) {
	value = strings.TrimSpace(value)
	i := strings.LastIndex(value, ".")
	if i <= 0 || i >= len(value)-1 {
		return "", false
	}
	guestID := value[:i]
	want := SignGuestCookie(guestID, key)
	if subtle.ConstantTimeCompare([]byte(value), []byte(want)) != 1 {
		return "", false
	}
	return guestID, true
}

// GuestIDFromRequest reads and verifies the guest session from the HttpOnly
// cookie or X-Guest-Session header when present.
func GuestIDFromRequest(r *http.Request, key []byte) string {
	if len(key) == 0 {
		return ""
	}
	if h := strings.TrimSpace(r.Header.Get(GuestSessionHeader)); h != "" {
		if id, ok := VerifyGuestCookie(h, key); ok {
			return id
		}
	}
	c, err := r.Cookie(GuestCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	id, ok := VerifyGuestCookie(c.Value, key)
	if !ok {
		return ""
	}
	return id
}

// SetGuestCookie writes the signed guest session cookie.
func SetGuestCookie(w http.ResponseWriter, guestID string, key []byte, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     GuestCookieName,
		Value:    SignGuestCookie(guestID, key),
		Path:     "/",
		MaxAge:   int(guestCookieMaxAge / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}
