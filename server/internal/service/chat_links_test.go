package service

import (
	"context"
	"testing"

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
