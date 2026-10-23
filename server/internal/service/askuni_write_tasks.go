package service

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's task write tools (spec P3, R4): prepare reads and rates, apply runs
// the MCP connector's own write method as the asker, and each leaves the
// inverse that puts things back.

// askNoUndoNote is what a row says when its write committed but the inverse
// could not be built: apply never fails after a write (the row would read as
// failed while the change stands), so the loss of the undo is told here.
const askNoUndoNote = "saved, but it cannot be undone from here"

// askInverseOrNote builds the inverse of a write that committed. When it cannot
// it returns none and says so in out.Note.
func askInverseOrNote(out *AskProposalResult, op string, args map[string]any) *askInverse {
	inv, err := askInverseOf(op, args)
	if err != nil {
		askLoseUndo(out)
		return nil
	}
	return inv
}

func askLoseUndo(out *AskProposalResult) {
	if out.Note != "" {
		out.Note += "; "
	}
	out.Note += askNoUndoNote
}

var errAskUndoUnavailable = CodedError{Code: "undo_unavailable", Status: 409, Msg: "the object changed after this was applied"}

// askUndoGuard reads a refusal of the guard (the object is gone or someone
// changed it, or a project handed away its editor right) as undo_unavailable;
// any other error is a fault.
func askUndoGuard(err error) error {
	var ce CodedError
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrForbidden), errors.As(err, &ce) && (ce.Code == "revision_conflict" || ce.Code == "not_project_editor"):
		return errAskUndoUnavailable
	}
	return err
}

func init() {
	// shortcut: the revision is read, then the delete runs; a write between the
	// two slips through. Upgrade when TaskService.Delete takes a revision.
	askInverses["delete_task"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			TaskID   string `json:"task_id"`
			Revision int64  `json:"revision"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		t, err := s.tasks.Get(ctx, p.UserID, a.TaskID)
		if err != nil {
			return askUndoGuard(err)
		}
		if t.Revision != a.Revision {
			return errAskUndoUnavailable
		}
		return askUndoGuard(s.tasks.Delete(ctx, p.UserID, a.TaskID))
	}
	askInverses["update_task"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		if s.reads == nil {
			return errAskReadsNotWired
		}
		var in mcpUpdateTaskIn
		if err := decodeInto(args, &in); err != nil {
			return err
		}
		_, err := s.reads.UpdateTask(ctx, p, in)
		return askUndoGuard(err)
	}
	askInverses["delete_task_comment"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			CommentID string `json:"comment_id"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		return askUndoGuard(s.tasks.DeleteComment(ctx, Human(p.UserID), a.CommentID))
	}
}

func (s *AskUNIService) askTaskTools() []askWriteTool {
	tool := func(name, desc, undo string, risk ai.RiskLevel, destructive bool, schema json.RawMessage) ai.Tool {
		return ai.Tool{Name: name, Description: desc, Kind: ai.ToolWrite, Risk: risk, Destructive: destructive, Undo: undo, Schema: askToolSchema(schema, 10)}
	}
	return []askWriteTool{
		{
			Tool:    tool("create_task", "Proposes a new task in this workspace; everyone in the workspace sees it and the assignee finds it in their work.", "the asker deletes the task", ai.RiskLow, false, mcpSchemaCreateTask),
			prepare: s.prepareCreateTask, apply: s.applyCreateTask, inverse: "delete_task",
		},
		{
			Tool:    tool("update_task", "Proposes changes to one task: omitted fields stay, null clears one. Everyone in the workspace sees the change; a new assignee, and the assignee and creator on a status change, are notified.", "the asker puts the old values back", ai.RiskLow, true, mcpSchemaUpdateTask),
			prepare: s.prepareUpdateTask, apply: s.applyUpdateTask, inverse: "update_task",
		},
		{
			Tool:    tool("add_comment", "Proposes a comment on a task, posted as the asker. Everyone who can see the task sees it; the assignee, the creator, earlier commenters and anyone @mentioned are notified.", "the asker deletes the comment", ai.RiskMedium, false, mcpSchemaAddComment),
			prepare: s.prepareAddComment, apply: s.applyAddComment, inverse: "delete_task_comment",
		},
	}
}

// askStoredArgs is what a row keeps of the model's call: the arguments as sent,
// plus the workspace the server binds and without a revision, which the server
// reads (R6).
func askStoredArgs(args json.RawMessage, workspaceID string) (json.RawMessage, error) {
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(args, &m); err != nil {
		return nil, McpInvalidArgs{Msg: "arguments must be a JSON object"}
	}
	delete(m, "revision")
	ws, _ := json.Marshal(workspaceID)
	m["workspace_id"] = ws
	return json.Marshal(m)
}

// askNames turns ids into the names a card shows, reading each catalogue once.
type askNames struct {
	s        *AskUNIService
	ctx      context.Context
	tc       ai.ToolContext
	earlier  []askDraftRow
	members  map[string]string
	statuses map[string]string
	projects map[string]string
	labels   map[string]string
}

func (s *AskUNIService) names(ctx context.Context, tc ai.ToolContext, earlier []askDraftRow) *askNames {
	return &askNames{s: s, ctx: ctx, tc: tc, earlier: earlier, members: s.memberNames(ctx, tc), statuses: s.taskStatusLabels(ctx, tc)}
}

func orID(name, id string) string {
	if name == "" {
		return id
	}
	return name
}

// ref is what a field holding {{row:N.id}} shows: the title of that row's object.
func (n *askNames) ref(v string) (string, bool) {
	i, ok := askRowRef(v)
	if !ok || i < 1 || i > len(n.earlier) {
		return "", false
	}
	return n.earlier[i-1].Preview.Target.Title, true
}

func (n *askNames) person(id string) any {
	if id == "" {
		return nil
	}
	return orID(n.members[id], id)
}

func (n *askNames) status(key string) string { return statusLabel(n.statuses, key) }

func (n *askNames) project(id string) any {
	if id == "" {
		return nil
	}
	if t, ok := n.ref(id); ok {
		return t
	}
	if n.projects == nil {
		n.projects = map[string]string{}
		if rows, err := n.s.tasks.ListProjects(n.ctx, Human(n.tc.ActorID), n.tc.WorkspaceID, ListProjectsFilter{}); err == nil {
			for _, r := range rows {
				n.projects[r.ID] = r.Title
			}
		}
	}
	return orID(n.projects[id], id)
}

func (n *askNames) task(id string) any {
	if id == "" {
		return nil
	}
	if t, ok := n.ref(id); ok {
		return t
	}
	if t, err := n.s.reads.GetTask(n.ctx, principalOf(n.tc), n.tc.WorkspaceID, id); err == nil {
		return t.Title
	}
	return id
}

func (n *askNames) labelNames(ids []string) []string {
	if n.labels == nil {
		n.labels = map[string]string{}
		if o, err := n.s.reads.TaskOptions(n.ctx, principalOf(n.tc), n.tc.WorkspaceID); err == nil {
			for _, l := range o.Labels {
				n.labels[l.ID] = l.Name
			}
		}
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, orID(n.labels[id], id))
	}
	return out
}

// notified is who a change tells, by name, without the asker and without repeats.
func (n *askNames) notified(ids ...string) []AskContextRef {
	out := []AskContextRef{}
	seen := map[string]bool{n.tc.ActorID: true, "": true}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, AskContextRef{Kind: "member", ID: id, Title: orID(n.members[id], id)})
		}
	}
	return out
}

func (n *askNames) statusOptions() []string {
	return slices.Sorted(maps.Values(n.statuses))
}

// optValue is the value of a mcpOpt for a card: nil when cleared.
func optValue(o mcpOpt[string]) string {
	if o.Null {
		return ""
	}
	return o.Value
}

func (s *AskUNIService) prepareCreateTask(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpCreateTaskIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if err := in.check(); err != nil {
		return askDraftRow{}, err
	}
	for field, v := range map[string]string{"parent_task_id": in.ParentTaskID, "project_id": in.ProjectID, "assignee_id": in.AssigneeID} {
		if _, err := mcpID(field, v); err != nil {
			return askDraftRow{}, err
		}
	}
	refs, _, err := askRowRefs(earlier, map[string]string{"parent_task_id": "create_task", "project_id": "create_project"},
		map[string]string{"parent_task_id": in.ParentTaskID, "project_id": in.ProjectID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	fields := []AskProposalField{{Field: "title", Type: "text", To: in.Title}}
	add := func(field, typ string, to any, options []string) {
		fields = append(fields, AskProposalField{Field: field, Type: typ, To: to, Options: options})
	}
	if in.Description != "" {
		add("description", "markdown", in.Description, nil)
	}
	if in.Status != "" {
		add("status", "enum", n.status(in.Status), n.statusOptions())
	}
	if in.Priority != "" {
		add("priority", "enum", in.Priority, mcpPriorities)
	}
	if in.AssigneeID != "" {
		add("assignee_id", "person", n.person(in.AssigneeID), nil)
	}
	if in.StartDate != "" {
		add("start_date", "date", in.StartDate, nil)
	}
	if in.DueDate != "" {
		add("due_date", "date", in.DueDate, nil)
	}
	if in.ProjectID != "" {
		add("project_id", "project", n.project(in.ProjectID), nil)
	}
	if in.ParentTaskID != "" {
		add("parent_task_id", "text", n.task(in.ParentTaskID), nil)
	}
	if len(in.LabelIDs) > 0 {
		add("labels", "labels", n.labelNames(in.LabelIDs), nil)
	}
	level := askLevel1
	if len(refs) > 0 || (in.AssigneeID != "" && in.AssigneeID != tc.ActorID) || in.ProjectID != "" || in.ParentTaskID != "" {
		level = askLevel2
	}
	return askDraftRow{
		Tool: "create_task", Args: stored, TargetKind: "task", Level: level,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "task", Title: in.Title}, Fields: fields, Refs: refs,
			Audience: AskAudience{Visibility: "workspace", Notifies: n.notified(in.AssigneeID)},
		},
	}, nil
}

// askTarget reads the task a call names: the task, who it notifies, or, when
// the id is {{row:N.id}}, the earlier row that will create it.
type askTarget struct {
	task              McpTask
	assignee, creator string
	refTitle          string
	isRef             bool
}

func (s *AskUNIService) readTaskTarget(ctx context.Context, tc ai.ToolContext, ref string, n *askNames) (askTarget, error) {
	if title, ok := n.ref(ref); ok {
		return askTarget{refTitle: title, isRef: true}, nil
	}
	t, err := s.reads.GetTask(ctx, principalOf(tc), tc.WorkspaceID, ref)
	if err != nil {
		return askTarget{}, err
	}
	row, err := s.tasks.Get(ctx, tc.ActorID, t.ID)
	if err != nil {
		return askTarget{}, hidden(err)
	}
	return askTarget{task: t, assignee: row.AssigneeID.String, creator: row.CreatedBy}, nil
}

func (s *AskUNIService) prepareUpdateTask(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpUpdateTaskIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	zero := int64(0)
	in.Revision = &zero // the server reads the real one below
	if err := in.check(); err != nil {
		return askDraftRow{}, err
	}
	refs, byField, err := askRowRefs(earlier, map[string]string{"task_id": "create_task", "parent_task_id": "create_task", "project_id": "create_project"},
		map[string]string{"task_id": in.TaskID, "parent_task_id": optValue(in.ParentTaskID), "project_id": optValue(in.ProjectID)})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	tg, err := s.readTaskTarget(ctx, tc, in.TaskID, n)
	if err != nil {
		return askDraftRow{}, err
	}
	_, taskIsRef := byField["task_id"]
	before := tg.task
	if tg.isRef {
		before = McpTask{} // nothing to read yet: every from is empty
	}
	var fields []AskProposalField
	add := func(field, typ string, from, to any, options []string) {
		fields = append(fields, AskProposalField{Field: field, Type: typ, From: from, To: to, Options: options})
	}
	if in.Title.Set {
		add("title", "text", before.Title, in.Title.Value, nil)
	}
	if in.Description.Set {
		old := ""
		if before.Description != nil {
			old = *before.Description
		}
		add("description", "markdown", old, in.Description.Value, nil)
	}
	if in.Status.Set {
		from := any(nil)
		if before.Status != "" {
			from = n.status(before.Status)
		}
		add("status", "enum", from, n.status(in.Status.Value), n.statusOptions())
	}
	if in.Priority.Set {
		add("priority", "enum", before.Priority, in.Priority.Value, mcpPriorities)
	}
	if in.AssigneeID.Set {
		add("assignee_id", "person", n.person(before.AssigneeID), n.person(optValue(in.AssigneeID)), nil)
	}
	if in.StartDate.Set {
		add("start_date", "date", mcpNullable(before.StartDate), mcpNullable(optValue(in.StartDate)), nil)
	}
	if in.DueDate.Set {
		add("due_date", "date", mcpNullable(before.DueDate), mcpNullable(optValue(in.DueDate)), nil)
	}
	if in.ProjectID.Set {
		add("project_id", "project", n.project(before.ProjectID), n.project(optValue(in.ProjectID)), nil)
	}
	if in.ParentTaskID.Set {
		add("parent_task_id", "text", n.task(before.ParentTaskID), n.task(optValue(in.ParentTaskID)), nil)
	}
	if len(in.AddLabelIDs) > 0 || len(in.RemoveLabelIDs) > 0 {
		var have, after []string
		for _, l := range before.Labels {
			have = append(have, l.Name)
			if !slices.Contains(in.RemoveLabelIDs, l.ID) {
				after = append(after, l.Name)
			}
		}
		for _, name := range n.labelNames(in.AddLabelIDs) {
			if !slices.Contains(after, name) {
				after = append(after, name)
			}
		}
		add("labels", "labels", have, after, nil)
	}
	fields = slices.DeleteFunc(fields, func(f AskProposalField) bool { return fieldsEqual(f.From, f.To) })
	if len(fields) == 0 {
		return askDraftRow{}, McpInvalidArgs{Msg: "nothing to change: every field already has the value asked for"}
	}

	row := askDraftRow{Tool: "update_task", Args: stored, TargetKind: "task", Level: askLevel2, Preview: AskProposalPreview{Fields: fields, Refs: refs}}
	people := []string{}
	if in.AssigneeID.Set && optValue(in.AssigneeID) != before.AssigneeID {
		people = append(people, optValue(in.AssigneeID))
	}
	if in.Status.Set && in.Status.Value != before.Status {
		people = append(people, tg.assignee, tg.creator)
	}
	row.Preview.Audience = AskAudience{Visibility: "workspace", Notifies: n.notified(people...)}
	if taskIsRef {
		row.Preview.Target = AskContextRef{Kind: "task", Title: tg.refTitle}
		return row, nil
	}
	rev := tg.task.Revision
	row.TargetID, row.TargetRevision = tg.task.ID, &rev
	row.Preview.Target = AskContextRef{Kind: "task", ID: tg.task.ID, Title: tg.task.Title}
	if len(refs) > 0 {
		return row, nil
	}
	mine, err := s.authoredByAsker(ctx, tc, "task", []string{tg.task.ID})
	if err != nil {
		return askDraftRow{}, err
	}
	ownsAssignee := func(id string) bool { return id == "" || id == tc.ActorID }
	newAssignee := before.AssigneeID
	if in.AssigneeID.Set {
		newAssignee = optValue(in.AssigneeID)
	}
	if mine[tg.task.ID] && ownsAssignee(before.AssigneeID) && ownsAssignee(newAssignee) && !in.ProjectID.Set && !in.ParentTaskID.Set {
		row.Level = askLevel1
	}
	return row, nil
}

// fieldsEqual compares two preview values; they are strings, nil or string lists.
func fieldsEqual(a, b any) bool {
	if as, ok := a.([]string); ok {
		bs, ok := b.([]string)
		return ok && slices.Equal(as, bs)
	}
	return a == b
}

func (s *AskUNIService) prepareAddComment(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpAddCommentIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if err := in.check(); err != nil {
		return askDraftRow{}, err
	}
	refs, _, err := askRowRefs(earlier, map[string]string{"task_id": "create_task"}, map[string]string{"task_id": in.TaskID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	tg, err := s.readTaskTarget(ctx, tc, in.TaskID, n)
	if err != nil {
		return askDraftRow{}, err
	}
	row := askDraftRow{
		Tool: "add_comment", Args: stored, TargetKind: "task", Level: askLevel2,
		Preview: AskProposalPreview{Fields: []AskProposalField{}, Body: in.Body, Refs: refs, Audience: AskAudience{Visibility: "task", Notifies: []AskContextRef{}}},
	}
	if tg.isRef {
		row.Preview.Target = AskContextRef{Kind: "task", Title: tg.refTitle}
		return row, nil
	}
	row.TargetID = tg.task.ID
	row.Preview.Target = AskContextRef{Kind: "task", ID: tg.task.ID, Title: tg.task.Title}
	row.Preview.Audience.Notifies = n.notified(tg.assignee, tg.creator)
	comments, err := s.tasks.Comments(ctx, tc.ActorID, tg.task.ID)
	if err != nil {
		return askDraftRow{}, hidden(err)
	}
	row.Preview.Audience.NotifiesMore = slices.ContainsFunc(comments, func(c db.ListTaskCommentsRow) bool { return c.AuthorID != tc.ActorID })
	return row, nil
}

func (s *AskUNIService) applyCreateTask(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpCreateTaskIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.CreateTask(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	task, ok := res.Item.(McpTask)
	if !ok || task.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = task.ID, task.URL
	return out, askInverseOrNote(&out, "delete_task", map[string]any{"task_id": task.ID, "revision": res.Revision}), nil
}

func (s *AskUNIService) applyAddComment(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpAddCommentIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.AddComment(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Note: res.Note}
	c, ok := res.Item.(McpComment)
	if !ok || c.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = c.ID, c.URL
	return out, askInverseOrNote(&out, "delete_task_comment", map[string]any{"comment_id": c.ID}), nil
}

func (s *AskUNIService) applyUpdateTask(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpUpdateTaskIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	before, err := s.reads.GetTask(ctx, p, in.WorkspaceID, in.TaskID)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// A row that waited for {{row:N.id}} has no revision of its own: the task
	// was made this turn, so the one just read is the one to write against.
	in.Revision = &before.Revision
	if row.TargetRevision != nil {
		in.Revision = row.TargetRevision
	}
	res, err := s.reads.UpdateTask(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: before.ID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	after, ok := res.Item.(McpTask)
	if !ok || len(res.Changes) == 0 {
		return out, nil, nil // saved, but not read back: no undo to offer
	}
	out.Href = after.URL
	// The old values come from the task as read, uncut: Changes cuts long text.
	back := map[string]any{"task_id": before.ID, "revision": res.Revision}
	for _, c := range res.Changes {
		switch c.Field {
		case "title":
			back["title"] = before.Title
		case "description":
			// "" clears it, which is how UpdateTask empties a description.
			back["description"] = ""
			if before.Description != nil {
				back["description"] = *before.Description
			}
		case "status":
			back["status"] = before.Status
		case "priority":
			back["priority"] = before.Priority
		case "assignee_id":
			back["assignee_id"] = mcpNullable(before.AssigneeID)
		case "start_date":
			back["start_date"] = mcpNullable(before.StartDate)
		case "due_date":
			back["due_date"] = mcpNullable(before.DueDate)
		case "project_id":
			back["project_id"] = mcpNullable(before.ProjectID)
		case "parent_task_id":
			back["parent_task_id"] = mcpNullable(before.ParentTaskID)
		case "labels":
			add, remove := []string{}, []string{}
			for _, l := range before.Labels {
				if !slices.ContainsFunc(after.Labels, func(a McpLabel) bool { return a.ID == l.ID }) {
					add = append(add, l.ID)
				}
			}
			for _, l := range after.Labels {
				if !slices.ContainsFunc(before.Labels, func(b McpLabel) bool { return b.ID == l.ID }) {
					remove = append(remove, l.ID)
				}
			}
			back["add_label_ids"], back["remove_label_ids"] = add, remove
		}
	}
	back["workspace_id"] = in.WorkspaceID
	return out, askInverseOrNote(&out, "update_task", back), nil
}

func askInverseOf(op string, args map[string]any) (*askInverse, error) {
	b, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	return &askInverse{Op: op, Args: b}, nil
}
