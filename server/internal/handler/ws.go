package handler

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/unicomhub/uniwork/server/internal/realtime"
)

var upgrader = websocket.Upgrader{
	// CORS đã chặn ở tầng HTTP; origin FE cho phép qua config
	CheckOrigin: func(r *http.Request) bool { return true },
}

// GET /api/v1/ws?workspace=...&token=...
// Token qua query vì browser WebSocket không gửi được Authorization header.
func (h *handlers) ws(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	workspaceID := r.URL.Query().Get("workspace")
	uid, err := h.Minter.Parse(token)
	if err != nil {
		respondError(w, 401, "unauthorized", "invalid token")
		return
	}
	if _, err := h.Workspaces.RequireMember(r.Context(), workspaceID, uid); err != nil {
		respondError(w, 403, "forbidden", "not a member")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	send := make(chan []byte, 32)
	client := realtime.NewClient(send)
	h.Hub.Add(workspaceID, client)
	defer func() {
		h.Hub.Remove(workspaceID, client)
		conn.Close()
	}()

	// reader: chỉ để phát hiện close
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				conn.Close()
				return
			}
		}
	}()

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case msg, ok := <-send:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
