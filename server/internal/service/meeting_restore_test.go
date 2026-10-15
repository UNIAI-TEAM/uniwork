package service

import (
	"context"
	"testing"
	"time"
)

// restoreRows counts the outbox rows of a topic that name a meeting.
func restoreRows(t *testing.T, s *MeetingService, meetingID, topic string) (n int) {
	t.Helper()
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'meeting_id' = $2`, topic, meetingID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRestoreBringsBackACancelledMeeting(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(2 * time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Giao ban", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "Asia/Ho_Chi_Minh"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAt(ctx, ua.ID, m.ID, "nhầm", m.Version-1); !codedIs(err, "revision_conflict") {
		t.Fatalf("cancel at a stale version: %v", err)
	}
	if err := s.CancelAt(ctx, ua.ID, m.ID, "nhầm", m.Version); err != nil {
		t.Fatal(err)
	}
	canceled, _ := s.Get(ctx, ua.ID, m.ID)
	if !canceled.CanceledBy.Valid || !canceled.CanceledAt.Valid || canceled.CancelReason.String != "nhầm" {
		t.Fatalf("cancelled meeting = %+v", canceled)
	}
	addMember(t, s, w.ID, ub.ID)
	if _, err := s.Restore(ctx, ub.ID, m.ID, nil); err == nil {
		t.Fatal("a plain member restored the meeting")
	}
	// A revision the meeting has moved past is refused and writes nothing.
	stale := canceled.Version - 1
	if _, err := s.Restore(ctx, ua.ID, m.ID, &stale); !codedIs(err, "revision_conflict") {
		t.Fatalf("restore at a stale version: %v", err)
	}
	if got, _ := s.Get(ctx, ua.ID, m.ID); got.Status != MeetingCanceled || got.Version != canceled.Version || restoreRows(t, s, m.ID, "meeting.updated") != 0 {
		t.Fatalf("a refused restore wrote: %+v", got)
	}
	restored, err := s.Restore(ctx, ua.ID, m.ID, &canceled.Version)
	if err != nil {
		t.Fatal(err)
	}
	// The cancellation is undone whole: nothing of it is left on the row.
	if restored.Status != MeetingScheduled || restored.Version != canceled.Version+1 || restored.CancelReason.Valid || restored.CanceledBy.Valid || restored.CanceledAt.Valid {
		t.Fatalf("restored = %+v", restored)
	}
	// The realtime event refreshes every open list, and the meeting's own
	// timeline says who brought it back.
	if n := restoreRows(t, s, m.ID, "meeting.updated"); n != 1 {
		t.Fatalf("meeting.updated outbox rows = %d, want 1", n)
	}
	var timeline int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MEETING_RESTORED' AND actor_id = $2 AND from_state = $3 AND to_state = $4`,
		m.ID, ua.ID, MeetingCanceled, MeetingScheduled).Scan(&timeline); err != nil || timeline != 1 {
		t.Fatalf("MEETING_RESTORED timeline rows = %d (%v), want 1", timeline, err)
	}
	if _, err := s.Restore(ctx, ua.ID, m.ID, nil); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("restoring a scheduled meeting: %v", err)
	}
	var rows int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.restored' AND resource_id = $1`, m.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("meeting.restored rows = %d", rows)
	}
}

func TestRestoreRefusesAMeetingWhoseTimeHasPassed(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Đã qua", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Cancel(ctx, ua.ID, m.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restore(ctx, ua.ID, m.ID, nil); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("restoring a past meeting: %v", err)
	}
}

func TestUpdateMeetingChecksTheExpectedVersion(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "A", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	stale := m.Version - 1
	title := "B"
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title, ExpectedVersion: &stale}); !codedIs(err, "revision_conflict") {
		t.Fatalf("stale update: %v", err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title, ExpectedVersion: &m.Version}); err != nil {
		t.Fatal(err)
	}
}
