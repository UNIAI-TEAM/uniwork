package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatTaskSyncConsumer mirrors thread replies ↔ task comments when linked.
type ChatTaskSyncConsumer struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	chat  *ChatService
	tasks *TaskService
	log   *slog.Logger
}

// NewChatTaskSyncConsumer wires the outbox consumer for C-13.3.
func NewChatTaskSyncConsumer(pool *pgxpool.Pool, q *db.Queries, chat *ChatService, tasks *TaskService) *ChatTaskSyncConsumer {
	return &ChatTaskSyncConsumer{pool: pool, q: q, chat: chat, tasks: tasks, log: slog.Default()}
}

func (*ChatTaskSyncConsumer) Name() string { return "chat_task_sync" }

func (*ChatTaskSyncConsumer) Topics() []string {
	return []string{"chat.thread.reply_linked", "task.comment_added"}
}

func (c *ChatTaskSyncConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_task_sync: payload of %s: %w", ev.ID, err)
		}
	}
	switch ev.Topic {
	case "chat.thread.reply_linked":
		return c.syncChatToTask(ctx, payload)
	case "task.comment_added":
		return c.syncTaskToChat(ctx, payload)
	default:
		return nil
	}
}

func (c *ChatTaskSyncConsumer) syncChatToTask(ctx context.Context, payload map[string]string) error {
	messageID := strings.TrimSpace(payload["message_id"])
	taskID := strings.TrimSpace(payload["task_id"])
	threadRootID := strings.TrimSpace(payload["thread_root_id"])
	if messageID == "" || taskID == "" {
		return nil
	}
	msg, err := c.q.GetChatMessageByID(ctx, messageID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && msg.DeletedAt.Valid) {
		return nil
	}
	if err != nil {
		return err
	}
	if msg.MirroredFromCommentID.Valid {
		return nil
	}
	link, err := c.q.GetChatThreadTaskLinkByThread(ctx, threadRootID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if link.TaskID != taskID {
		return nil
	}
	if _, err := c.q.GetTask(ctx, taskID); errors.Is(err, pgx.ErrNoRows) {
		return c.dropLinkAndNotify(ctx, link, "Task đã bị xóa — đã ngắt đồng bộ thread.")
	} else if err != nil {
		return err
	}
	msgID := msg.ID
	_, err = c.tasks.AddCommentSuite(ctx, Human(msg.SenderID), taskID, AddCommentInput{
		Body: msg.Body, Origin: "chat", ChatMessageID: &msgID,
	}, "")
	return err
}

func (c *ChatTaskSyncConsumer) syncTaskToChat(ctx context.Context, payload map[string]string) error {
	commentID := strings.TrimSpace(payload["comment_id"])
	taskID := strings.TrimSpace(payload["task_id"])
	if commentID == "" || taskID == "" {
		return nil
	}
	comment, err := c.q.GetTaskCommentByID(ctx, commentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if comment.ChatMessageID.Valid {
		return nil
	}
	link, err := c.q.GetChatThreadTaskLinkByTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if link.Direction != chatThreadSyncBoth {
		return nil
	}
	if existing, err := c.q.GetChatMessageByMirroredComment(ctx, pgtype.Text{
		String: comment.ID, Valid: true,
	}); err == nil {
		_ = existing
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	anchorWS := link.WorkspaceID
	msg, err := q.CreateMirroredChatThreadReply(ctx, db.CreateMirroredChatThreadReplyParams{
		ID: util.NewID(), RoomID: link.RoomID, WorkspaceID: anchorWS,
		SenderID: comment.AuthorID, SenderKind: comment.AuthorKind, Body: comment.Body,
		ReplyToMessageID:      pgtype.Text{String: link.ThreadRootID, Valid: true},
		ThreadRootID:          pgtype.Text{String: link.ThreadRootID, Valid: true},
		MirroredFromCommentID: pgtype.Text{String: comment.ID, Valid: true},
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil
		}
		return err
	}
	if _, err := q.BumpChatThreadReplyStats(ctx, db.BumpChatThreadReplyStatsParams{
		RepliedAt: msg.CreatedAt, ThreadRootID: link.ThreadRootID,
		RoomID: link.RoomID, WorkspaceID: anchorWS,
	}); err != nil {
		return err
	}
	_ = q.TouchChatRoomUpdatedAt(ctx, link.RoomID)
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if c.chat != nil {
		c.chat.publishChatRoomEvent(ctx, link.RoomID, Event{
			Type: "chat.thread.replied",
			Payload: map[string]string{
				"room_id": link.RoomID, "thread_root_id": link.ThreadRootID, "message_id": msg.ID,
			},
		})
		c.chat.publishCreatedChatMessage(ctx, db.ChatRoom{ID: link.RoomID, WorkspaceID: pgtype.Text{String: anchorWS, Valid: true}}, msg.ID)
	}
	return nil
}

func (c *ChatTaskSyncConsumer) dropLinkAndNotify(ctx context.Context, link db.ChatThreadTaskLink, body string) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	if _, err := q.DeleteChatThreadTaskLinkByThread(ctx, db.DeleteChatThreadTaskLinkByThreadParams{
		ThreadRootID: link.ThreadRootID, WorkspaceID: link.WorkspaceID,
	}); err != nil {
		return err
	}
	msg, err := q.CreateMirroredChatThreadReply(ctx, db.CreateMirroredChatThreadReplyParams{
		ID: util.NewID(), RoomID: link.RoomID, WorkspaceID: link.WorkspaceID,
		SenderID: link.CreatedBy, SenderKind: string(audit.KindSystem), Body: body,
		ReplyToMessageID:      pgtype.Text{String: link.ThreadRootID, Valid: true},
		ThreadRootID:          pgtype.Text{String: link.ThreadRootID, Valid: true},
		MirroredFromCommentID: pgtype.Text{},
	})
	if err != nil {
		return err
	}
	if _, err := q.BumpChatThreadReplyStats(ctx, db.BumpChatThreadReplyStatsParams{
		RepliedAt: msg.CreatedAt, ThreadRootID: link.ThreadRootID,
		RoomID: link.RoomID, WorkspaceID: link.WorkspaceID,
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}
