package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMeetingChat(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "   "); err == nil {
		t.Fatal("empty chat accepted")
	}
	msg, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "Xin chào\nmọi người")
	if err != nil || !strings.Contains(msg.Message, "\n") || msg.SenderName != "A" {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "x"); err == nil {
		t.Fatal("non-member sent chat")
	}
	msgs, err := s.ChatMessages(ctx, ua.ID, "", m.ID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("%d %v", len(msgs), err)
	}

	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "late"); err == nil {
		t.Fatal("chat after end")
	}
	if hist, err := s.ChatMessages(ctx, ua.ID, "", m.ID); err != nil || len(hist) != 1 {
		t.Fatalf("history unreadable after end: %d %v", len(hist), err)
	}
}

func TestMeetingChatTruncation(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, strings.Repeat("a", 5000))
	if err != nil {
		t.Fatal(err)
	}
	if len(msg.Message) != 4000 {
		t.Fatalf("len = %d, want 4000", len(msg.Message))
	}
}

func TestMeetingChatRequiresJoin(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	var ve ValidationError
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "hi"); !errors.As(err, &ve) || ve.Msg != "chưa tham gia phòng họp" {
		t.Fatalf("want join validation, got %v", err)
	}
}

func TestMeetingChatBeforeStart(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Later", StartsAt: start, EndsAt: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "early"); err == nil {
		t.Fatal("chat before start accepted")
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("non-member list chat: %v", err)
	}
}
