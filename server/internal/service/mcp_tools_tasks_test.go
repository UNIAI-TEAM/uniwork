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
