package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

func (x *mcpToolWorld) project(t *testing.T, title string) string {
	t.Helper()
	p, err := x.tools.ask.tasks.CreateProject(context.Background(), Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

// projectList runs list_projects on the world's workspace with extra JSON
// fields (without braces) and reads the wrapper back.
func (x *mcpToolWorld) projectList(t *testing.T, extra string) McpProjectList {
	t.Helper()
	input := `{"workspace_id":"` + x.w.ID + `"`
	if extra != "" {
		input += "," + extra
	}
	raw, err := callMcpTool(t, x.tools, x.p, "list_projects", input+"}")
	if err != nil {
		t.Fatal(err)
	}
	var list McpProjectList
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("list_projects = %s (%v)", raw, err)
	}
	return list
}

func projectTitles(list McpProjectList) []string {
	out := make([]string, 0, len(list.Projects))
	for _, p := range list.Projects {
		out = append(out, p.Title)
	}
	return out
}

func TestMcpListAndGetProject(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.project(t, "Bán hàng Q4")
	rev := x.revision(t, x.taskID)
	if _, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+strconv.FormatInt(rev, 10)+`,"project_id":"`+id+`"}`); err != nil {
		t.Fatal(err)
	}
	list := x.projectList(t, `"query":"bán hàng"`)
	if len(list.Projects) != 1 || list.Truncated || list.Projects[0].ID != id || list.Projects[0].TaskCount != 1 || list.Projects[0].Revision == 0 || list.Projects[0].Kind != "project" {
		t.Fatalf("list_projects = %+v", list)
	}
	raw, err := callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpProject
	if err := json.Unmarshal(raw, &one); err != nil || len(one.Tasks) != 1 || one.Tasks[0].ID != x.taskID || !strings.Contains(one.URL, "/projects/"+id) {
		t.Fatalf("get_project = %s (%v)", raw, err)
	}
	if one.Revision != list.Projects[0].Revision || one.TaskCount != 1 || one.DoneCount != 0 || one.Title != "Bán hàng Q4" || one.Status != "planned" {
		t.Errorf("get_project = %+v", one)
	}
}

func TestMcpListProjectsOrderAndFilters(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	create := func(title, status string) string {
		t.Helper()
		p, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: title, Status: status})
		if err != nil {
			t.Fatal(err)
		}
		return p.ID
	}
	// Created in this order, so by recency alone the last one would lead.
	create("Ban hang Q4", "")
	create("Ban hang cu", "completed")
	create("Ke hoach ban hang", "paused")
	create("Ban hang", "in_progress")
	create("Marketing", "paused")

	// Without a query: every status, most recently updated first.
	if got, want := strings.Join(projectTitles(x.projectList(t, "")), "|"), "Marketing|Ban hang|Ke hoach ban hang|Ban hang cu|Ban hang Q4"; got != want {
		t.Errorf("no query: %s, want %s", got, want)
	}
	if got, want := strings.Join(projectTitles(x.projectList(t, `"status":"paused"`)), "|"), "Marketing|Ke hoach ban hang"; got != want {
		t.Errorf("status paused: %s, want %s", got, want)
	}
	// A query: the title equal to it, then titles starting with it, then the
	// rest; completed and cancelled stay out unless include_closed.
	if got, want := strings.Join(projectTitles(x.projectList(t, `"query":"ban hang"`)), "|"), "Ban hang|Ban hang Q4|Ke hoach ban hang"; got != want {
		t.Errorf("query: %s, want %s", got, want)
	}
	if got, want := strings.Join(projectTitles(x.projectList(t, `"query":"ban hang","include_closed":true`)), "|"), "Ban hang|Ban hang cu|Ban hang Q4|Ke hoach ban hang"; got != want {
		t.Errorf("query with include_closed: %s, want %s", got, want)
	}

	// Combinations the query cannot honour are refused, not half answered.
	for name, extra := range map[string]string{
		"status with query": `"query":"ban","status":"paused"`,
		"blank query":       `"query":"   "`,
		"unknown status":    `"status":"nope"`,
		"long query":        `"query":"` + strings.Repeat("a", mcpMaxQueryRunes+1) + `"`,
	} {
		_, err := callMcpTool(t, x.tools, x.p, "list_projects", `{"workspace_id":"`+x.w.ID+`",`+extra+`}`)
		var bad McpInvalidArgs
		if !errors.As(mcpMapError(err), &bad) {
			t.Errorf("%s: %v, want invalid arguments", name, err)
		}
	}
}

func TestMcpListProjectsStopsAtTheCapAndSaysSo(t *testing.T) {
	x := newMcpToolWorld(t)
	for i := range mcpMaxList + 1 {
		x.project(t, fmt.Sprintf("Loat %02d", i))
	}
	x.project(t, "Rieng le")
	for name, extra := range map[string]string{"list": "", "search": `"query":"loat"`} {
		list := x.projectList(t, extra)
		if len(list.Projects) != mcpMaxList || !list.Truncated {
			t.Errorf("%s: %d projects, truncated %v; want %d and true", name, len(list.Projects), list.Truncated, mcpMaxList)
		}
	}
	if list := x.projectList(t, `"query":"rieng"`); len(list.Projects) != 1 || list.Truncated {
		t.Errorf("one match: %+v", list)
	}
}

func TestMcpGetProjectDescriptionAndTasks(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	long := strings.Repeat("ạ", mcpMaxItemRunes+5)
	short := "## Mục tiêu\nChốt doanh số."
	longP, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Dài", Description: &long})
	if err != nil {
		t.Fatal(err)
	}
	shortP, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Ngắn", Description: &short})
	if err != nil {
		t.Fatal(err)
	}
	get := func(id string) McpProject {
		t.Helper()
		got, err := x.tools.GetProject(ctx, x.p, mcpProjectRef{WorkspaceID: x.w.ID, ProjectID: id})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	// The exact description, cut only at the item limit with the flag set; no
	// marker inside the text, and the excerpt does not repeat it.
	if got := get(longP.ID); deref(got.Description) != strings.Repeat("ạ", mcpMaxItemRunes) || !got.DescriptionTruncated || got.Excerpt != "" {
		t.Errorf("long description: %d characters, truncated %v, excerpt %d characters", utf8.RuneCountInString(deref(got.Description)), got.DescriptionTruncated, utf8.RuneCountInString(got.Excerpt))
	}
	if got := get(shortP.ID); deref(got.Description) != short || got.DescriptionTruncated {
		t.Errorf("short description = %q, truncated %v", deref(got.Description), got.DescriptionTruncated)
	}
	// The list shows no description, only the excerpt a search hit has.
	row := x.projectList(t, `"query":"dài"`).Projects
	if len(row) != 1 || row[0].ID != longP.ID || row[0].Description != nil || row[0].DescriptionTruncated || utf8.RuneCountInString(row[0].Excerpt) != mcpMaxHitRunes {
		t.Errorf("list row of the long project = %+v", row)
	}

	// A project holds more tasks than the 20 it lists; the counts say how many.
	for i := range 21 {
		if _, err := x.tools.ask.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: fmt.Sprintf("Việc %02d", i), ProjectID: &shortP.ID}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := x.tools.ask.tasks.QueryTasks(ctx, Human(x.ua.ID), x.w.ID, TaskQuery{ProjectID: shortP.ID, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	rev := strconv.FormatInt(first.Tasks[0].Revision, 10)
	if _, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+first.Tasks[0].ID+`","revision":`+rev+`,"status":"done"}`); err != nil {
		t.Fatal(err)
	}
	got := get(shortP.ID)
	if len(got.Tasks) != 20 || len(got.Tasks) > mcpMaxList || got.TaskCount != 21 || got.DoneCount != 1 {
		t.Errorf("tasks %d, task_count %d, done_count %d; want 20, 21, 1", len(got.Tasks), got.TaskCount, got.DoneCount)
	}
	for _, task := range got.Tasks {
		if task.ProjectID != shortP.ID || task.Revision == 0 {
			t.Errorf("task of the project = %+v", task)
		}
	}
}

func TestMcpGetProjectOfAnotherWorkspaceIsAbsent(t *testing.T) {
	x := newMcpToolWorld(t)
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	p, err := x.tools.ask.tasks.CreateProject(context.Background(), Human(x.ua.ID), other.ID, CreateProjectInput{Title: "Ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+p.ID+`"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("project of another workspace: %v, want ErrNotFound", err)
	}
}

// A workspace outside the grant's organization, one the person belongs to,
// reads as a workspace that does not exist, for every project tool and for the
// lookup the write tools will use.
func TestMcpProjectToolsStayInTheGrantsOrganization(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	p, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), other.ID, CreateProjectInput{Title: "Ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.ask.tasks.GetProject(ctx, Human(x.ua.ID), other.ID, p.ID); err != nil {
		t.Fatalf("control: the person reads it in UniWork: %v", err)
	}
	_, unknown := callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"01NOSUCHWORKSPACE","project_id":"`+p.ID+`"}`)
	if !errors.Is(unknown, ErrNotFound) {
		t.Fatalf("unknown workspace: %v", unknown)
	}
	for name, run := range map[string]func() error{
		"get_project": func() error {
			_, err := callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"`+other.ID+`","project_id":"`+p.ID+`"}`)
			return err
		},
		"list_projects": func() error {
			_, err := callMcpTool(t, x.tools, x.p, "list_projects", `{"workspace_id":"`+other.ID+`"}`)
			return err
		},
		"project": func() error { _, err := x.tools.project(ctx, x.p, other.ID, p.ID); return err },
	} {
		if err := run(); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("%s in a workspace outside the grant: %v, want %v", name, err, unknown)
		}
	}
	if _, err := x.tools.project(ctx, x.p, x.w.ID, "  "); !errors.As(err, new(McpInvalidArgs)) {
		t.Errorf("blank project id: %v, want invalid arguments", err)
	}
}
