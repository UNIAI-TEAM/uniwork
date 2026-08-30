package service

import (
	"encoding/json"
	"testing"
)

// The frontend parses this payload with a snake_case schema and silently
// falls back to null on a mismatch, which hid every count in the UI once.
func TestWorkspaceMeetingStatsJSONKeys(t *testing.T) {
	b, err := json.Marshal(WorkspaceMeetingStats{Total: 3, InProgress: 1})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"total", "scheduled", "in_progress", "ended", "canceled", "avg_approval_seconds", "invite_links_expired"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing key %q in %s", k, b)
		}
	}
	if m["in_progress"] != float64(1) {
		t.Errorf("in_progress = %v", m["in_progress"])
	}
}
