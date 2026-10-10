package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// webpLossless1x1 is a real 1x1 lossless WebP (VP8L).
var webpLossless1x1 = []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")

// sampleBody is the contract sample verified as contentType.
func sampleBody(t *testing.T, contentType string) []byte {
	t.Helper()
	for _, s := range filescontract.Samples() {
		if s.ContentType == contentType {
			return s.Body
		}
	}
	t.Fatalf("no contract sample for %s", contentType)
	return nil
}

func (w *officeWorld) createFileIn(t *testing.T, parentID, name string, body []byte) string {
	t.Helper()
	fields := map[string]string{}
	if parentID != "" {
		fields["parent_id"] = parentID
	}
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token, fields, name, body, nil)
	if res.StatusCode != 201 {
		t.Fatalf("create %s: %d %s", name, res.StatusCode, raw)
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

func (w *officeWorld) createFolder(t *testing.T, parentID, title string) string {
	t.Helper()
	body := map[string]any{"title": title, "kind": "page"}
	if parentID != "" {
		body["parent_id"] = parentID
	}
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, body)
	if res.StatusCode != 201 {
		t.Fatalf("create page %s: %d %v", title, res.StatusCode, out)
	}
	return out["document"].(map[string]any)["id"].(string)
}

// An HTML document's relative references resolve on open (UNI-1232): a
// stylesheet, an SVG and a WebP picture next to it (one in a sub-folder), a
// picture one folder up, and a pasted picture stored as a document asset.
// Remote, missing and non-loadable references are absent. Each URL loads
// without a header, typed by extension, with the sandbox CSP and nosniff.
func TestOfficeFrameOpenResolvesRelativeReferences(t *testing.T) {
	w := newOfficeWorld(t, true)
	site := w.createFolder(t, "", "Site")
	img := w.createFolder(t, site, "img")
	w.createFileIn(t, "", "top.png", docsPNG)
	css := w.createFileIn(t, site, "style.css", sampleBody(t, "text/css"))
	w.createFileIn(t, site, "logo.svg", sampleBody(t, "image/svg+xml"))
	w.createFileIn(t, img, "pic.webp", webpLossless1x1)
	w.createFileIn(t, site, "notes.md", []byte("# not loaded\n"))
	page := []byte(`<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>
<img src="./img/pic.webp"><img src='logo.svg'><img src="../top.png"><img src="assets/image-1.png">
<img src="https://cdn.example/x.png"><img src="missing.png"><a href="notes.md">n</a>
<div style="background:url(img/pic.webp)"></div></body></html>`)
	documentID := w.createFileIn(t, site, "index.html", page)
	token := w.mintFrameToken(t, documentID)["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID

	if res, raw := doMultipart(t, w.srv, "POST", base+"/assets", token, nil, "image-1.png", docsPNG, nil); res.StatusCode != 201 {
		t.Fatalf("asset upload = %d %s", res.StatusCode, raw)
	}
	res, opened := doJSON(t, w.srv, "GET", base, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("open = %d %v", res.StatusCode, opened)
	}
	assets, _ := opened["assets"].(map[string]any)
	want := map[string]string{
		"style.css":          "text/css; charset=utf-8",
		"./img/pic.webp":     "image/webp",
		"img/pic.webp":       "image/webp",
		"logo.svg":           "image/svg+xml",
		"../top.png":         "image/png",
		"assets/image-1.png": "image/png",
	}
	if len(assets) != len(want) {
		t.Fatalf("assets = %v, want keys of %v", assets, want)
	}
	for path, ct := range want {
		url, _ := assets[path].(string)
		if !strings.HasPrefix(url, base+"/") || !strings.Contains(url, "?sig=") {
			t.Fatalf("assets[%q] = %q", path, url)
		}
		res, body := doBytes(t, w.srv, "GET", url, "")
		if res.StatusCode != 200 || len(body) == 0 {
			t.Fatalf("GET %s (%s) = %d", url, path, res.StatusCode)
		}
		if got := res.Header.Get("Content-Type"); got != ct {
			t.Errorf("%s: Content-Type = %q, want %q", path, got, ct)
		}
		if res.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(res.Header.Get("Content-Security-Policy"), "sandbox") {
			t.Errorf("%s: headers = %v", path, res.Header)
		}
	}
	if !strings.HasPrefix(assets["assets/image-1.png"].(string), base+"/assets/") ||
		!strings.HasPrefix(assets["style.css"].(string), base+"/linked/"+css+"?sig=ofl1.") {
		t.Fatalf("asset/linked routes = %v", assets)
	}

	// A sibling signature names one file: another id, a tampered signature
	// or the asset route are refused; a bearer token still reads it, and a
	// file the frames never load (the HTML page itself) is not found.
	cssURL := assets["style.css"].(string)
	sig := cssURL[strings.Index(cssURL, "?sig=")+len("?sig="):]
	for _, path := range []string{
		base + "/linked/" + documentID + "?sig=" + sig,
		base + "/linked/" + css + "?sig=" + sig + "x",
		base + "/assets/" + css + "?sig=" + sig,
	} {
		if res, _ := doBytes(t, w.srv, "GET", path, ""); res.StatusCode != 401 {
			t.Fatalf("GET %s = %d, want 401", path, res.StatusCode)
		}
	}
	if res, body := doBytes(t, w.srv, "GET", base+"/linked/"+css, token); res.StatusCode != 200 || !bytes.Equal(body, sampleBody(t, "text/css")) {
		t.Fatalf("bearer linked = %d", res.StatusCode)
	}
	if res, _ := doBytes(t, w.srv, "HEAD", base+"/linked/"+css, token); res.StatusCode != 200 {
		t.Fatalf("HEAD linked = %d", res.StatusCode)
	}
	if res, _ := doBytes(t, w.srv, "GET", base+"/linked/"+documentID, token); res.StatusCode != 404 {
		t.Fatalf("linked html page = %d, want 404", res.StatusCode)
	}
	// A session token is not a frame credential.
	if res, _ := doBytes(t, w.srv, "GET", base+"/linked/"+css, w.token); res.StatusCode != 401 {
		t.Fatalf("session token on linked = %d, want 401", res.StatusCode)
	}
}

// A Docs (or PDF, Slides, Sheets) open answers no assets map.
func TestOfficeFrameOpenHasNoAssetsOutsideTextModules(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	documentID := w.createDocx(t, "plan.docx", frameDocx(t, "plain"))
	token := w.mintFrameToken(t, documentID)["token"].(string)
	res, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+documentID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("open = %d", res.StatusCode)
	}
	if _, ok := opened["assets"]; ok {
		t.Fatalf("docx open carries assets: %v", opened["assets"])
	}
}

// Another member who may not view a sibling (it sits under a restricted
// page) gets the document without it, and its byte route refuses them.
func TestOfficeFrameSiblingNeedsItsOwnViewAccess(t *testing.T) {
	w := newOfficeWorld(t, true)
	documentID := w.createFileIn(t, "", "notes.md", []byte("![a](Private/secret.png) ![b](open.png)\n"))
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token,
		map[string]any{"title": "Private", "kind": "page", "visibility": "restricted"})
	if res.StatusCode != 201 {
		t.Fatalf("create restricted page: %d %v", res.StatusCode, out)
	}
	private := out["document"].(map[string]any)["id"].(string)
	secret := w.createFileIn(t, private, "secret.png", docsPNG)
	w.createFileIn(t, "", "open.png", docsPNG)

	// The owner sees both.
	ownerToken := w.mintFrameToken(t, documentID)["token"].(string)
	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+documentID, ownerToken, nil)
	if assets, _ := opened["assets"].(map[string]any); len(assets) != 2 {
		t.Fatalf("owner assets = %v, want both", opened["assets"])
	}

	if err := w.q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
		WorkspaceID: w.wsID, UserID: w.outsider, Role: "member", OrganizationID: w.orgID,
	}); err != nil {
		t.Fatal(err)
	}
	res, minted := doJSON(t, w.srv, "POST", "/api/v1/documents/"+documentID+"/office/frame-token", w.outsiderTok, nil)
	if res.StatusCode != 201 {
		t.Fatalf("member mint = %d %v", res.StatusCode, minted)
	}
	token := minted["token"].(string)
	res, opened = doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+documentID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("open = %d %v", res.StatusCode, opened)
	}
	assets, _ := opened["assets"].(map[string]any)
	if _, ok := assets["Private/secret.png"]; ok || assets["open.png"] == nil || len(assets) != 1 {
		t.Fatalf("member assets = %v, want only open.png", assets)
	}
	if res, _ := doBytes(t, w.srv, "GET", "/api/v1/office-frame/documents/"+documentID+"/linked/"+secret, token); res.StatusCode != 404 && res.StatusCode != 403 {
		t.Fatalf("linked secret = %d, want refusal", res.StatusCode)
	}
}
