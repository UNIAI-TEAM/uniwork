package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toTranscriptDTO(s db.MeetingTranscriptSegment) sdo.TranscriptSegmentDTO {
	return sdo.TranscriptSegmentDTO{
		ID: s.ID, MeetingID: s.MeetingID, ParticipantID: s.ParticipantID.String,
		SpeakerName: s.SpeakerName, Text: s.Text, SpokenAt: rfc3339(s.SpokenAt),
	}
}

func toSummaryDTO(s db.MeetingSummary) sdo.MeetingSummaryDTO {
	d := sdo.MeetingSummaryDTO{
		ID: s.ID, MeetingID: s.MeetingID, Summary: s.Summary, Model: s.Model,
		CreatedBy: s.CreatedBy, CreatedAt: rfc3339(s.CreatedAt),
		Decisions: []string{}, ActionItems: []sdo.SummaryActionItemDTO{},
	}
	_ = json.Unmarshal([]byte(s.Decisions), &d.Decisions)
	_ = json.Unmarshal([]byte(s.ActionItems), &d.ActionItems)
	return d
}

func toRecordingDTO(r db.MeetingRecording) sdo.RecordingDTO {
	return sdo.RecordingDTO{
		ID: r.ID, MeetingID: r.MeetingID, Status: r.Status, FileURL: r.FileUrl.String,
		StartedBy: r.StartedBy, StartedAt: rfc3339(r.StartedAt), EndedAt: rfc3339(r.EndedAt),
	}
}

func (h *handlers) meetingCapabilities(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, 200, sdo.MeetingCapabilitiesSDO{
		AISummary: h.Meetings.AIEnabled(), Recording: h.Meetings.RecordingEnabled(r.Context()),
	})
}

func (h *handlers) appendTranscript(w http.ResponseWriter, r *http.Request) {
	var in sdi.AppendTranscriptSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	seg, err := h.Meetings.AppendTranscript(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Text, in.SpokenAt)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TranscriptSegmentSDO{Segment: toTranscriptDTO(seg)})
}

func (h *handlers) listTranscript(w http.ResponseWriter, r *http.Request) {
	segs, err := h.Meetings.Transcript(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TranscriptSegmentDTO, 0, len(segs))
	for _, s := range segs {
		out = append(out, toTranscriptDTO(s))
	}
	respondJSON(w, 200, sdo.TranscriptListSDO{Segments: out})
}

func (h *handlers) getMeetingSummary(w http.ResponseWriter, r *http.Request) {
	s, err := h.Meetings.Summary(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingSummarySDO{Summary: toSummaryDTO(s)})
}

func (h *handlers) createSummary(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateSummarySDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	locale := strings.ToLower(strings.TrimSpace(in.Locale))
	if locale == "" {
		locale = "vi"
	}
	s, err := h.Meetings.Summarize(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), locale)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingSummarySDO{Summary: toSummaryDTO(s)})
}

func (h *handlers) createSummaryTasks(w http.ResponseWriter, r *http.Request) {
	var in sdi.SummaryTasksSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items := make([]service.SummaryTaskItem, 0, len(in.Items))
	for _, it := range in.Items {
		items = append(items, service.SummaryTaskItem{Title: it.Title, Description: it.Description, AssigneeID: it.AssigneeID, DueDate: it.DueDate})
	}
	tasks, err := h.Meetings.CreateTasksFromSummary(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), items)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	ids := make([]string, 0, len(tasks))
	for _, t := range tasks {
		ids = append(ids, t.ID)
	}
	respondJSON(w, 200, sdo.TaskIDListSDO{TaskIDs: ids})
}

func (h *handlers) startRecording(w http.ResponseWriter, r *http.Request) {
	rec, err := h.Meetings.StartRecording(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.RecordingSDO{Recording: toRecordingDTO(rec)})
}

func (h *handlers) stopRecording(w http.ResponseWriter, r *http.Request) {
	rec, err := h.Meetings.StopRecording(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.RecordingSDO{Recording: toRecordingDTO(rec)})
}

func (h *handlers) listRecordings(w http.ResponseWriter, r *http.Request) {
	recs, err := h.Meetings.Recordings(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.RecordingDTO, 0, len(recs))
	for _, rec := range recs {
		out = append(out, toRecordingDTO(rec))
	}
	respondJSON(w, 200, sdo.RecordingListSDO{Recordings: out})
}

func (h *handlers) meetingCalendar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "meetingID")
	ics, err := h.Meetings.CalendarICS(r.Context(), middleware.UserID(r.Context()), id, h.Cfg.FrontendOrigin)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="meeting-`+id+`.ics"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ics)
}
