package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSummaryLocaleIsAClosedSet(t *testing.T) {
	for raw, want := range map[string]string{"": "vi", "vi": "vi", "EN": "en", " en ": "en", "fr": "vi", "en-US": "vi"} {
		if got := summaryLocale(raw); got != want {
			t.Errorf("summaryLocale(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestMeetingActionItemsHTTP(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Meetings.Tasks = d.Tasks
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	host, _ := registerChatUser(t, srv, "act-host@example.com", "Host")
	_, out := doJSON(t, srv, "POST", "/api/v1/orgs", host, map[string]string{"name": "Org", "slug": "act-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", host, map[string]string{"name": "WS", "slug": "act-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	member, memberID := docsJoinWorkspace(t, &docsWorld{srv: srv, token: host, wsID: wsID}, "act-minh@example.com")
	res, out := doJSON(t, srv, "PATCH", "/api/v1/me", member, map[string]string{"display_name": "Minh"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename member: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", host, map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	base := "/api/v1/meetings/" + meetingID + "/action-items"

	res, out = doJSON(t, srv, "POST", base, member, map[string]any{"title": "x"})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_clerk" {
		t.Fatalf("member added: %d %v", res.StatusCode, out)
	}
	add := func(body map[string]any) string {
		t.Helper()
		res, out := doJSON(t, srv, "POST", base, host, body)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("add %v: %d %v", body, res.StatusCode, out)
		}
		item := out["item"].(map[string]any)
		if item["source"] != "MANUAL" || item["status"] != "PENDING" {
			t.Fatalf("added item: %v", item)
		}
		return item["id"].(string)
	}
	reportID := add(map[string]any{"title": "Gửi báo cáo", "owner_text": "Minh", "due_text": "ngày mai"})
	roomID := add(map[string]any{"title": "Đặt phòng"})

	// Any member reads the list; the summary no longer carries the items.
	res, out = doJSON(t, srv, "GET", base, member, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	items := out["items"].([]any)
	first := items[0].(map[string]any)
	if first["id"] != reportID || first["suggested_assignee_id"] != memberID || first["suggested_due_date"] == nil || first["task"] != nil {
		t.Fatalf("first item before conversion: %v", first)
	}
	if counts := out["counts"].(map[string]any); counts["pending"] != float64(2) {
		t.Fatalf("counts: %v", counts)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/summary", member, nil)
	if res.StatusCode != http.StatusOK || out["summary"] != nil {
		t.Fatalf("no summary yet: %d %v", res.StatusCode, out)
	}

	convert := map[string]any{"items": []any{map[string]any{"action_item_id": reportID, "assignee_id": nil, "due_date": ""}}}
	res, out = doJSON(t, srv, "POST", base+"/convert", member, convert)
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_clerk" {
		t.Fatalf("member converted: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/convert", host, map[string]any{"items": []any{map[string]any{"title": "x"}}})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("no action_item_id: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/convert", host, convert)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("convert: %d %v", res.StatusCode, out)
	}
	links := out["links"].([]any)
	link := links[0].(map[string]any)
	taskID, _ := link["task_id"].(string)
	if len(links) != 1 || link["action_item_id"] != reportID || taskID == "" {
		t.Fatalf("convert answer: %v", out)
	}
	// Null assignee and empty due date are the clerk's "none": the owner
	// that names Minh and the parseable "ngày mai" are not applied.
	_, out = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, host, nil)
	task := out["task"].(map[string]any)
	if task["assignee_id"] != nil || task["due_date"] != nil {
		t.Fatalf("explicit none was re-resolved: %v", task)
	}

	res, out = doJSON(t, srv, "POST", base+"/convert", host, convert)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "action_item_not_pending" {
		t.Fatalf("second conversion: %d %v", res.StatusCode, out)
	}
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if raw, _ := json.Marshal(fields["action_item_ids"]); string(raw) != `["`+reportID+`"]` {
		t.Fatalf("fields: %v", fields)
	}
	_, out = doJSON(t, srv, "GET", base, host, nil)
	if got := out["items"].([]any)[0].(map[string]any); got["status"] != "CONVERTED" || got["task"].(map[string]any)["id"] != taskID {
		t.Fatalf("after conversion: %v", got)
	}

	// Dismiss with a reason, restore, and restore again (409).
	res, out = doJSON(t, srv, "POST", base+"/"+roomID+"/dismiss", host, map[string]any{"reason": "Trùng"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("dismiss: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", base, host, nil)
	if got := out["items"].([]any)[1].(map[string]any); got["status"] != "DISMISSED" || got["dismiss_reason"] != "Trùng" || got["dismissed_at"] == nil {
		t.Fatalf("after dismiss: %v", got)
	}
	if res, out = doJSON(t, srv, "POST", base+"/"+roomID+"/restore", host, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/"+roomID+"/restore", host, nil)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "action_item_not_dismissed" {
		t.Fatalf("restore twice: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/summary/tasks", host, map[string]any{})
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("the retired route still answers: %d %v", res.StatusCode, out)
	}
}
