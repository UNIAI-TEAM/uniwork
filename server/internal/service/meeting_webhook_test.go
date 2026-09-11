package service

import (
	"context"
	"testing"
)

func TestWebhookInboxEnqueueDuplicate(t *testing.T) {
	s, _, _, _ := meetingFixture(t)
	ctx := context.Background()
	payload := []byte(`{"type":"conference.room_finished","room_name":"room-x"}`)

	ok, err := s.EnqueueProviderWebhook(ctx, "livekit", "evt-dup-1", "conference.room_finished", payload)
	if err != nil || !ok {
		t.Fatalf("first enqueue: ok=%v err=%v", ok, err)
	}
	ok, err = s.EnqueueProviderWebhook(ctx, "livekit", "evt-dup-1", "conference.room_finished", payload)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("duplicate event should not insert")
	}
}

func TestWebhookInboxProcess(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Live")
	if err != nil {
		t.Fatal(err)
	}
	room := "room-" + m.ID
	payload := []byte(`{"type":"conference.room_finished","room_name":"` + room + `"}`)
	if _, err := s.EnqueueProviderWebhook(ctx, "livekit", "evt-process-1", "conference.room_finished", payload); err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessWebhookInbox(ctx, 10); err != nil {
		t.Fatal(err)
	}
}

func TestOpenAttendanceIdempotent(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Att")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	ps, _ := s.ListParticipants(ctx, ua.ID, "", m.ID)
	var pid string
	for _, p := range ps {
		if p.UserID.String == ub.ID {
			pid = p.ID
		}
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	room := sess.ProviderRoomName
	ev := ProviderNeutralEvent{
		Type: "conference.participant_joined", RoomName: room,
		Identity: "uw_participant_" + pid, ProviderEventID: "evt-a1",
	}
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	ev.ProviderEventID = "evt-a2"
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	n, err := s.q.CountUniqueAttendees(ctx, m.ID)
	if err != nil || n != 1 {
		t.Fatalf("attendees = %d err = %v", n, err)
	}
}
