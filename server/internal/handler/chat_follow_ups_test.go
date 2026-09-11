package handler

import (
	"net/http"
	"testing"
	"time"
)

func TestChatFollowUpHTTP(t *testing.T) {
	f := setupChatFixture(t, "followup-http")
	enableChatWorkHubFlag(t)
	srv, tokA := f.srv, f.tokens["a"]

	res, out := doJSON(t, srv, "POST", roomMessagesPath(f, f.workspaceRoomID), tokA, map[string]string{
		"body": "HTTP follow-up neo",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send message: %d %v", res.StatusCode, out)
	}
	msgID := out["message"].(map[string]any)["id"].(string)

	due := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	createPath := "/api/v1/workspaces/" + f.wsID + "/chat/messages/" + msgID + "/follow-ups"
	res, out = doJSON(t, srv, "POST", createPath, tokA, map[string]any{
		"note": "nhắc HTTP", "due_at": due,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	fu := out["follow_up"].(map[string]any)
	fuID := fu["id"].(string)
	if fu["note"] != "nhắc HTTP" || fu["message_body"] == "" {
		t.Fatalf("create body: %+v", fu)
	}

	res, out = doJSON(t, srv, "POST", createPath, tokA, map[string]any{"note": "cập nhật"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("idempotent create: %d %v", res.StatusCode, out)
	}
	if out["follow_up"].(map[string]any)["id"] != fuID {
		t.Fatalf("idempotent id changed: %v", out)
	}

	listPath := "/api/v1/workspaces/" + f.wsID + "/chat/follow-ups"
	res, out = doJSON(t, srv, "GET", listPath+"?limit=10", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	rows, _ := out["follow_ups"].([]any)
	if len(rows) != 1 {
		t.Fatalf("list len=%d want 1 (%v)", len(rows), out)
	}

	res, out = doJSON(t, srv, "POST", createPath, tokA, map[string]any{
		"due_at": "not-a-date",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad due_at: %d %v", res.StatusCode, out)
	}

	patchPath := "/api/v1/workspaces/" + f.wsID + "/chat/follow-ups/" + fuID
	res, out = doRaw(t, srv, "PATCH", patchPath, tokA, `{"note":"đã sửa","due_at":null,"completed":true}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}
	patched := out["follow_up"].(map[string]any)
	if patched["note"] != "đã sửa" || patched["due_at"] != nil || patched["completed_at"] == nil {
		t.Fatalf("patched: %+v", patched)
	}

	res, out = doJSON(t, srv, "GET", listPath+"?include_completed=true&limit=5", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list completed: %d %v", res.StatusCode, out)
	}
	if len(out["follow_ups"].([]any)) != 1 {
		t.Fatalf("include completed: %v", out)
	}

	res, out = doRaw(t, srv, "PATCH", patchPath, tokA, `{"completed":false}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reopen: %d %v", res.StatusCode, out)
	}
	if out["follow_up"].(map[string]any)["completed_at"] != nil {
		t.Fatalf("reopened still completed: %v", out)
	}

	res, out = doRaw(t, srv, "PATCH", patchPath, tokA, `{"due_at":"bad"}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad patch due: %d %v", res.StatusCode, out)
	}
	res, out = doRaw(t, srv, "PATCH", patchPath, tokA, `{"note":1}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad note: %d %v", res.StatusCode, out)
	}
	res, out = doRaw(t, srv, "PATCH", patchPath, tokA, `{"completed":"yes"}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad completed: %d %v", res.StatusCode, out)
	}

	convertPath := patchPath + "/task"
	res, out = doJSON(t, srv, "POST", convertPath, tokA, map[string]any{})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("convert: %d %v", res.StatusCode, out)
	}
	if out["task"] == nil {
		t.Fatalf("convert body: %v", out)
	}

	res, out = doJSON(t, srv, "POST", roomMessagesPath(f, f.workspaceRoomID), tokA, map[string]string{
		"body": "follow-up để xoá",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send delete target: %d %v", res.StatusCode, out)
	}
	delMsgID := out["message"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/chat/messages/"+delMsgID+"/follow-ups",
		tokA, map[string]any{"note": "xoá"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create delete target: %d %v", res.StatusCode, out)
	}
	delID := out["follow_up"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "DELETE",
		"/api/v1/workspaces/"+f.wsID+"/chat/follow-ups/"+delID, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d %v", res.StatusCode, out)
	}
}
