package service

import (
	"context"
	"encoding/json"
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

var (
	mcpSchemaListProjects = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200,"description":"Part of a title or description, any case. Omit to list."},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"],"description":"Cannot be combined with query."},"include_closed":{"type":"boolean","description":"Only with query: also completed and cancelled projects, which a search leaves out by default. A list without query shows every status."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaProject      = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"project_id":{"type":"string"}},"required":["workspace_id","project_id"],"additionalProperties":false}`)
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
	}
}
