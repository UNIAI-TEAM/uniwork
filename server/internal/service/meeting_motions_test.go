package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func draftMotion(title string) MotionInput {
	return MotionInput{Title: title, BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent}
}

func mustCreateMotion(t *testing.T, s *MeetingService, actorID, meetingID, title string) db.MeetingMotion {
	t.Helper()
	mo, err := s.CreateMotion(context.Background(), actorID, meetingID, draftMotion(title))
	if err != nil {
		t.Fatalf("create motion %q: %v", title, err)
	}
	return mo
}

func motionByID(t *testing.T, s *MeetingService, meetingID, motionID string) db.MeetingMotion {
	t.Helper()
	list, err := s.q.ListMeetingMotions(context.Background(), meetingID)
	if err != nil {
		t.Fatal(err)
	}
	for _, mo := range list {
		if mo.ID == motionID {
			return mo
		}
	}
	t.Fatalf("motion %s not found", motionID)
	return db.MeetingMotion{}
}

func TestCreateMotionClerks(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()

	// A member who is neither host nor secretary cannot draft.
	if _, err := s.CreateMotion(ctx, ub.ID, m.ID, draftMotion("Không được")); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member drafts: %v", err)
	}
	// The host drafts; text is trimmed and the rules are stored as given.
	mo, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{
		Title: "  Thông qua kế hoạch quý IV  ", Description: " Ngân sách kèm theo ",
		BallotMode: BallotSecret, Threshold: ThresholdTwoThirds, Base: BaseAllMembers,
	})
	if err != nil {
		t.Fatal(err)
	}
	if mo.Status != MotionDraft || mo.Title != "Thông qua kế hoạch quý IV" || mo.Description != "Ngân sách kèm theo" ||
		mo.BallotMode != BallotSecret || mo.Threshold != ThresholdTwoThirds || mo.Base != BaseAllMembers ||
		mo.Position != 1 || mo.CreatedBy != ua.ID || mo.OrganizationID == "" || mo.WorkspaceID != m.WorkspaceID {
		t.Fatalf("created motion = %+v", mo)
	}
	// A secretary drafts too, and lands after the host's item.
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateMotion(ctx, ub.ID, m.ID, draftMotion("Bầu tổ trưởng"))
	if err != nil {
		t.Fatalf("secretary drafts: %v", err)
	}
	if second.Position != 2 {
		t.Fatalf("second position = %d, want 2", second.Position)
	}
}

func TestCreateMotionMeetingState(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	scheduled, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Họp tuần", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	// Drafting ahead of the meeting is the point of drafts.
	if _, err := s.CreateMotion(ctx, ua.ID, scheduled.ID, draftMotion("Chuẩn bị trước")); err != nil {
		t.Fatalf("scheduled meeting: %v", err)
	}
	if err := s.Cancel(ctx, ua.ID, scheduled.ID, "dời lịch"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateMotion(ctx, ua.ID, scheduled.ID, draftMotion("Sau khi hủy")); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("canceled meeting: %v", err)
	}
	live, err := s.CreateInstant(ctx, ua.ID, w.ID, "Họp nhanh")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, live.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateMotion(ctx, ua.ID, live.ID, draftMotion("Sau khi kết thúc")); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("ended meeting: %v", err)
	}
}

func TestCreateMotionValidation(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	cases := map[string]MotionInput{
		"empty title":      {Title: "   ", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent},
		"201-rune title":   {Title: strings.Repeat("đ", 201), BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent},
		"long description": {Title: "Ổn", Description: strings.Repeat("ă", 2001), BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent},
		"bad ballot mode":  {Title: "Ổn", BallotMode: "OPEN", Threshold: ThresholdMajority, Base: BasePresent},
		"bad threshold":    {Title: "Ổn", BallotMode: BallotPublic, Threshold: "UNANIMOUS", Base: BasePresent},
		"bad base":         {Title: "Ổn", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: "EVERYONE"},
	}
	for name, in := range cases {
		if _, err := s.CreateMotion(ctx, ua.ID, m.ID, in); !isValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	// The limits count runes, not bytes: exactly 200 / 2000 Vietnamese letters pass.
	if _, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{
		Title: strings.Repeat("đ", 200), Description: strings.Repeat("ă", 2000),
		BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent,
	}); err != nil {
		t.Fatalf("at the limits: %v", err)
	}
}

func TestCreateMotionPositionsAndEvent(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	a := mustCreateMotion(t, s, ua.ID, m.ID, "Một")
	b := mustCreateMotion(t, s, ua.ID, m.ID, "Hai")
	c := mustCreateMotion(t, s, ua.ID, m.ID, "Ba")
	if a.Position != 1 || b.Position != 2 || c.Position != 3 {
		t.Fatalf("positions = %d %d %d, want 1 2 3", a.Position, b.Position, c.Position)
	}
	// Deleting the middle leaves a gap; the next item still goes last.
	if err := s.DeleteMotion(ctx, ua.ID, m.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	if d := mustCreateMotion(t, s, ua.ID, m.ID, "Bốn"); d.Position != 4 {
		t.Fatalf("after delete position = %d, want 4", d.Position)
	}
	// The outbox carries ids only: meeting, version and the motion.
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'motion.created'
		   AND payload::jsonb->>'motion_id' = $1 AND payload::jsonb->>'meeting_id' = $2
		   AND payload::jsonb ? 'version' AND NOT payload::jsonb ? 'title'`, a.ID, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("motion.created outbox rows for %s = %d, want 1", a.ID, n)
	}
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE action = 'meeting.motion_created' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Fatalf("motion_created audit rows = %d, want 4", n)
	}
}

func TestUpdateMotionDraft(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	mo := mustCreateMotion(t, s, ua.ID, m.ID, "Bản nháp")
	title, mode := "  Bản sửa  ", BallotSecret

	if _, err := s.UpdateMotion(ctx, ub.ID, m.ID, mo.ID, MotionPatch{Title: &title}); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member edits: %v", err)
	}
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, mo.ID, MotionPatch{}); !isValidation(err) {
		t.Fatalf("empty patch: %v", err)
	}
	long := strings.Repeat("x", 201)
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, mo.ID, MotionPatch{Title: &long}); !isValidation(err) {
		t.Fatalf("long title: %v", err)
	}
	bad := "SOMETIMES"
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, mo.ID, MotionPatch{Threshold: &bad}); !isValidation(err) {
		t.Fatalf("bad threshold: %v", err)
	}
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, "nope", MotionPatch{Title: &title}); err != ErrNotFound {
		t.Fatalf("unknown motion: %v", err)
	}

	up, err := s.UpdateMotion(ctx, ua.ID, m.ID, mo.ID, MotionPatch{Title: &title, BallotMode: &mode})
	if err != nil {
		t.Fatal(err)
	}
	// Fields left nil keep their value.
	if up.Title != "Bản sửa" || up.BallotMode != BallotSecret || up.Threshold != ThresholdMajority ||
		up.Base != BasePresent || up.Position != 1 || up.Version != mo.Version+1 {
		t.Fatalf("updated = %+v", up)
	}
	var from, to string
	var hasThreshold bool
	if err := s.pool.QueryRow(ctx,
		`SELECT changes::jsonb->'title'->>'from', changes::jsonb->'title'->>'to', changes::jsonb ? 'threshold'
		   FROM audit_events WHERE action = 'meeting.motion_updated' AND resource_id = $1`, m.ID).Scan(&from, &to, &hasThreshold); err != nil {
		t.Fatal(err)
	}
	if from != "Bản nháp" || to != "Bản sửa" || hasThreshold {
		t.Fatalf("audit title %q -> %q, threshold logged = %v", from, to, hasThreshold)
	}
}

func TestUpdateMotionSwapsPosition(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	a := mustCreateMotion(t, s, ua.ID, m.ID, "A")
	b := mustCreateMotion(t, s, ua.ID, m.ID, "B")
	c := mustCreateMotion(t, s, ua.ID, m.ID, "C")

	// Move B up: it takes position 1, A takes B's old position 2.
	one := int32(1)
	up, err := s.UpdateMotion(ctx, ua.ID, m.ID, b.ID, MotionPatch{Position: &one})
	if err != nil {
		t.Fatal(err)
	}
	if up.Position != 1 || motionByID(t, s, m.ID, a.ID).Position != 2 {
		t.Fatalf("after swap B=%d A=%d, want 1 and 2", up.Position, motionByID(t, s, m.ID, a.ID).Position)
	}
	zero := int32(0)
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, b.ID, MotionPatch{Position: &zero}); !isValidation(err) {
		t.Fatalf("position 0: %v", err)
	}

	// An item that is no longer a draft holds its place.
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_motions SET status = 'OPEN' WHERE id = $1`, c.ID); err != nil {
		t.Fatal(err)
	}
	three := int32(3)
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, a.ID, MotionPatch{Position: &three}); !codedIs(err, "motion_not_draft") {
		t.Fatalf("swap with open item: %v", err)
	}
	if got := motionByID(t, s, m.ID, a.ID).Position; got != 2 {
		t.Fatalf("refused swap moved A to %d", got)
	}
	// And the open item itself can be neither edited nor deleted.
	title := "Đổi khi đang mở"
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, c.ID, MotionPatch{Title: &title}); !codedIs(err, "motion_not_draft") {
		t.Fatalf("edit open item: %v", err)
	}
	if err := s.DeleteMotion(ctx, ua.ID, m.ID, c.ID); !codedIs(err, "motion_not_draft") {
		t.Fatalf("delete open item: %v", err)
	}
}

func TestDeleteMotionDraft(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	mo := mustCreateMotion(t, s, ua.ID, m.ID, "Sẽ xóa")
	if err := s.DeleteMotion(ctx, ub.ID, m.ID, mo.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member deletes: %v", err)
	}
	if err := s.DeleteMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	list, err := s.q.ListMeetingMotions(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("motions after delete = %d, want 0", len(list))
	}
	if err := s.DeleteMotion(ctx, ua.ID, m.ID, mo.ID); err != ErrNotFound {
		t.Fatalf("delete twice: %v", err)
	}
	// The row is gone, so the audit entry is the only place that still says
	// which item was deleted.
	var n int
	var title string
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*), max(changes::jsonb->'title'->>'from') FROM audit_events
		  WHERE action = 'meeting.motion_deleted' AND resource_id = $1`, m.ID).Scan(&n, &title); err != nil {
		t.Fatal(err)
	}
	if n != 1 || title != "Sẽ xóa" {
		t.Fatalf("motion_deleted audit rows = %d, title %q; want 1, \"Sẽ xóa\"", n, title)
	}
}

// A motion id from another meeting is not found through this one.
func TestMotionBelongsToItsMeeting(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Họp khác")
	if err != nil {
		t.Fatal(err)
	}
	mo := mustCreateMotion(t, s, ua.ID, other.ID, "Của cuộc họp khác")
	title := "Lạc chỗ"
	if _, err := s.UpdateMotion(ctx, ua.ID, m.ID, mo.ID, MotionPatch{Title: &title}); err != ErrNotFound {
		t.Fatalf("update through the wrong meeting: %v", err)
	}
	if err := s.DeleteMotion(ctx, ua.ID, m.ID, mo.ID); err != ErrNotFound {
		t.Fatalf("delete through the wrong meeting: %v", err)
	}
}

// The web switches on these codes and statuses (toasts, disabled states), so
// they are part of the API, not wording.
func TestMotionErrorCodes(t *testing.T) {
	cases := []struct {
		err    error
		code   string
		status int
	}{
		{errMotionNotDraft(), "motion_not_draft", http.StatusConflict},
		{errMotionNotOpen(), "motion_not_open", http.StatusConflict},
		{errMotionAlreadyOpen(), "motion_already_open", http.StatusConflict},
		{errAlreadyVoted(), "already_voted", http.StatusConflict},
		{errNotOnRoll(), "not_on_roll", http.StatusForbidden},
	}
	for _, c := range cases {
		var ce CodedError
		if !errors.As(c.err, &ce) || ce.Code != c.code || ce.Status != c.status {
			t.Errorf("%v = %+v, want %s/%d", c.err, ce, c.code, c.status)
		}
	}
}
