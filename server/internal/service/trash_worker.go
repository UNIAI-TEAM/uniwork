package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TrashWorker purges the tasks and projects whose 30 days in the trash ran
// out (UNI-2171), hourly like the document purge. Every row is purged in its
// own transaction under its row lock and re-checked there, so a restore that
// commits first wins and the row is skipped. Tasks go first: a project purge
// then has no expired task left to touch.
type TrashWorker struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	tasks *TaskService
	now   func() time.Time
	// afterPage runs after a page is read and before its rows are locked
	// (tests); "task" or "project". Nil in production.
	afterPage func(kind string)
}

const (
	trashPurgeTick  = time.Hour
	trashSweepBatch = documentSweepBatch
)

// NewTrashWorker builds the sweep cmd/server starts beside the document worker.
func NewTrashWorker(pool *pgxpool.Pool, q *db.Queries, tasks *TaskService, now func() time.Time) *TrashWorker {
	return &TrashWorker{pool: pool, q: q, tasks: tasks, now: now}
}

// Run blocks until ctx ends. The first pass runs at once so a fresh deploy
// does not sit a full tick behind.
func (w *TrashWorker) Run(ctx context.Context) {
	for {
		tasks, projects, err := w.PurgeExpired(ctx)
		if err != nil && ctx.Err() == nil {
			slog.Warn("trash purge: sweep failed, next tick retries", "err", err)
		} else if tasks+projects > 0 {
			slog.Info("trash purge", "tasks", tasks, "projects", projects)
		}
		t := time.NewTimer(trashPurgeTick)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// PurgeExpired purges every task, then every project, whose purge_after is
// before now. Keyset scans on (purge_after, id): a row that fails is logged
// and passed, so it never pins the sweep; the next tick retries it.
func (w *TrashWorker) PurgeExpired(ctx context.Context) (tasks, projects int, err error) {
	now := w.now()
	before := pgtype.Timestamptz{Time: now, Valid: true}
	var afterAt pgtype.Timestamptz
	var afterID pgtype.Text
	for {
		if ctx.Err() != nil {
			return tasks, projects, ctx.Err()
		}
		batch, err := w.q.ListTasksForPurge(ctx, db.ListTasksForPurgeParams{
			Now: before, AfterPurgeAfter: afterAt, AfterID: afterID, MaxRows: int32(trashSweepBatch),
		})
		if err != nil {
			return tasks, projects, err
		}
		if w.afterPage != nil {
			w.afterPage("task")
		}
		for _, r := range batch {
			if ctx.Err() != nil {
				return tasks, projects, ctx.Err()
			}
			purged, err := w.purgeTask(ctx, r, now)
			if err != nil {
				slog.Warn("trash purge: task failed, next sweep retries", "task", r.ID, "err", err)
			} else if purged {
				tasks++
			}
			afterAt, afterID = r.PurgeAfter, pgtype.Text{String: r.ID, Valid: true}
		}
		if len(batch) < trashSweepBatch {
			break
		}
	}
	afterAt, afterID = pgtype.Timestamptz{}, pgtype.Text{}
	for {
		if ctx.Err() != nil {
			return tasks, projects, ctx.Err()
		}
		batch, err := w.q.ListProjectsForPurge(ctx, db.ListProjectsForPurgeParams{
			Now: before, AfterPurgeAfter: afterAt, AfterID: afterID, MaxRows: int32(trashSweepBatch),
		})
		if err != nil {
			return tasks, projects, err
		}
		if w.afterPage != nil {
			w.afterPage("project")
		}
		for _, r := range batch {
			if ctx.Err() != nil {
				return tasks, projects, ctx.Err()
			}
			purged, err := w.purgeProject(ctx, r, now)
			if err != nil {
				slog.Warn("trash purge: project failed, next sweep retries", "project", r.ID, "err", err)
			} else if purged {
				projects++
			}
			afterAt, afterID = r.PurgeAfter, pgtype.Text{String: r.ID, Valid: true}
		}
		if len(batch) < trashSweepBatch {
			break
		}
	}
	return tasks, projects, nil
}

// purgeTask locks one task row and no other: task Restore and Purge lock
// their rows in ascending id order in one statement, so this one lock cannot
// close a wait cycle with them.
func (w *TrashWorker) purgeTask(ctx context.Context, r db.ListTasksForPurgeRow, now time.Time) (bool, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := w.q.WithTx(tx)
	task, err := q.LockTaskForPurge(ctx, db.LockTaskForPurgeParams{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // purged by a person meanwhile
	}
	if err != nil {
		return false, err
	}
	if !trashExpired(task.TrashedAt, task.PurgeAfter, now) {
		return false, nil // restored, or trashed again, since the page was read
	}
	if err := w.tasks.purgeTaskInTx(ctx, q, task, audit.System("tasks.purge")); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// purgeProject takes the project row lock first; purgeProjectInTx then locks
// the project's task rows in id order, the order project Restore uses.
func (w *TrashWorker) purgeProject(ctx context.Context, r db.ListProjectsForPurgeRow, now time.Time) (bool, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := w.q.WithTx(tx)
	p, err := lockTrashedProject(ctx, q, r.OrganizationID, r.WorkspaceID, r.ID)
	if errors.Is(err, ErrNotFound) {
		return false, nil // restored or purged by a person meanwhile
	}
	if err != nil {
		return false, err
	}
	if !trashExpired(p.TrashedAt, p.PurgeAfter, now) {
		return false, nil // trashed again since the page was read
	}
	if err := w.tasks.purgeProjectInTx(ctx, q, p, audit.System("projects.purge")); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

func trashExpired(trashedAt, purgeAfter pgtype.Timestamptz, now time.Time) bool {
	return trashedAt.Valid && purgeAfter.Valid && purgeAfter.Time.Before(now)
}
