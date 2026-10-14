package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
)

// Review Focus 5: an organization owner who is not in the workspace can be
// assigned and is listed; a deactivated member cannot and is not; no email
// ever leaves.
func TestMcpListMembers(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	list := func() map[string]McpMember {
		t.Helper()
		out, err := callMcpTool(t, x.tools, x.p, "list_members", `{"workspace_id":"`+x.w.ID+`"}`)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(out), "@") {
			t.Fatalf("list_members leaks an email: %s", out)
		}
		var members []McpMember
		if err := json.Unmarshal(out, &members); err != nil {
			t.Fatal(err)
		}
		byID := map[string]McpMember{}
		for _, m := range members {
			byID[m.UserID] = m
		}
		return byID
	}
	if _, ok := list()[x.ua.ID]; !ok {
		t.Fatal("the workspace owner is not listed")
	}
	// ub becomes an admin of the organization without joining the workspace:
	// RequireMember lets them in, so they can be assigned.
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleAdmin)
	if m, ok := list()[x.ub.ID]; !ok || m.Role != "org_admin" {
		t.Fatalf("org admin outside the workspace = %+v, listed %v", m, ok)
	}
	// Deactivated, ub can no longer be given anything.
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, x.w.OrganizationID, x.ub.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := list()[x.ub.ID]; ok {
		t.Fatal("a deactivated member is listed")
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
	var list []McpTask
	if err := json.Unmarshal(out, &list); err != nil || len(list) != 1 || list[0].ID != x.taskID || list[0].Revision == 0 {
		t.Fatalf("list_tasks = %s (%v)", out, err)
	}
	out, err = callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpTask
	if err := json.Unmarshal(out, &one); err != nil || one.Revision != list[0].Revision || one.AssigneeID != x.ua.ID {
		t.Fatalf("get_task = %s (%v)", out, err)
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
