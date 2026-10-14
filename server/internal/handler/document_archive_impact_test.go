package handler

// FD-04 (UNI-1464) HTTP: GET /documents/{documentID}/archive-impact through
// the real Chi router - the flag gate, RequireAuth, RequireMember and the
// error envelope included, with a real DocumentService and only the object
// store faked. The service-level pins (counts, the bound, the snapshot) live
// in internal/service; here the wire shape and the refusals are the subject.

import (
	"net/http"
	"testing"
)

// impactBody reads the archive-impact answer as numbers.
func impactBody(t *testing.T, out map[string]any) (folders, documents, total, maxNodes int, tooLarge bool) {
	t.Helper()
	num := func(key string) int {
		v, ok := out[key].(float64)
		if !ok {
			t.Fatalf("answer holds no numeric %q: %v", key, out)
		}
		return int(v)
	}
	tooLarge, _ = out["too_large"].(bool)
	return num("folders"), num("documents"), num("total"), num("max_nodes"), tooLarge
}

func TestDocumentArchiveImpactHTTP(t *testing.T) {
	w := newDocsWorld(t)

	// A folder with one sub-folder and two pages, one of them inside the
	// sub-folder: 1 + 2 documents under a root that is itself a folder.
	_, folderID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Báo cáo", "kind": "folder"})
	_, subID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Phụ lục", "kind": "folder", "parent_id": folderID})
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Trang 1", "kind": "page", "parent_id": folderID})
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Trang 2", "kind": "page", "parent_id": subID})

	res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/archive-impact", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("archive impact: %d %v", res.StatusCode, out)
	}
	folders, documents, total, maxNodes, tooLarge := impactBody(t, out)
	if folders != 1 || documents != 2 || total != 4 || maxNodes != 1000 || tooLarge {
		t.Fatalf("answer = %v, want folders=1 documents=2 total=4 max_nodes=1000 too_large=false", out)
	}

	// No session at all: 401 before anything is read.
	if res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/archive-impact", "", nil); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous = %d %v, want 401", res.StatusCode, out)
	}

	// An account of no membership gets the stranger's 404, never a number.
	if res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/archive-impact", w.outsider, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider = %d %v, want 404", res.StatusCode, out)
	} else if _, ok := out["total"]; ok {
		t.Fatalf("outsider's 404 carries numbers: %v", out)
	}

	// A member who manages the root through a share but not the restricted
	// child: the whole read is refused and the body carries no number.
	memberToken, memberID := docsJoinWorkspace(t, w, "docs-impact-member@example.com")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+folderID+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "manage",
	})
	if res.StatusCode != 201 {
		t.Fatalf("share: %d %v", res.StatusCode, out)
	}
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Hạn chế", "kind": "page", "parent_id": folderID, "visibility": "restricted"})
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/archive-impact", memberToken, nil)
	wantErr(t, res, out, http.StatusForbidden, "forbidden", "permission")
	if _, ok := out["total"]; ok {
		t.Fatalf("refused read carries numbers: %v", out)
	}
}
