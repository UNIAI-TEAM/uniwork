package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) listChatRoomLinkPreviews(w http.ResponseWriter, r *http.Request) {
	var ids []string
	if raw := r.URL.Query().Get("message_ids"); raw != "" {
		ids = strings.Split(raw, ",")
	}
	rows, err := h.Chat.ListRoomLinkPreviews(
		r.Context(),
		middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "roomID"),
		ids,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ChatLinkPreviewDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, sdo.ChatLinkPreviewDTO{
			MessageID: p.MessageID, URL: p.URL, Title: p.Title, Description: p.Description, SiteName: p.SiteName,
			ImageURL: p.ImageURL, ImageURLExpiresAt: formatURLExpiry(p.ImageURLExpiresAt),
		})
	}
	respondJSON(w, http.StatusOK, sdo.ChatLinkPreviewListSDO{Previews: out})
}
