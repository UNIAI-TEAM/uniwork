package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toMinutesSDO(v *service.MeetingMinutes) sdo.MeetingMinutesSDO {
	if v == nil {
		return sdo.MeetingMinutesSDO{}
	}
	d := &sdo.MeetingMinutesDTO{EditedSinceFinalized: v.EditedSinceFinalized, CanEdit: v.CanEdit, PendingItems: v.PendingItems}
	if v.Readable {
		d.DocumentID = &v.DocumentID
	}
	if !v.FinalizedAt.IsZero() {
		at := v.FinalizedAt.UTC().Format(time.RFC3339)
		d.Finalized = true
		d.FinalizedAt, d.FinalizedBy = &at, &v.FinalizedBy
		if v.Readable {
			d.FinalizedVersionID = &v.FinalizedVersionID
		}
		if v.FinalizedVersion > 0 {
			d.FinalizedVersion = &v.FinalizedVersion
		}
	}
	return sdo.MeetingMinutesSDO{Minutes: d}
}

func (h *handlers) respondMinutes(w http.ResponseWriter, v *service.MeetingMinutes, err error) {
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toMinutesSDO(v))
}

func (h *handlers) getMeetingMinutes(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.Minutes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	h.respondMinutes(w, v, err)
}

func (h *handlers) createMeetingMinutes(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMinutesSDI
	// The locale is optional, so no body at all is fine.
	if r.Body != http.NoBody && !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Meetings.CreateMinutes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), summaryLocale(in.Locale))
	h.respondMinutes(w, v, err)
}

func (h *handlers) finalizeMeetingMinutes(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.FinalizeMinutes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	h.respondMinutes(w, v, err)
}

func (h *handlers) refreshMeetingMinutes(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.RefreshMinutesFacts(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	h.respondMinutes(w, v, err)
}

func (h *handlers) reopenMeetingMinutes(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.ReopenMinutes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	h.respondMinutes(w, v, err)
}

// meetingFlagOrganization feeds mw.FlagOrganization on the minutes routes:
// the organization of the path's meeting, only for a member of its workspace.
func (h *handlers) meetingFlagOrganization(r *http.Request) string {
	return h.Meetings.FlagOrganization(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
}
