package handler

// Handler-level tests for the G1-07 document favorites HTTP surface (UNI-681;
// lane 07b): idempotent add/remove over the real router, the per-user list,
// the live access filter the list re-runs on every row, and the flag gate.

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func favoritePath(documentID string) string {
	return "/api/v1/documents/" + documentID + "/favorite"
}

// disableDocumentsFlag flips the global override the world enabled back to
// false and drops the provider cache, exactly like the flag.updated consumer.
func disableDocumentsFlag(t *testing.T) {
	t.Helper()
	q := db.New(testPool)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID:        util.NewID(),
		FlagKey:   "documents",
		ScopeType: featureflags.ScopeGlobal,
		ScopeID:   "",
		Enabled:   false,
		Note:      "flag flipped off in a test",
		CreatedBy: "test",
	}); err != nil {
		t.Fatalf("disable documents flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

func TestDocumentFavoriteHTTPIdempotent(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "Kế hoạch Q4", "workspace")

	// The member's list starts empty; the add answers the live row plus the
	// document metadata the panel needs.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.member, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 0 {
		t.Fatalf("fresh favorites: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", favoritePath(docID), w.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("favorite: %d %v", res.StatusCode, out)
	}
	fav := out["favorite"].(map[string]any)
	favoriteID := fav["favorite_id"].(string)
	if fav["document_id"] != docID || fav["workspace_id"] != w.wsID || fav["title"] != "Kế hoạch Q4" || fav["kind"] != "page" {
		t.Fatalf("favorite payload: %v", fav)
	}
	if fav["favorited_at"] == "" {
		t.Fatalf("favorited_at missing: %v", fav)
	}

	// A repeat add is the same row, not a second one.
	res, out = doJSON(t, w.srv, "POST", favoritePath(docID), w.member, nil)
	if res.StatusCode != 200 || out["favorite"].(map[string]any)["favorite_id"] != favoriteID {
		t.Fatalf("idempotent favorite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.member, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 1 {
		t.Fatalf("favorites after add: %d %v", res.StatusCode, out)
	}

	// Another member's list is their own - a favorite never leaks across
	// accounts.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.rival, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 0 {
		t.Fatalf("other member's favorites: %d %v", res.StatusCode, out)
	}

	// An outsider cannot ask for the organization's favorites at all.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.outsider, nil)
	if code, class := errCodeClass(out); res.StatusCode != 404 || code != "not_found" || class != "missing" {
		t.Fatalf("outsider favorites: %d code=%q class=%q", res.StatusCode, code, class)
	}

	// Remove is idempotent in both directions.
	res, out = doJSON(t, w.srv, "DELETE", favoritePath(docID), w.member, nil)
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("unfavorite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", favoritePath(docID), w.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("idempotent unfavorite: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.member, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 0 {
		t.Fatalf("favorites after remove: %d %v", res.StatusCode, out)
	}
}

// TestDocumentFavoriteListFollowsLiveAccess proves the list is filtered at
// read time: a revoked share drops the document out while the favorite row
// survives, and a re-grant brings it back.
func TestDocumentFavoriteListFollowsLiveAccess(t *testing.T) {
	w := newDocumentCollabWorld(t)
	restricted := w.createDoc(t, w.token, "Bí mật", "restricted")
	w.share(t, restricted, w.viewerID, service.DocumentLevelView)

	res, out := doJSON(t, w.srv, "POST", favoritePath(restricted), w.viewer, nil)
	if res.StatusCode != 200 {
		t.Fatalf("viewer favorite: %d %v", res.StatusCode, out)
	}
	listPath := "/api/v1/orgs/" + w.orgID + "/documents/favorites"
	res, out = doJSON(t, w.srv, "GET", listPath, w.viewer, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 1 {
		t.Fatalf("viewer favorites: %d %v", res.StatusCode, out)
	}

	// Revoke the share: the next list re-checks access and drops the row, but
	// the favorite itself is still stored.
	shareRow, err := w.docs.ShareDocument(context.Background(), service.Human(w.userID), restricted, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   w.viewerID,
		Level:         service.DocumentLevelView,
	})
	if err != nil {
		t.Fatalf("read share: %v", err)
	}
	if err := w.docs.RevokeDocumentShare(context.Background(), service.Human(w.userID), restricted, shareRow.ID); err != nil {
		t.Fatalf("revoke share: %v", err)
	}
	res, out = doJSON(t, w.srv, "GET", listPath, w.viewer, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 0 {
		t.Fatalf("favorites after revoke: %d %v", res.StatusCode, out)
	}

	// Grant it again: the stored favorite returns.
	w.share(t, restricted, w.viewerID, service.DocumentLevelView)
	res, out = doJSON(t, w.srv, "GET", listPath, w.viewer, nil)
	if res.StatusCode != 200 || len(out["favorites"].([]any)) != 1 {
		t.Fatalf("favorites after re-share: %d %v", res.StatusCode, out)
	}
}

// TestDocumentFavoriteFlagOff404 covers the flag gate for the favorite
// routes; the shared route matrix for every 07b route lives in
// TestDocumentCommentsFlagOff404.
func TestDocumentFavoriteFlagOff404(t *testing.T) {
	w := newDocumentCollabWorld(t)
	docID := w.createDoc(t, w.token, "flag", "workspace")
	disableDocumentsFlag(t)

	res, out := doJSON(t, w.srv, "POST", favoritePath(docID), w.member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("favorite with flag off: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "DELETE", favoritePath(docID), w.member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("unfavorite with flag off: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/documents/favorites", w.member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("favorites list with flag off: %d code=%q", res.StatusCode, code)
	}
}
