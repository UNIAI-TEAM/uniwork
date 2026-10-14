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

// McpMemberList and McpTaskList are what the list tools return: the rows,
// and whether more matched than came back.
type McpMemberList struct {
	Members   []McpMember `json:"members"`
	Truncated bool        `json:"truncated"`
}

type McpTaskList struct {
	Tasks     []McpTask `json:"tasks"`
	Truncated bool      `json:"truncated"`
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
	t, err := s.ask.tasks.GetByRefIn(ctx, Human(p.UserID), workspaceID, ref)
	return t, hidden(err)
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

type mcpListMembersIn struct {
	WorkspaceID string `json:"workspace_id"`
	Query       string `json:"query"`
}

// mcpMemberList keeps the members whose name holds query (any case), cut to
// mcpMaxList; Truncated says more matched than came back.
func mcpMemberList(all []McpMember, query string) McpMemberList {
	query = strings.ToLower(strings.TrimSpace(query))
	out := McpMemberList{Members: []McpMember{}}
	for _, m := range all {
		if query != "" && !strings.Contains(strings.ToLower(m.Name), query) {
			continue
		}
		if len(out.Members) == mcpMaxList {
			out.Truncated = true
			break
		}
		out.Members = append(out.Members, m)
	}
	return out
}

func (s *McpToolService) ListMembers(ctx context.Context, p McpPrincipal, in mcpListMembersIn) (McpMemberList, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpMemberList{}, err
	}
	rows, err := s.ws.AssignableMembers(ctx, p.UserID, in.WorkspaceID)
	if err != nil {
		return McpMemberList{}, err
	}
	all := make([]McpMember, 0, len(rows))
	for _, r := range rows {
		all = append(all, McpMember{UserID: r.UserID, Name: r.DisplayName, Role: r.Role})
	}
	return mcpMemberList(all, in.Query), nil
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

// mcpListLimit is the page size asked for: none or a bad one reads as 20,
// more than mcpMaxList as mcpMaxList.
func mcpListLimit(n int32) int32 {
	switch {
	case n <= 0:
		return 20
	case n > mcpMaxList:
		return mcpMaxList
	}
	return n
}

func (s *McpToolService) ListTasks(ctx context.Context, p McpPrincipal, in mcpListTasksIn) (McpTaskList, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpTaskList{}, err
	}
	page, err := s.ask.tasks.QueryTasks(ctx, Human(p.UserID), in.WorkspaceID, TaskQuery{Status: in.Status, ProjectID: in.ProjectID, Limit: mcpListLimit(in.Limit)})
	if err != nil {
		return McpTaskList{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpTaskList{}, err
	}
	out := McpTaskList{Tasks: make([]McpTask, 0, len(page.Tasks)), Truncated: page.Total > int64(len(page.Tasks))}
	for _, t := range page.Tasks {
		out.Tasks = append(out.Tasks, s.taskOf(base, t))
	}
	return out, nil
}

var (
	mcpSchemaWorkspace   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListMembers = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200,"description":"Optional. Part of a name, any case."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListTasks   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"status":{"type":"string","description":"A status key from task_options."},"project_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["workspace_id"],"additionalProperties":false}`)
)

func mcpTaskTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_members", "List members", "People a task in the workspace can be assigned to, with their user_id and role (org_owner and org_admin are organization admins outside the workspace). No email. At most 50, ordered by name; truncated says more matched, so pass query (part of a name) to narrow a large workspace.", mcpSchemaListMembers,
			func(ctx context.Context, p McpPrincipal, in mcpListMembersIn) (any, error) {
				return s.ListMembers(ctx, p, in)
			}),
		mcpReadTool("task_options", "Task options", "The workspace's task statuses (use the key), labels (use the id) and priorities.", mcpSchemaWorkspace,
			func(ctx context.Context, p McpPrincipal, in struct {
				WorkspaceID string `json:"workspace_id"`
			}) (any, error) {
				return s.TaskOptions(ctx, p, in.WorkspaceID)
			}),
		mcpReadTool("list_tasks", "List tasks", "Tasks in one workspace, each with its revision, ordered by status key alphabetically, then position; pass status to narrow. At most 50 (limit, default 20); truncated says more matched.", mcpSchemaListTasks,
			func(ctx context.Context, p McpPrincipal, in mcpListTasksIn) (any, error) {
				return s.ListTasks(ctx, p, in)
			}),
	}
}
