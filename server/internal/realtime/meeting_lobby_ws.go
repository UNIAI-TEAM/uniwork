package realtime

import (
	"context"
	"log/slog"
	"net/http"

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
// Auth: uw_guest cookie on the upgrade, or first-frame JWT (same as workspace WS).
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
		tokenStr, errMsg, closed := firstMessageAuth(conn)
		if closed {
			return
		}
		if errMsg != "" {
			writeWSAuthErrorAndClose(conn, []byte(errMsg), "meeting_id", meetingID)
			return
		}
		uid, authErr := authenticateToken(tokenStr, parse)
		if authErr != "" {
			writeWSAuthErrorAndClose(conn, []byte(authErr), "meeting_id", meetingID)
			return
		}
		userID = uid
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
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		userID:      identity,
		workspaceID: "",
	}
	hub.subscribe(client, ScopeMeeting, meetingID)
	hub.register <- client

	go client.writePump()
	go client.readPump()
}
