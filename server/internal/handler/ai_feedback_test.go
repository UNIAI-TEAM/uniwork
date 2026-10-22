package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// Rating an answer and renaming a conversation: only the owner reaches either,
// and each refusal is the same 404 a missing id gets.
func TestAiFeedbackAndRename(t *testing.T) {
	t.Setenv("AI_PROVIDER", "fake")
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	register := func(email string) string {
		res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{"email": email, "password": "password123", "display_name": email})
		if res.StatusCode != 200 {
			t.Fatalf("register: %d %v", res.StatusCode, out)
		}
		tok := out["access_token"].(string)
		verifyEmail(t, srv, tok)
		return tok
	}
	owner, other := register("owner@example.com"), register("other@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", owner, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", owner, map[string]string{"name": "Đội", "slug": "doi"})
	if res.StatusCode != 201 {
		t.Fatalf("ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, map[string]any{"question": "task nào quá hạn?"})
	if res.StatusCode != 200 {
		t.Fatalf("ask: %d %v", res.StatusCode, out)
	}
	conv := out["conversation_id"].(string)
	msg := out["message"].(map[string]any)["id"].(string)
	path := "/api/v1/ai/conversations/" + conv + "/messages/" + msg + "/feedback"

	for _, c := range []struct {
		name, method, token, path string
		body                      any
		want                      int
	}{
		{"rate", "PUT", owner, path, map[string]any{"rating": "down", "reason": "wrong_facts", "note": "sai"}, 204},
		{"rate again", "PUT", owner, path, map[string]any{"rating": "up"}, 204},
		{"bad rating", "PUT", owner, path, map[string]any{"rating": "meh"}, 400},
		{"long note", "PUT", owner, path, map[string]any{"rating": "up", "note": strings.Repeat("a", 501)}, 400},
		{"other person", "PUT", other, path, map[string]any{"rating": "up"}, 404},
		{"missing message", "PUT", owner, "/api/v1/ai/conversations/" + conv + "/messages/nope/feedback", map[string]any{"rating": "up"}, 404},
		{"clear", "DELETE", owner, path, nil, 204},
		{"clear again", "DELETE", owner, path, nil, 204},
		{"clear by other", "DELETE", other, path, nil, 404},
		{"rename", "PATCH", owner, "/api/v1/ai/conversations/" + conv, map[string]any{"title": "Việc quá hạn"}, 200},
		{"empty title", "PATCH", owner, "/api/v1/ai/conversations/" + conv, map[string]any{"title": "  "}, 400},
		{"long title", "PATCH", owner, "/api/v1/ai/conversations/" + conv, map[string]any{"title": strings.Repeat("a", 81)}, 400},
		{"rename by other", "PATCH", other, "/api/v1/ai/conversations/" + conv, map[string]any{"title": "x"}, 404},
	} {
		res, out := doJSON(t, srv, c.method, c.path, c.token, c.body)
		if res.StatusCode != c.want {
			t.Errorf("%s: %d %v, want %d", c.name, res.StatusCode, out, c.want)
		}
		if c.name == "rename" && (out["id"] != conv || out["title"] != "Việc quá hạn") {
			t.Errorf("rename answer: %v", out)
		}
	}
}
