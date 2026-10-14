package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// projectRevision is a project's current revision, the one update_project
// must send.
func (x *mcpToolWorld) projectRevision(t *testing.T, id string) int64 {
	t.Helper()
	p, err := x.tools.ask.tasks.GetProject(context.Background(), Human(x.ua.ID), x.w.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	return p.Revision
}

func TestMcpCreateAndUpdateProject(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	raw, err := callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"Ra mắt v2","priority":"high","lead_id":"`+x.ua.ID+`","due_date":"2026-12-01"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	id, _ := item["id"].(string)
	if id == "" || res.Revision == 0 || item["priority"] != "high" || item["lead_id"] != x.ua.ID || item["due_date"] != "2026-12-01" || item["status"] != "planned" || !strings.Contains(fmt.Sprint(item["url"]), "/projects/"+id) {
		t.Fatalf("create_project = %s", raw)
	}
	onlyKeys(t, "create_project item", item, "kind", "id", "workspace_id", "title", "excerpt", "url", "status", "due_date", "revision", "priority", "lead_id", "start_date", "task_count", "done_count")
	var kind string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT actor_kind FROM audit_events WHERE action = 'project.created' AND resource_id = $1`, id).Scan(&kind); err != nil || kind != "human" {
		t.Fatalf("project.created actor_kind = %q (%v), want human", kind, err)
	}
	// The item an update returns counts the project's tasks, as get_project does.
	if _, err := x.tools.ask.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: "Việc của v2", ProjectID: &id}); err != nil {
		t.Fatal(err)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(res.Revision, 10)+`,"status":"in_progress","due_date":null}`)
	if err != nil {
		t.Fatal(err)
	}
	upd, item := writeResult(t, raw)
	if item["status"] != "in_progress" || item["due_date"] != nil || item["lead_id"] != x.ua.ID || item["task_count"] != float64(1) || upd.Revision != res.Revision+1 || upd.Note != "" {
		t.Fatalf("update_project = %s", raw)
	}
	if len(upd.Changes) != 2 || upd.Changes[0] != (McpChange{"status", "planned", "in_progress"}) || upd.Changes[1] != (McpChange{"due_date", "2026-12-01", nil}) {
		t.Fatalf("changes = %+v, want status and due_date", upd.Changes)
	}
	// A stale revision is refused and writes nothing.
	_, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(res.Revision, 10)+`,"title":"X"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "revision_conflict" || !strings.Contains(te.Msg, strconv.FormatInt(upd.Revision, 10)) {
		t.Fatalf("stale update_project: %v", err)
	}
	if now, _ := x.tools.ask.tasks.GetProject(ctx, Human(x.ua.ID), x.w.ID, id); now.Revision != upd.Revision || now.Title != "Ra mắt v2" {
		t.Fatalf("a stale update wrote: revision %d, title %q", now.Revision, now.Title)
	}
	// A retried create names the project that has the title, for the model to
	// read instead of making another.
	_, err = callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"  ra mắt V2 "}`)
	if !errors.As(err, &te) || te.Code != "duplicate_project_title" || !strings.Contains(te.Msg, id) || !strings.Contains(te.Msg, "/projects/"+id) {
		t.Fatalf("duplicate title: %v", err)
	}
	// So does a rename onto another project's title.
	other := x.project(t, "Dự án khác")
	_, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+other+`","revision":`+strconv.FormatInt(x.projectRevision(t, other), 10)+`,"title":"Ra mắt v2"}`)
	if !errors.As(err, &te) || te.Code != "duplicate_project_title" || !strings.Contains(te.Msg, id) {
		t.Fatalf("rename onto a taken title: %v", err)
	}
	// The undo is the from values sent back.
	raw, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(upd.Revision, 10)+`,"status":"planned","due_date":"2026-12-01","lead_id":null}`)
	if err != nil {
		t.Fatal(err)
	}
	if back, item := writeResult(t, raw); item["status"] != "planned" || item["due_date"] != "2026-12-01" || item["lead_id"] != nil || len(back.Changes) != 3 || back.Changes[1] != (McpChange{"lead_id", x.ua.ID, nil}) {
		t.Fatalf("undo = %s", raw)
	}
}

// Only the creator, the lead or a workspace admin edits a project; a member
// who can read it gets a refusal the model can explain.
func TestMcpUpdateProjectNeedsAnEditor(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.project(t, "Của chủ")
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleMember)
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	rev := x.projectRevision(t, id)
	member := McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}
	_, err := callMcpTool(t, x.tools, member, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(rev, 10)+`,"title":"Chiếm"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "not_project_editor" {
		t.Fatalf("member edit: %v, want not_project_editor", err)
	}
	if x.projectRevision(t, id) != rev {
		t.Fatal("a refused edit wrote")
	}
	// Made its lead, the same member may.
	if _, err := callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(rev, 10)+`,"lead_id":"`+x.ub.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := callMcpTool(t, x.tools, member, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(x.projectRevision(t, id), 10)+`,"title":"Của người phụ trách"}`); err != nil {
		t.Fatalf("the lead's edit: %v", err)
	}
}

// What the services would misread or the model could not undo is refused
// before anything is written, in the words of the field.
func TestMcpProjectWriteToolsValidateInput(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.project(t, "Kiểm tra")
	rev := strconv.FormatInt(x.projectRevision(t, id), 10)
	update := func(extra string) error {
		_, err := callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`"`+extra+`}`)
		return err
	}
	for extra, want := range map[string]string{
		``:                                      "revision is required",
		`,"revision":0`:                         "revision is required",
		`,"revision":` + rev + `,"title":null`:  "title cannot be null; send a value",
		`,"revision":` + rev + `,"status":null`: "status cannot be null; send a value",
		`,"revision":` + rev + `,"priority":null`:      "priority cannot be null; send a value",
		`,"revision":` + rev + `,"description":null`:   `description cannot be null; send "" to clear it`,
		`,"revision":` + rev + `,"status":"open"`:      "status must be one of planned, in_progress",
		`,"revision":` + rev + `,"priority":"asap"`:    "priority must be one of none, low",
		`,"revision":` + rev + `,"lead_id":" "`:        "lead_id must not be blank; send null to clear it",
		`,"revision":` + rev + `,"due_date":"1/12/26"`: "due_date must be a date",
		`,"revision":` + rev + `,"start_date":""`:      "start_date must be a date",
		`,"revision":` + rev + `,"title":"  "`:         "title must be 1-200 characters",
	} {
		var bad McpInvalidArgs
		if err := update(extra); !errors.As(err, &bad) || !strings.HasPrefix(bad.Msg, want) {
			t.Errorf("update_project %s: %v, want %q", extra, err, want)
		}
	}
	if strconv.FormatInt(x.projectRevision(t, id), 10) != rev {
		t.Fatal("a refused update wrote")
	}
	for input, want := range map[string]string{
		`"title":" "`:                           "title must be 1-200 characters",
		`"title":"A","status":"open"`:           "status must be one of planned",
		`"title":"A","priority":"asap"`:         "priority must be one of none",
		`"title":"A","lead_id":" "`:             "lead_id must not be blank",
		`"title":"A","start_date":"2026-13-01"`: "start_date must be a date",
		`"title":"A","description":"` + strings.Repeat("ạ", mcpMaxItemRunes+1) + `"`: "description holds at most " + strconv.Itoa(mcpMaxItemRunes),
	} {
		_, err := callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`",`+input+`}`)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.HasPrefix(bad.Msg, want) {
			t.Errorf("create_project %s: %v, want %q", tail(input, 60), err, want)
		}
	}
	// A lead outside the workspace is named in words a model can act on, the
	// same for a person of another organization as for an id nobody has.
	for _, lead := range []string{x.ub.ID, util.NewID()} {
		_, err := callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"Người lạ","lead_id":"`+lead+`"}`)
		var te McpToolError
		if !errors.As(err, &te) || te.Code != "lead_not_member" || !strings.Contains(te.Msg, "list_members") {
			t.Errorf("lead %s: %v, want lead_not_member", lead, err)
		}
	}
}

// Undo holds for a project description as for a task's: from is the whole old
// text, and a description too long to put back is never replaced here.
func TestMcpUpdateProjectDescriptionUndo(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	long := strings.Repeat("Dòng **một**.\n", 357) + "Hết"
	if n := utf8.RuneCountInString(long); n < 5000 || n > mcpMaxItemRunes {
		t.Fatalf("fixture is %d characters", n)
	}
	p, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Mô tả dài", Description: &long})
	if err != nil {
		t.Fatal(err)
	}
	update := func(extra string) (json.RawMessage, error) {
		t.Helper()
		return callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+p.ID+`","revision":`+strconv.FormatInt(x.projectRevision(t, p.ID), 10)+extra+`}`)
	}
	raw, err := update(`,"description":"Ngắn"`)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if len(res.Changes) != 1 || res.Changes[0].Field != "description" || res.Changes[0].From != long || res.Changes[0].To != "Ngắn" {
		t.Fatalf("description change is cut or missing: %d changes", len(res.Changes))
	}
	b, _ := json.Marshal(long)
	if _, err := update(`,"description":` + string(b)); err != nil {
		t.Fatal(err)
	}
	if got, _ := x.tools.ask.tasks.GetProject(ctx, Human(x.ua.ID), x.w.ID, p.ID); got.Description != long {
		t.Fatal("sending from back did not restore the description")
	}

	tooLong := strings.Repeat("ạ", mcpMaxItemRunes+1)
	var bad McpInvalidArgs
	if _, err := update(`,"description":"` + tooLong + `"`); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "description") {
		t.Fatalf("a new description over the limit: %v, want McpInvalidArgs", err)
	}
	if _, err := x.tools.ask.tasks.UpdateProject(ctx, Human(x.ua.ID), x.w.ID, p.ID, UpdateProjectInput{ExpectedRevision: x.projectRevision(t, p.ID), Description: &tooLong}); err != nil {
		t.Fatal(err)
	}
	before := x.projectRevision(t, p.ID)
	if _, err := update(`,"title":"Đổi tên","description":"Ngắn"`); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "edit it in UniWork") {
		t.Fatalf("replacing a description over the limit: %v, want McpInvalidArgs", err)
	}
	if x.projectRevision(t, p.ID) != before {
		t.Fatal("a refused description replace wrote")
	}
	if _, err := update(`,"title":"Đổi tên"`); err != nil {
		t.Fatalf("a call that leaves the long description alone: %v", err)
	}
}

// create_project never opens a chat channel, even where the service would on
// request (spec §5.2).
func TestMcpCreateProjectOpensNoChatChannel(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	x.tools.ask.tasks.Chat = x.tools.ask.chat
	channels := func(projectID string) (n int) {
		t.Helper()
		if err := x.tools.ask.pool.QueryRow(ctx, `SELECT count(*) FROM chat_rooms WHERE project_id = $1`, projectID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	control, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Có kênh", CreateChannel: true})
	if err != nil || channels(control.ID) != 1 {
		t.Fatalf("control: the service opens a channel on request (%v)", err)
	}
	raw, err := callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"Không kênh"}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, item := writeResult(t, raw); channels(fmt.Sprint(item["id"])) != 0 {
		t.Fatal("create_project opened a chat channel")
	}
}

// A project led by an agent keeps its lead: the tools set people only, so an
// agent replaced or cleared here could not be put back by sending from. The
// call is refused and nothing is written.
func TestMcpUpdateProjectLeavesAnAgentLeadAlone(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	agent, err := x.tools.q.CreateAgent(ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: x.w.OrganizationID, Name: "Trợ lý", Handle: "tro-ly",
		OwnerUserID: x.ua.ID, AutonomyPolicy: "{}", CreatedBy: x.ua.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := x.tools.q.AddWorkspaceAgentMember(ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: x.w.ID, AgentID: agent.ID, OrganizationID: x.w.OrganizationID, CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	id := x.project(t, "Do agent phụ trách")
	// The way PATCH /projects/{id} sets it: lead_type and lead_id together.
	agentType, agentID := "agent", agent.ID
	lt, lid := &agentType, &agentID
	if _, err := x.tools.ask.tasks.UpdateProject(ctx, Human(x.ua.ID), x.w.ID, id, UpdateProjectInput{ExpectedRevision: x.projectRevision(t, id), LeadType: &lt, LeadID: &lid}); err != nil {
		t.Fatal(err)
	}
	rev := strconv.FormatInt(x.projectRevision(t, id), 10)
	for _, lead := range []string{`"` + x.ua.ID + `"`, `null`} {
		_, err := callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+rev+`,"title":"Đổi","lead_id":`+lead+`}`)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "led by an agent") {
			t.Errorf("lead_id %s on an agent-led project: %v, want McpInvalidArgs", lead, err)
		}
	}
	if now, _ := x.tools.ask.tasks.GetProject(ctx, Human(x.ua.ID), x.w.ID, id); strconv.FormatInt(now.Revision, 10) != rev || now.LeadID.String != agent.ID || now.Title != "Do agent phụ trách" {
		t.Fatalf("a refused lead change wrote: %+v", now)
	}
	// A call that leaves the lead alone goes through and keeps it.
	raw, err := callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+rev+`,"title":"Đổi"}`)
	if err != nil {
		t.Fatal(err)
	}
	if res, item := writeResult(t, raw); item["lead_id"] != agent.ID || len(res.Changes) != 1 || res.Changes[0].Field != "title" {
		t.Fatalf("update_project = %s", raw)
	}
}

// The project tools offer the task priorities, in that order; the project
// service accepts exactly that set, and the schemas list it.
func TestMcpProjectPrioritiesAreTheServices(t *testing.T) {
	if got, want := slices.Sorted(slices.Values(mcpPriorities)), slices.Sorted(slices.Values(validProjectPriorities)); !slices.Equal(got, want) {
		t.Fatalf("mcpPriorities %v, project service accepts %v", got, want)
	}
	for name, schema := range map[string]json.RawMessage{"create_project": mcpSchemaCreateProject, "update_project": mcpSchemaUpdateProject} {
		var s struct {
			Properties struct {
				Priority struct{ Enum []string }
			}
		}
		if err := json.Unmarshal(schema, &s); err != nil || !slices.Equal(s.Properties.Priority.Enum, mcpPriorities) {
			t.Errorf("%s priority enum = %v (%v), want %v", name, s.Properties.Priority.Enum, err, mcpPriorities)
		}
	}
}
