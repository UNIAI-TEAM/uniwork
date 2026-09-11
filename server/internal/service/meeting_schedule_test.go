package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestMeetingPastScheduledEndJoinAndStart(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	pastStart := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	pastEnd := time.Now().Add(-30 * time.Minute).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Past", StartsAt: pastStart, EndsAt: pastEnd,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err == nil {
		t.Fatal("expected start to fail after scheduled end")
	} else {
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "meeting_past_scheduled_end" {
			t.Fatalf("start error: %v", err)
		}
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	dec, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err == nil || dec.Decision != DecisionDeny || dec.Reason != "MEETING_PAST_SCHEDULED_END" {
		t.Fatalf("evaluate invited: %+v %v", dec, err)
	}
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "meeting_past_scheduled_end" {
		t.Fatalf("evaluate error: %v", err)
	}
}

func TestAutoEndOverdueAtScheduledEnd(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	pastStart := time.Now().Add(-2 * time.Hour)
	pastEnd := time.Now().Add(-5 * time.Minute)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Overdue", StartsAt: pastStart, EndsAt: pastEnd,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Start in the past is blocked once ends_at passed; simulate a meeting that
	// started on time and outlived its scheduled end.
	_, err = s.q.StartMeeting(ctx, db.StartMeetingParams{
		UpdatedBy: strText(ua.ID), ID: m.ID, Version: m.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, _ := s.q.GetOpenConferenceSession(ctx, m.ID)
	if sess.ID == "" {
		sess, err = s.q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
			ID: util.NewID(), MeetingID: m.ID, ProviderKey: s.rt.ProviderKey,
			ProviderRoomName: meetings.RoomNameForMeeting(m.ID),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	p, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	_, err = s.q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
		ID: "att-schedule", MeetingID: m.ID, ConferenceSessionID: sess.ID, ParticipantID: p.ID,
		ProviderParticipantIdentity: "x",
	})
	if err != nil {
		t.Fatal(err)
	}

	n, err := s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 0 {
		t.Fatalf("auto end live room: %d %v", n, err)
	}
	got, _ := s.Get(ctx, ua.ID, m.ID)
	if got.Status != MeetingInProgress {
		t.Fatalf("status %s", got.Status)
	}
}
