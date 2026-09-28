package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Document favorites HTTP (G1-07, UNI-681; lane 07b). Favorites are the
// caller's bookmarks, so add/remove act on the authenticated person under a
// document they can read (view) - the service refuses an agent actor and
// never leaks a document the caller cannot see. Both writes are idempotent: a
// repeated add answers the live row, a remove of an absent favorite is a
// no-op, and the client invalidates from the answer either way.

// documentFavoriteDTO renders one favorite with the document metadata a
// favorites panel needs to open it (the row itself is only ids).
func documentFavoriteDTO(documentID, favoriteID, workspaceID, title, kind string, icon, parentID *string, favoritedAt time.Time) sdo.DocumentFavoriteDTO {
	return sdo.DocumentFavoriteDTO{
		DocumentID:  documentID,
		FavoriteID:  favoriteID,
		WorkspaceID: workspaceID,
		Title:       title,
		Kind:        kind,
		Icon:        icon,
		ParentID:    parentID,
		FavoritedAt: favoritedAt.UTC().Format(time.RFC3339),
	}
}

// favoriteDocument is POST /documents/{documentID}/favorite: idempotent add
// (view level, human actor only). The answer carries the live favorite row
// plus the document metadata, read back through the same gate the command
// ran under.
func (h *handlers) favoriteDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	fav, err := h.Documents.FavoriteDocument(r.Context(), actor, documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	view, err := h.Documents.GetDocument(r.Context(), actor, documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	doc := view.Document
	var icon, parentID *string
	if doc.Icon.Valid && doc.Icon.String != "" {
		icon = &doc.Icon.String
	}
	if doc.ParentID.Valid {
		parentID = &doc.ParentID.String
	}
	respondJSON(w, http.StatusOK, sdo.DocumentFavoriteSDO{Favorite: documentFavoriteDTO(
		doc.ID, fav.ID, doc.WorkspaceID, doc.Title, doc.Kind, icon, parentID, fav.CreatedAt.Time,
	)})
}

// unfavoriteDocument is DELETE /documents/{documentID}/favorite: idempotent
// remove; a favorite that is not there is still a success.
func (h *handlers) unfavoriteDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if err := h.Documents.UnfavoriteDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// listDocumentFavorites is GET /orgs/{orgID}/documents/favorites: the
// caller's favorites in one organization, each re-checked against live
// access, newest first. Not a member of the organization answers 404 - the
// same answer as an organization that does not exist.
func (h *handlers) listDocumentFavorites(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	rows, err := h.Documents.ListDocumentFavorites(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentFavoriteListSDO{Favorites: make([]sdo.DocumentFavoriteDTO, 0, len(rows))}
	for _, row := range rows {
		var icon, parentID *string
		if row.Document.Icon.Valid && row.Document.Icon.String != "" {
			icon = &row.Document.Icon.String
		}
		if row.Document.ParentID.Valid {
			parentID = &row.Document.ParentID.String
		}
		out.Favorites = append(out.Favorites, documentFavoriteDTO(
			row.Document.ID, row.FavoriteID, row.Document.WorkspaceID,
			row.Document.Title, row.Document.Kind, icon, parentID, row.FavoritedAt.Time,
		))
	}
	respondJSON(w, http.StatusOK, out)
}
