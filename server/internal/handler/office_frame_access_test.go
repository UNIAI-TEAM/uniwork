package handler

import (
	"context"
	"encoding/json"
	"testing"
)

// officeJoinWorkspace registers email and makes it a member of the world's
// workspace through the invitation routes.
func (w *officeWorld) officeJoinWorkspace(t *testing.T, email string) (token, userID string) {
	t.Helper()
	token, userID = filesRegister(t, w.srv, email)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/invitations", w.token,
		map[string]any{"emails": []string{email}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite %s: %d %v", email, res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/me/invitations", token, nil)
	if res.StatusCode != 200 || len(out["invitations"].([]any)) == 0 {
		t.Fatalf("invitations %s: %d %v", email, res.StatusCode, out)
	}
	inviteToken := out["invitations"].([]any)[0].(map[string]any)["token"].(string)
	if res, out = doJSON(t, w.srv, "POST", "/api/v1/invitations/"+inviteToken+"/accept", token, nil); res.StatusCode != 200 {
		t.Fatalf("accept %s: %d %v", email, res.StatusCode, out)
	}
	return token, userID
}

// restrictedDocxSharedWith creates a restricted DOCX and grants memberID level
// on it; it returns the document and the share id.
func (w *officeWorld) restrictedDocxSharedWith(t *testing.T, memberID, level string) (documentID, shareID string) {
	t.Helper()
	documentID = w.createDocx(t, "restricted.docx", frameDocx(t, "restricted"))
	_, got := doJSON(t, w.srv, "GET", "/api/v1/documents/"+documentID, w.token, nil)
	revision, _ := got["document"].(map[string]any)["revision"].(string)
	if res, out := doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+documentID, w.token, map[string]any{"revision": revision, "visibility": "restricted"}); res.StatusCode != 200 {
		t.Fatalf("restrict: %d %v", res.StatusCode, out)
	}
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": level})
	if res.StatusCode != 201 {
		t.Fatalf("share %s: %d %v", level, res.StatusCode, out)
	}
	return documentID, out["share"].(map[string]any)["id"].(string)
}

// A view-only user gets a frame that opens and reads, and every write the
// token carries is refused by the reused Documents commands.
func TestOfficeFrameViewOnlyTokenCannotWrite(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	viewer, viewerID := w.officeJoinWorkspace(t, "office-frame-viewer@example.com")
	documentID, _ := w.restrictedDocxSharedWith(t, viewerID, "view")

	res, minted := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", viewer, nil)
	if res.StatusCode != 201 || minted["can_edit"] != false {
		t.Fatalf("viewer mint = %d %v", res.StatusCode, minted)
	}
	token := minted["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID
	res, opened := doJSON(t, w.srv, "GET", base, token, nil)
	if res.StatusCode != 200 || opened["can_edit"] != false {
		t.Fatalf("viewer open = %d %v", res.StatusCode, opened)
	}

	res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "restricted.docx", frameDocx(t, "viewer-edit"), nil)
	if res.StatusCode != 403 {
		t.Fatalf("viewer upload = %d %s", res.StatusCode, raw)
	}
	// Even with an upload the owner staged, the commit is refused.
	ownerToken := w.mintFrameToken(t, documentID)["token"].(string)
	res, raw = doMultipart(t, w.srv, "POST", base+"/uploads", ownerToken, nil, "restricted.docx", frameDocx(t, "owner-staged"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("owner upload = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)
	res, out := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "viewer-commit"},
		map[string]string{"upload_id": up.UploadID, "base_revision": opened["revision"].(string)})
	if res.StatusCode != 403 {
		t.Fatalf("viewer commit = %d %v", res.StatusCode, out)
	}
	res, raw = doMultipart(t, w.srv, "POST", base+"/assets", token, nil, "dot.png", docsPNG, nil)
	if res.StatusCode != 403 {
		t.Fatalf("viewer asset upload = %d %s", res.StatusCode, raw)
	}
	// Export is a read (view access, by design): it is never refused as a write.
	if res, raw := postExport(t, w.srv, base+"/export/pdf", token, "", nil); res.StatusCode == 403 || res.StatusCode == 404 {
		t.Fatalf("viewer export = %d %s, want a view-level answer", res.StatusCode, raw)
	}
	// Nothing the viewer sent landed.
	if _, reopened := doJSON(t, w.srv, "GET", base, ownerToken, nil); reopened["revision"] != opened["revision"] {
		t.Fatalf("revision moved: %v -> %v", opened["revision"], reopened["revision"])
	}
}

// A token is only as good as the access behind it: revoking the share after
// the mint stops the very next call, before the token expires.
func TestOfficeFrameTokenStopsWhenAccessIsRevoked(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	editor, editorID := w.officeJoinWorkspace(t, "office-frame-editor@example.com")
	documentID, shareID := w.restrictedDocxSharedWith(t, editorID, "edit")

	res, minted := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", editor, nil)
	if res.StatusCode != 201 || minted["can_edit"] != true {
		t.Fatalf("editor mint = %d %v", res.StatusCode, minted)
	}
	token := minted["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID
	res, opened := doJSON(t, w.srv, "GET", base, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("editor open = %d %v", res.StatusCode, opened)
	}
	res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "restricted.docx", frameDocx(t, "before-revoke"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("editor upload = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)

	if res, out := doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+documentID+"/shares/"+shareID, w.token, nil); res.StatusCode != 200 {
		t.Fatalf("revoke: %d %v", res.StatusCode, out)
	}

	for _, path := range []string{base, opened["download_url"].(string), base + "/recents"} {
		if res, out := doJSON(t, w.srv, "GET", path, token, nil); res.StatusCode != 403 && res.StatusCode != 404 {
			t.Fatalf("GET %s after revoke = %d %v", path, res.StatusCode, out)
		}
	}
	res, out := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "after-revoke"},
		map[string]string{"upload_id": up.UploadID, "base_revision": opened["revision"].(string)})
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("commit after revoke = %d %v", res.StatusCode, out)
	}
	if res, raw := postExport(t, w.srv, base+"/export/pdf", token, "", nil); res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("export after revoke = %d %s", res.StatusCode, raw)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", editor, nil); res.StatusCode != 404 {
		t.Fatalf("re-mint after revoke = %d %v", res.StatusCode, out)
	}
}

// A commit retried with the same Idempotency-Key (the answer was lost) replays
// the first answer and appends no second version.
func TestOfficeFrameCommitReplaysOnTheSameIdempotencyKey(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	documentID := w.createDocx(t, "replay.docx", frameDocx(t, "v1"))
	token := w.mintFrameToken(t, documentID)["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID
	_, opened := doJSON(t, w.srv, "GET", base, token, nil)

	res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "replay.docx", frameDocx(t, "v2"), map[string]string{"Idempotency-Key": "replay-upload"})
	if res.StatusCode != 201 {
		t.Fatalf("upload = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)
	commit := func() (int, map[string]any) {
		res, out := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "replay-commit"},
			map[string]string{"upload_id": up.UploadID, "base_revision": opened["revision"].(string)})
		return res.StatusCode, out
	}
	code, first := commit()
	if code != 200 || first["download_url"] != base+"/content?version=2" {
		t.Fatalf("first commit = %d %v", code, first)
	}
	code, second := commit()
	if code != 200 || second["revision"] != first["revision"] || second["download_url"] != first["download_url"] {
		t.Fatalf("replayed commit = %d %v, want %v", code, second, first)
	}
	_, reopened := doJSON(t, w.srv, "GET", base, token, nil)
	if reopened["revision"] != first["revision"] || reopened["download_url"] != base+"/content?version=2" {
		t.Fatalf("after replay = %v, want version 2 at revision %v", reopened, first["revision"])
	}
}

// Recents judges a document by its stored file, as the mint does, not by its
// title: a DOCX stored under a generic type and titled without ".docx"
// (save-as names copies that way) still shows, and a non-DOCX file never does.
func TestOfficeFrameRecentsJudgeTheFileNotTheTitle(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": "Kế hoạch quý"}, "ke-hoach.docx", frameDocx(t, "titled"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("create titled docx: %d %s", res.StatusCode, raw)
	}
	var created struct {
		Document struct {
			ID string `json:"id"`
		} `json:"document"`
	}
	_ = json.Unmarshal(raw, &created)
	titled := created.Document.ID
	// Stored as a generic type, the name is the only DOCX signal left; the
	// mint already accepts it (load reads the file name).
	if _, err := testPool.Exec(context.Background(), `UPDATE document_versions SET mime_type = 'application/octet-stream' WHERE document_id = $1`, titled); err != nil {
		t.Fatal(err)
	}
	plain := w.createDocx(t, "plain.docx", frameDocx(t, "plain"))
	markdown := w.createMarkdownFile(t, "# not docx\n")

	token := w.mintFrameToken(t, plain)["token"].(string)
	res, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+titled, w.mintFrameToken(t, titled)["token"].(string), nil)
	if res.StatusCode != 200 || opened["title"] != "Kế hoạch quý" {
		t.Fatalf("open titled = %d %v", res.StatusCode, opened)
	}
	res, recents := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+plain+"/recents", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("recents = %d %v", res.StatusCode, recents)
	}
	got := map[string]bool{}
	for _, item := range recents["items"].([]any) {
		got[item.(map[string]any)["document_id"].(string)] = true
	}
	if !got[titled] || !got[plain] || got[markdown] || len(got) != 2 {
		t.Fatalf("recents = %v, want %s and %s only (file mime %v)", recents, titled, plain, opened["file"])
	}
}
