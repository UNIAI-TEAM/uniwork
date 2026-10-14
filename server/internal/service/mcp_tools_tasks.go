package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

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

const (
	// mcpMaxBodyRunes is the longest comment body a tool accepts;
	// mcpMaxTitleRunes the longest task title, mcpMaxLabels the most labels
	// on a new task. The input schemas promise the same.
	mcpMaxBodyRunes  = 20000
	mcpMaxTitleRunes = 500
	mcpMaxLabels     = 20
)

// task resolves a task id or PREFIX-N reference inside the workspace. It first
// checks that the workspace belongs to the grant's organization, so no tool
// that reaches a task can forget to; a task of another workspace reads as
// absent.
func (s *McpToolService) task(ctx context.Context, p McpPrincipal, workspaceID, ref string) (db.Task, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return db.Task{}, err
	}
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

// mcpDate checks a YYYY-MM-DD field before the service sees it.
func mcpDate(field, v string) error {
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return McpInvalidArgs{Msg: field + " must be a date YYYY-MM-DD"}
	}
	return nil
}

// McpComment is a comment as a write tool shows it. It has no revision.
type McpComment struct {
	ID     string `json:"id"`
	TaskID string `json:"task_id"`
	Body   string `json:"body"`
	URL    string `json:"url"`
}

type mcpCreateTaskIn struct {
	WorkspaceID  string   `json:"workspace_id"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Status       string   `json:"status"`
	Priority     string   `json:"priority"`
	AssigneeID   string   `json:"assignee_id"`
	StartDate    string   `json:"start_date"`
	DueDate      string   `json:"due_date"`
	ProjectID    string   `json:"project_id"`
	ParentTaskID string   `json:"parent_task_id"`
	LabelIDs     []string `json:"label_ids"`
}

// optString is nil for an omitted field, so the service leaves it unset.
func optString(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func (s *McpToolService) CreateTask(ctx context.Context, p McpPrincipal, in mcpCreateTaskIn) (McpWriteResult, error) {
	if title := strings.TrimSpace(in.Title); title == "" || utf8.RuneCountInString(title) > mcpMaxTitleRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxTitleRunes)}
	}
	for _, d := range []struct{ field, value string }{{"start_date", in.StartDate}, {"due_date", in.DueDate}} {
		if d.value == "" {
			continue
		}
		if err := mcpDate(d.field, d.value); err != nil {
			return McpWriteResult{}, err
		}
	}
	if in.Priority != "" && !validPriority[in.Priority] {
		return McpWriteResult{}, McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	if len(in.LabelIDs) > mcpMaxLabels {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("label_ids holds at most %d labels", mcpMaxLabels)}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	var parent *string
	if strings.TrimSpace(in.ParentTaskID) != "" {
		pt, err := s.task(ctx, p, in.WorkspaceID, in.ParentTaskID)
		if err != nil {
			return McpWriteResult{}, err
		}
		parent = &pt.ID
	}
	t, err := s.ask.tasks.Create(ctx, Human(p.UserID), in.WorkspaceID, CreateTaskInput{
		Title: in.Title, Description: in.Description, Status: in.Status, Priority: in.Priority,
		AssigneeID: optString(in.AssigneeID), StartDate: optString(in.StartDate), DueDate: optString(in.DueDate),
		ProjectID: optString(in.ProjectID), ParentTaskID: parent, LabelIDs: in.LabelIDs,
	})
	// A client that retries a create it never saw the answer to lands here.
	// The task named is the caller's own, in the workspace they asked about.
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "active_duplicate_task" {
		id, _ := ce.Fields["task_id"].(string)
		ref, _ := ce.Fields["identifier"].(string)
		return McpWriteResult{}, McpToolError{Code: ce.Code, Msg: fmt.Sprintf("an active task with this title already exists: %s (id %s, %s); read it instead of creating another", ref, id, s.frontend+base+"/tasks/"+id)}
	}
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.taskOf(base, t), Revision: t.Revision}, nil
}

type mcpAddCommentIn struct {
	WorkspaceID string `json:"workspace_id"`
	TaskID      string `json:"task_id"`
	Body        string `json:"body"`
	ReplyTo     string `json:"reply_to"`
}

func (s *McpToolService) AddComment(ctx context.Context, p McpPrincipal, in mcpAddCommentIn) (McpWriteResult, error) {
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > mcpMaxBodyRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("body must be 1-%d characters", mcpMaxBodyRunes)}
	}
	t, err := s.task(ctx, p, in.WorkspaceID, in.TaskID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Read before the write: a failure after the comment exists would tell the
	// model it failed, and a retry would post it twice.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	c, err := s.ask.tasks.AddCommentSuite(ctx, Human(p.UserID), t.ID, AddCommentInput{Body: in.Body, ParentID: optString(in.ReplyTo)}, "")
	var invalid ValidationError
	if in.ReplyTo != "" && errors.As(err, &invalid) {
		// The service calls it parent_id, a name the model never used.
		return McpWriteResult{}, McpInvalidArgs{Msg: "reply_to must be a comment on this task"}
	}
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: McpComment{ID: c.ID, TaskID: t.ID, Body: capRunes(c.Body, mcpMaxHitRunes, mcpHitCut), URL: s.frontend + base + "/tasks/" + t.ID}}, nil
}

var (
	mcpSchemaWorkspace   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListMembers = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200,"description":"Optional. Part of a name, any case."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListTasks   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"status":{"type":"string","description":"A status key from task_options."},"project_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaCreateTask  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":500},"description":{"type":"string","description":"Markdown."},"status":{"type":"string","description":"A status key from task_options. Omit for the default open status."},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"assignee_id":{"type":"string","description":"A user_id from list_members."},"start_date":{"type":"string","description":"YYYY-MM-DD"},"due_date":{"type":"string","description":"YYYY-MM-DD"},"project_id":{"type":"string"},"parent_task_id":{"type":"string","description":"Id or PREFIX-N of the parent task."},"label_ids":{"type":"array","items":{"type":"string"},"maxItems":20}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaAddComment  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"task_id":{"type":"string","description":"Id or PREFIX-N."},"body":{"type":"string","minLength":1,"maxLength":20000,"description":"Markdown."},"reply_to":{"type":"string","description":"Id of the comment this answers."}},"required":["workspace_id","task_id","body"],"additionalProperties":false}`)
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
		mcpWriteTool("create_task", "Create task", "Creates a task in the workspace as the user. Everyone in the workspace sees it; the assignee is notified.", "change its status, or delete it in UniWork", false, mcpSchemaCreateTask,
			func(ctx context.Context, p McpPrincipal, in mcpCreateTaskIn) (any, error) {
				return s.CreateTask(ctx, p, in)
			}),
		// add_comment moves behind update_task when that tool lands.
		mcpWriteTool("add_comment", "Add comment", "Adds a comment to a task as the user. Everyone who can see the task sees it; subscribers are notified.", "the user deletes the comment in UniWork", false, mcpSchemaAddComment,
			func(ctx context.Context, p McpPrincipal, in mcpAddCommentIn) (any, error) {
				return s.AddComment(ctx, p, in)
			}),
	}
}
