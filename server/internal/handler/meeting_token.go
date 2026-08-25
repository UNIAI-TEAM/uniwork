package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) meetingToken(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.LiveKitAPIKey == "" || h.Cfg.LiveKitAPISecret == "" || h.Cfg.LiveKitURL == "" {
		respondError(w, http.StatusServiceUnavailable, "livekit_not_configured",
			"LiveKit chưa được cấu hình trên server")
		return
	}
	userID := middleware.UserID(r.Context())
	m, err := h.Meetings.Get(r.Context(), userID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	u, err := h.Auth.Me(r.Context(), userID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tok, err := meetings.MintToken(h.Cfg.LiveKitAPIKey, h.Cfg.LiveKitAPISecret,
		m.RoomName, u.ID, u.DisplayName, 6*time.Hour)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"token": tok, "url": h.Cfg.LiveKitURL})
}
