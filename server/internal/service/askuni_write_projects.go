package service

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// Ask UNI's project write tools (spec P3, R4): prepare reads and rates, apply
// runs the MCP connector's own write method as the asker, and each leaves the
// inverse that puts things back.

func init() {
	// shortcut: the revision and the task count are read, then the delete runs; a
	// write between the two slips through. Upgrade when DeleteProject takes a
	// revision.
	askInverses["delete_project"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			WorkspaceID string `json:"workspace_id"`
			ProjectID   string `json:"project_id"`
			Revision    int64  `json:"revision"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		if s.reads == nil {
			return errAskReadsNotWired
		}
		cur, err := s.reads.GetProject(ctx, p, mcpProjectRef{WorkspaceID: a.WorkspaceID, ProjectID: a.ProjectID})
		if err != nil {
			return askUndoGuard(err)
		}
		if cur.Revision != a.Revision || cur.TaskCount > 0 {
			return errAskUndoUnavailable
		}
		return askUndoGuard(s.tasks.DeleteProject(ctx, Human(p.UserID), a.WorkspaceID, a.ProjectID))
	}
	askInverses["update_project"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		if s.reads == nil {
			return errAskReadsNotWired
		}
		var in mcpUpdateProjectIn
		if err := decodeInto(args, &in); err != nil {
			return err
		}
		_, err := s.reads.UpdateProject(ctx, p, in)
		return askUndoGuard(err)
	}
}

func (s *AskUNIService) askProjectTools() []askWriteTool {
	tool := func(name, desc, undo string, destructive bool, schema json.RawMessage) ai.Tool {
		return ai.Tool{Name: name, Description: desc, Kind: ai.ToolWrite, Risk: ai.RiskMedium, Destructive: destructive, Undo: undo, Schema: askToolSchema(schema, 10)}
	}
	return []askWriteTool{
		{
			Tool:    tool("create_project", "Proposes a new project in this workspace, without a chat channel. Everyone in the workspace sees it; no one is notified, the lead included. A title another project already has is refused.", "the asker deletes the project while it has no tasks", false, mcpSchemaCreateProject),
			prepare: s.prepareCreateProject, apply: s.applyCreateProject, inverse: "delete_project",
		},
		{
			Tool:    tool("update_project", "Proposes changes to one project: omitted fields stay, null clears the lead or a date. Everyone in the workspace sees the change; no one is notified.", "the asker puts the old values back", true, mcpSchemaUpdateProject),
			prepare: s.prepareUpdateProject, apply: s.applyUpdateProject, inverse: "update_project",
		},
	}
}

// checkProjectTitleFree refuses a title another project of the workspace
// already has, as the service does, but before a row exists. exclude is the
// project being renamed.
func (s *AskUNIService) checkProjectTitleFree(ctx context.Context, tc ai.ToolContext, title, exclude string) error {
	rows, err := s.tasks.ListProjects(ctx, Human(tc.ActorID), tc.WorkspaceID, ListProjectsFilter{})
	if err != nil {
		return err
	}
	want := normalizeProjectTitle(title)
	for _, pr := range rows {
		if pr.ID != exclude && normalizeProjectTitle(pr.Title) == want {
			return McpToolError{Code: "duplicate_project_title", Msg: fmt.Sprintf("a project with this title already exists in the workspace: id %s; read it, or pick another title", pr.ID)}
		}
	}
	return nil
}

func (s *AskUNIService) prepareCreateProject(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	var in mcpCreateProjectIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if err := in.check(); err != nil {
		return askDraftRow{}, err
	}
	if _, err := mcpID("lead_id", in.LeadID); err != nil {
		return askDraftRow{}, err
	}
	if err := s.checkProjectTitleFree(ctx, tc, in.Title, ""); err != nil {
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
		add("status", "enum", in.Status, validProjectStatuses)
	}
	if in.Priority != "" {
		add("priority", "enum", in.Priority, mcpPriorities)
	}
	if in.LeadID != "" {
		add("lead_id", "person", n.person(in.LeadID), nil)
	}
	if in.StartDate != "" {
		add("start_date", "date", in.StartDate, nil)
	}
	if in.DueDate != "" {
		add("due_date", "date", in.DueDate, nil)
	}
	return askDraftRow{
		Tool: "create_project", Args: stored, TargetKind: "project", Level: askLevel2,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "project", Title: in.Title}, Fields: fields, Refs: []int{},
			Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}},
		},
	}, nil
}

func (s *AskUNIService) prepareUpdateProject(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpUpdateProjectIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	one := int64(1)
	in.Revision = &one // the server reads the real one below
	if err := in.check(); err != nil {
		return askDraftRow{}, err
	}
	refs, byField, err := askRowRefs(earlier, map[string]string{"project_id": "create_project"}, map[string]string{"project_id": in.ProjectID})
	if err != nil {
		return askDraftRow{}, err
	}
	if in.LeadID.Set && !in.LeadID.Null {
		if _, err := mcpID("lead_id", in.LeadID.Value); err != nil {
			return askDraftRow{}, err
		}
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	var before McpProject // a project made this turn has nothing to read: every from is empty
	target := AskContextRef{Kind: "project"}
	if _, isRef := byField["project_id"]; isRef {
		target.Title, _ = n.ref(in.ProjectID)
	} else {
		if before, err = s.reads.GetProject(ctx, principalOf(tc), mcpProjectRef{WorkspaceID: tc.WorkspaceID, ProjectID: in.ProjectID}); err != nil {
			return askDraftRow{}, err
		}
		target.ID, target.Title = before.ID, before.Title
	}
	if in.Title.Set && in.Title.Value != before.Title {
		if err := s.checkProjectTitleFree(ctx, tc, in.Title.Value, before.ID); err != nil {
			return askDraftRow{}, err
		}
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
		add("status", "enum", mcpNullable(before.Status), in.Status.Value, validProjectStatuses)
	}
	if in.Priority.Set {
		add("priority", "enum", mcpNullable(before.Priority), in.Priority.Value, mcpPriorities)
	}
	if in.LeadID.Set {
		add("lead_id", "person", n.person(before.LeadID), n.person(optValue(in.LeadID)), nil)
	}
	if in.StartDate.Set {
		add("start_date", "date", mcpNullable(before.StartDate), mcpNullable(optValue(in.StartDate)), nil)
	}
	if in.DueDate.Set {
		add("due_date", "date", mcpNullable(before.DueDate), mcpNullable(optValue(in.DueDate)), nil)
	}
	fields = slices.DeleteFunc(fields, func(f AskProposalField) bool { return fieldsEqual(f.From, f.To) })
	if len(fields) == 0 {
		return askDraftRow{}, McpInvalidArgs{Msg: "nothing to change: every field already has the value asked for"}
	}
	row := askDraftRow{
		Tool: "update_project", Args: stored, TargetKind: "project", Level: askLevel2,
		Preview: AskProposalPreview{Target: target, Fields: fields, Refs: refs, Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}}},
	}
	if before.ID != "" {
		rev := before.Revision
		row.TargetID, row.TargetRevision = before.ID, &rev
	}
	return row, nil
}

func (s *AskUNIService) applyCreateProject(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpCreateProjectIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.CreateProject(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	pr, ok := res.Item.(McpProject)
	if !ok || pr.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = pr.ID, pr.URL
	return out, askInverseOrNote(&out, "delete_project", map[string]any{"workspace_id": in.WorkspaceID, "project_id": pr.ID, "revision": res.Revision}), nil
}

func (s *AskUNIService) applyUpdateProject(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpUpdateProjectIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	before, err := s.reads.GetProject(ctx, p, mcpProjectRef{WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID})
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// A row that waited for {{row:N.id}} has no revision of its own: the project
	// was made this turn, so the one just read is the one to write against.
	in.Revision = &before.Revision
	if row.TargetRevision != nil {
		in.Revision = row.TargetRevision
	}
	res, err := s.reads.UpdateProject(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: before.ID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	after, ok := res.Item.(McpProject)
	if !ok || len(res.Changes) == 0 {
		return out, nil, nil // saved, but not read back: no undo to offer
	}
	out.Href = after.URL
	// The old values come from the project as read, uncut: Changes cuts long text.
	back := map[string]any{"workspace_id": in.WorkspaceID, "project_id": before.ID, "revision": res.Revision}
	for _, c := range res.Changes {
		switch c.Field {
		case "title":
			back["title"] = before.Title
		case "description":
			// "" clears it, which is how UpdateProject empties a description.
			back["description"] = ""
			if before.Description != nil {
				back["description"] = *before.Description
			}
		case "status":
			back["status"] = before.Status
		case "priority":
			back["priority"] = before.Priority
		case "lead_id":
			back["lead_id"] = mcpNullable(before.LeadID)
		case "start_date":
			back["start_date"] = mcpNullable(before.StartDate)
		case "due_date":
			back["due_date"] = mcpNullable(before.DueDate)
		}
	}
	return out, askInverseOrNote(&out, "update_project", back), nil
}
