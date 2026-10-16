package handler

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// setDocumentsOverride writes one feature_flag_overrides row for `documents`
// the way the admin console does, and drops the provider cache.
func setDocumentsOverride(t *testing.T, scopeType, scopeID string, enabled bool) {
	t.Helper()
	if _, err := db.New(testPool).UpsertFlagOverride(t.Context(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: scopeType, ScopeID: scopeID,
		Enabled: enabled, Note: "documents organization override test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("documents override %s/%s: %v", scopeType, scopeID, err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

// An organization override of `documents` closes the authenticated document
// routes for that organization's members, like it closes its public links and
// MCP tools (UNI-1800): the routes evaluate the flag at the organization the
// path acts in. Another organization is unaffected, a non-member never learns
// the flag state of an organization it does not belong to, and a user
// override still wins over the organization one.
func TestDocumentsFlagOrganizationOverride(t *testing.T) {
	w := newDocsWorld(t)
	_, docA := createPage(t, w, "Kế hoạch tổ chức A", nil)

	tokenB, _ := filesRegister(t, w.srv, "docs-org-b@example.com")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", tokenB, map[string]string{"name": "Docs Org B", "slug": "docs-org-b"})
	if res.StatusCode != 201 {
		t.Fatalf("create org B: %d %v", res.StatusCode, out)
	}
	orgB := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+orgB+"/workspaces", tokenB, map[string]string{"name": "Docs WS B", "slug": "docs-ws-b"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws B: %d %v", res.StatusCode, out)
	}
	wsB := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+wsB+"/documents", tokenB, map[string]any{"title": "Kế hoạch tổ chức B", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("create page B: %d %v", res.StatusCode, out)
	}
	docB := out["document"].(map[string]any)["id"].(string)

	setDocumentsOverride(t, featureflags.ScopeOrganization, w.orgID, false)

	// Every way a route names its organization: the workspace, the document
	// and the organization itself, across the three registration files.
	closedA := []struct{ method, path string }{
		{"GET", "/api/v1/workspaces/" + w.wsID + "/documents"},
		{"POST", "/api/v1/workspaces/" + w.wsID + "/documents"},
		{"GET", "/api/v1/workspaces/" + w.wsID + "/documents/sources"},
		{"GET", "/api/v1/documents/" + docA},
		{"PATCH", "/api/v1/documents/" + docA},
		{"POST", "/api/v1/documents/" + docA + "/office/frame-token"},
		{"GET", "/api/v1/orgs/" + w.orgID + "/documents/favorites"},
		{"GET", "/api/v1/orgs/" + w.orgID + "/documents/settings"},
	}
	for _, tc := range closedA {
		res, out := doJSON(t, w.srv, tc.method, tc.path, w.token, map[string]any{})
		if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
			t.Fatalf("org A off, member %s %s: %d %q, want 404 feature_disabled", tc.method, tc.path, res.StatusCode, code)
		}
	}

	// Organization B keeps its documents.
	for _, path := range []string{"/api/v1/workspaces/" + wsB + "/documents", "/api/v1/documents/" + docB} {
		if res, out := doJSON(t, w.srv, "GET", path, tokenB, nil); res.StatusCode != 200 {
			t.Fatalf("org B with A off, GET %s: %d %v", path, res.StatusCode, out)
		}
	}

	// B's owner naming A's ids gets the refusal it always got, never A's
	// flag state.
	for _, path := range []string{
		"/api/v1/workspaces/" + w.wsID + "/documents",
		"/api/v1/documents/" + docA,
		"/api/v1/orgs/" + w.orgID + "/documents/favorites",
	} {
		res, out := doJSON(t, w.srv, "GET", path, tokenB, nil)
		if code, _ := errCodeClass(out); code == "feature_disabled" || (res.StatusCode != 403 && res.StatusCode != 404) {
			t.Fatalf("non-member GET %s with A off: %d %q, want the plain refusal", path, res.StatusCode, code)
		}
	}

	// user > organization: an override for A's owner reopens the routes for
	// them alone.
	setDocumentsOverride(t, featureflags.ScopeUser, w.userID, true)
	for _, path := range []string{"/api/v1/workspaces/" + w.wsID + "/documents", "/api/v1/documents/" + docA} {
		if res, out := doJSON(t, w.srv, "GET", path, w.token, nil); res.StatusCode != 200 {
			t.Fatalf("user override on, GET %s: %d %v", path, res.StatusCode, out)
		}
	}
}
