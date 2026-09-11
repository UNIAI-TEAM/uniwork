package service

import (
	"context"
	"strconv"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	defaultTaskQueryLimit = 50
	maxTaskQueryLimit     = 200
)

// TaskQuery filters and pages workspace tasks for the flagged suite.
type TaskQuery struct {
	Status    string
	ProjectID string // empty = no project filter
	Relation  string // my-tasks: all | assigned | created | involved
	Limit     int32
	Offset    int32
}

// TaskPage is one filtered window plus the total matching count.
type TaskPage struct {
	Tasks  []db.Task
	Total  int64
	Limit  int32
	Offset int32
}

// TaskGroup is one bucket of a GroupedTasks response (e.g. by status).
type TaskGroup struct {
	Key   string
	Tasks []db.Task
}

func (s *TaskService) QueryTasks(ctx context.Context, actor Actor, workspaceID string, q TaskQuery) (TaskPage, error) {
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
	params := db.QueryTasksParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		Status:         nullText(strings.TrimSpace(q.Status)),
		ProjectID:      nullText(strings.TrimSpace(q.ProjectID)),
		LimitN:         q.Limit,
		OffsetN:        q.Offset,
	}
	rows, err := s.q.QueryTasks(ctx, params)
	if err != nil {
		return TaskPage{}, err
	}
	total, err := s.q.CountTasks(ctx, db.CountTasksParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		Status:         nullText(strings.TrimSpace(q.Status)),
		ProjectID:      nullText(strings.TrimSpace(q.ProjectID)),
	})
	if err != nil {
		return TaskPage{}, err
	}
	return TaskPage{Tasks: rows, Total: total, Limit: q.Limit, Offset: q.Offset}, nil
}

// GetByRef loads a task by ULID or workspace identifier PREFIX-N.
// Prefix matching is case-insensitive (alp-1 == ALP-1).
// When PREFIX-N matches more than one membership-visible task (colliding
// prefixes across workspaces), returns ErrNotFound rather than picking one.
func (s *TaskService) GetByRef(ctx context.Context, actor Actor, ref string) (db.Task, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return db.Task{}, ErrNotFound
	}
	if prefix, number, ok := parseTaskIdentifier(ref); ok {
		rows, err := s.q.ListTasksByIdentifier(ctx, db.ListTasksByIdentifierParams{
			Prefix: prefix,
			Number: number,
		})
		if err != nil {
			return db.Task{}, err
		}
		var match *db.Task
		for i := range rows {
			task := rows[i]
			if err := s.ws.requireActorMember(ctx, task.WorkspaceID, actor); err != nil {
				continue
			}
			if match != nil {
				// Ambiguous across workspaces the caller can see — do not leak
				// which row would have been chosen.
				return db.Task{}, ErrNotFound
			}
			match = &task
		}
		if match == nil {
			return db.Task{}, ErrNotFound
		}
		return *match, nil
	}
	return s.authorizeActor(ctx, actor, ref)
}

// GroupedTasks returns tasks bucketed by status for the board grouped view.
func (s *TaskService) GroupedTasks(ctx context.Context, actor Actor, workspaceID string, q TaskQuery) ([]TaskGroup, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if q.Limit <= 0 || q.Limit > maxTaskQueryLimit {
		q.Limit = defaultTaskQueryLimit
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	rows, err := s.q.QueryTasks(ctx, db.QueryTasksParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		Status:         nullText(strings.TrimSpace(q.Status)),
		ProjectID:      nullText(strings.TrimSpace(q.ProjectID)),
		LimitN:         q.Limit,
		OffsetN:        q.Offset,
	})
	if err != nil {
		return nil, err
	}
	order := make([]string, 0)
	byKey := map[string][]db.Task{}
	for _, t := range rows {
		if _, ok := byKey[t.Status]; !ok {
			order = append(order, t.Status)
		}
		byKey[t.Status] = append(byKey[t.Status], t)
	}
	out := make([]TaskGroup, 0, len(order))
	for _, key := range order {
		out = append(out, TaskGroup{Key: key, Tasks: byKey[key]})
	}
	return out, nil
}

// parseTaskIdentifier splits PREFIX-N. The number must be decimal digits after
// the last hyphen; otherwise the ref is treated as a ULID/id.
func parseTaskIdentifier(ref string) (prefix string, number int64, ok bool) {
	i := strings.LastIndex(ref, "-")
	if i <= 0 || i == len(ref)-1 {
		return "", 0, false
	}
	numPart := ref[i+1:]
	n, err := strconv.ParseInt(numPart, 10, 64)
	if err != nil || n < 0 {
		return "", 0, false
	}
	prefix = ref[:i]
	if strings.TrimSpace(prefix) == "" {
		return "", 0, false
	}
	return prefix, n, true
}
