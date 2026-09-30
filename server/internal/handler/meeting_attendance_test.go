package handler

import (
	"net/http"
	"testing"
)

func TestAttendanceHTTPFlow(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "att-host@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": "att-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": "att-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get attendance: %d %v", res.StatusCode, out)
	}
	rows := out["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows = %v", rows)
	}
	hostRow := rows[0].(map[string]any)
	pid := hostRow["participant_id"].(string)
	if hostRow["status"] != "ABSENT" || hostRow["source"] != "SUGGESTED" || hostRow["standing"] != "MEMBER" {
		t.Fatalf("host row = %v", hostRow)
	}
	if out["summary"].(map[string]any)["members"].(float64) != 1 {
		t.Fatalf("summary = %v", out["summary"])
	}

	res, out = doJSON(t, srv, "PUT", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, map[string]string{"status": "WRONG"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad status: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, map[string]string{"status": "PRESENT"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mark: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/attendance/finalize", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("finalize: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "DELETE", "/api/v1/meetings/"+meetingID+"/attendance/"+pid, token, nil)
	if res.StatusCode != http.StatusConflict || out["error"].(map[string]any)["code"] != "attendance_finalized" {
		t.Fatalf("clear after finalize: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", token, nil)
	if s, _ := out["finalized_at"].(string); s == "" {
		t.Fatalf("finalized_at missing: %v", out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/attendance/reopen", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reopen: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "PATCH", "/api/v1/meetings/"+meetingID+"/participants/"+pid, token, map[string]any{"standing": "OBSERVER"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("patch participant: %d %v", res.StatusCode, out)
	}
	if out["participant"].(map[string]any)["standing"] != "OBSERVER" {
		t.Fatalf("participant = %v", out["participant"])
	}
	res, out = doJSON(t, srv, "PATCH", "/api/v1/meetings/"+meetingID, token, map[string]any{"quorum_percent": 60})
	if res.StatusCode != http.StatusOK || out["meeting"].(map[string]any)["quorum_percent"].(float64) != 60 {
		t.Fatalf("patch quorum: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", "", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous attendance: %d %v", res.StatusCode, out)
	}
}
