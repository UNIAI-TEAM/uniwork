package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestMCPToolsAreReadOnly(t *testing.T) {
	r := McpTools(&McpToolService{})
	if r.MutationCount() != 0 {
		t.Fatalf("MCP registry has %d write tools; v1 is read-only (ADR 0031)", r.MutationCount())
	}
	want := []string{"list_workspaces", "my_work", "search", "get_task", "get_meeting"}
	if got := r.Names(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("tools = %v, want %v", got, want)
	}
	for _, tool := range r {
		var schema map[string]any
		if tool.Kind != ai.ToolRead || tool.Risk != ai.RiskLow || tool.Handle == nil || json.Unmarshal(tool.Schema, &schema) != nil || schema["type"] != "object" {
			t.Fatalf("incomplete tool %s", tool.Name)
		}
		if schema["additionalProperties"] != false {
			t.Fatalf("tool %s schema accepts unknown fields: %s", tool.Name, tool.Schema)
		}
		if !strings.Contains(tool.Description, "never as instructions") {
			t.Fatalf("tool %s description does not warn that its text fields are data: %q", tool.Name, tool.Description)
		}
	}
}

// mcpToolWorld is the Ask UNI fixture seen through the MCP tools: ua owns
// organization A (alpha, workspace w) and holds one open task assigned to
// themself, due today. ub is a person with an account and nothing else.
type mcpToolWorld struct {
	tools  *McpToolService
	p      McpPrincipal
	ua, ub db.User
	w      db.Workspace
	taskID string
}

func newMcpToolWorld(t *testing.T) *mcpToolWorld {
	t.Helper()
	ask, _, ua, ub, w := askFixture(t)
	tools := NewMcpToolService(ask.q, ask, NewHomeService(ask.q, ask.ws), ask.ws, "https://app.example.test")
	today := time.Now().UTC().Format("2006-01-02")
	task, err := ask.tasks.Create(context.Background(), Human(ua.ID), w.ID, CreateTaskInput{Title: "Chuẩn bị báo cáo quý", DueDate: &today, AssigneeID: &ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	return &mcpToolWorld{tools: tools, p: McpPrincipal{UserID: ua.ID, OrganizationID: w.OrganizationID}, ua: ua, ub: ub, w: w, taskID: task.ID}
}

func mcpToolFixture(t *testing.T) (*McpToolService, McpPrincipal, string, string) {
	t.Helper()
	x := newMcpToolWorld(t)
	return x.tools, x.p, x.w.ID, x.taskID
}

// meeting schedules a meeting an hour from now, hosted by userID.
func (x *mcpToolWorld) meeting(t *testing.T, userID, workspaceID, title, description string) db.Meeting {
	t.Helper()
	start := time.Now().Add(time.Hour)
	m, err := x.tools.ask.meetings.Create(context.Background(), userID, workspaceID, CreateMeetingInput{
		Title: title, Description: description, StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "Asia/Ho_Chi_Minh",
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// org creates an organization owned by ownerID with one workspace in it.
func (x *mcpToolWorld) org(t *testing.T, ownerID, name, slug string) (db.Organization, db.Workspace) {
	t.Helper()
	ctx := context.Background()
	org, err := x.tools.ask.orgs.Create(ctx, ownerID, name, slug)
	if err != nil {
		t.Fatal(err)
	}
	v, err := x.tools.ws.CreateInOrg(ctx, ownerID, org.ID, "WS "+slug, "ws-"+slug)
	if err != nil {
		t.Fatal(err)
	}
	return org, v.Workspace
}

func (x *mcpToolWorld) task(t *testing.T, userID, workspaceID, title string) db.Task {
	t.Helper()
	task, err := x.tools.ask.tasks.Create(context.Background(), Human(userID), workspaceID, CreateTaskInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

// callMcpTool runs one tool through the registry, the way the /mcp handler will: only
// the principal's user and organization cross into ToolContext.
func callMcpTool(t *testing.T, tools *McpToolService, p McpPrincipal, name, input string) (json.RawMessage, error) {
	t.Helper()
	tool, ok := McpTools(tools).Get(name)
	if !ok {
		t.Fatalf("no tool %q", name)
	}
	return tool.Handle(context.Background(), ai.ToolContext{ActorID: p.UserID, OrganizationID: p.OrganizationID}, json.RawMessage(input))
}

func TestMcpToolsReadOwnWork(t *testing.T) {
	tools, p, wsID, taskID := mcpToolFixture(t)
	ctx := context.Background()
	wss, err := tools.ListWorkspaces(ctx, p)
	if err != nil || len(wss) == 0 || !strings.HasPrefix(wss[0].URL, "https://app.example.test/") {
		t.Fatalf("workspaces = %+v, %v", wss, err)
	}
	work, err := tools.MyWork(ctx, p, "")
	if err != nil || len(work.Tasks) == 0 || work.Tasks[0].ID != taskID || !strings.Contains(work.Tasks[0].URL, "/tasks/"+taskID) {
		t.Fatalf("my work = %+v, %v", work, err)
	}
	found, err := tools.Search(ctx, p, wsID, "báo cáo")
	if err != nil || len(found) == 0 || found[0].Kind != "task" || found[0].WorkspaceID != wsID {
		t.Fatalf("search = %+v, %v", found, err)
	}
	item, err := tools.GetTask(ctx, p, wsID, taskID)
	if err != nil || item.Title != "Chuẩn bị báo cáo quý" || !strings.HasPrefix(item.URL, "https://app.example.test/") {
		t.Fatalf("get task = %+v, %v", item, err)
	}
}

// Every field a model may build on, spelled out: the ids and links are the
// ones a screen uses, the dates are the ones the person sees.
func TestMcpToolsShapeEveryItem(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	today := time.Now().UTC().Format("2006-01-02")
	meeting := x.meeting(t, x.ua.ID, x.w.ID, "Họp kế hoạch quý", "Chốt mục tiêu quý")
	taskURL := "https://app.example.test/org-alpha/alpha/tasks/" + x.taskID
	meetingURL := "https://app.example.test/org-alpha/alpha/meetings/" + meeting.ID

	wss, err := x.tools.ListWorkspaces(ctx, x.p)
	if err != nil || len(wss) != 1 || wss[0] != (McpWorkspace{ID: x.w.ID, Name: "Alpha", URL: "https://app.example.test/org-alpha/alpha"}) {
		t.Fatalf("workspaces = %+v, %v", wss, err)
	}

	for name, workspaceID := range map[string]string{"one workspace": x.w.ID, "every workspace": ""} {
		work, err := x.tools.MyWork(ctx, x.p, workspaceID)
		if err != nil || work.Truncated || len(work.Partial) != 0 || len(work.Tasks) != 1 || len(work.Meetings) != 1 {
			t.Fatalf("%s: my work = %+v, %v", name, work, err)
		}
		if got := work.Tasks[0]; got != (McpItem{Kind: "task", ID: x.taskID, WorkspaceID: x.w.ID, Title: "Chuẩn bị báo cáo quý", URL: taskURL, Status: got.Status, DueDate: today}) || got.Status == "" {
			t.Fatalf("%s: task = %+v", name, got)
		}
		got := work.Meetings[0]
		wantStart := meeting.StartsAt.Time.UTC().Format("2006-01-02T15:04:05Z")
		if got.Kind != "meeting" || got.ID != meeting.ID || got.WorkspaceID != x.w.ID || got.Title != "Họp kế hoạch quý" || got.URL != meetingURL || got.StartsAt != wantStart || got.Status == "" || got.DueDate != "" {
			t.Fatalf("%s: meeting = %+v, want starts_at %s", name, got, wantStart)
		}
	}

	found, err := x.tools.Search(ctx, x.p, x.w.ID, "kế hoạch báo cáo")
	if err != nil || len(found) != 2 {
		t.Fatalf("search = %+v, %v", found, err)
	}
	for _, it := range found {
		switch it.Kind {
		case "task":
			if it.ID != x.taskID || it.URL != taskURL || it.WorkspaceID != x.w.ID || it.Title != "Chuẩn bị báo cáo quý" || !strings.Contains(it.Excerpt, "Hạn: "+today) {
				t.Fatalf("search task = %+v", it)
			}
		case "meeting":
			if it.ID != meeting.ID || it.URL != meetingURL || it.WorkspaceID != x.w.ID || !strings.Contains(it.Excerpt, "Chốt mục tiêu quý") {
				t.Fatalf("search meeting = %+v", it)
			}
		default:
			t.Fatalf("search returned a %q item: %+v", it.Kind, it)
		}
	}

	// A comment reaches get_task; a summary reaches get_meeting; both arrive in
	// the excerpt of the one item.
	if _, err := x.tools.ask.tasks.AddComment(ctx, Human(x.ua.ID), x.taskID, "Đã gửi bản nháp cho sếp"); err != nil {
		t.Fatal(err)
	}
	task, err := x.tools.GetTask(ctx, x.p, x.w.ID, x.taskID)
	if err != nil || task.Kind != "task" || task.ID != x.taskID || task.URL != taskURL || !strings.Contains(task.Excerpt, "Đã gửi bản nháp cho sếp") {
		t.Fatalf("get task = %+v, %v", task, err)
	}
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: meeting.ID, Summary: "Đã chốt OKR quý", Decisions: "Giữ ngân sách", ActionItems: "Gửi biên bản",
		Model: "fake", CreatedBy: x.ua.ID, OrganizationID: x.w.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
	mt, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, meeting.ID)
	if err != nil || mt.Kind != "meeting" || mt.ID != meeting.ID || mt.URL != meetingURL || mt.WorkspaceID != x.w.ID ||
		!strings.Contains(mt.Excerpt, "Tóm tắt: Đã chốt OKR quý") || !strings.Contains(mt.Excerpt, "Giữ ngân sách") || !strings.Contains(mt.Excerpt, "Gửi biên bản") {
		t.Fatalf("get meeting = %+v, %v", mt, err)
	}
}

func TestMcpToolsValidateInput(t *testing.T) {
	tools, p, wsID, _ := mcpToolFixture(t)
	ctx := context.Background()
	var bad McpInvalidArgs
	if _, err := tools.Search(ctx, p, wsID, "  "); !errors.As(err, &bad) {
		t.Fatalf("empty query: %v", err)
	}
	if _, err := tools.Search(ctx, p, wsID, strings.Repeat("a", 201)); !errors.As(err, &bad) {
		t.Fatalf("long query: %v", err)
	}
	reg := McpTools(tools)
	tc := ai.ToolContext{ActorID: p.UserID, OrganizationID: p.OrganizationID}
	if _, err := reg[2].Handle(ctx, tc, json.RawMessage(`{"workspace_id":"x","query":"a","extra":1}`)); !errors.As(err, &bad) {
		t.Fatalf("unknown field: %v", err)
	}
}

// What a model gets wrong, tool by tool: every one is a fixable
// McpInvalidArgs, never ErrNotFound (a typo must not read as "no such task"),
// never a panic, and never a read.
func TestMcpToolsRefuseMalformedArguments(t *testing.T) {
	tools, p, wsID, taskID := mcpToolFixture(t)
	var bad McpInvalidArgs
	for _, tc := range []struct{ tool, input string }{
		{"list_workspaces", `{"workspace_id":"x"}`},
		{"list_workspaces", `[]`},
		{"list_workspaces", `"x"`},
		{"my_work", `{"query":"x"}`},
		{"my_work", `{"workspace_id":5}`},
		{"search", `{"query":"báo cáo"}`},
		{"search", `{"workspace_id":"` + wsID + `"}`},
		{"search", `{"workspace_id":"` + wsID + `","query":"   "}`},
		{"search", `{"workspace_id":"` + wsID + `","query":"` + strings.Repeat("a", 201) + `"}`},
		{"search", `{"workspace_id":"","query":"báo cáo"}`},
		{"search", `{"workspace_id":"` + wsID + `","query":["báo cáo"]}`},
		{"search", `{"workspace_id":"` + wsID + `","query":"x","task_id":"y"}`},
		{"get_task", `{"workspace_id":"` + wsID + `"}`},
		{"get_task", `{"task_id":"` + taskID + `"}`},
		{"get_task", `{"workspace_id":"` + wsID + `","task_id":"  "}`},
		{"get_task", `{"workspace_id":"` + wsID + `","meeting_id":"` + taskID + `"}`},
		{"get_task", `not json`},
		{"get_meeting", `{"workspace_id":"` + wsID + `"}`},
		{"get_meeting", `{"workspace_id":"` + wsID + `","task_id":"` + taskID + `"}`},
		{"get_meeting", `{"workspace_id":"` + wsID + `","meeting_id":null,"extra":true}`},
	} {
		if out, err := callMcpTool(t, tools, p, tc.tool, tc.input); !errors.As(err, &bad) || out != nil {
			t.Errorf("%s %s: out=%s err=%v; want McpInvalidArgs", tc.tool, tc.input, out, err)
		}
	}

	// An absent or null argument object is the same as an empty one.
	for _, input := range []string{``, `null`, `{}`, `  `} {
		if _, err := callMcpTool(t, tools, p, "list_workspaces", input); err != nil {
			t.Errorf("list_workspaces %q: %v", input, err)
		}
		if _, err := callMcpTool(t, tools, p, "my_work", input); err != nil {
			t.Errorf("my_work %q: %v", input, err)
		}
	}

	// A query counts characters, not bytes: 200 two-byte letters are allowed.
	if _, err := tools.Search(context.Background(), p, wsID, strings.Repeat("ạ", 200)); err != nil {
		t.Errorf("200 characters: %v", err)
	}
	if _, err := tools.Search(context.Background(), p, wsID, strings.Repeat("ạ", 201)); !errors.As(err, &bad) {
		t.Errorf("201 characters: %v", err)
	}
}

// The grant names one organization; a workspace of another organization the
// same person belongs to is not reachable through it (spec §7.3).
func TestMcpToolsStayInGrantOrganization(t *testing.T) {
	tools, p, wsID, _ := mcpToolFixture(t)
	ctx := context.Background()
	orgB, err := tools.ask.orgs.Create(ctx, p.UserID, "Org B", "org-b-mcp")
	if err != nil {
		t.Fatal(err)
	}
	vB, err := tools.ws.CreateInOrg(ctx, p.UserID, orgB.ID, "WS B", "ws-b-mcp")
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := tools.ask.tasks.Create(ctx, Human(p.UserID), vB.Workspace.ID, CreateTaskInput{Title: "Bí mật của B"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tools.Search(ctx, p, vB.Workspace.ID, "bí mật"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("search in another org: %v", err)
	}
	if _, err := tools.GetTask(ctx, p, vB.Workspace.ID, taskB.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get task in another org: %v", err)
	}
	if _, err := tools.GetTask(ctx, p, wsID, taskB.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("task of another workspace under an allowed workspace id: %v", err)
	}
	if _, err := tools.MyWork(ctx, p, vB.Workspace.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("my work in another org: %v", err)
	}
	wss, _ := tools.ListWorkspaces(ctx, p)
	for _, w := range wss {
		if w.ID == vB.Workspace.ID {
			t.Fatal("list_workspaces leaked a workspace of another organization")
		}
	}
}

// The same person belongs to A and B and the grant is for A. Every tool, each
// entry point (service method and registry handler), answers ErrNotFound for B:
// the workspace, a task or meeting of it, and B's ids under A's workspace id.
// "Not a member" would be a different answer; this one is "not there".
func TestMcpToolsOfAGrantNeverReachAnotherOrganizationOfTheSamePerson(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, wsB := x.org(t, x.ua.ID, "Org B", "org-b-mcp")
	taskB := x.task(t, x.ua.ID, wsB.ID, "Bí mật của B")
	meetingB := x.meeting(t, x.ua.ID, wsB.ID, "Họp bí mật của B", "chỉ B biết")
	// The control: the same person, with a grant for B, reads all of it.
	pB := McpPrincipal{UserID: x.ua.ID, OrganizationID: wsB.OrganizationID}
	if it, err := x.tools.GetTask(ctx, pB, wsB.ID, taskB.ID); err != nil || it.Title != "Bí mật của B" {
		t.Fatalf("control: grant for B reads B's task: %+v, %v", it, err)
	}
	if it, err := x.tools.GetMeeting(ctx, pB, wsB.ID, meetingB.ID); err != nil || it.Title != "Họp bí mật của B" {
		t.Fatalf("control: grant for B reads B's meeting: %+v, %v", it, err)
	}
	if found, err := x.tools.Search(ctx, pB, wsB.ID, "bí mật"); err != nil || len(found) != 2 {
		t.Fatalf("control: grant for B searches B: %+v, %v", found, err)
	}

	type probe struct {
		name string
		run  func() error
	}
	probes := []probe{
		{"Search B", func() error { _, err := x.tools.Search(ctx, x.p, wsB.ID, "bí mật"); return err }},
		{"GetTask B/B", func() error { _, err := x.tools.GetTask(ctx, x.p, wsB.ID, taskB.ID); return err }},
		{"GetTask A/B", func() error { _, err := x.tools.GetTask(ctx, x.p, x.w.ID, taskB.ID); return err }},
		{"GetMeeting B/B", func() error { _, err := x.tools.GetMeeting(ctx, x.p, wsB.ID, meetingB.ID); return err }},
		{"GetMeeting A/B", func() error { _, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, meetingB.ID); return err }},
		{"MyWork B", func() error { _, err := x.tools.MyWork(ctx, x.p, wsB.ID); return err }},
		{"search tool", func() error {
			_, err := callMcpTool(t, x.tools, x.p, "search", `{"workspace_id":"`+wsB.ID+`","query":"bí mật"}`)
			return err
		}},
		{"get_task tool", func() error {
			_, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+wsB.ID+`","task_id":"`+taskB.ID+`"}`)
			return err
		}},
		{"get_meeting tool", func() error {
			_, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+wsB.ID+`","meeting_id":"`+meetingB.ID+`"}`)
			return err
		}},
		{"my_work tool", func() error {
			_, err := callMcpTool(t, x.tools, x.p, "my_work", `{"workspace_id":"`+wsB.ID+`"}`)
			return err
		}},
	}
	for _, pr := range probes {
		if err := pr.run(); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: %v; want ErrNotFound", pr.name, err)
		}
	}

	// A workspace that does not exist answers the same way, so the two cannot
	// be told apart.
	if _, err := x.tools.Search(ctx, x.p, "01NOSUCHWORKSPACE", "bí mật"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown workspace: %v", err)
	}

	// The aggregate view and the list stay inside A, and never carry B's rows.
	work, err := x.tools.MyWork(ctx, x.p, "")
	if err != nil {
		t.Fatal(err)
	}
	wss, err := x.tools.ListWorkspaces(ctx, x.p)
	if err != nil || len(wss) != 1 || wss[0].ID != x.w.ID {
		t.Fatalf("list_workspaces = %+v, %v; want only workspace A", wss, err)
	}
	for _, it := range append(work.Tasks, work.Meetings...) {
		if it.WorkspaceID != x.w.ID {
			t.Fatalf("my_work reached outside the grant's organization: %+v", it)
		}
	}
	raw, err := callMcpTool(t, x.tools, x.p, "my_work", ``)
	if err != nil || strings.Contains(string(raw), "bí mật") || strings.Contains(string(raw), wsB.ID) {
		t.Fatalf("my_work output mentions B: %s %v", raw, err)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "list_workspaces", ``)
	if err != nil || strings.Contains(string(raw), wsB.ID) || strings.Contains(string(raw), "org-b-mcp") {
		t.Fatalf("list_workspaces output mentions B: %s %v", raw, err)
	}
}

// A person who is not in organization B at all sees B exactly as a person who
// is: ErrNotFound for its workspace, and for B's task and meeting ids under A's
// workspace id. The services under the tools answer 403 for those (the person
// is no member of B's workspace); a tool must not turn that into a way to learn
// that an id exists.
func TestMcpToolsDoNotRevealRowsOfOrganizationsTheUserIsNotIn(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, wsC := x.org(t, x.ub.ID, "Org C", "org-c-mcp")
	taskC := x.task(t, x.ub.ID, wsC.ID, "Chỉ C biết")
	meetingC := x.meeting(t, x.ub.ID, wsC.ID, "Họp của C", "kín")

	for _, id := range []struct{ name, task, meeting string }{
		{"existing ids of C", taskC.ID, meetingC.ID},
		{"ids that exist nowhere", "01NOSUCHTASK", "01NOSUCHMEETING"},
	} {
		for _, workspaceID := range []string{x.w.ID, wsC.ID} {
			if _, err := x.tools.GetTask(ctx, x.p, workspaceID, id.task); !errors.Is(err, ErrNotFound) {
				t.Errorf("GetTask(%s, %s): %v; want ErrNotFound", workspaceID, id.name, err)
			}
			if _, err := x.tools.GetMeeting(ctx, x.p, workspaceID, id.meeting); !errors.Is(err, ErrNotFound) {
				t.Errorf("GetMeeting(%s, %s): %v; want ErrNotFound", workspaceID, id.name, err)
			}
		}
	}
	if _, err := x.tools.Search(ctx, x.p, wsC.ID, "kín"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Search in C: %v", err)
	}
	if _, err := x.tools.MyWork(ctx, x.p, wsC.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("MyWork in C: %v", err)
	}
}

// Inside the grant's organization the person still sees only what a screen
// shows them. A task of workspace 2, asked for under workspace 1's id, is not
// found — for the owner (who may read both workspaces) and for a plain member of
// workspace 1 (who may not read workspace 2 at all).
func TestMcpToolsDoNotCrossWorkspacesInsideTheOrganization(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	ws2 := v2.Workspace
	task2 := x.task(t, x.ua.ID, ws2.ID, "Việc của workspace hai")
	meeting2 := x.meeting(t, x.ua.ID, ws2.ID, "Họp workspace hai", "hai")

	// ub: member of organization A and of workspace 1 only.
	addOrgMember(t, x.tools.q, x.w.OrganizationID, x.ub.ID)
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	pUB := McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}

	for who, p := range map[string]McpPrincipal{"owner": x.p, "member of workspace 1": pUB} {
		if _, err := x.tools.GetTask(ctx, p, x.w.ID, task2.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: task of workspace 2 under workspace 1: %v", who, err)
		}
		if _, err := x.tools.GetMeeting(ctx, p, x.w.ID, meeting2.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: meeting of workspace 2 under workspace 1: %v", who, err)
		}
		if _, err := x.tools.GetTask(ctx, p, x.w.ID, x.taskID); err != nil {
			t.Errorf("%s: control, task of workspace 1 under workspace 1: %v", who, err)
		}
	}
	// The owner reads workspace 2 under its own id; the member is not found.
	if it, err := x.tools.GetTask(ctx, x.p, ws2.ID, task2.ID); err != nil || it.WorkspaceID != ws2.ID {
		t.Errorf("owner reads workspace 2: %+v, %v", it, err)
	}
	if _, err := x.tools.GetTask(ctx, pUB, ws2.ID, task2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("member of workspace 1 reads task of workspace 2: %v", err)
	}
	if _, err := x.tools.GetMeeting(ctx, pUB, ws2.ID, meeting2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("member of workspace 1 reads meeting of workspace 2: %v", err)
	}
	if _, err := x.tools.Search(ctx, pUB, ws2.ID, "hai"); !errors.Is(err, ErrNotFound) {
		t.Errorf("member of workspace 1 searches workspace 2: %v", err)
	}
	if _, err := x.tools.MyWork(ctx, pUB, ws2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("member of workspace 1 reads my work of workspace 2: %v", err)
	}
	wss, err := x.tools.ListWorkspaces(ctx, pUB)
	if err != nil || len(wss) != 1 || wss[0].ID != x.w.ID {
		t.Errorf("member of workspace 1 lists %+v, %v; want workspace 1 only", wss, err)
	}
	// The unknown-id answer is the same one.
	if _, err := x.tools.GetTask(ctx, pUB, x.w.ID, "01NOSUCHTASK"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown task: %v", err)
	}
}

// A principal with no organization (a ToolContext someone forgot to fill) gets
// nothing: the confinement fails closed instead of matching "".
func TestMcpToolsFailClosedWithoutAnOrganization(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	p := McpPrincipal{UserID: x.ua.ID}
	if wss, err := x.tools.ListWorkspaces(ctx, p); err != nil || len(wss) != 0 {
		t.Fatalf("list_workspaces = %+v, %v", wss, err)
	}
	if work, err := x.tools.MyWork(ctx, p, ""); err != nil || len(work.Tasks)+len(work.Meetings) != 0 {
		t.Fatalf("my_work = %+v, %v", work, err)
	}
	for name, run := range map[string]func() error{
		"search":      func() error { _, err := x.tools.Search(ctx, p, x.w.ID, "báo cáo"); return err },
		"get_task":    func() error { _, err := x.tools.GetTask(ctx, p, x.w.ID, x.taskID); return err },
		"get_meeting": func() error { _, err := x.tools.GetMeeting(ctx, p, x.w.ID, "01X"); return err },
		"my_work":     func() error { _, err := x.tools.MyWork(ctx, p, x.w.ID); return err },
	} {
		if err := run(); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s without an organization: %v", name, err)
		}
	}
}

// my_work reads what the home screen reads, for the whole organization or one
// workspace: only the person's open tasks, never someone else's or a finished
// one, and it says when the answer is cut.
func TestMcpMyWorkCoversTheOrganizationAndSaysWhenItIsCut(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Aaa first", "aaa-first")
	if err != nil {
		t.Fatal(err)
	}
	ws2 := v2.Workspace
	assign := func(workspaceID, title string, assignee string) db.Task {
		task, err := x.tools.ask.tasks.Create(ctx, Human(x.ua.ID), workspaceID, CreateTaskInput{Title: title, AssigneeID: &assignee})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	mine2 := assign(ws2.ID, "Việc của tôi ở hai", x.ua.ID)
	x.task(t, x.ua.ID, x.w.ID, "Không ai nhận")
	done := assign(x.w.ID, "Việc đã xong", x.ua.ID)
	status := "done"
	if _, err := x.tools.ask.tasks.Update(ctx, Human(x.ua.ID), done.ID, UpdateTaskInput{Status: &status}); err != nil {
		t.Fatal(err)
	}

	work, err := x.tools.MyWork(ctx, x.p, "")
	if err != nil || work.Truncated {
		t.Fatalf("my work = %+v, %v", work, err)
	}
	got := map[string]string{}
	for _, it := range work.Tasks {
		got[it.ID] = it.WorkspaceID
	}
	if len(got) != 2 || got[x.taskID] != x.w.ID || got[mine2.ID] != ws2.ID {
		t.Fatalf("tasks = %+v; want the two open tasks assigned to the person, one per workspace", work.Tasks)
	}
	only, err := x.tools.MyWork(ctx, x.p, ws2.ID)
	if err != nil || len(only.Tasks) != 1 || only.Tasks[0].ID != mine2.ID {
		t.Fatalf("one workspace: %+v, %v", only, err)
	}

	// More open tasks than one answer carries: the first mcpMaxResults come
	// back, most urgent first, and the answer says it is cut.
	for i := 0; i < mcpMaxResults; i++ {
		assign(x.w.ID, fmt.Sprintf("Việc thêm %02d", i), x.ua.ID)
	}
	cut, err := x.tools.MyWork(ctx, x.p, x.w.ID)
	if err != nil || len(cut.Tasks) != mcpMaxResults || !cut.Truncated {
		t.Fatalf("cut: %d tasks, truncated=%v, %v", len(cut.Tasks), cut.Truncated, err)
	}
	if raw, err := callMcpTool(t, x.tools, x.p, "my_work", `{"workspace_id":"`+x.w.ID+`"}`); err != nil || !strings.Contains(string(raw), `"truncated":true`) {
		t.Fatalf("my_work output does not carry truncated: %s %v", raw, err)
	}
}

// The home screen lists at most ten meetings and counts only today's, so a
// full list is a list that may be cut, and the answer says so.
func TestMcpMyWorkSaysWhenTheMeetingListIsFull(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	for i := 0; i < mcpMaxMeetings-1; i++ {
		x.meeting(t, x.ua.ID, x.w.ID, fmt.Sprintf("Họp %02d", i), "")
	}
	work, err := x.tools.MyWork(ctx, x.p, x.w.ID)
	if err != nil || len(work.Meetings) != mcpMaxMeetings-1 || work.Truncated {
		t.Fatalf("nine meetings: %d listed, truncated=%v, %v", len(work.Meetings), work.Truncated, err)
	}
	x.meeting(t, x.ua.ID, x.w.ID, "Họp cuối", "")
	work, err = x.tools.MyWork(ctx, x.p, x.w.ID)
	if err != nil || len(work.Meetings) != mcpMaxMeetings || !work.Truncated {
		t.Fatalf("ten meetings: %d listed, truncated=%v, %v", len(work.Meetings), work.Truncated, err)
	}
}

// More workspaces than one answer combines: the first ten by name, and the
// answer says it is cut.
func TestMcpMyWorkCombinesAtMostTenWorkspaces(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	// Rows are written directly: the plan's workspaces.max meter would refuse
	// the tenth CreateInOrg, and the quota is not what this test is about.
	for i := 0; i < mcpMaxWorkspaces; i++ { // plus the fixture's: eleven in all
		w, err := x.tools.q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
			ID: util.NewID(), OrganizationID: x.w.OrganizationID, Slug: fmt.Sprintf("extra-%02d", i), Name: fmt.Sprintf("Extra %02d", i), CreatedBy: x.ua.ID,
		})
		if err != nil {
			t.Fatalf("workspace %d: %v", i, err)
		}
		if err := x.tools.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: x.ua.ID, Role: "owner"}); err != nil {
			t.Fatalf("membership %d: %v", i, err)
		}
	}
	work, err := x.tools.MyWork(ctx, x.p, "")
	if err != nil || !work.Truncated {
		t.Fatalf("eleven workspaces: truncated=%v, %v", work.Truncated, err)
	}
	// "Alpha" sorts before "Extra ..", so it is inside the first ten.
	if len(work.Tasks) != 1 || work.Tasks[0].ID != x.taskID {
		t.Fatalf("tasks = %+v", work.Tasks)
	}
	wss, err := x.tools.ListWorkspaces(ctx, x.p)
	if err != nil || len(wss) != mcpMaxWorkspaces+1 {
		t.Fatalf("list_workspaces = %d entries, %v; the list itself is not cut", len(wss), err)
	}
}

// Ask UNI adds chat and members to its search; the connector stops at tasks
// and meetings because chat is other people's words (spec §2).
func TestMcpSearchReadsTasksAndMeetingsOnly(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	room, err := x.tools.ask.chat.CreateChannel(ctx, x.ua.ID, x.w.ID, CreateChannelInput{Name: "ke-hoach", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.ask.chat.SendRoomMessage(ctx, x.ua.ID, x.w.ID, room.ID, SendChatMessageInput{Body: "sprint bí mật của đội"}); err != nil {
		t.Fatal(err)
	}
	x.task(t, x.ua.ID, x.w.ID, "Sprint review")

	// The control: Ask UNI's own search finds the chat line.
	tc := ai.ToolContext{ActorID: x.ua.ID, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID}
	srcs, err := x.tools.ask.searchWorkspace(ctx, tc, "sprint bí mật")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, s := range srcs {
		kinds[s.Kind] = true
	}
	if !kinds["chat"] || !kinds["task"] {
		t.Fatalf("control: Ask UNI search kinds = %v; want chat and task", kinds)
	}

	found, err := x.tools.Search(ctx, x.p, x.w.ID, "sprint bí mật")
	if err != nil || len(found) != 1 || found[0].Kind != "task" || found[0].Title != "Sprint review" {
		t.Fatalf("search = %+v, %v", found, err)
	}
	if found, err := x.tools.Search(ctx, x.p, x.w.ID, "thành viên gồm những ai"); err != nil {
		t.Fatal(err)
	} else {
		for _, it := range found {
			if it.Kind != "task" && it.Kind != "meeting" {
				t.Fatalf("search returned a %q item: %+v", it.Kind, it)
			}
		}
	}
}

// Nothing a tool returns names a field beyond the documented ones, and none of
// it carries an email address.
func TestMcpToolOutputsCarryOnlyDocumentedFields(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp kế hoạch quý", "Chốt mục tiêu quý")
	if _, err := x.tools.ask.tasks.AddComment(ctx, Human(x.ua.ID), x.taskID, "Đã gửi bản nháp"); err != nil {
		t.Fatal(err)
	}
	itemKeys := map[string]bool{"kind": true, "id": true, "workspace_id": true, "title": true, "excerpt": true, "url": true, "status": true, "due_date": true, "starts_at": true}
	check := func(name string, raw json.RawMessage, err error, allowed map[string]bool) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if strings.Contains(string(raw), "@example.com") {
			t.Fatalf("%s carries an email address: %s", name, raw)
		}
		var rows []map[string]json.RawMessage
		var one map[string]json.RawMessage
		if json.Unmarshal(raw, &rows) != nil {
			if err := json.Unmarshal(raw, &one); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			rows = []map[string]json.RawMessage{one}
		}
		if len(rows) == 0 {
			t.Fatalf("%s returned nothing", name)
		}
		for _, row := range rows {
			for k := range row {
				if !allowed[k] {
					t.Errorf("%s has undocumented field %q: %s", name, k, raw)
				}
			}
		}
	}
	raw, err := callMcpTool(t, x.tools, x.p, "list_workspaces", `{}`)
	check("list_workspaces", raw, err, map[string]bool{"id": true, "name": true, "url": true})
	raw, err = callMcpTool(t, x.tools, x.p, "search", `{"workspace_id":"`+x.w.ID+`","query":"báo cáo kế hoạch"}`)
	check("search", raw, err, itemKeys)
	raw, err = callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	check("get_task", raw, err, itemKeys)
	raw, err = callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"}`)
	check("get_meeting", raw, err, itemKeys)
	raw, err = callMcpTool(t, x.tools, x.p, "my_work", `{}`)
	check("my_work", raw, err, map[string]bool{"tasks": true, "meetings": true, "truncated": true, "partial": true})
	var work struct {
		Tasks, Meetings []map[string]json.RawMessage
	}
	if err := json.Unmarshal(raw, &work); err != nil || len(work.Tasks) == 0 || len(work.Meetings) == 0 {
		t.Fatalf("my_work = %s %v", raw, err)
	}
	for _, row := range append(work.Tasks, work.Meetings...) {
		for k := range row {
			if !itemKeys[k] {
				t.Errorf("my_work item has undocumented field %q", k)
			}
		}
	}
}
