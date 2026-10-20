package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) listChatCallLogs(w http.ResponseWriter, r *http.Request) {
	// A limit that does not parse falls back to the default, as the thread list does.
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	page, err := h.Chat.ListCallLogs(
		r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		strings.TrimSpace(r.URL.Query().Get("cursor")), limit,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.ChatCallLogListSDO{CallLogs: make([]sdo.ChatCallLogDTO, 0, len(page.Logs))}
	for _, l := range page.Logs {
		out.CallLogs = append(out.CallLogs, toChatCallLogDTO(l))
	}
	if page.NextCursor != "" {
		out.NextCursor = &page.NextCursor
	}
	respondJSON(w, http.StatusOK, out)
}

// toChatCallLogDTO: the log's sender is its caller (finalizeVoiceCall writes
// it under the caller's id), so the caller's name is the sender's.
func toChatCallLogDTO(l service.ChatCallLog) sdo.ChatCallLogDTO {
	ended := l.CreatedAt.UTC()
	out := sdo.ChatCallLogDTO{
		MessageID: l.MessageID, RoomID: l.RoomID, RoomKind: l.RoomKind, RoomName: l.RoomName,
		PeerUserID: l.PeerUserID, CallerID: l.SenderID, CallerName: l.SenderName,
		StartedAt: ended.Format(time.RFC3339), EndedAt: ended.Format(time.RFC3339),
		Participants: []sdo.VoiceCallParticipantDTO{},
	}
	if c := l.Call; c != nil {
		out.CallID, out.Outcome, out.Video, out.DurationSeconds = c.CallID, c.Outcome, c.Video, c.DurationSeconds
		out.StartedAt = ended.Add(-time.Duration(c.DurationSeconds) * time.Second).Format(time.RFC3339)
		for _, p := range c.Participants {
			out.Participants = append(out.Participants, sdo.VoiceCallParticipantDTO{UserID: p.UserID, DisplayName: p.DisplayName})
		}
	}
	return out
}
