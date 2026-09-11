package service

import (
	"context"
	"testing"
	"time"
)

func TestCreateFollowUp(t *testing.T) {
	s, _, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{
		Body: "Cần follow sau meeting",
	})
	if err != nil {
		t.Fatal(err)
	}

	due := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	fu, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "nhắc lại", &due)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if fu.MessageID != msg.ID || fu.UserID != ua.ID || fu.Note != "nhắc lại" || fu.DueAt == nil {
		t.Fatalf("unexpected follow-up: %+v", fu)
	}

	again, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "", nil)
	if err != nil {
		t.Fatalf("idempotent create: %v", err)
	}
	if again.ID != fu.ID {
		t.Fatalf("expected same id, got %s vs %s", again.ID, fu.ID)
	}

	list, err := s.ListFollowUps(ctx, w.ID, ua.ID, false, 10)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: err=%v len=%d", err, len(list))
	}
	if list[0].MessageBody != "Cần follow sau meeting" {
		t.Fatalf("list message preview: %+v", list[0])
	}
	if list[0].RoomKind != "workspace" {
		t.Fatalf("list room kind: %+v", list[0])
	}
	if list[0].MessageSenderName == "" {
		t.Fatalf("list sender name empty: %+v", list[0])
	}

	done, err := s.CompleteFollowUp(ctx, ua.ID, w.ID, fu.ID)
	if err != nil || done.CompletedAt == nil {
		t.Fatalf("complete: err=%v %+v", err, done)
	}
	open, err := s.ListFollowUps(ctx, w.ID, ua.ID, false, 10)
	if err != nil || len(open) != 0 {
		t.Fatalf("open list after complete: err=%v len=%d", err, len(open))
	}
}
