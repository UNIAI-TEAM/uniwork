package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// getChatSync is GET /workspaces/{workspaceID}/chat/sync (ADR 0039 draft): the
// chat changes after `since`, each with the message as the caller reads it now.
func (h *handlers) getChatSync(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("since"))
	var since int64
	if raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			h.mapServiceError(w, service.Invalid("since phải là số nguyên không âm"))
			return
		}
		since = n
	}
	page, err := h.Chat.SyncChatChanges(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), since, raw != "")
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toChatSyncSDO(page))
}

func toChatSyncSDO(page service.ChatSyncPage) sdo.ChatSyncSDO {
	out := sdo.ChatSyncSDO{Head: page.Head, Reset: page.Reset, More: page.More, Changes: make([]sdo.ChatSyncChangeDTO, 0, len(page.Changes))}
	for _, c := range page.Changes {
		change := sdo.ChatSyncChangeDTO{Seq: c.Seq, RoomID: c.RoomID, MessageID: c.MessageID, Kind: c.Kind}
		if c.Message != nil {
			dto := toChatMessageDTO(*c.Message)
			change.Message = &dto
		}
		out.Changes = append(out.Changes, change)
	}
	return out
}
