package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The quorum is part of what a finalized roll records: changing it waits for
// a reopen, while resending the stored value (the edit dialog does) passes.
func TestUpdateQuorumLockedOnFinalizedRoll(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	ctx := context.Background()
	zero, sixty, seventy := 0, 60, 70
	// No quorum and finalized: "none" again is no change.
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &zero}); err != nil {
		t.Fatalf("resend empty quorum: %v", err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &sixty}); !codedIs(err, "attendance_finalized") {
		t.Fatalf("set quorum on a finalized roll: %v", err)
	}
	if err := s.ReopenAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: &sixty}); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeAttendance(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	title := "Giao ban tuần"
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title, QuorumPercent: &sixty})
	if err != nil || up.Title != title || up.QuorumPercent.Int16 != 60 {
		t.Fatalf("resend same quorum: %+v %v", up.QuorumPercent, err)
	}
	for _, v := range []*int{&seventy, &zero} {
		if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{QuorumPercent: v}); !codedIs(err, "attendance_finalized") {
			t.Fatalf("quorum %d on a finalized roll: %v", *v, err)
		}
	}
	got, err := s.q.GetMeeting(ctx, m.ID)
	if err != nil || got.QuorumPercent.Int16 != 60 {
		t.Fatalf("refused change was written: %+v %v", got.QuorumPercent, err)
	}
}

// A window that ends before it starts is refused before anything is written.
func TestUpdateRejectsInvertedWindowWithoutWriting(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Daily", StartsAt: start, EndsAt: start.Add(30 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	early, late := start.Add(-time.Hour), start.Add(time.Hour)
	title := "Đổi tên"
	for name, in := range map[string]UpdateMeetingInput{
		"ends before starts": {Title: &title, EndsAt: &early},
		"starts after ends":  {Title: &title, StartsAt: &late},
	} {
		var ve ValidationError
		if _, err := s.Update(ctx, ua.ID, m.ID, in); !errors.As(err, &ve) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	got, err := s.q.GetMeeting(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != m.Version || got.Title != m.Title || !got.EndsAt.Time.Equal(m.EndsAt.Time) || !got.StartsAt.Time.Equal(m.StartsAt.Time) {
		t.Fatalf("refused update was written: version %d→%d title %q", m.Version, got.Version, got.Title)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = 'meeting.updated' AND resource_id = $1`, m.ID); n != 0 {
		t.Fatalf("refused update audited: %d", n)
	}
	// Moving both ends together is fine.
	s2, e2 := start.Add(time.Hour), start.Add(90*time.Minute)
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{StartsAt: &s2, EndsAt: &e2}); err != nil {
		t.Fatal(err)
	}
}
