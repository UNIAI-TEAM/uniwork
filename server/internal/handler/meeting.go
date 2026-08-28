package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func rfc3339(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

func toMeetingDTO(m db.Meeting) sdo.MeetingDTO {
	return sdo.MeetingDTO{
		ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Description: m.Description,
		StartsAt: rfc3339(m.StartsAt), EndsAt: rfc3339(m.EndsAt),
		RoomName: m.RoomName, CreatedBy: m.CreatedBy, Status: m.Status, MeetingType: m.MeetingType,
		HostUserID: m.HostUserID, Timezone: m.Timezone, AllowJoinRequest: m.AllowJoinRequest,
		ProjectID: m.ProjectID.String, ActualStartAt: rfc3339(m.ActualStartAt), ActualEndAt: rfc3339(m.ActualEndAt),
		Version: m.Version,
	}
}

func (h *handlers) listMeetings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	f := service.MeetingListFilter{
		Status: q.Get("status"), MeetingType: q.Get("meeting_type"), HostUserID: q.Get("host_user_id"),
		ProjectID: q.Get("project_id"), Q: q.Get("q"), Sort: q.Get("sort"), Limit: int32(limit), Offset: int32(offset),
	}
	if s := q.Get("from"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.From = &t
		}
	}
	if s := q.Get("to"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.To = &t
		}
	}
	ms, total, err := h.Meetings.ListFiltered(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), f)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MeetingDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMeetingDTO(m))
	}
	respondJSON(w, 200, map[string]any{"meetings": out, "total": total})
}

func (h *handlers) createMeeting(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMeetingSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.Create(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		service.CreateMeetingInput{
			Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt,
			Timezone: in.Timezone, AllowJoinRequest: in.AllowJoinRequest, ProjectID: in.ProjectID,
			AttendeeUserIDs: in.AttendeeUserIDs,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) createInstantMeeting(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateInstantMeetingSDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.CreateInstant(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), in.Title)
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
	var in sdi.PatchMeetingSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.UpdateMeetingInput{
			Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt,
			Timezone: in.Timezone, AllowJoinRequest: in.AllowJoinRequest, ProjectID: in.ProjectID,
		})
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

func (h *handlers) startMeeting(w http.ResponseWriter, r *http.Request) {
	m, err := h.Meetings.Start(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) endMeeting(w http.ResponseWriter, r *http.Request) {
	m, err := h.Meetings.End(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) cancelMeeting(w http.ResponseWriter, r *http.Request) {
	var in sdi.CancelMeetingSDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.Cancel(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Reason); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) transferHost(w http.ResponseWriter, r *http.Request) {
	var in sdi.HostTransferSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.TransferHost(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.NewHostUserID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
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
	var in sdi.CreateNoteSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	n, err := h.Meetings.AddNote(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Body)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"note": n})
}

func (h *handlers) meetingStatistics(w http.ResponseWriter, r *http.Request) {
	st, err := h.Meetings.Statistics(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, st)
}

func (h *handlers) meetingActivity(w http.ResponseWriter, r *http.Request) {
	items, err := h.Meetings.Activity(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), 50, 0)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ActivityItemDTO, 0, len(items))
	for _, a := range items {
		out = append(out, sdo.ActivityItemDTO{
			ID: a.ID, EventType: a.EventType, ActorID: a.ActorID,
			FromState: a.FromState.String, ToState: a.ToState.String, OccurredAt: rfc3339(a.OccurredAt),
		})
	}
	respondJSON(w, 200, map[string]any{"activity": out})
}
