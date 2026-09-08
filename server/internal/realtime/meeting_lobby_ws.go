package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// MeetingLobbyChecker validates that a client may listen for lobby events on
// a meeting (guest cookie or authenticated user; meeting must be joinable).
type MeetingLobbyChecker interface {
	AllowLobbyListen(ctx context.Context, meetingID, userID, guestID string) (bool, error)
}

// HandleMeetingLobbyWebSocket upgrades a public lobby socket scoped to one
// meeting. Clients auto-subscribe to ScopeMeeting and receive admission events
// only — no workspace membership required.
//
// GET /api/v1/meetings/{meetingID}/lobby-ws
//
// Auth: uw_guest cookie on the upgrade, or first-frame JWT / guest_session.
func HandleMeetingLobbyWebSocket(
	hub *Hub,
	checker MeetingLobbyChecker,
	parse TokenParser,
	guestKey []byte,
	meetingID string,
	w http.ResponseWriter,
	r *http.Request,
) {
	if meetingID == "" {
		http.Error(w, `{"error":"meeting_id required"}`, http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("meeting lobby websocket upgrade failed", "error", err, "meeting_id", meetingID)
		return
	}
	conn.SetReadLimit(inboundReadLimit)

	guestID := meetings.GuestIDFromRequest(r, guestKey)
	userID := ""

	if guestID == "" {
		var errMsg string
		var closed bool
		userID, guestID, errMsg, closed = firstMessageLobbyAuth(conn, guestKey, parse)
		if closed {
			return
		}
		if errMsg != "" {
			writeWSAuthErrorAndClose(conn, []byte(errMsg), "meeting_id", meetingID)
			return
		}
	}

	if userID == "" && guestID == "" {
		writeWSAuthErrorAndClose(
			conn,
			[]byte(`{"error":"authentication required"}`),
			"meeting_id", meetingID,
		)
		return
	}

	ok, err := checker.AllowLobbyListen(r.Context(), meetingID, userID, guestID)
	if err != nil {
		writeWSAuthErrorAndClose(
			conn,
			[]byte(`{"error":"lookup_failed"}`),
			"meeting_id", meetingID,
		)
		return
	}
	if !ok {
		writeWSAuthErrorAndClose(
			conn,
			[]byte(`{"error":"meeting not available"}`),
			"meeting_id", meetingID,
		)
		return
	}

	if !writeWSAuthFrame(
		conn,
		[]byte(`{"type":"auth_ack"}`),
		"auth_ack",
		"meeting_id", meetingID,
		"user_id", userID,
		"guest_id", guestID,
	) {
		conn.Close()
		return
	}

	identity := userID
	if identity == "" {
		identity = "guest:" + guestID
	}
	slog.Info("meeting lobby websocket connected",
		"meeting_id", meetingID,
		"identity", identity,
		"client_platform", r.URL.Query().Get("client_platform"),
	)

	client := &Client{
		hub:            hub,
		conn:           conn,
		send:           make(chan []byte, 256),
		userID:         identity,
		workspaceID:    "",
		lobbyMeetingID: meetingID,
	}
	hub.register <- client

	go client.writePump()
	go client.readPump()
}

// firstMessageLobbyAuth reads the first WebSocket frame for a lobby client
// without a uw_guest cookie. Accepts a signed guest_session or a JWT token.
func firstMessageLobbyAuth(
	conn *websocket.Conn,
	guestKey []byte,
	parse TokenParser,
) (userID, guestID, errMsg string, closed bool) {
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	defer conn.SetReadDeadline(time.Time{})

	_, raw, err := conn.ReadMessage()
	if err != nil {
		if errors.Is(err, websocket.ErrReadLimit) {
			M.InboundTooLargeTotal.Add(1)
			slog.Warn("ws: pre-auth frame exceeded read limit", "limit_bytes", inboundReadLimit)
			conn.Close()
			return "", "", "", true
		}
		return "", "", `{"error":"auth timeout or read error"}`, false
	}

	var msg struct {
		Type    string `json:"type"`
		Payload struct {
			Token        string `json:"token"`
			GuestSession string `json:"guest_session"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Type != "auth" {
		return "", "", `{"error":"expected auth message as first frame"}`, false
	}

	if gs := msg.Payload.GuestSession; gs != "" {
		if len(guestKey) == 0 {
			return "", "", `{"error":"guest session unavailable"}`, false
		}
		if id, ok := meetings.VerifyGuestCookie(gs, guestKey); ok && id != "" {
			return "", id, "", false
		}
		return "", "", `{"error":"invalid guest session"}`, false
	}

	if token := msg.Payload.Token; token != "" {
		uid, authErr := authenticateToken(token, parse)
		if authErr != "" {
			return "", "", authErr, false
		}
		return uid, "", "", false
	}

	return "", "", `{"error":"expected auth message as first frame"}`, false
}
