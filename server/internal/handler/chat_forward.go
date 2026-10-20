package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) forwardChatMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.ForwardChatMessageSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	rows, err := h.Chat.ForwardChatMessage(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "messageID"),
		service.ForwardChatMessageInput{TargetRoomIDs: in.TargetRoomIDs, Comment: in.Comment},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatForwardedMessageDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, sdo.ChatForwardedMessageDTO{RoomID: row.RoomID, MessageID: row.MessageID})
	}
	respondJSON(w, http.StatusCreated, sdo.ForwardChatMessageSDO{Messages: out})
}
