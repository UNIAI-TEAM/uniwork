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
	return []string{"chat.thread.reply_linked", "task.comment_added", "task.comment_updated", "task.comment_deleted"}
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
	case "task.comment_updated", "task.comment_deleted":
		return c.syncCommentChangeToChat(ctx, ev.Topic == "task.comment_deleted", payload)
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
	// A room made private after the link was made stops feeding the task.
	room, err := c.q.GetChatRoomByID(ctx, link.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if chatRoomIsPrivate(room) {
		return nil
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
	// The reply goes out under the commenter's name, so it lands only where
	// they could post it themselves.
	room, err := c.q.GetChatRoomByID(ctx, link.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if room.ArchivedAt.Valid || chatRoomIsPrivate(room) {
		return nil
	}
	if err := c.chat.requireCanSendInRoom(ctx, comment.AuthorID, room.ID, room); err != nil {
		var invalid ValidationError
		var refused CodedError
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, ErrForbidden) ||
			errors.As(err, &invalid) || errors.As(err, &refused) {
			return nil // not a member, muted, or the room forbids sending
		}
		return err // a DB error: let the outbox retry
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
		ID: util.NewID(), RoomID: link.RoomID, OrganizationID: link.OrganizationID, WorkspaceID: anchorWS,
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
		c.chat.publishCreatedChatMessage(ctx, db.ChatRoom{ID: link.RoomID, WorkspaceID: pgtype.Text{String: anchorWS, Valid: true}}, msg.ID, msg.SenderID, link.ThreadRootID)
	}
	return nil
}

// syncCommentChangeToChat carries a task comment's edit or delete onto the
// thread reply mirrored from it. A comment copied from chat has no mirror,
// so this never loops back; a replay finds the reply already in step.
func (c *ChatTaskSyncConsumer) syncCommentChangeToChat(ctx context.Context, deleted bool, payload map[string]string) error {
	commentID := strings.TrimSpace(payload["comment_id"])
	if commentID == "" {
		return nil
	}
	msg, err := c.q.GetChatMessageByMirroredComment(ctx, pgtype.Text{String: commentID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	room, err := c.q.GetChatRoomByID(ctx, msg.RoomID)
	if err != nil {
		return err
	}
	if deleted {
		return c.deleteMirroredReply(ctx, room, msg)
	}
	comment, err := c.q.GetTaskCommentByID(ctx, commentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // deleted since; its own event removes the reply
	}
	if err != nil {
		return err
	}
	if comment.Body == msg.Body {
		return nil
	}
	if _, err := c.q.UpdateChatMessageBody(ctx, db.UpdateChatMessageBodyParams{
		ID: msg.ID, RoomID: msg.RoomID, WorkspaceID: msg.WorkspaceID, Body: comment.Body, SenderID: msg.SenderID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if c.chat != nil {
		c.chat.publishChatMessageUpdated(ctx, room, msg.ID)
	}
	return nil
}

func (c *ChatTaskSyncConsumer) deleteMirroredReply(ctx context.Context, room db.ChatRoom, msg db.ChatMessage) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	if _, err := q.SoftDeleteChatMessage(ctx, db.SoftDeleteChatMessageParams{
		ID: msg.ID, RoomID: msg.RoomID, WorkspaceID: msg.WorkspaceID, SenderID: msg.SenderID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if msg.ThreadRootID.Valid {
		if err := q.DropChatThreadReplyStats(ctx, db.DropChatThreadReplyStatsParams{
			ThreadRootID: msg.ThreadRootID, RoomID: msg.RoomID, WorkspaceID: msg.WorkspaceID,
		}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if c.chat != nil {
		c.chat.publishChatMessageDeleted(ctx, room, msg.ID)
		if msg.ThreadRootID.Valid {
			c.chat.publishChatMessageUpdated(ctx, room, msg.ThreadRootID.String)
		}
	}
	return nil
}

// updateCommentCopiedFromMessage rewrites the task comment copied from an
// edited thread reply; its task.comment_updated finds no mirror, so no loop.
func updateCommentCopiedFromMessage(ctx context.Context, q *db.Queries, userID string, msg db.ChatMessage) error {
	c, err := q.GetTaskCommentByChatMessageID(ctx, pgtype.Text{String: msg.ID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	ref := taskCommentRefFor(c)
	if _, err := q.UpdateTaskCommentBody(ctx, db.UpdateTaskCommentBodyParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID, Body: msg.Body,
	}); err != nil {
		return err
	}
	v := taskCommentAdapter{}.verbs()
	return recordCommentAudit(ctx, q, Human(userID), ref, v, v.updated, c.ID, map[string]any{"via": "chat"})
}

// deleteCommentCopiedFromMessage removes the task comment copied from a
// deleted thread reply, in the delete's transaction.
func deleteCommentCopiedFromMessage(ctx context.Context, q *db.Queries, userID, messageID string) error {
	c, err := q.GetTaskCommentByChatMessageID(ctx, pgtype.Text{String: messageID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	ref := taskCommentRefFor(c)
	if err := q.DeleteTaskComment(ctx, db.DeleteTaskCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	}); err != nil {
		return err
	}
	v := taskCommentAdapter{}.verbs()
	return recordCommentAudit(ctx, q, Human(userID), ref, v, v.deleted, c.ID, map[string]any{"via": "chat"})
}
