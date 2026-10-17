package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// TestDocumentAccessBatchLevelPresenceOverHTTP is the R1-10 regression: an item
// that omits `level` is malformed input and changes nothing, while an explicit
// `"level": null` is the revoke. A `*string` cannot tell the two apart, so the
// handler reads the key's presence before the service sees the item.
func TestDocumentAccessBatchLevelPresenceOverHTTP(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "SH-S2 presence", "kind": "page", "visibility": "restricted",
	})
	_, memberID := docsJoinWorkspace(t, w, "docs-shs2-presence@example.com")

	// Seed a live user grant and a workspace-visible home row through the API.
	res, out := doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit"},
			map[string]any{"principal_type": "workspace", "principal_id": w.wsID, "level": "view"},
		},
	})
	if res.StatusCode != 200 {
		t.Fatalf("seed access: %d %v", res.StatusCode, out)
	}

	before := documentAccessSnapshot(t, w, doc)

	// Missing `level` on an existing user grant -> 400, and nothing moved.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID},
		},
	})
	wantErr(t, res, out, 400, "invalid_request", "")
	if got := documentAccessSnapshot(t, w, doc); got != before {
		t.Fatalf("missing level changed access:\n before=%s\n after =%s", before, got)
	}

	// Missing `level` on the home workspace row -> 400, nothing moved.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "workspace", "principal_id": w.wsID},
		},
	})
	wantErr(t, res, out, 400, "invalid_request", "")
	if got := documentAccessSnapshot(t, w, doc); got != before {
		t.Fatalf("missing level on home row changed access:\n before=%s\n after =%s", before, got)
	}

	// An explicit null still revokes the user grant.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": nil},
		},
	})
	if res.StatusCode != 200 {
		t.Fatalf("explicit null revoke: %d %v", res.StatusCode, out)
	}
	if got := documentAccessSnapshot(t, w, doc); got == before {
		t.Fatalf("explicit null did not revoke: %s", got)
	}
}

// documentAccessSnapshot renders the document's share rows and home visibility
// so a refused request can be shown to have changed nothing.
func documentAccessSnapshot(t *testing.T, w *docsWorld, docID string) string {
	t.Helper()
	var visibility, workspaceLevel string
	if err := testPool.QueryRow(context.Background(),
		`SELECT visibility, workspace_level FROM documents WHERE id = $1`, docID).Scan(&visibility, &workspaceLevel); err != nil {
		t.Fatal(err)
	}
	rows, err := testPool.Query(context.Background(),
		`SELECT principal_type, principal_id, level, revoked_at IS NULL
		   FROM document_shares WHERE document_id = $1 ORDER BY principal_type, principal_id, id`, docID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var b strings.Builder
	fmt.Fprintf(&b, "visibility=%s level=%s", visibility, workspaceLevel)
	for rows.Next() {
		var pt, pid, lvl string
		var live bool
		if err := rows.Scan(&pt, &pid, &lvl, &live); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&b, "|%s/%s=%s(live=%v)", pt, pid, lvl, live)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

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

	// GET /documents/{id}/share-candidates returns candidates with secondary, direct_level (null when none), and is_home_workspace.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/share-candidates?q=docs-shs2-member", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("share-candidates: %d %v", res.StatusCode, out)
	}
	items, _ := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("share-candidates items = %v, want 1", items)
	}
	cand0, _ := items[0].(map[string]any)
	if cand0["secondary"] != "docs-shs2-member@example.com" {
		t.Fatalf("share-candidates[0].secondary = %v, want docs-shs2-member@example.com", cand0["secondary"])
	}
	if _, hasDirect := cand0["direct_level"]; !hasDirect || cand0["direct_level"] != nil {
		t.Fatalf("share-candidates[0].direct_level = %v (present=%v), want explicit null", cand0["direct_level"], hasDirect)
	}

	// PUT /documents/{id}/access with dry_run=true previews without writing (warnings are {code, index}, results carry status + index).
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
	preview, _ := out["preview"].(map[string]any)
	warnings, _ := preview["warnings"].([]any)
	if len(warnings) == 0 {
		t.Fatalf("dry_run preview.warnings = %v, want non-empty {code, index}", warnings)
	}
	w0, _ := warnings[0].(map[string]any)
	if w0["code"] == nil || w0["index"] == nil {
		t.Fatalf("dry_run preview.warnings[0] = %v, want {code, index}", w0)
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
	results, _ := out["results"].([]any)
	if len(results) != 3 {
		t.Fatalf("live PUT /access results = %v, want 3", results)
	}
	r0, _ := results[0].(map[string]any)
	if r0["status"] != "granted" || r0["index"] != float64(0) {
		t.Fatalf("results[0] = %v, want status=granted index=0", r0)
	}

	// Per-item on_existing=keep keeps existing user share at view.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit", "on_existing": "keep"},
		},
	})
	if res.StatusCode != 200 {
		t.Fatalf("keep PUT /access: %d %v", res.StatusCode, out)
	}
	keepRes, _ := out["results"].([]any)[0].(map[string]any)
	if keepRes["status"] != "kept" || keepRes["level"] != "view" {
		t.Fatalf("keep result = %v, want status=kept level=view", keepRes)
	}

	// Revoke uses level: null; level: "none" is refused with 400.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "none"},
		},
	})
	wantErr(t, res, out, 400, "invalid_request", "")

	// GET /documents/{id}/shares as manager returns home_workspace (with workspace_name), my_sources, and user sources + warnings.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("manager GET /shares: %d %v", res.StatusCode, out)
	}
	hw, _ := out["home_workspace"].(map[string]any)
	if hw == nil || hw["workspace_id"] != w.wsID || hw["workspace_name"] == nil || hw["workspace_name"] == "" || hw["visibility"] != "workspace" || hw["level"] != "view" {
		t.Fatalf("home_workspace = %v, want workspace_name set, visibility=workspace, level=view", hw)
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
	ms0, _ := mySources[0].(map[string]any)
	if ms0["via"] == nil || ms0["via"] == "" {
		t.Fatalf("my_sources[0] = %v, want via set", ms0)
	}

	// PUT /documents/{id}/access 422 document_access_rejected with fields.rejected[].code.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+doc+"/access", w.token, map[string]any{
		"items": []any{
			map[string]any{"principal_type": "organization", "principal_id": w.orgID, "level": "manage"},
		},
	})
	wantErr(t, res, out, 422, "document_access_rejected", "")
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	rejList, _ := fields["rejected"].([]any)
	if len(rejList) != 1 || rejList[0].(map[string]any)["code"] != "level_not_allowed" {
		t.Fatalf("422 fields.rejected = %v (out=%v), want [{code: level_not_allowed}]", rejList, out)
	}

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
