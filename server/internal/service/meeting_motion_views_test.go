package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingMeetingService is s rebuilt on a pool that counts statements, the
// workspace gate included, so a read path's cost is measured end to end.
func countingMeetingService(t *testing.T, s *MeetingService) (*MeetingService, *queryCounter) {
	t.Helper()
	counter := &queryCounter{}
	return tracedMeetingService(t, s, counter), counter
}

// tracedMeetingService is s rebuilt on a pool that reports every statement to
// tracer.
func tracedMeetingService(t *testing.T, s *MeetingService, tracer pgx.QueryTracer) *MeetingService {
	t.Helper()
	cfg := s.pool.Config()
	cfg.ConnConfig.Tracer = tracer
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("traced pool: %v", err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	ws := NewWorkspaceService(pool, q, NewOrganizationService(pool, q), mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	return NewMeetingService(pool, q, ws, NopPublisher{}, &meetings.FakeProvider{}, MeetingRuntime{TokenTTL: 2 * time.Minute, HMACKey: []byte("t")})
}

// closedPublicMotion opens a public motion, has everyone in voters vote YES,
// and closes it.
func closedPublicMotion(t *testing.T, s *MeetingService, hostID, meetingID, title string, voters ...func() error) db.MeetingMotion {
	t.Helper()
	mo := draftVoteMotion(t, s, hostID, meetingID, title, BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, hostID, meetingID, mo.ID)
	for _, vote := range voters {
		if err := vote(); err != nil {
			t.Fatal(err)
		}
	}
	closed, err := s.CloseMotion(context.Background(), hostID, meetingID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	return closed
}

func myBallotFor(t *testing.T, s *MeetingService, userID, guestID, meetingID, motionID string) (MyBallot, bool) {
	t.Helper()
	ballots, err := s.MyBallots(context.Background(), userID, guestID, meetingID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range ballots {
		if b.MotionID == motionID {
			return b, true
		}
	}
	return MyBallot{}, false
}

// The list carries tallies only, so every non-clerk gets the same body: the
// caller's own ballot and the named voters are separate reads.
func TestMotionsListIsTheSameForEveryone(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	g := newGuestParticipant(t, s, m.ID)
	closedPublicMotion(t, s, ua.ID, m.ID, "Đã đóng",
		func() error { return s.CastBallot(ctx, ua.ID, "", m.ID, lastOpenMotion(t, s, m.ID), ChoiceYes) })
	live := draftVoteMotion(t, s, ua.ID, m.ID, "Đang mở", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, live.ID)
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, live.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}

	member := motionsFor(t, s, ub.ID, "", m.ID)
	guest := motionsFor(t, s, "", g.GuestID.String, m.ID)
	if len(member) != 2 || len(guest) != len(member) {
		t.Fatalf("member sees %d, guest %d; want 2 each", len(member), len(guest))
	}
	for i := range member {
		if member[i].Motion.ID != guest[i].Motion.ID || member[i].CastCount != guest[i].CastCount ||
			(member[i].Result == nil) != (guest[i].Result == nil) {
			t.Fatalf("member and guest lists differ at %d: %+v vs %+v", i, member[i], guest[i])
		}
	}
	if v := viewByID(t, member, live.ID); v.CastCount != 1 || v.Result != nil {
		t.Fatalf("open motion in list = %+v", v)
	}
}

func TestMyBallots(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	g := newMemberGuest(t, s, ua.ID, m.ID)
	seedSession(t, s, m.ID, g.ID, "0 minutes", "")
	outsider := newGuestParticipant(t, s, m.ID) // OBSERVER: in the room, never on a roll

	public := draftVoteMotion(t, s, ua.ID, m.ID, "Công khai", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, public.ID)
	if b, ok := myBallotFor(t, s, ub.ID, "", m.ID, public.ID); !ok || b.Cast || b.Choice != "" {
		t.Fatalf("member's blank ballot = %+v on roll %v", b, ok)
	}
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, public.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}
	if b, ok := myBallotFor(t, s, ub.ID, "", m.ID, public.ID); !ok || !b.Cast || b.Choice != ChoiceNo {
		t.Fatalf("member's public ballot = %+v", b)
	}
	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, public.ID); err != nil {
		t.Fatal(err)
	}

	secret := draftVoteMotion(t, s, ua.ID, m.ID, "Kín", BallotSecret, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, secret.ID)
	if err := s.CastBallot(ctx, "", g.GuestID.String, m.ID, secret.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	if b, ok := myBallotFor(t, s, "", g.GuestID.String, m.ID, secret.ID); !ok || !b.Cast || b.Choice != "" {
		t.Fatalf("guest's secret ballot = %+v; a secret choice is never stored", b)
	}
	if b, ok := myBallotFor(t, s, "", outsider.GuestID.String, m.ID, secret.ID); ok {
		t.Fatalf("observer is on the roll: %+v", b)
	}
	if _, err := s.MyBallots(ctx, "", util.NewID(), m.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger guest reads ballots: %v", err)
	}
}

func TestMotionVoters(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	g := newGuestParticipant(t, s, m.ID)

	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Công khai", BallotPublic, ThresholdMajority)
	if _, err := s.MotionVoters(ctx, ub.ID, "", m.ID, mo.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member reads a draft's voters: %v", err)
	}
	if v, err := s.MotionVoters(ctx, ua.ID, "", m.ID, mo.ID); err != nil || v != nil {
		t.Fatalf("clerk on a draft = %+v, %v; want nil", v, err)
	}
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, ub.ID, "", m.ID, mo.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}
	// Who chose what stays hidden until the count is final, from the host too.
	if v, err := s.MotionVoters(ctx, ua.ID, "", m.ID, mo.ID); err != nil || v != nil {
		t.Fatalf("open motion voters = %+v, %v; want nil", v, err)
	}
	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	v, err := s.MotionVoters(ctx, "", g.GuestID.String, m.ID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v == nil || len(v.Yes) != 1 || v.Yes[0] != "A" || len(v.No) != 1 || v.No[0] != "B" ||
		v.Abstain == nil || len(v.Abstain) != 0 {
		t.Fatalf("voters = %+v", v)
	}

	secret := closedSecretMotion(t, s, ua.ID, m.ID)
	if v, err := s.MotionVoters(ctx, ub.ID, "", m.ID, secret.ID); err != nil || v != nil {
		t.Fatalf("secret motion voters = %+v, %v; want nil", v, err)
	}

	// A motion id from another meeting reads as not found.
	other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Khác")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.MotionVoters(ctx, ua.ID, "", other.ID, mo.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("motion read through another meeting: %v", err)
	}
	if _, err := s.MotionVoters(ctx, "", util.NewID(), m.ID, mo.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger guest reads voters: %v", err)
	}
}

func closedSecretMotion(t *testing.T, s *MeetingService, hostID, meetingID string) db.MeetingMotion {
	t.Helper()
	mo := draftVoteMotion(t, s, hostID, meetingID, "Kín", BallotSecret, ThresholdMajority)
	openVoteMotion(t, s, hostID, meetingID, mo.ID)
	if err := s.CastBallot(context.Background(), hostID, "", meetingID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	closed, err := s.CloseMotion(context.Background(), hostID, meetingID, mo.ID)
	if err != nil {
		t.Fatal(err)
	}
	return closed
}

// The list is what every client refetches on every ballot: its cost must not
// grow with the number of motions or voters, and stays a handful of
// statements whoever asks.
func TestMotionsListCostIsFlat(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, memberPID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	g := newGuestParticipant(t, s, m.ID)
	draftVoteMotion(t, s, ua.ID, m.ID, "Còn nháp", BallotPublic, ThresholdMajority)
	cs, counter := countingMeetingService(t, s)

	cost := func(userID, guestID string) int64 {
		t.Helper()
		counter.n.Store(0)
		if _, err := cs.Motions(ctx, userID, guestID, m.ID); err != nil {
			t.Fatal(err)
		}
		return counter.n.Load()
	}
	before := map[string]int64{"host": cost(ua.ID, ""), "member": cost(ub.ID, ""), "guest": cost("", g.GuestID.String)}
	for i := 0; i < 3; i++ {
		closedPublicMotion(t, s, ua.ID, m.ID, "Đã đóng",
			func() error { return s.CastBallot(ctx, ua.ID, "", m.ID, lastOpenMotion(t, s, m.ID), ChoiceYes) },
			func() error { return s.CastBallot(ctx, ub.ID, "", m.ID, lastOpenMotion(t, s, m.ID), ChoiceNo) })
	}
	after := map[string]int64{"host": cost(ua.ID, ""), "member": cost(ub.ID, ""), "guest": cost("", g.GuestID.String)}
	// The meeting, the gate (RequireMember for a member, the guest's
	// participant row for a guest) and the list; a member who is neither host
	// nor admin pays one secretary check, and only while drafts exist.
	limits := map[string]int64{"host": 3, "member": 4, "guest": 3}
	for who, n := range after {
		if n != before[who] {
			t.Errorf("%s: list cost grew from %d to %d statements with 3 closed motions", who, before[who], n)
		}
		if n > limits[who] {
			t.Errorf("%s: list took %d statements, want at most %d", who, n, limits[who])
		}
	}
}

// lastOpenMotion is the id of the meeting's open motion.
func lastOpenMotion(t *testing.T, s *MeetingService, meetingID string) string {
	t.Helper()
	mo, err := s.q.GetOpenMeetingMotion(context.Background(), meetingID)
	if err != nil {
		t.Fatal(err)
	}
	return mo.ID
}

// Opening writes the whole roll in one statement, however long it is.
func TestOpenMotionCostIsFlat(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	cs, counter := countingMeetingService(t, s)

	open := func() int64 {
		t.Helper()
		mo := draftVoteMotion(t, s, ua.ID, m.ID, "Nội dung", BallotPublic, ThresholdMajority)
		counter.n.Store(0)
		if _, err := cs.OpenMotion(context.Background(), ua.ID, m.ID, mo.ID); err != nil {
			t.Fatal(err)
		}
		n := counter.n.Load()
		if _, err := s.CloseMotion(context.Background(), ua.ID, m.ID, mo.ID); err != nil {
			t.Fatal(err)
		}
		return n
	}
	one := open()
	for i := 0; i < 4; i++ {
		g := newMemberGuest(t, s, ua.ID, m.ID)
		seedSession(t, s, m.ID, g.ID, "0 minutes", "")
	}
	if five := open(); five != one {
		t.Fatalf("opening for 5 voters took %d statements, for 1 took %d; the roll must be one insert", five, one)
	}
}

// A ballot holds the motion row only for the statements that must be inside
// it: the lock, the cast-and-count, the audit row and its event.
func TestCastBallotCost(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Nội dung", BallotPublic, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)
	cs, counter := countingMeetingService(t, s)
	counter.n.Store(0)
	if err := cs.CastBallot(context.Background(), ua.ID, "", m.ID, mo.ID, ChoiceYes); err != nil {
		t.Fatal(err)
	}
	// Outside the transaction: the meeting, the workspace gate and the
	// caller's participant row. Inside: begin, lock, cast-and-count,
	// recordResource's workspace lookup, the audit row, its event, commit.
	if n := counter.n.Load(); n > 10 {
		t.Fatalf("a ballot took %d statements, want at most 10", n)
	}
}

// argRecorder keeps every statement's parameters, as a server that logs slow
// statements with their parameters (log_min_duration_statement) would.
type argRecorder struct {
	mu    sync.Mutex
	stmts [][]string
}

func (r *argRecorder) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	args := make([]string, 0, len(data.Args))
	for _, a := range data.Args {
		args = append(args, fmt.Sprint(a))
	}
	r.mu.Lock()
	r.stmts = append(r.stmts, args)
	r.mu.Unlock()
	return ctx
}

func (r *argRecorder) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// A secret choice reaches the motion's counters, and no statement that names
// the voter carries it: one statement holding both the participant and the
// choice would tie them together in any statement log that keeps parameters.
func TestSecretBallotNeverSendsChoiceWithVoter(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	mo := draftVoteMotion(t, s, ua.ID, m.ID, "Kín", BallotSecret, ThresholdMajority)
	openVoteMotion(t, s, ua.ID, m.ID, mo.ID)

	rec := &argRecorder{}
	cs := tracedMeetingService(t, s, rec)

	if err := cs.CastBallot(context.Background(), ua.ID, "", m.ID, mo.ID, ChoiceAbstain); err != nil {
		t.Fatal(err)
	}
	counted, err := s.q.GetMeetingMotion(context.Background(), db.GetMeetingMotionParams{ID: mo.ID, MeetingID: m.ID})
	if err != nil || counted.AbstainCount != 1 {
		t.Fatalf("secret ballot counted = %+v, %v; want one ABSTAIN", counted, err)
	}
	for _, args := range rec.stmts {
		voter, choice := false, false
		for _, a := range args {
			voter = voter || a == host.ID
			choice = choice || a == ChoiceAbstain
		}
		if voter && choice {
			t.Fatalf("a statement carries both the voter and the secret choice: %v", args)
		}
	}
}
