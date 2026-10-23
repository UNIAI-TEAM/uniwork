package handler

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestEnsureMyFolderRoute(t *testing.T) {
	w := newDocsWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/my-folder"

	// First call creates and returns 200 DocumentSDO; second call returns the same document id with 200.
	res1, out1 := doJSON(t, w.srv, "POST", path, w.token, nil)
	if res1.StatusCode != 200 {
		t.Fatalf("first POST my-folder = %d %v", res1.StatusCode, out1)
	}
	doc1, _ := out1["document"].(map[string]any)
	if doc1["kind"] != "folder" || doc1["title"] != "My Folder" || doc1["visibility"] != "restricted" {
		t.Fatalf("unexpected document SDO: %v", doc1)
	}
	res2, out2 := doJSON(t, w.srv, "POST", path, w.token, nil)
	if res2.StatusCode != 200 {
		t.Fatalf("second POST my-folder = %d %v", res2.StatusCode, out2)
	}
	doc2, _ := out2["document"].(map[string]any)
	if doc2["id"] != doc1["id"] {
		t.Fatalf("second POST id = %v, want %v", doc2["id"], doc1["id"])
	}

	// Outsider -> 404; deactivated member -> 403 member_deactivated.
	resOut, bodyOut := doJSON(t, w.srv, "POST", path, w.outsider, nil)
	if resOut.StatusCode != 404 {
		t.Fatalf("outsider POST my-folder = %d %v, want 404", resOut.StatusCode, bodyOut)
	}

	deactTok, deactID := docsJoinWorkspace(t, w, "deact-mf-http@example.com")
	resDeact1, _ := doJSON(t, w.srv, "POST", path, deactTok, nil)
	if resDeact1.StatusCode != 200 {
		t.Fatalf("active member POST my-folder = %d", resDeact1.StatusCode)
	}
	if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.orgID, deactID); err != nil {
		t.Fatal(err)
	}
	resDeact2, bodyDeact2 := doJSON(t, w.srv, "POST", path, deactTok, nil)
	if code, _ := errCodeClass(bodyDeact2); resDeact2.StatusCode != 403 || code != "member_deactivated" {
		t.Fatalf("deactivated POST my-folder = %d %v, want 403 member_deactivated", resDeact2.StatusCode, bodyDeact2)
	}

	// §3 over HTTP: PATCH or archive on My Folder -> 409 my_folder_locked (error_class: conflict).
	mfID, _ := doc1["id"].(string)
	resPatch, bodyPatch := doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+mfID, w.token, map[string]any{
		"title": "Renamed", "revision": "1",
	})
	if code, class := errCodeClass(bodyPatch); resPatch.StatusCode != 409 || code != "my_folder_locked" || class != "conflict" {
		t.Fatalf("PATCH my-folder = %d code=%q class=%q, want 409 my_folder_locked/conflict", resPatch.StatusCode, code, class)
	}
}

func TestCreateWithMyFolderDestinationRoutes(t *testing.T) {
	w := newOfficeWorld(t, true)
	docsBase := "/api/v1/workspaces/" + w.wsID + "/documents"

	// 1. Page create with destination="my_folder" (lazily creates My Folder).
	resPage, outPage := doJSON(t, w.srv, "POST", docsBase, w.token, map[string]any{
		"title":       "Note in My Folder",
		"destination": "my_folder",
	})
	if resPage.StatusCode != 201 {
		t.Fatalf("POST /documents destination=my_folder = %d %v", resPage.StatusCode, outPage)
	}
	pageDoc, _ := outPage["document"].(map[string]any)
	mfID, _ := pageDoc["parent_id"].(string)
	if mfID == "" || pageDoc["visibility"] != "restricted" {
		t.Fatalf("unexpected page SDO: %v", pageDoc)
	}

	// 2. Multipart file upload with destination="my_folder".
	resFile, rawFile := doMultipart(t, w.srv, "POST", docsBase+"/files", w.token,
		map[string]string{"title": "File in My Folder", "destination": "my_folder"}, "note.md", []byte("# hello\n"), nil)
	if resFile.StatusCode != 201 {
		t.Fatalf("POST /documents/files destination=my_folder = %d %s", resFile.StatusCode, rawFile)
	}

	// 3. Blank file create with destination="my_folder".
	resBlank, outBlank := doJSON(t, w.srv, "POST", docsBase+"/files/blank", w.token, map[string]any{
		"format":      "docx",
		"title":       "Blank in My Folder",
		"destination": "my_folder",
	})
	if resBlank.StatusCode != 201 {
		t.Fatalf("POST /documents/files/blank destination=my_folder = %d %v", resBlank.StatusCode, outBlank)
	}
	blankDoc, _ := outBlank["document"].(map[string]any)
	if blankDoc["parent_id"] != mfID || blankDoc["visibility"] != "restricted" {
		t.Fatalf("unexpected blank SDO: %v, want parent_id=%q", blankDoc, mfID)
	}

	// 4. Both parent_id and destination="my_folder", or unknown destination -> 400 invalid_destination (no error_class).
	for _, body := range []map[string]any{
		{"title": "Bad", "destination": "my_folder", "parent_id": mfID},
		{"title": "Bad", "destination": "elsewhere"},
	} {
		resBad, outBad := doJSON(t, w.srv, "POST", docsBase, w.token, body)
		if code, class := errCodeClass(outBad); resBad.StatusCode != 400 || code != "invalid_destination" || class != "" {
			t.Fatalf("POST /documents(%v) = %d code=%q class=%q, want 400 invalid_destination/\"\"", body, resBad.StatusCode, code, class)
		}
		resBadBlank, outBadBlank := doJSON(t, w.srv, "POST", docsBase+"/files/blank", w.token, map[string]any{
			"format":      "docx",
			"title":       "Bad",
			"destination": body["destination"],
			"parent_id":   body["parent_id"],
		})
		if code, class := errCodeClass(outBadBlank); resBadBlank.StatusCode != 400 || code != "invalid_destination" || class != "" {
			t.Fatalf("POST /documents/files/blank(%v) = %d code=%q class=%q, want 400 invalid_destination/\"\"", body, resBadBlank.StatusCode, code, class)
		}
	}
}

func TestMyFolderSystemKindAndAdminHideRoutes(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, _ := docsJoinWorkspace(t, w, "member-mf-vis@example.com")
	docsBase := "/api/v1/workspaces/" + w.wsID + "/documents"

	// Member ensures their My Folder and creates a regular root folder.
	resMF, outMF := doJSON(t, w.srv, "POST", docsBase+"/my-folder", memberTok, nil)
	if resMF.StatusCode != 200 {
		t.Fatalf("member POST /my-folder = %d %v", resMF.StatusCode, outMF)
	}
	mfDoc, _ := outMF["document"].(map[string]any)
	mfID, _ := mfDoc["id"].(string)
	if mfDoc["system_kind"] != "my_folder" {
		t.Fatalf("DocumentDTO.system_kind = %v, want my_folder", mfDoc["system_kind"])
	}

	resReg, outReg := doJSON(t, w.srv, "POST", docsBase, memberTok, map[string]any{
		"kind":  "folder",
		"title": "Regular Folder",
	})
	if resReg.StatusCode != 201 {
		t.Fatalf("member POST regular folder = %d %v", resReg.StatusCode, outReg)
	}
	regDoc, _ := outReg["document"].(map[string]any)
	regID, _ := regDoc["id"].(string)
	if _, has := regDoc["system_kind"]; has {
		t.Fatalf("regular DocumentDTO should omit system_kind, got %v", regDoc["system_kind"])
	}

	// Member tree: My Folder carries system_kind="my_folder", regular folder omits system_kind.
	resTreeM, outTreeM := doJSON(t, w.srv, "GET", docsBase+"/tree", memberTok, nil)
	if resTreeM.StatusCode != 200 {
		t.Fatalf("member GET /tree = %d %v", resTreeM.StatusCode, outTreeM)
	}
	nodesM, _ := outTreeM["documents"].([]any)
	var sawMFInTree, sawRegInTree bool
	for _, raw := range nodesM {
		n, _ := raw.(map[string]any)
		switch n["id"] {
		case mfID:
			sawMFInTree = true
			if n["system_kind"] != "my_folder" {
				t.Fatalf("tree node system_kind = %v, want my_folder", n["system_kind"])
			}
		case regID:
			sawRegInTree = true
			if _, has := n["system_kind"]; has {
				t.Fatalf("regular tree node should omit system_kind, got %v", n["system_kind"])
			}
		}
	}
	if !sawMFInTree || !sawRegInTree {
		t.Fatalf("member tree sawMF=%v sawReg=%v", sawMFInTree, sawRegInTree)
	}

	// Member root list: My Folder carries system_kind="my_folder", regular folder omits system_kind.
	resListM, outListM := doJSON(t, w.srv, "GET", docsBase+"?parent_id=", memberTok, nil)
	if resListM.StatusCode != 200 {
		t.Fatalf("member GET ?parent_id= = %d %v", resListM.StatusCode, outListM)
	}
	itemsM, _ := outListM["documents"].([]any)
	for _, raw := range itemsM {
		it, _ := raw.(map[string]any)
		switch it["id"] {
		case mfID:
			if it["system_kind"] != "my_folder" {
				t.Fatalf("summary DTO system_kind = %v, want my_folder", it["system_kind"])
			}
		case regID:
			if _, has := it["system_kind"]; has {
				t.Fatalf("regular summary DTO should omit system_kind, got %v", it["system_kind"])
			}
		}
	}

	// Workspace owner (w.token) does NOT see member's My Folder in tree or root list, and gets 403 document_restricted on GET /documents/{mfID}.
	resTreeAdmin, outTreeAdmin := doJSON(t, w.srv, "GET", docsBase+"/tree", w.token, nil)
	if resTreeAdmin.StatusCode != 200 {
		t.Fatalf("admin GET /tree = %d %v", resTreeAdmin.StatusCode, outTreeAdmin)
	}
	for _, raw := range outTreeAdmin["documents"].([]any) {
		n, _ := raw.(map[string]any)
		if n["id"] == mfID {
			t.Fatalf("admin tree leaked member's My Folder: %v", n)
		}
	}
	resListAdmin, outListAdmin := doJSON(t, w.srv, "GET", docsBase+"?parent_id=", w.token, nil)
	if resListAdmin.StatusCode != 200 {
		t.Fatalf("admin GET ?parent_id= = %d %v", resListAdmin.StatusCode, outListAdmin)
	}
	for _, raw := range outListAdmin["documents"].([]any) {
		it, _ := raw.(map[string]any)
		if it["id"] == mfID {
			t.Fatalf("admin root list leaked member's My Folder: %v", it)
		}
	}
	resGetAdmin, outGetAdmin := doJSON(t, w.srv, "GET", "/api/v1/documents/"+mfID, w.token, nil)
	if code, class := errCodeClass(outGetAdmin); resGetAdmin.StatusCode != 403 || code != "document_restricted" || class != "permission" {
		t.Fatalf("admin GET member's My Folder = %d code=%q class=%q, want 403 document_restricted/permission", resGetAdmin.StatusCode, code, class)
	}
}

func TestMyFolderIsolation(t *testing.T) {
	w := newDocsWorld(t)

	// Route classification check (MF-8): POST /api/v1/workspaces/{workspaceID}/documents/my-folder
	// is walked, classified as isoScoped in isoRoutes, and leaves no unclassified/stale rows.
	routes := isoWalk(t, w.srv.Config.Handler)
	if missing := isoUnclassified(routes); len(missing) > 0 {
		t.Fatalf("isoUnclassified: %v", missing)
	}
	if stale := isoStaleRows(routes); len(stale) > 0 {
		t.Fatalf("isoStaleRows: %v", stale)
	}
	r := isoRoute{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/documents/my-folder"}
	spec := isoSpecFor(r)
	if !spec.class.tenantScoped() {
		t.Fatalf("expected tenantScoped spec for %v, got class=%v", r, spec.class)
	}

	// Cross-tenant attack: another organization's owner (w.outsider) calling A's workspace
	// is refused with 404 and creates no row in A; A's owner control succeeds with 200.
	path := "/api/v1/workspaces/" + w.wsID + "/documents/my-folder"
	resAttack, outAttack := doJSON(t, w.srv, "POST", path, w.outsider, nil)
	if resAttack.StatusCode != 404 || !spec.refused(resAttack.StatusCode, nil) {
		t.Fatalf("cross-tenant POST my-folder = %d %v, want 404 refused", resAttack.StatusCode, outAttack)
	}
	var count int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE workspace_id = $1 AND system_kind = 'my_folder'`, w.wsID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("cross-tenant attack created %d My Folder rows in A", count)
	}

	resControl, outControl := doJSON(t, w.srv, "POST", path, w.token, nil)
	if !spec.controlOK(resControl.StatusCode, nil) {
		t.Fatalf("owner control POST my-folder = %d %v, want 200", resControl.StatusCode, outControl)
	}
}

// MYFOLDER-01 (UNI-1891) over HTTP: a workspace admin's flat search (the
// admin_scope listing) does not leak a page that lives inside another
// member's My Folder - neither its title nor its id - while the member who
// owns the folder finds it. The list route is where the visual finding MF-V7
// was seen.
func TestMyFolderAdminSearchHidesForeignSubtreeRoutes(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, _ := docsJoinWorkspace(t, w, "member-mfs-http@example.com")
	docsBase := "/api/v1/workspaces/" + w.wsID + "/documents"

	// The member creates a page inside their My Folder (lazily created).
	resChild, outChild := doJSON(t, w.srv, "POST", docsBase, memberTok, map[string]any{
		"title": "mfs-secret-http", "destination": "my_folder",
	})
	if resChild.StatusCode != 201 {
		t.Fatalf("member POST page in My Folder = %d %v", resChild.StatusCode, outChild)
	}
	childID := outChild["document"].(map[string]any)["id"].(string)

	// The workspace owner (admin) searching does not see the page.
	resAdmin, outAdmin := doJSON(t, w.srv, "GET", docsBase+"?q=mfs-secret-http", w.token, nil)
	if resAdmin.StatusCode != 200 {
		t.Fatalf("admin GET search = %d %v", resAdmin.StatusCode, outAdmin)
	}
	blob, err := json.Marshal(outAdmin)
	if err != nil {
		t.Fatal(err)
	}
	body := string(blob)
	if strings.Contains(body, childID) || strings.Contains(body, "mfs-secret-http") {
		t.Fatalf("admin search leaked a page inside a member's My Folder (id or title in the body): %s", body)
	}
	for _, raw := range outAdmin["documents"].([]any) {
		it, _ := raw.(map[string]any)
		if it["id"] == childID {
			t.Fatalf("admin search leaked a page inside a member's My Folder: %v", it)
		}
	}

	// Control: the member finds their own page.
	resMember, outMember := doJSON(t, w.srv, "GET", docsBase+"?q=mfs-secret-http", memberTok, nil)
	if resMember.StatusCode != 200 {
		t.Fatalf("member GET search = %d %v", resMember.StatusCode, outMember)
	}
	var found bool
	for _, raw := range outMember["documents"].([]any) {
		it, _ := raw.(map[string]any)
		if it["id"] == childID {
			found = true
		}
	}
	if !found {
		t.Fatalf("member search did not find their own page: %v", outMember)
	}
}
