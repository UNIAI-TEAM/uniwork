package service

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
)

var agentToolOrder = []string{
	"search", "list_tasks", "get_task", "list_meetings", "get_meeting", "list_projects",
	"get_project", "get_document", "list_chat_rooms", "read_chat_room", "list_members", "member_workload",
}

// newAgentWorld is the MCP tool world with Ask UNI's read tools wired to it,
// asking as ua in the world's workspace.
func newAgentWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, ai.ToolContext) {
	t.Helper()
	x := newMcpToolWorld(t)
	s := x.tools.ask
	s.SetReadTools(x.tools)
	return x, s, ai.ToolContext{ActorID: x.ua.ID, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID}
}

func runAgentTool(t *testing.T, s *AskUNIService, tc ai.ToolContext, name, args string) []agentItem {
	t.Helper()
	for _, tool := range s.agentTools() {
		if tool.Name == name {
			items, err := tool.run(context.Background(), tc, json.RawMessage(args))
			if err != nil {
				t.Fatalf("%s(%s): %v", name, args, err)
			}
			return items
		}
	}
	t.Fatalf("no agent tool %q", name)
	return nil
}

// isError says the call came back as one error item and nothing else: no
// title, key or other text a model could read.
func isError(items []agentItem, code string) bool {
	return len(items) == 1 && items[0] == agentItem{Kind: "error", Text: "error: " + code}
}

func TestAskAgentToolsAreReadOnly(t *testing.T) {
	tools := (&AskUNIService{}).agentTools()
	r := agentRegistry(tools)
	if !slices.Equal(r.Names(), agentToolOrder) {
		t.Fatalf("tools = %v, want %v", r.Names(), agentToolOrder)
	}
	if r.MutationCount() != 0 {
		t.Fatalf("Ask UNI's agent registry has %d write tools; it only reads", r.MutationCount())
	}
	for _, tool := range tools {
		if tool.Kind != ai.ToolRead || tool.Risk != ai.RiskLow || !tool.Strict || tool.run == nil || tool.Handle != nil || tool.Description == "" {
			t.Errorf("tool %s: kind %s, risk %s, strict %v, run set %v, handle set %v", tool.Name, tool.Kind, tool.Risk, tool.Strict, tool.run != nil, tool.Handle != nil)
		}
	}
}

// Strict mode holds the model to the schema only when every property is
// required and nothing else is allowed; flat scalars are what both vendors
// accept, and the workspace is the server's, never the model's.
func TestAskAgentToolSchemasAreStrict(t *testing.T) {
	for _, tool := range agentRegistry((&AskUNIService{}).agentTools()) {
		dec := json.NewDecoder(bytes.NewReader(tool.Schema))
		dec.DisallowUnknownFields()
		var sc struct {
			Type                 string                     `json:"type"`
			Properties           map[string]json.RawMessage `json:"properties"`
			Required             []string                   `json:"required"`
			AdditionalProperties *bool                      `json:"additionalProperties"`
		}
		if err := dec.Decode(&sc); err != nil {
			t.Errorf("%s: schema %s: %v", tool.Name, tool.Schema, err)
			continue
		}
		if sc.Type != "object" || sc.AdditionalProperties == nil || *sc.AdditionalProperties || sc.Properties == nil || sc.Required == nil {
			t.Errorf("%s: schema %s is not a closed object", tool.Name, tool.Schema)
		}
		keys := make([]string, 0, len(sc.Properties))
		for k, raw := range sc.Properties {
			keys = append(keys, k)
			pd := json.NewDecoder(bytes.NewReader(raw))
			pd.DisallowUnknownFields()
			var p struct{ Type, Description string }
			if err := pd.Decode(&p); err != nil || !slices.Contains([]string{"string", "boolean", "integer"}, p.Type) || p.Description == "" {
				t.Errorf("%s.%s: %s is not a described scalar (%v)", tool.Name, k, raw, err)
			}
		}
		sort.Strings(keys)
		if !slices.Equal(sc.Required, keys) {
			t.Errorf("%s: required %v, want every property %v", tool.Name, sc.Required, keys)
		}
		if _, ok := sc.Properties["workspace_id"]; ok {
			t.Errorf("%s takes workspace_id; the server binds the workspace", tool.Name)
		}
	}
}

// The tool list is part of the prompt-cache prefix: what the gateway sends a
// vendor (gateway.go builds provider.ToolSpec from each tool) is the same
// bytes on every build. ai.Tool itself cannot be marshalled (Handle is a func).
func TestAskAgentToolBytesAreStable(t *testing.T) {
	wire := func() []byte {
		var specs []provider.ToolSpec
		for _, tool := range agentRegistry((&AskUNIService{}).agentTools()) {
			specs = append(specs, provider.ToolSpec{Name: tool.Name, Description: tool.Description, Schema: tool.Schema, Strict: tool.Strict})
		}
		b, err := json.Marshal(specs)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	first := wire()
	for range 20 {
		if again := wire(); !bytes.Equal(first, again) {
			t.Fatalf("tool bytes changed between builds:\n%s\n%s", first, again)
		}
	}
}

// Every tool reads only the workspace the question was asked in. The asker
// owns the organization and may read workspace two, yet asking in workspace
// one, its ids read as absent, exactly like an id of another organization or
// one nobody has.
func TestAskAgentToolsStayInTheAskedWorkspace(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	task2 := x.task(t, x.ua.ID, v2.Workspace.ID, "Hồ sơ mật workspace hai")
	meeting2 := x.meeting(t, x.ua.ID, v2.Workspace.ID, "Họp mật workspace hai", "hồ sơ mật")
	_, wsB := x.org(t, x.ub.ID, "Org B", "org-b-agent")
	taskB := x.task(t, x.ub.ID, wsB.ID, "Hồ sơ mật tổ chức B")
	own := x.task(t, x.ua.ID, x.w.ID, "Hồ sơ mật workspace một")

	for name, id := range map[string]string{"workspace two": task2.ID, "organization B": taskB.ID, "nobody's": util.NewID()} {
		if items := runAgentTool(t, s, tc, "get_task", `{"task":"`+id+`"}`); !isError(items, "not_found") {
			t.Errorf("get_task of %s = %+v; want error: not_found", name, items)
		}
	}
	if items := runAgentTool(t, s, tc, "get_meeting", `{"meeting_id":"`+meeting2.ID+`"}`); !isError(items, "not_found") {
		t.Errorf("get_meeting of workspace two = %+v", items)
	}
	// The control: the asker's own task reads under its own workspace.
	if items := runAgentTool(t, s, tc, "get_task", `{"task":"`+own.ID+`"}`); len(items) != 1 || items[0].Title != own.Title || !strings.Contains(items[0].Text, "Ref: ") {
		t.Fatalf("get_task of workspace one = %+v", items)
	}

	found := runAgentTool(t, s, tc, "search", `{"query":"hồ sơ mật"}`)
	listed := runAgentTool(t, s, tc, "list_tasks", `{"status":"","project_id":"","assignee_id":"","priority":"","due_from":"","due_to":"","overdue":false,"limit":50}`)
	for label, items := range map[string][]agentItem{"search": found, "list_tasks": listed} {
		var mine bool
		for _, it := range items {
			if strings.Contains(it.Title+it.Text, "workspace hai") || strings.Contains(it.Title+it.Text, "tổ chức B") {
				t.Errorf("%s in workspace one returned %+v", label, it)
			}
			mine = mine || it.Title == own.Title
		}
		if !mine {
			t.Errorf("%s did not find workspace one's own task: %+v", label, items)
		}
	}
}

// A tool answers as the asker: a restricted page another member cannot open
// reads as absent, title and all, and the documents switch closes the tool.
func TestAskAgentToolsRespectVisibility(t *testing.T) {
	x, s, _ := newAgentWorld(t)
	ctx := context.Background()
	docs, open := x.withDocs(t, "Kế hoạch công khai", mcpTestPage)
	secret, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Title: "Kế hoạch riêng tư", Visibility: documentVisibilityRestricted, Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	member := x.member(t)
	tcB := ai.ToolContext{ActorID: member.UserID, OrganizationID: member.OrganizationID, WorkspaceID: x.w.ID}
	get := func(id string) []agentItem {
		return runAgentTool(t, s, tcB, "get_document", `{"document_id":"`+id+`"}`)
	}
	if items := get(secret.Document.ID); !isError(items, "not_found") {
		t.Errorf("member reads a restricted page: %+v", items)
	}
	if items := get(open.Document.ID); len(items) != 1 || items[0].Title != "Kế hoạch công khai" || !strings.Contains(items[0].Text, "Mục tiêu") {
		t.Fatalf("control: member reads the open page: %+v", items)
	}
	x.flags.byOrg = map[string]bool{x.w.OrganizationID: false}
	if items := get(open.Document.ID); !isError(items, "documents_unavailable") {
		t.Errorf("documents off: %+v", items)
	}
}

// Reading chat for an answer is not the asker opening the room: neither the
// agent's read_chat_room nor P0's chat context moves the read pointer.
func TestAskAgentChatReadDoesNotMarkRead(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	x.member(t)
	dm, err := s.chat.ResolveDM(ctx, x.ua.ID, x.w.ID, x.ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"Báo giá ACME gửi chưa?", "Nhớ hạn thứ sáu"} {
		if _, err := s.chat.SendRoomMessage(ctx, x.ub.ID, x.w.ID, dm.ID, SendChatMessageInput{Body: body}); err != nil {
			t.Fatal(err)
		}
	}
	unread := func() int {
		t.Helper()
		rooms, err := s.chat.ListChatRooms(ctx, x.ua.ID, x.w.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rooms {
			if r.ID == dm.ID {
				return r.UnreadCount
			}
		}
		t.Fatal("the dm is not listed")
		return 0
	}
	if n := unread(); n != 2 {
		t.Fatalf("unread before = %d, want 2", n)
	}

	rooms := runAgentTool(t, s, tc, "list_chat_rooms", `{}`)
	var listed bool
	for _, it := range rooms {
		if strings.Contains(it.Title+it.Text, "@") {
			t.Errorf("list_chat_rooms shows an email: %+v", it)
		}
		listed = listed || (it.Title == "B" && strings.Contains(it.Text, dm.ID))
	}
	if !listed {
		t.Errorf("list_chat_rooms = %+v; want the dm with B and its id", rooms)
	}

	all := runAgentTool(t, s, tc, "read_chat_room", `{"room_id":"`+dm.ID+`","query":""}`)
	if len(all) != 1 || !strings.Contains(all[0].Text, "ACME") || !strings.Contains(all[0].Text, "thứ sáu") {
		t.Fatalf("read_chat_room = %+v", all)
	}
	some := runAgentTool(t, s, tc, "read_chat_room", `{"room_id":"`+dm.ID+`","query":"ACME"}`)
	if len(some) != 1 || !strings.Contains(some[0].Text, "ACME") || strings.Contains(some[0].Text, "thứ sáu") || some[0].Key != all[0].Key {
		t.Fatalf("read_chat_room with a query = %+v", some)
	}
	if n := unread(); n != 2 {
		t.Errorf("unread after read_chat_room = %d, want 2", n)
	}
	if _, err := s.chatContext(ctx, tc, "ACME"); err != nil {
		t.Fatal(err)
	}
	if n := unread(); n != 2 {
		t.Errorf("unread after P0 chat context = %d, want 2", n)
	}
}

func TestAskAgentListTasksFilters(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	x.member(t)
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	for _, in := range []CreateTaskInput{
		{Title: "Việc trễ của A", DueDate: &yesterday, AssigneeID: &x.ua.ID},
		{Title: "Việc trễ của B", DueDate: &yesterday, AssigneeID: &x.ub.ID},
		{Title: "Việc chưa hạn của A", AssigneeID: &x.ua.ID},
	} {
		if _, err := s.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, in); err != nil {
			t.Fatal(err)
		}
	}
	items := runAgentTool(t, s, tc, "list_tasks", `{"status":"","project_id":"","assignee_id":"me","priority":"","due_from":"","due_to":"","overdue":true,"limit":0}`)
	if len(items) != 1 || items[0].Title != "Việc trễ của A" || items[0].Kind != "task" || items[0].Key != items[0].Href || !strings.Contains(items[0].Href, "/tasks/") {
		t.Fatalf("my overdue tasks = %+v", items)
	}
	text := items[0].Text
	for _, want := range []string{"Ref: ", "Status: ", "Priority: ", "Due: " + yesterday, "Assignee: A", "Project: none"} {
		if !strings.Contains(text, want) {
			t.Errorf("task text lacks %q:\n%s", want, text)
		}
	}
	if items := runAgentTool(t, s, tc, "list_tasks", `{"status":"","project_id":"","assignee_id":"me","priority":"","due_from":"18/10/2026","due_to":"","overdue":false,"limit":0}`); len(items) != 1 || !strings.HasPrefix(items[0].Text, "error: invalid_args") {
		t.Errorf("a bad date = %+v", items)
	}
}

func TestAskAgentMemberWorkload(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	x.member(t)
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	// ua already holds one open task due today; this adds an overdue one.
	for _, in := range []CreateTaskInput{
		{Title: "Việc trễ của A", DueDate: &yesterday, AssigneeID: &x.ua.ID},
		{Title: "Việc của B", AssigneeID: &x.ub.ID},
	} {
		if _, err := s.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, in); err != nil {
			t.Fatal(err)
		}
	}
	items := runAgentTool(t, s, tc, "member_workload", `{}`)
	if len(items) != 1 {
		t.Fatalf("member_workload = %+v", items)
	}
	for _, want := range []string{"- A: 2 open, 1 overdue", "- B: 1 open, 0 overdue"} {
		if !strings.Contains(items[0].Text, want) {
			t.Errorf("workload lacks %q:\n%s", want, items[0].Text)
		}
	}
	for _, it := range append(items, runAgentTool(t, s, tc, "list_members", `{"query":""}`)...) {
		if strings.Contains(it.Title+it.Text, "@") {
			t.Errorf("%s shows an email: %+v", it.Kind, it)
		}
	}
}

// The happy path of the tools the other tests do not reach: the default
// meeting window, a meeting read, projects with their tasks, members.
func TestAskAgentToolsReadEveryKind(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp giao ban", "Chương trình tuần")
	meetings := runAgentTool(t, s, tc, "list_meetings", `{"from":"","to":"","hosted_by_me":false,"status":""}`)
	if len(meetings) != 1 || meetings[0].Title != m.Title || !strings.Contains(meetings[0].Text, "Host: A") {
		t.Fatalf("list_meetings in the default window = %+v", meetings)
	}
	late := time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339)
	if items := runAgentTool(t, s, tc, "list_meetings", `{"from":"`+late+`","to":"","hosted_by_me":false,"status":""}`); len(items) != 0 {
		t.Errorf("list_meetings from a month on = %+v", items)
	}
	if items := runAgentTool(t, s, tc, "get_meeting", `{"meeting_id":"`+m.ID+`"}`); len(items) != 1 || items[0].Key != meetings[0].Key || !strings.Contains(items[0].Text, "Attendees: A") || !strings.Contains(items[0].Text, "Chương trình tuần") {
		t.Errorf("get_meeting = %+v", items)
	}

	pr, err := s.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Website mới"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: "Dựng trang chủ", ProjectID: &pr.ID}); err != nil {
		t.Fatal(err)
	}
	if items := runAgentTool(t, s, tc, "list_projects", `{"query":"","include_closed":false}`); len(items) != 1 || items[0].Title != pr.Title || !strings.Contains(items[0].Text, "ID: "+pr.ID) {
		t.Errorf("list_projects = %+v", items)
	}
	if items := runAgentTool(t, s, tc, "get_project", `{"project_id":"`+pr.ID+`"}`); len(items) != 1 || !strings.Contains(items[0].Text, "Dựng trang chủ") || !strings.Contains(items[0].Text, "Task count: 1") {
		t.Errorf("get_project = %+v", items)
	}
	tasks := runAgentTool(t, s, tc, "list_tasks", `{"status":"","project_id":"`+pr.ID+`","assignee_id":"","priority":"","due_from":"","due_to":"","overdue":false,"limit":0}`)
	if len(tasks) != 1 || !strings.Contains(tasks[0].Text, "Project: Website mới ("+pr.ID+")") {
		t.Errorf("list_tasks by project = %+v", tasks)
	}
	if items := runAgentTool(t, s, tc, "list_members", `{"query":""}`); len(items) != 1 || !strings.Contains(items[0].Text, "- A (") || !strings.Contains(items[0].Text, x.ua.ID) {
		t.Errorf("list_members = %+v", items)
	}
}
