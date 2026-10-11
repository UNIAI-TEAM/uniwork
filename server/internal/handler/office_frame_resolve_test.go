package handler

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// frameClock is the OfficeFrameService clock of a test that outlives a token
// or a signature.
type frameClock struct {
	mu sync.Mutex
	at time.Time
}

func (c *frameClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *frameClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.at = c.at.Add(d)
}

// newFrameClockWorld is an Office world whose frame service the test holds
// (to forge a signature) and whose clock it moves.
func newFrameClockWorld(t *testing.T) (*officeWorld, *service.OfficeFrameService, *frameClock) {
	t.Helper()
	clock := &frameClock{at: time.Now()}
	var frames *service.OfficeFrameService
	w := newOfficeWorldTweaked(t, true, func(*filesfake.Fake) service.OfficeEngine { return newHandlerStubEngine(t) }, func(d *Deps, _ *pgxpool.Pool) {
		frames = service.NewOfficeFrameService(d.Documents, d.Cfg.JWTSecret)
		frames.SetClock(clock.now)
		d.OfficeFrame = frames
	})
	return w, frames, clock
}

func sigOf(t *testing.T, url string) string {
	t.Helper()
	_, sig, ok := strings.Cut(url, "?sig=")
	if !ok {
		t.Fatalf("no signature in %q", url)
	}
	return sig
}

// resolvePaths is POST .../assets/resolve as the frame; items come back as
// path -> url in the order answered.
func (w *officeWorld) resolvePaths(t *testing.T, documentID, token string, paths []string) (int, []string, map[string]string) {
	t.Helper()
	res, out := doJSON(t, w.srv, "POST", "/api/v1/office-frame/documents/"+documentID+"/assets/resolve", token, map[string]any{"paths": paths})
	var order []string
	urls := map[string]string{}
	items, _ := out["items"].([]any)
	for _, it := range items {
		m := it.(map[string]any)
		p, u := m["path"].(string), m["url"].(string)
		if m["expires_at"] == "" {
			t.Fatalf("resolve item %v has no expires_at", m)
		}
		order = append(order, p)
		urls[p] = u
	}
	return res.StatusCode, order, urls
}

// A sibling file opens through the signature minted for exactly this
// document and file, never through a frame token (RA-1): a token of any
// module, even the document's own, is refused, and a signature does not carry
// to another document's path.
func TestOfficeFrameLinkedTakesNoFrameToken(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	css := w.createFileIn(t, "", "style.css", sampleBody(t, "text/css"))
	page := w.createFileIn(t, "", "index.html", []byte(`<link rel="stylesheet" href="style.css">`))
	docx := w.createDocx(t, "plan.docx", frameDocx(t, "plain"))
	pageToken := w.mintFrameToken(t, page)["token"].(string)
	docxToken := w.mintFrameToken(t, docx)["token"].(string)

	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+page, pageToken, nil)
	signed := opened["assets"].(map[string]any)["style.css"].(string)
	sig := sigOf(t, signed)
	pageLinked := "/api/v1/office-frame/documents/" + page + "/linked/" + css
	docxLinked := "/api/v1/office-frame/documents/" + docx + "/linked/" + css

	for _, method := range []string{"GET", "HEAD"} {
		if res, _ := doBytes(t, w.srv, method, signed, ""); res.StatusCode != 200 {
			t.Fatalf("%s signed linked = %d", method, res.StatusCode)
		}
	}
	for name, c := range map[string]struct{ path, token string }{
		"the document's own token":    {pageLinked, pageToken},
		"a DOCX token on its own":     {docxLinked, docxToken},
		"a DOCX token on the page":    {pageLinked, docxToken},
		"a session token":             {pageLinked, w.token},
		"no credential":               {pageLinked, ""},
		"the page signature on DOCX":  {docxLinked + "?sig=" + sig, ""},
		"the signature of another id": {"/api/v1/office-frame/documents/" + page + "/linked/" + page + "?sig=" + sig, ""},
	} {
		if res, body := doBytes(t, w.srv, "GET", c.path, c.token); res.StatusCode != 401 {
			t.Errorf("%s: GET linked = %d, want 401: %s", name, res.StatusCode, body)
		}
	}
	// A signature is read-only.
	if res, _ := doBytes(t, w.srv, "POST", signed, ""); res.StatusCode == 200 {
		t.Fatal("POST with a linked signature answered 200")
	}
	// The asset route still takes the frame token of its own document (Docs images).
	if res, _ := doBytes(t, w.srv, "GET", "/api/v1/office-frame/documents/"+docx+"/assets/"+css, docxToken); res.StatusCode == 401 {
		t.Fatalf("docx token on its asset route = 401, the asset route reads the token")
	}
}

// Paths typed after the open resolve through POST .../assets/resolve with the
// open's normalisation and ACL, in request order; unresolved paths are absent
// and the call is bounded (UNI-1232 item 2).
func TestOfficeFrameResolveTypedPaths(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	site := w.createFolder(t, "", "Site")
	w.createFileIn(t, site, "a.png", docsPNG)
	page := w.createFileIn(t, site, "index.md", []byte("![a](a.png)\n"))
	token := w.mintFrameToken(t, page)["token"].(string)
	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+page, token, nil)
	if assets, _ := opened["assets"].(map[string]any); len(assets) != 1 {
		t.Fatalf("open assets = %v", opened["assets"])
	}
	// Written after the open.
	w.createFileIn(t, site, "later.png", docsPNG)
	w.createFileIn(t, "", "top.png", docsPNG)

	status, order, urls := w.resolvePaths(t, page, token, []string{
		"a.png", "./later.png", "../top.png", "missing.png", "assets/none.png", "https://cdn.example/x.png", "/abs.png", "a.png",
	})
	if status != 200 {
		t.Fatalf("resolve = %d", status)
	}
	if want := []string{"a.png", "./later.png", "../top.png"}; strings.Join(order, "|") != strings.Join(want, "|") {
		t.Fatalf("resolved paths = %v, want %v", order, want)
	}
	for p, u := range urls {
		if !strings.HasPrefix(u, "/api/v1/office-frame/documents/"+page+"/linked/") || !strings.Contains(u, "?sig=ofl1.") {
			t.Errorf("%s -> %q", p, u)
		}
		if res, body := doBytes(t, w.srv, "GET", u, ""); res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || len(body) == 0 {
			t.Errorf("GET %s = %d %s", u, res.StatusCode, res.Header.Get("Content-Type"))
		}
	}

	// Bounded: 1..50 paths.
	many := make([]string, service.OfficeFrameResolveMaxPaths+1)
	for i := range many {
		many[i] = "p" + strconv.Itoa(i) + ".png"
	}
	if status, _, _ := w.resolvePaths(t, page, token, many); status != 400 {
		t.Fatalf("%d paths = %d, want 400", len(many), status)
	}
	if status, _, _ := w.resolvePaths(t, page, token, []string{}); status != 400 {
		t.Fatalf("no paths = %d, want 400", status)
	}
	if status, _, _ := w.resolvePaths(t, page, token, many[:service.OfficeFrameResolveMaxPaths]); status != 200 {
		t.Fatalf("%d paths = %d, want 200", service.OfficeFrameResolveMaxPaths, status)
	}

	// Frame token of the document only, and only of the text modules.
	docx := w.createDocx(t, "plan.docx", frameDocx(t, "plain"))
	docxToken := w.mintFrameToken(t, docx)["token"].(string)
	for name, c := range map[string]struct{ doc, token string }{
		"a DOCX token":     {docx, docxToken},
		"another document": {docx, token},
		"a session token":  {page, w.token},
		"no token":         {page, ""},
	} {
		status, _, _ := w.resolvePaths(t, c.doc, c.token, []string{"a.png"})
		if status != 404 && status != 401 {
			t.Errorf("resolve with %s = %d, want 401/404", name, status)
		}
	}
	if status, _, _ := w.resolvePaths(t, docx, docxToken, []string{"a.png"}); status != 404 {
		t.Fatalf("resolve on a DOCX = %d, want 404", status)
	}
}

// A session that outlives the signatures asks again: the old URL is refused
// after its hour, the resolved one reads, and a Docs image URL keeps the
// token's lifetime (RA-2).
func TestOfficeFrameResolveRefreshesURLsPastTheirLifetime(t *testing.T) {
	w, _, clock := newFrameClockWorld(t)
	w.createFileIn(t, "", "a.png", docsPNG)
	page := w.createFileIn(t, "", "index.md", []byte("![a](a.png)\n"))
	token := w.mintFrameToken(t, page)["token"].(string)
	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+page, token, nil)
	first := opened["assets"].(map[string]any)["a.png"].(string)
	if res, _ := doBytes(t, w.srv, "GET", first, ""); res.StatusCode != 200 {
		t.Fatalf("fresh URL = %d", res.StatusCode)
	}

	// The token (10 min) is long gone; the host re-mints with its session.
	clock.advance(50 * time.Minute)
	if status, _, _ := w.resolvePaths(t, page, token, []string{"a.png"}); status != 401 {
		t.Fatalf("resolve with an expired token = %d, want 401", status)
	}
	token = w.mintFrameToken(t, page)["token"].(string)
	status, _, urls := w.resolvePaths(t, page, token, []string{"a.png"})
	if status != 200 || urls["a.png"] == "" {
		t.Fatalf("resolve = %d %v", status, urls)
	}
	second := urls["a.png"]

	clock.advance(15 * time.Minute) // 65 min after the open
	if res, _ := doBytes(t, w.srv, "GET", first, ""); res.StatusCode != 401 {
		t.Fatalf("URL past its hour = %d, want 401", res.StatusCode)
	}
	if res, _ := doBytes(t, w.srv, "GET", second, ""); res.StatusCode != 200 {
		t.Fatalf("re-signed URL = %d, want 200", res.StatusCode)
	}
}

// A signed URL is no grant: each request rechecks the live ACL and the live
// tree (RA-4). Access revoked after signing, a sibling trashed after signing, a
// file of another workspace and an expired signature all stop at the byte route.
func TestOfficeFrameSignedURLsFollowTheLiveACL(t *testing.T) {
	w, frames, clock := newFrameClockWorld(t)
	ctx := context.Background()
	w.createFileIn(t, "", "open.png", docsPNG)
	trashed := w.createFileIn(t, "", "trashed.png", docsPNG)
	page := w.createFileIn(t, "", "notes.md", []byte("![a](open.png) ![b](trashed.png)\n"))

	// A workspace member opens the page; its URLs name them.
	if err := w.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.wsID, UserID: w.outsider, Role: "member", OrganizationID: w.orgID}); err != nil {
		t.Fatal(err)
	}
	res, minted := doJSON(t, w.srv, "POST", "/api/v1/documents/"+page+"/office/frame-token", w.outsiderTok, nil)
	if res.StatusCode != 201 {
		t.Fatalf("member mint = %d %v", res.StatusCode, minted)
	}
	memberToken := minted["token"].(string)
	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+page, memberToken, nil)
	assets := opened["assets"].(map[string]any)
	if len(assets) != 2 {
		t.Fatalf("member assets = %v", assets)
	}
	openURL, trashedURL := assets["open.png"].(string), assets["trashed.png"].(string)
	for _, u := range []string{openURL, trashedURL} {
		if res, _ := doBytes(t, w.srv, "GET", u, ""); res.StatusCode != 200 {
			t.Fatalf("GET %s = %d", u, res.StatusCode)
		}
	}

	// The sibling goes to the trash after signing: bytes and resolve refuse it.
	if _, err := w.q.ArchiveDocumentBatch(ctx, db.ArchiveDocumentBatchParams{
		ArchivedBy: pgtype.Text{String: w.userID, Valid: true}, PurgeAfter: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
		ArchiveBatchID: pgtype.Text{String: "iso-batch", Valid: true}, OrganizationID: w.orgID, WorkspaceID: w.wsID, Ids: []string{trashed},
	}); err != nil {
		t.Fatal(err)
	}
	if res, _ := doBytes(t, w.srv, "GET", trashedURL, ""); res.StatusCode != 404 {
		t.Fatalf("trashed sibling by its old URL = %d, want 404", res.StatusCode)
	}
	if status, order, _ := w.resolvePaths(t, page, memberToken, []string{"open.png", "trashed.png"}); status != 200 || len(order) != 1 || order[0] != "open.png" {
		t.Fatalf("resolve after trash = %d %v, want only open.png", status, order)
	}

	// A file of another workspace of the organization cannot be reached by name
	// (the walk stays in the workspace) nor by a signature naming it.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Other WS", "slug": "other-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create second workspace: %d %v", res.StatusCode, out)
	}
	otherWS := out["workspace"].(map[string]any)["id"].(string)
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+otherWS+"/documents/files", w.token, nil, "elsewhere.png", docsPNG, nil)
	if res.StatusCode != 201 {
		t.Fatalf("create elsewhere.png: %d %s", res.StatusCode, raw)
	}
	elsewhere := string(raw[strings.Index(string(raw), `"id":"`)+len(`"id":"`):])
	elsewhere = elsewhere[:strings.Index(elsewhere, `"`)]
	if status, order, _ := w.resolvePaths(t, page, memberToken, []string{"elsewhere.png"}); status != 200 || len(order) != 0 {
		t.Fatalf("resolve of another workspace's file = %d %v", status, order)
	}
	forged, err := frames.SignLinked(service.OfficeFrameClaims{Version: 1, DocumentID: page, WorkspaceID: w.wsID, OrganizationID: w.orgID,
		UserID: w.userID, Module: service.OfficeFrameModuleMarkdown}, elsewhere)
	if err != nil {
		t.Fatal(err)
	}
	if res, _ := doBytes(t, w.srv, "GET", forged.URL, ""); res.StatusCode != 404 {
		t.Fatalf("signature naming another workspace's file = %d, want 404", res.StatusCode)
	}

	// Access revoked after signing: the member leaves the workspace.
	if err := w.q.DeleteWorkspaceMember(ctx, db.DeleteWorkspaceMemberParams{WorkspaceID: w.wsID, UserID: w.outsider}); err != nil {
		t.Fatal(err)
	}
	if res, _ := doBytes(t, w.srv, "GET", openURL, ""); res.StatusCode != 404 && res.StatusCode != 403 {
		t.Fatalf("URL of a member who left = %d, want 403/404", res.StatusCode)
	}
	if status, _, _ := w.resolvePaths(t, page, memberToken, []string{"open.png"}); status != 404 && status != 403 {
		t.Fatalf("resolve by a member who left = %d, want 403/404", status)
	}

	// The owner's URL is refused once expired.
	_, order, urls := w.resolvePaths(t, page, w.mintFrameToken(t, page)["token"].(string), []string{"open.png"})
	if len(order) != 1 {
		t.Fatalf("owner resolve = %v", order)
	}
	if res, _ := doBytes(t, w.srv, "HEAD", urls["open.png"], ""); res.StatusCode != 200 {
		t.Fatalf("owner HEAD = %d", res.StatusCode)
	}
	clock.advance(service.OfficeFrameAssetURLTTL + time.Second)
	if res, _ := doBytes(t, w.srv, "HEAD", urls["open.png"], ""); res.StatusCode != 401 {
		t.Fatalf("expired URL = %d, want 401", res.StatusCode)
	}
}

// `..` climbs only through live ancestors the user may view: a trashed folder
// ends the walk, so its other children are not reachable through it (RA-5).
func TestOfficeFrameWalkStopsAtATrashedAncestor(t *testing.T) {
	w := newOfficeWorld(t, true)
	folder := w.createFolder(t, "", "Drafts")
	w.createFileIn(t, "", "top.png", docsPNG)
	page := w.createFileIn(t, folder, "index.md", []byte("![t](../top.png)\n"))
	token := w.mintFrameToken(t, page)["token"].(string)

	if status, order, _ := w.resolvePaths(t, page, token, []string{"../top.png"}); status != 200 || len(order) != 1 {
		t.Fatalf("resolve through a live folder = %d %v", status, order)
	}
	if _, err := w.q.ArchiveDocumentBatch(context.Background(), db.ArchiveDocumentBatchParams{
		ArchivedBy: pgtype.Text{String: w.userID, Valid: true}, PurgeAfter: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
		ArchiveBatchID: pgtype.Text{String: "iso-folder", Valid: true}, OrganizationID: w.orgID, WorkspaceID: w.wsID, Ids: []string{folder},
	}); err != nil {
		t.Fatal(err)
	}
	if status, order, _ := w.resolvePaths(t, page, token, []string{"../top.png"}); status != 200 || len(order) != 0 {
		t.Fatalf("resolve through a trashed folder = %d %v, want nothing", status, order)
	}
}

// One open runs the Documents ACL on a bounded number of documents however
// many files its references name (RA-3): the rest stay unresolved, the open
// still answers.
func TestOfficeFrameOpenBoundsTheACLChecks(t *testing.T) {
	w := newOfficeWorld(t, true)
	var page strings.Builder
	total := service.OfficeFrameMaxACLChecks + 20
	for i := 0; i < total; i++ {
		name := "p" + strconv.Itoa(i) + ".png"
		w.createFileIn(t, "", name, docsPNG)
		page.WriteString("![](" + name + ")\n")
	}
	id := w.createFileIn(t, "", "many.md", []byte(page.String()))
	token := w.mintFrameToken(t, id)["token"].(string)
	res, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+id, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("open = %d", res.StatusCode)
	}
	if n := len(opened["assets"].(map[string]any)); n != service.OfficeFrameMaxACLChecks {
		t.Fatalf("resolved %d of %d references, want the first %d", n, total, service.OfficeFrameMaxACLChecks)
	}
}
