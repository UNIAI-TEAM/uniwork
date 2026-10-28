package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TrashProject moves a live project to the trash. Its tasks stay alive and
// are unlinked for real, remembering the project in trashed_project_id, so no
// reader has to mask project_id. Resources, project views and pins stay (the
// readers hide them) until a restore shows them again or a purge deletes them.
func (s *TaskService) TrashProject(ctx context.Context, actor Actor, workspaceID, projectID string) error {
	ws, _, err := s.authorizeProjectEdit(ctx, actor, workspaceID, projectID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The UPDATE takes the project row lock first; a project trashed or
	// deleted while this ran is not found.
	p, err := q.TrashProject(ctx, db.TrashProjectParams{
		TrashedBy:  pgtype.Text{String: actor.ID, Valid: true},
		PurgeAfter: pgtype.Timestamptz{Time: time.Now().Add(trashRetention), Valid: true},
		ID:         projectID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := lockProjectTasks(ctx, q, p); err != nil {
		return err
	}
	unlinked, err := q.UnlinkTasksForProjectTrash(ctx, db.UnlinkTasksForProjectTrashParams{
		ProjectID:      pgtype.Text{String: p.ID, Valid: true},
		OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		return err
	}
	if err := recordProjectTrash(ctx, q, actor, p, audit.ActionProjectTrashed, unlinked); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RestoreProject brings a trashed project back. Only its tasks still without
// a project are relinked; one moved to another project meanwhile keeps it.
// Every task forgets the trashed project either way.
func (s *TaskService) RestoreProject(ctx context.Context, actor Actor, workspaceID, projectID string) error {
	ws, current, err := s.authorizeProjectEditIn(ctx, actor, workspaceID, projectID, true)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// A new project may have taken the title while this one sat in the trash.
	// The title lock comes before the row lock, the order UpdateProject takes
	// them in; a trashed project cannot be renamed, so the title read above
	// still holds.
	if err := s.guardDuplicateProjectTitle(ctx, q, ws, current.ID, current.Title, ""); err != nil {
		return err
	}
	p, err := lockTrashedProject(ctx, q, ws.OrganizationID, workspaceID, projectID)
	if err != nil {
		return err
	}
	if err := lockProjectTasks(ctx, q, p); err != nil {
		return err
	}
	if p, err = q.RestoreProject(ctx, db.RestoreProjectParams{
		ID: p.ID, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
	}); err != nil {
		return err
	}
	link := pgtype.Text{String: p.ID, Valid: true}
	relinked, err := q.RelinkTasksForProjectRestore(ctx, db.RelinkTasksForProjectRestoreParams{
		ProjectID: link, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		return err
	}
	if err := q.ClearTrashedProjectLinks(ctx, db.ClearTrashedProjectLinksParams{
		ProjectID: link, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
	}); err != nil {
		return err
	}
	if err := recordProjectTrash(ctx, q, actor, p, audit.ActionProjectRestored, relinked); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PurgeProject deletes a trashed project for good; its tasks stay alive.
func (s *TaskService) PurgeProject(ctx context.Context, actor Actor, workspaceID, projectID string) error {
	ws, _, err := s.authorizeProjectEditIn(ctx, actor, workspaceID, projectID, true)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	p, err := lockTrashedProject(ctx, q, ws.OrganizationID, workspaceID, projectID)
	if err != nil {
		return err
	}
	if err := s.purgeProjectInTx(ctx, q, p, actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListProjectTrash is one page of a workspace's project trash, newest first,
// 50 per page, narrowed by f. TaskCount is the live tasks a restore would
// bring back.
func (s *TaskService) ListProjectTrash(ctx context.Context, actorID, workspaceID string, f TrashFilter, cursor string) (TrashPage[ProjectTrashRow], error) {
	m, err := s.ws.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return TrashPage[ProjectTrashRow]{}, err
	}
	adminLike, reader := adminLikeRole(m.Role), Human(actorID)
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TrashPage[ProjectTrashRow]{}, err
	}
	params := db.ListProjectTrashPageParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, MaxRows: trashPageSize + 1,
	}
	params.Query, params.TrashedBy = f.args()
	if cursor != "" {
		at, id, err := decodeFeedCursor(cursor)
		if err != nil {
			return TrashPage[ProjectTrashRow]{}, err
		}
		// Both halves or neither: a half cursor would read an empty page.
		params.BeforeTrashedAt = pgtype.Timestamptz{Time: at, Valid: true}
		params.BeforeID = pgtype.Text{String: id, Valid: true}
	}
	rows, err := s.q.ListProjectTrashPage(ctx, params)
	if err != nil {
		return TrashPage[ProjectTrashRow]{}, err
	}
	var page TrashPage[ProjectTrashRow]
	if len(rows) > trashPageSize {
		rows = rows[:trashPageSize]
		last := rows[len(rows)-1]
		page.NextCursor = encodeFeedCursor(last.TrashedAt.Time, last.ID)
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	counts, err := s.q.CountProjectTrashTasks(ctx, db.CountProjectTrashTasksParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ProjectIds: ids,
	})
	if err != nil {
		return TrashPage[ProjectTrashRow]{}, err
	}
	taskCount := make(map[string]int, len(counts))
	for _, c := range counts {
		taskCount[c.ProjectID] = int(c.TaskCount)
	}
	page.Items = make([]ProjectTrashRow, 0, len(rows))
	for _, r := range rows {
		page.Items = append(page.Items, ProjectTrashRow{
			ID: r.ID, Title: r.Title, TrashedBy: r.TrashedBy.String,
			TrashedAt: r.TrashedAt.Time, PurgeAfter: r.PurgeAfter.Time,
			TaskCount: taskCount[r.ID], CanManage: canManageProject(adminLike, r, reader),
		})
	}
	return page, nil
}

// lockTrashedProject takes the project row lock and re-checks under it: a
// project restored or purged while this waited is not found. The purge worker
// locks the same row, so whoever comes second skips.
func lockTrashedProject(ctx context.Context, q *db.Queries, organizationID, workspaceID, projectID string) (db.Project, error) {
	p, err := q.LockProjectForPurge(ctx, db.LockProjectForPurgeParams{
		ID: projectID, OrganizationID: organizationID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !p.TrashedAt.Valid) {
		return db.Project{}, ErrNotFound
	}
	return p, err
}

// lockProjectTasks locks every task row a project trash, restore or purge
// rewrites, after the project row and in one id-ordered statement. Task
// restore and purge lock their rows the same way and never lock a project, so
// the two kinds of command queue instead of deadlocking.
func lockProjectTasks(ctx context.Context, q *db.Queries, p db.Project) error {
	_, err := q.LockProjectTrashTasks(ctx, db.LockProjectTrashTasksParams{
		OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID, ProjectID: p.ID,
	})
	return err
}

// recordProjectTrash writes the project's own row (project.trashed or
// project.restored) and one task.updated per task whose project_id moved, the
// shape a project delete wrote for its unlinked tasks before the trash.
func recordProjectTrash(ctx context.Context, q *db.Queries, actor Actor, p db.Project, action string, taskIDs []string) error {
	recs := append(taskUpdatedRecords(actor, p, taskIDs), audit.Recorded{
		Entry: audit.Entry{
			OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
			Actor: actor, Action: action,
			ResourceType: "project", ResourceID: p.ID,
		},
		Events: []audit.Event{{Topic: action, Payload: map[string]string{
			"project_id": p.ID, "workspace_id": p.WorkspaceID,
		}}},
	})
	return auditRecorder.RecordMany(ctx, q, recs)
}

// taskUpdatedRecords is one task.updated audit row and event per task of p
// whose project_id a project command moved.
func taskUpdatedRecords(actor Actor, p db.Project, taskIDs []string) []audit.Recorded {
	recs := make([]audit.Recorded, 0, len(taskIDs)+1)
	for _, id := range taskIDs {
		recs = append(recs, audit.Recorded{
			Entry: audit.Entry{
				OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
				Actor: actor, Action: audit.ActionTaskUpdated,
				ResourceType: "task", ResourceID: id,
			},
			Events: []audit.Event{{Topic: "task.updated", Payload: map[string]string{
				"task_id": id, "workspace_id": p.WorkspaceID,
			}}},
		})
	}
	return recs
}
