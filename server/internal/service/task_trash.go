package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Trash moves a live task and every live descendant into one new trash batch.
// Nothing else changes: attachments, file holds, chat links, subscribers and
// comments stay, so a restore brings back exactly what left.
func (s *TaskService) Trash(ctx context.Context, actor Actor, taskID string) (TrashResult, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return TrashResult{}, err
	}
	return s.trashTasks(ctx, actor, task.OrganizationID, task.WorkspaceID, []string{task.ID})
}

// TrashMany is the batch delete: at most maxBatchTaskIDs ids, one unknown or
// foreign id fails the whole call, and every listed subtree lands in one batch
// so one restore undoes it.
func (s *TaskService) TrashMany(ctx context.Context, actor Actor, workspaceID string, ids []string) (TrashResult, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TrashResult{}, err
	}
	if len(ids) == 0 {
		return TrashResult{}, Invalid("task_ids không được để trống")
	}
	if len(ids) > maxBatchTaskIDs {
		return TrashResult{}, Invalid("task_ids tối đa 100")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TrashResult{}, err
	}
	return s.trashTasks(ctx, actor, ws.OrganizationID, workspaceID, ids)
}

// trashTasks stamps the live subtrees of roots with one batch, in one
// transaction. Empty ids are skipped; a root that is not a live task of the
// workspace refuses the whole call before anything is written.
func (s *TaskService) trashTasks(ctx context.Context, actor Actor, organizationID, workspaceID string, roots []string) (TrashResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TrashResult{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	seen := map[string]bool{}
	var ids []string
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" || seen[root] {
			continue
		}
		if _, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
			ID: root, OrganizationID: organizationID, WorkspaceID: workspaceID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return TrashResult{}, Invalid("task_ids chứa id không thuộc workspace")
			}
			return TrashResult{}, err
		}
		subtree, err := q.ListDescendantTaskIDs(ctx, db.ListDescendantTaskIDsParams{
			RootID: root, OrganizationID: organizationID, WorkspaceID: workspaceID,
		})
		if err != nil {
			return TrashResult{}, err
		}
		for _, id := range subtree {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		if len(ids) > taskTrashMaxNodes {
			return TrashResult{}, CodedError{
				Code: "trash_too_large", Status: http.StatusUnprocessableEntity,
				Msg: fmt.Sprintf("không thể chuyển quá %d task vào thùng rác một lần", taskTrashMaxNodes),
			}
		}
	}
	if len(ids) == 0 {
		return TrashResult{}, nil
	}
	batch := util.NewID()
	trashed, err := q.TrashTasks(ctx, db.TrashTasksParams{
		TrashedBy:      pgtype.Text{String: actor.ID, Valid: true},
		PurgeAfter:     pgtype.Timestamptz{Time: time.Now().Add(trashRetention), Valid: true},
		TrashBatchID:   pgtype.Text{String: batch, Valid: true},
		OrganizationID: organizationID, WorkspaceID: workspaceID, Ids: ids,
	})
	if err != nil {
		return TrashResult{}, err
	}
	if err := recordTaskBatch(ctx, q, actor, organizationID, workspaceID, audit.ActionTaskTrashed, batch, trashed); err != nil {
		return TrashResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TrashResult{}, err
	}
	return TrashResult{BatchID: batch, IDs: trashed}, nil
}

// Restore brings back the whole batch taskID left in. A member whose parent
// is not coming back with it (trashed in another batch, or purged) returns as
// a root.
func (s *TaskService) Restore(ctx context.Context, actor Actor, taskID string) (TrashResult, error) {
	task, err := s.authorizeTrashed(ctx, actor, taskID)
	if err != nil {
		return TrashResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TrashResult{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	locked, err := lockTrashedTask(ctx, q, task)
	if err != nil {
		return TrashResult{}, err
	}
	batch := locked.TrashBatchID
	// The orphan check reads trash_batch_id, so it runs before the restore
	// clears it.
	if _, err := q.UnparentRestoredOrphans(ctx, db.UnparentRestoredOrphansParams{
		OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, TrashBatchID: batch,
	}); err != nil {
		return TrashResult{}, err
	}
	restored, err := q.RestoreTaskBatch(ctx, db.RestoreTaskBatchParams{
		OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, TrashBatchID: batch,
	})
	if err != nil {
		return TrashResult{}, err
	}
	if err := recordTaskBatch(ctx, q, actor, locked.OrganizationID, locked.WorkspaceID, audit.ActionTaskRestored, batch.String, restored); err != nil {
		return TrashResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TrashResult{}, err
	}
	return TrashResult{BatchID: batch.String, IDs: restored}, nil
}

// Purge deletes a trashed task for good, with its descendants that left in
// the same batch; batch siblings that are roots of their own stay. Each row
// goes through purgeTaskInTx, so each writes its own task.deleted.
func (s *TaskService) Purge(ctx context.Context, actor Actor, taskID string) error {
	task, err := s.authorizeTrashed(ctx, actor, taskID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	root, err := lockTrashedTask(ctx, q, task)
	if err != nil {
		return err
	}
	rows, err := q.LockTaskTrashSubtree(ctx, db.LockTaskTrashSubtreeParams{
		OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, RootID: root.ID,
	})
	if err != nil {
		return err
	}
	for _, row := range rows {
		// A row restored while this purge waited for its lock left the batch.
		if !row.TrashedAt.Valid || row.TrashBatchID != root.TrashBatchID {
			continue
		}
		if err := s.purgeTaskInTx(ctx, q, row, actor); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ListTrash is one page of a workspace's task trash: a row per batch root,
// newest first, 50 per page.
func (s *TaskService) ListTrash(ctx context.Context, actorID, workspaceID string, cursor string) (TrashPage[TaskTrashRow], error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, actorID); err != nil {
		return TrashPage[TaskTrashRow]{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TrashPage[TaskTrashRow]{}, err
	}
	params := db.ListTaskTrashPageParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, MaxRows: trashPageSize + 1,
	}
	if cursor != "" {
		at, id, err := decodeFeedCursor(cursor)
		if err != nil {
			return TrashPage[TaskTrashRow]{}, err
		}
		// Both halves or neither: a half cursor would read an empty page.
		params.BeforeTrashedAt = pgtype.Timestamptz{Time: at, Valid: true}
		params.BeforeID = pgtype.Text{String: id, Valid: true}
	}
	rows, err := s.q.ListTaskTrashPage(ctx, params)
	if err != nil {
		return TrashPage[TaskTrashRow]{}, err
	}
	var page TrashPage[TaskTrashRow]
	if len(rows) > trashPageSize {
		rows = rows[:trashPageSize]
		last := rows[len(rows)-1]
		page.NextCursor = encodeFeedCursor(last.TrashedAt.Time, last.ID)
	}
	page.Items = make([]TaskTrashRow, 0, len(rows))
	for _, r := range rows {
		page.Items = append(page.Items, TaskTrashRow{
			ID: r.ID, Identifier: fmt.Sprintf("%s-%d", ws.TaskPrefix, r.Number), Title: r.Title,
			TrashedBy: r.TrashedBy.String, TrashedAt: r.TrashedAt.Time, PurgeAfter: r.PurgeAfter.Time,
			BatchSize: int(r.BatchSize),
		})
	}
	return page, nil
}

// authorizeTrashed is authorize for restore and purge: GetTask hides a
// trashed row, so the row is read including the trash and the same workspace
// gate runs before anything about it is told. A live row is not found.
func (s *TaskService) authorizeTrashed(ctx context.Context, actor Actor, taskID string) (db.Task, error) {
	task, err := s.q.GetTaskByIDIncludingTrashed(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Task{}, ErrNotFound
	}
	if err != nil {
		return db.Task{}, err
	}
	if err := s.ws.requireActorMember(ctx, task.WorkspaceID, actor); err != nil {
		return db.Task{}, err
	}
	if !task.TrashedAt.Valid {
		return db.Task{}, ErrNotFound
	}
	return task, nil
}

// lockTrashedTask takes the row lock restore and purge share with the purge
// worker, then re-reads: whoever locks second finds the row gone or restored
// and answers not found.
func lockTrashedTask(ctx context.Context, q *db.Queries, task db.Task) (db.Task, error) {
	locked, err := q.LockTaskForPurge(ctx, db.LockTaskForPurgeParams{
		ID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !locked.TrashedAt.Valid) {
		return db.Task{}, ErrNotFound
	}
	return locked, err
}

// recordTaskBatch writes one audit row and one event per task of a trash or
// restore; the action and the topic share the name.
func recordTaskBatch(ctx context.Context, q *db.Queries, actor Actor, organizationID, workspaceID, action, batch string, ids []string) error {
	recs := make([]audit.Recorded, 0, len(ids))
	for _, id := range ids {
		recs = append(recs, audit.Recorded{
			Entry: audit.Entry{
				OrganizationID: organizationID, WorkspaceID: workspaceID,
				Actor: actor, Action: action,
				ResourceType: "task", ResourceID: id,
				Metadata: map[string]any{"trash_batch_id": batch},
			},
			Events: []audit.Event{{Topic: action, Payload: map[string]string{
				"task_id": id, "workspace_id": workspaceID,
			}}},
		})
	}
	return auditRecorder.RecordMany(ctx, q, recs)
}
