package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) mintChatVoiceToken(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.LiveKitAPIKey == "" || h.Cfg.LiveKitAPISecret == "" || h.Cfg.LiveKitURL == "" {
		respondError(w, http.StatusServiceUnavailable, "livekit_not_configured",
			"LiveKit chưa được cấu hình trên server")
		return
	}
	var in sdi.MintChatVoiceTokenSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	matrixRoomID := strings.TrimSpace(in.MatrixRoomID)
	if matrixRoomID == "" || !strings.HasPrefix(matrixRoomID, "!") {
		respondError(w, http.StatusBadRequest, "invalid_request", "matrix_room_id is required")
		return
	}
	userID := middleware.UserID(r.Context())
	u, err := h.Auth.Me(r.Context(), userID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	liveKitRoom := meetings.LiveKitRoomFromMatrixID(matrixRoomID)
	tok, err := meetings.MintToken(
		h.Cfg.LiveKitAPIKey,
		h.Cfg.LiveKitAPISecret,
		liveKitRoom,
		u.ID,
		u.DisplayName,
		2*time.Hour,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MeetingTokenSDO{Token: tok, URL: h.Cfg.LiveKitURL})
}
