package handler

import (
	"net/http"
	"slices"
	"testing"
)

// The beat answers with who is online; the leave answers status only. A page
// learns its peers from the answer, since the server publishes only changes.
func TestChatPresenceBeatAnswersWithTheOnlineMembers(t *testing.T) {
	f := setupChatFixture(t, "presence")
	path := "/api/v1/workspaces/" + f.wsID + "/chat/presence"
	onlineIDs := func(out map[string]any) []string {
		raw, _ := out["online_user_ids"].([]any)
		ids := make([]string, 0, len(raw))
		for _, v := range raw {
			ids = append(ids, v.(string))
		}
		slices.Sort(ids)
		return ids
	}

	res, out := doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]string{"state": "online"})
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("beat a: %d %v", res.StatusCode, out)
	}
	if got := onlineIDs(out); !slices.Equal(got, []string{f.ids["a"]}) {
		t.Fatalf("a's snapshot = %v", got)
	}

	res, out = doJSON(t, f.srv, "POST", path, f.tokens["b"], map[string]string{})
	want := []string{f.ids["a"], f.ids["b"]}
	slices.Sort(want)
	if res.StatusCode != http.StatusOK || !slices.Equal(onlineIDs(out), want) {
		t.Fatalf("beat b: %d %v, want %v", res.StatusCode, out, want)
	}

	res, out = doJSON(t, f.srv, "POST", path, f.tokens["b"], map[string]string{"state": "offline"})
	if _, has := out["online_user_ids"]; res.StatusCode != http.StatusOK || has {
		t.Fatalf("leave b: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]string{"state": "online"})
	if res.StatusCode != http.StatusOK || !slices.Equal(onlineIDs(out), []string{f.ids["a"]}) {
		t.Fatalf("beat a after b left: %d %v", res.StatusCode, out)
	}
}
