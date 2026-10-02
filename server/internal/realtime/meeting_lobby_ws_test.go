package realtime

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// lobbyAudience admits exactly the listed identities, as AllowLobbyListen
// would for the meeting's own audience.
type lobbyAudience map[string]bool

func (a lobbyAudience) AllowLobbyListen(_ context.Context, _, userID, guestID string) (bool, error) {
	return a["user:"+userID] || a["guest:"+guestID], nil
}

// A signed-in person who once used a meeting link signed out still carries
// that uw_guest cookie, and it names a guest this meeting does not know. The
// socket must decide on the auth frame their client sends, not refuse them on
// the stale cookie; a cookie the meeting knows needs no frame at all.
func TestLobbySocketFallsBackFromAStaleGuestCookie(t *testing.T) {
	key := []byte("lobby-test-guest-key")
	hub := NewHub()
	go hub.Run()
	parse := func(token string) (string, error) {
		if token == "token-of-u1" {
			return "u1", nil
		}
		return "", errors.New("bad token")
	}
	audience := lobbyAudience{"user:u1": true, "guest:g-known": true}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		HandleMeetingLobbyWebSocket(hub, audience, parse, key, "m1", w, r)
	}))
	t.Cleanup(srv.Close)

	dial := func(guest string) *websocket.Conn {
		t.Helper()
		h := http.Header{}
		if guest != "" {
			h.Set("Cookie", meetings.GuestCookieName+"="+meetings.SignGuestCookie(guest, key))
		}
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), h)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		return conn
	}
	read := func(conn *websocket.Conn) string {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return "read error: " + err.Error()
		}
		return string(raw)
	}
	auth := func(conn *websocket.Conn, token string) {
		t.Helper()
		if err := conn.WriteJSON(map[string]any{"type": "auth", "payload": map[string]string{"token": token}}); err != nil {
			t.Fatal(err)
		}
	}

	// Stale cookie, valid token of someone in the audience: admitted.
	conn := dial("g-stale")
	auth(conn, "token-of-u1")
	if got := read(conn); !strings.Contains(got, "auth_ack") {
		t.Fatalf("stale cookie + audience token = %s, want auth_ack", got)
	}

	// Stale cookie, token of someone outside the audience: refused.
	conn = dial("g-stale")
	auth(conn, "token-of-nobody")
	if got := read(conn); strings.Contains(got, "auth_ack") {
		t.Fatalf("stale cookie + bad token = %s, want a refusal", got)
	}

	// A cookie the meeting knows: admitted without any frame.
	conn = dial("g-known")
	if got := read(conn); !strings.Contains(got, "auth_ack") {
		t.Fatalf("known guest cookie = %s, want auth_ack", got)
	}
}
