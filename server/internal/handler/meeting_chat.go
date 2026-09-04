package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toChatMessageDTO(m db.MeetingChatMessage) sdo.ChatMessageDTO {
	return sdo.ChatMessageDTO{
		ID: m.ID, MeetingID: m.MeetingID, ParticipantID: m.ParticipantID.String,
		SenderIdentity: m.SenderIdentity, SenderName: m.SenderName, Message: m.Message,
		SentAt: rfc3339(m.SentAt),
	}
}

func (h *handlers) appendChatMessage(w http.ResponseWriter, r *http.Request) {
	var in sdi.AppendChatSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	msg, err := h.Meetings.AppendChatMessage(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Message)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ChatMessageSDO{Message: toChatMessageDTO(msg)})
}

func (h *handlers) listChatMessages(w http.ResponseWriter, r *http.Request) {
	msgs, err := h.Meetings.ChatMessages(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatMessageDTO, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, toChatMessageDTO(m))
	}
	respondJSON(w, 200, sdo.ChatListSDO{Messages: out})
}
