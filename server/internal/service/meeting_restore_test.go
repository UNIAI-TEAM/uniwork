package service

import (
	"context"
	"testing"
	"time"
)

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
	addMember(t, s, w.ID, ub.ID)
	if _, err := s.Restore(ctx, ub.ID, m.ID, nil); err == nil {
		t.Fatal("a plain member restored the meeting")
	}
	restored, err := s.Restore(ctx, ua.ID, m.ID, &canceled.Version)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != MeetingScheduled || restored.CancelReason.Valid || restored.Version != canceled.Version+1 {
		t.Fatalf("restored = %+v", restored)
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
