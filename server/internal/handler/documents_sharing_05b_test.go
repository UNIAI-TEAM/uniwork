package handler

// Handler tests for the G1-05b Documents sharing and public-link surface
// (UNI-679, C-01 §5.3/§5.4): access overview, grant/revoke, public links,
// the anonymous view/download/asset routes and the access log. Real router,
// real DB, real DocumentService; FileService is the in-memory fake.

import (
	"bytes"
	"encoding/json"
	"testing"

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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider shares: %d code=%q", res.StatusCode, code)
	}

	// A principal outside the organization and an unknown level are refused.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": w.outsider, "level": "view"})
	if code, _ := errCodeClass(out); res.StatusCode != 422 || code != "principal_not_in_organization" {
		t.Fatalf("foreign principal: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+doc+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "owner"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad level: %d code=%q", res.StatusCode, code)
	}

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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("revoked read: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+doc+"/shares/"+shareID, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("double revoke: %d code=%q", res.StatusCode, code)
	}

	// shared-with-me is a workspace-gated read.
	res, out = doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/shared-with-me", w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("outsider shared-with-me: %d code=%q", res.StatusCode, code)
	}
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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("unknown token: %d code=%q", res.StatusCode, code)
	}

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

	// The organization flag closes every public surface of the link.
	q := db.New(testPool)
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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("flag off view: %d code=%q", res.StatusCode, code)
	}
	res, _ = doBytes(t, w.srv, "GET", downloadURL, "")
	if res.StatusCode != 404 {
		t.Fatalf("flag off download: %d", res.StatusCode)
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("flag off asset: %d", res.StatusCode)
	}
	if _, err := q.UpsertFlagOverride(t.Context(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeOrganization,
		ScopeID: w.orgID, Enabled: true, Note: "public flag test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("restore org flag: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("switch off view: %d code=%q", res.StatusCode, code)
	}
	res, _ = doBytes(t, w.srv, "GET", downloadURL, "")
	if res.StatusCode != 404 {
		t.Fatalf("switch off download: %d", res.StatusCode)
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("switch off asset: %d", res.StatusCode)
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
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("revoked view: %d code=%q", res.StatusCode, code)
	}
	res, _ = doBytes(t, w.srv, "GET", "/api/v1/public/documents/"+pageToken+"/assets/"+assetID, "")
	if res.StatusCode != 404 {
		t.Fatalf("revoked asset: %d", res.StatusCode)
	}

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
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad action: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs?cursor=bm90LWpzb24", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad cursor: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs", member, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "forbidden" {
		t.Fatalf("view-level logs: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+doc+"/access-logs", w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider logs: %d code=%q", res.StatusCode, code)
	}
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
