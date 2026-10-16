package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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

// TestChatTaskSyncPropagatesEditAndDelete: an edit or delete on either side
// of a linked thread reaches the copy on the other side (UNI-1685).
func TestChatTaskSyncPropagatesEditAndDelete(t *testing.T) {
	s, tasks, q, ua, w, pool := chatWithTasks(t)
	ctx := context.Background()
	consumer := NewChatTaskSyncConsumer(pool, q, s, tasks)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "sync-edits", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "linked edits"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{
		TaskID: task.ID, Direction: "both",
	}); err != nil {
		t.Fatal(err)
	}
	handleTwice := func(topic string, payload map[string]string) {
		t.Helper()
		ev := outbox.Row{Topic: topic, Payload: mustJSON(payload)}
		for i := 0; i < 2; i++ {
			if err := consumer.Handle(ctx, ev); err != nil {
				t.Fatalf("%s run %d: %v", topic, i+1, err)
			}
		}
	}

	// (a) chat → task.
	reply, err := s.SendThreadReply(ctx, ua.ID, w.ID, ch.ID, root.ID, SendChatMessageInput{Body: "wifi abc123"})
	if err != nil {
		t.Fatal(err)
	}
	handleTwice("chat.thread.reply_linked", map[string]string{
		"thread_root_id": root.ID, "message_id": reply.ID, "task_id": task.ID,
	})
	copied, err := q.GetTaskCommentByChatMessageID(ctx, optText(&reply.ID))
	if err != nil {
		t.Fatalf("comment copied from the reply: %v", err)
	}
	if _, err := s.EditChatMessage(ctx, ua.ID, w.ID, ch.ID, reply.ID, "wifi changed"); err != nil {
		t.Fatal(err)
	}
	if c, err := q.GetTaskCommentByID(ctx, copied.ID); err != nil || c.Body != "wifi changed" {
		t.Fatalf("copied comment after edit = %q, %v; want the new body", c.Body, err)
	}
	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, ch.ID, reply.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := q.GetTaskCommentByID(ctx, copied.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("copied comment after delete: err=%v, want gone", err)
	}
	deletedEvents := 0
	for _, p := range outboxPayloads(t, pool, "task.comment_deleted") {
		if p["comment_id"] == copied.ID && p["task_id"] == task.ID {
			deletedEvents++
		}
	}
	if deletedEvents != 1 {
		t.Fatalf("task.comment_deleted rows for the copy = %d, want 1", deletedEvents)
	}

	// (b) task → chat.
	comment, err := tasks.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "deadline friday"}, "")
	if err != nil {
		t.Fatal(err)
	}
	commentEv := map[string]string{"task_id": task.ID, "comment_id": comment.ID, "workspace_id": w.ID}
	handleTwice("task.comment_added", commentEv)
	mirror, err := q.GetChatMessageByMirroredComment(ctx, optText(&comment.ID))
	if err != nil {
		t.Fatalf("message mirrored from the comment: %v", err)
	}
	if _, err := tasks.UpdateComment(ctx, Human(ua.ID), comment.ID, UpdateCommentInput{Body: "deadline thursday"}); err != nil {
		t.Fatal(err)
	}
	handleTwice("task.comment_updated", commentEv)
	if m, err := q.GetChatMessageByID(ctx, mirror.ID); err != nil || m.Body != "deadline thursday" {
		t.Fatalf("mirrored message after comment edit = %q, %v; want the new body", m.Body, err)
	}
	if err := tasks.DeleteComment(ctx, Human(ua.ID), comment.ID); err != nil {
		t.Fatal(err)
	}
	handleTwice("task.comment_deleted", commentEv)
	var softDeleted bool
	if err := pool.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM chat_messages WHERE id = $1`, mirror.ID).Scan(&softDeleted); err != nil || !softDeleted {
		t.Fatalf("mirrored message after comment delete: deleted=%v err=%v; want soft-deleted", softDeleted, err)
	}
	rootRow, err := q.GetChatMessageByID(ctx, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rootRow.ReplyCount != 0 {
		t.Fatalf("root reply_count = %d, want 0 once both replies are gone", rootRow.ReplyCount)
	}
}

func mustJSON(m map[string]string) string {
	b, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// A task comment lands in the thread under its author's name, so it may only
// land where that author could post the reply themselves.
func TestTaskCommentsDoNotReachARoomTheAuthorCannotWriteIn(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	tasks := NewTaskService(pool, q, s.ws, newMemStorage())
	s.SetTasks(tasks)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	consumer := NewChatTaskSyncConsumer(pool, q, s, tasks)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "sync-guard", Visibility: "public"})
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

	// mirrored has author comment on the task on the task and reports whether the reply reached the thread.
	mirrored := func(author string, body string) bool {
		t.Helper()
		comment, err := tasks.AddCommentSuite(ctx, Human(author), task.ID, AddCommentInput{Body: body}, "")
		if err != nil {
			t.Fatal(err)
		}
		if err := consumer.Handle(ctx, outbox.Row{
			Topic: "task.comment_added",
			Payload: mustJSON(map[string]string{
				"task_id": task.ID, "comment_id": comment.ID, "workspace_id": w.ID,
			}),
		}); err != nil {
			t.Fatalf("%s: %v", body, err)
		}
		_, err = q.GetChatMessageByMirroredComment(ctx, pgtype.Text{String: comment.ID, Valid: true})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatal(err)
		}
		return err == nil
	}

	if mirrored(ub.ID, "not a member") {
		t.Fatal("a non-member's comment reached the channel")
	}
	if _, err := s.JoinChannel(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if !mirrored(ub.ID, "member") {
		t.Fatal("a member's comment should reach the channel")
	}
	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: ch.ID, UserID: ub.ID, SendRestricted: true,
	}); err != nil {
		t.Fatal(err)
	}
	if mirrored(ub.ID, "muted") {
		t.Fatal("a muted member's comment reached the channel")
	}

	private := chatVisibilityPrivate
	if _, err := s.UpdateChannel(ctx, ua.ID, w.ID, ch.ID, UpdateChannelInput{Visibility: &private}); err != nil {
		t.Fatal(err)
	}
	if mirrored(ua.ID, "private") {
		t.Fatal("a comment reached a channel made private")
	}
	public := chatVisibilityPublic
	if _, err := s.UpdateChannel(ctx, ua.ID, w.ID, ch.ID, UpdateChannelInput{Visibility: &public}); err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveChannel(ctx, ua.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if mirrored(ua.ID, "archived") {
		t.Fatal("a comment reached an archived channel")
	}
}
