package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// int4Ptr turns a count that is only set when voting opens into JSON null
// while the item is still a draft.
func int4Ptr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	n := v.Int32
	return &n
}

// voterNames keeps a choice nobody picked as [] rather than null, so the
// client renders "Nobody" without a null check.
func voterNames(names []string) []string {
	if names == nil {
		return []string{}
	}
	return names
}

func toMotionDTO(v service.MotionView) sdo.MotionDTO {
	mo := v.Motion
	out := sdo.MotionDTO{
		ID: mo.ID, Title: mo.Title, Description: mo.Description, Position: mo.Position,
		BallotMode: mo.BallotMode, Threshold: mo.Threshold, Base: mo.Base, Status: mo.Status,
		OpenedAt: rfc3339(mo.OpenedAt), ClosedAt: rfc3339(mo.ClosedAt),
		RollSize: int4Ptr(mo.RollSize), TotalMembers: int4Ptr(mo.TotalMembers),
		CastCount: v.CastCount,
		MyBallot:  sdo.MyBallotDTO{OnRoll: v.MyBallot.OnRoll, Cast: v.MyBallot.Cast},
	}
	if v.MyBallot.Choice != "" {
		choice := v.MyBallot.Choice
		out.MyBallot.Choice = &choice
	}
	if v.Result != nil {
		out.Result = &sdo.MotionResultDTO{
			Yes: v.Result.Yes, No: v.Result.No, Abstain: v.Result.Abstain,
			Required: v.Result.Required, Outcome: v.Result.Outcome,
		}
	}
	if v.Voters != nil {
		out.Voters = &sdo.MotionVotersDTO{
			Yes: voterNames(v.Voters.Yes), No: voterNames(v.Voters.No), Abstain: voterNames(v.Voters.Abstain),
		}
	}
	return out
}

// listMotions serves members and active guests; the service hides drafts
// from anyone who is not a clerk and the tally while voting is open.
func (h *handlers) listMotions(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	views, err := h.Meetings.Motions(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MotionDTO, 0, len(views))
	for _, v := range views {
		out = append(out, toMotionDTO(v))
	}
	respondJSON(w, 200, sdo.MotionListSDO{Motions: out})
}

func (h *handlers) createMotion(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateMotionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	mo, err := h.Meetings.CreateMotion(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.MotionInput{
			Title: in.Title, Description: in.Description,
			BallotMode: in.BallotMode, Threshold: in.Threshold, Base: in.Base,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MotionSDO{Motion: toMotionDTO(service.NewMotionView(mo))})
}

func (h *handlers) updateMotion(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchMotionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	mo, err := h.Meetings.UpdateMotion(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "motionID"),
		service.MotionPatch{
			Title: in.Title, Description: in.Description,
			BallotMode: in.BallotMode, Threshold: in.Threshold, Base: in.Base,
			Position: in.Position,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MotionSDO{Motion: toMotionDTO(service.NewMotionView(mo))})
}

func (h *handlers) deleteMotion(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.DeleteMotion(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "motionID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) openMotion(w http.ResponseWriter, r *http.Request) {
	mo, err := h.Meetings.OpenMotion(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "motionID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MotionSDO{Motion: toMotionDTO(service.NewMotionView(mo))})
}

func (h *handlers) closeMotion(w http.ResponseWriter, r *http.Request) {
	mo, err := h.Meetings.CloseMotion(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "motionID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MotionSDO{Motion: toMotionDTO(service.NewMotionView(mo))})
}

// castBallot accepts a signed-in member or a guest session; whether the
// caller is on the roll, and whether they already voted, is the service's
// call under the motion row lock.
func (h *handlers) castBallot(w http.ResponseWriter, r *http.Request) {
	userID, guestID := h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return
	}
	var in sdi.CastBallotSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.CastBallot(r.Context(), userID, guestID,
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "motionID"), in.Choice); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}
