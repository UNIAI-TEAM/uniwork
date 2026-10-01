package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// draftVoteMotion creates a DRAFT motion counted against members present.
func draftVoteMotion(t *testing.T, s *MeetingService, actorID, meetingID, title, mode, threshold string) db.MeetingMotion {
	t.Helper()
	mo, err := s.CreateMotion(context.Background(), actorID, meetingID, MotionInput{
		Title: title, BallotMode: mode, Threshold: threshold, Base: BasePresent,
	})
	if err != nil {
		t.Fatal(err)
	}
	return mo
}

// newMemberGuest is a guest the host promoted to MEMBER, so they count and vote.
func newMemberGuest(t *testing.T, s *MeetingService, hostID, meetingID string) db.MeetingParticipant {
	t.Helper()
	g := newGuestParticipant(t, s, meetingID)
	member := StandingMember
	up, err := s.UpdateParticipantDuties(context.Background(), hostID, meetingID, g.ID, ParticipantDutiesInput{Standing: &member})
	if err != nil {
		t.Fatal(err)
	}
	return up
}

func openVoteMotion(t *testing.T, s *MeetingService, actorID, meetingID, motionID string) db.MeetingMotion {
	t.Helper()
	mo, err := s.OpenMotion(context.Background(), actorID, meetingID, motionID)
	if err != nil {
		t.Fatal(err)
	}
	return mo
}

func ballotRoll(t *testing.T, s *MeetingService, motionID string) map[string]bool {
	t.Helper()
	rows, err := s.pool.Query(context.Background(), `SELECT participant_id FROM meeting_motion_ballots WHERE motion_id = $1`, motionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	roll := map[string]bool{}
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			t.Fatal(err)
		}
		roll[pid] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return roll
}

func motionsFor(t *testing.T, s *MeetingService, userID, guestID, meetingID string) []MotionView {
	t.Helper()
	views, err := s.Motions(context.Background(), userID, guestID, meetingID)
	if err != nil {
		t.Fatal(err)
	}
	return views
}

// viewByID picks one motion out of a Motions listing. (motionByID, in
// meeting_motions_test.go, reads the raw row instead.)
func viewByID(t *testing.T, views []MotionView, id string) MotionView {
	t.Helper()
	for _, v := range views {
		if v.Motion.ID == id {
			return v
		}
	}
	t.Fatalf("motion %s not listed", id)
	return MotionView{}
}

func codedStatus(err error) int {
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Status
	}
	return 0
}

func TestOpenMotionSnapshotsVoterRoll(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "") // PRESENT
	late := newMemberGuest(t, s, ua.ID, m.ID)
	seedSession(t, s, m.ID, late.ID, "30 minutes", "") // LATE
	absent := newMemberGuest(t, s, ua.ID, m.ID)        // never joined
	afterOpen := newMemberGuest(t, s, ua.ID, m.ID)     // joins once voting is open
	observer := newGuestParticipant(t, s, m.ID)        // in the room, but OBSERVER
	seedSession(t, s, m.ID, observer.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendanceExcused, "công tác"); err != nil {
		t.Fatal(err)
	}

	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Thông qua kế hoạch quý IV", BallotPublic, ThresholdMajority)
	opened := openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	if opened.Status != MotionOpen || !opened.OpenedAt.Valid || opened.OpenedBy.String != ua.ID {
		t.Fatalf("opened = %+v", opened)
	}
	// Members: host, ub (excused), late, absent, afterOpen. Voters: host + late.
	if opened.RollSize.Int32 != 2 || opened.TotalMembers.Int32 != 5 {
		t.Fatalf("roll_size = %d total_members = %d, want 2 and 5", opened.RollSize.Int32, opened.TotalMembers.Int32)
	}
	roll := ballotRoll(t, s, mo.ID)
	if len(roll) != 2 || !roll[host.ID] || !roll[late.ID] {
		t.Fatalf("roll = %v, want host and late member", roll)
	}
	var uncast int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meeting_motion_ballots WHERE motion_id = $1 AND cast_at IS NULL AND choice IS NULL`, mo.ID).Scan(&uncast); err != nil {
		t.Fatal(err)
	}
	if uncast != 2 {
		t.Fatalf("blank ballots = %d, want 2", uncast)
	}

	// Entering the room after voting opened does not add you to the roll.
	seedSession(t, s, m.ID, afterOpen.ID, "50 minutes", "")
	for name, guestID := range map[string]string{
		"joined after open": afterOpen.GuestID.String,
		"absent member":     absent.GuestID.String,
		"observer":          observer.GuestID.String,
	} {
		err := s.CastBallot(ctx, "", guestID, m.ID, mo.ID, ChoiceYes)
		if !codedIs(err, "not_on_roll") || codedStatus(err) != http.StatusForbidden {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, mo.ID, ChoiceYes); !codedIs(err, "not_on_roll") {
		t.Fatalf("excused member: %v", err)
	}

	var from, to, actor, title string
	if err := s.pool.QueryRow(ctx, `
		SELECT from_state, to_state, actor_id, payload::jsonb->>'title'
		FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MOTION_OPENED'`, m.ID).
		Scan(&from, &to, &actor, &title); err != nil {
		t.Fatal(err)
	}
	if from != MotionDraft || to != MotionOpen || actor != ua.ID || title != mo.Title {
		t.Fatalf("MOTION_OPENED row = %s→%s by %s %q", from, to, actor, title)
	}
	var audits, events int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.motion_opened' AND resource_id = $1`, m.ID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'motion.opened' AND payload::jsonb->>'motion_id' = $1`, mo.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if audits != 1 || events != 1 {
		t.Fatalf("motion_opened audit rows = %d, outbox rows = %d, want 1 and 1", audits, events)
	}
}

func TestOpenMotionRules(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	first := draftVoteMotion(t, s, ua.ID, m.ID, "Nội dung 1", BallotPublic, ThresholdMajority)
	second := draftVoteMotion(t, s, ua.ID, m.ID, "Nội dung 2", BallotSecret, ThresholdTwoThirds)

	if _, err := s.OpenMotion(ctx, ub.ID, m.ID, first.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member opens: %v", err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, util.NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown motion: %v", err)
	}
	// Nobody has entered the room: the roll is empty and the motion still opens.
	opened := openVoteMotion(t, s, ua.ID, m.ID, first.ID)
	if opened.RollSize.Int32 != 0 || opened.TotalMembers.Int32 != 2 {
		t.Fatalf("empty roll: roll_size = %d total_members = %d", opened.RollSize.Int32, opened.TotalMembers.Int32)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, second.ID); !codedIs(err, "motion_already_open") {
		t.Fatalf("second open: %v", err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, first.ID); !codedIs(err, "motion_not_draft") {
		t.Fatalf("reopen open motion: %v", err)
	}

	closed, err := s.CloseMotion(ctx, ua.ID, m.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Status != MotionClosed || closed.Outcome.String != OutcomeFailed {
		t.Fatalf("closed empty roll = %s/%s, want CLOSED/FAILED", closed.Status, closed.Outcome.String)
	}
	if v := NewMotionView(closed); v.Result == nil || v.Result.Required != 0 || v.CastCount != 0 {
		t.Fatalf("empty roll view = %+v", v)
	}
	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, first.ID); !codedIs(err, "motion_not_open") {
		t.Fatalf("close twice: %v", err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, first.ID); !codedIs(err, "motion_not_draft") {
		t.Fatalf("open closed motion: %v", err)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, first.ID, ChoiceYes); !codedIs(err, "motion_not_open") || codedStatus(err) != http.StatusConflict {
		t.Fatalf("ballot after close: %v", err)
	}
	// One open at a time, not one ever: with the first closed, the second opens.
	openVoteMotion(t, s, ua.ID, m.ID, second.ID)
}

func TestOpenMotionNeedsLiveMeeting(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Sau", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	// Drafting ahead of time is allowed; opening is not.
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Soạn trước", BallotPublic, ThresholdMajority)
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, mo.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("open on scheduled meeting: %v", err)
	}
}

func TestCastBallotRules(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Công khai", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)

	var ve ValidationError
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, "MAYBE"); !errors.As(err, &ve) {
		t.Fatalf("unknown choice: %v", err)
	}
	// ub is a participant, but was absent when voting opened.
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, mo.ID, ChoiceYes); !codedIs(err, "not_on_roll") || codedStatus(err) != http.StatusForbidden {
		t.Fatalf("absent member: %v", err)
	}
	// A guest with no participant row is not let in at all.
	if err := s.CastBallot(ctx, "", util.NewID(), m.ID, mo.ID, ChoiceYes); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger guest: %v", err)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, util.NewID(), ChoiceYes); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown motion: %v", err)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceNo); !codedIs(err, "already_voted") || codedStatus(err) != http.StatusConflict {
		t.Fatalf("second ballot: %v", err)
	}
	var yes, no int
	if err := s.pool.QueryRow(ctx, `SELECT yes_count, no_count FROM meeting_motions WHERE id = $1`, mo.ID).Scan(&yes, &no); err != nil {
		t.Fatal(err)
	}
	if yes != 1 || no != 0 {
		t.Fatalf("counts = %d yes %d no, want 1 and 0", yes, no)
	}
}

func TestCastBallotSameVoterRace(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Bấm đúp", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)

	// The default test pool on purpose (pgxpool MaxConns = max(4, NumCPU), one
	// held by the test lock). Inside its transaction a ballot touches only q,
	// so callers queued on the motion row lock never wait on a second pool
	// connection while holding one, and twenty of them cannot starve the pool.
	const n = 20
	start := make(chan struct{})
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			<-start
			errs <- s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes)
		}()
	}
	close(start)
	ok, dup := 0, 0
	timeout := time.After(30 * time.Second)
	for i := 0; i < n; i++ {
		select {
		case err := <-errs:
			switch {
			case err == nil:
				ok++
			case codedIs(err, "already_voted"):
				dup++
			default:
				t.Fatalf("unexpected ballot error: %v", err)
			}
		case <-timeout:
			t.Fatal("ballots stuck: a command is borrowing a second pool connection inside its transaction")
		}
	}
	if ok != 1 || dup != n-1 {
		t.Fatalf("race: %d accepted, %d already_voted; want 1 and %d", ok, dup, n-1)
	}
	var yes, audits int
	if err := s.pool.QueryRow(ctx, `SELECT yes_count FROM meeting_motions WHERE id = $1`, mo.ID).Scan(&yes); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.ballot_cast' AND resource_id = $1`, mo.ID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if yes != 1 || audits != 1 {
		t.Fatalf("yes_count = %d, ballot audit rows = %d; want 1 and 1", yes, audits)
	}
}

func TestCastBallotParallelVoters(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	const guests = 8
	voters := make([]db.MeetingParticipant, guests)
	for i := range voters {
		voters[i] = newMemberGuest(t, s, ua.ID, m.ID)
		seedSession(t, s, m.ID, voters[i].ID, "0 minutes", "")
	}
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Song song", BallotPublic, ThresholdMajority)
	if opened := openVoteMotion(t, s, ua.ID, m.ID, mo.ID); opened.RollSize.Int32 != guests+1 {
		t.Fatalf("roll_size = %d, want %d", opened.RollSize.Int32, guests+1)
	}

	choices := []string{ChoiceYes, ChoiceNo, ChoiceAbstain}
	errs := make(chan error, guests+1)
	go func() { errs <- s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes) }()
	for i, g := range voters {
		go func() { errs <- s.CastBallot(ctx, "", g.GuestID.String, m.ID, mo.ID, choices[i%3]) }()
	}
	for i := 0; i < guests+1; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	// Host YES + guests 0,3,6 YES; 1,4,7 NO; 2,5 ABSTAIN.
	v := viewByID(t, motionsFor(t, s, ua.ID, "", m.ID), mo.ID)
	if v.CastCount != guests+1 || v.Result != nil {
		t.Fatalf("open view: cast %d result %+v", v.CastCount, v.Result)
	}
	closed, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	r := NewMotionView(closed).Result
	if r == nil || r.Yes != 4 || r.No != 3 || r.Abstain != 2 || r.Required != 5 || r.Outcome != OutcomeFailed {
		t.Fatalf("result = %+v, want 4/3/2 needing 5, FAILED", r)
	}
}

func TestSecretBallotKeepsNoChoice(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	g := newMemberGuest(t, s, ua.ID, m.ID)
	seedSession(t, s, m.ID, g.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Bỏ phiếu kín", BallotSecret, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)

	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, "", g.GuestID.String, m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	var withChoice, cast int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE choice IS NOT NULL), count(*) FILTER (WHERE cast_at IS NOT NULL)
		FROM meeting_motion_ballots WHERE motion_id = $1`, mo.ID).Scan(&withChoice, &cast); err != nil {
		t.Fatal(err)
	}
	if withChoice != 0 || cast != 2 {
		t.Fatalf("secret ballots: %d with a choice, %d cast; want 0 and 2", withChoice, cast)
	}

	// Audit: one row per ballot, on the motion, saying only "voted".
	rows, err := s.pool.Query(ctx, `SELECT actor_kind, actor_id, resource_type, changes FROM audit_events
		WHERE action = 'meeting.ballot_cast' AND resource_id = $1`, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	actors := map[string]string{}
	for rows.Next() {
		var kind, actor, resourceType, changes string
		if err := rows.Scan(&kind, &actor, &resourceType, &changes); err != nil {
			t.Fatal(err)
		}
		if resourceType != "meeting_motion" || changes != "{}" {
			t.Fatalf("secret ballot audit row: resource %q changes %s", resourceType, changes)
		}
		actors[kind] = actor
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if len(actors) != 2 || actors["human"] != ua.ID || actors["guest"] != g.GuestID.String {
		t.Fatalf("ballot actors = %v", actors)
	}
	// Outbox: the event names the motion, never the voter.
	var events int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events
		WHERE topic = 'motion.ballot_cast' AND payload::jsonb->>'motion_id' = $1
		  AND NOT (payload::jsonb ? 'participant_id') AND NOT (payload::jsonb ? 'user_id')`, mo.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 2 {
		t.Fatalf("ballot events without voter id = %d, want 2", events)
	}

	// While open nobody sees a result, the host included.
	v := viewByID(t, motionsFor(t, s, ua.ID, "", m.ID), mo.ID)
	if v.Result != nil || v.CastCount != 2 || !v.MyBallot.OnRoll || !v.MyBallot.Cast || v.MyBallot.Choice != "" {
		t.Fatalf("host view while open = %+v", v)
	}
	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	v = viewByID(t, motionsFor(t, s, ua.ID, "", m.ID), mo.ID)
	if v.Voters != nil {
		t.Fatalf("secret motion lists voters: %+v", v.Voters)
	}
	if v.Result == nil || v.Result.Yes != 1 || v.Result.No != 1 || v.Result.Required != 2 || v.Result.Outcome != OutcomeFailed {
		t.Fatalf("secret result = %+v", v.Result)
	}
	gv := viewByID(t, motionsFor(t, s, "", g.GuestID.String, m.ID), mo.ID)
	if !gv.MyBallot.Cast || gv.MyBallot.Choice != "" {
		t.Fatalf("guest ballot view = %+v", gv.MyBallot)
	}
}

func TestPublicBallotAuditAndVoters(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Công khai", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, mo.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}

	var resourceType, to string
	if err := s.pool.QueryRow(ctx, `SELECT resource_type, changes::jsonb->'choice'->>'to' FROM audit_events
		WHERE action = 'meeting.ballot_cast' AND actor_id = $1 AND resource_id = $2`, ua.ID, mo.ID).Scan(&resourceType, &to); err != nil {
		t.Fatal(err)
	}
	if resourceType != "meeting_motion" || to != ChoiceYes {
		t.Fatalf("public ballot audit = %q choice %q", resourceType, to)
	}

	v := viewByID(t, motionsFor(t, s, ua.ID, "", m.ID), mo.ID)
	if v.Result != nil || v.Voters != nil {
		t.Fatalf("open public motion leaks result %+v voters %+v", v.Result, v.Voters)
	}
	if v.MyBallot.Choice != ChoiceYes {
		t.Fatalf("host's own choice = %q", v.MyBallot.Choice)
	}
	if bv := viewByID(t, motionsFor(t, s, ub.ID, "", m.ID), mo.ID); bv.MyBallot.Choice != ChoiceNo {
		t.Fatalf("member's own choice = %q", bv.MyBallot.Choice)
	}

	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	v = viewByID(t, motionsFor(t, s, ub.ID, "", m.ID), mo.ID)
	if v.Voters == nil || len(v.Voters.Yes) != 1 || v.Voters.Yes[0] != "A" ||
		len(v.Voters.No) != 1 || v.Voters.No[0] != "B" || v.Voters.Abstain == nil || len(v.Voters.Abstain) != 0 {
		t.Fatalf("voters = %+v", v.Voters)
	}
	if r := v.Result; r == nil || r.Yes != 1 || r.No != 1 || r.Abstain != 0 || r.Required != 2 || r.Outcome != OutcomeFailed {
		t.Fatalf("public result = %+v", r)
	}
}

func TestMotionsHidesDraftsFromNonClerks(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	g := newGuestParticipant(t, s, m.ID)
	draftVoteMotion(t, s, ua.ID, m.ID, "Còn nháp", BallotPublic, ThresholdMajority)
	live := draftVoteMotion(t, s, ua.ID, m.ID, "Đang mở", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, live.ID)

	if n := len(motionsFor(t, s, ua.ID, "", m.ID)); n != 2 {
		t.Fatalf("host sees %d motions, want 2", n)
	}
	for name, views := range map[string][]MotionView{
		"member": motionsFor(t, s, ub.ID, "", m.ID),
		"guest":  motionsFor(t, s, "", g.GuestID.String, m.ID),
	} {
		if len(views) != 1 || views[0].Motion.ID != live.ID || views[0].MyBallot.OnRoll {
			t.Fatalf("%s sees %+v, want only the open motion, off the roll", name, views)
		}
	}
	// A secretary clerks, so drafts show up for them.
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if n := len(motionsFor(t, s, ub.ID, "", m.ID)); n != 2 {
		t.Fatalf("secretary sees %d motions, want 2", n)
	}
	if _, err := s.Motions(ctx, "", util.NewID(), m.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger guest reads motions: %v", err)
	}
}

func TestCloseMotionRecordsOutcome(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	g1 := newMemberGuest(t, s, ua.ID, m.ID)
	g2 := newMemberGuest(t, s, ua.ID, m.ID)
	seedSession(t, s, m.ID, g1.ID, "0 minutes", "")
	seedSession(t, s, m.ID, g2.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Hai phần ba", BallotPublic, ThresholdTwoThirds)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	for voter, choice := range map[string]string{g1.GuestID.String: ChoiceYes, g2.GuestID.String: ChoiceNo} {
		if err := s.CastBallot(ctx, "", voter, m.ID, mo.ID, choice); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}

	closed, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 2 of 3 in favour: 2*3 >= 3*2.
	if closed.Outcome.String != OutcomePassed || closed.ClosedBy.String != ua.ID || !closed.ClosedAt.Valid ||
		closed.YesCount != 2 || closed.NoCount != 1 {
		t.Fatalf("closed = %+v", closed)
	}
	var from, to, actor, title, outcome string
	if err := s.pool.QueryRow(ctx, `
		SELECT from_state, to_state, actor_id, payload::jsonb->>'title', payload::jsonb->>'outcome'
		FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MOTION_CLOSED'`, m.ID).
		Scan(&from, &to, &actor, &title, &outcome); err != nil {
		t.Fatal(err)
	}
	if from != MotionOpen || to != OutcomePassed || actor != ua.ID || title != mo.Title || outcome != OutcomePassed {
		t.Fatalf("MOTION_CLOSED row = %s→%s by %s %q %q", from, to, actor, title, outcome)
	}
	var status, auditOutcome string
	if err := s.pool.QueryRow(ctx, `SELECT changes::jsonb->'status'->>'to', changes::jsonb->'outcome'->>'to'
		FROM audit_events WHERE action = 'meeting.motion_closed' AND resource_id = $1`, m.ID).Scan(&status, &auditOutcome); err != nil {
		t.Fatal(err)
	}
	if status != MotionClosed || auditOutcome != OutcomePassed {
		t.Fatalf("motion_closed audit = %s %s", status, auditOutcome)
	}
	var events int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'motion.closed' AND payload::jsonb->>'motion_id' = $1`, mo.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("motion.closed events = %d, want 1", events)
	}
}

// Spec §10.1: a secretary runs votes end to end — edits, deletes, opens and
// closes — not only drafts.
func TestCloseMotionBySecretary(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	first := draftVoteMotion(t, s, ub.ID, m.ID, "Thư ký soạn", BallotPublic, ThresholdMajority)
	spare := draftVoteMotion(t, s, ub.ID, m.ID, "Sẽ xóa", BallotPublic, ThresholdMajority)
	title := "Thư ký sửa"
	if _, err := s.UpdateMotion(ctx, ub.ID, m.ID, first.ID, MotionPatch{Title: &title}); err != nil {
		t.Fatalf("secretary edits: %v", err)
	}
	if err := s.DeleteMotion(ctx, ub.ID, m.ID, spare.ID); err != nil {
		t.Fatalf("secretary deletes: %v", err)
	}
	openVoteMotion(t, s, ub.ID, m.ID, first.ID)
	closed, err := s.CloseMotion(ctx, ub.ID, m.ID, first.ID)
	if err != nil {
		t.Fatalf("secretary closes: %v", err)
	}
	if closed.Status != MotionClosed || !closed.ClosedBy.Valid || closed.ClosedBy.String != ub.ID {
		t.Fatalf("closed = %+v, want CLOSED by the secretary %s", closed, ub.ID)
	}
}

func TestMotionRollSurvivesRemovalAndDemotion(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	yes, no := true, false
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	mo := draftVoteMotion(t, s, ub.ID, m.ID, "Thư ký mở", BallotPublic, ThresholdMajority)
	if opened := openVoteMotion(t, s, ub.ID, m.ID, mo.ID); opened.RollSize.Int32 != 2 {
		t.Fatalf("roll_size = %d, want 2", opened.RollSize.Int32)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	// Demoted mid-vote: the next close is refused at once; the host still closes.
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &no}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CloseMotion(ctx, ub.ID, m.ID, mo.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("demoted secretary closes: %v", err)
	}
	// Removed mid-vote: no ballot, but the roll keeps its size.
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, memberPID); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, mo.ID, ChoiceYes); !codedIs(err, "not_on_roll") || codedStatus(err) != http.StatusForbidden {
		t.Fatalf("removed voter: %v", err)
	}
	closed, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 1 of 2 in favour: the missing ballot counts as not in favour.
	if closed.RollSize.Int32 != 2 || closed.Outcome.String != OutcomeFailed {
		t.Fatalf("after removal: roll %d outcome %s, want 2 FAILED", closed.RollSize.Int32, closed.Outcome.String)
	}
}

// Tenant isolation (DoD): someone outside the meeting's workspace and
// organization reads nothing and changes nothing on its votes.
func TestMotionsRefuseAnotherOrganization(t *testing.T) {
	s, ua, outsider, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Họp HĐQT")
	if err != nil {
		t.Fatal(err)
	}
	mo, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{Title: "Ngân sách", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Motions(ctx, outsider.ID, "", m.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider lists motions: %v", err)
	}
	if _, err := s.CreateMotion(ctx, outsider.ID, m.ID, MotionInput{Title: "x", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider creates a motion: %v", err)
	}
	if _, err := s.OpenMotion(ctx, outsider.ID, m.ID, mo.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider opens a motion: %v", err)
	}
	if err := s.CastBallot(ctx, outsider.ID, "", m.ID, mo.ID, ChoiceYes); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider casts a ballot: %v", err)
	}
}
