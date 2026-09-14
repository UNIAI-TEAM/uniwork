package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestChatTaskSyncBidirectionalNoLoop(t *testing.T) {
	s, tasks, q, ua, w, pool := chatWithTasks(t)
	ctx := context.Background()
	consumer := NewChatTaskSyncConsumer(pool, q, s, tasks)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "sync-loop", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "linked"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{
		TaskID: task.ID, Direction: "both",
	}); err != nil {
		t.Fatal(err)
	}

	reply, err := s.SendThreadReply(ctx, ua.ID, w.ID, ch.ID, root.ID, SendChatMessageInput{Body: "from chat"})
	if err != nil {
		t.Fatal(err)
	}
	ev := outbox.Row{
		Topic: "chat.thread.reply_linked",
		Payload: mustJSON(map[string]string{
			"thread_root_id": root.ID, "message_id": reply.ID, "task_id": task.ID,
		}),
	}
	if err := consumer.Handle(ctx, ev); err != nil {
		t.Fatalf("chat→task: %v", err)
	}
	if err := consumer.Handle(ctx, ev); err != nil {
		t.Fatalf("chat→task retry: %v", err)
	}
	comments, err := tasks.Comments(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 {
		t.Fatalf("comments=%d want 1", len(comments))
	}
	linked, err := q.GetTaskCommentByChatMessageID(ctx, optText(&reply.ID))
	if err != nil {
		t.Fatalf("comment by chat message: %v", err)
	}
	if linked.ID != comments[0].ID {
		t.Fatalf("comment id mismatch %s vs %s", linked.ID, comments[0].ID)
	}

	comment, err := tasks.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "from task"}, "")
	if err != nil {
		t.Fatal(err)
	}
	taskEv := outbox.Row{
		Topic: "task.comment_added",
		Payload: mustJSON(map[string]string{
			"task_id": task.ID, "comment_id": comment.ID, "workspace_id": w.ID,
		}),
	}
	if err := consumer.Handle(ctx, taskEv); err != nil {
		t.Fatalf("task→chat: %v", err)
	}
	if err := consumer.Handle(ctx, taskEv); err != nil {
		t.Fatalf("task→chat retry: %v", err)
	}
	thread, err := s.ListThreadMessages(ctx, ua.ID, w.ID, ch.ID, root.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	mirrored := 0
	for _, m := range thread {
		if m.Body == "from task" {
			mirrored++
		}
	}
	if mirrored != 1 {
		t.Fatalf("mirrored replies=%d want 1 (thread len=%d)", mirrored, len(thread))
	}

	var mirroredMsg db.ChatMessage
	for _, m := range thread {
		row, err := q.GetChatMessageByID(ctx, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.MirroredFromCommentID.Valid && row.MirroredFromCommentID.String == comment.ID {
			mirroredMsg = row
			break
		}
	}
	if mirroredMsg.ID == "" {
		t.Fatal("missing mirrored message")
	}
	if err := consumer.Handle(ctx, outbox.Row{
		Topic: "chat.thread.reply_linked",
		Payload: mustJSON(map[string]string{
			"thread_root_id": root.ID, "message_id": mirroredMsg.ID, "task_id": task.ID,
		}),
	}); err != nil {
		t.Fatal(err)
	}
	comments, err = tasks.Comments(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 2 {
		t.Fatalf("after mirror skip comments=%d want 2", len(comments))
	}
}

func mustJSON(m map[string]string) string {
	b, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	return string(b)
}
