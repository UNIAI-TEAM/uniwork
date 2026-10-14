package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The task tools of the MCP connector (spec 2026-10-14 §5.1). Each reaches
// TaskService as the person who consented; nothing here decides membership.

type McpLabel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type McpStatus struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

type McpMember struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
}

type McpTaskOptions struct {
	Statuses   []McpStatus `json:"statuses"`
	Labels     []McpLabel  `json:"labels"`
	Priorities []string    `json:"priorities"`
}

// McpTask is a task as a tool shows it: the item, plus what a model needs
// to change it (revision) and to name its fields.
type McpTask struct {
	McpItem
	Revision     int64      `json:"revision"`
	Priority     string     `json:"priority,omitempty"`
	AssigneeID   string     `json:"assignee_id,omitempty"`
	ProjectID    string     `json:"project_id,omitempty"`
	ParentTaskID string     `json:"parent_task_id,omitempty"`
	StartDate    string     `json:"start_date,omitempty"`
	Labels       []McpLabel `json:"labels,omitempty"`
}

// mcpPriorities is the order a person reads them in; TestMcpTaskOptions...
// holds it to the service's own set.
var mcpPriorities = []string{"none", "low", "medium", "high", "urgent"}

const mcpMaxList = 50

// task resolves a task id or PREFIX-N reference inside the workspace; a
// task of another workspace reads as absent.
func (s *McpToolService) task(ctx context.Context, p McpPrincipal, workspaceID, ref string) (db.Task, error) {
	if strings.TrimSpace(ref) == "" {
		return db.Task{}, McpInvalidArgs{Msg: "task_id is required"}
	}
	t, err := s.ask.tasks.GetByRef(ctx, Human(p.UserID), ref)
	if err != nil {
		return db.Task{}, hidden(err)
	}
	if t.WorkspaceID != workspaceID {
		return db.Task{}, ErrNotFound
	}
	return t, nil
}

func (s *McpToolService) taskOf(base string, t db.Task) McpTask {
	out := McpTask{
		McpItem:  McpItem{Kind: "task", ID: t.ID, WorkspaceID: t.WorkspaceID, Title: t.Title, Status: t.Status, URL: s.frontend + base + "/tasks/" + t.ID, Excerpt: capRunes(t.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: t.Revision, Priority: t.Priority, AssigneeID: t.AssigneeID.String, ProjectID: t.ProjectID.String, ParentTaskID: t.ParentTaskID.String,
	}
	if t.DueDate.Valid {
		out.DueDate = t.DueDate.Time.Format("2006-01-02")
	}
	if t.StartDate.Valid {
		out.StartDate = t.StartDate.Time.Format("2006-01-02")
	}
	return out
}

func (s *McpToolService) labelsOf(ctx context.Context, p McpPrincipal, taskID string) ([]McpLabel, error) {
	rows, err := s.ask.tasks.ListTaskLabelsOnTask(ctx, Human(p.UserID), taskID)
	if err != nil {
		return nil, err
	}
	out := make([]McpLabel, 0, len(rows))
	for _, l := range rows {
		out = append(out, McpLabel{ID: l.ID, Name: l.Name})
	}
	return out, nil
}

func (s *McpToolService) ListMembers(ctx context.Context, p McpPrincipal, workspaceID string) ([]McpMember, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.ws.AssignableMembers(ctx, p.UserID, workspaceID, p.OrganizationID)
	if err != nil {
		return nil, err
	}
	out := make([]McpMember, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpMember{UserID: r.UserID, Name: r.DisplayName, Role: r.Role})
	}
	return out, nil
}

func (s *McpToolService) TaskOptions(ctx context.Context, p McpPrincipal, workspaceID string) (McpTaskOptions, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return McpTaskOptions{}, err
	}
	statuses, err := s.ask.tasks.ListTaskStatuses(ctx, Human(p.UserID), workspaceID, false)
	if err != nil {
		return McpTaskOptions{}, err
	}
	labels, err := s.ask.tasks.ListTaskLabels(ctx, Human(p.UserID), workspaceID, false)
	if err != nil {
		return McpTaskOptions{}, err
	}
	out := McpTaskOptions{Statuses: []McpStatus{}, Labels: []McpLabel{}, Priorities: mcpPriorities}
	for _, st := range statuses {
		out.Statuses = append(out.Statuses, McpStatus{Key: st.Key, Name: st.Name, Category: st.Category})
	}
	for _, l := range labels {
		out.Labels = append(out.Labels, McpLabel{ID: l.ID, Name: l.Name})
	}
	return out, nil
}

type mcpListTasksIn struct {
	WorkspaceID string `json:"workspace_id"`
	Status      string `json:"status"`
	ProjectID   string `json:"project_id"`
	Limit       int32  `json:"limit"`
}

func (s *McpToolService) ListTasks(ctx context.Context, p McpPrincipal, in mcpListTasksIn) ([]McpTask, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return nil, err
	}
	if in.Limit <= 0 || in.Limit > mcpMaxList {
		in.Limit = 20
	}
	page, err := s.ask.tasks.QueryTasks(ctx, Human(p.UserID), in.WorkspaceID, TaskQuery{Status: in.Status, ProjectID: in.ProjectID, Limit: in.Limit})
	if err != nil {
		return nil, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]McpTask, 0, len(page.Tasks))
	for _, t := range page.Tasks {
		out = append(out, s.taskOf(base, t))
	}
	return out, nil
}

var (
	mcpSchemaWorkspace = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListTasks = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"status":{"type":"string","description":"A status key from task_options."},"project_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["workspace_id"],"additionalProperties":false}`)
)

func mcpTaskTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_members", "List members", "People a task in the workspace can be assigned to, with their user_id and role. No email.", mcpSchemaWorkspace,
			func(ctx context.Context, p McpPrincipal, in struct {
				WorkspaceID string `json:"workspace_id"`
			}) (any, error) {
				return s.ListMembers(ctx, p, in.WorkspaceID)
			}),
		mcpReadTool("task_options", "Task options", "The workspace's task statuses (use the key), labels (use the id) and priorities.", mcpSchemaWorkspace,
			func(ctx context.Context, p McpPrincipal, in struct {
				WorkspaceID string `json:"workspace_id"`
			}) (any, error) {
				return s.TaskOptions(ctx, p, in.WorkspaceID)
			}),
		mcpReadTool("list_tasks", "List tasks", "Tasks in one workspace, optionally by status key or project, in board order (by status, then position), each with its revision.", mcpSchemaListTasks,
			func(ctx context.Context, p McpPrincipal, in mcpListTasksIn) (any, error) {
				return s.ListTasks(ctx, p, in)
			}),
	}
}
