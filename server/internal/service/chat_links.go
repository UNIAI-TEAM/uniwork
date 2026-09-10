package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatLinkTargetTask       = "task"
	chatLinkRelationCreated  = "created_from"
	chatLinkRelationMentions = "mentions"
	chatThreadSyncBoth       = "both"
	chatThreadSyncChatToTask = "chat_to_task"
	chatMessageOriginType    = "chat_message"
)

// Tasks is set after construction so chat can create/link tasks without an
// import cycle at NewChatService time.
func (s *ChatService) SetTasks(tasks *TaskService) {
	s.tasks = tasks
}

type ChatMessageLinkRow struct {
	ID         string
	MessageID  string
	TargetType string
	TargetID   string
	Relation   string
	CreatedBy  string
	CreatedAt  time.Time
}

type CreateTaskFromMessageInput struct {
	Title        string
	ProjectID    *string
	AssigneeID   *string
	AssigneeKind string
	DueDate      *string
	SyncThread   bool
	Priority     string
}

type CreateChatMessageLinkInput struct {
	TargetType string
	TargetID   string
}

type SyncThreadTaskInput struct {
	TaskID    string
	Direction string
}

func errChatLinkTargetNotFound() error {
	return coded(http.StatusNotFound, "chat_link_target_not_found", "không tìm thấy đối tượng gắn với tin nhắn")
}

func errChatThreadAlreadySynced() error {
	return coded(http.StatusConflict, "chat_thread_already_synced", "thread đã nối với một task khác")
}

func errChatProjectNotFound() error {
	return coded(http.StatusNotFound, "project_not_found", "không tìm thấy project")
}

func titleFromMessageBody(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return "Task từ chat"
	}
	runes := []rune(body)
	if len(runes) <= 120 {
		return string(runes)
	}
	cut := string(runes[:120])
	if i := strings.LastIndexAny(cut, " \t\n"); i > 40 {
		cut = cut[:i]
	}
	return strings.TrimSpace(cut)
}

func (s *ChatService) requireTasks() error {
	if s.tasks == nil {
		return errors.New("chat: task service not wired")
	}
	return nil
}

func (s *ChatService) loadMessageForLink(
	ctx context.Context, userID, workspaceID, messageID string,
) (db.ChatRoom, db.ChatMessage, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	msg, err := s.q.GetChatMessageByID(ctx, messageID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && msg.DeletedAt.Valid) {
		return db.ChatRoom{}, db.ChatMessage{}, ErrNotFound
	}
	if err != nil {
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, msg.RoomID)
	if err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return db.ChatRoom{}, db.ChatMessage{}, ErrNotFound
		}
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	return room, msg, nil
}

func chatMessageLinkRow(row db.ChatMessageLink) ChatMessageLinkRow {
	return ChatMessageLinkRow{
		ID: row.ID, MessageID: row.MessageID, TargetType: row.TargetType,
		TargetID: row.TargetID, Relation: row.Relation, CreatedBy: row.CreatedBy,
		CreatedAt: row.CreatedAt.Time,
	}
}

// CreateTaskFromMessage creates a workspace task from a chat message and links them.
func (s *ChatService) CreateTaskFromMessage(
	ctx context.Context, userID, workspaceID, messageID string, in CreateTaskFromMessageInput,
) (db.Task, error) {
	if err := s.requireTasks(); err != nil {
		return db.Task{}, err
	}
	room, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return db.Task{}, err
	}
	if in.ProjectID != nil && strings.TrimSpace(*in.ProjectID) != "" {
		ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
		if err != nil {
			return db.Task{}, err
		}
		if _, err := s.q.GetProject(ctx, db.GetProjectParams{
			ID: strings.TrimSpace(*in.ProjectID), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.Task{}, errChatProjectNotFound()
			}
			return db.Task{}, err
		}
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = titleFromMessageBody(msg.Body)
	}
	desc := msg.Body
	if utf8.RuneCountInString(desc) > 4000 {
		desc = string([]rune(desc)[:4000])
	}
	when := msg.CreatedAt.Time.UTC().Format(time.RFC3339)
	roomLabel := strings.TrimSpace(room.Name)
	if roomLabel == "" {
		roomLabel = room.ID
	}
	desc = fmt.Sprintf("%s\n\nTừ chat #%s lúc %s", desc, roomLabel, when)

	priority := strings.TrimSpace(in.Priority)
	if priority == "" {
		priority = "medium"
	}
	originID := msg.ID
	task, err := s.tasks.Create(ctx, Human(userID), workspaceID, CreateTaskInput{
		Title: title, Description: desc, Priority: priority,
		AssigneeID: in.AssigneeID, AssigneeKind: in.AssigneeKind, DueDate: in.DueDate,
		OriginType: chatMessageOriginType, OriginID: &originID,
		ProjectID: in.ProjectID,
	})
	if err != nil {
		return db.Task{}, err
	}

	link, err := s.insertMessageLink(ctx, userID, room, msg, chatLinkTargetTask, task.ID, chatLinkRelationCreated)
	if err != nil {
		return db.Task{}, err
	}
	_ = link

	if in.SyncThread {
		rootID := msg.ID
		if msg.ThreadRootID.Valid {
			rootID = msg.ThreadRootID.String
		}
		if _, err := s.SyncThreadTask(ctx, userID, workspaceID, rootID, SyncThreadTaskInput{
			TaskID: task.ID, Direction: chatThreadSyncBoth,
		}); err != nil && !codedIs(err, "chat_thread_already_synced") {
			return db.Task{}, err
		}
	}
	return task, nil
}

// LinkChatMessage attaches an existing target (task) to a message.
func (s *ChatService) LinkChatMessage(
	ctx context.Context, userID, workspaceID, messageID string, in CreateChatMessageLinkInput,
) (ChatMessageLinkRow, error) {
	if err := s.requireTasks(); err != nil {
		return ChatMessageLinkRow{}, err
	}
	targetType := strings.TrimSpace(in.TargetType)
	targetID := strings.TrimSpace(in.TargetID)
	if targetType != chatLinkTargetTask || targetID == "" {
		return ChatMessageLinkRow{}, Invalid("target_type/target_id không hợp lệ")
	}
	room, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return ChatMessageLinkRow{}, err
	}
	task, err := s.tasks.Get(ctx, userID, targetID)
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
			return ChatMessageLinkRow{}, errChatLinkTargetNotFound()
		}
		return ChatMessageLinkRow{}, err
	}
	if task.WorkspaceID != workspaceID {
		return ChatMessageLinkRow{}, errChatLinkTargetNotFound()
	}
	if existing, err := s.q.GetChatMessageLinkByPair(ctx, db.GetChatMessageLinkByPairParams{
		MessageID: msg.ID, TargetType: targetType, TargetID: targetID,
	}); err == nil {
		return chatMessageLinkRow(existing), nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageLinkRow{}, err
	}
	return s.insertMessageLink(ctx, userID, room, msg, targetType, targetID, chatLinkRelationMentions)
}

// ListChatMessageLinks returns links for one message.
func (s *ChatService) ListChatMessageLinks(
	ctx context.Context, userID, workspaceID, messageID string,
) ([]ChatMessageLinkRow, error) {
	_, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListChatMessageLinksByMessage(ctx, db.ListChatMessageLinksByMessageParams{
		MessageID: msg.ID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessageLinkRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, chatMessageLinkRow(row))
	}
	return out, nil
}

// UnlinkChatMessage removes a link from a message.
func (s *ChatService) UnlinkChatMessage(
	ctx context.Context, userID, workspaceID, messageID, linkID string,
) error {
	_, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return err
	}
	n, err := s.q.DeleteChatMessageLink(ctx, db.DeleteChatMessageLinkParams{
		ID: linkID, WorkspaceID: workspaceID, MessageID: msg.ID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *ChatService) insertMessageLink(
	ctx context.Context, userID string, room db.ChatRoom, msg db.ChatMessage,
	targetType, targetID, relation string,
) (ChatMessageLinkRow, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatMessageLinkRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	row, err := q.CreateChatMessageLink(ctx, db.CreateChatMessageLinkParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: anchorWS, RoomID: room.ID,
		MessageID: msg.ID, TargetType: targetType, TargetID: targetID, Relation: relation,
		CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		if isUniqueViolation(err) {
			existing, lookupErr := s.q.GetChatMessageLinkByPair(ctx, db.GetChatMessageLinkByPairParams{
				MessageID: msg.ID, TargetType: targetType, TargetID: targetID,
			})
			if lookupErr != nil {
				return ChatMessageLinkRow{}, lookupErr
			}
			return chatMessageLinkRow(existing), nil
		}
		return ChatMessageLinkRow{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: anchorWS,
		Actor: Human(userID), Action: audit.ActionChatMessageLinked,
		ResourceType: "chat_message", ResourceID: msg.ID,
		Metadata: map[string]any{"link_id": row.ID, "target_type": targetType, "target_id": targetID},
	}, audit.Event{Topic: "chat.message.linked", Payload: map[string]string{
		"room_id": room.ID, "message_id": msg.ID, "target_id": targetID,
	}}); err != nil {
		return ChatMessageLinkRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatMessageLinkRow{}, err
	}
	return chatMessageLinkRow(row), nil
}

// SyncThreadTask connects a thread root to a task for bi-directional comment sync.
func (s *ChatService) SyncThreadTask(
	ctx context.Context, userID, workspaceID, threadRootID string, in SyncThreadTaskInput,
) (db.ChatThreadTaskLink, error) {
	if err := s.requireTasks(); err != nil {
		return db.ChatThreadTaskLink{}, err
	}
	direction := strings.TrimSpace(in.Direction)
	if direction == "" {
		direction = chatThreadSyncBoth
	}
	if direction != chatThreadSyncBoth && direction != chatThreadSyncChatToTask {
		return db.ChatThreadTaskLink{}, Invalid("direction không hợp lệ")
	}
	taskID := strings.TrimSpace(in.TaskID)
	if taskID == "" {
		return db.ChatThreadTaskLink{}, Invalid("task_id không được để trống")
	}
	room, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return db.ChatThreadTaskLink{}, err
	}
	if !threadAllowedOnRoom(room) {
		return db.ChatThreadTaskLink{}, errChatThreadNotFound()
	}
	task, err := s.tasks.Get(ctx, userID, taskID)
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
			return db.ChatThreadTaskLink{}, errChatLinkTargetNotFound()
		}
		return db.ChatThreadTaskLink{}, err
	}
	if task.WorkspaceID != workspaceID {
		return db.ChatThreadTaskLink{}, errChatLinkTargetNotFound()
	}
	if existing, err := s.q.GetChatThreadTaskLinkByThread(ctx, root.ID); err == nil {
		if existing.TaskID == taskID {
			return existing, nil
		}
		return db.ChatThreadTaskLink{}, errChatThreadAlreadySynced()
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.ChatThreadTaskLink{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatThreadTaskLink{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	row, err := q.CreateChatThreadTaskLink(ctx, db.CreateChatThreadTaskLinkParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: anchorWS, RoomID: room.ID,
		ThreadRootID: root.ID, TaskID: taskID, Direction: direction,
		CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.ChatThreadTaskLink{}, errChatThreadAlreadySynced()
		}
		return db.ChatThreadTaskLink{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: anchorWS,
		Actor: Human(userID), Action: audit.ActionChatThreadTaskLinked,
		ResourceType: "chat_thread", ResourceID: root.ID,
		Metadata: map[string]any{"task_id": taskID, "direction": direction},
	}, audit.Event{Topic: "chat.thread.linked", Payload: map[string]string{
		"room_id": room.ID, "thread_root_id": root.ID, "task_id": taskID,
	}}); err != nil {
		return db.ChatThreadTaskLink{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ChatThreadTaskLink{}, err
	}
	return row, nil
}

// UnsyncThreadTask removes the thread↔task link.
func (s *ChatService) UnsyncThreadTask(ctx context.Context, userID, workspaceID, threadRootID string) error {
	_, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return err
	}
	n, err := s.q.DeleteChatThreadTaskLinkByThread(ctx, db.DeleteChatThreadTaskLinkByThreadParams{
		ThreadRootID: root.ID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
