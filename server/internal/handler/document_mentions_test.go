package handler

// Handler-level test for GET /documents/{documentID}/mention-candidates
// (G8-06, UNI-1401): the route is wired through the api wrapper over the real
// DocumentService, so the flag gate, auth middleware and permission ladder
// are the ones under test. The answer's shape is the SDO: rows of
// {user_id, display_name, email?}, with the email present only for a caller
// who may list the workspace's members.

import (
	"context"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentMentionCandidatesRoute(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Mention picker", "workspace")
	path := "/api/v1/documents/" + docID + "/mention-candidates"

	// The owner manages the document and may list the members: every row
	// carries the display name, the id and the email. limit is honored, and
	// the folded search matches the emails (the fixture's display names are
	// all "Files"), so the upper-case term finds the same people.
	res, out := doJSON(t, w.srv, "GET", path+"?q=collab&limit=2", w.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mention candidates: %d %v", res.StatusCode, out)
	}
	rows, ok := out["candidates"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatalf("limit 2 answered %v", out["candidates"])
	}
	for _, raw := range rows {
		row := raw.(map[string]any)
		if row["user_id"] == "" || row["display_name"] == "" {
			t.Fatalf("candidate row shape: %v", row)
		}
		if email, _ := row["email"].(string); email == "" {
			t.Fatalf("the owner may list members, yet a row carries no email: %v", row)
		}
	}
	res, out = doJSON(t, w.srv, "GET", path+"?q=COLLAB", w.token, nil)
	if res.StatusCode != http.StatusOK || len(out["candidates"].([]any)) != 4 {
		t.Fatalf("folded search over emails: %d %v", res.StatusCode, out)
	}

	// A member of the organization who holds no workspace row reaches the
	// document through a view share alone: they read the picker, but the
	// emails stay out of their answer. The membership is seeded directly -
	// the invitation route would need a configured mail sender, which this
	// world does not wire.
	guest, guestID := filesRegister(t, w.srv, "collab-guest@example.com")
	if err := w.q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: guestID, Role: "member",
	}); err != nil {
		t.Fatalf("org membership: %v", err)
	}
	w.share(t, docID, guestID, service.DocumentLevelView)

	res, out = doJSON(t, w.srv, "GET", path, guest, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("share reader: %d %v", res.StatusCode, out)
	}
	shared := out["candidates"].([]any)
	if len(shared) == 0 {
		t.Fatalf("the share reader got an empty picker: %v", out)
	}
	for _, raw := range shared {
		if _, ok := raw.(map[string]any)["email"]; ok {
			t.Fatalf("a share reader's row carries an email: %v", raw)
		}
	}

	// Someone in no organization at all is refused like every other document
	// read - not found, never a hint that the document exists.
	res, out = doJSON(t, w.srv, "GET", path, w.outsider, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider = %d %v, want 404", res.StatusCode, out)
	}

	// A limit that is not an integer is a malformed request, not a clamp.
	res, out = doJSON(t, w.srv, "GET", path+"?limit=abc", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusBadRequest || code != "invalid_request" {
		t.Fatalf("limit=abc: %d code=%q", res.StatusCode, code)
	}
}
