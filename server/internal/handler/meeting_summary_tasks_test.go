package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func TestSummaryLocaleIsAClosedSet(t *testing.T) {
	for raw, want := range map[string]string{"": "vi", "vi": "vi", "EN": "en", " en ": "en", "fr": "vi", "en-US": "vi"} {
		if got := summaryLocale(raw); got != want {
			t.Errorf("summaryLocale(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestMeetingSummaryTasksHTTP(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Meetings.Tasks = d.Tasks
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	ctx := context.Background()

	host, hostID := registerChatUser(t, srv, "sum-host@example.com", "Host")
	_, out := doJSON(t, srv, "POST", "/api/v1/orgs", host, map[string]string{"name": "Org", "slug": "sum-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", host, map[string]string{"name": "WS", "slug": "sum-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	member, memberID := docsJoinWorkspace(t, &docsWorld{srv: srv, token: host, wsID: wsID}, "sum-minh@example.com")
	res, out := doJSON(t, srv, "PATCH", "/api/v1/me", member, map[string]string{"display_name": "Minh"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename member: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", host, map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	base := "/api/v1/meetings/" + meetingID + "/summary"

	seed := func(items string) string {
		t.Helper()
		id := util.NewID()
		if _, err := pool.Exec(ctx, `INSERT INTO meeting_summaries
			(id, organization_id, meeting_id, summary, decisions, action_items, model, created_by)
			VALUES ($1, $2, $3, 'Đã chốt.', '[]', $4, 'fake', $5)`, id, orgID, meetingID, items, hostID); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
		return id
	}
	summaryID := seed(`[{"title":"Gửi báo cáo","owner":"Minh","due":"ngày mai"},{"title":"Đặt phòng"}]`)

	res, out = doJSON(t, srv, "GET", base, member, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get summary: %d %v", res.StatusCode, out)
	}
	items := out["summary"].(map[string]any)["action_items"].([]any)
	first := items[0].(map[string]any)
	if first["index"] != float64(0) || first["suggested_assignee_id"] != memberID || first["due_date"] == nil || first["task_id"] != nil {
		t.Fatalf("first item before conversion: %v", first)
	}
	if second := items[1].(map[string]any); second["index"] != float64(1) || second["suggested_assignee_id"] != nil || second["due_date"] != nil {
		t.Fatalf("second item: %v", second)
	}

	convert := map[string]any{"summary_id": summaryID, "items": []any{map[string]any{"index": 0, "assignee_id": nil, "due_date": ""}}}
	res, out = doJSON(t, srv, "POST", base+"/tasks", member, convert)
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_host" {
		t.Fatalf("member converted: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/tasks", host, map[string]any{"items": []any{map[string]any{"index": 0}}})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("no summary_id: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/tasks", host, map[string]any{"summary_id": summaryID, "items": []any{map[string]any{"title": "x"}}})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("no index: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/tasks", host, convert)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("convert: %d %v", res.StatusCode, out)
	}
	taskIDs := out["task_ids"].([]any)
	links := out["items"].([]any)
	taskID := taskIDs[0].(string)
	if len(taskIDs) != 1 || links[0].(map[string]any)["index"] != float64(0) || links[0].(map[string]any)["task_id"] != taskID {
		t.Fatalf("convert answer: %v", out)
	}
	// Null assignee and empty due date are the host's "none": the AI owner
	// that names Minh and the parseable "ngày mai" are not applied.
	_, out = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, host, nil)
	task := out["task"].(map[string]any)
	if task["assignee_id"] != nil || task["due_date"] != nil {
		t.Fatalf("explicit none was re-resolved: %v", task)
	}

	res, out = doJSON(t, srv, "POST", base+"/tasks", host, convert)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "summary_item_already_converted" {
		t.Fatalf("second conversion: %d %v", res.StatusCode, out)
	}
	fields, _ := out["error"].(map[string]any)["fields"].(map[string]any)
	if raw, _ := json.Marshal(fields["indexes"]); string(raw) != "[0]" {
		t.Fatalf("fields: %v", fields)
	}

	_, out = doJSON(t, srv, "GET", base, host, nil)
	items = out["summary"].(map[string]any)["action_items"].([]any)
	if items[0].(map[string]any)["task_id"] != taskID || items[1].(map[string]any)["task_id"] != nil {
		t.Fatalf("task ids after conversion: %v", items)
	}

	seed(`[{"title":"Gửi báo cáo bản mới"}]`)
	res, out = doJSON(t, srv, "POST", base+"/tasks", host, map[string]any{"summary_id": summaryID, "items": []any{map[string]any{"index": 1}}})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "summary_superseded" {
		t.Fatalf("superseded summary: %d %v", res.StatusCode, out)
	}
}
