package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

type stubPresenceSignaler struct {
	calls []struct {
		userID, workspaceID, state string
		visible                    bool
	}
	online []string
}

func (s *stubPresenceSignaler) SignalPresence(_ context.Context, userID, workspaceID, state string, visible bool) ([]string, error) {
	s.calls = append(s.calls, struct {
		userID, workspaceID, state string
		visible                    bool
	}{userID, workspaceID, state, visible})
	return s.online, nil
}

func TestHubPresenceBeatReturnsAck(t *testing.T) {
	hub := NewHub()
	hub.SetPresenceSignaler(&stubPresenceSignaler{online: []string{"u1", "u2"}})
	go hub.Run()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		HandleWebSocket(hub, alwaysMember{}, func(context.Context, string) (Identity, error) {
			return Identity{UserID: "me"}, nil
		}, nil, w, r)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/?workspace_id=ws1"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","payload":{"token":"tok"}}`)); err != nil {
		t.Fatalf("auth: %v", err)
	}
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("auth_ack: %v", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"presence.beat","payload":{"visible":true}}`)); err != nil {
		t.Fatalf("beat: %v", err)
	}
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ack: %v", err)
	}
	var ack struct {
		Type    string `json:"type"`
		Payload struct {
			OnlineUserIDs []string `json:"online_user_ids"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &ack); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if ack.Type != "presence.ack" {
		t.Fatalf("type = %q, want presence.ack", ack.Type)
	}
	if len(ack.Payload.OnlineUserIDs) != 2 {
		t.Fatalf("online_user_ids = %v", ack.Payload.OnlineUserIDs)
	}
}

type alwaysMember struct{}

func (alwaysMember) IsMember(context.Context, string, string) bool { return true }
