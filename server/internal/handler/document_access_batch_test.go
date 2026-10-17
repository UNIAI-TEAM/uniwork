package handler

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestDocumentAccessBatchAndCandidatesOverHTTP covers SH-S2 (UNI-1781) at the
// HTTP layer: PUT /api/v1/documents/{documentID}/access (grant, update, keep,
// revoke, dry_run, and 422 document_access_rejected), GET .../share-candidates,
// GET .../shares (my_sources, home_workspace, user sources + warnings), and
// POST .../shares Q-S1 for organization + manage (D3).
func TestDocumentAccessBatchAndCandidatesOverHTTP(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "SH-S2 HTTP", "kind": "page", "visibility": "restricted",
	})
	memberToken, memberID := docsJoinWorkspace(t, w, "docs-shs2-member@example.com")

	// D3: POST /documents/{id}/shares with organization + manage -> 422 level_not_allowed.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "organization",
		"principal_id":   w.orgID,
		"level":          "manage",
	})
	wantErr(t, res, out, 422, "level_not_allowed", "")

	// GET /documents/{id}/share-candidates returns candidates with is_home_workspace.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/share-candidates?q=docs-shs2-member", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("share-candidates: %d %v", res.StatusCode, out)
	}
	items, _ := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("share-candidates items = %v, want 1", items)
	}

	// PUT /documents/{id}/access with dry_run=true previews without writing.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"dry_run": true,
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "view"},
			map[string]any{"principal_type": "organization", "principal_id": w.orgID, "level": "edit"},
		},
	})
	if res.StatusCode != 200 || out["dry_run"] != true {
		t.Fatalf("dry_run PUT /access: %d %v", res.StatusCode, out)
	}

	// PUT /documents/{id}/access live commit: grants organization edit + user view + home ws view.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "view"},
			map[string]any{"principal_type": "organization", "principal_id": w.orgID, "level": "edit"},
			map[string]any{"principal_type": "workspace", "principal_id": w.wsID, "level": "view"},
		},
	})
	if res.StatusCode != 200 || out["dry_run"] != false {
		t.Fatalf("live PUT /access: %d %v", res.StatusCode, out)
	}

	// GET /documents/{id}/shares as manager returns home_workspace, my_sources, and user sources + warnings.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager GET /shares: %d %v", res.StatusCode, out)
	}
	hw, _ := out["home_workspace"].(map[string]any)
	if hw == nil || hw["workspace_id"] != w.wsID || hw["visibility"] != "workspace" || hw["level"] != "view" {
		t.Fatalf("home_workspace = %v", hw)
	}
	shares, _ := out["shares"].([]any)
	if len(shares) != 2 {
		t.Fatalf("shares = %v, want 2 (user + organization)", shares)
	}

	// GET /documents/{id}/shares as non-manager (memberToken) returns my_level, via, my_sources only (U-SH4).
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", memberToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("member GET /shares: %d %v", res.StatusCode, out)
	}
	mySources, _ := out["my_sources"].([]any)
	if out["my_level"] != "edit" || len(mySources) != 3 || out["home_workspace"] != nil || out["shares"] != nil {
		t.Fatalf("non-manager GET /shares = %v", out)
	}

	// PUT /documents/{id}/access 422 document_access_rejected with fields.rejected[].
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "organization", "principal_id": w.orgID, "level": "manage"},
		},
	})
	wantErr(t, res, out, 422, "document_access_rejected", "")

	// Cross-tenant isolation: neither share-candidates nor the 422 fields.rejected
	// echo ever returns a name or email of another organization.
	foreignToken, foreignUserID := filesRegister(t, w.srv, "foreign-secret@example.com")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs", foreignToken, map[string]string{"name": "Foreign Secret Org", "slug": "foreign-secret-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create foreign org: %d %v", res.StatusCode, out)
	}
	foreignOrgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+foreignOrgID+"/workspaces", foreignToken, map[string]string{"name": "Foreign Secret WS", "slug": "foreign-secret-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create foreign ws: %d %v", res.StatusCode, out)
	}
	foreignWSID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/share-candidates?q=Foreign", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("share-candidates foreign query: %d %v", res.StatusCode, out)
	}
	rawCand, _ := json.Marshal(out)
	if strings.Contains(string(rawCand), "Foreign Secret") || strings.Contains(string(rawCand), "foreign-secret") {
		t.Fatalf("share-candidates leaked foreign tenant name: %s", rawCand)
	}

	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": foreignUserID, "level": "view"},
			map[string]any{"principal_type": "workspace", "principal_id": foreignWSID, "level": "view"},
			map[string]any{"principal_type": "organization", "principal_id": foreignOrgID, "level": "view"},
		},
	})
	wantErr(t, res, out, 422, "document_access_rejected", "")
	rawRej, _ := json.Marshal(out)
	if strings.Contains(string(rawRej), "Foreign Secret") || strings.Contains(string(rawRej), "foreign-secret") {
		t.Fatalf("422 fields.rejected leaked foreign tenant name: %s", rawRej)
	}
}
