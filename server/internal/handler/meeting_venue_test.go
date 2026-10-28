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

// An instant in-person meeting opens no room; the clerk records it held by
// duration and how long ago it stopped, on the server's clock.
func TestInstantInPersonMeetingOnTheWire(t *testing.T) {
	f := setupChatFixture(t, "venue-instant")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]any{
		"title": "Họp nhanh", "venue": "in_person",
	})
	m, _ := out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || m["status"] != "SCHEDULED" || m["venue"] != "in_person" {
		t.Fatalf("instant: %d %v", res.StatusCode, out)
	}
	id := m["id"].(string)
	if res, out := doJSON(t, f.srv, "POST", "/api/v1/meetings/"+id+"/start", f.tokens["a"], nil); res.StatusCode != http.StatusConflict {
		t.Fatalf("start: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "POST", "/api/v1/meetings/"+id+"/held", f.tokens["a"], map[string]any{"duration_seconds": 2520, "ended_seconds_ago": 3600})
	m, _ = out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || m["status"] != "ENDED" {
		t.Fatalf("held: %d %v", res.StatusCode, out)
	}
	start, _ := time.Parse(time.RFC3339, m["actual_start_at"].(string))
	end, _ := time.Parse(time.RFC3339, m["actual_end_at"].(string))
	if d := end.Sub(start); d < 2519*time.Second || d > 2521*time.Second {
		t.Fatalf("held for %v, want 42m", d)
	}
	if ago := time.Since(end) - time.Hour; ago < -5*time.Second || ago > 5*time.Second {
		t.Fatalf("ended %v, want an hour ago", end)
	}
}
