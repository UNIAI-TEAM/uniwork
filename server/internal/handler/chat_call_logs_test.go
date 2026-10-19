package handler

import (
	"net/http"
	"net/url"
	"testing"
)

// placeChatCall rings a room and ends the call: answered by answerTok when it
// is set, otherwise hung up unanswered by the caller.
func placeChatCall(t *testing.T, f *chatFixture, roomID, callID, callerTok, answerTok string) {
	t.Helper()
	base := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + roomID + "/voice"
	steps := []struct{ step, tok string }{{"invite", callerTok}, {"accept", answerTok}, {"hangup", callerTok}}
	for _, s := range steps {
		if s.tok == "" {
			continue
		}
		res, out := doJSON(t, f.srv, "POST", base+"/"+s.step, s.tok, map[string]string{"call_id": callID})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("voice %s %s: %d %v", s.step, callID, res.StatusCode, out)
		}
	}
}

func listCallLogs(t *testing.T, f *chatFixture, tok, query string) (int, []map[string]any, any) {
	t.Helper()
	res, out := doJSON(t, f.srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/call-logs"+query, tok, nil)
	raw, _ := out["call_logs"].([]any)
	logs := make([]map[string]any, 0, len(raw))
	for _, r := range raw {
		logs = append(logs, r.(map[string]any))
	}
	return res.StatusCode, logs, out["next_cursor"]
}

func callIDs(logs []map[string]any) []string {
	ids := make([]string, 0, len(logs))
	for _, l := range logs {
		ids = append(ids, l["call_id"].(string))
	}
	return ids
}

func sameIDs(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func TestChatCallLogsHTTP(t *testing.T) {
	f := setupChatFixture(t, "call-logs")
	a, b, c, d := f.tokens["a"], f.tokens["b"], f.tokens["c"], f.tokens["d"]
	const group, missed, answered = "c1a11000-0000-4000-8000-000000000001", "c1a11000-0000-4000-8000-000000000002", "c1a11000-0000-4000-8000-000000000003"
	placeChatCall(t, f, f.groupRoomID, group, a, b)
	placeChatCall(t, f, f.dmRoomID, missed, a, "")
	placeChatCall(t, f, f.dmRoomID, answered, b, a)

	status, logs, next := listCallLogs(t, f, a, "")
	if status != http.StatusOK || !sameIDs(callIDs(logs), []string{answered, missed, group}) || next != nil {
		t.Fatalf("a: %d %v next=%v, want newest first across the dm and the group", status, callIDs(logs), next)
	}
	dm := logs[1]
	if dm["room_id"] != f.dmRoomID || dm["room_kind"] != "dm" || dm["room_name"] != "Chat B" || dm["peer_user_id"] != f.ids["b"] {
		t.Fatalf("a's dm row names the peer: %v", dm)
	}
	if dm["outcome"] != "unanswered" || dm["caller_id"] != f.ids["a"] || dm["caller_name"] != "Chat A" || dm["message_id"] == "" {
		t.Fatalf("missed row: %v", dm)
	}
	if g := logs[2]; g["room_kind"] != "group" || g["room_name"] != "Group call-logs" || g["outcome"] != "completed" || g["peer_user_id"] != nil {
		t.Fatalf("group row: %v", g)
	} else if parts, _ := g["participants"].([]any); len(parts) < 2 {
		t.Fatalf("group row participants: %v", g["participants"])
	}

	status, page1, next := listCallLogs(t, f, a, "?limit=2")
	cursor, _ := next.(string)
	if status != http.StatusOK || !sameIDs(callIDs(page1), []string{answered, missed}) || cursor == "" {
		t.Fatalf("page 1: %d %v next=%v", status, callIDs(page1), next)
	}
	status, page2, next := listCallLogs(t, f, a, "?limit=2&cursor="+url.QueryEscape(cursor))
	if status != http.StatusOK || !sameIDs(callIDs(page2), []string{group}) || next != nil {
		t.Fatalf("page 2: %d %v next=%v", status, callIDs(page2), next)
	}

	// Only the rooms the caller is in: C is in the group, D in neither room.
	if status, logs, _ := listCallLogs(t, f, c, ""); status != http.StatusOK || !sameIDs(callIDs(logs), []string{group}) {
		t.Fatalf("c: %d %v, want the group call only", status, callIDs(logs))
	}
	if status, logs, _ := listCallLogs(t, f, d, ""); status != http.StatusOK || len(logs) != 0 {
		t.Fatalf("d: %d %v, want none", status, callIDs(logs))
	}

	// A DM whose peer the caller blocked leaves the list, as it leaves the sidebar.
	if res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/users/"+f.ids["a"]+"/block", b, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("block: %d %v", res.StatusCode, out)
	}
	if status, logs, _ := listCallLogs(t, f, b, ""); status != http.StatusOK || !sameIDs(callIDs(logs), []string{group}) {
		t.Fatalf("b after blocking a: %d %v", status, callIDs(logs))
	}

	if status, _, _ := listCallLogs(t, f, a, "?cursor=not-a-cursor"); status != http.StatusBadRequest {
		t.Fatalf("bad cursor: %d, want 400", status)
	}
	outsider, _ := registerChatUser(t, f.srv, "call-logs-outsider@example.com", "Outsider")
	if status, _, _ := listCallLogs(t, f, outsider, ""); status != http.StatusForbidden && status != http.StatusNotFound {
		t.Fatalf("outsider: %d, want 403/404", status)
	}
}
