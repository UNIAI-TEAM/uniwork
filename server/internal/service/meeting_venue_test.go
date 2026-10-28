package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

func inPersonMeeting(t *testing.T, s *MeetingService, userID, workspaceID string) db.Meeting {
	t.Helper()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(context.Background(), userID, workspaceID, CreateMeetingInput{
		Title: "Họp tại phòng", StartsAt: start, EndsAt: start.Add(time.Hour), Venue: MeetingVenueInPerson,
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// An in-person meeting is recorded in the room, never held in one.
func TestInPersonMeetingNeverOpensARoom(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	if _, err := s.Start(context.Background(), ua.ID, m.ID); !codedIs(err, "meeting_in_person") {
		t.Fatalf("start in person: %v", err)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_conference_sessions WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("conference sessions = %d", n)
	}
}

// No room ever opens for an in-person meeting, so no guest link is made for one.
func TestInPersonMeetingTakesNoGuestLink(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	_, err := s.CreateInviteLink(context.Background(), ua.ID, m.ID, "ext", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if !codedIs(err, "meeting_in_person") {
		t.Fatalf("guest link in person: %v", err)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_invite_links WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("invite links = %d", n)
	}
}

func TestInstantInPersonStaysScheduled(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	in := InstantMeetingInput{Title: "Họp nhanh", Venue: MeetingVenueInPerson, IdempotencyKey: "k1"}
	m, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if m.Status != MeetingScheduled || m.MeetingType != MeetingTypeInstant || m.Venue != MeetingVenueInPerson {
		t.Fatalf("instant in person = %s %s %s", m.Status, m.MeetingType, m.Venue)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM meeting_conference_sessions WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("conference sessions = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'provider.ensure_session' AND payload::jsonb->>'meeting_id' = $1`, m.ID); n != 0 {
		t.Fatalf("provider.ensure_session rows = %d", n)
	}
	if n := countWhere(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'meeting.created' AND payload::jsonb->>'meeting_id' = $1`, m.ID); n != 1 {
		t.Fatalf("meeting.created rows = %d", n)
	}
	replayed, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, in)
	if err != nil || replayed.ID != m.ID || replayed.Status != MeetingScheduled {
		t.Fatalf("replay = %s %s %v, want %s SCHEDULED", replayed.ID, replayed.Status, err, m.ID)
	}
	online := in
	online.Venue = MeetingVenueOnline
	if _, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, online); !codedIs(err, "idempotency_payload_mismatch") {
		t.Fatalf("same key, another venue: %v", err)
	}
	var ve ValidationError
	if _, err := s.CreateInstantKeyed(ctx, ua.ID, w.ID, InstantMeetingInput{Venue: "hybrid"}); !errors.As(err, &ve) {
		t.Fatalf("hybrid: %v", err)
	}
}

func TestCalendarInviteOfAnInPersonMeetingHasNoDialIn(t *testing.T) {
	s, _, ua, _, online := dialInFixture(t)
	ctx := context.Background()
	m := inPersonMeeting(t, s, ua.ID, online.WorkspaceID)
	ics, err := s.CalendarICS(ctx, ua.ID, m.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ics), "Gọi vào bằng điện thoại") {
		t.Fatalf("in-person invite carries the dial-in line:\n%s", ics)
	}
	if ics, _ := s.CalendarICS(ctx, ua.ID, online.ID, ""); !strings.Contains(string(ics), "Gọi vào bằng điện thoại") {
		t.Fatalf("online invite lost the dial-in line:\n%s", ics)
	}
}

func TestSecretaryRecordsTheMeetingHeld(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	uc, err := s.q.CreateUser(ctx, db.CreateUserParams{ID: util.NewID(), Email: "venue-c@example.com", DisplayName: "C", Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addMember(t, s, w.ID, uc.ID)
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	sec, err := s.Invite(ctx, ua.ID, m.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, uc.ID); err != nil {
		t.Fatal(err)
	}
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, sec.ID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	began := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if _, err := s.RecordHeld(ctx, uc.ID, m.ID, began, began.Add(time.Hour)); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("plain member: %v", err)
	}
	if ended, err := s.RecordHeld(ctx, ub.ID, m.ID, began, began.Add(time.Hour)); err != nil || ended.Status != MeetingEnded {
		t.Fatalf("secretary: %s %v", ended.Status, err)
	}
}

// The held times come from the server's clock: the browser sends only how
// long it recorded and how long ago it stopped.
func TestRecordHeldNowUsesServerClock(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	ended, err := s.RecordHeldNow(ctx, ua.ID, m.ID, 42*time.Minute, 0)
	if err != nil {
		t.Fatal(err)
	}
	if skew := time.Since(ended.ActualEndAt.Time); skew < -5*time.Second || skew > 5*time.Second {
		t.Fatalf("actual_end_at %v is %v from now", ended.ActualEndAt.Time, skew)
	}
	if got := ended.ActualEndAt.Time.Sub(ended.ActualStartAt.Time); got != 42*time.Minute {
		t.Fatalf("held for %v, want 42m", got)
	}
}

// A recording sent later keeps the meeting's real time: it ended `ago`
// before the server heard of it, not when the send arrived.
func TestRecordHeldNowEndsAgoBeforeNow(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	ended, err := s.RecordHeldNow(ctx, ua.ID, m.ID, time.Hour, 2*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if skew := time.Since(ended.ActualEndAt.Time) - 2*time.Hour; skew < -5*time.Second || skew > 5*time.Second {
		t.Fatalf("actual_end_at %v is %v from now - 2h", ended.ActualEndAt.Time, skew)
	}
	if got := ended.ActualEndAt.Time.Sub(ended.ActualStartAt.Time); got != time.Hour {
		t.Fatalf("held for %v, want 1h", got)
	}
}

// The length is at most a day and the end at most 30 days back, never ahead.
func TestRecordHeldNowRefusesOutOfBounds(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m := inPersonMeeting(t, s, ua.ID, w.ID)
	for _, c := range []struct{ d, ago time.Duration }{
		{0, 0}, {-time.Minute, 0}, {24*time.Hour + time.Second, 0},
		{time.Hour, -time.Second}, {time.Hour, 30*24*time.Hour + time.Second},
	} {
		if _, err := s.RecordHeldNow(ctx, ua.ID, m.ID, c.d, c.ago); !codedIs(err, "invalid_held_times") {
			t.Fatalf("d = %v, ago = %v: %v", c.d, c.ago, err)
		}
	}
	if got := reloadMeeting(t, s, m.ID).Status; got != MeetingScheduled {
		t.Fatalf("status %s after refusals", got)
	}
	if _, err := s.RecordHeldNow(ctx, ua.ID, m.ID, 24*time.Hour, 30*24*time.Hour); err != nil {
		t.Fatalf("the bounds themselves: %v", err)
	}
}

// An in-person meeting opens no room, so nobody can call into it: no number,
// no PIN shown, none drawn or rotated, no SIP rule.
func TestInPersonMeetingTakesNoDialIn(t *testing.T) {
	s, _, ua, _, online := dialInFixture(t)
	ctx := context.Background()
	m := inPersonMeeting(t, s, ua.ID, online.WorkspaceID)
	before := reloadMeeting(t, s, m.ID).DialInPin
	d, err := s.DialIn(ctx, ua.ID, m.ID)
	if err != nil || d.Enabled || d.Pin != "" || d.Number != "" {
		t.Fatalf("dial-in of an in-person meeting = %+v, %v", d, err)
	}
	if _, err := s.RotateDialInPin(ctx, ua.ID, m.ID); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("rotate: %v", err)
	}
	if after := reloadMeeting(t, s, m.ID); after.DialInPin != before || after.SipDispatchRuleID.Valid {
		t.Fatalf("pin %v -> %v, rule %v", before, after.DialInPin, after.SipDispatchRuleID)
	}
	if d, err := s.DialIn(ctx, ua.ID, online.ID); err != nil || !d.Enabled {
		t.Fatalf("online meeting lost dial-in: %+v, %v", d, err)
	}
}
