package handler

import (
	"net/http"
	"testing"
)

func TestCollaborationHTTPRoundTrip(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Collab HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("task = %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "parent",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, body)
	}
	parentID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "reply", "parent_id": parentID,
	})
	if res.StatusCode != 200 {
		t.Fatalf("reply: %d %v", res.StatusCode, body)
	}
	if body["comment"].(map[string]any)["parent_id"] != parentID {
		t.Fatalf("reply parent = %v", body)
	}
	replyID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list comments: %d %v", res.StatusCode, body)
	}
	comments, _ := body["comments"].([]any)
	found := false
	for _, raw := range comments {
		c, _ := raw.(map[string]any)
		if c["id"] != replyID {
			continue
		}
		found = true
		if c["parent_id"] != parentID {
			t.Fatalf("list reply parent_id = %v", c)
		}
		if c["type"] == nil || c["type"] == "" {
			t.Fatalf("list reply missing type: %v", c)
		}
		if c["display_name"] == nil || c["display_name"] == "" {
			t.Fatalf("list reply missing display_name: %v", c)
		}
		author, _ := c["author"].(map[string]any)
		if author["display_name"] == nil || author["display_name"] == "" {
			t.Fatalf("list reply author = %v", author)
		}
	}
	if !found {
		t.Fatalf("list missing reply: %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+parentID+"/resolve", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("resolve: %d %v", res.StatusCode, body)
	}
	if body["comment"].(map[string]any)["resolved_at"] == nil {
		t.Fatalf("resolved = %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+parentID+"/reactions", token, map[string]any{
		"emoji": "👍",
	})
	if res.StatusCode != 200 {
		t.Fatalf("reaction: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/subscribe", token, map[string]any{})
	if res.StatusCode != 200 {
		t.Fatalf("subscribe: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/subscribers", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list subscribers: %d %v", res.StatusCode, body)
	}
	subs, _ := body["subscribers"].([]any)
	if len(subs) < 1 {
		t.Fatalf("subscribers = %v", body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/timeline", token, nil)
	if res.StatusCode != 422 {
		t.Fatalf("timeline stub status = %d %v", res.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "capability_unavailable" {
		t.Fatalf("timeline code = %v", body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("attachments list status = %d %v", res.StatusCode, body)
	}
	atts, _ := body["attachments"].([]any)
	if len(atts) != 0 {
		t.Fatalf("attachments list = %v", body)
	}

	const fakeAttachment = "01J8X4ATTN1P2Q3R4S5T6U7V8"
	res, body = doJSON(t, srv, http.MethodGet, "/api/v1/attachments/"+fakeAttachment, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("get missing attachment status = %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, http.MethodDelete, "/api/v1/attachments/"+fakeAttachment, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("delete missing attachment status = %d %v", res.StatusCode, body)
	}
	for _, p := range []struct {
		method, path string
	}{
		{http.MethodGet, "/api/v1/comments/" + parentID + "/sub-task-preview"},
		{http.MethodPost, "/api/v1/comments/" + parentID + "/sub-tasks"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/comments/trigger-preview"},
	} {
		res, body = doJSON(t, srv, p.method, p.path, token, nil)
		if res.StatusCode != 422 {
			t.Fatalf("%s %s status = %d %v", p.method, p.path, res.StatusCode, body)
		}
		errObj, _ = body["error"].(map[string]any)
		if errObj["code"] != "capability_unavailable" {
			t.Fatalf("%s %s code = %v", p.method, p.path, body)
		}
	}
}
