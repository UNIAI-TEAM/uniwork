package handler

import (
	"encoding/json"
	"testing"
)

// frameStaged stages one upload through a live frame token and returns its
// upload id and the revision the frame opened at.
func (w *officeWorld) frameStaged(t *testing.T, documentID, token, marker string) (uploadID, revision string) {
	t.Helper()
	base := "/api/v1/office-frame/documents/" + documentID
	res, opened := doJSON(t, w.srv, "GET", base, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("open = %d %v", res.StatusCode, opened)
	}
	res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "plan.docx", frameDocx(t, marker), nil)
	if res.StatusCode != 201 {
		t.Fatalf("stage = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)
	return up.UploadID, opened["revision"].(string)
}

func (w *officeWorld) archiveDocument(t *testing.T, documentID string) {
	t.Helper()
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/archive", w.token, nil); res.StatusCode != 200 {
		t.Fatalf("archive %s = %d %v", documentID, res.StatusCode, out)
	}
}

// errorOf is the code and message of a JSON error body.
func errorOf(out map[string]any) (code, message string) {
	e, _ := out["error"].(map[string]any)
	code, _ = e["code"].(string)
	message, _ = e["message"].(string)
	return code, message
}

// F6 (UNI-1345, BEF6-4): the web frame's two save routes answer
// 403 document_archived to a frame actor who could save (edit or more) on an
// archived document; below edit, another document's token and every read
// route keep the plain 404.
func TestOfficeFrameSaveRoutesOnArchivedDocument(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	editor, _ := w.officeJoinWorkspace(t, "office-frame-archived-editor@example.com")
	viewer, viewerID := w.officeJoinWorkspace(t, "office-frame-archived-viewer@example.com")

	docID := w.createDocx(t, "archived.docx", frameDocx(t, "a"))
	otherID := w.createDocx(t, "other.docx", frameDocx(t, "b"))
	viewOnlyID, _ := w.restrictedDocxSharedWith(t, viewerID, "view")

	ownerTok := w.mintFrameToken(t, docID)["token"].(string)
	res, editorMint := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/frame-token", editor, nil)
	if res.StatusCode != 201 || editorMint["can_edit"] != true {
		t.Fatalf("editor mint = %d %v, want can_edit", res.StatusCode, editorMint)
	}
	editorTok := editorMint["token"].(string)
	otherTok := w.mintFrameToken(t, otherID)["token"].(string)
	res, viewerMint := doJSON(t, w.srv, "POST", "/api/v1/documents/"+viewOnlyID+"/office/frame-token", viewer, nil)
	if res.StatusCode != 201 || viewerMint["can_edit"] != false {
		t.Fatalf("viewer mint = %d %v", res.StatusCode, viewerMint)
	}
	viewerTok := viewerMint["token"].(string)

	upload, rev := w.frameStaged(t, docID, ownerTok, "staged")
	viewUpload, viewRev := w.frameStaged(t, viewOnlyID, w.mintFrameToken(t, viewOnlyID)["token"].(string), "view-staged")
	otherUpload, otherRev := w.frameStaged(t, otherID, otherTok, "other-staged")

	w.archiveDocument(t, docID)
	w.archiveDocument(t, otherID)
	w.archiveDocument(t, viewOnlyID)

	save := func(t *testing.T, documentID, token, uploadID, revision, key string) (uploadStatus, commitStatus int, uploadBody, commitBody map[string]any) {
		t.Helper()
		base := "/api/v1/office-frame/documents/" + documentID
		res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "plan.docx", frameDocx(t, "after-archive"), nil)
		uploadBody = map[string]any{}
		_ = json.Unmarshal(raw, &uploadBody)
		cres, cout := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": key},
			map[string]string{"upload_id": uploadID, "base_revision": revision})
		return res.StatusCode, cres.StatusCode, uploadBody, cout
	}

	for _, tc := range []struct {
		name  string
		token string
	}{{"owner", ownerTok}, {"edit peer", editorTok}} {
		t.Run(tc.name+" gets document_archived on both save routes", func(t *testing.T) {
			us, cs, ub, cb := save(t, docID, tc.token, upload, rev, "archived-"+tc.name)
			for label, got := range map[string]struct {
				status int
				body   map[string]any
			}{"upload": {us, ub}, "commit": {cs, cb}} {
				code, msg := errorOf(got.body)
				if got.status != 403 || code != "document_archived" || msg != "tài liệu đã được lưu trữ" {
					t.Fatalf("%s on archived = %d %v, want 403 document_archived", label, got.status, got.body)
				}
			}
		})
	}

	t.Run("below edit the save routes stay not_found", func(t *testing.T) {
		us, cs, ub, cb := save(t, viewOnlyID, viewerTok, viewUpload, viewRev, "archived-view")
		if us != 404 || cs != 404 {
			t.Fatalf("view-only on archived = upload %d %v, commit %d %v, want 404 both", us, ub, cs, cb)
		}
		if code, _ := errorOf(ub); code != "not_found" {
			t.Fatalf("view-only upload code = %q, want not_found", code)
		}
	})

	t.Run("another document's token never reaches the archived one", func(t *testing.T) {
		// The first document's token on the second (also archived) document.
		us, cs, _, _ := save(t, otherID, ownerTok, otherUpload, otherRev, "archived-cross")
		if us != 404 || cs != 404 {
			t.Fatalf("first's token on second's save routes = %d / %d, want 404 / 404", us, cs)
		}
	})

	t.Run("a read route on the archived document stays not_found", func(t *testing.T) {
		base := "/api/v1/office-frame/documents/" + docID
		for _, path := range []string{base, base + "/content", base + "/recents"} {
			if res, out := doJSON(t, w.srv, "GET", path, ownerTok, nil); res.StatusCode != 404 {
				t.Fatalf("GET %s on archived = %d %v, want 404", path, res.StatusCode, out)
			}
		}
	})
}
