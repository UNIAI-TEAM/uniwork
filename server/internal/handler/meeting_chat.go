package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toMeetingChatMessageDTO(m db.MeetingChatMessage) sdo.MeetingChatMessageDTO {
	return sdo.MeetingChatMessageDTO{
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
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	msg, err := h.Meetings.AppendChatMessage(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"), in.Message)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingChatMessageSDO{Message: toMeetingChatMessageDTO(msg)})
}

func (h *handlers) listChatMessages(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	msgs, err := h.Meetings.ChatMessages(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MeetingChatMessageDTO, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, toMeetingChatMessageDTO(m))
	}
	respondJSON(w, 200, sdo.MeetingChatListSDO{Messages: out})
}
