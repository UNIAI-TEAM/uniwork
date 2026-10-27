package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A meeting is online (a room) or in person (recorded in the room); the venue
// is chosen when scheduling and may change only before the meeting starts.
func TestMeetingVenue(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	in := func(title, venue string) CreateMeetingInput {
		return CreateMeetingInput{Title: title, StartsAt: start, EndsAt: start.Add(time.Hour), Venue: venue}
	}
	changedTo := func(action, id string) string {
		t.Helper()
		var to string
		if err := s.pool.QueryRow(ctx, `SELECT coalesce(changes::jsonb->'venue'->>'to', '') FROM audit_events
			WHERE action = $1 AND resource_id = $2`, action, id).Scan(&to); err != nil {
			t.Fatal(err)
		}
		return to
	}

	t.Run("default online", func(t *testing.T) {
		m, err := s.Create(ctx, ua.ID, w.ID, in("Mặc định", ""))
		if err != nil || m.Venue != MeetingVenueOnline {
			t.Fatalf("venue = %q, %v; want online", m.Venue, err)
		}
	})

	t.Run("in person stored", func(t *testing.T) {
		m, err := s.Create(ctx, ua.ID, w.ID, in("Trực tiếp", MeetingVenueInPerson))
		if err != nil || m.Venue != MeetingVenueInPerson {
			t.Fatalf("venue = %q, %v; want in_person", m.Venue, err)
		}
		if got := changedTo("meeting.created", m.ID); got != MeetingVenueInPerson {
			t.Fatalf("meeting.created diff venue = %q", got)
		}
	})

	t.Run("unknown refused", func(t *testing.T) {
		var ve ValidationError
		if _, err := s.Create(ctx, ua.ID, w.ID, in("Lai", "hybrid")); !errors.As(err, &ve) {
			t.Fatalf("hybrid: %v", err)
		}
	})

	t.Run("idempotency", func(t *testing.T) {
		first := in("Khoá", MeetingVenueOnline)
		first.IdempotencyKey = "k-venue"
		if _, err := s.Create(ctx, ua.ID, w.ID, first); err != nil {
			t.Fatal(err)
		}
		second := first
		second.Venue = MeetingVenueInPerson
		if _, err := s.Create(ctx, ua.ID, w.ID, second); !codedIs(err, "idempotency_payload_mismatch") {
			t.Fatalf("same key, another venue: %v", err)
		}
	})

	t.Run("update while scheduled", func(t *testing.T) {
		m, err := s.Create(ctx, ua.ID, w.ID, in("Đổi", ""))
		if err != nil {
			t.Fatal(err)
		}
		up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Venue: ptr(MeetingVenueInPerson)})
		if err != nil || up.Venue != MeetingVenueInPerson {
			t.Fatalf("update venue = %q, %v", up.Venue, err)
		}
		if got := changedTo("meeting.updated", m.ID); got != MeetingVenueInPerson {
			t.Fatalf("meeting.updated diff venue = %q", got)
		}
		var ve ValidationError
		if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Venue: ptr("hybrid")}); !errors.As(err, &ve) {
			t.Fatalf("update to hybrid: %v", err)
		}
	})

	t.Run("update after start refused", func(t *testing.T) {
		m, err := s.Create(ctx, ua.ID, w.ID, in("Đang họp", ""))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		var ve ValidationError
		if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Venue: ptr(MeetingVenueInPerson)}); !errors.As(err, &ve) {
			t.Fatalf("in progress: %v", err)
		}
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Venue: ptr(MeetingVenueInPerson)}); !codedIs(err, "invalid_meeting_state") {
			t.Fatalf("ended: %v", err)
		}
	})
}
