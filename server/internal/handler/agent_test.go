package handler

import (
	"testing"
)

// The organization's default agent is visible, can be renamed, and a task
// handed to it comes back with a resolved agent actor the client can badge.
func TestAgentEndpointsAndAgentAssignee(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/unicom/agents", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list org agents: %d %v", res.StatusCode, out)
	}
	agents := out["agents"].([]any)
	if len(agents) != 1 || agents[0].(map[string]any)["handle"] != "uni" {
		t.Fatalf("default agent: %v", agents)
	}
	uniID := agents[0].(map[string]any)["id"].(string)

	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/agents/"+uniID, w.token, map[string]string{"name": "UNI Alpha"})
	if res.StatusCode != 200 || out["agent"].(map[string]any)["name"] != "UNI Alpha" {
		t.Fatalf("patch agent: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/agents", w.token, nil)
	if res.StatusCode != 200 || len(out["agents"].([]any)) != 1 {
		t.Fatalf("workspace agents: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/tasks/"+w.taskID, w.token,
		map[string]string{"assignee_id": uniID, "assignee_kind": "agent"})
	if res.StatusCode != 200 {
		t.Fatalf("assign to agent: %d %v", res.StatusCode, out)
	}
	task := out["task"].(map[string]any)
	assignee, _ := task["assignee"].(map[string]any)
	if task["assignee_kind"] != "agent" || assignee == nil || assignee["kind"] != "agent" || assignee["display_name"] != "UNI Alpha" {
		t.Fatalf("resolved assignee: %v", task)
	}

	// A second agent is created by the org owner and refused for a bad handle.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/unicom/agents", w.token,
		map[string]string{"name": "Reviewer", "handle": "Not Valid"})
	if res.StatusCode != 400 {
		t.Fatalf("bad handle: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/unicom/agents", w.token,
		map[string]string{"name": "Reviewer", "handle": "reviewer"})
	if res.StatusCode != 201 {
		t.Fatalf("create agent: %d %v", res.StatusCode, out)
	}
	reviewerID := out["agent"].(map[string]any)["id"].(string)
	// Not in the workspace yet: assigning is a 422 with a stable code.
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/tasks/"+w.taskID, w.token,
		map[string]string{"assignee_id": reviewerID, "assignee_kind": "agent"})
	if res.StatusCode != 422 || out["error"].(map[string]any)["code"] != "agent_not_member" {
		t.Fatalf("assign non-member agent: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/agents", w.token, map[string]string{"agent_id": reviewerID})
	if res.StatusCode != 201 {
		t.Fatalf("add agent to workspace: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/tasks/"+w.taskID, w.token,
		map[string]string{"assignee_id": reviewerID, "assignee_kind": "agent"})
	if res.StatusCode != 200 {
		t.Fatalf("assign member agent: %d %v", res.StatusCode, out)
	}

	// Comments carry the author actor.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/tasks/"+w.taskID+"/comments", w.token, map[string]string{"body": "ok"})
	if res.StatusCode != 200 {
		t.Fatalf("comment: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/tasks/"+w.taskID+"/comments", w.token, nil)
	c := out["comments"].([]any)[0].(map[string]any)
	if res.StatusCode != 200 || c["author_kind"] != "human" || c["author"].(map[string]any)["display_name"] != "Audit" {
		t.Fatalf("comment author: %d %v", res.StatusCode, c)
	}
}

// An outsider never learns the agent exists.
func TestAgentEndpointsRefuseAnOutsider(t *testing.T) {
	w := newAuditWorld(t)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "outsider@example.com", "password": "password123", "display_name": "Out",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	other := out["access_token"].(string)
	verifyEmail(t, w.srv, other)

	if res, _ := doJSON(t, w.srv, "GET", "/api/v1/orgs/unicom/agents", other, nil); res.StatusCode != 404 {
		t.Fatalf("outsider lists org agents: %d", res.StatusCode)
	}
	if res, _ := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/agents", other, nil); res.StatusCode != 403 {
		t.Fatalf("outsider lists workspace agents: %d", res.StatusCode)
	}
	_, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/unicom/agents", w.token, nil)
	uniID := out["agents"].([]any)[0].(map[string]any)["id"].(string)
	if res, _ := doJSON(t, w.srv, "PATCH", "/api/v1/agents/"+uniID, other, map[string]string{"name": "X"}); res.StatusCode != 404 {
		t.Fatalf("outsider patches agent: %d", res.StatusCode)
	}
}
