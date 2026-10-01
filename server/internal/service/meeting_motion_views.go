package service

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// MotionResult is the count of a closed motion. It is never built while the
// motion is open, for anyone, host included: a running split would let the
// last voters read the room and steer it.
type MotionResult struct {
	Yes, No, Abstain, Required int
	Outcome                    string
}

// MotionVoters names who chose what on a closed open-ballot motion.
type MotionVoters struct {
	Yes, No, Abstain []string
}

// MyBallot is the caller's own line on the roll. Choice stays "" unless the
// ballot is public and cast: a secret ballot never stored one.
type MyBallot struct {
	OnRoll, Cast bool
	Choice       string
}

// MotionView is one motion as a given caller may see it.
type MotionView struct {
	Motion    db.MeetingMotion
	CastCount int           // ballots cast so far, without the split
	Result    *MotionResult // CLOSED only
	Voters    *MotionVoters // CLOSED and PUBLIC only; filled by Motions
	MyBallot  MyBallot      // filled by Motions
}

// motionRequiredYes is how many YES the motion needs to pass, against the
// denominator snapshotted when it opened.
func motionRequiredYes(mo db.MeetingMotion) int {
	return requiredYes(mo.Threshold, motionDenominator(mo.Base, int(mo.RollSize.Int32), int(mo.TotalMembers.Int32)))
}

// NewMotionView is the caller-independent part of a view: what command
// responses return. Motions adds voters and the caller's own ballot.
func NewMotionView(mo db.MeetingMotion) MotionView {
	v := MotionView{Motion: mo, CastCount: int(mo.YesCount + mo.NoCount + mo.AbstainCount)}
	if mo.Status == MotionClosed {
		v.Result = &MotionResult{
			Yes: int(mo.YesCount), No: int(mo.NoCount), Abstain: int(mo.AbstainCount),
			Required: motionRequiredYes(mo), Outcome: mo.Outcome.String,
		}
	}
	return v
}

// Motions lists a meeting's motions for anyone in it, guests included.
// Drafts are the clerks' working copy and stay hidden from everyone else.
func (s *MeetingService) Motions(ctx context.Context, userID, guestID, meetingID string) ([]MotionView, error) {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return nil, err
	}
	clerk := userID != "" && s.isMeetingClerk(ctx, userID, meetingID)
	motions, err := s.q.ListMeetingMotions(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	mine := map[string]db.MeetingMotionBallot{}
	if pid := s.activeParticipantID(ctx, userID, guestID, meetingID); pid != "" {
		ballots, err := s.q.ListMeetingBallotsForParticipant(ctx, db.ListMeetingBallotsForParticipantParams{MeetingID: meetingID, ParticipantID: pid})
		if err != nil {
			return nil, err
		}
		for _, b := range ballots {
			mine[b.MotionID] = b
		}
	}
	views := make([]MotionView, 0, len(motions))
	voters := map[string]*MotionVoters{}
	for _, mo := range motions {
		if mo.Status == MotionDraft && !clerk {
			continue
		}
		v := NewMotionView(mo)
		if b, ok := mine[mo.ID]; ok {
			v.MyBallot = MyBallot{OnRoll: true, Cast: b.CastAt.Valid}
			if mo.BallotMode == BallotPublic && b.CastAt.Valid {
				v.MyBallot.Choice = b.Choice.String
			}
		}
		if mo.Status == MotionClosed && mo.BallotMode == BallotPublic {
			v.Voters = &MotionVoters{Yes: []string{}, No: []string{}, Abstain: []string{}}
			voters[mo.ID] = v.Voters
		}
		views = append(views, v)
	}
	if len(voters) == 0 {
		return views, nil
	}
	rows, err := s.q.ListPublicMeetingVoters(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		vs, ok := voters[r.MotionID]
		if !ok {
			// Still open: who chose what is shown only once the count is final.
			continue
		}
		switch r.Choice.String {
		case ChoiceYes:
			vs.Yes = append(vs.Yes, r.DisplayNameSnapshot)
		case ChoiceNo:
			vs.No = append(vs.No, r.DisplayNameSnapshot)
		case ChoiceAbstain:
			vs.Abstain = append(vs.Abstain, r.DisplayNameSnapshot)
		}
	}
	return views, nil
}
