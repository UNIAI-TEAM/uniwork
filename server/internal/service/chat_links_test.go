package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func chatWithTasks(t *testing.T) (*ChatService, *TaskService, *db.Queries, db.User, db.Workspace, *pgxpool.Pool) {
	t.Helper()
	s, _, q, ua, _, w, pool := chatFixtureWithPool(t)
	tasks := NewTaskService(pool, q, s.ws, newMemStorage())
	s.SetTasks(tasks)
	return s, tasks, q, ua, w, pool
}

func TestCreateTaskFromMessageAndLink(t *testing.T) {
	s, tasks, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{
		Body: "Bug login trên Safari — session mất sau refresh",
	})
	if err != nil {
		t.Fatal(err)
	}

	task, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, msg.ID, CreateTaskFromMessageInput{})
	if err != nil {
		t.Fatalf("create from message: %v", err)
	}
	if task.Title == "" || task.OriginType.String != chatMessageOriginType {
		t.Fatalf("task title/origin: %+v", task)
	}
	links, err := s.ListChatMessageLinks(ctx, ua.ID, w.ID, msg.ID)
	if err != nil || len(links) != 1 || links[0].Relation != chatLinkRelationCreated {
		t.Fatalf("links: err=%v %+v", err, links)
	}

	other, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "existing"})
	if err != nil {
		t.Fatal(err)
	}
	linked, err := s.LinkChatMessage(ctx, ua.ID, w.ID, msg.ID, CreateChatMessageLinkInput{
		TargetType: "task", TargetID: other.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if linked.Relation != chatLinkRelationMentions {
		t.Fatalf("relation=%s", linked.Relation)
	}
	links, err = s.ListChatMessageLinks(ctx, ua.ID, w.ID, msg.ID)
	if err != nil || len(links) != 2 {
		t.Fatalf("links after mention: err=%v len=%d", err, len(links))
	}
	if err := s.UnlinkChatMessage(ctx, ua.ID, w.ID, msg.ID, linked.ID); err != nil {
		t.Fatal(err)
	}
}

func TestCreateTaskFromMessageAttachesProject(t *testing.T) {
	s, tasks, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	project, err := tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "From chat"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "attach me"})
	if err != nil {
		t.Fatal(err)
	}
	pid := project.ID
	task, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, msg.ID, CreateTaskFromMessageInput{
		ProjectID: &pid,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !task.ProjectID.Valid || task.ProjectID.String != project.ID {
		t.Fatalf("project_id=%+v want %s", task.ProjectID, project.ID)
	}
}

func TestSyncThreadTask(t *testing.T) {
	s, tasks, _, ua, w, _ := chatWithTasks(t)
	ctx := context.Background()

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "sync-ch", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "root for sync"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "synced task"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{
		TaskID: task.ID, Direction: "both",
	}); err != nil {
		t.Fatal(err)
	}
	other, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "other"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{
		TaskID: other.ID,
	}); !codedIs(err, "chat_thread_already_synced") {
		t.Fatalf("want already_synced, got %v", err)
	}
	if err := s.UnsyncThreadTask(ctx, ua.ID, w.ID, root.ID); err != nil {
		t.Fatal(err)
	}
}

func TestListRoomMessageLinksBatchesOneRoom(t *testing.T) {
	s, _, _, ua, ub, w, pool := chatFixtureWithPool(t)
	q := db.New(pool)
	tasks := NewTaskService(pool, q, s.ws, newMemStorage())
	s.SetTasks(tasks)
	ctx := context.Background()

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "one"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "two"})
	if err != nil {
		t.Fatal(err)
	}
	unlinked, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "three"})
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range []ChatMessageRow{first, second} {
		if _, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, msg.ID, CreateTaskFromMessageInput{}); err != nil {
			t.Fatal(err)
		}
	}

	links, err := s.ListRoomMessageLinks(ctx, ua.ID, w.ID, room.RoomID,
		[]string{first.ID, second.ID, unlinked.ID, first.ID, " "})
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 || links[0].MessageID == links[1].MessageID {
		t.Fatalf("want one link per linked message, got %+v", links)
	}

	empty, err := s.ListRoomMessageLinks(ctx, ua.ID, w.ID, room.RoomID, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("no ids: err=%v links=%+v", err, empty)
	}

	tooMany := make([]string, maxRoomMessageLinkIDs+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("id-%d", i)
	}
	if _, err := s.ListRoomMessageLinks(ctx, ua.ID, w.ID, room.RoomID, tooMany); err == nil {
		t.Fatal("over the cap must be refused")
	}

	// Someone outside the workspace learns nothing about the room's links.
	if _, err := s.ListRoomMessageLinks(ctx, ub.ID, w.ID, room.RoomID, []string{first.ID}); err == nil {
		t.Fatal("non-member must be refused")
	}
}

func TestReactionOnFileMessageReportsMine(t *testing.T) {
	s, _, _, ua, _, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "react"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.ToggleChatMessageReaction(ctx, ua.ID, w.ID, room.RoomID, msg.ID, "👍")
	if err != nil {
		t.Fatal(err)
	}
	if len(row.MyReactions) != 1 || row.MyReactions[0] != "👍" || row.Reactions["👍"] != 1 {
		t.Fatalf("mine=%v counts=%v", row.MyReactions, row.Reactions)
	}
	list, err := s.ListRoomMessages(ctx, ua.ID, w.ID, room.RoomID, ListChatMessagesInput{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range list {
		if m.ID == msg.ID {
			found = len(m.MyReactions) == 1
		}
	}
	if !found {
		t.Fatal("list must carry my_reactions for the viewer")
	}
}

// Linking, creating a task from a message and (un)syncing a thread change what
// everyone in the room sees, so they need the standing of a writer there.
func TestLinkCommandsNeedSendStandingInRoom(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	tasks := NewTaskService(pool, q, s.ws, newMemStorage())
	s.SetTasks(tasks)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "thong-bao", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "Lịch nghỉ lễ"})
	if err != nil {
		t.Fatal(err)
	}
	synced, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "synced by A"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: synced.ID}); err != nil {
		t.Fatal(err)
	}
	bTask, err := tasks.Create(ctx, Human(ub.ID), w.ID, CreateTaskInput{Title: "B's task"})
	if err != nil {
		t.Fatal(err)
	}

	count := func(sql, arg string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql, arg).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	snapshot := func() [3]int {
		return [3]int{
			count(`SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID),
			count(`SELECT count(*) FROM chat_message_links WHERE room_id = $1`, ch.ID),
			count(`SELECT count(*) FROM chat_thread_task_links WHERE room_id = $1`, ch.ID),
		}
	}
	before := snapshot()

	refused := func(stage string, ok func(error) bool) {
		t.Helper()
		if _, err := s.LinkChatMessage(ctx, ub.ID, w.ID, root.ID, CreateChatMessageLinkInput{
			TargetType: "task", TargetID: bTask.ID,
		}); !ok(err) {
			t.Fatalf("%s link: %v", stage, err)
		}
		if _, err := s.CreateTaskFromMessage(ctx, ub.ID, w.ID, root.ID, CreateTaskFromMessageInput{}); !ok(err) {
			t.Fatalf("%s create task: %v", stage, err)
		}
		if _, err := s.SyncThreadTask(ctx, ub.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: bTask.ID}); !ok(err) {
			t.Fatalf("%s sync: %v", stage, err)
		}
		if err := s.UnsyncThreadTask(ctx, ub.ID, w.ID, root.ID); !ok(err) {
			t.Fatalf("%s unsync: %v", stage, err)
		}
		if after := snapshot(); after != before {
			t.Fatalf("%s: rows changed %v -> %v", stage, before, after)
		}
	}

	refused("not a member", func(err error) bool { return codedIs(err, "chat_not_member") })

	if _, err := s.JoinChannel(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: ch.ID, UserID: ub.ID, SendRestricted: true,
	}); err != nil {
		t.Fatal(err)
	}
	refused("send restricted", func(err error) bool {
		var invalid ValidationError
		return errors.As(err, &invalid)
	})
}

// TestDeleteTaskDropsItsChatLinks: deleting a task takes its card off the
// message and frees the thread it synced with, in the same transaction, so a
// new task can sync the thread again (UNI-1686).
func TestDeleteTaskDropsItsChatLinks(t *testing.T) {
	s, tasks, q, ua, w, pool := chatWithTasks(t)
	ctx := context.Background()

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "drop-links", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "other"})
	if err != nil {
		t.Fatal(err)
	}
	synced, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, root.ID, CreateTaskFromMessageInput{SyncThread: true})
	if err != nil {
		t.Fatal(err)
	}
	carded, err := s.CreateTaskFromMessage(ctx, ua.ID, w.ID, other.ID, CreateTaskFromMessageInput{})
	if err != nil {
		t.Fatal(err)
	}
	unlinkedBefore := len(topicsLike(t, pool, w.OrganizationID, "chat.thread.unlinked"))
	linkedBefore := len(topicsLike(t, pool, w.OrganizationID, "chat.message.linked"))

	if err := tasks.Delete(ctx, ua.ID, synced.ID); err != nil {
		t.Fatal(err)
	}
	if links, err := s.ListRoomMessageLinks(ctx, ua.ID, w.ID, ch.ID, []string{root.ID}); err != nil || len(links) != 0 {
		t.Fatalf("root links after delete: err=%v %+v; want none", err, links)
	}
	if _, err := q.GetChatThreadTaskLinkByThread(ctx, root.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("thread link after delete: %v; want ErrNoRows", err)
	}
	if got := len(topicsLike(t, pool, w.OrganizationID, "chat.thread.unlinked")) - unlinkedBefore; got != 1 {
		t.Fatalf("chat.thread.unlinked rows: %d; want 1", got)
	}
	if got := len(topicsLike(t, pool, w.OrganizationID, "chat.message.linked")) - linkedBefore; got != 1 {
		t.Fatalf("chat.message.linked rows: %d; want 1", got)
	}

	// The batch delete goes through the same path.
	if _, err := tasks.BatchDeleteTasks(ctx, Human(ua.ID), w.ID, []string{carded.ID}); err != nil {
		t.Fatal(err)
	}
	if links, err := s.ListRoomMessageLinks(ctx, ua.ID, w.ID, ch.ID, []string{other.ID}); err != nil || len(links) != 0 {
		t.Fatalf("other links after batch delete: err=%v %+v; want none", err, links)
	}

	next, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SyncThreadTask(ctx, ua.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: next.ID}); err != nil {
		t.Fatalf("sync freed thread to a new task: %v", err)
	}
}
