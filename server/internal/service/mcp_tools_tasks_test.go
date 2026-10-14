package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Review Focus 5: who a task can be given to. An organization owner or admin
// outside the workspace can be (RequireMember lets them in) and is listed; a
// plain organization member outside it cannot and is not; a deactivated
// member cannot, workspace member or not; no email ever leaves.
func TestMcpListMembers(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	pool := x.tools.ask.pool
	as := NewAuthService(pool, x.tools.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	list := func(extra string) McpMemberList {
		t.Helper()
		out, err := callMcpTool(t, x.tools, x.p, "list_members", `{"workspace_id":"`+x.w.ID+`"`+extra+`}`)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(out), "@") {
			t.Fatalf("list_members leaks an email: %s", out)
		}
		var res McpMemberList
		if err := json.Unmarshal(out, &res); err != nil || res.Members == nil {
			t.Fatalf("list_members = %s (%v)", out, err)
		}
		return res
	}
	byID := func(res McpMemberList) map[string]McpMember {
		m := map[string]McpMember{}
		for _, member := range res.Members {
			m[member.UserID] = member
		}
		return m
	}
	deactivate := func(userID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, x.w.OrganizationID, userID); err != nil {
			t.Fatal(err)
		}
	}

	if m, ok := byID(list(""))[x.ua.ID]; !ok || m.Role == "" || strings.HasPrefix(m.Role, "org_") {
		t.Fatalf("the workspace owner = %+v, listed %v; want their workspace role", m, ok)
	}

	// ub, an organization admin who never joined the workspace.
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleAdmin)
	if m, ok := byID(list(""))[x.ub.ID]; !ok || m.Role != "org_admin" {
		t.Fatalf("org admin outside the workspace = %+v, listed %v", m, ok)
	}

	// uc, an ordinary organization member outside the workspace: not assignable.
	uc := registerVerified(t, x.tools.q, as, "mcp-members-c@example.com", "Cẩm Chi")
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, uc.ID, OrgRoleMember)
	if _, ok := byID(list(""))[uc.ID]; ok {
		t.Fatal("an organization member outside the workspace is listed")
	}

	// ud, a workspace member; once deactivated in the organization the
	// workspace row stays but they are no longer assignable.
	ud := registerVerified(t, x.tools.q, as, "mcp-members-d@example.com", "Trần Thị Mai")
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, ud.ID, OrgRoleMember)
	if err := x.tools.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: x.w.ID, OrganizationID: x.w.OrganizationID, UserID: ud.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if m, ok := byID(list(""))[ud.ID]; !ok || m.Role != "member" {
		t.Fatalf("workspace member = %+v, listed %v", m, ok)
	}

	// query: a case-insensitive part of the name, Vietnamese letters included.
	if got := list(`,"query":"THỊ MAI"`); len(got.Members) != 1 || got.Members[0].UserID != ud.ID || got.Truncated {
		t.Fatalf("query THỊ MAI = %+v", got)
	}
	if got := list(`,"query":"không ai tên vậy"`); len(got.Members) != 0 || got.Truncated {
		t.Fatalf("query with no match = %+v", got)
	}

	deactivate(ud.ID)
	if _, ok := byID(list(""))[ud.ID]; ok {
		t.Fatal("a deactivated workspace member is listed")
	}
	deactivate(x.ub.ID)
	if _, ok := byID(list(""))[x.ub.ID]; ok {
		t.Fatal("a deactivated org admin is listed")
	}

	// The organization owner leaves the workspace and stays assignable as an
	// implicit admin; the caller, ua, is that owner and is still let in.
	if _, err := pool.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, x.w.ID, x.ua.ID); err != nil {
		t.Fatal(err)
	}
	if m, ok := byID(list(""))[x.ua.ID]; !ok || m.Role != "org_owner" {
		t.Fatalf("org owner outside the workspace = %+v, listed %v", m, ok)
	}
}

// The answer is cut to mcpMaxList and says so; a query narrows before the cut.
func TestMcpMemberListCapsAndFilters(t *testing.T) {
	var all []McpMember
	for i := 0; i < mcpMaxList+5; i++ {
		all = append(all, McpMember{UserID: fmt.Sprintf("u%02d", i), Name: fmt.Sprintf("Thành viên %02d", i), Role: "member"})
	}
	if got := mcpMemberList(all, ""); len(got.Members) != mcpMaxList || !got.Truncated || got.Members[0].UserID != "u00" {
		t.Fatalf("%d members, truncated %v", len(got.Members), got.Truncated)
	}
	if got := mcpMemberList(all[:mcpMaxList], "  "); len(got.Members) != mcpMaxList || got.Truncated {
		t.Fatalf("exactly the cap: %d members, truncated %v", len(got.Members), got.Truncated)
	}
	if got := mcpMemberList(all, "THÀNH VIÊN 5"); len(got.Members) != 5 || got.Truncated {
		t.Fatalf("query: %+v", got)
	}
	if got := mcpMemberList(nil, ""); got.Members == nil || len(got.Members) != 0 {
		t.Fatalf("no members must read as [], got %+v", got)
	}
}

func TestMcpTaskOptionsListStatusesLabelsAndPriorities(t *testing.T) {
	x := newMcpToolWorld(t)
	out, err := callMcpTool(t, x.tools, x.p, "task_options", `{"workspace_id":"`+x.w.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var opts McpTaskOptions
	if err := json.Unmarshal(out, &opts); err != nil {
		t.Fatal(err)
	}
	keys := map[string]bool{}
	for _, st := range opts.Statuses {
		keys[st.Key] = st.Name != ""
	}
	if !keys["todo"] {
		t.Fatalf("statuses = %+v, want todo with a name", opts.Statuses)
	}
	for _, p := range opts.Priorities {
		if !validPriority[p] {
			t.Errorf("priority %q is not one the service accepts", p)
		}
	}
	if len(opts.Priorities) != len(validPriority) {
		t.Errorf("priorities = %v, service accepts %d", opts.Priorities, len(validPriority))
	}
}

func TestMcpListTasksAndGetTaskCarryTheRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	out, err := callMcpTool(t, x.tools, x.p, "list_tasks", `{"workspace_id":"`+x.w.ID+`","status":"todo"}`)
	if err != nil {
		t.Fatal(err)
	}
	var list McpTaskList
	if err := json.Unmarshal(out, &list); err != nil || len(list.Tasks) != 1 || list.Tasks[0].ID != x.taskID || list.Tasks[0].Revision == 0 || list.Truncated {
		t.Fatalf("list_tasks = %s (%v)", out, err)
	}
	out, err = callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpTask
	if err := json.Unmarshal(out, &one); err != nil || one.Revision != list.Tasks[0].Revision || one.AssigneeID != x.ua.ID {
		t.Fatalf("get_task = %s (%v)", out, err)
	}
}

// A page that left tasks out says so.
func TestMcpListTasksSaysWhenItIsCut(t *testing.T) {
	x := newMcpToolWorld(t)
	x.task(t, x.ua.ID, x.w.ID, "Việc thứ hai")
	x.task(t, x.ua.ID, x.w.ID, "Việc thứ ba")
	for limit, want := range map[int]bool{1: true, 2: true, 3: false, 50: false} {
		out, err := callMcpTool(t, x.tools, x.p, "list_tasks", fmt.Sprintf(`{"workspace_id":%q,"limit":%d}`, x.w.ID, limit))
		if err != nil {
			t.Fatal(err)
		}
		var list McpTaskList
		if err := json.Unmarshal(out, &list); err != nil || list.Truncated != want || len(list.Tasks) != min(limit, 3) {
			t.Errorf("limit %d: %d tasks, truncated %v (want %v): %s %v", limit, len(list.Tasks), list.Truncated, want, out, err)
		}
	}
}

func TestMcpListLimit(t *testing.T) {
	for in, want := range map[int32]int32{-5: 20, 0: 20, 1: 1, 37: 37, 50: 50, 51: 50, 5000: 50} {
		if got := mcpListLimit(in); got != want {
			t.Errorf("mcpListLimit(%d) = %d, want %d", in, got, want)
		}
	}
}

// get_task takes the PREFIX-N reference people write as well as the ULID.
func TestMcpGetTaskByReference(t *testing.T) {
	x := newMcpToolWorld(t)
	task, err := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	ws, err := x.tools.q.GetWorkspaceByID(context.Background(), x.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	ref := ws.TaskPrefix + "-" + strconv.FormatInt(task.Number, 10)
	out, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+ref+`"}`)
	if err != nil || !strings.Contains(string(out), x.taskID) {
		t.Fatalf("get_task %s = %s (%v)", ref, out, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"NOPE-999"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown reference: %v, want ErrNotFound", err)
	}
}

// Task prefixes are the first three letters of the slug, so "alpha" and
// "alpine" are both ALP, and numbers count per workspace: ALP-1 exists twice
// in one organization. A reference resolves inside the workspace asked for.
func TestMcpGetTaskByReferenceStaysInItsWorkspace(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	v, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Alpine", "alpine")
	if err != nil {
		t.Fatal(err)
	}
	alpine := v.Workspace
	alpineTask := x.task(t, x.ua.ID, alpine.ID, "Việc của Alpine")
	alpha, err := x.tools.ask.tasks.Get(ctx, x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	if alpha.Number != 1 || alpineTask.Number != 1 || alpine.TaskPrefix != "ALP" {
		t.Fatalf("setup: alpha task %d, alpine task %d, alpine prefix %q; want two ALP-1", alpha.Number, alpineTask.Number, alpine.TaskPrefix)
	}
	for _, tc := range []struct{ workspaceID, ref, want string }{
		{x.w.ID, "ALP-1", x.taskID},
		{alpine.ID, "ALP-1", alpineTask.ID},
		{alpine.ID, "alp-1", alpineTask.ID},
	} {
		out, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+tc.workspaceID+`","task_id":"`+tc.ref+`"}`)
		var got McpTask
		if err != nil || json.Unmarshal(out, &got) != nil || got.ID != tc.want || got.WorkspaceID != tc.workspaceID {
			t.Errorf("get_task %s in %s = %s (%v), want task %s", tc.ref, tc.workspaceID, out, err, tc.want)
		}
	}
	// A reference of another prefix, a number the workspace never issued, and
	// the id of the other workspace's task are all simply absent.
	for _, ref := range []string{"BET-1", "ALP-2", alpineTask.ID} {
		if _, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+ref+`"}`); !errors.Is(err, ErrNotFound) {
			t.Errorf("get_task %s in alpha: %v, want ErrNotFound", ref, err)
		}
	}
}

func writeResult(t *testing.T, raw json.RawMessage) (McpWriteResult, map[string]any) {
	t.Helper()
	var res McpWriteResult
	if err := json.Unmarshal(raw, &res); err != nil {
		t.Fatal(err)
	}
	item, _ := res.Item.(map[string]any)
	return res, item
}

// onlyKeys fails for a field of m outside allowed: what a write tool returns
// is as documented as what a read tool returns.
func onlyKeys(t *testing.T, name string, m map[string]any, allowed ...string) {
	t.Helper()
	ok := map[string]bool{}
	for _, k := range allowed {
		ok[k] = true
	}
	for k := range m {
		if !ok[k] {
			t.Errorf("%s has undocumented field %q: %v", name, k, m)
		}
	}
}

func TestMcpCreateTask(t *testing.T) {
	x := newMcpToolWorld(t)
	raw, err := callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+x.w.ID+`","title":"Gửi báo giá ACME","description":"**Gấp**","priority":"high","assignee_id":"`+x.ua.ID+`","due_date":"2026-10-23"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if res.Revision == 0 || item["title"] != "Gửi báo giá ACME" || item["priority"] != "high" || item["due_date"] != "2026-10-23" || item["assignee_id"] != x.ua.ID || !strings.Contains(item["url"].(string), "/tasks/") {
		t.Fatalf("create_task = %s", raw)
	}
	onlyKeys(t, "create_task item", item, "kind", "id", "workspace_id", "title", "excerpt", "url", "status", "due_date", "revision", "priority", "assignee_id", "project_id", "parent_task_id", "start_date", "labels")
	var kind string
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT actor_kind FROM audit_events WHERE action = 'task.created' AND resource_id = $1`, item["id"]).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != "human" {
		t.Fatalf("actor_kind = %q, want human", kind)
	}
}

// A task goes where the call says: a project and a parent of the same
// workspace, the parent named by id or by PREFIX-N.
func TestMcpCreateTaskPlacesItInAProjectAndUnderAParent(t *testing.T) {
	x := newMcpToolWorld(t)
	project, err := x.tools.ask.tasks.CreateProject(context.Background(), Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Ra mắt Q4"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{x.taskID, x.w.TaskPrefix + "-" + strconv.FormatInt(parent.Number, 10)} {
		raw, err := callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+x.w.ID+`","title":"Việc con của `+ref+`","project_id":"`+project.ID+`","parent_task_id":"`+ref+`"}`)
		if err != nil {
			t.Fatalf("parent %s: %v", ref, err)
		}
		if _, item := writeResult(t, raw); item["project_id"] != project.ID || item["parent_task_id"] != x.taskID {
			t.Fatalf("parent %s: create_task = %s", ref, raw)
		}
	}
}

// Review Focus 4: a client that retries after a flaky network is refused, and
// the refusal names the task the first call made; no second task appears.
func TestMcpCreateTaskTwiceNamesTheFirst(t *testing.T) {
	x := newMcpToolWorld(t)
	in := `{"workspace_id":"` + x.w.ID + `","title":"Chốt hợp đồng"}`
	raw, err := callMcpTool(t, x.tools, x.p, "create_task", in)
	if err != nil {
		t.Fatal(err)
	}
	_, first := writeResult(t, raw)
	_, err = callMcpTool(t, x.tools, x.p, "create_task", in)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "active_duplicate_task" || !strings.Contains(te.Msg, first["id"].(string)) || !strings.Contains(te.Msg, first["url"].(string)) {
		t.Fatalf("second create: %v, want active_duplicate_task naming %v", err, first)
	}
	var n int
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND title = $2`, x.w.ID, "Chốt hợp đồng").Scan(&n); err != nil || n != 1 {
		t.Fatalf("%d tasks titled Chốt hợp đồng after a retry, want 1 (%v)", n, err)
	}
}

func TestMcpCreateTaskValidates(t *testing.T) {
	x := newMcpToolWorld(t)
	ws := `{"workspace_id":"` + x.w.ID + `",`
	for in, want := range map[string]string{
		ws + `"title":""}`:   "title",
		ws + `"title":"  "}`: "title",
		ws + `"title":"` + strings.Repeat("ạ", 501) + `"}`:                                  "title",
		ws + `"title":"A","due_date":"23/10/2026"}`:                                         "due_date must be a date",
		ws + `"title":"A","start_date":"2026-13-01"}`:                                       "start_date must be a date",
		ws + `"title":"A","priority":"asap"}`:                                               "priority",
		ws + `"title":"A","label_ids":["` + strings.Join(make([]string, 21), `","`) + `"]}`: "label_ids",
	} {
		_, err := callMcpTool(t, x.tools, x.p, "create_task", in)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, want) {
			t.Errorf("create_task %.80s: %v, want McpInvalidArgs about %s", in, err, want)
		}
	}
	// A person outside the workspace is a refusal the model can act on.
	_, err := callMcpTool(t, x.tools, x.p, "create_task", ws+`"title":"B","assignee_id":"`+x.ub.ID+`"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "assignee_not_member" {
		t.Fatalf("assignee outside: %v", err)
	}
	// None of it made a task.
	var n int
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM tasks WHERE workspace_id = $1`, x.w.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("%d tasks after refused creates, want the 1 of the fixture (%v)", n, err)
	}
}

func TestMcpAddComment(t *testing.T) {
	x := newMcpToolWorld(t)
	raw, err := callMcpTool(t, x.tools, x.p, "add_comment", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","body":"Đã gửi bản nháp"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if item["task_id"] != x.taskID || item["body"] != "Đã gửi bản nháp" || item["id"] == "" || !strings.Contains(item["url"].(string), "/tasks/"+x.taskID) {
		t.Fatalf("add_comment = %s", raw)
	}
	if res.Revision != 0 || strings.Contains(string(raw), `"revision"`) {
		t.Fatalf("a comment has no revision: %s", raw)
	}
	onlyKeys(t, "add_comment item", item, "id", "task_id", "body", "url")
	out, _ := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	if !strings.Contains(string(out), "Đã gửi bản nháp") {
		t.Fatalf("the comment is not on the task: %s", out)
	}
	var author, kind string
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT author_id, author_kind FROM task_comments WHERE id = $1`, item["id"]).Scan(&author, &kind); err != nil || author != x.ua.ID || kind != "human" {
		t.Fatalf("comment author = %q/%q, want the person who consented (%v)", author, kind, err)
	}
}

// The task by PREFIX-N, a reply to a comment of the task, and the bounds on
// the body: an empty one, and one past what the schema promises.
func TestMcpAddCommentRepliesAndValidates(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	add := func(extra, body string) (json.RawMessage, error) {
		return callMcpTool(t, x.tools, x.p, "add_comment", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","body":`+strconv.Quote(body)+extra+`}`)
	}
	raw, err := add("", "Gốc")
	if err != nil {
		t.Fatal(err)
	}
	_, root := writeResult(t, raw)
	raw, err = add(`,"reply_to":"`+root["id"].(string)+`"`, "Trả lời")
	if err != nil {
		t.Fatal(err)
	}
	_, reply := writeResult(t, raw)
	c, err := x.tools.ask.tasks.GetComment(ctx, Human(x.ua.ID), reply["id"].(string))
	if err != nil || c.ParentCommentID.String != root["id"] {
		t.Fatalf("reply parent = %q, want %v (%v)", c.ParentCommentID.String, root["id"], err)
	}

	task, err := x.tools.ask.tasks.Get(ctx, x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	ref := x.w.TaskPrefix + "-" + strconv.FormatInt(task.Number, 10)
	raw, err = callMcpTool(t, x.tools, x.p, "add_comment", `{"workspace_id":"`+x.w.ID+`","task_id":"`+ref+`","body":"Qua mã tham chiếu"}`)
	if _, item := writeResult(t, raw); err != nil || item["task_id"] != x.taskID {
		t.Fatalf("add_comment by %s = %s (%v)", ref, raw, err)
	}

	for name, body := range map[string]string{"empty": "", "blank": " \n ", "too long": strings.Repeat("ạ", mcpMaxBodyRunes+1)} {
		var bad McpInvalidArgs
		if _, err := add("", body); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "body") {
			t.Errorf("%s body: %v, want McpInvalidArgs about body", name, err)
		}
	}
	// The longest body there is goes in whole; what comes back is cut like a
	// search hit, so a model is not handed 20000 characters it just wrote.
	long := strings.Repeat("ạ", mcpMaxBodyRunes)
	raw, err = add("", long)
	if err != nil {
		t.Fatal(err)
	}
	_, item := writeResult(t, raw)
	var stored string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT body FROM task_comments WHERE id = $1`, item["id"]).Scan(&stored); err != nil || stored != long {
		t.Fatalf("stored body has %d runes, want %d (%v)", len([]rune(stored)), mcpMaxBodyRunes, err)
	}
	if got := item["body"].(string); len([]rune(got)) != mcpMaxHitRunes || !strings.HasSuffix(got, mcpHitCut) {
		t.Fatalf("returned body has %d runes, want %d ending %q", len([]rune(got)), mcpMaxHitRunes, mcpHitCut)
	}
}

// Phase 0 review gate: whatever a write tool refuses with, the model reads
// nothing about a row it cannot see. Rows of another organization (the person
// is in it, the grant is not for it) and of another workspace of the grant's
// organization are simply absent; a reply target on another task of the same
// workspace is a mistake the model can fix, said in its own field name.
func TestMcpWriteToolErrorsNameNothingTheCallerCannotSee(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	tasks := x.tools.ask.tasks
	_, wsC := x.org(t, x.ub.ID, "Org C", "org-c-mcp")
	taskC := x.task(t, x.ub.ID, wsC.ID, "Chỉ C biết")
	commentC, err := tasks.AddComment(ctx, Human(x.ub.ID), taskC.ID, "Bình luận kín của C")
	if err != nil {
		t.Fatal(err)
	}
	projectC, err := tasks.CreateProject(ctx, Human(x.ub.ID), wsC.ID, CreateProjectInput{Title: "Dự án kín của C"})
	if err != nil {
		t.Fatal(err)
	}
	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	ws2 := v2.Workspace
	task2 := x.task(t, x.ua.ID, ws2.ID, "Việc của workspace hai")
	comment2, err := tasks.AddComment(ctx, Human(x.ua.ID), task2.ID, "Bình luận của workspace hai")
	if err != nil {
		t.Fatal(err)
	}
	project2, err := tasks.CreateProject(ctx, Human(x.ua.ID), ws2.ID, CreateProjectInput{Title: "Dự án của workspace hai"})
	if err != nil {
		t.Fatal(err)
	}
	other := x.task(t, x.ua.ID, x.w.ID, "Việc khác cùng workspace")
	commentOther, err := tasks.AddComment(ctx, Human(x.ua.ID), other.ID, "Bình luận của việc khác")
	if err != nil {
		t.Fatal(err)
	}
	count := func() (tasks, comments int) {
		t.Helper()
		if err := x.tools.ask.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM tasks), (SELECT count(*) FROM task_comments)`).Scan(&tasks, &comments); err != nil {
			t.Fatal(err)
		}
		return
	}
	tasksBefore, commentsBefore := count()

	secrets := []string{
		taskC.ID, taskC.Title, commentC.ID, commentC.Body, projectC.ID, projectC.Title, wsC.ID, x.ub.ID, x.ub.Email, x.ub.DisplayName,
		task2.ID, task2.Title, comment2.ID, comment2.Body, project2.ID, project2.Title, ws2.ID, commentOther.Body,
	}
	create := func(extra string) error {
		_, err := callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+x.w.ID+`","title":"Việc mới"`+extra+`}`)
		return err
	}
	comment := func(workspaceID, taskID, extra string) error {
		_, err := callMcpTool(t, x.tools, x.p, "add_comment", `{"workspace_id":"`+workspaceID+`","task_id":"`+taskID+`","body":"Nội dung"`+extra+`}`)
		return err
	}
	absent := map[string]error{
		"parent of another organization":             create(`,"parent_task_id":"` + taskC.ID + `"`),
		"parent of another workspace":                create(`,"parent_task_id":"` + task2.ID + `"`),
		"project of another organization":            create(`,"project_id":"` + projectC.ID + `"`),
		"project of another workspace":               create(`,"project_id":"` + project2.ID + `"`),
		"comment on a task of another organization":  comment(wsC.ID, taskC.ID, ""),
		"comment on a task under the grant's own id": comment(x.w.ID, taskC.ID, ""),
		"comment on a task of another workspace":     comment(x.w.ID, task2.ID, ""),
		"reply to a comment of another organization": comment(x.w.ID, x.taskID, `,"reply_to":"`+commentC.ID+`"`),
		"reply to a comment of another workspace":    comment(x.w.ID, x.taskID, `,"reply_to":"`+comment2.ID+`"`),
	}
	_, err = callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+wsC.ID+`","title":"Việc mới"}`)
	absent["create in a workspace of another organization"] = err
	for name, err := range absent {
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: %v, want ErrNotFound", name, err)
		}
	}

	var te McpToolError
	err = create(`,"assignee_id":"` + x.ub.ID + `"`)
	if !errors.As(err, &te) || te.Code != "assignee_not_member" {
		t.Errorf("assignee of another organization: %v, want assignee_not_member", err)
	}
	var bad McpInvalidArgs
	err = comment(x.w.ID, x.taskID, `,"reply_to":"`+commentOther.ID+`"`)
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "reply_to") || strings.Contains(bad.Msg, "parent_id") {
		t.Errorf("reply to a comment of another task: %v, want McpInvalidArgs naming reply_to", err)
	}

	refusals := []error{te, bad}
	for _, err := range absent {
		refusals = append(refusals, err)
	}
	for _, err := range refusals {
		for _, secret := range secrets {
			if err != nil && strings.Contains(err.Error(), secret) {
				t.Errorf("error %q names %q, which the caller cannot see", err, secret)
			}
		}
	}
	if tt, cc := count(); tt != tasksBefore || cc != commentsBefore {
		t.Errorf("refused writes left %d tasks and %d comments, want %d and %d", tt, cc, tasksBefore, commentsBefore)
	}
}

// task checks the workspace against the grant itself, so no tool that reaches
// a task can forget to: the person is a member of B and may read B's tasks on
// a screen, but under a grant for A the task is absent, by id and by PREFIX-N.
func TestMcpTaskRefusesAWorkspaceOutsideTheGrant(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, wsB := x.org(t, x.ua.ID, "Org B", "org-b-mcp")
	taskB := x.task(t, x.ua.ID, wsB.ID, "Việc của B")
	pB := McpPrincipal{UserID: x.ua.ID, OrganizationID: wsB.OrganizationID}
	refB := wsB.TaskPrefix + "-" + strconv.FormatInt(taskB.Number, 10)
	for _, ref := range []string{taskB.ID, refB} {
		if got, err := x.tools.task(ctx, pB, wsB.ID, ref); err != nil || got.ID != taskB.ID {
			t.Fatalf("control: grant for B reads %s: %+v, %v", ref, got, err)
		}
		if _, err := x.tools.task(ctx, x.p, wsB.ID, ref); !errors.Is(err, ErrNotFound) {
			t.Errorf("task(%s) under a grant for A: %v, want ErrNotFound", ref, err)
		}
	}
	var bad McpInvalidArgs
	if _, err := x.tools.task(ctx, x.p, "", x.taskID); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "workspace_id") {
		t.Errorf("task with no workspace: %v, want McpInvalidArgs about workspace_id", err)
	}
}

// The person is a full member of B and could write there on a screen. Under a
// grant for A neither write tool reaches B, whatever the ids; under a grant
// for B the same calls work, so the refusal is the grant and nothing else.
func TestMcpWriteToolsStayInTheGrantsOrganization(t *testing.T) {
	x := newMcpToolWorld(t)
	_, wsB := x.org(t, x.ua.ID, "Org B", "org-b-mcp")
	taskB := x.task(t, x.ua.ID, wsB.ID, "Việc của B")
	pB := McpPrincipal{UserID: x.ua.ID, OrganizationID: wsB.OrganizationID}
	create := `{"workspace_id":"` + wsB.ID + `","title":"Việc mới của B"}`
	comment := `{"workspace_id":"` + wsB.ID + `","task_id":"` + taskB.ID + `","body":"Bình luận của B"}`
	for tool, in := range map[string]string{"create_task": create, "add_comment": comment} {
		if _, err := callMcpTool(t, x.tools, x.p, tool, in); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s in B under a grant for A: %v, want ErrNotFound", tool, err)
		}
	}
	var tasks, comments int
	count := func() {
		t.Helper()
		if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM tasks WHERE workspace_id = $1), (SELECT count(*) FROM task_comments WHERE workspace_id = $1)`, wsB.ID).Scan(&tasks, &comments); err != nil {
			t.Fatal(err)
		}
	}
	if count(); tasks != 1 || comments != 0 {
		t.Fatalf("refused writes left %d tasks and %d comments in B, want 1 and 0", tasks, comments)
	}
	for tool, in := range map[string]string{"create_task": create, "add_comment": comment} {
		if _, err := callMcpTool(t, x.tools, pB, tool, in); err != nil {
			t.Errorf("control: %s under a grant for B: %v", tool, err)
		}
	}
	if count(); tasks != 2 || comments != 1 {
		t.Fatalf("control writes left %d tasks and %d comments in B, want 2 and 1", tasks, comments)
	}
}
