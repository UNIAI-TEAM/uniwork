package handler

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) listCalendarConnections(w http.ResponseWriter, r *http.Request) {
	rows, err := h.CalendarConnections.List(r.Context(), chi.URLParam(r, "workspaceID"), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.CalendarConnectionListSDO{Connections: make([]sdo.CalendarConnectionSDO, 0, len(rows))}
	for _, row := range rows {
		out.Connections = append(out.Connections, sdo.CalendarConnectionSDO{Provider: row.Provider, Email: row.Email, SelectedCalendarIDs: row.SelectedCalendarIDs})
	}
	respondJSON(w, http.StatusOK, out)
}
func (h *handlers) startCalendarConnection(w http.ResponseWriter, r *http.Request) {
	u, err := h.CalendarConnections.Start(r.Context(), chi.URLParam(r, "workspaceID"), middleware.UserID(r.Context()), chi.URLParam(r, "provider"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.CalendarOAuthStartSDO{AuthorizationURL: u})
}
func (h *handlers) completeCalendarConnection(w http.ResponseWriter, r *http.Request) {
	if providerError := r.URL.Query().Get("error"); providerError != "" {
		respondError(w, http.StatusBadRequest, "calendar_authorization_denied", "Calendar authorization was not completed")
		return
	}
	_, err := h.CalendarConnections.Complete(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "provider"), r.URL.Query().Get("state"), r.URL.Query().Get("code"))
	if err != nil {
		h.Log.Warn("calendar oauth callback failed", "provider", chi.URLParam(r, "provider"), "err", err)
		h.mapServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><html><body><script>window.close()</script></body></html>`)
}
func (h *handlers) listExternalCalendars(w http.ResponseWriter, r *http.Request) {
	rows, err := h.CalendarConnections.Calendars(r.Context(), chi.URLParam(r, "workspaceID"), middleware.UserID(r.Context()), chi.URLParam(r, "provider"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.ExternalCalendarListSDO{Calendars: make([]sdo.ExternalCalendarSDO, 0, len(rows))}
	for _, v := range rows {
		out.Calendars = append(out.Calendars, sdo.ExternalCalendarSDO{ID: v.ID, Name: v.Name, Color: v.Color, Primary: v.Primary, Selected: v.Selected, ReadOnly: v.ReadOnly})
	}
	respondJSON(w, http.StatusOK, out)
}
func (h *handlers) selectExternalCalendars(w http.ResponseWriter, r *http.Request) {
	var in sdi.CalendarSelectionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.CalendarConnections.Select(r.Context(), chi.URLParam(r, "workspaceID"), middleware.UserID(r.Context()), chi.URLParam(r, "provider"), in.CalendarIDs); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *handlers) disconnectCalendarConnection(w http.ResponseWriter, r *http.Request) {
	if err := h.CalendarConnections.Disconnect(r.Context(), chi.URLParam(r, "workspaceID"), middleware.UserID(r.Context()), chi.URLParam(r, "provider")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
