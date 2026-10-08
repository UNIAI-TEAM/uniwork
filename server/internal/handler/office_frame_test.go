package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// enableOfficeDocsWeb turns the office_docs_web flag on globally.
func enableOfficeDocsWeb(t *testing.T, q *db.Queries) {
	t.Helper()
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "office_docs_web", ScopeType: featureflags.ScopeGlobal,
		ScopeID: "", Enabled: true, Note: "office frame tests", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable office_docs_web: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

// frameDocx is a minimal OOXML word package whose body carries marker.
func frameDocx(t *testing.T, marker string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/" + marker + ".xml"} {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte("<x>" + name + "</x>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (w *officeWorld) createDocx(t *testing.T, name string, body []byte) string {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token, nil, name, body, nil)
	if res.StatusCode != 201 {
		t.Fatalf("create docx: %d %s", res.StatusCode, raw)
	}
	var out struct {
		Document struct {
			ID string `json:"id"`
		} `json:"document"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Document.ID
}

func (w *officeWorld) mintFrameToken(t *testing.T, documentID string) map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.token, nil)
	if res.StatusCode != 201 {
		t.Fatalf("mint frame token = %d %v", res.StatusCode, out)
	}
	return out
}

func TestOfficeFrameTokenNeedsTheFlag(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createDocx(t, "plan.docx", frameDocx(t, "a"))
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("flag off mint = %d %v", res.StatusCode, out)
	}
}

func TestOfficeFrameOpenSaveConflictReopen(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	original := frameDocx(t, "original")
	documentID := w.createDocx(t, "plan.docx", original)
	markdownID := w.createMarkdownFile(t, "# not docx\n")

	minted := w.mintFrameToken(t, documentID)
	token, _ := minted["token"].(string)
	if !strings.HasPrefix(token, "oft1.") || minted["token_type"] != "Bearer" || minted["document_id"] != documentID ||
		minted["workspace_id"] != w.wsID || minted["organization_id"] != w.orgID || minted["can_edit"] != true {
		t.Fatalf("minted = %v", minted)
	}
	if n, _ := minted["expires_in"].(float64); n < 590 || n > 600 {
		t.Fatalf("expires_in = %v, want ~600", minted["expires_in"])
	}

	// Only DOCX file documents get a frame; a non-member gets the same 404.
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+markdownID+"/office/frame-token", w.token, nil); res.StatusCode != 404 {
		t.Fatalf("markdown mint = %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.outsiderToken(t), nil); res.StatusCode != 404 {
		t.Fatalf("outsider mint = %d %v", res.StatusCode, out)
	}

	base := "/api/v1/office-frame/documents/" + documentID
	// The session token is not a frame token, and nothing at all is refused.
	for _, bad := range []string{w.token, "", token + "x", "oft1.e30.AAAA"} {
		if res, out := doJSON(t, w.srv, "GET", base, bad, nil); res.StatusCode != 401 {
			t.Fatalf("open with %q = %d %v", bad, res.StatusCode, out)
		}
	}
	// A frame token cannot pass for a session token either.
	if res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+documentID, token, nil); res.StatusCode != 401 {
		t.Fatalf("frame token on a session route = %d %v", res.StatusCode, out)
	}

	res, opened := doJSON(t, w.srv, "GET", base, token, nil)
	if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("open = %d %v", res.StatusCode, opened)
	}
	revision, _ := opened["revision"].(string)
	downloadURL, _ := opened["download_url"].(string)
	if revision == "" || downloadURL != base+"/content?version=1" || opened["can_edit"] != true {
		t.Fatalf("open = %v", opened)
	}
	if res, raw := doBytes(t, w.srv, "GET", downloadURL, token); res.StatusCode != 200 || !bytes.Equal(raw, original) {
		t.Fatalf("content = %d (%d bytes)", res.StatusCode, len(raw))
	}

	// Save: stage, then commit on the revision the frame opened.
	edited := frameDocx(t, "edited")
	res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "plan.docx", edited, nil)
	if res.StatusCode != 201 {
		t.Fatalf("upload = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)
	res, saved := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "frame-save-1"},
		map[string]string{"upload_id": up.UploadID, "base_revision": revision})
	if res.StatusCode != 200 || saved["revision"] == revision || saved["download_url"] != base+"/content?version=2" {
		t.Fatalf("commit = %d %v", res.StatusCode, saved)
	}

	// A second writer still on the old base gets 409 with the live revision.
	res, raw = doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, "plan.docx", frameDocx(t, "stale"), nil)
	if res.StatusCode != 201 {
		t.Fatalf("second upload = %d %s", res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, &up)
	res, conflict := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "frame-save-2"},
		map[string]string{"upload_id": up.UploadID, "base_revision": revision})
	errObj, _ := conflict["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if res.StatusCode != 409 || errObj["code"] != "document_version_conflict" || fields["current_revision"] != saved["revision"] {
		t.Fatalf("stale commit = %d %v", res.StatusCode, conflict)
	}

	// Reopen shows the edit.
	_, reopened := doJSON(t, w.srv, "GET", base, token, nil)
	if reopened["revision"] != saved["revision"] {
		t.Fatalf("reopen = %v, want revision %v", reopened, saved["revision"])
	}
	if res, raw := doBytes(t, w.srv, "GET", reopened["download_url"].(string), token); res.StatusCode != 200 || !bytes.Equal(raw, edited) {
		t.Fatalf("reopened content = %d (%d bytes)", res.StatusCode, len(raw))
	}

	// Recents: the DOCX, never the markdown file.
	res, recents := doJSON(t, w.srv, "GET", base+"/recents?limit=10", token, nil)
	items, _ := recents["items"].([]any)
	if res.StatusCode != 200 || len(items) != 1 || items[0].(map[string]any)["document_id"] != documentID {
		t.Fatalf("recents = %d %v", res.StatusCode, recents)
	}
	if res, _ := doJSON(t, w.srv, "GET", base+"/recents?limit=0", token, nil); res.StatusCode != 400 {
		t.Fatalf("recents limit=0 = %d", res.StatusCode)
	}
}

func TestOfficeFrameTokenOpensOnlyItsDocument(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	first := w.createDocx(t, "first.docx", frameDocx(t, "first"))
	second := w.createDocx(t, "second.docx", frameDocx(t, "second"))
	token := w.mintFrameToken(t, first)["token"].(string)

	for _, path := range []string{
		"/api/v1/office-frame/documents/" + second,
		"/api/v1/office-frame/documents/" + second + "/content",
		"/api/v1/office-frame/documents/" + second + "/recents",
	} {
		if res, out := doJSON(t, w.srv, "GET", path, token, nil); res.StatusCode != 404 {
			t.Fatalf("GET %s with first's token = %d %v", path, res.StatusCode, out)
		}
	}
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/office-frame/documents/"+second+"/uploads", token, nil, "x.docx", frameDocx(t, "x"), nil)
	if res.StatusCode != 404 {
		t.Fatalf("upload to second with first's token = %d %s", res.StatusCode, raw)
	}

	// Refresh keeps the binding and needs the frame token itself.
	res, refreshed := doJSON(t, w.srv, "POST", "/api/v1/office-frame/token", token, nil)
	if res.StatusCode != 200 || refreshed["document_id"] != first || refreshed["token"] == token {
		t.Fatalf("refresh = %d %v", res.StatusCode, refreshed)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/office-frame/token", w.token, nil); res.StatusCode != 401 {
		t.Fatalf("refresh with session = %d %v", res.StatusCode, out)
	}

}

func TestOfficeFrameImagesAreSignedPerAsset(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	documentID := w.createDocx(t, "pics.docx", frameDocx(t, "pics"))
	token := w.mintFrameToken(t, documentID)["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID

	res, raw := doMultipart(t, w.srv, "POST", base+"/assets", token, nil, "dot.png", docsPNG, nil)
	if res.StatusCode != 201 {
		t.Fatalf("asset upload = %d %s", res.StatusCode, raw)
	}
	var asset struct {
		AssetID string `json:"asset_id"`
		URL     string `json:"url"`
	}
	_ = json.Unmarshal(raw, &asset)
	if !strings.HasPrefix(asset.URL, base+"/assets/"+asset.AssetID+"?sig=ofa1.") {
		t.Fatalf("asset url = %q", asset.URL)
	}
	// The signed URL needs no header (an <img> loads it).
	if res, got := doBytes(t, w.srv, "GET", asset.URL, ""); res.StatusCode != 200 || !bytes.Equal(got, docsPNG) {
		t.Fatalf("signed GET = %d (%d bytes)", res.StatusCode, len(got))
	}
	if res, got := doBytes(t, w.srv, "GET", base+"/assets/"+asset.AssetID, token); res.StatusCode != 200 || !bytes.Equal(got, docsPNG) {
		t.Fatalf("bearer GET = %d (%d bytes)", res.StatusCode, len(got))
	}
	// The signature names one asset: another path, a tampered one, or a
	// write with it are refused.
	sig := asset.URL[strings.Index(asset.URL, "?sig=")+len("?sig="):]
	for _, path := range []string{
		base + "/assets/01J8X4AST0N1P2Q3R4S5T6U7V8?sig=" + sig,
		base + "/assets/" + asset.AssetID + "?sig=" + sig + "x",
		base + "?sig=" + sig,
	} {
		if res, _ := doBytes(t, w.srv, "GET", path, ""); res.StatusCode != 401 {
			t.Fatalf("GET %s = %d, want 401", path, res.StatusCode)
		}
	}

	res, signed := doJSON(t, w.srv, "POST", base+"/assets/sign", token, map[string]any{"asset_ids": []string{asset.AssetID}})
	items, _ := signed["items"].([]any)
	if res.StatusCode != 200 || len(items) != 1 || items[0].(map[string]any)["asset_id"] != asset.AssetID {
		t.Fatalf("sign = %d %v", res.StatusCode, signed)
	}
	if res, out := doJSON(t, w.srv, "POST", base+"/assets/sign", token, map[string]any{"asset_ids": []string{"01J8X4AST0N1P2Q3R4S5T6U7V8"}}); res.StatusCode != 404 {
		t.Fatalf("sign unknown asset = %d %v", res.StatusCode, out)
	}
}
