package handler

// G8-18 (UNI-1413): POST/PATCH comments answer 201/200 with an additive
// mentions_without_access (the people named who cannot read the document,
// stored without a notification), absent when everyone named can read.

import (
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

func mentionToken(name, id string) string {
	return "[@" + name + "](mention://member/" + id + ")"
}

func TestDocumentCommentAnswersMentionsWithoutAccess(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Mention comment", "restricted")
	w.share(t, docID, w.viewerID, service.DocumentLevelView)
	stranger, strangerID := filesRegister(t, w.srv, "mention-stranger@example.com")
	_ = stranger

	body := mentionToken("Viewer", w.viewerID) + " " + mentionToken("Member", w.memberID) + " " + mentionToken("Stranger", strangerID)
	res, out := doJSON(t, w.srv, "POST", w.commentsPath(docID), w.token, map[string]any{"body": body, "kind": "discussion"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v, want 201 even with non-readers named", res.StatusCode, out)
	}
	rows, ok := out["mentions_without_access"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatalf("mentions_without_access = %v, want the member and the stranger", out["mentions_without_access"])
	}
	byID := map[string]map[string]any{}
	for _, raw := range rows {
		row := raw.(map[string]any)
		if _, ok := row["can_share"].(bool); !ok {
			t.Fatalf("row without can_share: %v", row)
		}
		byID[row["user_id"].(string)] = row
	}
	if byID[w.memberID] == nil || byID[w.memberID]["display_name"] == "" {
		t.Errorf("the organization member has no display_name: %v", byID[w.memberID])
	}
	if byID[strangerID] == nil {
		t.Fatalf("the stranger is missing: %v", rows)
	}
	if _, ok := byID[strangerID]["display_name"]; ok {
		t.Errorf("an id outside the organization carries a display_name: %v", byID[strangerID])
	}
	// The owner holds manage: an active organization member can be shared
	// with, an id outside the organization cannot.
	if byID[w.memberID]["can_share"] != true || byID[strangerID]["can_share"] != false {
		t.Errorf("can_share: member=%v stranger=%v, want true/false", byID[w.memberID]["can_share"], byID[strangerID]["can_share"])
	}
	if byID[w.viewerID] != nil {
		t.Errorf("a reader is reported without access: %v", byID[w.viewerID])
	}

	// PATCH answers the same field from the stored rows.
	id := out["comment"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "PATCH", w.commentsPath(docID)+"/"+id, w.token, map[string]any{"body": body + " edit"})
	if res.StatusCode != http.StatusOK || len(out["mentions_without_access"].([]any)) != 2 {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}

	// Additive and absent when everyone named can read.
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.token, map[string]any{"body": mentionToken("Viewer", w.viewerID), "kind": "discussion"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("readers only: %d %v", res.StatusCode, out)
	}
	if _, ok := out["mentions_without_access"]; ok {
		t.Fatalf("mentions_without_access present for readers only: %v", out)
	}
	res, out = doJSON(t, w.srv, "POST", w.commentsPath(docID), w.token, map[string]any{"body": "no mentions"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("plain: %d", res.StatusCode)
	}
	if _, ok := out["mentions_without_access"]; ok {
		t.Fatalf("mentions_without_access present for a plain comment: %v", out)
	}
}
