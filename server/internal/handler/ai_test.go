package handler

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Owner asks about an overdue task and gets a cited answer; a plain member
// can ask but cannot read usage; nobody reads another person's conversation.
func TestAIEndpoints(t *testing.T) {
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	q := db.New(pool)
	ctx := context.Background()

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "owner@example.com", "password": "password123", "display_name": "Owner"})
	if res.StatusCode != 200 {
		t.Fatalf("register owner: %d %v", res.StatusCode, out)
	}
	owner := out["access_token"].(string)
	verifyEmail(t, srv, owner)
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "member@example.com", "password": "password123", "display_name": "Member"})
	if res.StatusCode != 200 {
		t.Fatalf("register member: %d %v", res.StatusCode, out)
	}
	member := out["access_token"].(string)
	memberID := out["user"].(map[string]any)["id"].(string)
	verifyEmail(t, srv, member)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", owner, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", owner, map[string]string{"name": "Đội", "slug": "doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: orgID, UserID: memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsID, UserID: memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", owner, map[string]any{"title": "Viết spec F-09", "due_date": yesterday})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/capabilities", member, nil)
	if res.StatusCode != 200 || out["enabled"] != true || out["ask_uni"] != true {
		t.Fatalf("capabilities: %d %v", res.StatusCode, out)
	}
	if quota := out["quota"].(map[string]any); quota["limit_tokens"] != float64(500000) {
		t.Fatalf("quota: %v", quota)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", member, map[string]any{"question": "task nào quá hạn?", "locale": "vi"})
	if res.StatusCode != 200 {
		t.Fatalf("ask: %d %v", res.StatusCode, out)
	}
	convID := out["conversation_id"].(string)
	msg := out["message"].(map[string]any)
	cites := msg["citations"].([]any)
	if len(cites) != 1 || cites[0].(map[string]any)["href"] != "/unicom/doi/tasks/"+taskID || msg["role"] != "assistant" {
		t.Fatalf("answer: %v", out)
	}
	if usage := out["usage"].(map[string]any); usage["input_tokens"].(float64) <= 0 {
		t.Fatalf("usage: %v", usage)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", member, map[string]any{"question": "   "})
	if res.StatusCode != 400 {
		t.Fatalf("empty question: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/conversations", member, nil)
	if res.StatusCode != 200 || len(out["conversations"].([]any)) != 1 {
		t.Fatalf("conversations: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+convID+"/messages", member, nil)
	if res.StatusCode != 200 || len(out["messages"].([]any)) != 2 {
		t.Fatalf("messages: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+convID+"/messages", owner, nil)
	if res.StatusCode != 404 {
		t.Fatalf("owner reads member's conversation: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/usage", member, nil)
	if res.StatusCode != 403 {
		t.Fatalf("member reads usage: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/usage?from="+yesterday, owner, nil)
	if res.StatusCode != 200 || len(out["rows"].([]any)) != 1 {
		t.Fatalf("workspace usage: %d %v", res.StatusCode, out)
	}
	row := out["rows"].([]any)[0].(map[string]any)
	if row["capability"] != "copilot_answer" || row["actor_kind"] != "human" || row["calls"] != float64(1) {
		t.Fatalf("usage row: %v", row)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/"+orgID+"/ai/usage", owner, nil)
	if res.StatusCode != 200 || out["rows"].([]any)[0].(map[string]any)["workspace_id"] != wsID {
		t.Fatalf("org usage: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "DELETE", "/api/v1/ai/conversations/"+convID, owner, nil)
	if res.StatusCode != 404 {
		t.Fatalf("owner deletes member's conversation: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "DELETE", "/api/v1/ai/conversations/"+convID, member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
}

func TestAIDisabledHidesFeature(t *testing.T) {
	t.Setenv("AI_PROVIDER", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("OLLAMA_BASE_URL", "")
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "solo@example.com", "password": "password123", "display_name": "Solo"})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Solo", "slug": "solo"})
	if res.StatusCode != 201 {
		t.Fatalf("org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Một", "slug": "mot"})
	if res.StatusCode != 201 {
		t.Fatalf("ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/capabilities", token, nil)
	if res.StatusCode != 200 || out["enabled"] != false {
		t.Fatalf("capabilities: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", token, map[string]any{"question": "?"})
	if res.StatusCode != 503 || out["error"].(map[string]any)["code"] != "ai_disabled" {
		t.Fatalf("ask while disabled: %d %v", res.StatusCode, out)
	}
}
