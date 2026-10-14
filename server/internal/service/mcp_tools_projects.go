package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The project tools of the MCP connector (spec 2026-10-14 §5.2). Projects
// live on TaskService, where a workspace member reads every project of the
// workspace; each call runs as the person who consented.

// mcpProjectTasks is how many of its tasks get_project lists; task_count says
// how many it has.
const mcpProjectTasks = 20

// McpProject is a project as a tool shows it. Description is the stored
// Markdown, which only get_project sets: exact, cut at mcpMaxItemRunes with
// DescriptionTruncated when longer, so a model edits from the real text and not
// from the excerpt.
type McpProject struct {
	McpItem
	Revision             int64     `json:"revision"`
	Priority             string    `json:"priority,omitempty"`
	LeadID               string    `json:"lead_id,omitempty"`
	StartDate            string    `json:"start_date,omitempty"`
	TaskCount            int64     `json:"task_count"`
	DoneCount            int64     `json:"done_count"`
	Tasks                []McpTask `json:"tasks,omitempty"`
	Description          *string   `json:"description,omitempty"`
	DescriptionTruncated bool      `json:"description_truncated,omitempty"`
}

// McpProjectList is what list_projects returns: the rows, and whether more
// matched than came back.
type McpProjectList struct {
	Projects  []McpProject `json:"projects"`
	Truncated bool         `json:"truncated"`
}

func (s *McpToolService) projectOf(base string, pr db.Project, v ProjectView) McpProject {
	out := McpProject{
		McpItem:  McpItem{Kind: "project", ID: pr.ID, WorkspaceID: pr.WorkspaceID, Title: pr.Title, Status: pr.Status, URL: s.frontend + base + "/projects/" + pr.ID, Excerpt: capRunes(pr.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: pr.Revision, Priority: pr.Priority, LeadID: pr.LeadID.String, TaskCount: v.TaskCount, DoneCount: v.DoneCount,
	}
	if pr.DueDate.Valid {
		out.DueDate = pr.DueDate.Time.Format("2006-01-02")
	}
	if pr.StartDate.Valid {
		out.StartDate = pr.StartDate.Time.Format("2006-01-02")
	}
	return out
}

// project resolves a project id inside the workspace. It first checks that the
// workspace belongs to the grant's organization, so no tool that reaches a
// project can forget to; a project of another workspace reads as absent, as
// GetProject already refuses it.
func (s *McpToolService) project(ctx context.Context, p McpPrincipal, workspaceID, projectID string) (db.Project, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return db.Project{}, err
	}
	if strings.TrimSpace(projectID) == "" {
		return db.Project{}, McpInvalidArgs{Msg: "project_id is required"}
	}
	pr, err := s.ask.tasks.GetProject(ctx, Human(p.UserID), workspaceID, projectID)
	return pr, hidden(err)
}

type mcpListProjectsIn struct {
	WorkspaceID   string `json:"workspace_id"`
	Query         string `json:"query"`
	Status        string `json:"status"`
	IncludeClosed bool   `json:"include_closed"`
}

func (s *McpToolService) ListProjects(ctx context.Context, p McpPrincipal, in mcpListProjectsIn) (McpProjectList, error) {
	q := strings.TrimSpace(in.Query)
	if in.Query != "" && (q == "" || utf8.RuneCountInString(q) > mcpMaxQueryRunes) {
		return McpProjectList{}, McpInvalidArgs{Msg: "query must be 1-" + strconv.Itoa(mcpMaxQueryRunes) + " characters; omit it to list"}
	}
	// A search has no status filter, so the two cannot both be honoured.
	if q != "" && in.Status != "" {
		return McpProjectList{}, McpInvalidArgs{Msg: "status cannot be combined with query; search by query, or list by status"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpProjectList{}, err
	}
	actor := Human(p.UserID)
	var rows []db.Project
	var truncated bool
	if q != "" {
		var total int64
		var err error
		if rows, total, err = s.ask.tasks.SearchProjects(ctx, actor, in.WorkspaceID, SearchProjectsInput{Q: q, IncludeClosed: in.IncludeClosed, Limit: mcpMaxList}); err != nil {
			return McpProjectList{}, err
		}
		truncated = total > int64(len(rows))
	} else {
		var err error
		if rows, err = s.ask.tasks.ListProjects(ctx, actor, in.WorkspaceID, ListProjectsFilter{Status: optString(in.Status)}); err != nil {
			return McpProjectList{}, err
		}
		if truncated = len(rows) > mcpMaxList; truncated {
			rows = rows[:mcpMaxList]
		}
	}
	stats, err := s.ask.tasks.ProjectStats(ctx, actor, in.WorkspaceID, rows)
	if err != nil {
		return McpProjectList{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpProjectList{}, err
	}
	out := McpProjectList{Projects: make([]McpProject, 0, len(rows)), Truncated: truncated}
	for _, pr := range rows {
		out.Projects = append(out.Projects, s.projectOf(base, pr, stats[pr.ID]))
	}
	return out, nil
}

type mcpProjectRef struct {
	WorkspaceID string `json:"workspace_id"`
	ProjectID   string `json:"project_id"`
}

func (s *McpToolService) GetProject(ctx context.Context, p McpPrincipal, in mcpProjectRef) (McpProject, error) {
	pr, err := s.project(ctx, p, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return McpProject{}, err
	}
	actor := Human(p.UserID)
	stats, err := s.ask.tasks.ProjectStats(ctx, actor, in.WorkspaceID, []db.Project{pr})
	if err != nil {
		return McpProject{}, err
	}
	page, err := s.ask.tasks.QueryTasks(ctx, actor, in.WorkspaceID, TaskQuery{ProjectID: pr.ID, Limit: mcpProjectTasks})
	if err != nil {
		return McpProject{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpProject{}, err
	}
	out := s.projectOf(base, pr, stats[pr.ID])
	// The description has a field of its own here; the excerpt would repeat it.
	out.Excerpt = ""
	desc := capRunes(pr.Description, mcpMaxItemRunes, "")
	out.Description, out.DescriptionTruncated = &desc, desc != pr.Description
	for _, t := range page.Tasks {
		out.Tasks = append(out.Tasks, s.taskOf(base, t))
	}
	return out, nil
}

// mcpProjectEnum refuses a status or priority outside valid, naming the set.
func mcpProjectEnum(field, v string, valid []string) error {
	if !containsStr(valid, v) {
		return McpInvalidArgs{Msg: field + " must be one of " + strings.Join(valid, ", ")}
	}
	return nil
}

func mcpProjectTitle(title string) error {
	if t := strings.TrimSpace(title); t == "" || utf8.RuneCountInString(t) > projectTitleMaxLen {
		return McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", projectTitleMaxLen)}
	}
	return nil
}

// projectTitleTaken names the project that holds the title a create or a
// rename was refused for, so a model reads it instead of making another. Every
// member of the workspace reads all of its projects. Any other error, or a
// project that cannot be found again, passes unchanged.
func (s *McpToolService) projectTitleTaken(ctx context.Context, p McpPrincipal, workspaceID, base, title string, err error) error {
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "duplicate_project_title" {
		return err
	}
	rows, lerr := s.ask.tasks.ListProjects(ctx, Human(p.UserID), workspaceID, ListProjectsFilter{})
	if lerr != nil {
		return err
	}
	want := normalizeProjectTitle(title)
	for _, pr := range rows {
		if normalizeProjectTitle(pr.Title) == want {
			return McpToolError{Code: ce.Code, Msg: fmt.Sprintf("a project with this title already exists in the workspace: id %s, %s; read it, or pick another title", pr.ID, s.frontend+base+"/projects/"+pr.ID)}
		}
	}
	return err
}

type mcpCreateProjectIn struct {
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	LeadID      string `json:"lead_id"`
	StartDate   string `json:"start_date"`
	DueDate     string `json:"due_date"`
}

// mcpLeadMember is the lead_type of every lead a tool sets: list_members
// lists people, not agents.
const mcpLeadMember = "member"

// CreateProject creates a project without a chat channel (spec §5.2):
// CreateChannel stays false.
func (s *McpToolService) CreateProject(ctx context.Context, p McpPrincipal, in mcpCreateProjectIn) (McpWriteResult, error) {
	if err := mcpProjectTitle(in.Title); err != nil {
		return McpWriteResult{}, err
	}
	if in.Status != "" {
		if err := mcpProjectEnum("status", in.Status, validProjectStatuses); err != nil {
			return McpWriteResult{}, err
		}
	}
	if in.Priority != "" {
		if err := mcpProjectEnum("priority", in.Priority, mcpPriorities); err != nil {
			return McpWriteResult{}, err
		}
	}
	for _, d := range []struct{ field, value string }{{"start_date", in.StartDate}, {"due_date", in.DueDate}} {
		if d.value == "" {
			continue
		}
		if err := mcpDate(d.field, d.value); err != nil {
			return McpWriteResult{}, err
		}
	}
	// update_project could never edit or undo a longer one.
	if utf8.RuneCountInString(in.Description) > mcpMaxItemRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here", mcpMaxItemRunes)}
	}
	leadID, err := mcpID("lead_id", in.LeadID)
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
	var leadType *string
	if leadID != nil {
		lt := mcpLeadMember
		leadType = &lt
	}
	pr, err := s.ask.tasks.CreateProject(ctx, Human(p.UserID), in.WorkspaceID, CreateProjectInput{
		Title: in.Title, Description: optString(in.Description), Status: in.Status, Priority: in.Priority,
		LeadType: leadType, LeadID: leadID, StartDate: optString(in.StartDate), DueDate: optString(in.DueDate),
	})
	if err != nil {
		return McpWriteResult{}, s.projectTitleTaken(ctx, p, in.WorkspaceID, base, in.Title, err)
	}
	return McpWriteResult{Item: s.projectOf(base, pr, ProjectView{}), Revision: pr.Revision}, nil
}

type mcpUpdateProjectIn struct {
	WorkspaceID string         `json:"workspace_id"`
	ProjectID   string         `json:"project_id"`
	Revision    *int64         `json:"revision"`
	Title       mcpOpt[string] `json:"title"`
	Description mcpOpt[string] `json:"description"`
	Status      mcpOpt[string] `json:"status"`
	Priority    mcpOpt[string] `json:"priority"`
	LeadID      mcpOpt[string] `json:"lead_id"`
	StartDate   mcpOpt[string] `json:"start_date"`
	DueDate     mcpOpt[string] `json:"due_date"`
}

// check refuses what the service would misread: no revision, null for a
// field that cannot be empty, and a blank lead, which it takes for half a lead.
func (in mcpUpdateProjectIn) check() error {
	if in.Revision == nil || *in.Revision <= 0 {
		return McpInvalidArgs{Msg: "revision is required; read the project first and send its revision"}
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
	if utf8.RuneCountInString(in.Description.Value) > mcpMaxItemRunes {
		return McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here; a longer one could not be undone", mcpMaxItemRunes)}
	}
	if in.Title.Set {
		if err := mcpProjectTitle(in.Title.Value); err != nil {
			return err
		}
	}
	if in.Status.Set {
		if err := mcpProjectEnum("status", in.Status.Value, validProjectStatuses); err != nil {
			return err
		}
	}
	if in.Priority.Set {
		if err := mcpProjectEnum("priority", in.Priority.Value, mcpPriorities); err != nil {
			return err
		}
	}
	for _, f := range []field{{"start_date", in.StartDate}, {"due_date", in.DueDate}} {
		if f.o.Set && !f.o.Null {
			if err := mcpDate(f.name, f.o.Value); err != nil {
				return err
			}
		}
	}
	if in.LeadID.Set && !in.LeadID.Null && strings.TrimSpace(in.LeadID.Value) == "" {
		return McpInvalidArgs{Msg: "lead_id must not be blank; send null to clear it"}
	}
	return nil
}

// UpdateProject changes one project in one command. The service checks the
// revision again in the UPDATE itself, so a project changed after the read
// below is refused and nothing is written.
func (s *McpToolService) UpdateProject(ctx context.Context, p McpPrincipal, in mcpUpdateProjectIn) (McpWriteResult, error) {
	if err := in.check(); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.project(ctx, p, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Refused here, the from values of the result are the project the model read.
	if err := CheckTaskRevision(*in.Revision, before.Revision); err != nil {
		return McpWriteResult{}, err
	}
	// Undo sends from back, and get_project shows no more than this: a longer
	// description replaced here could not be restored.
	if in.Description.Set && utf8.RuneCountInString(before.Description) > mcpMaxItemRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "the description is too long to replace safely here; edit it in UniWork"}
	}
	actor := Human(p.UserID)
	// Read before the write: a failure after it would read as a failed update.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	stats, err := s.ask.tasks.ProjectStats(ctx, actor, in.WorkspaceID, []db.Project{before})
	if err != nil {
		return McpWriteResult{}, err
	}
	upd := UpdateProjectInput{
		ExpectedRevision: *in.Revision,
		Title:            in.Title.ptr(), Description: in.Description.ptr(), Status: in.Status.ptr(), Priority: in.Priority.ptr(),
		LeadID: in.LeadID.ptr2(), StartDate: in.StartDate.ptr2(), DueDate: in.DueDate.ptr2(),
	}
	if in.LeadID.Set {
		upd.LeadType = mcpOpt[string]{Set: true, Null: in.LeadID.Null, Value: mcpLeadMember}.ptr2()
	}
	after, err := s.ask.tasks.UpdateProject(ctx, actor, in.WorkspaceID, before.ID, upd)
	if err != nil {
		return McpWriteResult{}, s.projectTitleTaken(ctx, p, in.WorkspaceID, base, in.Title.Value, err)
	}
	b, a := s.projectOf(base, before, stats[before.ID]), s.projectOf(base, after, stats[before.ID])
	changes := mcpChanges(McpChange{"title", before.Title, after.Title})
	if before.Description != after.Description {
		// Uncut, unlike the rest: both sides are at most mcpMaxItemRunes, and
		// from is how the model puts the old text back.
		changes = append(changes, McpChange{"description", before.Description, after.Description})
	}
	changes = append(changes, mcpChanges(
		McpChange{"status", before.Status, after.Status},
		McpChange{"priority", before.Priority, after.Priority},
		McpChange{"lead_id", mcpNullable(b.LeadID), mcpNullable(a.LeadID)},
		McpChange{"start_date", mcpNullable(b.StartDate), mcpNullable(a.StartDate)},
		McpChange{"due_date", mcpNullable(b.DueDate), mcpNullable(a.DueDate)},
	)...)
	return McpWriteResult{Item: a, Revision: after.Revision, Changes: changes}, nil
}

var (
	mcpSchemaListProjects  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200,"description":"Part of a title or description, any case. Omit to list."},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"],"description":"Cannot be combined with query."},"include_closed":{"type":"boolean","description":"Only with query: also completed and cancelled projects, which a search leaves out by default. A list without query shows every status."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaProject       = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"project_id":{"type":"string"}},"required":["workspace_id","project_id"],"additionalProperties":false}`)
	mcpSchemaCreateProject = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `,"description":"Markdown."},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"],"description":"Omit for planned."},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"lead_id":{"type":"string","description":"A user_id from list_members."},"start_date":{"type":"string","description":"YYYY-MM-DD"},"due_date":{"type":"string","description":"YYYY-MM-DD"}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaUpdateProject = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"project_id":{"type":"string"},"revision":{"type":"integer","description":"The revision you read with get_project or list_projects."},"title":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `,"description":"Markdown; replaces the whole description. Edit from the description get_project returns."},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"]},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"lead_id":{"type":["string","null"],"description":"A user_id from list_members; null removes the lead."},"start_date":{"type":["string","null"],"description":"YYYY-MM-DD; null clears it."},"due_date":{"type":["string","null"],"description":"YYYY-MM-DD; null clears it."}},"required":["workspace_id","project_id","revision"],"additionalProperties":false}`)
)

func mcpProjectTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_projects", "List projects", "Projects in one workspace, each with its revision, task_count and done_count (tasks done or cancelled). Without query, every status (or the one in status), most recently updated first. With query (part of a title or description, any case), the projects holding it: a title equal to the query first, then titles starting with it, then the rest, each most recently updated first; completed and cancelled projects are left out unless include_closed is true. At most 50; truncated says more matched.", mcpSchemaListProjects,
			func(ctx context.Context, p McpPrincipal, in mcpListProjectsIn) (any, error) {
				return s.ListProjects(ctx, p, in)
			}),
		mcpReadTool("get_project", "Get project", "One project with its revision, task_count and done_count (tasks done or cancelled), its description exactly as stored (Markdown) to edit from, and its first "+strconv.Itoa(mcpProjectTasks)+" tasks ordered by status key alphabetically, then position; use list_tasks with project_id for the rest. description_truncated says the description was longer than "+strconv.Itoa(mcpMaxItemRunes)+" characters and was cut.", mcpSchemaProject,
			func(ctx context.Context, p McpPrincipal, in mcpProjectRef) (any, error) {
				return s.GetProject(ctx, p, in)
			}),
		mcpWriteTool("create_project", "Create project", "Creates a project in the workspace as the user, without a chat channel. Everyone in the workspace sees it. No one is notified, the lead included. A title another project of the workspace already has, in any case or spacing, fails with duplicate_project_title naming that project. The description holds at most "+strconv.Itoa(mcpMaxItemRunes)+" characters.", "set its status to cancelled, or delete it in UniWork", false, mcpSchemaCreateProject,
			func(ctx context.Context, p McpPrincipal, in mcpCreateProjectIn) (any, error) {
				return s.CreateProject(ctx, p, in)
			}),
		mcpWriteTool("update_project", "Update project", "Changes one project as the user: omitted fields stay as they are, null clears lead_id or a date. revision must be the one you read; if the project changed since, nothing is written and the call fails with revision_conflict. Only its creator, its lead or a workspace owner or admin may change it; anyone else gets not_project_editor. Everyone in the workspace sees the change. No one is notified. A description longer than "+strconv.Itoa(mcpMaxItemRunes)+" characters is too long to replace here; edit it in UniWork.", "call update_project again with the from values in changes", true, mcpSchemaUpdateProject,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateProjectIn) (any, error) {
				return s.UpdateProject(ctx, p, in)
			}),
	}
}
