package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Meetings held without a room (UNI-2001, parent spec §6.4): recording the
// meeting as held, the recording's upload session, and its transcriptions.

func (h *handlers) recordMeetingHeld(w http.ResponseWriter, r *http.Request) {
	var in sdi.RecordMeetingHeldSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	userID, meetingID := middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")
	var m db.Meeting
	var err error
	if in.DurationSeconds > 0 && in.StartedAt == "" && in.EndedAt == "" {
		m, err = h.Meetings.RecordHeldNow(r.Context(), userID, meetingID, time.Duration(in.DurationSeconds)*time.Second,
			time.Duration(in.EndedSecondsAgo)*time.Second)
	} else {
		// An unreadable time stays zero: the service refuses it (422) only after
		// it has authorized the caller, so a stranger learns nothing either way.
		started, _ := time.Parse(time.RFC3339, in.StartedAt)
		ended, _ := time.Parse(time.RFC3339, in.EndedAt)
		m, err = h.Meetings.RecordHeld(r.Context(), userID, meetingID, started, ended)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingSDO{Meeting: toMeetingDTO(m)})
}

// createMeetingAudioUploadSession opens the shared large-upload session for
// a meeting recording; GET, complete and DELETE are the shared
// /upload-sessions/{sessionID} routes, and complete answers the staged
// upload_id the transcription request claims.
func (h *handlers) createMeetingAudioUploadSession(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMeetingAudioUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	view, err := h.Meetings.OpenAudioUploadSession(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.OpenUploadSessionInput{
			Filename: in.Filename, SizeBytes: in.SizeBytes, IdempotencyKey: r.Header.Get("Idempotency-Key"),
			Probe: service.UploadSessionProbeInput{HeadB64: in.Probe.HeadB64},
		}, in.DurationSeconds)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, uploadSessionOpenStatus(view), uploadSessionSDO(view, false))
}

func toTranscriptionDTO(t db.MeetingTranscription) sdo.MeetingTranscriptionDTO {
	return sdo.MeetingTranscriptionDTO{
		ID: t.ID, MeetingID: t.MeetingID, FileID: t.FileID, Filename: t.Filename, SizeBytes: t.SizeBytes,
		Language: t.Language, Status: t.Status, ErrorCode: t.ErrorCode, Attempts: t.Attempts,
		StartsAt: rfc3339(t.StartsAt), EstimatedSeconds: t.EstimatedSeconds, AudioSeconds: t.AudioSeconds.Int32, CreatedBy: t.CreatedBy,
		CreatedAt: rfc3339(t.CreatedAt), CompletedAt: rfc3339(t.CompletedAt),
	}
}

func (h *handlers) requestMeetingTranscription(w http.ResponseWriter, r *http.Request) {
	var in sdi.RequestTranscriptionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	t, err := h.Meetings.RequestTranscription(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.TranscriptionRequest{UploadID: in.UploadID, Language: in.Language, Consent: in.Consent, DurationSeconds: in.DurationSeconds,
			OffsetSeconds: in.OffsetSeconds})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.MeetingTranscriptionSDO{Transcription: toTranscriptionDTO(t)})
}

func (h *handlers) listMeetingTranscriptions(w http.ResponseWriter, r *http.Request) {
	ts, err := h.Meetings.Transcriptions(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MeetingTranscriptionDTO, 0, len(ts))
	for _, t := range ts {
		out = append(out, toTranscriptionDTO(t))
	}
	respondJSON(w, 200, sdo.MeetingTranscriptionListSDO{Transcriptions: out})
}
