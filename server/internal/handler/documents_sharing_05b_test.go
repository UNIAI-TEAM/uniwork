package handler

// Handler tests for the G1-05b Documents sharing and public-link surface
// (UNI-679, C-01 §5.3/§5.4): access overview, grant/revoke, public links,
// the anonymous view/download/asset routes and the access log. Real router,
// real DB, real DocumentService; FileService is the in-memory fake.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDocumentSharesFlow(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Restricted", "kind": "page", "visibility": "restricted"})
	member, memberID := docsJoinWorkspace(t, w, "docs-share-member@example.com")

	// Before any grant the member sees nothing; shared-with-me is empty.
	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", member, nil)
	if res.StatusCode != 200 || containsID(docIDs(t, out), doc) {
		t.Fatalf("pre-share list: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me", member, nil)
	if res.StatusCode != 200 || len(docIDs(t, out)) != 0 {
		t.Fatalf("pre-share shared-with-me: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.outsider, nil)
	wantErr(t, res, out, 404, "not_found", "missing")

	// A principal outside the organization and an unknown level are refused.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": w.outsider, "level": "view"})
	wantErr(t, res, out, 422, "principal_not_in_organization", "")
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "owner"})
	wantErr(t, res, out, 400, "invalid_request", "")

	// Grant view; the response carries the row.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("share: %d %v", res.StatusCode, out)
	}
	share := out["share"].(map[string]any)
	shareID := share["id"].(string)
	if share["level"] != "view" || share["active"] != true || share["principal_id"] != memberID {
		t.Fatalf("share row = %v", share)
	}

	// The grant reaches the member: list and shared-with-me both show it.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents", member, nil)
	if res.StatusCode != 200 || !containsID(docIDs(t, out), doc) {
		t.Fatalf("shared list: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me", member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("shared-with-me: %d %v", res.StatusCode, out)
	}
	rows := out["documents"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != doc {
		t.Fatalf("shared-with-me rows = %v", rows)
	}
	if rows[0].(map[string]any)["my_level"] != "view" || rows[0].(map[string]any)["via"] != "share" {
		t.Fatalf("shared-with-me access = %v", rows[0])
	}

	// A view-level member reads only their own level from the overview.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", member, nil)
	if res.StatusCode != 200 || out["my_level"] != "view" || out["via"] != "share" {
		t.Fatalf("member overview: %d %v", res.StatusCode, out)
	}
	if out["shares"] != nil || out["links"] != nil || out["acl_owner"] != nil {
		t.Fatalf("member overview leaked grants: %v", out)
	}

	// The manager sees the grant and the acl owner.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner overview: %d %v", res.StatusCode, out)
	}
	if shares, _ := out["shares"].([]any); len(shares) != 1 || shares[0].(map[string]any)["id"] != shareID {
		t.Fatalf("owner shares = %v", out["shares"])
	}
	if out["acl_owner"] == nil {
		t.Fatalf("owner acl block missing: %v", out)
	}

	// Same principal at a new level replaces the live grant (one row).
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "edit"})
	if res.StatusCode != 201 {
		t.Fatalf("share update: %d %v", res.StatusCode, out)
	}
	if out["share"].(map[string]any)["level"] != "edit" {
		t.Fatalf("share update row = %v", out)
	}
	// The replacement revokes the old row and inserts a new one, so the live
	// grant id changes.
	shareID = out["share"].(map[string]any)["id"].(string)
	_, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/shares", w.token, nil)
	if shares, _ := out["shares"].([]any); len(shares) != 1 || shares[0].(map[string]any)["level"] != "edit" {
		t.Fatalf("share update not replacing: %v", out["shares"])
	}

	// Revoke ends it; the member loses the document and a second delete is 404.
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+doc+"/shares/"+shareID, w.token, nil)
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("revoke: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, member, nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+doc+"/shares/"+shareID, w.token, nil)
	wantErr(t, res, out, 404, "not_found", "missing")

	// shared-with-me is a workspace-gated read.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me", w.outsider, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
}

func TestDocumentPublicLinks(t *testing.T) {
	w := newDocsWorld(t)
	_, page := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Public page", "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}},
	})
	_, fileDoc := docsCreateFileDoc(t, w, "public.txt", []byte("public bytes\n"))

	// The switch defaults off; create-link answers document_links_disabled.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/links", w.token, map[string]any{"expires_in_days": 7})
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "document_links_disabled" {
		t.Fatalf("switch off: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, map[string]any{"public_links_enabled": true})
	if res.StatusCode != 200 {
		t.Fatalf("enable links: %d %v", res.StatusCode, out)
	}

	// An out-of-range expiry is refused.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/links", w.token, map[string]any{"expires_in_days": 91})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad expiry: %d code=%q", res.StatusCode, code)
	}

	// Unknown token: 404 with no hint.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/unknown-token", "", nil)
	wantErr(t, res, out, 404, "not_found", "missing")

	// 404 parity: unknown, revoked, switch-off and flag-off must answer the
	// same body and headers, so a public caller cannot tell them apart.
	raw404 := func(method, path string) (string, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, w.srv.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := w.srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(body), resp.Header.Get("Content-Type") + "|" + resp.Header.Get("X-Content-Type-Options")
	}
	same404 := func(name, body, headers, wantBody, wantHeaders string) {
		t.Helper()
		if body != wantBody || headers != wantHeaders {
			t.Fatalf("%s 404 differs from unknown-token: body %q vs %q headers %q vs %q",
				name, body, wantBody, headers, wantHeaders)
		}
	}
	unknownBody, unknownHeaders := raw404("GET", "/api/v1/public/documents/unknown-token")
	unknownAssetBody, unknownAssetHeaders := raw404("GET", "/api/v1/public/documents/unknown-token/assets/01J8X4AST0N1P2Q3R4S5T6U7V8")
	unknownAssetHeadBody, unknownAssetHeadHeaders := raw404("HEAD", "/api/v1/public/documents/unknown-token/assets/01J8X4AST0N1P2Q3R4S5T6U7V8")
	unknownDownloadBody, unknownDownloadHeaders := raw404("GET", "/api/v1/public/documents/unknown-token/download")

	// Create one page link and one file link.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/links", w.token, map[string]any{"expires_in_days": 7})
	if res.StatusCode != 201 {
		t.Fatalf("page link: %d %v", res.StatusCode, out)
	}
	pageToken := out["token"].(string)
	pageLinkID := out["link"].(map[string]any)["id"].(string)
	if out["url"] != "/share/"+pageToken || pageToken == "" {
		t.Fatalf("link payload = %v", out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+fileDoc+"/links", w.token, map[string]any{"expires_in_days": 7})
	if res.StatusCode != 201 {
		t.Fatalf("file link: %d %v", res.StatusCode, out)
	}
	fileToken := out["token"].(string)
	fileLinkID := out["link"].(map[string]any)["id"].(string)

	// The anonymous view: page content for the page, download_url for the file.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("public page: %d %v", res.StatusCode, out)
	}
	pub := out["document"].(map[string]any)
	if pub["title"] != "Public page" || pub["kind"] != "page" || pub["content"] == nil || pub["download_url"] != nil {
		t.Fatalf("public page payload = %v", pub)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+fileToken, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("public file: %d %v", res.StatusCode, out)
	}
	pub = out["document"].(map[string]any)
	if pub["kind"] != "file" || pub["content"] != nil {
		t.Fatalf("public file payload = %v", pub)
	}
	downloadURL, _ := pub["download_url"].(string)
	if downloadURL == "" {
		t.Fatalf("file download_url missing: %v", pub)
	}

	// The file bytes stream anonymously; HEAD and Range work; a page link
	// does not serve the file route.
	res, raw := doBytes(t, w.srv, "GET", downloadURL, "")
	if res.StatusCode != 200 || !bytes.Contains(raw, []byte("public bytes")) {
		t.Fatalf("public download: %d body=%q", res.StatusCode, raw[:min(len(raw), 40)])
	}
	res, raw = doBytes(t, w.srv, "GET", downloadURL, "", "Range", "bytes=0-5")
	if res.StatusCode != 206 || len(raw) != 6 || res.Header.Get("Content-Range") == "" {
		t.Fatalf("public range: %d len=%d", res.StatusCode, len(raw))
	}
	res, raw = doBytes(t, w.srv, "HEAD", downloadURL, "")
	if res.StatusCode != 200 || len(raw) != 0 || res.Header.Get("Content-Length") == "" {
		t.Fatalf("public head: %d len=%d", res.StatusCode, len(raw))
	}
	res, raw = doBytes(t, w.srv, "GET", downloadURL, "", "Range", "bytes=-4")
	if res.StatusCode != 206 || len(raw) != 4 {
		t.Fatalf("public suffix range: %d len=%d", res.StatusCode, len(raw))
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/download", "", nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("page download through link: %d code=%q", res.StatusCode, code)
	}

	// A page asset streams anonymously through the link, by exact asset id.
	res, raw = doMultipart(t, w.srv, "POST", "/api/v1/documents/"+page+"/assets", w.token, nil, "pic.png", docsPNG, nil)
	if res.StatusCode != 201 {
		t.Fatalf("asset upload: %d %s", res.StatusCode, raw)
	}
	var assetOut map[string]any
	_ = json.Unmarshal(raw, &assetOut)
	assetID := assetOut["id"].(string)
	res, raw = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 200 || !bytes.Equal(raw, docsPNG) {
		t.Fatalf("public asset: %d len=%d", res.StatusCode, len(raw))
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/png" {
		t.Fatalf("public asset content-type = %q", ct)
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/01J8X4AST0N1P2Q3R4S5T6U7V8", "")
	if res.StatusCode != 404 {
		t.Fatalf("unknown public asset: %d", res.StatusCode)
	}
	res, _ = doBytes(t, w.srv, "HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 200 {
		t.Fatalf("live asset HEAD: %d", res.StatusCode)
	}

	// Link view counts and log rows are read back through the manage routes
	// so the flag-off block can prove neither moved.
	pageLinkViews := func() float64 {
		t.Helper()
		res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+page+"/shares", w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("overview: %d %v", res.StatusCode, out)
		}
		for _, l := range out["links"].([]any) {
			row := l.(map[string]any)
			if row["id"] == pageLinkID {
				return row["view_count"].(float64)
			}
		}
		t.Fatalf("page link missing from overview: %v", out["links"])
		return 0
	}
	pageAccessLogs := func() int {
		t.Helper()
		res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+page+"/access-logs?limit=100", w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("logs: %d %v", res.StatusCode, out)
		}
		return len(out["logs"].([]any))
	}

	// The organization flag closes every public surface of the link without
	// any side effect: a flag-off read must not count a view or write a log
	// row, and its 404 must match the unknown-token one byte for byte.
	q := db.New(testPool)
	viewsBefore := pageLinkViews()
	logsBefore := pageAccessLogs()
	if _, err := q.UpsertFlagOverride(t.Context(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeOrganization,
		ScopeID: w.orgID, Enabled: false, Note: "public flag test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("org flag override: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken, "", nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	flagBody, flagHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken)
	same404("flag-off view", flagBody, flagHeaders, unknownBody, unknownHeaders)
	res, _ = doBytes(t, w.srv, "GET", downloadURL, "")
	if res.StatusCode != 404 {
		t.Fatalf("flag off download: %d", res.StatusCode)
	}
	flagDownloadBody, flagDownloadHeaders := raw404("GET", downloadURL)
	same404("flag-off download", flagDownloadBody, flagDownloadHeaders, unknownDownloadBody, unknownDownloadHeaders)
	res, _ = doBytes(t, w.srv, "GET", downloadURL, "", "Range", "bytes=-4")
	if res.StatusCode != 404 {
		t.Fatalf("flag off suffix-range download: %d", res.StatusCode)
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("flag off asset: %d", res.StatusCode)
	}
	flagAssetBody, flagAssetHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID)
	same404("flag-off asset", flagAssetBody, flagAssetHeaders, unknownAssetBody, unknownAssetHeaders)
	res, _ = doBytes(t, w.srv, "HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("flag off asset HEAD: %d", res.StatusCode)
	}
	flagHeadBody, flagHeadHeaders := raw404("HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID)
	same404("flag-off asset HEAD", flagHeadBody, flagHeadHeaders, unknownAssetHeadBody, unknownAssetHeadHeaders)
	if _, err := q.UpsertFlagOverride(t.Context(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeOrganization,
		ScopeID: w.orgID, Enabled: true, Note: "public flag test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("restore org flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	if got := pageLinkViews(); got != viewsBefore {
		t.Fatalf("flag-off reads counted a view: %v -> %v", viewsBefore, got)
	}
	if got := pageAccessLogs(); got != logsBefore {
		t.Fatalf("flag-off reads wrote access-log rows: %d -> %d", logsBefore, got)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("flag back on: %d %v", res.StatusCode, out)
	}

	// Turning the switch off closes the links without revoking them.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, map[string]any{"public_links_enabled": false})
	if res.StatusCode != 200 {
		t.Fatalf("disable links: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken, "", nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	settingBody, settingHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken)
	same404("switch-off view", settingBody, settingHeaders, unknownBody, unknownHeaders)
	res, _ = doBytes(t, w.srv, "GET", downloadURL, "")
	if res.StatusCode != 404 {
		t.Fatalf("switch off download: %d", res.StatusCode)
	}
	settingDownloadBody, settingDownloadHeaders := raw404("GET", downloadURL)
	same404("switch-off download", settingDownloadBody, settingDownloadHeaders, unknownDownloadBody, unknownDownloadHeaders)
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("switch off asset: %d", res.StatusCode)
	}
	settingAssetBody, settingAssetHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID)
	same404("switch-off asset", settingAssetBody, settingAssetHeaders, unknownAssetBody, unknownAssetHeaders)
	res, _ = doBytes(t, w.srv, "HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("switch off asset HEAD: %d", res.StatusCode)
	}
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.orgID+"/documents/settings", w.token, map[string]any{"public_links_enabled": true})
	if res.StatusCode != 200 {
		t.Fatalf("re-enable links: %d %v", res.StatusCode, out)
	}

	// Revoke closes the page link on every surface.
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+page+"/links/"+pageLinkID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("revoke link: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken, "", nil)
	wantErr(t, res, out, 404, "not_found", "missing")
	revokedBody, revokedHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken)
	same404("revoked view", revokedBody, revokedHeaders, unknownBody, unknownHeaders)
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("revoked asset: %d", res.StatusCode)
	}
	revokedAssetBody, revokedAssetHeaders := raw404("GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID)
	same404("revoked asset", revokedAssetBody, revokedAssetHeaders, unknownAssetBody, unknownAssetHeaders)
	res, _ = doBytes(t, w.srv, "HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("revoked asset HEAD: %d", res.StatusCode)
	}
	revokedHeadBody, revokedHeadHeaders := raw404("HEAD", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID)
	same404("revoked asset HEAD", revokedHeadBody, revokedHeadHeaders, unknownAssetHeadBody, unknownAssetHeadHeaders)

	// Five live links per document; the sixth is refused.
	for i := 0; i < 5; i++ {
		res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/links", w.token, map[string]any{})
		if res.StatusCode != 201 {
			t.Fatalf("live link %d: %d %v", i+1, res.StatusCode, out)
		}
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/links", w.token, map[string]any{})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "document_link_limit" {
		t.Fatalf("link limit: %d code=%q", res.StatusCode, code)
	}

	// The manager's overview lists live links but never a token.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+page+"/shares", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("overview: %d %v", res.StatusCode, out)
	}
	links, _ := out["links"].([]any)
	if len(links) != 5 {
		t.Fatalf("overview links = %v", out["links"])
	}
	if _, leaked := links[0].(map[string]any)["token"]; leaked {
		t.Fatalf("link token leaked in overview: %v", links[0])
	}
	_ = fileLinkID

	// A public view counts and logs but exposes nothing else.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/public/documents/"+fileToken, "", nil)
	if res.StatusCode != 200 {
		t.Fatalf("public file view: %d %v", res.StatusCode, out)
	}
	if len(out) != 1 {
		t.Fatalf("public payload grew: %v", out)
	}

	// Revoking the file link closes the download route with the same 404 as
	// an unknown token.
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+fileDoc+"/links/"+fileLinkID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("revoke file link: %d %v", res.StatusCode, out)
	}
	revokedDownloadBody, revokedDownloadHeaders := raw404("GET", downloadURL)
	same404("revoked download", revokedDownloadBody, revokedDownloadHeaders, unknownDownloadBody, unknownDownloadHeaders)
}

func TestDocumentAccessLog(t *testing.T) {
	w := newDocsWorld(t)
	_, doc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Logged", "kind": "page", "visibility": "restricted"})
	member, memberID := docsJoinWorkspace(t, w, "docs-log-member@example.com")

	// Owner views (via member); member gets a share and views (via share).
	res, _ := doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("owner view: %d", res.StatusCode)
	}
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "view"})
	if res.StatusCode != 201 {
		t.Fatalf("share: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc, member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("member view: %d", res.StatusCode)
	}

	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("logs: %d %v", res.StatusCode, out)
	}
	logs := out["logs"].([]any)
	if len(logs) < 2 {
		t.Fatalf("logs = %v", logs)
	}
	var memberRow map[string]any
	for _, l := range logs {
		row := l.(map[string]any)
		if row["actor_id"] == memberID {
			memberRow = row
		}
	}
	if memberRow == nil || memberRow["via"] != "share" || memberRow["action"] != "view" {
		t.Fatalf("member log row = %v", memberRow)
	}
	actor, _ := memberRow["actor"].(map[string]any)
	if actor == nil || actor["display_name"] == "" || actor["kind"] != "human" {
		t.Fatalf("member actor block = %v", memberRow["actor"])
	}

	// Two rows that share the boundary timestamp both stay reachable: the
	// cursor carries (occurred_at, id), so the window cannot skip one
	// (BE05B-01).
	if _, err := testPool.Exec(t.Context(),
		`UPDATE document_access_logs SET occurred_at = '2026-09-28T12:00:00Z' WHERE document_id = $1`, doc); err != nil {
		t.Fatalf("force same timestamp: %v", err)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?limit=1", w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 1 {
		t.Fatalf("same-timestamp page 1: %d %v", res.StatusCode, out)
	}
	firstID := out["logs"].([]any)[0].(map[string]any)["id"].(string)
	sameCursor, _ := out["next_cursor"].(string)
	if sameCursor == "" {
		t.Fatalf("same-timestamp page 1 missing cursor: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?limit=1&cursor="+sameCursor, w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 1 {
		t.Fatalf("same-timestamp page 2: %d %v", res.StatusCode, out)
	}
	if secondID := out["logs"].([]any)[0].(map[string]any)["id"].(string); secondID == firstID {
		t.Fatalf("same-timestamp row repeated: %s", firstID)
	}

	// Action filter and limit + cursor paging.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?action=download", w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 0 {
		t.Fatalf("download filter: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?limit=1", w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 1 {
		t.Fatalf("log page 1: %d %v", res.StatusCode, out)
	}
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("log page 1 missing cursor: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?limit=1&cursor="+cursor, w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 1 {
		t.Fatalf("log page 2: %d %v", res.StatusCode, out)
	}

	// Bad inputs and the manage gate.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?action=delete", w.token, nil)
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?cursor=bm90LWpzb24", w.token, nil)
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs", member, nil)
	wantErr(t, res, out, 403, "forbidden", "permission")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs", w.outsider, nil)
	wantErr(t, res, out, 404, "not_found", "missing")

	// The handler uses the service's effective limit: limit=101 pages as 50
	// with a cursor instead of dropping history (BE05B-02).
	_, bulk := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Bulk log", "kind": "page"})
	for i := 0; i < 60; i++ {
		ts := time.Date(2026, 9, 28, 10, 0, 0, i*1_000_000, time.UTC)
		if _, err := testPool.Exec(t.Context(),
			`INSERT INTO document_access_logs (id, organization_id, workspace_id, document_id, action, actor_kind, via, correlation_id, occurred_at)
			 VALUES ($1, $2, $3, $4, 'view', 'human', 'member', $5, $6)`,
			util.NewID(), w.orgID, w.wsID, bulk, util.NewID(), ts); err != nil {
			t.Fatalf("seed log %d: %v", i, err)
		}
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+bulk+"/access-logs?limit=101", w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 50 {
		t.Fatalf("limit=101 page 1: %d rows=%d", res.StatusCode, len(out["logs"].([]any)))
	}
	bulkCursor, _ := out["next_cursor"].(string)
	if bulkCursor == "" {
		t.Fatalf("limit=101 page 1 missing cursor: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+bulk+"/access-logs?limit=101&cursor="+bulkCursor, w.token, nil)
	if res.StatusCode != 200 || len(out["logs"].([]any)) != 10 {
		t.Fatalf("limit=101 page 2: %d rows=%d", res.StatusCode, len(out["logs"].([]any)))
	}
	if next, _ := out["next_cursor"].(string); next != "" {
		t.Fatalf("limit=101 page 2 has a cursor: %v", out)
	}
}

// TestDocumentSharedWithMePaging proves the route exposes keyset paging
// (limit + opaque cursor) over visible shares, and refuses malformed paging
// input before the service (BE05B-04).
func TestDocumentSharedWithMePaging(t *testing.T) {
	w := newDocsWorld(t)
	member, memberID := docsJoinWorkspace(t, w, "docs-swm-page@example.com")
	ids := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		_, id := docsCreatePageBody(t, w, w.token, map[string]any{
			"title": "Shared " + string(rune('a'+i)), "kind": "page", "visibility": "restricted"})
		res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/shares", w.token, map[string]any{
			"principal_type": "user", "principal_id": memberID, "level": "view"})
		if res.StatusCode != 201 {
			t.Fatalf("share %d: %d %v", i, res.StatusCode, out)
		}
		ids = append(ids, id)
	}
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 6; page++ {
		path := "/api/v1/workspaces/" + w.wsID + "/documents/shared-with-me?limit=2"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		res, out := doJSON(t, w.srv, "GET", path, member, nil)
		if res.StatusCode != 200 {
			t.Fatalf("shared-with-me page %d: %d %v", page, res.StatusCode, out)
		}
		rows := out["documents"].([]any)
		if len(rows) > 2 {
			t.Fatalf("shared-with-me page %d over limit: %d rows", page, len(rows))
		}
		for _, r := range rows {
			id := r.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatalf("shared-with-me cursor repeated %s on page %d", id, page)
			}
			seen[id] = true
		}
		next, _ := out["next_cursor"].(string)
		if next == "" {
			break
		}
		cursor = next
	}
	if len(seen) != 3 {
		t.Fatalf("shared-with-me walk saw %d documents, want 3", len(seen))
	}
	for _, id := range ids {
		if !seen[id] {
			t.Fatalf("shared document %s missing from the walk", id)
		}
	}

	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me?cursor=bm90LWpzb24", member, nil)
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me?limit=-1", member, nil)
	wantErr(t, res, out, 400, "invalid_request", "")
}

// docsCreateFileDoc creates one file document through the multipart route.
func docsCreateFileDoc(t *testing.T, w *docsWorld, filename string, body []byte) (map[string]any, string) {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": filename}, filename, body, nil)
	if res.StatusCode != 201 {
		t.Fatalf("create file doc: %d %s", res.StatusCode, raw)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	doc := out["document"].(map[string]any)
	return doc, doc["id"].(string)
}
