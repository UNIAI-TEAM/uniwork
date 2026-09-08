package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	idempotencyScopeTaskCreate = "tasks.create"
	maxBatchTaskIDs            = 100
)

// UpdateTaskSuiteInput is a revision-aware update. Revision must match the
// server's current value or the call fails with revision_conflict.
type UpdateTaskSuiteInput struct {
	Revision int64
	Title    *string
	Status   *string
	Priority *string
	Position *float64
}

// BatchUpdateTasksInput applies one patch to many tasks in a workspace.
type BatchUpdateTasksInput struct {
	TaskIDs []string
	Patch   UpdateTaskInput
}

// CreateTaskSuite creates a task, optionally keyed by Idempotency-Key (empty
// key skips the claim). A completed prior claim replays the stored task.
// Claim, create, and response commit share one transaction so a failed create
// never leaves the key stranded in_flight.
func (s *TaskService) CreateTaskSuite(ctx context.Context, actor Actor, workspaceID string, in CreateTaskInput, idempotencyKey string) (db.Task, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Task{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Task{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	replay, commit, err := BeginIdempotent(ctx, q, ws.OrganizationID, workspaceID, idempotencyScopeTaskCreate, idempotencyKey, actor.ID)
	if err != nil {
		return db.Task{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		var task db.Task
		if err := json.Unmarshal(replay.Body, &task); err != nil {
			return db.Task{}, err
		}
		return task, nil
	}

	task, err := s.createTaskInTx(ctx, q, actor, ws, workspaceID, in)
	if err != nil {
		return db.Task{}, err
	}
	body, err := json.Marshal(task)
	if err != nil {
		return db.Task{}, err
	}
	if err := commit(http.StatusOK, body); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

// UpdateTaskSuite refuses a stale revision then applies fields and bumps
// revision exactly once for title/status/priority/position updates.
func (s *TaskService) UpdateTaskSuite(ctx context.Context, actor Actor, taskID string, in UpdateTaskSuiteInput) (db.Task, error) {
	before, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Task{}, err
	}
	if err := CheckTaskRevision(in.Revision, before.Revision); err != nil {
		return db.Task{}, err
	}
	return s.Update(ctx, actor, taskID, UpdateTaskInput{
		Title:    in.Title,
		Status:   in.Status,
		Priority: in.Priority,
		Position: in.Position,
	})
}

// BatchUpdateTasks applies Patch to every listed id in one transaction.
// Unknown (missing/foreign) non-empty ids fail the whole batch; empty strings
// are ignored. Membership is required once for the workspace.
func (s *TaskService) BatchUpdateTasks(ctx context.Context, actor Actor, workspaceID string, in BatchUpdateTasksInput) (int, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return 0, err
	}
	if len(in.TaskIDs) == 0 {
		return 0, Invalid("task_ids không được để trống")
	}
	if len(in.TaskIDs) > maxBatchTaskIDs {
		return 0, Invalid("task_ids tối đa 100")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return 0, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated := 0
	for _, id := range in.TaskIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		task, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
			ID: id, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, Invalid("task_ids chứa id không thuộc workspace")
			}
			return 0, err
		}
		if _, err := s.updateTaskInTx(ctx, q, actor, task, ws, in.Patch); err != nil {
			return 0, err
		}
		updated++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return updated, nil
}

// BatchDeleteTasks deletes every listed id in one transaction. Unknown
// non-empty ids fail the whole batch; empty strings are ignored.
func (s *TaskService) BatchDeleteTasks(ctx context.Context, actor Actor, workspaceID string, taskIDs []string) (int, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return 0, err
	}
	if len(taskIDs) == 0 {
		return 0, Invalid("task_ids không được để trống")
	}
	if len(taskIDs) > maxBatchTaskIDs {
		return 0, Invalid("task_ids tối đa 100")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return 0, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	deleted := 0
	for _, id := range taskIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		task, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
			ID: id, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, Invalid("task_ids chứa id không thuộc workspace")
			}
			return 0, err
		}
		if err := s.deleteTaskInTx(ctx, q, actor.ID, task, ws); err != nil {
			return 0, err
		}
		deleted++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return deleted, nil
}

// NormalizeIdempotencyError maps the bare in-flight sentinel to a coded error.
func NormalizeIdempotencyError(err error) error {
	if errors.Is(err, ErrIdempotencyInFlight) {
		return CodedError{
			Code:   "idempotency_in_flight",
			Status: http.StatusConflict,
			Msg:    "yêu cầu trùng đang được xử lý; thử lại sau",
			Err:    ErrIdempotencyInFlight,
		}
	}
	return err
}
