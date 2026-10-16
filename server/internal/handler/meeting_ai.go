package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toTranscriptDTO(s db.MeetingTranscriptSegment) sdo.TranscriptSegmentDTO {
	return sdo.TranscriptSegmentDTO{
		ID: s.ID, MeetingID: s.MeetingID, ParticipantID: s.ParticipantID.String,
		SpeakerName: s.SpeakerName, Text: s.Text, SpokenAt: rfc3339(s.SpokenAt),
	}
}

func toSummaryDTO(v service.MeetingSummaryView) sdo.MeetingSummaryDTO {
	s := v.Summary
	d := sdo.MeetingSummaryDTO{
		ID: s.ID, MeetingID: s.MeetingID, Summary: s.Summary, Model: s.Model,
		CreatedBy: s.CreatedBy, CreatedAt: rfc3339(s.CreatedAt),
		Decisions: []string{}, ActionItems: make([]sdo.MeetingSummaryActionItemDTO, 0, len(v.Items)),
	}
	_ = json.Unmarshal([]byte(s.Decisions), &d.Decisions)
	if d.Decisions == nil {
		d.Decisions = []string{}
	}
	for _, it := range v.Items {
		d.ActionItems = append(d.ActionItems, sdo.MeetingSummaryActionItemDTO{
			Index: it.Index, Title: it.Title, Owner: it.Owner, Due: it.Due,
			SuggestedAssigneeID: it.SuggestedAssigneeID, DueDate: it.DueDate, TaskID: it.TaskID,
		})
	}
	return d
}

func toRecordingDTO(r db.MeetingRecording, redactHostFields bool) sdo.RecordingDTO {
	d := sdo.RecordingDTO{
		ID: r.ID, MeetingID: r.MeetingID, Status: r.Status, FileURL: r.FileUrl.String,
		StartedBy: r.StartedBy, StartedAt: rfc3339(r.StartedAt), EndedAt: rfc3339(r.EndedAt),
	}
	if redactHostFields {
		d.StartedBy = ""
	}
	return d
}

func (h *handlers) meetingCapabilities(w http.ResponseWriter, r *http.Request) {
	caps, err := h.Meetings.Capabilities(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingCapabilitiesSDO{
		AISummary: caps.AISummary, Recording: caps.Recording, ServerSTT: caps.ServerSTT,
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

const meetingSTTAgentSecretHeader = "X-Meeting-Agent-Secret"

func (h *handlers) appendAgentTranscript(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(r.Header.Get(meetingSTTAgentSecretHeader))
	if secret == "" || !h.Meetings.STTAgentEnabled() || secret != h.Cfg.MeetingSTTAgentSecret {
		respondError(w, http.StatusUnauthorized, "unauthorized", "agent secret không hợp lệ")
		return
	}
	var in sdi.AppendAgentTranscriptSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	seg, err := h.Meetings.AppendTranscriptFromAgent(r.Context(), chi.URLParam(r, "meetingID"),
		strings.TrimSpace(in.ParticipantIdentity), strings.TrimSpace(in.SpeakerName), in.Text, in.SpokenAt)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TranscriptSegmentSDO{Segment: toTranscriptDTO(seg)})
}

func (h *handlers) listTranscript(w http.ResponseWriter, r *http.Request) {
	q, ok := meetingFeedQuery(w, r)
	if !ok {
		return
	}
	page, err := h.Meetings.Transcript(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), q)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TranscriptSegmentDTO, 0, len(page.Items))
	for _, s := range page.Items {
		out = append(out, toTranscriptDTO(s))
	}
	respondJSON(w, 200, sdo.TranscriptListSDO{Segments: out, MeetingFeedCursorsDTO: feedCursorsDTO(page)})
}

func (h *handlers) getMeetingSummary(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.SummaryView(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MeetingSummarySDO{}
	if v != nil {
		dto := toSummaryDTO(*v)
		out.Summary = &dto
	}
	respondJSON(w, 200, out)
}

// summaryLocale maps the requested output language onto the closed set the
// prompt knows; anything else, an empty body included, is Vietnamese.
func summaryLocale(raw string) string {
	if strings.EqualFold(strings.TrimSpace(raw), "en") {
		return "en"
	}
	return "vi"
}

func (h *handlers) createSummary(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateSummarySDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID := middleware.UserID(r.Context())
	s, err := h.Meetings.Summarize(r.Context(), userID, chi.URLParam(r, "meetingID"), summaryLocale(in.Locale))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	v, err := h.Meetings.SummaryViewOf(r.Context(), userID, s)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	dto := toSummaryDTO(v)
	respondJSON(w, 200, sdo.MeetingSummarySDO{Summary: &dto})
}

// blankAsNil reads "" like null: both mean "none" for an assignee or a due date.
func blankAsNil(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	v := strings.TrimSpace(*s)
	return &v
}

func (h *handlers) createSummaryTasks(w http.ResponseWriter, r *http.Request) {
	var in sdi.SummaryTasksSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items := make([]service.MeetingSummaryTaskItem, 0, len(in.Items))
	for _, it := range in.Items {
		// A missing index reaches the service as -1, which it refuses once it
		// has authorized the caller.
		index := -1
		if it.Index != nil {
			index = *it.Index
		}
		items = append(items, service.MeetingSummaryTaskItem{
			Index: index, Title: it.Title, Description: it.Description,
			AssigneeID: blankAsNil(it.AssigneeID), DueDate: blankAsNil(it.DueDate),
			ProjectID: it.ProjectID, Priority: it.Priority,
		})
	}
	res, err := h.Meetings.CreateTasksFromSummary(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.SummaryTasksInput{SummaryID: in.SummaryID, Items: items})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MeetingSummaryTasksSDO{
		TaskIDs: make([]string, 0, len(res.Links)), Items: make([]sdo.SummaryTaskLinkDTO, 0, len(res.Links)),
	}
	for _, l := range res.Links {
		out.TaskIDs = append(out.TaskIDs, l.TaskID)
		out.Items = append(out.Items, sdo.SummaryTaskLinkDTO{Index: l.Index, TaskID: l.TaskID})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) startRecording(w http.ResponseWriter, r *http.Request) {
	rec, err := h.Meetings.StartRecording(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.RecordingSDO{Recording: toRecordingDTO(rec, false)})
}

func (h *handlers) stopRecording(w http.ResponseWriter, r *http.Request) {
	rec, err := h.Meetings.StopRecording(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.RecordingSDO{Recording: toRecordingDTO(rec, false)})
}

func (h *handlers) listRecordings(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	recs, err := h.Meetings.Recordings(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.RecordingDTO, 0, len(recs))
	for _, rec := range recs {
		// Guests see a recording only once it has a file: legacy rows carry
		// file_url when the egress finished; FS rows carry file_id but the
		// object exists only once the row reached COMPLETE (UNI-746).
		if guestID != "" && !rec.FileUrl.Valid &&
			!(rec.Status == service.RecordingComplete && strings.TrimSpace(rec.FileID.String) != "") {
			continue
		}
		out = append(out, toRecordingDTO(rec, guestID != ""))
	}
	respondJSON(w, 200, sdo.RecordingListSDO{Recordings: out})
}

func (h *handlers) getMeetingRecordingPlaybackURL(w http.ResponseWriter, r *http.Request) {
	presigner, presignOK := h.Storage.(storage.DownloadPresigner)
	if !presignOK && !h.Meetings.FileServiceEnabled() {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	meetingID := chi.URLParam(r, "meetingID")
	rec, err := h.Meetings.GetMeetingRecordingForPlayback(
		r.Context(), userID, guestID, meetingID, chi.URLParam(r, "recordingID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if h.Meetings.FileServiceEnabled() && strings.TrimSpace(rec.FileID.String) != "" {
		target, err := h.Meetings.ResolveMeetingRecordingPlaybackURL(
			r.Context(), userID, guestID, meetingID, rec.ID,
		)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, sdo.MeetingRecordingPlaybackSDO{
			PlaybackURL: target.URL,
			ExpiresAt:   target.ExpiresAt.Format(time.RFC3339),
		})
		return
	}
	if !presignOK {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	key := h.Storage.KeyFromURL(rec.FileUrl.String)
	if key == "" {
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	playbackURL, expiresAt, err := presignRecordingPlaybackURL(r.Context(), presigner, key)
	if err != nil {
		h.Log.Error("meeting recording presign", "err", err, "recording_id", rec.ID)
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	respondJSON(w, http.StatusOK, sdo.MeetingRecordingPlaybackSDO{
		PlaybackURL: playbackURL,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
	})
}

func (h *handlers) streamMeetingRecording(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	meetingID := chi.URLParam(r, "meetingID")
	rec, err := h.Meetings.GetMeetingRecordingForPlayback(
		r.Context(), userID, guestID, meetingID, chi.URLParam(r, "recordingID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if h.Meetings.FileServiceEnabled() && strings.TrimSpace(rec.FileID.String) != "" {
		h.streamMeetingRecordingFile(w, r, userID, guestID, meetingID, rec.ID)
		return
	}
	key := h.Storage.KeyFromURL(rec.FileUrl.String)
	if key == "" {
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	h.streamRecordingObject(w, r, key, rec.ID)
}

// streamMeetingRecordingFile serves an FS-backed meeting recording: the
// service authorizes and sizes the file, this route does the Range math, and
// Open carries the byte window (UNI-746).
func (h *handlers) streamMeetingRecordingFile(w http.ResponseWriter, r *http.Request, userID, guestID, meetingID, recordingID string) {
	size, err := h.Meetings.MeetingRecordingFileSize(r.Context(), userID, guestID, meetingID, recordingID)
	if err != nil {
		h.Log.Error("recording head", "err", err, "recording_id", recordingID)
		h.mapServiceError(w, err)
		return
	}
	h.streamRecordingRange(w, r, size, recordingID, func(offset, length int64) (io.ReadCloser, error) {
		return h.Meetings.OpenMeetingRecording(r.Context(), userID, guestID, meetingID, recordingID, offset, length)
	})
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
