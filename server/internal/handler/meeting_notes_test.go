package handler

import (
	"net/http"
	"testing"
)

// UNI-2217: the author or the host edits and deletes a note over HTTP; any
// other member is refused, and a note of another meeting is not found.
func TestMeetingNoteEditAndDeleteHTTP(t *testing.T) {
	f := setupChatFixture(t, "notes")
	_, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	base := "/api/v1/meetings/" + meetingID + "/notes"
	res, out := doJSON(t, f.srv, "POST", base, f.tokens["b"], map[string]any{"body": "Ghi chú của B"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("add note: %d %v", res.StatusCode, out)
	}
	note := out["note"].(map[string]any)
	if note["edited_at"] != nil {
		t.Fatalf("fresh note edited_at = %v, want null", note["edited_at"])
	}
	path := base + "/" + note["id"].(string)

	res, out = doJSON(t, f.srv, "PATCH", path, f.tokens["b"], map[string]any{"body": "B sửa"})
	if res.StatusCode != http.StatusOK || out["note"].(map[string]any)["body"] != "B sửa" || out["note"].(map[string]any)["edited_at"] == nil {
		t.Fatalf("author edits: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "PATCH", path, f.tokens["b"], map[string]any{"body": "  "}); res.StatusCode < 400 || res.StatusCode >= 500 {
		t.Fatalf("blank edit: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "PATCH", path, f.tokens["c"], map[string]any{"body": "C sửa"}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("another member edits: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "DELETE", path, f.tokens["c"], nil); res.StatusCode != http.StatusForbidden {
		t.Fatalf("another member deletes: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "PATCH", path, f.tokens["a"], map[string]any{"body": "Chủ tọa sửa"}); res.StatusCode != http.StatusOK {
		t.Fatalf("host edits: %d %v", res.StatusCode, out)
	}

	_, out = doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Họp khác"})
	otherBase := "/api/v1/meetings/" + out["meeting"].(map[string]any)["id"].(string) + "/notes"
	_, out = doJSON(t, f.srv, "POST", otherBase, f.tokens["a"], map[string]any{"body": "Ở cuộc họp khác"})
	if res, out = doJSON(t, f.srv, "DELETE", base+"/"+out["note"].(map[string]any)["id"].(string), f.tokens["a"], nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("note of another meeting: %d %v", res.StatusCode, out)
	}

	if res, out = doJSON(t, f.srv, "DELETE", path, f.tokens["a"], nil); res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("host deletes: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, f.srv, "GET", base, f.tokens["b"], nil)
	if notes := out["notes"].([]any); len(notes) != 0 {
		t.Fatalf("notes after delete = %v", notes)
	}
}
