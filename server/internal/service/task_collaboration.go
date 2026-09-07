package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const idempotencyScopeCommentCreate = "tasks.comment_create"

// AddCommentInput is a threaded comment create (optional parent).
type AddCommentInput struct {
	Body        string
	ParentID    *string
	CommentType string
}

// UpdateCommentInput edits comment body (revision bump).
type UpdateCommentInput struct {
	Body string
}

// SubscribeTaskInput targets a subscriber; empty UserID means the caller.
type SubscribeTaskInput struct {
	UserID   string
	UserType string // member|agent; default member for humans
}

func collaborationUnavailable(reason, msg string) error {
	return CodedError{
		Code:   "capability_unavailable",
		Status: http.StatusUnprocessableEntity,
		Msg:    msg,
		Fields: map[string]any{"reason_code": reason},
	}
}

func validateReactionEmoji(emoji string) (string, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len(emoji) > maxReactionEmojiLen {
		return "", Invalid("emoji không hợp lệ")
	}
	return emoji, nil
}

func (s *TaskService) commentActorType(kind audit.Kind) string {
	return normalizedCreatorType(kind)
}

func (s *TaskService) loadComment(ctx context.Context, actor Actor, commentID string) (db.TaskComment, error) {
	c, err := s.q.GetTaskCommentByID(ctx, commentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.TaskComment{}, ErrNotFound
		}
		return db.TaskComment{}, err
	}
	if err := s.ws.requireActorMember(ctx, c.WorkspaceID, actor); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// GetComment returns one comment after membership check.
func (s *TaskService) GetComment(ctx context.Context, actor Actor, commentID string) (db.TaskComment, error) {
	return s.loadComment(ctx, actor, commentID)
}

// AddCommentSuite creates a comment with optional parent and Idempotency-Key.
func (s *TaskService) AddCommentSuite(ctx context.Context, actor Actor, taskID string, in AddCommentInput, idempotencyKey string) (db.TaskComment, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.TaskComment{}, err
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return db.TaskComment{}, Invalid("nội dung không được để trống")
	}
	commentType := strings.TrimSpace(in.CommentType)
	if commentType == "" {
		commentType = "comment"
	}
	switch commentType {
	case "comment", "status_change", "progress_update", "system":
	default:
		return db.TaskComment{}, Invalid("comment_type không hợp lệ")
	}

	var parentText pgtype.Text
	if in.ParentID != nil && strings.TrimSpace(*in.ParentID) != "" {
		pid := strings.TrimSpace(*in.ParentID)
		parent, err := s.q.GetTaskComment(ctx, db.GetTaskCommentParams{
			ID: pid, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.TaskComment{}, ErrNotFound
			}
			return db.TaskComment{}, err
		}
		if parent.TaskID != taskID {
			return db.TaskComment{}, Invalid("parent_id không thuộc công việc này")
		}
		parentText = pgtype.Text{String: pid, Valid: true}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	replay, commit, err := BeginIdempotent(ctx, q, task.OrganizationID, task.WorkspaceID, idempotencyScopeCommentCreate, idempotencyKey, actor.ID)
	if err != nil {
		return db.TaskComment{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		var c db.TaskComment
		if err := json.Unmarshal(replay.Body, &c); err != nil {
			return db.TaskComment{}, err
		}
		return c, nil
	}

	c, err := q.CreateTaskCommentThreaded(ctx, db.CreateTaskCommentThreadedParams{
		ID: util.NewID(), OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		TaskID: taskID, AuthorID: actor.ID, AuthorKind: string(actor.Kind), Body: body,
		ParentCommentID: parentText, CommentType: commentType,
	})
	if err != nil {
		return db.TaskComment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskCommentAdded,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"comment_id": c.ID},
	}, audit.Event{Topic: "task.comment_added", Payload: map[string]string{
		"task_id": taskID, "comment_id": c.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.TaskComment{}, err
	}
	bodyJSON, err := json.Marshal(c)
	if err != nil {
		return db.TaskComment{}, err
	}
	if err := commit(http.StatusOK, bodyJSON); err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// UpdateComment edits body; author only (or workspace admin via RequireMember is enough for MVP suite — author check).
func (s *TaskService) UpdateComment(ctx context.Context, actor Actor, commentID string, in UpdateCommentInput) (db.TaskComment, error) {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return db.TaskComment{}, err
	}
	if before.AuthorID != actor.ID || before.AuthorKind != string(actor.Kind) {
		return db.TaskComment{}, ErrForbidden
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return db.TaskComment{}, Invalid("nội dung không được để trống")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	c, err := q.UpdateTaskCommentBody(ctx, db.UpdateTaskCommentBodyParams{
		ID: commentID, OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID, Body: body,
	})
	if err != nil {
		return db.TaskComment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskCommentUpdated,
		ResourceType: "task", ResourceID: before.TaskID,
		Metadata: map[string]any{"comment_id": c.ID},
	}, audit.Event{Topic: "task.comment_updated", Payload: map[string]string{
		"task_id": before.TaskID, "comment_id": c.ID, "workspace_id": before.WorkspaceID,
	}}); err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// DeleteComment removes a comment; author only.
func (s *TaskService) DeleteComment(ctx context.Context, actor Actor, commentID string) error {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return err
	}
	if before.AuthorID != actor.ID || before.AuthorKind != string(actor.Kind) {
		return ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.DeleteTaskComment(ctx, db.DeleteTaskCommentParams{
		ID: commentID, OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskCommentDeleted,
		ResourceType: "task", ResourceID: before.TaskID,
		Metadata: map[string]any{"comment_id": commentID},
	}, audit.Event{Topic: "task.comment_deleted", Payload: map[string]string{
		"task_id": before.TaskID, "comment_id": commentID, "workspace_id": before.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ResolveComment marks a comment resolved.
func (s *TaskService) ResolveComment(ctx context.Context, actor Actor, commentID string) (db.TaskComment, error) {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return db.TaskComment{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	c, err := q.ResolveTaskComment(ctx, db.ResolveTaskCommentParams{
		ID: commentID, OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		ResolvedByType: pgtype.Text{String: s.commentActorType(actor.Kind), Valid: true},
		ResolvedByID:   pgtype.Text{String: actor.ID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return before, nil // already resolved
		}
		return db.TaskComment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskCommentResolved,
		ResourceType: "task", ResourceID: before.TaskID,
		Metadata: map[string]any{"comment_id": c.ID},
	}, audit.Event{Topic: "task.comment_resolved", Payload: map[string]string{
		"task_id": before.TaskID, "comment_id": c.ID, "workspace_id": before.WorkspaceID,
	}}); err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// UnresolveComment clears resolution.
func (s *TaskService) UnresolveComment(ctx context.Context, actor Actor, commentID string) (db.TaskComment, error) {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return db.TaskComment{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	c, err := q.UnresolveTaskComment(ctx, db.UnresolveTaskCommentParams{
		ID: commentID, OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return before, nil
		}
		return db.TaskComment{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskCommentUnresolved,
		ResourceType: "task", ResourceID: before.TaskID,
		Metadata: map[string]any{"comment_id": c.ID},
	}, audit.Event{Topic: "task.comment_unresolved", Payload: map[string]string{
		"task_id": before.TaskID, "comment_id": c.ID, "workspace_id": before.WorkspaceID,
	}}); err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// AddCommentReaction upserts an emoji on a comment.
func (s *TaskService) AddCommentReaction(ctx context.Context, actor Actor, commentID, emoji string) (db.CommentReaction, error) {
	c, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return db.CommentReaction{}, err
	}
	emoji, err = validateReactionEmoji(emoji)
	if err != nil {
		return db.CommentReaction{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.CommentReaction{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.InsertCommentReaction(ctx, db.InsertCommentReactionParams{
		ID: util.NewID(), OrganizationID: c.OrganizationID, WorkspaceID: c.WorkspaceID,
		CommentID: commentID, ActorType: s.commentActorType(actor.Kind), ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		return db.CommentReaction{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: c.OrganizationID, WorkspaceID: c.WorkspaceID,
		Actor: actor, Action: audit.ActionCommentReactionAdded,
		ResourceType: "task", ResourceID: c.TaskID,
		Metadata: map[string]any{"comment_id": commentID, "emoji": emoji},
	}, audit.Event{Topic: "comment.reaction_added", Payload: map[string]string{
		"task_id": c.TaskID, "comment_id": commentID, "workspace_id": c.WorkspaceID,
	}}); err != nil {
		return db.CommentReaction{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.CommentReaction{}, err
	}
	return row, nil
}

// RemoveCommentReaction deletes the caller's emoji.
func (s *TaskService) RemoveCommentReaction(ctx context.Context, actor Actor, commentID, emoji string) error {
	c, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return err
	}
	emoji, err = validateReactionEmoji(emoji)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.DeleteCommentReaction(ctx, db.DeleteCommentReactionParams{
		CommentID: commentID, OrganizationID: c.OrganizationID, WorkspaceID: c.WorkspaceID,
		ActorType: s.commentActorType(actor.Kind), ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: c.OrganizationID, WorkspaceID: c.WorkspaceID,
		Actor: actor, Action: audit.ActionCommentReactionRemoved,
		ResourceType: "task", ResourceID: c.TaskID,
		Metadata: map[string]any{"comment_id": commentID, "emoji": emoji},
	}, audit.Event{Topic: "comment.reaction_removed", Payload: map[string]string{
		"task_id": c.TaskID, "comment_id": commentID, "workspace_id": c.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AddTaskReaction upserts an emoji on a task.
func (s *TaskService) AddTaskReaction(ctx context.Context, actor Actor, taskID, emoji string) (db.TaskReaction, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.TaskReaction{}, err
	}
	emoji, err = validateReactionEmoji(emoji)
	if err != nil {
		return db.TaskReaction{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskReaction{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.InsertTaskReaction(ctx, db.InsertTaskReactionParams{
		ID: util.NewID(), OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		TaskID: taskID, ActorType: s.commentActorType(actor.Kind), ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		return db.TaskReaction{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskReactionAdded,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"emoji": emoji},
	}, audit.Event{Topic: "task.reaction_added", Payload: map[string]string{
		"task_id": taskID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.TaskReaction{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskReaction{}, err
	}
	return row, nil
}

// RemoveTaskReaction deletes the caller's emoji on a task.
func (s *TaskService) RemoveTaskReaction(ctx context.Context, actor Actor, taskID, emoji string) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	emoji, err = validateReactionEmoji(emoji)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	n, err := q.DeleteTaskReaction(ctx, db.DeleteTaskReactionParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		ActorType: s.commentActorType(actor.Kind), ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskReactionRemoved,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"emoji": emoji},
	}, audit.Event{Topic: "task.reaction_removed", Payload: map[string]string{
		"task_id": taskID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
