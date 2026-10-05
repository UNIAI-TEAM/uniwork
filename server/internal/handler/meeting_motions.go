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
	}
	if v.Result != nil {
		out.Result = &sdo.MotionResultDTO{
			Yes: v.Result.Yes, No: v.Result.No, Abstain: v.Result.Abstain,
			Required: v.Result.Required, Outcome: v.Result.Outcome,
		}
	}
	return out
}

// meetingReader is the signed-in user or the guest session behind an in-room
// read; it writes the 401 itself when there is neither.
func (h *handlers) meetingReader(w http.ResponseWriter, r *http.Request) (userID, guestID string, ok bool) {
	userID, guestID = h.meetingActor(r)
	if userID == "" && guestID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized", "cần đăng nhập hoặc phiên khách")
		return "", "", false
	}
	return userID, guestID, true
}

// listMotions serves members and active guests; the service hides drafts
// from anyone who is not a clerk and the tally while voting is open. The body
// is the same for every non-clerk: no caller's ballot, no voter names.
func (h *handlers) listMotions(w http.ResponseWriter, r *http.Request) {
	userID, guestID, ok := h.meetingReader(w, r)
	if !ok {
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

// listMyBallots is the caller's own roll: which motions they may vote on,
// whether they did, and their choice on a public ballot.
func (h *handlers) listMyBallots(w http.ResponseWriter, r *http.Request) {
	userID, guestID, ok := h.meetingReader(w, r)
	if !ok {
		return
	}
	ballots, err := h.Meetings.MyBallots(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.MyBallotDTO, 0, len(ballots))
	for _, b := range ballots {
		dto := sdo.MyBallotDTO{MotionID: b.MotionID, Cast: b.Cast}
		if b.Choice != "" {
			choice := b.Choice
			dto.Choice = &choice
		}
		out = append(out, dto)
	}
	respondJSON(w, 200, sdo.MyBallotListSDO{Ballots: out})
}

// listMotionVoters names who chose what on one closed public motion, loaded
// only when someone opens its result.
func (h *handlers) listMotionVoters(w http.ResponseWriter, r *http.Request) {
	userID, guestID, ok := h.meetingReader(w, r)
	if !ok {
		return
	}
	motionID := chi.URLParam(r, "motionID")
	voters, err := h.Meetings.MotionVoters(r.Context(), userID, guestID, chi.URLParam(r, "meetingID"), motionID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MotionVotersSDO{MotionID: motionID}
	if voters != nil {
		out.Voters = &sdo.MotionVotersDTO{
			Yes: voterNames(voters.Yes), No: voterNames(voters.No), Abstain: voterNames(voters.Abstain),
		}
	}
	respondJSON(w, 200, out)
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
	userID, guestID, ok := h.meetingReader(w, r)
	if !ok {
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
