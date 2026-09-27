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
	Body          string
	ParentID      *string
	CommentType   string
	Origin        string  // e.g. "chat" when mirrored from a thread reply
	ChatMessageID *string // set when the comment mirrors a chat message
}

// UpdateCommentInput edits comment body (revision bump).
type UpdateCommentInput struct {
	Body string
}

// SubscribeTaskInput identifies the caller; empty UserID means the caller.
// A non-empty target must still match the caller so one member cannot change
// another member's notification preferences.
type SubscribeTaskInput struct {
	UserID   string
	UserType string // member|agent; default member for humans
}

func collaborationUnavailable(reason, msg string) error {
	return CapabilityUnavailable(reason, msg)
}

func validateReactionEmoji(emoji string) (string, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len(emoji) > maxReactionEmojiLen {
		return "", Invalid("emoji không hợp lệ")
	}
	return emoji, nil
}

func commentOrigin(origin string) pgtype.Text {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: origin, Valid: true}
}

// taskCommentAdapter is the task_comments half of the shared comment core:
// the table's sqlc queries, the task comment_type allowlist, and moderation
// by author-or-workspace-admin. Task comments keep the wide type list -
// status_change/progress_update/system rows are internal TaskService writes.
type taskCommentAdapter struct {
	svc *TaskService
}

func (a taskCommentAdapter) byID(ctx context.Context, q *db.Queries, id string) (db.TaskComment, error) {
	return q.GetTaskCommentByID(ctx, id)
}

func (a taskCommentAdapter) tenantGet(ctx context.Context, q *db.Queries, ref CommentRef, id string) (db.TaskComment, error) {
	return q.GetTaskComment(ctx, db.GetTaskCommentParams{
		ID: id, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

func (taskCommentAdapter) identity(c db.TaskComment) commentIdentity {
	return commentIdentity{ID: c.ID, ResourceID: c.TaskID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind}
}

func (taskCommentAdapter) insert(ctx context.Context, q *db.Queries, ref CommentRef, in AddCommentInput, p preparedComment) (db.TaskComment, error) {
	return q.CreateTaskCommentThreaded(ctx, db.CreateTaskCommentThreadedParams{
		ID: p.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		TaskID: ref.ResourceID, AuthorID: p.AuthorID, AuthorKind: p.AuthorKind, Body: p.Body,
		Origin: commentOrigin(in.Origin), ParentCommentID: p.ParentID, CommentType: p.CommentType,
		ChatMessageID: optText(in.ChatMessageID),
	})
}

func (taskCommentAdapter) updateBody(ctx context.Context, q *db.Queries, ref CommentRef, c db.TaskComment, body string) (db.TaskComment, error) {
	return q.UpdateTaskCommentBody(ctx, db.UpdateTaskCommentBodyParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID, Body: body,
	})
}

func (taskCommentAdapter) remove(ctx context.Context, q *db.Queries, ref CommentRef, c db.TaskComment) error {
	return q.DeleteTaskComment(ctx, db.DeleteTaskCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

func (taskCommentAdapter) resolve(ctx context.Context, q *db.Queries, ref CommentRef, c db.TaskComment, resolvedByType, resolvedByID string) (db.TaskComment, error) {
	return q.ResolveTaskComment(ctx, db.ResolveTaskCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		ResolvedByType: pgtype.Text{String: resolvedByType, Valid: true},
		ResolvedByID:   pgtype.Text{String: resolvedByID, Valid: true},
	})
}

func (taskCommentAdapter) unresolve(ctx context.Context, q *db.Queries, ref CommentRef, c db.TaskComment) (db.TaskComment, error) {
	return q.UnresolveTaskComment(ctx, db.UnresolveTaskCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

func (taskCommentAdapter) commentTypes() []string {
	return []string{"comment", "status_change", "progress_update", "system"}
}

func (taskCommentAdapter) foreignParentError() error {
	return Invalid("parent_id không thuộc công việc này")
}

func (a taskCommentAdapter) canModerate(ctx context.Context, actor Actor, _ CommentRef, c db.TaskComment) (bool, error) {
	return a.svc.canManageComment(ctx, actor, c)
}

// beforeDelete releases comment-bound attachments inside the delete
// transaction (nothing writes comment_id today - comment uploads bind to
// the task - but a row that does carry one releases its file here).
func (a taskCommentAdapter) beforeDelete(ctx context.Context, q *db.Queries, ref CommentRef, c db.TaskComment) error {
	if a.svc.files == nil {
		return nil
	}
	fileIDs, err := q.ListAttachmentFileIDsByComment(ctx, db.ListAttachmentFileIDsByCommentParams{
		OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		CommentID: pgtype.Text{String: c.ID, Valid: true},
	})
	if err != nil {
		return err
	}
	return releaseFilesInTx(ctx, a.svc.files, q, attachmentFileIDs(fileIDs))
}

func (taskCommentAdapter) verbs() commentVerbs {
	return commentVerbs{
		resourceType:    "task",
		added:           audit.ActionTaskCommentAdded,
		updated:         audit.ActionTaskCommentUpdated,
		deleted:         audit.ActionTaskCommentDeleted,
		resolved:        audit.ActionTaskCommentResolved,
		unresolved:      audit.ActionTaskCommentUnresolved,
		reactionAdded:   audit.ActionCommentReactionAdded,
		reactionRemoved: audit.ActionCommentReactionRemoved,
	}
}

func taskCommentRef(task db.Task) CommentRef {
	return CommentRef{Kind: CommentResourceTask, ResourceID: task.ID,
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID}
}

func taskCommentRefFor(c db.TaskComment) CommentRef {
	return CommentRef{Kind: CommentResourceTask, ResourceID: c.TaskID,
		OrganizationID: c.OrganizationID, WorkspaceID: c.WorkspaceID}
}

func (s *TaskService) loadComment(ctx context.Context, actor Actor, commentID string) (db.TaskComment, error) {
	c, err := taskCommentAdapter{s}.byID(ctx, s.q, commentID)
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
	ad := taskCommentAdapter{s}
	ref := taskCommentRef(task)

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

	c, err := addCommentOn(ctx, q, ad, ref, actor, in)
	if err != nil {
		// A chat-mirrored comment losing the chat_message_id unique race
		// returns the row that won it (chat_task_sync replays by message).
		if in.ChatMessageID != nil && isUniqueViolation(err) {
			existing, lookupErr := s.q.GetTaskCommentByChatMessageID(ctx, pgtype.Text{
				String: strings.TrimSpace(*in.ChatMessageID), Valid: true,
			})
			if lookupErr != nil {
				return db.TaskComment{}, lookupErr
			}
			return existing, nil
		}
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

func (s *TaskService) canManageComment(ctx context.Context, actor Actor, comment db.TaskComment) (bool, error) {
	if comment.AuthorID == actor.ID && comment.AuthorKind == string(actor.Kind) {
		return true, nil
	}
	if actor.Kind != audit.KindHuman {
		return false, nil
	}
	member, err := s.ws.RequireMember(ctx, comment.WorkspaceID, actor.ID)
	if err != nil {
		return false, err
	}
	return member.Role == "owner" || member.Role == "admin", nil
}

// UpdateComment edits body; authors and workspace moderators may edit.
func (s *TaskService) UpdateComment(ctx context.Context, actor Actor, commentID string, in UpdateCommentInput) (db.TaskComment, error) {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return db.TaskComment{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	c, err := updateCommentOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(before), actor, commentID, in)
	if err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

// DeleteComment removes a comment; authors and workspace moderators may delete.
func (s *TaskService) DeleteComment(ctx context.Context, actor Actor, commentID string) error {
	before, err := s.loadComment(ctx, actor, commentID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := deleteCommentOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(before), actor, commentID); err != nil {
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
	c, err := setCommentResolvedOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(before), actor, commentID, true)
	if err != nil {
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
	c, err := setCommentResolvedOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(before), actor, commentID, false)
	if err != nil {
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.CommentReaction{}, err
	}
	defer tx.Rollback(ctx)
	row, err := reactToCommentOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(c), actor, commentID, emoji)
	if err != nil {
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := unreactToCommentOn(ctx, s.q.WithTx(tx), taskCommentAdapter{s}, taskCommentRefFor(c), actor, commentID, emoji); err != nil {
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
	actorType := commentActorType(actor.Kind)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskReaction{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.InsertTaskReaction(ctx, db.InsertTaskReactionParams{
		ID: util.NewID(), OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		TaskID: taskID, ActorType: actorType, ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return db.TaskReaction{}, err
		}
		existing, lerr := q.ListTaskReactions(ctx, db.ListTaskReactionsParams{
			TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		})
		if lerr != nil {
			return db.TaskReaction{}, lerr
		}
		for _, r := range existing {
			if r.ActorType == actorType && r.ActorID == actor.ID && r.Emoji == emoji {
				if err := tx.Commit(ctx); err != nil {
					return db.TaskReaction{}, err
				}
				return r, nil
			}
		}
		return db.TaskReaction{}, ErrNotFound
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

// TaskReactions returns every reaction after applying the task visibility gate.
func (s *TaskService) TaskReactions(ctx context.Context, actor Actor, taskID string) ([]db.TaskReaction, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskReactions(ctx, db.ListTaskReactionsParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
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
		ActorType: commentActorType(actor.Kind), ActorID: actor.ID, Emoji: emoji,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return tx.Commit(ctx) // no-op remove — no audit
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
