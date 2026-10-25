package handler

import "testing"

// Fix round 1 (review): a PUT without the field must not switch auto
// summaries off for the whole organization.
func TestMeetingSettingsPutNeedsTheField(t *testing.T) {
	w := newDocsWorld(t)
	path := "/api/v1/orgs/" + w.orgID + "/meetings/settings"
	res, out := doJSON(t, w.srv, "PUT", path, w.token, map[string]any{})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("PUT {}: %d %v, want 400 invalid_request", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", path, w.token, nil)
	if res.StatusCode != 200 || out["auto_summary_enabled"] != true {
		t.Fatalf("after PUT {}: %d %v, want still on", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "PUT", path, w.token, map[string]any{"auto_summary_enabled": false})
	if res.StatusCode != 200 || out["auto_summary_enabled"] != false || out["organization_id"] != w.orgID {
		t.Fatalf("owner switch: %d %v", res.StatusCode, out)
	}
	member, _ := docsJoinWorkspace(t, w, "meeting-settings-member@example.com")
	res, out = doJSON(t, w.srv, "PUT", path, member, map[string]any{"auto_summary_enabled": true})
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("member PUT: %d %v, want 403 forbidden", res.StatusCode, out)
	}
}
