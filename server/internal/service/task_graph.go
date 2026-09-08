package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	maxParentWalkDepth         = 64
	listChildrenByParentsLimit = 200
	dependencyTypeBlocks       = "blocks"
	dependencyTypeBlockedBy    = "blocked_by"
	dependencyTypeRelated      = "related"
)

// SetDependencyInput creates one task_dependencies edge.
type SetDependencyInput struct {
	DependsOnTaskID string
	Type            string // blocks | blocked_by | related
}

// ChildProgress is done/total for one parent's children.
type ChildProgress struct {
	ParentTaskID string
	Total        int64
	Done         int64
}

// ListMyTasks returns the actor's tasks in the workspace, filtered by relation.
// Relation ""/"all" → assignee OR created_by; "assigned"/"created" narrow;
// "involved" is empty until agent involvement exists (no invented rows).
func (s *TaskService) ListMyTasks(ctx context.Context, actor Actor, workspaceID string, q TaskQuery) (TaskPage, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TaskPage{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TaskPage{}, err
	}
	if q.Limit <= 0 || q.Limit > maxTaskQueryLimit {
		q.Limit = defaultTaskQueryLimit
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	relation := normalizeMyTasksRelation(q.Relation)
	params := db.ListMyTasksParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		ActorID:        pgtype.Text{String: actor.ID, Valid: true},
		Relation:       nullText(relation),
		Status:         nullText(strings.TrimSpace(q.Status)),
		LimitN:         q.Limit,
		OffsetN:        q.Offset,
	}
	rows, err := s.q.ListMyTasks(ctx, params)
	if err != nil {
		return TaskPage{}, err
	}
	total, err := s.q.CountMyTasks(ctx, db.CountMyTasksParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		ActorID:        pgtype.Text{String: actor.ID, Valid: true},
		Relation:       nullText(relation),
		Status:         nullText(strings.TrimSpace(q.Status)),
	})
	if err != nil {
		return TaskPage{}, err
	}
	return TaskPage{Tasks: rows, Total: total, Limit: q.Limit, Offset: q.Offset}, nil
}

func normalizeMyTasksRelation(raw string) string {
	switch strings.TrimSpace(raw) {
	case "", "all":
		return "all"
	case "assigned", "created", "involved":
		return strings.TrimSpace(raw)
	default:
		return "all"
	}
}

// ListChildren returns direct children of a parent task.
func (s *TaskService) ListChildren(ctx context.Context, actor Actor, parentTaskID string) ([]db.Task, error) {
	parent, err := s.authorizeActor(ctx, actor, parentTaskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListChildTasks(ctx, db.ListChildTasksParams{
		OrganizationID: parent.OrganizationID,
		WorkspaceID:    parent.WorkspaceID,
		ParentTaskID:   pgtype.Text{String: parent.ID, Valid: true},
	})
}

// ListChildrenByParents returns children for many parents in one workspace.
// Unknown or foreign-workspace parent ids simply contribute no rows.
func (s *TaskService) ListChildrenByParents(ctx context.Context, actor Actor, workspaceID string, parentIDs []string) ([]db.Task, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	if len(parentIDs) == 0 {
		return nil, nil
	}
	if len(parentIDs) > listChildrenByParentsLimit {
		return nil, Invalid("too many parent_ids")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	cleaned := make([]string, 0, len(parentIDs))
	for _, id := range parentIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			cleaned = append(cleaned, id)
		}
	}
	if len(cleaned) == 0 {
		return nil, nil
	}
	return s.q.ListChildrenByParents(ctx, db.ListChildrenByParentsParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		ParentIds:      cleaned,
	})
}

// ChildProgress lists done/total child counts per parent in the workspace.
func (s *TaskService) ChildProgress(ctx context.Context, actor Actor, workspaceID string) ([]ChildProgress, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ChildTaskProgress(ctx, db.ChildTaskProgressParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChildProgress, 0, len(rows))
	for _, row := range rows {
		if !row.ParentTaskID.Valid {
			continue
		}
		out = append(out, ChildProgress{
			ParentTaskID: row.ParentTaskID.String,
			Total:        row.Total,
			Done:         row.Done,
		})
	}
	return out, nil
}

// SetParent attaches or clears a parent. Cycle → parent_cycle; other-workspace
// parent → cross_workspace_reference.
func (s *TaskService) SetParent(ctx context.Context, actor Actor, taskID string, parentTaskID *string) (db.Task, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Task{}, err
	}
	var parentText pgtype.Text
	if parentTaskID != nil && strings.TrimSpace(*parentTaskID) != "" {
		pid := strings.TrimSpace(*parentTaskID)
		if pid == task.ID {
			return db.Task{}, coded(http.StatusUnprocessableEntity, "parent_cycle", "công việc không thể là cha của chính nó")
		}
		parent, err := s.authorizeActor(ctx, actor, pid)
		if err != nil {
			if errors.Is(err, ErrForbidden) {
				return db.Task{}, ErrNotFound
			}
			return db.Task{}, err
		}
		if parent.WorkspaceID != task.WorkspaceID || parent.OrganizationID != task.OrganizationID {
			return db.Task{}, coded(http.StatusUnprocessableEntity, "cross_workspace_reference", "cha/con phải cùng workspace")
		}
		if err := s.detectParentCycle(ctx, task.ID, pid); err != nil {
			return db.Task{}, err
		}
		parentText = pgtype.Text{String: pid, Valid: true}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	before := taskAuditFields(task)
	before["parent_task_id"] = audit.Text(task.ParentTaskID.Valid, task.ParentTaskID.String)

	updated, err := q.SetTaskParent(ctx, db.SetTaskParentParams{
		ID:             task.ID,
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		ParentTaskID:   parentText,
	})
	if err != nil {
		return db.Task{}, err
	}
	after := taskAuditFields(updated)
	after["parent_task_id"] = audit.Text(updated.ParentTaskID.Valid, updated.ParentTaskID.String)
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskUpdated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(before, after),
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return updated, nil
}

// SetDependency inserts a dependency edge. Cycle on blocks/blocked_by → parent_cycle.
func (s *TaskService) SetDependency(ctx context.Context, actor Actor, taskID string, in SetDependencyInput) (db.TaskDependency, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.TaskDependency{}, err
	}
	depType := strings.TrimSpace(in.Type)
	if depType == "" {
		depType = dependencyTypeBlockedBy
	}
	switch depType {
	case dependencyTypeBlocks, dependencyTypeBlockedBy, dependencyTypeRelated:
	default:
		return db.TaskDependency{}, Invalid("type phụ thuộc không hợp lệ")
	}
	dependsOnID := strings.TrimSpace(in.DependsOnTaskID)
	if dependsOnID == "" || dependsOnID == task.ID {
		return db.TaskDependency{}, Invalid("depends_on_task_id không hợp lệ")
	}
	other, err := s.authorizeActor(ctx, actor, dependsOnID)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return db.TaskDependency{}, ErrNotFound
		}
		return db.TaskDependency{}, err
	}
	if other.WorkspaceID != task.WorkspaceID || other.OrganizationID != task.OrganizationID {
		return db.TaskDependency{}, coded(http.StatusUnprocessableEntity, "cross_workspace_reference", "phụ thuộc phải cùng workspace")
	}
	if depType != dependencyTypeRelated {
		if err := s.detectDependencyCycle(ctx, task.OrganizationID, task.WorkspaceID, task.ID, dependsOnID, depType); err != nil {
			return db.TaskDependency{}, err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskDependency{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	dep, err := q.CreateTaskDependency(ctx, db.CreateTaskDependencyParams{
		ID:              util.NewID(),
		OrganizationID:  task.OrganizationID,
		WorkspaceID:     task.WorkspaceID,
		TaskID:          task.ID,
		DependsOnTaskID: dependsOnID,
		Type:            depType,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskDependency{}, ErrConflict
		}
		return db.TaskDependency{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskUpdated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(nil, map[string]any{
			"dependency_added": map[string]any{
				"depends_on_task_id": dependsOnID, "type": depType,
			},
		}),
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.TaskDependency{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskDependency{}, err
	}
	return dep, nil
}

// RemoveDependency deletes a dependency edge (type optional filter).
func (s *TaskService) RemoveDependency(ctx context.Context, actor Actor, taskID, dependsOnTaskID, depType string) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	dependsOnTaskID = strings.TrimSpace(dependsOnTaskID)
	if dependsOnTaskID == "" {
		return Invalid("depends_on_task_id không hợp lệ")
	}
	var typeFilter pgtype.Text
	if t := strings.TrimSpace(depType); t != "" {
		typeFilter = pgtype.Text{String: t, Valid: true}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	n, err := q.DeleteTaskDependency(ctx, db.DeleteTaskDependencyParams{
		OrganizationID:  task.OrganizationID,
		WorkspaceID:     task.WorkspaceID,
		TaskID:          task.ID,
		DependsOnTaskID: dependsOnTaskID,
		Type:            typeFilter,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor: actor, Action: audit.ActionTaskUpdated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(map[string]any{
			"dependency_removed": map[string]any{
				"depends_on_task_id": dependsOnTaskID, "type": depType,
			},
		}, nil),
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) detectParentCycle(ctx context.Context, taskID, newParentID string) error {
	cursor := newParentID
	for depth := 0; depth < maxParentWalkDepth; depth++ {
		ancestor, err := s.q.GetTask(ctx, cursor)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if !ancestor.ParentTaskID.Valid {
			return nil
		}
		if ancestor.ParentTaskID.String == taskID {
			return coded(http.StatusUnprocessableEntity, "parent_cycle", "quan hệ cha/con tạo chu trình")
		}
		cursor = ancestor.ParentTaskID.String
	}
	return coded(http.StatusUnprocessableEntity, "parent_cycle", "quan hệ cha/con tạo chu trình")
}

// detectDependencyCycle walks the "depends-on" graph after adding the candidate edge.
// blocked_by(A,B): A depends on B → edge A→B. blocks(A,B): A blocks B → edge B→A.
func (s *TaskService) detectDependencyCycle(ctx context.Context, orgID, workspaceID, taskID, dependsOnID, depType string) error {
	edges, err := s.q.ListTaskDependenciesInWorkspace(ctx, db.ListTaskDependenciesInWorkspaceParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if err != nil {
		return err
	}
	adj := map[string][]string{}
	addEdge := func(from, to string) {
		adj[from] = append(adj[from], to)
	}
	for _, e := range edges {
		switch e.Type {
		case dependencyTypeBlockedBy:
			addEdge(e.TaskID, e.DependsOnTaskID)
		case dependencyTypeBlocks:
			addEdge(e.DependsOnTaskID, e.TaskID)
		}
	}
	switch depType {
	case dependencyTypeBlockedBy:
		addEdge(taskID, dependsOnID)
	case dependencyTypeBlocks:
		addEdge(dependsOnID, taskID)
	}

	// From the new edge's target, can we reach the source?
	var start, goal string
	switch depType {
	case dependencyTypeBlockedBy:
		start, goal = dependsOnID, taskID
	case dependencyTypeBlocks:
		start, goal = taskID, dependsOnID
	}
	seen := map[string]bool{start: true}
	queue := []string{start}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur == goal {
			return coded(http.StatusUnprocessableEntity, "parent_cycle", "phụ thuộc tạo chu trình")
		}
		for _, next := range adj[cur] {
			if seen[next] {
				continue
			}
			seen[next] = true
			queue = append(queue, next)
		}
	}
	return nil
}
