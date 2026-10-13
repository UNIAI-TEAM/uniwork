package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
)

// changeCursorChecks is the cursor half of the change-feed route (G5-01a):
// the path half is the matrix itself. A's cursor pages A's snapshot for A's
// owner only (a read: it writes no row, so the untouched digest holds); B's
// owner replaying it in B's own workspace gets 400 change_cursor_invalid with
// nothing of A's, and in A's workspace the membership refusal.
func (w *isoWorld) changeCursorChecks(t *testing.T) {
	t.Helper()
	feed := func(tn *isoTenant, cursor string) string {
		return "/api/v1/workspaces/" + tn.wsID + "/documents/changes?limit=1&cursor=" + url.QueryEscape(cursor)
	}
	cursor := w.alpha.ids["changeCursor"]
	if status, raw := w.do(t, http.MethodGet, feed(w.alpha, cursor), w.alpha.token, isoBody{}); status != http.StatusOK {
		t.Fatalf("A's owner replaying A's cursor = %d, want 200: %s", status, isoClip(raw))
	}
	status, raw := w.do(t, http.MethodGet, feed(w.bravo, cursor), w.bravo.token, isoBody{})
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &body)
	if status != http.StatusBadRequest || body.Error.Code != "change_cursor_invalid" {
		t.Errorf("B's owner with A's cursor in B's workspace = %d %s, want 400 change_cursor_invalid", status, isoClip(raw))
	}
	if leak := w.alpha.leakIn(raw, ""); leak != "" {
		t.Errorf("the refusal of A's cursor carries A's %s: %s", leak, isoClip(raw))
	}
	if status, raw := w.do(t, http.MethodGet, feed(w.alpha, cursor), w.bravo.token, isoBody{}); status != http.StatusForbidden && status != http.StatusNotFound {
		t.Errorf("B's owner with A's cursor in A's workspace = %d, want 403/404: %s", status, isoClip(raw))
	} else if leak := w.alpha.leakIn(raw, feed(w.alpha, cursor)); leak != "" {
		t.Errorf("the refusal in A's workspace carries A's %s: %s", leak, isoClip(raw))
	}
}
