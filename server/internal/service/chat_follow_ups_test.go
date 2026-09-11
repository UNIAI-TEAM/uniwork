package service

import (
	"context"
	"errors"
	"strings"
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
	// EnsureWorkspaceRoom creates the default room as kind=channel (is_default).
	if list[0].RoomKind != "channel" {
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

func TestFollowUpLifecycle(t *testing.T) {
	s, _, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{
		Body: "Patch / reopen / convert",
	})
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	fu, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "ban đầu", &due)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	note := "đã sửa"
	patched, err := s.PatchFollowUp(ctx, ua.ID, w.ID, fu.ID, PatchFollowUpInput{Note: &note})
	if err != nil || patched.Note != note {
		t.Fatalf("patch note: err=%v %+v", err, patched)
	}
	cleared, err := s.PatchFollowUp(ctx, ua.ID, w.ID, fu.ID, PatchFollowUpInput{ClearDueAt: true})
	if err != nil || cleared.DueAt != nil {
		t.Fatalf("clear due: err=%v %+v", err, cleared)
	}
	newDue := time.Now().UTC().Add(72 * time.Hour).Truncate(time.Second)
	resetDue, err := s.PatchFollowUp(ctx, ua.ID, w.ID, fu.ID, PatchFollowUpInput{
		DueAt: &newDue, DueAtSet: true,
	})
	if err != nil || resetDue.DueAt == nil {
		t.Fatalf("set due: err=%v %+v", err, resetDue)
	}

	doneTrue := true
	completed, err := s.PatchFollowUp(ctx, ua.ID, w.ID, fu.ID, PatchFollowUpInput{Completed: &doneTrue})
	if err != nil || completed.CompletedAt == nil {
		t.Fatalf("complete via patch: err=%v %+v", err, completed)
	}
	again, err := s.CompleteFollowUp(ctx, ua.ID, w.ID, fu.ID)
	if err != nil || again.CompletedAt == nil {
		t.Fatalf("complete idempotent: err=%v %+v", err, again)
	}
	withDone, err := s.ListFollowUps(ctx, w.ID, ua.ID, true, 0)
	if err != nil || len(withDone) != 1 {
		t.Fatalf("list include completed: err=%v len=%d", err, len(withDone))
	}

	doneFalse := false
	reopened, err := s.PatchFollowUp(ctx, ua.ID, w.ID, fu.ID, PatchFollowUpInput{Completed: &doneFalse})
	if err != nil || reopened.CompletedAt != nil {
		t.Fatalf("reopen via patch: err=%v %+v", err, reopened)
	}
	openAgain, err := s.ReopenFollowUp(ctx, ua.ID, w.ID, fu.ID)
	if err != nil || openAgain.CompletedAt != nil {
		t.Fatalf("reopen idempotent: err=%v %+v", err, openAgain)
	}

	task, doneFU, err := s.ConvertFollowUpToTask(ctx, ua.ID, w.ID, fu.ID, CreateTaskFromMessageInput{})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if task.Title == "" || doneFU.CompletedAt == nil {
		t.Fatalf("convert result: task=%+v fu=%+v", task, doneFU)
	}
}

func TestFollowUpDeleteAndValidation(t *testing.T) {
	s, _, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "xóa sau"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, strings.Repeat("n", chatFollowUpNoteMax+1), nil); err == nil {
		t.Fatal("expected note too long")
	}
	if _, err := s.PatchFollowUp(ctx, ua.ID, w.ID, "01MISSINGFOLLOWUP0000000000", PatchFollowUpInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing patch: %v", err)
	}
	if err := s.DeleteFollowUp(ctx, ua.ID, w.ID, "01MISSINGFOLLOWUP0000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing delete: %v", err)
	}

	fu, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "tạm", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteFollowUp(ctx, ua.ID, w.ID, fu.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, err := s.ListFollowUps(ctx, w.ID, ua.ID, true, 200)
	if err != nil || len(list) != 0 {
		t.Fatalf("after delete: err=%v len=%d", err, len(list))
	}

	// Re-create updates note/due on the same message (idempotent path with changes).
	due := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	fu2, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "lần 2", &due)
	if err != nil {
		t.Fatal(err)
	}
	fu3, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "lần 3", nil)
	if err != nil || fu3.ID != fu2.ID || fu3.Note != "lần 3" {
		t.Fatalf("create updates note: err=%v %+v", err, fu3)
	}
}

func TestFollowUpIsPersonal(t *testing.T) {
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	_ = pub
	tasks := NewTaskService(pool, q, s.ws, newMemStorage())
	s.SetTasks(tasks)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "của A"})
	if err != nil {
		t.Fatal(err)
	}
	fu, err := s.CreateFollowUp(ctx, ua.ID, w.ID, msg.ID, "riêng A", nil)
	if err != nil {
		t.Fatal(err)
	}

	listB, err := s.ListFollowUps(ctx, w.ID, ub.ID, true, 10)
	if err != nil || len(listB) != 0 {
		t.Fatalf("B must not see A's follow-ups: err=%v len=%d", err, len(listB))
	}
	if _, err := s.PatchFollowUp(ctx, ub.ID, w.ID, fu.ID, PatchFollowUpInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B patch: %v", err)
	}
	if err := s.DeleteFollowUp(ctx, ub.ID, w.ID, fu.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B delete: %v", err)
	}
	if _, _, err := s.ConvertFollowUpToTask(ctx, ub.ID, w.ID, fu.ID, CreateTaskFromMessageInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B convert: %v", err)
	}
	if _, _, err := s.ConvertFollowUpToTask(ctx, ua.ID, w.ID, "01MISSINGFOLLOWUP0000000000", CreateTaskFromMessageInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing convert: %v", err)
	}
}
