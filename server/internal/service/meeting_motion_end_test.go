package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// motionAfterEnd reloads one motion of a meeting by id.
func motionAfterEnd(t *testing.T, s *MeetingService, meetingID, motionID string) db.MeetingMotion {
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
	t.Fatalf("motion %s not found in meeting %s", motionID, meetingID)
	return db.MeetingMotion{}
}

// motionClosedRow returns the single MOTION_CLOSED timeline row of a meeting.
func motionClosedRow(t *testing.T, s *MeetingService, userID, meetingID string) db.MeetingAuditLog {
	t.Helper()
	acts, err := s.Activity(context.Background(), userID, meetingID, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	var rows []db.MeetingAuditLog
	for _, a := range acts {
		if a.EventType == "MOTION_CLOSED" {
			rows = append(rows, a)
		}
	}
	if len(rows) != 1 {
		t.Fatalf("MOTION_CLOSED timeline rows = %d, want 1", len(rows))
	}
	return rows[0]
}

// motionClosedAuditActor returns the actor of the single meeting.motion_closed
// audit event recorded against a meeting.
func motionClosedAuditActor(t *testing.T, s *MeetingService, meetingID string) (string, string) {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT actor_kind, actor_id FROM audit_events WHERE action = 'meeting.motion_closed' AND resource_id = $1`, meetingID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var kind, id string
	n := 0
	for rows.Next() {
		if err := rows.Scan(&kind, &id); err != nil {
			t.Fatal(err)
		}
		n++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("meeting.motion_closed audit rows = %d, want 1", n)
	}
	return kind, id
}

func TestEndClosesOpenMotion(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	host := hostParticipant(t, s, m.ID, ua.ID)
	for _, pid := range []string{host.ID, memberPID} {
		if err := s.MarkAttendance(ctx, ua.ID, m.ID, pid, AttendancePresent, ""); err != nil {
			t.Fatal(err)
		}
	}
	open, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{
		Title: "Thông qua kế hoạch quý IV", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent,
	})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{
		Title: "Bầu thư ký", BallotMode: BallotSecret, Threshold: ThresholdTwoThirds, Base: BaseAllMembers,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, open.ID); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{ua.ID, ub.ID} {
		if err := s.CastBallot(ctx, uid, "", m.ID, open.ID, ChoiceYes); err != nil {
			t.Fatal(err)
		}
	}

	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil || ended.Status != MeetingEnded {
		t.Fatalf("end: %+v err=%v", ended.Status, err)
	}

	got := motionAfterEnd(t, s, m.ID, open.ID)
	if got.Status != MotionClosed {
		t.Fatalf("motion status = %s, want CLOSED", got.Status)
	}
	if got.Outcome.String != OutcomePassed || got.YesCount != 2 || got.RollSize.Int32 != 2 {
		t.Fatalf("closed motion outcome=%q yes=%d roll=%d", got.Outcome.String, got.YesCount, got.RollSize.Int32)
	}
	if !got.ClosedAt.Valid || !got.ClosedBy.Valid || got.ClosedBy.String != ua.ID {
		t.Fatalf("closed_at=%v closed_by=%v, want host %s", got.ClosedAt.Valid, got.ClosedBy, ua.ID)
	}
	if d := motionAfterEnd(t, s, m.ID, draft.ID); d.Status != MotionDraft || d.Outcome.Valid || d.ClosedAt.Valid {
		t.Fatalf("draft after end = status %s outcome %v", d.Status, d.Outcome)
	}

	row := motionClosedRow(t, s, ua.ID, m.ID)
	if row.ActorID != ua.ID || row.FromState.String != MotionOpen || row.ToState.String != OutcomePassed {
		t.Fatalf("timeline row actor=%q %s→%s", row.ActorID, row.FromState.String, row.ToState.String)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(row.Payload), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["title"] != open.Title || payload["outcome"] != OutcomePassed {
		t.Fatalf("timeline payload = %v", payload)
	}
	kind, actorID := motionClosedAuditActor(t, s, m.ID)
	if kind != "human" || actorID != ua.ID {
		t.Fatalf("audit actor = %s/%s, want human/%s", kind, actorID, ua.ID)
	}
	var events int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'motion.closed' AND payload::jsonb->>'motion_id' = $1`, open.ID,
	).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("motion.closed outbox rows = %d, want 1", events)
	}
}

func TestAutoEndClosesOpenMotionAsSystem(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	past := time.Now().Add(-5 * time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Họp quá giờ", StartsAt: past, EndsAt: past.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: m.ID, Version: m.Version}); err != nil {
		t.Fatal(err)
	}
	host := hostParticipant(t, s, m.ID, ua.ID)
	if err := s.MarkAttendance(ctx, ua.ID, m.ID, host.ID, AttendancePresent, ""); err != nil {
		t.Fatal(err)
	}
	mo, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{
		Title: "Thông qua dự toán", BallotMode: BallotSecret, Threshold: ThresholdTwoThirds, Base: BasePresent,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.CastBallot(ctx, ua.ID, "", m.ID, mo.ID, ChoiceNo); err != nil {
		t.Fatal(err)
	}

	n, err := s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("auto-ended %d err=%v", n, err)
	}
	gotMeeting, err := s.Get(ctx, ua.ID, m.ID)
	if err != nil || gotMeeting.Status != MeetingEnded {
		t.Fatalf("meeting status %s err=%v", gotMeeting.Status, err)
	}

	got := motionAfterEnd(t, s, m.ID, mo.ID)
	if got.Status != MotionClosed {
		t.Fatalf("motion status = %s, want CLOSED", got.Status)
	}
	if got.Outcome.String != OutcomeFailed || got.NoCount != 1 || got.YesCount != 0 {
		t.Fatalf("closed motion outcome=%q yes=%d no=%d", got.Outcome.String, got.YesCount, got.NoCount)
	}
	if got.ClosedBy.Valid || !got.ClosedAt.Valid {
		t.Fatalf("auto-closed motion closed_by=%v closed_at=%v, want NULL / set", got.ClosedBy, got.ClosedAt.Valid)
	}
	row := motionClosedRow(t, s, ua.ID, m.ID)
	if row.ActorID != systemActorID || row.ToState.String != OutcomeFailed {
		t.Fatalf("timeline row actor=%q to=%s", row.ActorID, row.ToState.String)
	}
	kind, actorID := motionClosedAuditActor(t, s, m.ID)
	if kind != "system" || actorID != "meeting-auto-end" {
		t.Fatalf("audit actor = %s/%s, want system/meeting-auto-end", kind, actorID)
	}
}

func TestEndWithNoMotions(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil || ended.Status != MeetingEnded {
		t.Fatalf("end: %s err=%v", ended.Status, err)
	}
	list, err := s.q.ListMeetingMotions(ctx, m.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("motions after end = %d err=%v", len(list), err)
	}
	acts, err := s.Activity(ctx, ua.ID, m.ID, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range acts {
		if a.EventType == "MOTION_CLOSED" {
			t.Fatal("MOTION_CLOSED written for a meeting without motions")
		}
	}
}
