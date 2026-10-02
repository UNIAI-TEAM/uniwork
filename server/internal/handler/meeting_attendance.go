package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toAttendanceSDO(rep service.AttendanceReport) sdo.AttendanceSDO {
	out := sdo.AttendanceSDO{
		FinalizedAt: rfc3339(rep.Meeting.AttendanceFinalizedAt),
		FinalizedBy: rep.Meeting.AttendanceFinalizedBy.String,
		Summary: sdo.AttendanceSummaryDTO{
			Members: rep.Summary.Members, Present: rep.Summary.Present, Late: rep.Summary.Late,
			Excused: rep.Summary.Excused, Absent: rep.Summary.Absent, QuorumMet: rep.Summary.QuorumMet,
		},
		Rows: make([]sdo.AttendanceRowDTO, 0, len(rep.Rows)),
	}
	if rep.Meeting.QuorumPercent.Valid {
		v := rep.Meeting.QuorumPercent.Int16
		out.QuorumPercent = &v
	}
	for _, r := range rep.Rows {
		out.Rows = append(out.Rows, sdo.AttendanceRowDTO{
			ParticipantID: r.Participant.ID, PrincipalType: r.Participant.PrincipalType,
			UserID: r.Participant.UserID.String, DisplayName: r.Participant.DisplayNameSnapshot,
			Standing: r.Participant.Standing, IsSecretary: r.Participant.IsSecretary,
			Status: r.Status, Source: r.Source, Note: r.Note,
			FirstJoinedAt: rfc3339(r.FirstJoinedAt), LastLeftAt: rfc3339(r.LastLeftAt),
			InRoom: r.InRoom, PresentSeconds: r.PresentSeconds, SessionCount: r.SessionCount,
			Removed: r.Removed, JoinedAfterFinalize: r.JoinedAfterFinalize,
		})
	}
	return out
}

func (h *handlers) getAttendance(w http.ResponseWriter, r *http.Request) {
	rep, err := h.Meetings.Attendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toAttendanceSDO(rep))
}

func (h *handlers) markAttendance(w http.ResponseWriter, r *http.Request) {
	var in sdi.MarkAttendanceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.MarkAttendance(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID"), in.Status, in.Note); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) clearAttendanceMark(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.ClearAttendanceMark(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) finalizeAttendance(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.FinalizeAttendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) reopenAttendance(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.ReopenAttendance(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) patchParticipant(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchParticipantSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.Meetings.UpdateParticipantDuties(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID"),
		service.ParticipantDutiesInput{Standing: in.Standing, IsSecretary: in.IsSecretary})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ParticipantSDO{Participant: toParticipantDTO(p, false)})
}
