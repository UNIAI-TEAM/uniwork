package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// setOfficeFrameFlagFor sets one module flag (office_docs_web,
// office_pdf_web, ...) for one organization.
func setOfficeFrameFlagFor(t *testing.T, q *db.Queries, key, organizationID string, enabled bool) {
	t.Helper()
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: key, ScopeType: featureflags.ScopeOrganization,
		ScopeID: organizationID, Enabled: enabled, Note: "office frame module test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("set %s for %s: %v", key, organizationID, err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

// framePDF passes the file sniffer's %PDF- magic.
var framePDF = []byte("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n")

// The module is derived from the stored format at mint, never from the
// client, and each module answers to its own flag for the document's
// organization: a Docs token cannot pass while only the PDF flag is on, a PDF
// token cannot pass while only the Docs flag is on, and a format without a
// web module is no frame document at all.
func TestOfficeFrameModuleFlagsArePerModuleAndPerOrganization(t *testing.T) {
	w := newOfficeWorld(t, true)
	docx := w.createDocx(t, "plan.docx", frameDocx(t, "a"))
	pdf := w.createDocx(t, "scan.pdf", framePDF)
	md := w.createDocx(t, "notes.md", []byte("# notes\n"))

	mint := func(documentID string) (int, map[string]any) {
		res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.token, nil)
		return res.StatusCode, out
	}
	refusedAsDisabled := func(what string, code int, out map[string]any, want int) {
		t.Helper()
		if c, _ := errCodeClass(out); code != want || c != "feature_disabled" {
			t.Fatalf("%s = %d %v, want %d feature_disabled", what, code, out, want)
		}
	}

	// Only office_pdf_web is on for this organization.
	setOfficeFrameFlagFor(t, w.q, "office_pdf_web", w.orgID, true)
	code, out := mint(docx)
	refusedAsDisabled("docx mint with only the pdf flag", code, out, 403)
	code, out = mint(md)
	refusedAsDisabled("md mint with only the pdf flag", code, out, 403)
	code, out = mint(pdf)
	if code != 201 || out["module"] != "pdf" {
		t.Fatalf("pdf mint = %d %v", code, out)
	}
	pdfToken := out["token"].(string)
	base := "/api/v1/office-frame/documents/" + pdf
	res, opened := doJSON(t, w.srv, "GET", base, pdfToken, nil)
	if res.StatusCode != 200 || opened["module"] != "pdf" {
		t.Fatalf("pdf open = %d %v", res.StatusCode, opened)
	}
	res, recents := doJSON(t, w.srv, "GET", base+"/recents", pdfToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("pdf recents = %d %v", res.StatusCode, recents)
	}
	for _, item := range recents["items"].([]any) {
		if id := item.(map[string]any)["document_id"]; id == docx || id == md {
			t.Fatalf("pdf recents lists another module's document %v", item)
		}
	}
	res, out = doJSON(t, w.srv, "POST", base+"/export/pdf", pdfToken, nil)
	if c, _ := errCodeClass(out); res.StatusCode != 501 || c != "unsupported_operation" {
		t.Fatalf("pdf token export = %d %v, want 501 unsupported_operation", res.StatusCode, out)
	}

	// Swap: Docs on, PDF off. The PDF token minted while it was on stops on
	// every frame route; a Docs token works.
	setOfficeFrameFlagFor(t, w.q, "office_pdf_web", w.orgID, false)
	setOfficeFrameFlagFor(t, w.q, "office_docs_web", w.orgID, true)
	for _, path := range []string{base, base + "/recents", base + "/content"} {
		res, out := doJSON(t, w.srv, "GET", path, pdfToken, nil)
		refusedAsDisabled("pdf token on "+path+" with the pdf flag off", res.StatusCode, out, 404)
	}
	code, out = mint(pdf)
	refusedAsDisabled("pdf mint with only the docs flag", code, out, 403)
	code, out = mint(docx)
	if code != 201 || out["module"] != "docs" {
		t.Fatalf("docx mint = %d %v", code, out)
	}
	docsToken := out["token"].(string)
	if res, out := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+docx, docsToken, nil); res.StatusCode != 200 || out["module"] != "docs" {
		t.Fatalf("docs open = %d %v", res.StatusCode, out)
	}
	// A token opens only its own document, whatever the module.
	if res, out := doJSON(t, w.srv, "GET", base, docsToken, nil); res.StatusCode != 404 {
		t.Fatalf("docs token on the pdf document = %d %v", res.StatusCode, out)
	}

	// Docs off again: the Docs token stops as well.
	setOfficeFrameFlagFor(t, w.q, "office_docs_web", w.orgID, false)
	res, out = doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+docx, docsToken, nil)
	refusedAsDisabled("docs token with the docs flag off", res.StatusCode, out, 404)

	// Markdown answers to its own flag.
	setOfficeFrameFlagFor(t, w.q, "office_markdown_web", w.orgID, true)
	code, out = mint(md)
	if code != 201 || out["module"] != "markdown" {
		t.Fatalf("md mint = %d %v", code, out)
	}
}

// frameXlsx is a minimal SpreadsheetML package padded (stored, not deflated)
// to at least pad bytes, so its stored size is what the test needs.
func frameXlsx(t *testing.T, pad int) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"} {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte("<x>" + name + "</x>")); err != nil {
			t.Fatal(err)
		}
	}
	if pad > 0 {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: "xl/media/pad.bin", Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		noise := make([]byte, pad)
		if _, err := rand.Read(noise); err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(noise); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// GO-D3 = C: an xlsx over the Sheets cap never gets a Sheets frame token, so a
// crafted client cannot open it in the frame; the host opens the G3 editor.
func TestOfficeFrameSheetsMintRefusesAWorkbookOverTheCap(t *testing.T) {
	w := newOfficeWorld(t, true)
	setOfficeFrameFlagFor(t, w.q, "office_sheets_web", w.orgID, true)
	small := w.createDocx(t, "small.xlsx", frameXlsx(t, 0))
	big := w.createDocx(t, "big.xlsx", frameXlsx(t, service.OfficeFrameSheetsMaxBytes+1))

	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+small+"/office/frame-token", w.token, nil)
	if res.StatusCode != 201 || out["module"] != "sheets" {
		t.Fatalf("small xlsx mint = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+big+"/office/frame-token", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 413 || code != "too_large" {
		t.Fatalf("xlsx over the cap mint = %d %v, want 413 too_large", res.StatusCode, out)
	}
	// The cap is checked after the ACL: a non-member still gets the plain 404.
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+big+"/office/frame-token", w.outsiderToken(t), nil); res.StatusCode != 404 {
		t.Fatalf("outsider mint of the big xlsx = %d %v", res.StatusCode, out)
	}
}

// frameZip is a minimal OOXML-shaped package with the given part names.
func frameZip(t *testing.T, parts ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range parts {
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

// frameModuleFiles is one stored file per web module, with the flag that
// turns it on.
func frameModuleFiles(t *testing.T) []struct {
	module, flag, name string
	body               []byte
} {
	return []struct {
		module, flag, name string
		body               []byte
	}{
		{"docs", "office_docs_web", "plan.docx", frameDocx(t, "m")},
		{"pdf", "office_pdf_web", "scan.pdf", framePDF},
		{"markdown", "office_markdown_web", "notes.md", []byte("# notes\n")},
		{"html", "office_html_web", "page.html", []byte("<!doctype html><html><body><p>hi</p></body></html>\n")},
		{"slides", "office_slides_web", "deck.pptx", frameZip(t, "[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml")},
		{"sheets", "office_sheets_web", "book.xlsx", frameXlsx(t, 0)},
	}
}

// restrictedFileSharedWith uploads a file document, restricts it and grants
// memberID level on it.
func (w *officeWorld) restrictedFileSharedWith(t *testing.T, name string, body []byte, memberID, level string) string {
	t.Helper()
	documentID := w.createDocx(t, name, body)
	_, got := doJSON(t, w.srv, "GET", "/api/v1/documents/"+documentID, w.token, nil)
	revision, _ := got["document"].(map[string]any)["revision"].(string)
	if res, out := doJSON(t, w.srv, "PATCH", "/api/v1/documents/"+documentID, w.token, map[string]any{"revision": revision, "visibility": "restricted"}); res.StatusCode != 200 {
		t.Fatalf("restrict %s: %d %v", name, res.StatusCode, out)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": level}); res.StatusCode != 201 {
		t.Fatalf("share %s: %d %v", name, res.StatusCode, out)
	}
	return documentID
}

// For every module: a view-only token opens and reads, its uploads and
// commits are refused (can_edit is only a hint, the Documents commands hold
// the line), and the owner's commit answers with the token's module.
func TestOfficeFrameViewOnlyTokenCannotWriteInAnyModule(t *testing.T) {
	w := newOfficeWorld(t, true)
	viewer, viewerID := w.officeJoinWorkspace(t, "office-frame-module-viewer@example.com")
	for _, m := range frameModuleFiles(t) {
		t.Run(m.module, func(t *testing.T) {
			setOfficeFrameFlagFor(t, w.q, m.flag, w.orgID, true)
			documentID := w.restrictedFileSharedWith(t, m.name, m.body, viewerID, "view")
			base := "/api/v1/office-frame/documents/" + documentID

			res, minted := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", viewer, nil)
			if res.StatusCode != 201 || minted["can_edit"] != false || minted["module"] != m.module {
				t.Fatalf("viewer mint = %d %v", res.StatusCode, minted)
			}
			token := minted["token"].(string)
			res, opened := doJSON(t, w.srv, "GET", base, token, nil)
			if res.StatusCode != 200 || opened["can_edit"] != false || opened["module"] != m.module {
				t.Fatalf("viewer open = %d %v", res.StatusCode, opened)
			}
			if res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", token, nil, m.name, m.body, nil); res.StatusCode != 403 {
				t.Fatalf("viewer upload = %d %s", res.StatusCode, raw)
			}

			ownerToken := w.mintFrameToken(t, documentID)["token"].(string)
			res, raw := doMultipart(t, w.srv, "POST", base+"/uploads", ownerToken, nil, m.name, m.body, nil)
			if res.StatusCode != 201 {
				t.Fatalf("owner upload = %d %s", res.StatusCode, raw)
			}
			var up struct {
				UploadID string `json:"upload_id"`
			}
			_ = json.Unmarshal(raw, &up)
			body := map[string]string{"upload_id": up.UploadID, "base_revision": opened["revision"].(string)}
			if res, out := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", token, map[string]string{"Idempotency-Key": "viewer-" + m.module}, body); res.StatusCode != 403 {
				t.Fatalf("viewer commit = %d %v", res.StatusCode, out)
			}
			res, saved := doJSONHeaders(t, w.srv, "POST", base+"/versions/commit", ownerToken, map[string]string{"Idempotency-Key": "owner-" + m.module}, body)
			if res.StatusCode != 200 || saved["module"] != m.module || saved["revision"] == opened["revision"] {
				t.Fatalf("owner commit = %d %v, want module %s", res.StatusCode, saved, m.module)
			}
			setOfficeFrameFlagFor(t, w.q, m.flag, w.orgID, false)
		})
	}
}

// A signed image URL keeps the token's module: the byte route checks that
// module's flag (not office_docs_web) and Authorize matches the document.
func TestOfficeFrameSignedAssetKeepsTheModule(t *testing.T) {
	w := newOfficeWorld(t, true)
	setOfficeFrameFlagFor(t, w.q, "office_pdf_web", w.orgID, true)
	pdf := w.createDocx(t, "scan.pdf", framePDF)
	minted := w.mintFrameToken(t, pdf)
	if minted["module"] != "pdf" {
		t.Fatalf("mint = %v", minted)
	}
	token := minted["token"].(string)
	base := "/api/v1/office-frame/documents/" + pdf

	res, raw := doMultipart(t, w.srv, "POST", base+"/assets", token, nil, "dot.png", docsPNG, nil)
	if res.StatusCode != 201 {
		t.Fatalf("asset upload = %d %s", res.StatusCode, raw)
	}
	var asset struct {
		AssetID string `json:"asset_id"`
	}
	_ = json.Unmarshal(raw, &asset)
	res, signed := doJSON(t, w.srv, "POST", base+"/assets/sign", token, map[string]any{"asset_ids": []string{asset.AssetID}})
	items, _ := signed["items"].([]any)
	if res.StatusCode != 200 || len(items) != 1 {
		t.Fatalf("sign = %d %v", res.StatusCode, signed)
	}
	url := items[0].(map[string]any)["url"].(string)

	// Only office_pdf_web is on: the signed GET loads.
	if res, got := doBytes(t, w.srv, "GET", url, ""); res.StatusCode != 200 || !bytes.Equal(got, docsPNG) {
		t.Fatalf("signed GET with the pdf flag on = %d (%d bytes)", res.StatusCode, len(got))
	}
	// PDF off, Docs on: the URL stops on the pdf flag, not on the docs one.
	setOfficeFrameFlagFor(t, w.q, "office_pdf_web", w.orgID, false)
	setOfficeFrameFlagFor(t, w.q, "office_docs_web", w.orgID, true)
	res, got := doBytes(t, w.srv, "GET", url, "")
	var out map[string]any
	_ = json.Unmarshal(got, &out)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("signed GET with the pdf flag off = %d %s, want 404 feature_disabled", res.StatusCode, got)
	}
}

// The module's flag answers before the size cap: an oversized xlsx in an
// organization without office_sheets_web is 403 feature_disabled, not 413.
func TestOfficeFrameMintAnswersTheFlagBeforeTheSizeCap(t *testing.T) {
	w := newOfficeWorld(t, true)
	big := w.createDocx(t, "big.xlsx", frameXlsx(t, service.OfficeFrameSheetsMaxBytes+1))
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+big+"/office/frame-token", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "feature_disabled" {
		t.Fatalf("big xlsx mint with the sheets flag off = %d %v, want 403 feature_disabled", res.StatusCode, out)
	}
}
