package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type meetingDTO struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	StartsAt    string `json:"starts_at"`
	EndsAt      string `json:"ends_at"`
	RoomName    string `json:"room_name"`
	CreatedBy   string `json:"created_by"`
}

func toMeetingDTO(m db.Meeting) meetingDTO {
	return meetingDTO{
		ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Description: m.Description,
		StartsAt: m.StartsAt.Time.Format(time.RFC3339), EndsAt: m.EndsAt.Time.Format(time.RFC3339),
		RoomName: m.RoomName, CreatedBy: m.CreatedBy,
	}
}

func (h *handlers) listMeetings(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Meetings.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]meetingDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMeetingDTO(m))
	}
	respondJSON(w, 200, map[string]any{"meetings": out})
}

func (h *handlers) createMeeting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       string    `json:"title"`
		Description string    `json:"description"`
		StartsAt    time.Time `json:"starts_at"`
		EndsAt      time.Time `json:"ends_at"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	m, err := h.Meetings.Create(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		service.CreateMeetingInput{Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) getMeeting(w http.ResponseWriter, r *http.Request) {
	m, err := h.Meetings.Get(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) updateMeeting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       *string    `json:"title"`
		Description *string    `json:"description"`
		StartsAt    *time.Time `json:"starts_at"`
		EndsAt      *time.Time `json:"ends_at"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	m, err := h.Meetings.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.UpdateMeetingInput{Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) deleteMeeting(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.Delete(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listNotes(w http.ResponseWriter, r *http.Request) {
	ns, err := h.Meetings.Notes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"notes": ns})
}

func (h *handlers) createNote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	n, err := h.Meetings.AddNote(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Body)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"note": n})
}
