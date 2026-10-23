package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// tokenSession is the device session an access token runs in (its jti).
func tokenSession(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("access token is not a JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		ID string `json:"jti"`
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	return claims.ID
}

// ADR 0038 §4: the ring_closed row of a ring answered or declined names the
// device session that did it, so the push lane does not send that iPhone an
// end (CallKit would hang up the call just answered). The voice routes take
// it from the bearer token.
func TestVoiceSignalNamesTheDeviceThatClosedTheRing(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	f := setupChatFixtureOn(t, srv, "ringsess")
	voice := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/"
	lastRingClosed := func() map[string]string {
		t.Helper()
		var payload string
		if err := pool.QueryRow(context.Background(),
			`SELECT payload FROM outbox_events WHERE topic = 'chat.voice.ring_closed' ORDER BY id DESC LIMIT 1`).Scan(&payload); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	signal := func(token, room, action, callID string) {
		t.Helper()
		if res, out := doJSON(t, srv, "POST", voice+room+"/voice/"+action, token, map[string]any{"call_id": callID}); res.StatusCode != http.StatusOK {
			t.Fatalf("%s %s: %d %v", action, callID, res.StatusCode, out)
		}
	}
	session := tokenSession(t, f.tokens["b"])
	if session == "" {
		t.Fatal("the access token carries no session")
	}

	signal(f.tokens["a"], f.dmRoomID, "invite", "call-sess-answer")
	signal(f.tokens["b"], f.dmRoomID, "accept", "call-sess-answer")
	if p := lastRingClosed(); p["user_id"] != f.ids["b"] || p["reason"] != "answered" || p["session_id"] != session {
		t.Fatalf("answered ring_closed = %v, want reason answered from session %s", p, session)
	}
	signal(f.tokens["a"], f.dmRoomID, "hangup", "call-sess-answer")

	signal(f.tokens["a"], f.groupRoomID, "invite", "call-sess-decline")
	signal(f.tokens["b"], f.groupRoomID, "decline", "call-sess-decline")
	if p := lastRingClosed(); p["user_id"] != f.ids["b"] || p["reason"] != "declined" || p["session_id"] != session {
		t.Fatalf("declined ring_closed = %v, want reason declined from session %s", p, session)
	}
	signal(f.tokens["a"], f.groupRoomID, "hangup", "call-sess-decline")
	if p := lastRingClosed(); p["reason"] != "ended" || p["session_id"] != "" {
		t.Fatalf("the caller's hangup closed a ring as %v, want reason ended and no session", p)
	}
}
