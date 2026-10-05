package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

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

// MyBallot is one line of the caller's own roll: a motion they may vote on.
// Choice stays "" unless the ballot is public and cast: a secret ballot never
// stored one.
type MyBallot struct {
	MotionID string
	Cast     bool
	Choice   string
}

// MotionView is one motion as the list shows it. It is the same for every
// caller who sees the motion: the caller's own ballot (MyBallots) and the
// named voters (MotionVoters) are separate reads, so the list every client
// refetches on each ballot stays one cheap query.
type MotionView struct {
	Motion    db.MeetingMotion
	CastCount int           // ballots cast so far, without the split
	Result    *MotionResult // CLOSED only
}

// motionRequiredYes is how many YES the motion needs to pass, against the
// denominator snapshotted when it opened.
func motionRequiredYes(mo db.MeetingMotion) int {
	return requiredYes(mo.Threshold, motionDenominator(mo.Base, int(mo.RollSize.Int32), int(mo.TotalMembers.Int32)))
}

// NewMotionView is a motion as the list and the command responses show it.
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

// motionReader is who is reading a meeting's motions, as the gate found them.
type motionReader struct {
	userID string
	m      db.Meeting
	// member is set when the caller passed the workspace gate; clerk is
	// already known true for the host and workspace admins.
	member, clerk bool
}

// readMotions is authorizeActiveParticipant for the motion read paths, which
// every client calls on every ballot: a workspace member goes through the
// gate once, and the membership row it returns answers most of
// requireMeetingClerk's question without asking the gate again. Anyone the
// gate refuses as a non-member falls through to authorizeActiveParticipant
// (an invite-link user); guests go straight there.
func (s *MeetingService) readMotions(ctx context.Context, userID, guestID, meetingID string) (motionReader, error) {
	if userID == "" {
		m, err := s.authorizeActiveParticipant(ctx, "", guestID, meetingID)
		return motionReader{m: m}, err
	}
	m, mem, err := s.authorize(ctx, userID, meetingID)
	if err == nil {
		return motionReader{userID: userID, m: m, member: true, clerk: m.HostUserID == userID || isWSAdmin(mem.Role)}, nil
	}
	if !errors.Is(err, ErrForbidden) {
		return motionReader{}, err
	}
	m, err = s.authorizeActiveParticipant(ctx, userID, "", meetingID)
	return motionReader{userID: userID, m: m}, err
}

// seesDrafts is requireMeetingClerk's rule on what the gate already
// returned: the host, a workspace admin, or a member the host made
// secretary. Only the last needs a read, and only when there is a draft to
// hide.
func (s *MeetingService) seesDrafts(ctx context.Context, r motionReader) (bool, error) {
	if !r.member || r.clerk {
		return r.clerk, nil
	}
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: r.m.ID, UserID: strText(r.userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return p.IsSecretary, nil
}

// Motions lists a meeting's motions for anyone in it, guests included.
// Drafts are the clerks' working copy and stay hidden from everyone else.
func (s *MeetingService) Motions(ctx context.Context, userID, guestID, meetingID string) ([]MotionView, error) {
	r, err := s.readMotions(ctx, userID, guestID, meetingID)
	if err != nil {
		return nil, err
	}
	motions, err := s.q.ListMeetingMotions(ctx, r.m.ID)
	if err != nil {
		return nil, err
	}
	drafts := false
	for _, mo := range motions {
		drafts = drafts || mo.Status == MotionDraft
	}
	clerk := false
	if drafts {
		if clerk, err = s.seesDrafts(ctx, r); err != nil {
			return nil, err
		}
	}
	views := make([]MotionView, 0, len(motions))
	for _, mo := range motions {
		if mo.Status == MotionDraft && !clerk {
			continue
		}
		views = append(views, NewMotionView(mo))
	}
	return views, nil
}

// MyBallots is the caller's own roll in the meeting: one line per motion they
// were on the roll for. It changes when a motion opens and when they vote,
// not on anyone else's ballot.
func (s *MeetingService) MyBallots(ctx context.Context, userID, guestID, meetingID string) ([]MyBallot, error) {
	r, err := s.readMotions(ctx, userID, guestID, meetingID)
	if err != nil {
		return nil, err
	}
	out := []MyBallot{}
	pid := s.activeParticipantID(ctx, userID, guestID, r.m.ID)
	if pid == "" {
		return out, nil
	}
	ballots, err := s.q.ListMeetingBallotsForParticipant(ctx, db.ListMeetingBallotsForParticipantParams{MeetingID: r.m.ID, ParticipantID: pid})
	if err != nil {
		return nil, err
	}
	for _, b := range ballots {
		// A secret ballot never stored a choice, so Choice is "" there by
		// construction, and before the cast for everyone.
		out = append(out, MyBallot{MotionID: b.MotionID, Cast: b.CastAt.Valid, Choice: b.Choice.String})
	}
	return out, nil
}

// MotionVoters names who chose what on one closed public motion; nil while
// the motion is open (a running split would let the last voters read the
// room) and for a secret ballot. A draft is not found for anyone who does not
// clerk, like the list hides it.
func (s *MeetingService) MotionVoters(ctx context.Context, userID, guestID, meetingID, motionID string) (*MotionVoters, error) {
	r, err := s.readMotions(ctx, userID, guestID, meetingID)
	if err != nil {
		return nil, err
	}
	mo, err := s.q.GetMeetingMotion(ctx, db.GetMeetingMotionParams{ID: motionID, MeetingID: r.m.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if mo.Status == MotionDraft {
		clerk, err := s.seesDrafts(ctx, r)
		if err != nil {
			return nil, err
		}
		if !clerk {
			return nil, ErrNotFound
		}
	}
	if mo.Status != MotionClosed || mo.BallotMode != BallotPublic {
		return nil, nil
	}
	rows, err := s.q.ListPublicMotionVoters(ctx, mo.ID)
	if err != nil {
		return nil, err
	}
	vs := &MotionVoters{Yes: []string{}, No: []string{}, Abstain: []string{}}
	for _, row := range rows {
		switch row.Choice.String {
		case ChoiceYes:
			vs.Yes = append(vs.Yes, row.DisplayNameSnapshot)
		case ChoiceNo:
			vs.No = append(vs.No, row.DisplayNameSnapshot)
		case ChoiceAbstain:
			vs.Abstain = append(vs.Abstain, row.DisplayNameSnapshot)
		}
	}
	return vs, nil
}
