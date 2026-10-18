package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) ackChatDelivered(w http.ResponseWriter, r *http.Request) {
	var in sdi.AckChatDeliveredSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	acks := make([]service.ChatDeliveredAck, 0, len(in.Rooms))
	for _, room := range in.Rooms {
		upTo, err := time.Parse(time.RFC3339Nano, room.UpTo)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "up_to phải là thời điểm RFC 3339")
			return
		}
		acks = append(acks, service.ChatDeliveredAck{RoomID: room.RoomID, UpTo: upTo})
	}
	if err := h.Chat.AckChatDelivered(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), acks); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
