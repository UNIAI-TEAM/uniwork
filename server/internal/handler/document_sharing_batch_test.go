package handler

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-1641: POST /documents/{id}/shares/batch next to the unchanged single
// route. Real router, real DB, real DocumentService.
func TestDocumentShareBatch(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Batch", "kind": "page", "visibility": "restricted"})
	_, memberA := docsJoinWorkspace(t, w, "docs-batch-a@example.com")
	_, memberB := docsJoinWorkspace(t, w, "docs-batch-b@example.com")
	path := "/api/v1/documents/" + doc + "/shares/batch"

	// 201: one share per distinct principal, in request order.
	res, out := doJSON(t, w.srv, "POST", path, w.token, map[string]any{
		"principal_ids": []string{memberB, memberA, memberB}, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("batch share: %d %v", res.StatusCode, out)
	}
	shares, _ := out["shares"].([]any)
	if len(shares) != 2 {
		t.Fatalf("shares = %v, want 2", out["shares"])
	}
	for i, want := range []string{memberB, memberA} {
		sh := shares[i].(map[string]any)
		if sh["principal_type"] != "user" || sh["principal_id"] != want || sh["level"] != "view" || sh["active"] != true || sh["id"] == "" {
			t.Fatalf("shares[%d] = %v", i, sh)
		}
	}

	// comment is a level of its own on the batch route.
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{
		"principal_ids": []string{memberA}, "level": "comment"})
	if res.StatusCode != 201 {
		t.Fatalf("batch share at comment: %d %v", res.StatusCode, out)
	}
	if sh, _ := out["shares"].([]any); len(sh) != 1 || sh[0].(map[string]any)["level"] != "comment" {
		t.Fatalf("comment shares = %v", out["shares"])
	}
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{
		"principal_ids": []string{memberA}, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("batch share back to view: %d %v", res.StatusCode, out)
	}

	// 422 names the offending ids (request order) and writes nothing.
	unknown := util.NewID()
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{
		"principal_ids": []string{memberA, w.outsider, unknown}, "level": "edit"})
	wantErr(t, res, out, 422, "principal_not_in_organization", "")
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	bad, _ := fields["principal_ids"].([]any)
	if len(bad) != 2 || bad[0] != w.outsider || bad[1] != unknown {
		t.Fatalf("error.fields.principal_ids = %v, want [outsider, unknown]", fields["principal_ids"])
	}
	_, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	for _, raw := range out["shares"].([]any) {
		if raw.(map[string]any)["level"] != "view" {
			t.Fatalf("refused batch changed a grant: %v", out["shares"])
		}
	}

	// 400 empty list; 422 above the cap carries fields.max.
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"principal_ids": []string{}, "level": "view"})
	wantErr(t, res, out, 400, "invalid_request", "")
	many := make([]string, 51)
	for i := range many {
		many[i] = util.NewID()
	}
	res, out = doJSON(t, w.srv, "POST", path, w.token, map[string]any{"principal_ids": many, "level": "view"})
	wantErr(t, res, out, 422, "share_batch_too_large", "")
	errObj, _ = out["error"].(map[string]any)
	if fields, _ := errObj["fields"].(map[string]any); fields["max"] != float64(50) {
		t.Fatalf("error.fields = %v, want max=50", errObj["fields"])
	}

	// The single route keeps its body and its `share` envelope.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberA, "level": "edit"})
	if res.StatusCode != 201 {
		t.Fatalf("single share: %d %v", res.StatusCode, out)
	}
	if sh, _ := out["share"].(map[string]any); sh["principal_id"] != memberA || sh["level"] != "edit" {
		t.Fatalf("single share = %v", out)
	}
}
