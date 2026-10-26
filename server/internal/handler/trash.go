package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) listTrash(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, err := h.Trash.List(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"),
		service.ListTrashInput{
			Kind:   service.TrashKind(strings.TrimSpace(q.Get("kind"))),
			Filter: service.TrashFilter{Query: q.Get("q"), TrashedBy: strings.TrimSpace(q.Get("trashed_by"))},
			Cursor: strings.TrimSpace(q.Get("cursor")),
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.TrashItemDTO, 0, len(page.Items))
	for _, it := range page.Items {
		path := it.LocationPath
		if path == nil {
			path = []string{}
		}
		items = append(items, sdo.TrashItemDTO{
			Kind: string(it.Kind), ID: it.ID, Title: it.Title, Identifier: it.Identifier, SubKind: it.SubKind,
			Count: it.Count, LocationTitle: it.LocationTitle, LocationPath: path, TrashedBy: it.TrashedBy,
			TrashedAt: it.TrashedAt.UTC().Format(time.RFC3339), PurgeAfter: it.PurgeAfter.UTC().Format(time.RFC3339),
			CanManage: it.CanManage,
		})
	}
	respondJSON(w, 200, sdo.TrashPageSDO{Items: items, NextCursor: page.NextCursor})
}
