package service

import (
	"context"
	"testing"
	"time"
)

func TestSignalVoiceAndTyping(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing: %v", err)
	}
	if len(pub.events) != 2 || pub.events[1].Type != "chat.typing" {
		t.Fatalf("typing publish: %+v", pub.events)
	}

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("voice invite: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.invite" {
		t.Fatalf("voice invite publish: %+v", pub.events)
	}

	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("voice accept: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.accept" {
		t.Fatalf("voice accept publish: %+v", pub.events)
	}

	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, dm.ID, "call-1", nil); err != nil {
		t.Fatalf("voice hangup: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.hangup" {
		t.Fatalf("voice hangup publish: %+v", pub.events)
	}
}

func TestSignalTypingThrottled(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	chatTypingLastPublished.Range(func(k, _ any) bool {
		chatTypingLastPublished.Delete(k)
		return true
	})
	pub.events = nil

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing: %v", err)
	}
	if len(pub.events) != 1 || pub.events[0].Type != "chat.typing" {
		t.Fatalf("first typing publish: %+v", pub.events)
	}

	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing again: %v", err)
	}
	if len(pub.events) != 1 {
		t.Fatalf("second typing within gap should not publish: %+v", pub.events)
	}

	time.Sleep(chatTypingMinGap + 50*time.Millisecond)
	if err := s.SignalTyping(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("typing after gap: %v", err)
	}
	if len(pub.events) != 2 || pub.events[1].Type != "chat.typing" {
		t.Fatalf("typing after gap publish: %+v", pub.events)
	}
}
