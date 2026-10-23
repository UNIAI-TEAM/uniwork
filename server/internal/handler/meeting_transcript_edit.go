package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// A clerk corrects or removes transcript lines, an uploaded transcription
// with its recording, and an organization sets how long it keeps them
// (UNI-1995 #5).

func (h *handlers) editTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	var in sdi.EditTranscriptSegmentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	seg, err := h.Meetings.EditTranscriptSegment(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), chi.URLParam(r, "segmentID"), in.Text)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.TranscriptSegmentSDO{Segment: toTranscriptDTO(seg)})
}

func (h *handlers) deleteTranscriptSegment(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.DeleteTranscriptSegment(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), chi.URLParam(r, "segmentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// deleteTranscript is DELETE /meetings/{meetingID}/transcript: the stretch
// [from, to) when both are given, else the whole transcript.
func (h *handlers) deleteTranscript(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	rawFrom, rawTo := strings.TrimSpace(v.Get("from")), strings.TrimSpace(v.Get("to"))
	userID, meetingID := middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")
	var n int64
	var err error
	switch {
	case rawFrom == "" && rawTo == "":
		n, err = h.Meetings.DeleteTranscript(r.Context(), userID, meetingID)
	default:
		from, ferr := time.Parse(time.RFC3339, rawFrom)
		to, terr := time.Parse(time.RFC3339, rawTo)
		if ferr != nil || terr != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "from và to phải là RFC3339 và đi cùng nhau")
			return
		}
		n, err = h.Meetings.DeleteTranscriptRange(r.Context(), userID, meetingID, from, to)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.TranscriptDeletedSDO{Deleted: n})
}

func (h *handlers) deleteMeetingTranscription(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.DeleteTranscription(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), chi.URLParam(r, "transcriptionID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) setTranscriptRetention(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetTranscriptRetentionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	set, err := h.Meetings.SetMeetingTranscriptRetention(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"), in.TranscriptRetentionDays)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondMeetingSettings(w, set)
}
