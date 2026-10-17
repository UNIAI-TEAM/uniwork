package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1869 (SRC-02b): a source file opens view-only in the existing Office web
// frame. R1 mints an ofs1. token under the session routes, R2/R3 serve the
// open answer and the bytes under /api/v1/office-frame/sources/*; a source
// token opens nothing else, and nothing else opens a source route.

var srcDocxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// sourceFrameWorld is the documents-home handler stack (sourceEscapeWorld)
// with the flag set the way these tests need: documents on globally.
func sourceFrameWorld(t *testing.T) (*httptest.Server, *db.Queries) {
	t.Helper()
	return sourceFrameWorldWith(t, nil)
}

// sourceFrameWorldWith builds that stack itself, with a hook to replace
// services before the server starts (the tests that need a spent frame TTL).
// It must build the dependencies once: newTestDeps holds the test database's
// advisory lock for the life of the test, so a second call in one test
// deadlocks.
func sourceFrameWorldWith(t *testing.T, tweak func(*Deps)) (*httptest.Server, *db.Queries) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	fake := filesfake.New(filesfake.Options{})
	d.Chat.SetFiles(fake)
	d.Tasks.SetFiles(fake)
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(fake)
	if d.FeatureFlags != nil {
		docs.SetFlags(d.FeatureFlags)
	}
	d.Documents = docs
	if tweak != nil {
		tweak(&d)
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	setDocumentsOverride(t, featureflags.ScopeGlobal, "", true)
	return srv, q
}

// sourceFrameFixture seeds a chat file message carrying a DOCX (module docs)
// and answers the sourceFileID the wire uses: chat:<message id>.
func sourceFrameFixture(t *testing.T, srv *httptest.Server, f *chatFixture, tag string) string {
	t.Helper()
	res, out := uploadChatFile(
		t, srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach-"+tag+".docx", srcDocxMime, "src-frame-"+tag, frameDocx(t, "src-"+tag),
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload chat docx: %d %v", res.StatusCode, out)
	}
	messageID, _ := out["message"].(map[string]any)["id"].(string)
	if messageID == "" {
		t.Fatalf("chat file message = %v", out)
	}
	var fileID string
	if err := testPool.QueryRow(context.Background(),
		`SELECT file_id::text FROM chat_messages WHERE id = $1`, messageID).Scan(&fileID); err != nil {
		t.Fatalf("chat file row: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `INSERT INTO files
		(id, organization_id, storage, object_key, original_filename, content_type, size_bytes, status, ready_at)
		VALUES ($1, $2, 'local', $3, $4, $5, $6, 'ready', now())`,
		fileID, f.orgID, "chat/"+fileID, "ke-hoach-"+tag+".docx", srcDocxMime, int64(len(frameDocx(t, "src-"+tag)))); err != nil {
		t.Fatalf("files catalog row: %v", err)
	}
	return "chat:" + messageID
}

// sourceFrameMint is R1 for a member; it fails the test on anything but 201.
func sourceFrameMint(t *testing.T, srv *httptest.Server, wsID, sourceID, token string) map[string]any {
	t.Helper()
	res, out := doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+wsID+"/documents/sources/"+sourceID+"/office/frame-token", token, nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("mint = %d %v", res.StatusCode, out)
	}
	return out
}

// TestOfficeFrameSourceMintAndOpen is the happy path: a member mints, the open
// answer is the view-only frame metadata (readonly, can_edit false, parent,
// file, download_url), and the content route streams the source bytes.
func TestOfficeFrameSourceMintAndOpen(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-open")
	sourceID := sourceFrameFixture(t, srv, f, "a")
	member := f.tokens["b"]

	minted := sourceFrameMint(t, srv, f.wsID, sourceID, member)
	if minted["token_type"] != "Bearer" || minted["readonly"] != true || minted["can_edit"] != false {
		t.Fatalf("mint answer = %v", minted)
	}
	if minted["source_id"] != sourceID || minted["module"] != "docs" {
		t.Fatalf("mint answer = %v", minted)
	}
	token := minted["token"].(string)
	if !strings.HasPrefix(token, "ofs1.") {
		t.Fatalf("token = %q", token)
	}

	frame := "/api/v1/office-frame/sources/" + sourceID
	res, opened := doJSON(t, srv, "GET", frame, token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("open = %d %v", res.StatusCode, opened)
	}
	if opened["readonly"] != true || opened["can_edit"] != false || opened["principal"] != "source" {
		t.Fatalf("open answer = %v", opened)
	}
	if opened["source_id"] != sourceID || opened["document_id"] != nil {
		t.Fatalf("open answer = %v", opened)
	}
	parent, _ := opened["parent"].(map[string]any)
	if parent["kind"] != "chat_dm" || parent["id"] != f.dmRoomID {
		t.Fatalf("parent = %v", parent)
	}
	file, _ := opened["file"].(map[string]any)
	if file["filename"] != "ke-hoach-a.docx" || file["mime_type"] != srcDocxMime || file["version"].(float64) != 1 {
		t.Fatalf("file = %v", file)
	}
	if _, leaked := file["file_id"]; leaked {
		t.Fatalf("file block leaks file_id: %v", file)
	}
	downloadURL, _ := opened["download_url"].(string)
	if !strings.HasPrefix(downloadURL, "/api/v1/office-frame/sources/") || !strings.HasSuffix(downloadURL, "/content") {
		t.Fatalf("download_url = %q", downloadURL)
	}

	res, body := doBytes(t, srv, "GET", frame+"/content", token)
	if res.StatusCode != http.StatusOK || len(body) == 0 {
		t.Fatalf("content = %d (%d bytes)", res.StatusCode, len(body))
	}
	if got := res.Header.Get("Content-Type"); got != srcDocxMime {
		t.Fatalf("content-type = %q", got)
	}
	if got := res.Header.Get("Content-Security-Policy"); got != "sandbox; default-src 'none'" {
		t.Fatalf("csp = %q", got)
	}
	if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("nosniff = %q", got)
	}
	// HEAD runs the lookup only and, for a chat/task/meeting source, promises
	// the stored length (which is the decoded one). The email case, where
	// size_bytes is the IMAP encoded length, is left without Content-Length.
	res, head := doBytes(t, srv, "HEAD", frame+"/content", token)
	if res.StatusCode != http.StatusOK || len(head) != 0 {
		t.Fatalf("HEAD content = %d (%d bytes)", res.StatusCode, len(head))
	}
	if got, want := res.Header.Get("Content-Length"), strconv.Itoa(len(body)); got != want {
		t.Fatalf("HEAD content-length = %q, want %q", got, want)
	}
}

// TestOfficeFrameSourceEmailHeadPromisesNoLength pins the email half of the
// content route's HEAD contract: the attachment's size_bytes is the IMAP
// ENCODED length, so a HEAD must not promise it as Content-Length (the GET
// streams the decoded bytes and measures them), and a HEAD runs the lookup
// only — it never opens the mailbox. The mailbox here points at
// imap.example.com, which the netguarded production dialer cannot reach, so a
// HEAD that fetched the part would answer an error instead of 200.
//
// The GET half (exact decoded bytes, Content-Length == decoded length) is not
// pinned here: the IMAP dialer and trust root are unexported test seams of
// package imapclient, and no seam outside that package can serve a part to
// the handler stack without a production change.
func TestOfficeFrameSourceEmailHeadPromisesNoLength(t *testing.T) {
	srv, q := sourceFrameWorldWith(t, func(d *Deps) {
		d.EmailHub = service.NewEmailHubService(db.New(testPool), d.Workspaces, testEmailHubSecretBox(t))
	})
	f := setupChatFixtureOn(t, srv, "srcf-email")
	ctx := context.Background()
	acc, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: f.ids["a"], OrganizationID: f.orgID, EmailAddress: "mailbox-srcf@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password", PasswordEnc: "x",
	})
	if err != nil {
		t.Fatalf("email account: %v", err)
	}
	th, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: f.orgID, Folder: "INBOX", ImapUid: 1,
		Subject: "Mail", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
		SentAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, HasAttachments: true,
		ImapLabels: []string{}, ConversationKey: "conv-" + acc.ID,
	})
	if err != nil {
		t.Fatalf("email thread: %v", err)
	}
	// 7777 is the encoded size IMAP lists; the decoded part would be shorter.
	const encodedSize = 7777
	att, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: th.ID, AccountID: acc.ID, OrganizationID: f.orgID,
		Filename: "hop-dong.docx", MimeType: srcDocxMime, SizeBytes: encodedSize, PartID: "2",
	})
	if err != nil {
		t.Fatalf("email attachment: %v", err)
	}
	sourceID := "email:" + att.ID
	minted := sourceFrameMint(t, srv, f.wsID, sourceID, f.tokens["a"])
	if minted["module"] != "docs" || minted["parent_kind"] != "email_thread" {
		t.Fatalf("mint answer = %v", minted)
	}
	token := minted["token"].(string)

	res, head := doBytes(t, srv, "HEAD", "/api/v1/office-frame/sources/"+sourceID+"/content", token)
	if res.StatusCode != http.StatusOK || len(head) != 0 {
		t.Fatalf("email HEAD content = %d (%d bytes), want 200 without opening the mailbox", res.StatusCode, len(head))
	}
	if got := res.Header.Get("Content-Length"); got != "" {
		t.Fatalf("email HEAD content-length = %q, want none (size_bytes %d is the encoded length)", got, encodedSize)
	}
	if got := res.Header.Get("Content-Type"); got != srcDocxMime {
		t.Fatalf("email HEAD content-type = %q", got)
	}
}

// TestOfficeFrameSourceEscapedIDs: the colon of a sourceFileID travels as %3A
// on every one of R1-R3 — the same unescape the download route runs.
func TestOfficeFrameSourceEscapedIDs(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-esc")
	sourceID := sourceFrameFixture(t, srv, f, "b")
	member := f.tokens["a"]
	escaped := strings.Replace(sourceID, ":", "%3A", 1)

	res, out := doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/documents/sources/"+escaped+"/office/frame-token", member, nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("R1 escaped mint = %d %v", res.StatusCode, out)
	}
	token := out["token"].(string)
	for _, path := range []string{
		"/api/v1/office-frame/sources/" + escaped,
		"/api/v1/office-frame/sources/" + escaped + "/content",
	} {
		if res, body := doJSON(t, srv, "GET", path, token, nil); res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s (escaped) = %d %s", path, res.StatusCode, body)
		}
	}
	// A bad escape answers like an unknown id — 404, never a parse error. A
	// live net/http server rejects a bad escape before routing, so this drives
	// the handler's own context, exactly as the download route's case does.
	h := &handlers{Deps: Deps{OfficeFrame: service.NewOfficeFrameService(&service.DocumentService{}, "frame-escape-secret-0123456789")}}
	r := httptest.NewRequest(http.MethodPost, "/x", nil)
	r.URL = &url.URL{Path: "chat%zz", RawPath: "chat%zz"}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("sourceFileID", "chat%zz")
	rctx.URLParams.Add("workspaceID", f.wsID)
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.mintSourceOfficeFrameToken(rec, r)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bad-escape mint = %d %s, want 404", rec.Code, rec.Body.String())
	}
}

// TestOfficeFrameSourceMintRefusals: the mint gate is the source gate — a
// non-member learns nothing (404), an out-of-room member gets the same, and
// the module flag off answers 403 feature_disabled.
func TestOfficeFrameSourceMintRefusals(t *testing.T) {
	srv, q := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-mint")
	sourceID := sourceFrameFixture(t, srv, f, "c")
	path := "/api/v1/workspaces/" + f.wsID + "/documents/sources/" + sourceID + "/office/frame-token"

	// The DM is A and B: C is a workspace member the room gate refuses.
	res, out := doJSON(t, srv, "POST", path, f.tokens["c"], nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("out-of-room member mint = %d %v, want 404", res.StatusCode, out)
	}
	// An outsider (no workspace row) gets the same.
	outsider, _ := filesRegister(t, srv, "srcf-outsider@example.com")
	res, out = doJSON(t, srv, "POST", path, outsider, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider mint = %d %v, want 404", res.StatusCode, out)
	}
	// An unknown id and an anonymous caller.
	res, out = doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/documents/sources/chat%3A01J8MISSING/office/frame-token", f.tokens["a"], nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown source mint = %d %v, want 404", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", path, "", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous mint = %d, want 401", res.StatusCode)
	}

	// The module flag answers before anything else about the file: off is
	// 403 feature_disabled, exactly like the document mint.
	setOfficeFrameFlagFor(t, q, "office_docs_web", f.orgID, false)
	res, out = doJSON(t, srv, "POST", path, f.tokens["a"], nil)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusForbidden || code != "feature_disabled" {
		t.Fatalf("flag-off mint = %d %v, want 403 feature_disabled", res.StatusCode, out)
	}
	setOfficeFrameFlagFor(t, q, "office_docs_web", f.orgID, true)
}

// TestOfficeFrameSourceTokenCannotWriteDocuments pins the structural
// read-only guarantee: an ofs1. token is not an oft1. token, so every
// /api/v1/office-frame/documents/* route — saves included — refuses it with
// 401 before a handler runs. The route set is walked from the mux, so a route
// registered later is covered the day it appears. The other direction holds
// too: a document token opens none of the source routes.
func TestOfficeFrameSourceTokenCannotWriteDocuments(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-x")
	sourceID := sourceFrameFixture(t, srv, f, "d")
	srcToken := sourceFrameMint(t, srv, f.wsID, sourceID, f.tokens["a"])["token"].(string)

	const docID = "01J8X4DOC0N1P2Q3R4S5T6U7"
	var documentRoutes []string
	err := chi.Walk(srv.Config.Handler.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		route = strings.TrimSuffix(route, "/")
		if strings.HasPrefix(route, "/api/v1/office-frame/documents/") {
			documentRoutes = append(documentRoutes, method+" "+route)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(documentRoutes) < 15 {
		t.Fatalf("walked only %d documents frame routes: %v", len(documentRoutes), documentRoutes)
	}
	t.Logf("source token refused on %d documents frame routes: %v", len(documentRoutes), documentRoutes)
	for _, key := range documentRoutes {
		method, route, _ := strings.Cut(key, " ")
		path := strings.NewReplacer(
			"{documentID}", docID,
			"{assetID}", "01J8X4AST0N1P2Q3R4S5T6U7V8",
			"{linkedDocumentID}", "01J8X4DOC1N1P2Q3R4S5T6U7",
			"{aiProvider}", "openai",
		).Replace(route)
		res, out := doJSON(t, srv, method, path, srcToken, nil)
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("source token %s = %d %v, want 401", key, res.StatusCode, out)
		}
	}

	// The reverse: a document frame token — signed by the same secret, so the
	// refusal is the principal, not the signature — opens no source route.
	res, raw := doMultipart(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/documents/files", f.tokens["a"],
		map[string]string{"visibility": "workspace"}, "frame.docx", frameDocx(t, "x"), nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create docx: %d %s", res.StatusCode, raw)
	}
	var created struct {
		Document struct {
			ID string `json:"id"`
		} `json:"document"`
	}
	_ = json.Unmarshal(raw, &created)
	res, minted := doJSON(t, srv, "POST", "/api/v1/documents/"+created.Document.ID+"/office/frame-token", f.tokens["a"], nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("document mint = %d %v", res.StatusCode, minted)
	}
	docToken := minted["token"].(string)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/office-frame/sources/" + sourceID},
		{"GET", "/api/v1/office-frame/sources/" + sourceID + "/content"},
		{"HEAD", "/api/v1/office-frame/sources/" + sourceID + "/content"},
	} {
		res, out := doJSON(t, srv, tc.method, tc.path, docToken, nil)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("document token %s %s = %d %v, want 401", tc.method, tc.path, res.StatusCode, out)
		}
	}
	// Session tokens and ?sig= games open nothing either.
	for _, tc := range []struct{ name, path, token string }{
		{"session on open", "/api/v1/office-frame/sources/" + sourceID, f.tokens["a"]},
		{"session on content", "/api/v1/office-frame/sources/" + sourceID + "/content", f.tokens["a"]},
		{"sig on open", "/api/v1/office-frame/sources/" + sourceID + "?sig=ofa1.abc", ""},
		{"sig on content", "/api/v1/office-frame/sources/" + sourceID + "/content?sig=ofa1.abc", ""},
		{"no credential", "/api/v1/office-frame/sources/" + sourceID, ""},
	} {
		res, out := doJSON(t, srv, "GET", tc.path, tc.token, nil)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s = %d %v, want 401", tc.name, res.StatusCode, out)
		}
	}
	// A source token naming another source id is a 404, like a document token
	// on another document.
	other := sourceFrameFixture(t, srv, f, "e")
	res, out := doJSON(t, srv, "GET", "/api/v1/office-frame/sources/"+other, srcToken, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("token for another source = %d %v, want 404", res.StatusCode, out)
	}
}

// TestOfficeFrameSourceTokenCannotTouchTheEditLock: the document edit lock
// (UNI-1645) lives on the session routes, /api/v1/documents/{id}/edit-lock*,
// not under /office-frame/documents/, so the walk above never reaches it. A
// source has no lock; its ofs1. token is no session and every lock route
// refuses it with 401.
func TestOfficeFrameSourceTokenCannotTouchTheEditLock(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-l")
	sourceID := sourceFrameFixture(t, srv, f, "l")
	srcToken := sourceFrameMint(t, srv, f.wsID, sourceID, f.tokens["a"])["token"].(string)

	var lockRoutes []string
	err := chi.Walk(srv.Config.Handler.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.Contains(route, "/edit-lock") {
			lockRoutes = append(lockRoutes, method+" "+strings.TrimSuffix(route, "/"))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(lockRoutes) < 5 {
		t.Fatalf("walked only %d edit-lock routes: %v", len(lockRoutes), lockRoutes)
	}
	for _, key := range lockRoutes {
		method, route, _ := strings.Cut(key, " ")
		path := strings.NewReplacer("{documentID}", "01J8X4DOC0N1P2Q3R4S5T6U7", "{lockID}", "01J8X4LCK0N1P2Q3R4S5T6U7").Replace(route)
		res, out := doJSON(t, srv, method, path, srcToken, map[string]any{})
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("source token %s = %d %v, want 401", key, res.StatusCode, out)
		}
	}
}

// TestOfficeFrameSourceModuleFlagGatesTheFrame: with the module flag off the
// mint answers 403 feature_disabled and a token minted while it was on stops
// at the frame routes with 404 feature_disabled — the document frame's rules.
func TestOfficeFrameSourceModuleFlagGatesTheFrame(t *testing.T) {
	srv, q := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-flag")
	sourceID := sourceFrameFixture(t, srv, f, "f")
	token := sourceFrameMint(t, srv, f.wsID, sourceID, f.tokens["a"])["token"].(string)

	setOfficeFrameFlagFor(t, q, "office_docs_web", f.orgID, false)
	for _, path := range []string{
		"/api/v1/office-frame/sources/" + sourceID,
		"/api/v1/office-frame/sources/" + sourceID + "/content",
	} {
		res, out := doJSON(t, srv, "GET", path, token, nil)
		if code, _ := errCodeClass(out); res.StatusCode != http.StatusNotFound || code != "feature_disabled" {
			t.Fatalf("GET %s flag-off = %d %v, want 404 feature_disabled", path, res.StatusCode, out)
		}
	}
	res, out := doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/documents/sources/"+sourceID+"/office/frame-token", f.tokens["a"], nil)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusForbidden || code != "feature_disabled" {
		t.Fatalf("re-mint flag-off = %d %v, want 403 feature_disabled", res.StatusCode, out)
	}
	setOfficeFrameFlagFor(t, q, "office_docs_web", f.orgID, true)
}

// TestOfficeFrameSourceTokenExpiry: an expired source token is a 401 like any
// invalid frame credential; the lifetime is the document token's 10 minutes
// (the clock jumps a whole TTL ahead here, so the test does not sleep).
func TestOfficeFrameSourceTokenExpiry(t *testing.T) {
	var frame *service.OfficeFrameService
	srv, _ := sourceFrameWorldWith(t, func(d *Deps) {
		frame = service.NewOfficeFrameService(d.Documents, d.Cfg.JWTSecret)
		d.OfficeFrame = frame
	})
	f := setupChatFixtureOn(t, srv, "srcf-exp")
	sourceID := sourceFrameFixture(t, srv, f, "g")
	res, out := doJSON(t, srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/documents/sources/"+sourceID+"/office/frame-token", f.tokens["a"], nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("mint = %d %v", res.StatusCode, out)
	}
	token := out["token"].(string)
	if expiresIn, _ := out["expires_in"].(float64); expiresIn <= 0 {
		t.Fatalf("expires_in = %v, want the live token", out["expires_in"])
	}
	frame.SetClock(func() time.Time { return time.Now().Add(2 * service.OfficeFrameTokenTTL) })
	res, out = doJSON(t, srv, "GET", "/api/v1/office-frame/sources/"+sourceID, token, nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token open = %d %v, want 401", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/office-frame/sources/"+sourceID+"/content", token, nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token content = %d %v, want 401", res.StatusCode, out)
	}
}

// TestOfficeFrameSourceNeedsTheDocumentsFlag: the source frame routes sit
// behind `documents` like every other frame route; switching it off after the
// mint stops the next read with 404 feature_disabled.
func TestOfficeFrameSourceNeedsTheDocumentsFlag(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-docsflag")
	sourceID := sourceFrameFixture(t, srv, f, "h")
	token := sourceFrameMint(t, srv, f.wsID, sourceID, f.tokens["a"])["token"].(string)

	setDocumentsOverride(t, featureflags.ScopeGlobal, "", false)
	defer setDocumentsOverride(t, featureflags.ScopeGlobal, "", true)
	for _, path := range []string{
		"/api/v1/office-frame/sources/" + sourceID,
		"/api/v1/office-frame/sources/" + sourceID + "/content",
	} {
		res, out := doJSON(t, srv, "GET", path, token, nil)
		if code, _ := errCodeClass(out); res.StatusCode != http.StatusNotFound || code != "feature_disabled" {
			t.Fatalf("documents off GET %s = %d %v, want 404 feature_disabled", path, res.StatusCode, out)
		}
	}
}

// TestOfficeFrameSourceNeedsSources is the unwired path: a server without
// DocumentSources answers 501 on the mint, like the other source routes.
func TestOfficeFrameSourceNeedsSources(t *testing.T) {
	h := &handlers{Deps: Deps{}}
	r := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	h.mintSourceOfficeFrameToken(rec, r)
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("unwired mint = %d %s, want 501", rec.Code, rec.Body.String())
	}
}
