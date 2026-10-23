package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
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

// meetingFeedQuery reads sdi.MeetingFeedSDI; cursor checks are the service's.
func meetingFeedQuery(w http.ResponseWriter, r *http.Request) (service.FeedQuery, bool) {
	v := r.URL.Query()
	q := service.FeedQuery{Before: strings.TrimSpace(v.Get("before")), After: strings.TrimSpace(v.Get("after"))}
	if raw := strings.TrimSpace(v.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit phải là số nguyên dương")
			return service.FeedQuery{}, false
		}
		q.Limit = n
	}
	return q, true
}

func feedCursorsDTO[T any](p service.FeedPage[T]) sdo.MeetingFeedCursorsDTO {
	return sdo.MeetingFeedCursorsDTO{OlderCursor: p.OlderCursor, AfterCursor: p.AfterCursor, HasMoreAfter: p.HasMoreAfter}
}

func (h *handlers) listChatMessages(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	q, ok := meetingFeedQuery(w, r)
	if !ok {
		return
	}
	page, err := h.Meetings.ChatFeed(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"), q)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MeetingChatMessageDTO, 0, len(page.Items))
	for _, m := range page.Items {
		out = append(out, toMeetingChatMessageDTO(m))
	}
	respondJSON(w, 200, sdo.MeetingChatListSDO{Messages: out, MeetingFeedCursorsDTO: feedCursorsDTO(page)})
}
