package handler

import (
	"net/http"
	"testing"
	"time"
)

// UNI-2247: the venue goes in on create and patch and comes back on the meeting.
func TestMeetingVenueOnTheWire(t *testing.T) {
	f := setupChatFixture(t, "venue")
	start := time.Now().Add(24 * time.Hour).UTC()
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings", f.tokens["a"], map[string]any{
		"title": "Họp phòng 3", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339),
		"venue": "in_person",
	})
	m, _ := out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || m["venue"] != "in_person" {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "PATCH", "/api/v1/meetings/"+m["id"].(string), f.tokens["a"], map[string]any{"venue": "online"})
	m, _ = out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || m["venue"] != "online" {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "PATCH", "/api/v1/meetings/"+m["id"].(string), f.tokens["a"], map[string]any{"venue": "hybrid"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("patch hybrid: %d %v", res.StatusCode, out)
	}
}
