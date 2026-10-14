package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
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
	// Description is the stored Markdown, which only get_task sets: exact, cut
	// at mcpMaxItemRunes with DescriptionTruncated when longer, so a model
	// edits from the real text and not from the excerpt.
	Description          *string `json:"description,omitempty"`
	DescriptionTruncated bool    `json:"description_truncated,omitempty"`
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

// mcpID is an optional id argument: omitted is nil, an id is kept. A blank one
// is a mistake for the model to correct; the service would read it as
// omitted and write something the model did not mean.
func mcpID(field, v string) (*string, error) {
	if v == "" {
		return nil, nil
	}
	if strings.TrimSpace(v) == "" {
		return nil, McpInvalidArgs{Msg: field + " must not be blank; omit it instead"}
	}
	return &v, nil
}

// mcpWithLabels puts the labels read back after a create into its result. The
// task exists by then, so a failed read leaves the result as it is and says
// so instead of failing a write that committed.
func mcpWithLabels(res McpWriteResult, task McpTask, labels []McpLabel, err error) McpWriteResult {
	if err != nil {
		res.Note = "the task was created, but its labels could not be read back; call get_task to see them"
		return res
	}
	task.Labels = labels
	res.Item = task
	return res
}

// mcpReplyError names reply_to where the service says parent_id, a name the
// model never used. Every other error is left to the usual mapping.
func mcpReplyError(err error) error {
	if errors.Is(err, taskCommentAdapter{}.foreignParentError()) {
		return McpInvalidArgs{Msg: "reply_to must be a comment on this task"}
	}
	return err
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
	// update_task could never edit or undo a longer one.
	if utf8.RuneCountInString(in.Description) > mcpMaxItemRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here", mcpMaxItemRunes)}
	}
	parentRef, err := mcpID("parent_task_id", in.ParentTaskID)
	if err != nil {
		return McpWriteResult{}, err
	}
	projectID, err := mcpID("project_id", in.ProjectID)
	if err != nil {
		return McpWriteResult{}, err
	}
	assigneeID, err := mcpID("assignee_id", in.AssigneeID)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	var parent *string
	if parentRef != nil {
		pt, err := s.task(ctx, p, in.WorkspaceID, *parentRef)
		if err != nil {
			return McpWriteResult{}, err
		}
		parent = &pt.ID
	}
	t, err := s.ask.tasks.Create(ctx, Human(p.UserID), in.WorkspaceID, CreateTaskInput{
		Title: in.Title, Description: in.Description, Status: in.Status, Priority: in.Priority,
		AssigneeID: assigneeID, StartDate: optString(in.StartDate), DueDate: optString(in.DueDate),
		ProjectID: projectID, ParentTaskID: parent, LabelIDs: in.LabelIDs,
	})
	// A client that retries a create it never saw the answer to lands here.
	// The task named is an active task with this title under the same project
	// and parent of the workspace asked about, which the caller can see.
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "active_duplicate_task" {
		id, _ := ce.Fields["task_id"].(string)
		ref, _ := ce.Fields["identifier"].(string)
		return McpWriteResult{}, McpToolError{Code: ce.Code, Msg: fmt.Sprintf("an active task with this title already exists: %s (id %s, %s); read it instead of creating another", ref, id, s.frontend+base+"/tasks/"+id)}
	}
	if err != nil {
		return McpWriteResult{}, err
	}
	task := s.taskOf(base, t)
	res := McpWriteResult{Item: task, Revision: t.Revision}
	if len(in.LabelIDs) == 0 {
		return res, nil
	}
	labels, err := s.labelsOf(ctx, p, t.ID)
	return mcpWithLabels(res, task, labels, err), nil
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
	replyTo, err := mcpID("reply_to", in.ReplyTo)
	if err != nil {
		return McpWriteResult{}, err
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
	c, err := s.ask.tasks.AddCommentSuite(ctx, Human(p.UserID), t.ID, AddCommentInput{Body: in.Body, ParentID: replyTo}, "")
	if err != nil {
		return McpWriteResult{}, mcpReplyError(err)
	}
	return McpWriteResult{Item: McpComment{ID: c.ID, TaskID: t.ID, Body: capRunes(c.Body, mcpMaxHitRunes, mcpHitCut), URL: s.frontend + base + "/tasks/" + t.ID}}, nil
}

type mcpUpdateTaskIn struct {
	WorkspaceID    string         `json:"workspace_id"`
	TaskID         string         `json:"task_id"`
	Revision       *int64         `json:"revision"`
	Title          mcpOpt[string] `json:"title"`
	Description    mcpOpt[string] `json:"description"`
	Status         mcpOpt[string] `json:"status"`
	Priority       mcpOpt[string] `json:"priority"`
	AssigneeID     mcpOpt[string] `json:"assignee_id"`
	StartDate      mcpOpt[string] `json:"start_date"`
	DueDate        mcpOpt[string] `json:"due_date"`
	ProjectID      mcpOpt[string] `json:"project_id"`
	ParentTaskID   mcpOpt[string] `json:"parent_task_id"`
	AddLabelIDs    []string       `json:"add_label_ids"`
	RemoveLabelIDs []string       `json:"remove_label_ids"`
}

// check refuses what the services would misread: no revision, null for a
// field that cannot be empty, and a blank id, which they take for "clear".
func (in mcpUpdateTaskIn) check() error {
	if in.Revision == nil {
		return McpInvalidArgs{Msg: "revision is required; read the task first and send its revision"}
	}
	type field struct {
		name string
		o    mcpOpt[string]
	}
	if in.Description.Null {
		return McpInvalidArgs{Msg: `description cannot be null; send "" to clear it`}
	}
	for _, f := range []field{{"title", in.Title}, {"status", in.Status}, {"priority", in.Priority}} {
		if f.o.Null {
			return McpInvalidArgs{Msg: f.name + " cannot be null; send a value"}
		}
	}
	if err := mcpDescriptionUndoable(in.Description, ""); err != nil {
		return err
	}
	if title := strings.TrimSpace(in.Title.Value); in.Title.Set && (title == "" || utf8.RuneCountInString(title) > mcpMaxTitleRunes) {
		return McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxTitleRunes)}
	}
	if in.Priority.Set && !validPriority[in.Priority.Value] {
		return McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	for _, f := range []field{{"start_date", in.StartDate}, {"due_date", in.DueDate}} {
		if f.o.Set && !f.o.Null {
			if err := mcpDate(f.name, f.o.Value); err != nil {
				return err
			}
		}
	}
	for _, f := range []field{{"assignee_id", in.AssigneeID}, {"project_id", in.ProjectID}, {"parent_task_id", in.ParentTaskID}} {
		if f.o.Set && !f.o.Null && strings.TrimSpace(f.o.Value) == "" {
			return McpInvalidArgs{Msg: f.name + " must not be blank; send null to clear it"}
		}
	}
	if len(in.AddLabelIDs) > mcpMaxLabels || len(in.RemoveLabelIDs) > mcpMaxLabels {
		return McpInvalidArgs{Msg: fmt.Sprintf("add_label_ids and remove_label_ids hold at most %d labels each", mcpMaxLabels)}
	}
	for _, id := range in.AddLabelIDs {
		if slices.Contains(in.RemoveLabelIDs, id) {
			return McpInvalidArgs{Msg: "a label cannot be in both add_label_ids and remove_label_ids"}
		}
	}
	return nil
}

// mcpPick keeps each id once and refuses one outside known. The message names
// the field, never the id, so a label of another workspace reads as a missing one.
func mcpPick(field string, ids []string, known map[string]bool, why string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, id := range ids {
		if !known[id] {
			return nil, McpInvalidArgs{Msg: field + " holds a label that " + why}
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out, nil
}

// mcpNullable is an optional field as a change shows it: null when unset, the
// value a model sends back to undo.
func mcpNullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// mcpStepError is a step that failed after the update was saved, as the note
// names it: what the transport would show for it, never the service's text.
func mcpStepError(err error) string {
	err = mcpMapError(err)
	var te McpToolError
	var bad McpInvalidArgs
	switch {
	case errors.As(err, &te), errors.As(err, &bad):
		return err.Error()
	case errors.Is(err, ErrNotFound):
		return "not found or not accessible"
	}
	return "temporarily unavailable"
}

// newParent resolves parent_task_id: nil leaves the parent as it is, a pointer
// to nil clears it. A parent that would make a cycle is refused here, before
// anything is written.
func (s *McpToolService) newParent(ctx context.Context, p McpPrincipal, workspaceID string, o mcpOpt[string], task db.Task) (**string, error) {
	switch {
	case !o.Set:
		return nil, nil
	case o.Null:
		if !task.ParentTaskID.Valid {
			return nil, nil
		}
		return o.ptr2(), nil
	}
	parent, err := s.task(ctx, p, workspaceID, o.Value)
	if err != nil {
		return nil, err
	}
	if parent.ID == task.ID {
		return nil, McpToolError{Code: "parent_cycle", Msg: mcpToolMessages["parent_cycle"]}
	}
	if parent.ID == task.ParentTaskID.String {
		return nil, nil
	}
	if err := s.ask.tasks.detectParentCycle(ctx, task.ID, parent.ID); err != nil {
		return nil, err
	}
	id := &parent.ID
	return &id, nil
}

// UpdateTask changes one task. Every reference is checked before anything is
// written; the field update carries the revision and runs first, then parent
// and labels, each its own command. A later step that fails is named in Note
// beside what was already saved.
func (s *McpToolService) UpdateTask(ctx context.Context, p McpPrincipal, in mcpUpdateTaskIn) (McpWriteResult, error) {
	if err := in.check(); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.task(ctx, p, in.WorkspaceID, in.TaskID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Refused here, the from values of the result are the task the model read.
	if err := CheckTaskRevision(*in.Revision, before.Revision); err != nil {
		return McpWriteResult{}, err
	}
	// Undo sends from back, and get_task shows no more than this: a longer
	// description replaced here could not be restored.
	if err := mcpDescriptionUndoable(in.Description, before.Description); err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	parent, err := s.newParent(ctx, p, in.WorkspaceID, in.ParentTaskID, before)
	if err != nil {
		return McpWriteResult{}, err
	}
	labelsBefore, err := s.labelsOf(ctx, p, before.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	open, on := map[string]bool{}, map[string]bool{}
	if len(in.AddLabelIDs) > 0 {
		all, err := s.ask.tasks.ListTaskLabels(ctx, Human(p.UserID), in.WorkspaceID, false)
		if err != nil {
			return McpWriteResult{}, err
		}
		for _, l := range all {
			open[l.ID] = true
		}
	}
	for _, l := range labelsBefore {
		on[l.ID] = true
	}
	add, err := mcpPick("add_label_ids", in.AddLabelIDs, open, "is not a label of this workspace; call task_options for them")
	if err != nil {
		return McpWriteResult{}, err
	}
	remove, err := mcpPick("remove_label_ids", in.RemoveLabelIDs, on, "is not on this task")
	if err != nil {
		return McpWriteResult{}, err
	}
	actor := Human(p.UserID)
	// written is the task as this call left it: the row Update returned, and
	// the parent SetParent set. changes reads it, so an edit by someone else
	// before the read-back is never reported as this call's.
	written, err := s.ask.tasks.Update(ctx, actor, before.ID, UpdateTaskInput{
		ExpectedRevision: in.Revision,
		Title:            in.Title.ptr(), Description: in.Description.ptr(), Status: in.Status.ptr(), Priority: in.Priority.ptr(),
		AssigneeID: in.AssigneeID.ptr2(), StartDate: in.StartDate.ptr2(), DueDate: in.DueDate.ptr2(), ProjectID: in.ProjectID.ptr2(),
	})
	if err != nil {
		return McpWriteResult{}, err
	}
	// The update is saved. From here a failure is named in the note, never
	// returned: a model that read "failed" would apply the rest twice.
	var failed []string
	if parent != nil {
		if t, err := s.ask.tasks.SetParent(ctx, actor, before.ID, *parent); err != nil {
			failed = append(failed, "parent_task_id ("+mcpStepError(err)+")")
		} else {
			written.ParentTaskID = t.ParentTaskID
		}
	}
	for _, id := range add {
		if err := s.ask.tasks.AttachTaskLabel(ctx, actor, before.ID, id); err != nil {
			failed = append(failed, "add label "+id+" ("+mcpStepError(err)+")")
		}
	}
	for _, id := range remove {
		if err := s.ask.tasks.DetachTaskLabel(ctx, actor, before.ID, id); err != nil {
			failed = append(failed, "remove label "+id+" ("+mcpStepError(err)+")")
		}
	}
	after, err := s.ask.tasks.Get(ctx, p.UserID, before.ID)
	var labelsAfter []McpLabel
	if err == nil {
		labelsAfter, err = s.labelsOf(ctx, p, before.ID)
	}
	if err != nil {
		note := "the update was saved, but the task could not be read back; call get_task for what it holds now and its revision"
		if len(failed) > 0 {
			note += "; these did not go through: " + strings.Join(failed, "; ")
		}
		return McpWriteResult{Note: note}, nil
	}
	b, w, a := s.taskOf(base, before), s.taskOf(base, written), s.taskOf(base, after)
	a.Labels = labelsAfter
	changes := mcpChanges(McpChange{"title", before.Title, written.Title})
	if before.Description != written.Description {
		// Uncut, unlike the rest: both sides are at most mcpMaxItemRunes, and
		// from is how the model puts the old text back.
		changes = append(changes, McpChange{"description", before.Description, written.Description})
	}
	changes = append(changes, mcpChanges(
		McpChange{"status", before.Status, written.Status},
		McpChange{"priority", before.Priority, written.Priority},
		McpChange{"assignee_id", mcpNullable(b.AssigneeID), mcpNullable(w.AssigneeID)},
		McpChange{"start_date", mcpNullable(b.StartDate), mcpNullable(w.StartDate)},
		McpChange{"due_date", mcpNullable(b.DueDate), mcpNullable(w.DueDate)},
		McpChange{"project_id", mcpNullable(b.ProjectID), mcpNullable(w.ProjectID)},
		McpChange{"parent_task_id", mcpNullable(b.ParentTaskID), mcpNullable(w.ParentTaskID)},
		McpChange{"labels", labelsBefore, labelsAfter},
	)...)
	res := McpWriteResult{Item: a, Revision: after.Revision, Changes: changes}
	if len(failed) > 0 {
		res.Note = "the fields in changes were saved; these did not go through: " + strings.Join(failed, "; ")
	}
	return res, nil
}

var (
	mcpSchemaWorkspace   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListMembers = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200,"description":"Optional. Part of a name, any case."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListTasks   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"status":{"type":"string","description":"A status key from task_options."},"project_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaCreateTask  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":500},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `,"description":"Markdown."},"status":{"type":"string","description":"A status key from task_options. Omit for the default open status."},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"assignee_id":{"type":"string","description":"A user_id from list_members."},"start_date":{"type":"string","description":"YYYY-MM-DD"},"due_date":{"type":"string","description":"YYYY-MM-DD"},"project_id":{"type":"string"},"parent_task_id":{"type":"string","description":"Id or PREFIX-N of the parent task."},"label_ids":{"type":"array","items":{"type":"string"},"maxItems":20}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaUpdateTask  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"task_id":{"type":"string","description":"Id or PREFIX-N."},"revision":{"type":"integer","description":"The revision you read with get_task or list_tasks."},"title":{"type":"string","minLength":1,"maxLength":500},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `,"description":"Markdown; replaces the whole description. Edit from the description get_task returns."},"status":{"type":"string","description":"A status key from task_options."},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"assignee_id":{"type":["string","null"],"description":"A user_id from list_members; null unassigns."},"start_date":{"type":["string","null"],"description":"YYYY-MM-DD; null clears it."},"due_date":{"type":["string","null"],"description":"YYYY-MM-DD; null clears it."},"project_id":{"type":["string","null"],"description":"null takes the task out of its project."},"parent_task_id":{"type":["string","null"],"description":"Id or PREFIX-N of the parent task; null clears it."},"add_label_ids":{"type":"array","items":{"type":"string"},"maxItems":20,"description":"Label ids from task_options."},"remove_label_ids":{"type":"array","items":{"type":"string"},"maxItems":20,"description":"Ids of labels on the task."}},"required":["workspace_id","task_id","revision"],"additionalProperties":false}`)
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
		mcpWriteTool("create_task", "Create task", "Creates a task in the workspace as the user. Everyone in the workspace sees it; the assignee finds it in their work.", "change its status, or delete it in UniWork", false, mcpSchemaCreateTask,
			func(ctx context.Context, p McpPrincipal, in mcpCreateTaskIn) (any, error) {
				return s.CreateTask(ctx, p, in)
			}),
		mcpWriteTool("update_task", "Update task", "Changes one task as the user: omitted fields stay as they are, null clears one. revision must be the one you read; if the task changed since, nothing is written and the call fails with revision_conflict. Everyone in the workspace sees the change; a new assignee is notified, and a status change notifies the task's assignee and creator. A description longer than "+strconv.Itoa(mcpMaxItemRunes)+" characters is too long to replace here; edit it in UniWork.", "call update_task again with the from values in changes; put labels back with add_label_ids and remove_label_ids, using the label ids in changes", true, mcpSchemaUpdateTask,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateTaskIn) (any, error) {
				return s.UpdateTask(ctx, p, in)
			}),
		mcpWriteTool("add_comment", "Add comment", "Adds a comment to a task as the user. Everyone who can see the task sees it. The task's assignee, its creator, earlier commenters and anyone named in the body as @Display Name are notified.", "the user deletes the comment in UniWork", false, mcpSchemaAddComment,
			func(ctx context.Context, p McpPrincipal, in mcpAddCommentIn) (any, error) {
				return s.AddComment(ctx, p, in)
			}),
	}
}
