package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// H12: a private room's content must not outlive a member's access to it.

func TestThreadTaskSyncIsRefusedInAPrivateRoom(t *testing.T) {
	s, tasks, q, ua, w, pool := chatWithTasks(t)
	ctx := context.Background()
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "kin", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "bàn riêng"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "việc"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: task.ID}); !codedIs(err, "chat_thread_sync_private") {
		t.Fatalf("SyncThreadTask in a private channel = %v, want chat_thread_sync_private", err)
	}
	var before int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, root.ID, CreateTaskFromMessageInput{SyncThread: true}); !codedIs(err, "chat_thread_sync_private") {
		t.Fatalf("CreateTaskFromMessage with sync in a private channel = %v, want chat_thread_sync_private", err)
	}
	var after int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatal("a refused sync still created the task")
	}
	if _, err := q.GetChatThreadTaskLinkByThread(ctx, root.ID); err == nil {
		t.Fatal("a private thread was linked")
	}
}

func TestThreadRepliesStopReachingTheTaskOnceTheRoomIsPrivate(t *testing.T) {
	s, tasks, q, ua, w, pool := chatWithTasks(t)
	ctx := context.Background()
	consumer := NewChatTaskSyncConsumer(pool, q, s, tasks)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "sap-kin", Visibility: "public"})
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
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: task.ID}); err != nil {
		t.Fatal(err)
	}
	private := chatVisibilityPrivate
	if _, err := s.UpdateChannel(ctx, ua.ID, w.ID, ch.ID, UpdateChannelInput{Visibility: &private}); err != nil {
		t.Fatal(err)
	}
	reply, err := s.SendThreadReply(ctx, ua.ID, w.ID, ch.ID, root.ID, SendChatMessageInput{Body: "riêng tư rồi"})
	if err != nil {
		t.Fatal(err)
	}
	if err := consumer.Handle(ctx, outbox.Row{Topic: "chat.thread.reply_linked", Payload: mustJSON(map[string]string{
		"thread_root_id": root.ID, "message_id": reply.ID, "task_id": task.ID,
	})}); err != nil {
		t.Fatal(err)
	}
	comments, err := tasks.Comments(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 0 {
		t.Fatalf("a reply in a private room became %d task comment(s)", len(comments))
	}
}

func TestFollowedThreadsAndFollowUpsNeedCurrentRoomAccess(t *testing.T) {
	s, _, q, ua, ub, w, _, group := revocationRooms(t)
	ctx := context.Background()
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group, SendChatMessageInput{Body: "gốc"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, group, root.ID, SendChatMessageInput{Body: "theo dõi"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateFollowUp(ctx, ub.ID, w.ID, root.ID, "nhớ xem", nil); err != nil {
		t.Fatal(err)
	}
	threads, err := s.ListFollowedThreads(ctx, ub.ID, w.ID, false, 50)
	if err != nil || len(threads) != 1 {
		t.Fatalf("followed threads before leaving = %d, %v", len(threads), err)
	}
	followUps, err := s.ListFollowUps(ctx, w.ID, ub.ID, true, 50)
	if err != nil || len(followUps) != 1 {
		t.Fatalf("follow-ups before leaving = %d, %v", len(followUps), err)
	}

	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, group); err != nil {
		t.Fatal(err)
	}

	if threads, err := s.ListFollowedThreads(ctx, ub.ID, w.ID, false, 50); err != nil || len(threads) != 0 {
		t.Fatalf("followed threads after leaving = %+v, %v", threads, err)
	}
	if followUps, err := s.ListFollowUps(ctx, w.ID, ub.ID, true, 50); err != nil || len(followUps) != 0 {
		t.Fatalf("follow-ups after leaving = %+v, %v", followUps, err)
	}
	ids, err := q.ListChatThreadFollowerUserIDs(ctx, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if id == ub.ID {
			t.Fatal("a member who left is still told about new replies")
		}
	}
}
