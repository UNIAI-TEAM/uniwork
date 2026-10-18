package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) transcribeChatVoiceMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out, err := h.Chat.TranscribeVoiceMessage(ctx, middleware.UserID(ctx), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "messageID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.ChatVoiceTranscriptSDO{Text: out.Text, Language: out.Language})
}
