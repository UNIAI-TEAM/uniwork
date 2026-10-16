package handler

// G8-18 (UNI-1413): GET mention-candidates takes include=no_access; rows then
// carry can_view, and the flag is ignored for a caller who may not list the
// workspace's members.

import (
	"context"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentMentionCandidatesIncludeNoAccessRoute(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Mention no access", "restricted")
	w.share(t, docID, w.viewerID, service.DocumentLevelView)
	path := "/api/v1/documents/" + docID + "/mention-candidates"

	// Default shape: only readers, no can_view key at all.
	res, out := doJSON(t, w.srv, "GET", path, w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("default: %d %v", res.StatusCode, out)
	}
	for _, raw := range out["candidates"].([]any) {
		if _, ok := raw.(map[string]any)["can_view"]; ok {
			t.Fatalf("can_view present without include=no_access: %v", raw)
		}
	}

	// include=no_access: every row carries can_view, the unshared member is
	// there as false, the shared viewer and the owner as true.
	res, out = doJSON(t, w.srv, "GET", path+"?include=no_access", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("include=no_access: %d %v", res.StatusCode, out)
	}
	canView := map[string]bool{}
	for _, raw := range out["candidates"].([]any) {
		row := raw.(map[string]any)
		v, ok := row["can_view"].(bool)
		if !ok {
			t.Fatalf("row without can_view: %v", row)
		}
		canView[row["user_id"].(string)] = v
	}
	if !canView[w.userID] || !canView[w.viewerID] {
		t.Errorf("owner/viewer should be can_view=true: %v", canView)
	}
	if v, ok := canView[w.memberID]; !ok || v {
		t.Errorf("the unshared workspace member = %v/%v, want listed with can_view=false", v, ok)
	}

	// Any other value of include is ignored: the old readers-only shape.
	res, out = doJSON(t, w.srv, "GET", path+"?include=everything", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("include=everything: %d", res.StatusCode)
	}
	for _, raw := range out["candidates"].([]any) {
		if _, ok := raw.(map[string]any)["can_view"]; ok {
			t.Fatalf("an unknown include value produced can_view: %v", raw)
		}
	}

	// A share reader who holds no workspace row may not list members, so the
	// flag is ignored for them too.
	guest, guestID := filesRegister(t, w.srv, "mention-noaccess-guest@example.com")
	if err := w.q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: guestID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	w.share(t, docID, guestID, service.DocumentLevelView)
	res, out = doJSON(t, w.srv, "GET", path+"?include=no_access", guest, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("guest: %d %v", res.StatusCode, out)
	}
	for _, raw := range out["candidates"].([]any) {
		if _, ok := raw.(map[string]any)["can_view"]; ok {
			t.Fatalf("a caller who may not list members got can_view: %v", raw)
		}
	}
}
