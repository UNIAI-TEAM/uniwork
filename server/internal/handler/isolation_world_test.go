package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The isolation world is the fixture of the two-organization matrix (ADR 0008
// §5): the whole API wired the way cmd/server wires it, and two tenants built
// by the same code, so every id the matrix substitutes into a route is a real
// row that a member of its own organization can open.

// isoTenant is one organization with one of everything a route can name.
type isoTenant struct {
	tag string
	// marker is planted in every name, title and body this tenant writes; a
	// response to the other tenant that contains it has leaked.
	marker string

	token, userID, email string
	// peer is a plain member of the organization and the workspace: routes
	// that act on another person (members, people, chat blocks) target them.
	peerToken, peerID, peerEmail string
	// third is one more member: a chat group needs two besides its creator.
	thirdToken, thirdID, thirdEmail string

	orgID, orgSlug, wsID, wsSlug string

	// ids maps a resource key (see isoParam) to the row the routes use.
	ids map[string]string
}

// get returns the row for key, or reports the gap and returns "" so the
// caller skips the route and the run lists every gap at once.
func (tn *isoTenant) get(t *testing.T, key string) string {
	t.Helper()
	v, ok := tn.ids[key]
	if !ok || v == "" {
		t.Errorf("isolation fixture %s has no %q", tn.tag, key)
	}
	return v
}

type isoWorld struct {
	srv   *httptest.Server
	pool  *pgxpool.Pool
	q     *db.Queries
	deps  Deps
	files *service.FileService
	box   *secretbox.Box
	alpha *isoTenant
	bravo *isoTenant
	// digestSQL and refSQL are built once from the schema; see tenantDigest
	// and referencesTo.
	digestSQL, refSQL string
	// frameTokens maps a tenant owner's session token to the Office Docs
	// frame token minted for their DOCX (buildOfficeFrame). do() sends it in
	// its place on /api/v1/office-frame/*, the only credential those routes
	// take, so every pass attacks them as the same caller.
	frameTokens map[string]string
	// frameMarkdown is the same for the tenant's Markdown document: session
	// token -> {document id, its frame token}. do() prefers it on that
	// document's own routes (resolve, linked), which a DOCX token cannot open.
	frameMarkdown map[string][2]string
	// frameSources maps a tenant owner's session token to the source frame
	// token (ofs1.) minted for their DOCX task attachment (buildOfficeFrame).
	// do() sends it on /api/v1/office-frame/sources/*, the only credential
	// those routes take, so every pass attacks them as the same caller.
	frameSources map[string]string
	// uniworkProvider is the fake provider behind the UniWork AI gateway, kept
	// so a test can read the messages the model was sent (the transcript rule:
	// what reaches the vendor is what the server stored) and decide the
	// answer; uniworkStore is the real conversation store over the test
	// database, and uniworkBox seals its turns.
	uniworkProvider *provider.Fake
	uniworkStore    *ai.ConversationStorePG
	uniworkBox      *secretbox.Box
	// deviceTokens maps a tenant owner's session token to an access token
	// of their desktop device session (buildOffice). do() sends it in its
	// place on the offline lease routes, which refuse a browser session, so
	// every pass reaches the document check as the same caller.
	deviceTokens map[string]string
}

// newIsolationServer wires every service the production binary wires
// (cmd/server/main.go): FileService behind chat, tasks, meetings, documents
// and audit; Documents and Office; Email Hub and connected calendars with a
// credential box; the AI gateway on the fake provider. A route whose service
// is left nil answers 501 for everyone, which would pass the matrix without
// proving anything.
func newIsolationServer(t *testing.T) *isoWorld {
	t.Helper()
	// One upload directory for the legacy store and FileService, as in
	// cmd/server: the /uploads/* route must not become a way around the
	// FileService access check.
	uploadDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", uploadDir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	t.Setenv("AI_PROVIDER", "fake")
	// The Office cloud tools on their fake vendors, so the owner's control
	// call succeeds and an outsider's refusal proves something.
	t.Setenv("AI_CLOUD_SEARCH_PROVIDER", "fake")
	t.Setenv("AI_CLOUD_IMAGE_PROVIDER", "fake")
	t.Setenv("AI_CLOUD_TRANSCRIBE_PROVIDER", "fake")
	// Uploaded meeting recordings (UNI-2001) on the fake vendor: the
	// transcription routes then serve their owner. No worker runs here.
	t.Setenv("AI_MEETING_TRANSCRIBE_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	// The Office desktop bridge: the download profile and the desktop client
	// the launch and device routes check against.
	d.Cfg.APIPublicURL = "https://api.example.test"
	d.Cfg.OfficeInstallerStableURL = "https://downloads.example.test/office.exe"
	d.Cfg.DesktopAuthClientID = isoOfficeClient
	d.Cfg.DesktopAuthDeploymentIDs = []string{isoOfficeDeployment}
	// The change-cursor check replays a snapshot cursor opened while seeding, after the whole
	// route sweep; the sweep outlasts the 15-minute dev snapshot lifetime, so give it room.
	d.Cfg.OfficeChangeSnapshotTTL = 2 * time.Hour
	q := db.New(pool)
	ctx := context.Background()

	stores, err := storage.BuildStores(ctx,
		storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: uploadDir}}, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatal(err)
	}
	fs, err := service.NewFileService(service.FileServiceOptions{
		Pool: pool, Store: stores[storage.BackendLocal], SpoolDir: t.TempDir(),
		ReferenceProviders: service.FileReferenceProviders(d.Chat, d.Meetings),
		Quota:              service.NewEntitlementService(pool, q),
	})
	if err != nil {
		t.Fatal(err)
	}
	d.Tasks.SetFiles(fs)
	d.Auth.SetFiles(fs)
	d.People.SetFiles(fs)
	d.Workspaces.SetFiles(fs)
	d.OrgMembers.SetFiles(fs)
	d.Actors.SetFiles(fs)
	d.Chat.SetFiles(fs)
	d.Chat.SetVoiceRecordingFiles(fs)
	d.Meetings.SetFiles(fs)
	d.Audit.SetFileService(fs)
	d.Privacy.SetFileService(fs)
	access, err := service.NewFileAccessService(service.FileAccessOptions{
		Files: fs, Workspaces: d.Workspaces, Secret: []byte("isolation-matrix-secret-isolation"),
	})
	if err != nil {
		t.Fatal(err)
	}
	d.FileAccess = access

	renderer := mail.Renderer{AppURL: "http://localhost:3000"}
	d.OrgMembers.SetMail(renderer, discardOutbox{})
	d.Auth.SetMail(renderer, discardOutbox{})

	d.Meetings.Tasks = d.Tasks
	// The flag service: every catalogue flag, meeting_dial_in included, is
	// switched on below as a global override, so the owner's control on the
	// dial-in routes is a real read and rotation, not dial_in_unavailable.
	d.Meetings.SetFlags(d.FeatureFlags)
	d.Meetings.Chat = d.Chat
	d.Tasks.Chat = d.Chat
	d.Chat.SetAIGateway(d.Meetings.AI)

	// Documents and Office run on a real FileService over the multipart test
	// store: the large-upload sessions (BIGUP-S1) cannot open on the fake, the
	// local adapter has neither multipart parts nor presigned URLs, and the
	// Office job service reads and stages the same rows, so it takes the same
	// service. The stub engine never fetches the URLs it is handed.
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docFS, _ := newMultipartDocuments(t, pool, q, docs, d.Chat, d.Meetings, stores[storage.BackendLocal])
	// The edit lock (UNI-1645 §6 step 1.4): a 1h TTL so a long run never lets
	// the seeded tenures lapse and a write-control heartbeat never pulls one
	// back to 2 minutes. No DocumentEditLockSweeper runs here, as no
	// dispatcher does.
	docs.SetEditLockConfig(service.DocumentEditLockConfig{TTL: time.Hour})
	docs.SetAccessRequestSources(d.Tasks, d.Meetings)
	d.Documents = docs
	d.Meetings.Docs = docs
	d.Meetings.SetUploads(docs)
	// As main.go wires it: the inbox names a document only through the read gate.
	d.Notifications.SetDocumentReaders(docs)
	// The chat document send files its bytes into the same Documents service
	// (UNI-1966): without it the route answers 501 and the isolation row
	// proves nothing.
	d.Chat.SetDocuments(docs)
	d.DesktopAuth = service.NewDesktopAuthService(pool, q, d.Minter, d.Cfg)
	d.McpAuth = service.NewMcpAuthService(pool, q, d.Organizations, d.Cfg)
	d.McpAuth.SetFlags(mcpTestFlags(true))
	d.McpTools = service.NewMcpToolService(q, d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin)
	d.McpTools.SetDocuments(docs)
	d.McpTools.SetFlags(mcpTestFlags(true))
	preview, err := service.NewPreviewAssetService(service.PreviewAssetServiceOptions{
		Documents: docs, Origin: isoPreviewOrigin, Secret: "isolation-matrix-preview-secret-0123456789",
		TTL: 5 * time.Minute, MaxBytes: 1 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	d.Preview = preview
	// The run outlives a 10-minute frame token, as it does an access token.
	d.OfficeFrame = service.NewOfficeFrameService(docs, d.Cfg.JWTSecret)
	d.OfficeFrame.SetTTL(time.Hour)
	d.Office = service.NewDocumentOfficeService(service.DocumentOfficeOptions{
		Pool: pool, Queries: q, Files: docFS, Engine: newHandlerStubEngine(t), Documents: docs,
		// The stub engine never finishes a blank document; a short deadline
		// keeps that refusal from costing the run a minute.
		MaxDeadline: 3 * time.Second,
	})

	box := testEmailHubSecretBox(t)
	d.EmailHub = service.NewEmailHubService(q, d.Workspaces, box)
	d.EmailHub.AI = d.Meetings.AI
	d.EmailHub.Tasks = d.Tasks
	d.AskUNI.SetEmailHub(d.EmailHub)
	d.DriveConnections = service.NewDriveConnectionService(pool, q, d.Workspaces, box)
	d.DriveConnections.SetProvider(service.NewFakeDriveProvider(config.Config{FrontendOrigin: "http://localhost:3000"}))
	d.DriveConnections.SetFlags(d.FeatureFlags)
	d.DriveConnections.SetPickerConfig("iso-picker-key", "1234567890")
	driveFakeAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/export") || r.URL.Query().Get("alt") == "media" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("Document body for task proposals"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		extID := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
		mime := "application/vnd.google-apps.document"
		if strings.HasPrefix(extID, "iso-folder-") {
			mime = "application/vnd.google-apps.folder"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           extID,
			"name":         "Drive File " + extID,
			"mimeType":     mime,
			"webViewLink":  "https://docs.google.com/document/d/" + extID + "/edit",
			"shared":       true,
			"trashed":      false,
			"modifiedTime": "2026-10-26T10:00:00Z",
			"owners":       []map[string]any{{"displayName": "Drive Owner"}},
			"permissions":  []map[string]any{{"id": "p1"}, {"id": "p2"}},
		})
	}))
	t.Cleanup(driveFakeAPI.Close)
	driveAPIClient := service.NewDriveAPIClientForTest(driveFakeAPI.URL+"/drive/v3", driveFakeAPI.Client().Transport)
	d.DriveFiles = service.NewDriveFileService(pool, q, d.Workspaces, d.DriveConnections, driveAPIClient)
	d.DriveFiles.SetFlags(d.FeatureFlags)
	d.Tasks.SetDriveFiles(d.DriveFiles)
	d.Audit.SetDriveFiles(d.DriveFiles)
	driveContentSvc := service.NewDriveContentService(pool, q, d.Workspaces, d.DriveFiles, d.DriveConnections, driveAPIClient, nil)
	d.AskUNI.SetDriveContentReader(driveContentSvc)
	d.DriveTaskProposals = service.NewDriveTaskProposalService(pool, q, d.Workspaces, d.DriveFiles, d.DriveConnections, driveContentSvc, d.Meetings.AI)
	d.DriveTaskProposals.SetFlags(d.FeatureFlags)
	d.Audit.SetDriveProposalHistoryAuthorizer(d.DriveTaskProposals.AuthorizeHistory)
	d.DriveTaskProposals.SetTasks(d.Tasks)
	d.DriveFiles.SetTaskCreationsLoader(d.DriveFiles)
	d.DriveTaskProposals.SetTaskCreationsLoader(d.DriveFiles)
	// Ask UNI files (UNI-2119): the upload route is offered only where the turn
	// runs the agent, so Ask UNI gets the file store, the flags (the loop below
	// turns every one on) and the read tools, as main.go wires them. The asks
	// below then take the agent path, as they do in production with the flag on.
	d.AskUNI.SetFiles(fs)
	d.AskUNI.SetFlags(d.FeatureFlags)
	d.AskUNI.SetReadTools(d.McpTools)
	d.AiMemory = service.NewAiMemoryService(pool, q, d.Organizations, d.Workspaces)
	d.AiMemory.SetFlags(d.FeatureFlags)
	d.AiMemory.SetImport(d.Meetings.AI, d.Redis)
	d.AskUNI.SetMemory(d.AiMemory)
	d.CalendarConnections = service.NewCalendarConnectionService(pool, q, d.Workspaces, box, config.Config{
		FrontendOrigin: "http://localhost:3000",
	})

	d.Hub.SetAuthorizer(realtime.ScopeAuthorizers{
		realtime.ScopeChat:    realtime.NewChatScopeAuthorizer(d.Chat),
		realtime.ScopeMeeting: realtime.NewMeetingScopeAuthorizer(d.Meetings),
	})
	d.Hub.SetOrganizationResolver(d.Workspaces.OrganizationOf)

	// Every flag on: a route behind an off flag answers feature_disabled to
	// both tenants and the matrix would learn nothing from it.
	for _, f := range featureflags.Catalogue() {
		if _, err := q.UpsertFlagOverride(ctx, db.UpsertFlagOverrideParams{
			ID: util.NewID(), FlagKey: f.Key, ScopeType: featureflags.ScopeGlobal,
			Enabled: true, Note: "isolation matrix", CreatedBy: "test",
		}); err != nil {
			t.Fatalf("enable flag %s: %v", f.Key, err)
		}
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}

	// Voice-call tokens are signed locally; any key pair lets the route run.
	d.Cfg.LiveKitURL, d.Cfg.LiveKitAPIKey, d.Cfg.LiveKitAPISecret = "ws://livekit.invalid", "isolation", "isolation-matrix-livekit-secret-0123456789"

	// The UniWork AI façade (G6-03a): its own gateway over a fake provider this
	// file keeps, so a test can read the messages the model was sent, and the
	// real conversation store (A9) over the test database — the transcript
	// lives on the server, and the isolation digest must see it there.
	t.Setenv(ai.ConversationKeyEnv, isoUniworkConversationKey)
	uniworkKey, err := secretbox.LoadKey(ai.ConversationKeyEnv)
	if err != nil {
		t.Fatal(err)
	}
	uniworkBox, err := secretbox.New(uniworkKey)
	if err != nil {
		t.Fatal(err)
	}
	uniworkProvider := &provider.Fake{}
	uniworkStore := ai.NewConversationStore(pool, q, uniworkBox)
	d.AIUniwork = service.NewAIUniworkService(d.Organizations, service.NewEntitlementService(pool, q), docs,
		d.FeatureFlags, service.NewAIGateway(pool, q, uniworkProvider, ai.Options{}), uniworkStore, d.Redis)
	// The run counters behind the façade, wired exactly as main.go wires them
	// (G6-03b, A3/A12): without it the world answers every turn with no run
	// header, so the wire contract and the foreign-run refusal are never
	// exercised over the real router (BE3B-5).
	d.AIUniwork.SetRunStore(ai.NewRunStore(q))

	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return &isoWorld{
		srv: srv, pool: pool, q: q, deps: d, files: fs, box: box,
		uniworkProvider: uniworkProvider, uniworkStore: uniworkStore, uniworkBox: uniworkBox,
	}
}

// isoBody is what a matrix request sends: JSON, a multipart file part, or
// nothing at all.
type isoBody struct {
	json      any
	multipart *isoMultipart
	headers   map[string]string
	// raw is sent as is under a JSON content type, for a body that is not valid
	// JSON or is too large to build from a value.
	raw []byte
	// noBody sends a write with a zero-length body and no Content-Type, the way
	// the desktop's lease client grants (the default injects "{}" instead).
	noBody bool
}

type isoMultipart struct {
	fields      map[string]string
	filename    string
	contentType string
	content     []byte
}

// do sends one request without following redirects: a 302 to a signed object
// URL is as much a disclosure as a 200 with the bytes.
func (w *isoWorld) do(t *testing.T, method, path, token string, body isoBody) (int, []byte) {
	t.Helper()
	var rd io.Reader
	contentType := ""
	switch {
	case body.multipart != nil:
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		for k, v := range body.multipart.fields {
			_ = mw.WriteField(k, v)
		}
		ct := body.multipart.contentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		part, err := mw.CreatePart(map[string][]string{
			"Content-Disposition": {`form-data; name="file"; filename="` + body.multipart.filename + `"`},
			"Content-Type":        {ct},
		})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(body.multipart.content)
		_ = mw.Close()
		rd, contentType = &buf, mw.FormDataContentType()
	case body.noBody:
		rd = http.NoBody
	case body.raw != nil:
		rd, contentType = bytes.NewReader(body.raw), "application/json"
	case body.json != nil:
		raw, err := json.Marshal(body.json)
		if err != nil {
			t.Fatal(err)
		}
		rd, contentType = bytes.NewReader(raw), "application/json"
	default:
		rd = http.NoBody
		if method != http.MethodGet && method != http.MethodHead && method != http.MethodDelete {
			rd, contentType = strings.NewReader("{}"), "application/json"
		}
	}
	req, err := http.NewRequest(method, w.srv.URL+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	// The owner's edit lock routes run on the desktop session the seeded
	// tenure names, so R6 (a live device session) serves the owner too
	// (UNI-1645 §6 step 2); the edit requests keep the web token.
	if device, ok := w.deviceTokens[token]; ok && (strings.Contains(path, "/office/offline-lease") || strings.Contains(path, "/edit-lock")) {
		token = device
	}
	if src, ok := w.frameSources[token]; ok && strings.HasPrefix(path, "/api/v1/office-frame/sources/") {
		// The source routes take the source token and nothing else: a
		// document token, and the session, are refused there.
		token = src
	}
	if frame, ok := w.frameTokens[token]; ok && strings.HasPrefix(path, "/api/v1/office-frame/") {
		if md, ok := w.frameMarkdown[token]; ok && strings.HasPrefix(path, "/api/v1/office-frame/documents/"+md[0]) {
			frame = md[1]
		}
		token = frame
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range body.headers {
		req.Header.Set(k, v)
	}
	client := w.srv.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw
}

// call is do for the fixture builder: JSON in, decoded JSON out, and the
// status must be one of want.
func (w *isoWorld) call(t *testing.T, method, path, token string, body any, want ...int) map[string]any {
	t.Helper()
	status, raw := w.do(t, method, path, token, isoBody{json: body})
	return isoExpect(t, method, path, status, raw, want...)
}

func (w *isoWorld) upload(t *testing.T, path, token string, mp isoMultipart, want ...int) map[string]any {
	t.Helper()
	status, raw := w.do(t, http.MethodPost, path, token, isoBody{multipart: &mp, headers: map[string]string{"Idempotency-Key": util.NewID()}})
	return isoExpect(t, http.MethodPost, path, status, raw, want...)
}

func isoExpect(t *testing.T, method, path string, status int, raw []byte, want ...int) map[string]any {
	t.Helper()
	if len(want) == 0 {
		want = []int{http.StatusOK, http.StatusCreated}
	}
	ok := false
	for _, s := range want {
		ok = ok || s == status
	}
	if !ok {
		t.Fatalf("fixture %s %s = %d, want %v: %s", method, path, status, want, raw)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

// isoID digs the id of the created row out of a response: under the first of
// keys that holds an object with an "id", else at the top level.
func isoID(t *testing.T, out map[string]any, keys ...string) string {
	t.Helper()
	for _, k := range keys {
		if m, ok := out[k].(map[string]any); ok {
			if id, ok := m["id"].(string); ok && id != "" {
				return id
			}
		}
	}
	if id, ok := out["id"].(string); ok && id != "" {
		return id
	}
	t.Fatalf("no id under %v in %v", keys, out)
	return ""
}

func isoString(t *testing.T, out map[string]any, path ...string) string {
	t.Helper()
	var cur any = out
	for _, p := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("no %v in %v", path, out)
		}
		cur = m[p]
	}
	s, ok := cur.(string)
	if !ok || s == "" {
		t.Fatalf("no string at %v in %v", path, out)
	}
	return s
}

func isoList(t *testing.T, out map[string]any, key string) []map[string]any {
	t.Helper()
	raw, ok := out[key].([]any)
	if !ok {
		t.Fatalf("no list %q in %v", key, out)
	}
	var rows []map[string]any
	for _, r := range raw {
		if m, ok := r.(map[string]any); ok {
			rows = append(rows, m)
		}
	}
	return rows
}

func (w *isoWorld) register(t *testing.T, email, name string) (token, id string) {
	t.Helper()
	out := w.call(t, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": name,
	}, http.StatusOK)
	token = out["access_token"].(string)
	verifyEmail(t, w.srv, token)
	return token, out["user"].(map[string]any)["id"].(string)
}

// buildTenant creates one organization through the public API, so the same
// path a customer takes is the one the matrix attacks. Rows no route can
// create (provider callbacks, recordings, mailboxes) are seeded in SQL.
func (w *isoWorld) buildTenant(t *testing.T, tag string) *isoTenant {
	t.Helper()
	marker := "ISO" + strings.ToUpper(tag)
	tn := &isoTenant{tag: tag, marker: marker, ids: map[string]string{}}
	lower := strings.ToLower(marker)
	tn.email = lower + "-owner@example.com"
	tn.peerEmail = lower + "-peer@example.com"
	tn.token, tn.userID = w.register(t, tn.email, marker+" Owner")
	tn.peerToken, tn.peerID = w.register(t, tn.peerEmail, marker+" Peer")
	tn.thirdEmail = lower + "-third@example.com"
	tn.thirdToken, tn.thirdID = w.register(t, tn.thirdEmail, marker+" Third")

	tn.orgSlug, tn.wsSlug = lower+"-org", lower+"-ws"
	out := w.call(t, "POST", "/api/v1/orgs", tn.token, map[string]string{"name": marker + " Org", "slug": tn.orgSlug}, http.StatusCreated)
	tn.orgID = isoID(t, out, "organization")
	out = w.call(t, "POST", "/api/v1/orgs/"+tn.orgID+"/workspaces", tn.token, map[string]string{"name": marker + " WS", "slug": tn.wsSlug}, http.StatusCreated)
	tn.wsID = isoID(t, out, "workspace")
	w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/invitations", tn.token, map[string]any{
		"emails": []string{tn.peerEmail, tn.thirdEmail}, "role": "member",
	}, http.StatusOK)
	for _, tok := range []string{tn.peerToken, tn.thirdToken} {
		out = w.call(t, "GET", "/api/v1/me/invitations", tok, nil, http.StatusOK)
		for _, inv := range isoList(t, out, "invitations") {
			w.call(t, "POST", "/api/v1/invitations/"+inv["token"].(string)+"/accept", tok, nil, http.StatusOK)
		}
	}

	tn.ids["owner"], tn.ids["peer"], tn.ids["third"] = tn.userID, tn.peerID, tn.thirdID
	out = w.call(t, "GET", "/api/v1/me/sessions", tn.token, nil, http.StatusOK)
	for _, sess := range isoList(t, out, "sessions") {
		tn.ids["session"] = sess["id"].(string)
	}
	tn.ids["org"], tn.ids["ws"] = tn.orgID, tn.wsID

	w.buildTasks(t, tn)
	w.buildMeetings(t, tn)
	w.buildChat(t, tn)
	w.buildDocuments(t, tn)
	w.buildOrganization(t, tn)
	w.buildOffice(t, tn)
	w.buildMcp(t, tn)
	w.buildOfficeFrame(t, tn)
	w.buildSeeded(t, tn)
	w.buildEditLocks(t, tn)
	w.buildActivity(t, tn)
	w.buildWorkspaceAliases(t, tn)
	// The isolation world runs no outbox dispatcher; project the tenant's graph
	// the way an operator would, so every graph table holds a row of A's.
	if _, err := projector.RebuildOrg(context.Background(), w.pool, w.q, tn.orgID, projector.RebuildOptions{}); err != nil {
		t.Fatalf("graph rebuild: %v", err)
	}

	// The run outlives the one-minute access tokens newTestDeps mints, so
	// every person gets an hour-long one.
	long := auth.TokenMinter{Secret: []byte("test"), TTL: time.Hour}
	for _, p := range []struct {
		token *string
		id    string
	}{{&tn.token, tn.userID}, {&tn.peerToken, tn.peerID}, {&tn.thirdToken, tn.thirdID}} {
		tok, err := long.MintWebSession(p.id, "")
		if err != nil {
			t.Fatal(err)
		}
		*p.token = tok
	}
	// The frame token stays; it is now sent in place of the new session.
	w.frameTokens[tn.token] = tn.ids["frameToken"]
	w.frameMarkdown[tn.token] = [2]string{tn.ids["frameMarkdown"], tn.ids["frameMarkdownToken"]}
	if tn.ids["sourceFrameToken"] != "" {
		if w.frameSources == nil {
			w.frameSources = map[string]string{}
		}
		w.frameSources[tn.token] = tn.ids["sourceFrameToken"]
	}
	device, err := long.MintSession(tn.userID, tn.ids["deviceSession"])
	if err != nil {
		t.Fatal(err)
	}
	if w.deviceTokens == nil {
		w.deviceTokens = map[string]string{}
	}
	w.deviceTokens[tn.token] = device
	// The large-upload sessions come last: they need the frame token of the
	// tenant's markdown document, registered just above (BIGUP-S1).
	w.buildUploadSessions(t, tn)
	return tn
}

func (w *isoWorld) buildTasks(t *testing.T, tn *isoTenant) {
	t.Helper()
	ws := "/api/v1/workspaces/" + tn.wsID
	m := tn.marker
	out := w.call(t, "POST", ws+"/projects", tn.token, map[string]any{"title": m + " Project", "status": "planned", "priority": "none"})
	tn.ids["project"] = isoID(t, out, "project")
	out = w.call(t, "POST", ws+"/task-labels", tn.token, map[string]any{"name": m + " Label", "color": "#ef4444"})
	tn.ids["label"] = isoID(t, out, "label")
	out = w.call(t, "POST", ws+"/task-properties", tn.token, map[string]any{"name": m + " Points", "type": "text"})
	tn.ids["property"] = isoID(t, out, "property")
	out = w.call(t, "POST", ws+"/task-statuses", tn.token, map[string]any{"name": m + " Waiting", "category": "in_review", "color": "#22c55e"})
	tn.ids["status"] = isoID(t, out, "status")
	out = w.call(t, "POST", ws+"/task-views", tn.token, map[string]any{
		"name": m + " View", "scope_type": "workspace", "visibility": "workspace", "definition_version": 1,
		"query": map[string]any{}, "display": map[string]any{},
	})
	tn.ids["view"] = isoID(t, out, "view")

	out = w.call(t, "POST", ws+"/tasks", tn.token, map[string]any{
		"title": m + " Task", "description": m + " secret description", "project_id": tn.ids["project"],
		"assignee_id": tn.peerID,
	})
	tn.ids["task"] = isoID(t, out, "task")
	out = w.call(t, "POST", ws+"/tasks", tn.token, map[string]any{"title": m + " Second Task"})
	tn.ids["task2"] = isoID(t, out, "task")
	w.call(t, "POST", "/api/v1/tasks/"+tn.ids["task"]+"/dependencies", tn.token, map[string]any{"depends_on_task_id": tn.ids["task2"]})
	w.call(t, "POST", "/api/v1/tasks/"+tn.ids["task"]+"/labels", tn.token, map[string]any{"label_id": tn.ids["label"]})
	out = w.call(t, "POST", "/api/v1/tasks/"+tn.ids["task"]+"/comments", tn.token, map[string]any{"body": m + " task comment"})
	tn.ids["taskComment"] = isoID(t, out, "comment")
	out = w.upload(t, "/api/v1/tasks/"+tn.ids["task"]+"/attachments", tn.token, isoMultipart{
		filename: strings.ToLower(m) + ".png", contentType: "image/png", content: docsPNG,
	})
	tn.ids["attachment"] = isoID(t, out, "attachment")
	w.call(t, "POST", ws+"/pins", tn.token, map[string]any{"item_type": "task", "item_id": tn.ids["task"]})
	out = w.call(t, "POST", ws+"/projects/"+tn.ids["project"]+"/resources", tn.token, map[string]any{
		"resource_type": "github_repo", "resource_ref": map[string]any{"url": "https://github.com/acme/" + strings.ToLower(m)}, "label": m + " Resource",
	})
	tn.ids["projectResource"] = isoID(t, out, "resource")
	// Trashed rows: restore and purge only answer for a row in the trash, so
	// an attack on them must meet one. Each route ends its row (restore leaves
	// the trash, purge leaves the database), so each gets its own.
	for key, kind := range map[string]string{"trashedTask": "Restore", "purgeTask": "Purge"} {
		out = w.call(t, "POST", ws+"/tasks", tn.token, map[string]any{"title": m + " Trashed Task " + kind})
		tn.ids[key] = isoID(t, out, "task")
		w.call(t, "DELETE", "/api/v1/tasks/"+tn.ids[key], tn.token, nil)
	}
	for key, kind := range map[string]string{"trashedProject": "Restore", "purgeProject": "Purge"} {
		out = w.call(t, "POST", ws+"/projects", tn.token, map[string]any{"title": m + " Trashed Project " + kind})
		tn.ids[key] = isoID(t, out, "project")
		w.call(t, "DELETE", ws+"/projects/"+tn.ids[key], tn.token, nil)
	}
}

func (w *isoWorld) buildMeetings(t *testing.T, tn *isoTenant) {
	t.Helper()
	m := tn.marker
	start := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Minute)
	out := w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/meetings", tn.token, map[string]any{
		"title": m + " Meeting", "description": m + " agenda", "timezone": "Asia/Ho_Chi_Minh",
		"starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339),
		"attendee_user_ids": []string{tn.peerID},
	})
	tn.ids["meeting"] = isoID(t, out, "meeting")
	mp := "/api/v1/meetings/" + tn.ids["meeting"]
	out = w.call(t, "GET", mp+"/participants", tn.token, nil)
	for _, p := range isoList(t, out, "participants") {
		if p["user_id"] == tn.peerID {
			tn.ids["participant"] = p["id"].(string)
		}
	}
	out = w.call(t, "GET", mp+"/invitations", tn.token, nil)
	for _, inv := range isoList(t, out, "invitations") {
		tn.ids["meetingInvitation"] = inv["id"].(string)
	}
	out = w.call(t, "POST", mp+"/invite-links", tn.token, map[string]any{
		"name": m + " Link", "access_mode": "AUTO_ADMIT", "expires_at": start.Add(48 * time.Hour).Format(time.RFC3339),
	})
	tn.ids["inviteLink"] = isoID(t, out, "invite_link", "link")
	tn.ids["inviteSecret"] = isoString(t, out, "invite_link", "secret")
	out = w.call(t, "POST", mp+"/motions", tn.token, map[string]any{
		"title": m + " Motion", "ballot_mode": "PUBLIC", "threshold": "MAJORITY", "base": "PRESENT",
	})
	tn.ids["motion"] = isoID(t, out, "motion")
	out = w.call(t, "POST", mp+"/notes", tn.token, map[string]any{"body": m + " meeting note"})
	tn.ids["meetingNote"] = isoID(t, out, "note")
	// A started meeting: attendance, motions and publishing only act on one.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/meetings/instant", tn.token, map[string]any{"title": m + " Live"})
	tn.ids["liveMeeting"] = isoID(t, out, "meeting")
	if out["meeting"].(map[string]any)["status"] != "IN_PROGRESS" {
		w.call(t, "POST", "/api/v1/meetings/"+tn.ids["liveMeeting"]+"/start", tn.token, nil)
	}
	// The third member is not invited, so they knock and wait in the lobby.
	out = w.call(t, "POST", mp+"/join-requests", tn.thirdToken, map[string]any{})
	tn.ids["joinRequest"] = isoID(t, out, "join_request", "request")
}

func (w *isoWorld) buildChat(t *testing.T, tn *isoTenant) {
	t.Helper()
	ws := "/api/v1/workspaces/" + tn.wsID
	m := tn.marker
	out := w.call(t, "POST", ws+"/chat/groups", tn.token, map[string]any{"name": m + " Group", "member_user_ids": []string{tn.peerID, tn.thirdID}})
	tn.ids["room"] = isoID(t, out, "room")
	out = w.call(t, "POST", ws+"/chat/channels", tn.token, map[string]any{"name": strings.ToLower(m) + "-channel", "visibility": "public", "topic": m + " topic"})
	tn.ids["channel"] = isoID(t, out, "room", "channel")
	// Thread↔task sync is for public rooms only (H12). Its own channel, so the
	// write pass archiving tn.ids["channel"] leaves the synced thread alone.
	out = w.call(t, "POST", ws+"/chat/channels", tn.token, map[string]any{"name": strings.ToLower(m) + "-sync", "visibility": "public"})
	syncChannel := isoID(t, out, "room", "channel")
	out = w.call(t, "POST", ws+"/chat/rooms/"+syncChannel+"/messages", tn.token, map[string]any{"body": m + " channel message", "client_msg_id": util.NewID()})
	tn.ids["channelMessage"] = isoID(t, out, "message")
	rp := ws + "/chat/rooms/" + tn.ids["room"]
	out = w.call(t, "POST", rp+"/messages", tn.token, map[string]any{"body": m + " chat message", "client_msg_id": util.NewID()})
	tn.ids["message"] = isoID(t, out, "message")
	// The peer's reply is what a member reports (a report of one's own message is refused).
	out = w.call(t, "POST", rp+"/threads/"+tn.ids["message"]+"/messages", tn.peerToken, map[string]any{"body": m + " thread reply", "client_msg_id": util.NewID()})
	tn.ids["peerMessage"] = isoID(t, out, "message")
	out = w.call(t, "POST", rp+"/messages", tn.token, map[string]any{
		"client_msg_id": util.NewID(), "poll": map[string]any{
			"question": m + " poll", "options": []string{"Canteen", "Outside"},
			"settings": map[string]any{"allow_add_options": true},
		},
	})
	tn.ids["pollMessage"] = isoID(t, out, "message")
	tn.ids["pollOption"] = isoString(t, out["message"].(map[string]any)["poll"].(map[string]any)["options"].([]any)[0].(map[string]any), "id")
	w.call(t, "POST", rp+"/messages", tn.token, map[string]any{
		"client_msg_id": util.NewID(), "reminder": map[string]any{"body": m + " reminder", "remind_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "repeat": "weekly"},
	})
	out = w.upload(t, rp+"/messages/file", tn.token, isoMultipart{
		fields: map[string]string{"client_msg_id": util.NewID()}, filename: strings.ToLower(m) + ".pdf", contentType: "application/pdf", content: tinyPDF,
	})
	tn.ids["fileMessage"] = isoID(t, out, "message")
	out = w.upload(t, rp+"/messages/voice", tn.token, isoMultipart{
		fields: map[string]string{"client_msg_id": util.NewID(), "duration_ms": "4000"}, filename: "voice.webm", contentType: "audio/webm", content: tinyWebM,
	})
	tn.ids["voiceMessage"] = isoID(t, out, "message")
	// Its transcript (UNI-1908 F2), on the fake transcriber the world runs.
	w.call(t, "POST", ws+"/chat/messages/"+tn.ids["voiceMessage"]+"/transcript", tn.token, nil)
	out = w.call(t, "POST", ws+"/chat/messages/"+tn.ids["message"]+"/follow-ups", tn.token, map[string]any{"note": m + " follow up"})
	tn.ids["followUp"] = isoID(t, out, "follow_up")
	out = w.call(t, "POST", ws+"/chat/messages/"+tn.ids["message"]+"/links", tn.token, map[string]any{"target_type": "task", "target_id": tn.ids["task"]})
	tn.ids["chatLink"] = isoID(t, out, "link")
}

func (w *isoWorld) buildDocuments(t *testing.T, tn *isoTenant) {
	t.Helper()
	m := tn.marker
	out := w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Page", "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": m + " page body"}}}}},
	})
	tn.ids["document"] = isoID(t, out, "document")
	// The folder kind (E6 FD-02): a live folder a create or a move can name as
	// a parent, and one sitting in the trash for the restore route, whose name
	// the restore has to place back among its live siblings.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Folder", "kind": "folder",
	})
	tn.ids["folder"] = isoID(t, out, "document")
	// UNI-2055 (ADR 0037): that folder sits outside every My Folder, so it is a
	// workspace folder every member of the tenant reads; a page inside it keeps
	// its own access (restricted), and the other tenant still gets a refusal.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Folder page", "kind": "page", "parent_id": tn.ids["folder"],
	})
	tn.ids["folderChild"] = isoID(t, out, "document")
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Trash folder", "kind": "folder",
	})
	tn.ids["archivedFolder"] = isoID(t, out, "document")
	w.call(t, "POST", "/api/v1/documents/"+tn.ids["archivedFolder"]+"/archive", tn.token, nil)
	// ARCHIVE-01 (UNI-1845): dedicated pages for the shelve pair - shelving
	// "document" would read-lock it under every later control, so shelve gets
	// its own live page and unshelve one already shelved.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Shelve page", "kind": "page",
	})
	tn.ids["shelveDocument"] = isoID(t, out, "document")
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Shelved page", "kind": "page",
	})
	tn.ids["unshelveDocument"] = isoID(t, out, "document")
	w.call(t, "POST", "/api/v1/documents/"+tn.ids["unshelveDocument"]+"/shelve", tn.token, nil)
	// UNI-2012 D5: the chat link send gets its own page. Sending "document" at
	// comment into the room raises the peer's seeded view share there (D2a: the
	// manual row ends, a chat row remembering it takes over), so the revoke
	// control later in the pass would name an ended share and see 404.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Chat link page", "kind": "page",
	})
	tn.ids["chatLinkDocument"] = isoID(t, out, "document")
	dp := "/api/v1/documents/" + tn.ids["document"]
	out = w.call(t, "POST", dp+"/comments", tn.token, map[string]any{"body": m + " doc comment", "type": "comment"})
	tn.ids["docComment"] = isoID(t, out, "comment")
	out = w.call(t, "POST", dp+"/shares", tn.token, map[string]any{"principal_type": "user", "principal_id": tn.peerID, "level": "view"})
	tn.ids["share"] = isoID(t, out, "share")
	// DOC-05 (UNI-1628): a restricted page whose ACL owner is the tenant's peer,
	// so the tenant's owner (an implicit workspace admin) holds AdminScope on it
	// and can open, and end, emergency access; one live grant of theirs is
	// seeded by SQL because the API only grants to the caller.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Restricted", "kind": "page",
		"content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": m + " restricted body"}}}}},
	})
	tn.ids["restrictedDocument"] = isoID(t, out, "document")
	if _, err := w.pool.Exec(context.Background(),
		`UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`, tn.ids["restrictedDocument"], tn.peerID); err != nil {
		t.Fatal(err)
	}
	grantID := util.NewID()
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO document_break_glass_grants (
		id, organization_id, workspace_id, document_id, actor_id, actor_kind, level, reason, expires_at
	) VALUES ($1, $2, $3, $4, $5, 'human', 'view', $6, now() + interval '1 hour')`,
		grantID, tn.orgID, tn.wsID, tn.ids["restrictedDocument"], tn.userID, m+" break-glass reason for the audit"); err != nil {
		t.Fatal(err)
	}
	tn.ids["breakGlassGrant"] = grantID
	// DOC-06b (UNI-2092): one unrestricted page the tenant's peer owns, for the
	// bulk transfer control only (POST /orgs/{org}/members/{userID}/document-
	// ownership names the peer as the source and the owner as the recipient):
	// without it the peer's one document is the restricted one above, which the
	// owner skips as self_restricted, and the control would move nothing. No
	// other route names it; it is a workspace-visible page the owner already
	// reads, so no list or count of the owner's changes shape.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{
		"title": m + " Peer-owned page", "kind": "page", "visibility": "workspace",
	})
	tn.ids["peerOwnedDocument"] = isoID(t, out, "document")
	if _, err := w.pool.Exec(context.Background(),
		`UPDATE documents SET acl_owner_id = $2 WHERE id = $1`, tn.ids["peerOwnedDocument"], tn.peerID); err != nil {
		t.Fatal(err)
	}
	w.call(t, "PUT", "/api/v1/orgs/"+tn.orgID+"/documents/settings", tn.token, map[string]any{"public_links_enabled": true})
	w.call(t, "PUT", "/api/v1/orgs/"+tn.orgID+"/meetings/settings", tn.token, map[string]any{"auto_summary_enabled": false})
	out = w.call(t, "POST", dp+"/links", tn.token, map[string]any{})
	tn.ids["docLink"] = isoID(t, out, "link")
	tn.ids["docLinkToken"] = isoString(t, out, "token")
	out = w.upload(t, dp+"/assets", tn.token, isoMultipart{filename: strings.ToLower(m) + ".png", contentType: "image/png", content: docsPNG})
	tn.ids["asset"] = isoID(t, out, "asset")
	out = w.call(t, "POST", dp+"/versions", tn.token, map[string]any{"label": m + " version"})
	tn.ids["version"] = fmt.Sprint(out["version"].(map[string]any)["version"])
	tn.ids["versionID"] = isoID(t, out, "version")
	// An anchorable file document for the anchored create reference case
	// (R1-6). The main document above stays a page: every reference case
	// parents a page or folder under it, so turning it into a file document
	// would break those controls. One docx upload whose first version is the
	// head; base_version_id binds to that version.
	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": m + " Anchor"}, filename: strings.ToLower(m) + "-anchor.docx",
		contentType: isoDocxMime, content: isoFrameDocx,
	})
	tn.ids["anchorDoc"] = isoID(t, out, "document")
	tn.ids["anchorVersionID"] = isoString(t, out, "document", "file", "version_id")

	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": m + " File"}, filename: strings.ToLower(m) + ".md", contentType: "text/markdown",
		content: []byte("# " + m + " file body\n"),
	})
	tn.ids["fileDocument"] = isoID(t, out, "document")
	// A zip download job (UNI-2045 SV-9) the tenant's owner created and nobody
	// built: the poll answers it, the download route has no file yet.
	tn.ids["downloadJob"] = util.NewID()
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO document_download_jobs
		(id, organization_id, workspace_id, created_by, created_by_kind, document_ids)
		VALUES ($1, $2, $3, $4, 'human', ARRAY[$5]::text[])`,
		tn.ids["downloadJob"], tn.orgID, tn.wsID, tn.userID, tn.ids["fileDocument"]); err != nil {
		t.Fatalf("download job: %v", err)
	}
	// A folder upload batch (UNI-2052) of the tenant's owner with one file row.
	// It is seeded settled (completed) so it does not count toward the owner's
	// two open batches, which the PLAN route's control and its isoReferences
	// control each take one of.
	tn.ids["folderUpload"] = util.NewID()
	tn.ids["folderUploadFileKey"] = "iso-file-" + tn.tag
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO document_folder_uploads
		(id, organization_id, workspace_id, created_by, created_by_kind, root_folder_id, root_title,
		 status, file_count, total_bytes, folders, expires_at, finished_at)
		VALUES ($1, $2, $3, $4, 'human', $5, $6, 'completed', 1, 3, jsonb_build_object('', $5::text),
		        now() + interval '24 hours', now())`,
		tn.ids["folderUpload"], tn.orgID, tn.wsID, tn.userID, tn.ids["folder"], m+" Upload root"); err != nil {
		t.Fatalf("folder upload: %v", err)
	}
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO document_folder_upload_files
		(id, file_key, organization_id, workspace_id, batch_id, folder_id, path, filename, size_bytes, target_kind)
		VALUES ($1, $2, $3, $4, $5, $6, '', $7, 3, 'put')`,
		util.NewID(), tn.ids["folderUploadFileKey"], tn.orgID, tn.wsID, tn.ids["folderUpload"], tn.ids["folder"], strings.ToLower(m)+"-upload.md"); err != nil {
		t.Fatalf("folder upload file: %v", err)
	}
	// A comment on the file document itself: the office launch session's
	// own-rows control must name a comment of the document its path names
	// (R1-1 binds the ticket's comment to its document).
	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["fileDocument"]+"/comments", tn.token, map[string]any{"body": m + " file doc comment", "type": "comment"})
	tn.ids["fileDocComment"] = isoID(t, out, "comment")
	status, raw := w.do(t, http.MethodPost, "/api/v1/documents/"+tn.ids["fileDocument"]+"/office/jobs", tn.token, isoBody{
		json: map[string]any{"operation": "serialize"}, headers: map[string]string{"Idempotency-Key": util.NewID()},
	})
	out = isoExpect(t, http.MethodPost, "office job", status, raw, http.StatusCreated)
	tn.ids["officeJob"] = isoString(t, out, "job_id")
	// Bytes staged for a save, not yet committed as a version.
	out = w.upload(t, "/api/v1/documents/"+tn.ids["fileDocument"]+"/uploads", tn.token, isoMultipart{
		filename: strings.ToLower(m) + "-v2.md", contentType: "text/markdown", content: []byte("# " + m + " staged body\n"),
	})
	tn.ids["docUpload"] = isoString(t, out, "upload_id")
	out = w.upload(t, "/api/v1/documents/"+tn.ids["fileDocument"]+"/uploads", tn.token, isoMultipart{
		filename: strings.ToLower(m) + "-v3.md", contentType: "text/markdown", content: []byte("# " + m + " chat commit body\n"),
	})
	tn.ids["chatCommitUpload"] = isoString(t, out, "upload_id")
	out = w.upload(t, "/api/v1/documents/"+tn.ids["fileDocument"]+"/uploads", tn.token, isoMultipart{
		filename: strings.ToLower(m) + "-copy.md", contentType: "text/markdown", content: []byte("# " + m + " copy body\n"),
	})
	tn.ids["copyUpload"] = isoString(t, out, "upload_id")
	// A commit intent (G5-07) without moving the file document: a commit on
	// a stale base claims the intent, is refused 409 and leaves it not
	// committed, so the base_revision the commit route sends stays valid.
	out = w.upload(t, "/api/v1/documents/"+tn.ids["fileDocument"]+"/uploads", tn.token, isoMultipart{
		filename: strings.ToLower(m) + "-intent.md", contentType: "text/markdown", content: []byte("# " + m + " intent body\n"),
	})
	status, raw = w.do(t, http.MethodPost, "/api/v1/documents/"+tn.ids["fileDocument"]+"/versions/commit", tn.token, isoBody{
		json:    map[string]any{"upload_id": isoString(t, out, "upload_id"), "base_revision": "999"},
		headers: map[string]string{"Idempotency-Key": "iso-intent-" + tn.tag},
	})
	isoExpect(t, http.MethodPost, "stale commit intent", status, raw, http.StatusConflict)
	// An open change-feed snapshot (G5-01a): one row per page, so the
	// snapshot tables hold A's rows and the cursor is A's to replay.
	out = w.call(t, "GET", "/api/v1/workspaces/"+tn.wsID+"/documents/changes?limit=1", tn.token, nil)
	tn.ids["changeCursor"] = isoString(t, out, "next_cursor")
}

func (w *isoWorld) buildOrganization(t *testing.T, tn *isoTenant) {
	t.Helper()
	m := tn.marker
	org := "/api/v1/orgs/" + tn.orgSlug
	out := w.call(t, "POST", org+"/departments", tn.token, map[string]any{"name": m + " Department"})
	tn.ids["department"] = isoID(t, out, "department")
	// A pending invitation to someone outside both tenants: its id for the
	// revoke route, its token for the accept route. It grants the tenant's
	// workspace, so invitation_workspaces holds a row of each tenant.
	invitee := strings.ToLower(m) + "-invitee@example.com"
	w.call(t, "POST", org+"/invitations", tn.token, map[string]any{
		"emails": []string{invitee}, "org_role": "member", "workspace_ids": []string{tn.wsID},
	})
	out = w.call(t, "GET", org+"/invitations", tn.token, nil)
	for _, inv := range isoList(t, out, "invitations") {
		tn.ids["orgInvitation"] = inv["id"].(string)
	}
	inviteeToken, _ := w.register(t, invitee, m+" Invitee")
	out = w.call(t, "GET", "/api/v1/me/invitations", inviteeToken, nil)
	for _, inv := range isoList(t, out, "invitations") {
		tn.ids["invitationToken"] = inv["token"].(string)
	}
	out = w.call(t, "POST", org+"/agents", tn.token, map[string]any{"name": m + " Agent", "handle": strings.ToLower(m) + "-bot", "description": m + " agent"})
	tn.ids["agent"] = isoID(t, out, "agent")
	out = w.call(t, "POST", "/api/v1/orgs/"+tn.orgID+"/audit/exports", tn.token, map[string]any{
		"format": "csv", "from": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), "to": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}, http.StatusOK, http.StatusCreated, http.StatusAccepted)
	tn.ids["auditExport"] = isoID(t, out, "export")
	privacyID := util.NewID()
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO data_subject_requests (
		id, organization_id, requested_by, requested_by_kind, kind, completed_at
	) VALUES ($1, $2, $3, 'human', 'export', now())`, privacyID, tn.orgID, tn.userID); err != nil {
		t.Fatal(err)
	}
	tn.ids["privacyExport"] = privacyID
	out = w.call(t, "GET", "/api/v1/orgs/"+tn.orgID+"/audit", tn.token, nil)
	if rows := isoList(t, out, "events"); len(rows) > 0 {
		tn.ids["auditEvent"] = rows[0]["id"].(string)
	}
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/ai/ask", tn.token, map[string]any{"question": m + " question"})
	tn.ids["conversation"] = isoString(t, out, "conversation_id")
	tn.ids["aiAnswer"] = out["message"].(map[string]any)["id"].(string)
	// A file the owner uploaded for their next question and has not sent: the
	// cancel route's own row, and the control that the route works at all.
	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/ai/attachments", tn.token, isoMultipart{filename: "brief.pdf", contentType: "application/pdf", content: tinyPDF})
	tn.ids["aiUpload"] = isoString(t, out, "file_id")
	// One unsent file for each question route's own-rows control, which a
	// question claims; and one a question carried, the row every tenant has in
	// ai_attachments. They are valid PDFs: a sent question reads its files.
	for _, key := range []string{"aiUploadAsk", "aiUploadStream", "aiUploadSent"} {
		out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/ai/attachments", tn.token, isoMultipart{filename: key + ".pdf", contentType: "application/pdf", content: sizedAskPDF(0)})
		tn.ids[key] = isoString(t, out, "file_id")
	}
	w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/ai/ask", tn.token, map[string]any{"question": m + " question about a file", "attachment_ids": []any{tn.ids["aiUploadSent"]}})
	// The download route's own row: the id the question lists the file under.
	var attachmentID string
	if err := w.pool.QueryRow(context.Background(), `SELECT id FROM ai_attachments WHERE organization_id = $1 AND file_id = $2`, tn.orgID, tn.ids["aiUploadSent"]).Scan(&attachmentID); err != nil {
		t.Fatalf("ai attachment row: %v", err)
	}
	tn.ids["aiAttachment"] = attachmentID
	w.call(t, "PUT", "/api/v1/ai/conversations/"+tn.ids["conversation"]+"/messages/"+tn.ids["aiAnswer"]+"/feedback", tn.token, map[string]any{"rating": "up"}, http.StatusNoContent)
}

// buildSeeded writes the rows only a provider, a worker or a mailbox would
// write. Each insert names its tenant the way the writer in production does.
func (w *isoWorld) buildSeeded(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	m := tn.marker

	// A FileService file of the tenant: the task attachment's bytes.
	var fileID string
	if err := w.pool.QueryRow(ctx, `SELECT file_id FROM attachments WHERE id = $1`, tn.ids["attachment"]).Scan(&fileID); err != nil {
		t.Fatalf("attachment file: %v", err)
	}
	tn.ids["file"] = fileID

	// A finished audit export, written by the consumer the outbox drives.
	consumer := service.NewAuditExportConsumer(w.q, w.deps.Storage)
	consumer.SetFileService(w.pool, w.files)
	payload, _ := json.Marshal(map[string]string{"export_id": tn.ids["auditExport"], "organization_id": tn.orgID})
	if err := consumer.Handle(ctx, db.OutboxEvent{
		ID: "iso-export-" + tn.ids["auditExport"], Topic: "audit.export_requested", Payload: string(payload),
	}); err != nil {
		t.Fatalf("audit export: %v", err)
	}

	// A meeting recording and a chat call recording, as the egress webhooks
	// leave them.
	tn.ids["recording"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_recordings (id, organization_id, meeting_id, egress_id, status, file_url, started_by)
		VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6)`,
		tn.ids["recording"], tn.orgID, tn.ids["meeting"], "egress-"+tn.ids["recording"], "recordings/"+strings.ToLower(m)+".mp4", tn.userID); err != nil {
		t.Fatalf("meeting recording: %v", err)
	}
	tn.ids["callID"] = util.NewID()
	vr, err := w.q.InsertChatVoiceRecording(ctx, db.InsertChatVoiceRecordingParams{
		ID: util.NewID(), OrganizationID: tn.orgID, WorkspaceID: tn.wsID, RoomID: tn.ids["room"],
		CallID: tn.ids["callID"], EgressID: "egress-" + tn.ids["callID"], StartedBy: tn.userID,
	})
	if err != nil {
		t.Fatalf("voice recording: %v", err)
	}
	tn.ids["voiceRecording"] = vr.ID

	// A mailbox with one thread, one attachment and one scheduled send.
	enc, err := w.box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	acc, err := w.q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: tn.userID, OrganizationID: tn.orgID, EmailAddress: strings.ToLower(m) + "-mailbox@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password",
		PasswordEnc: base64.StdEncoding.EncodeToString(enc),
	})
	if err != nil {
		t.Fatalf("email account: %v", err)
	}
	tn.ids["emailAccount"] = acc.ID
	th, err := w.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: tn.orgID, Folder: "INBOX", ImapUid: 1,
		Subject: m + " mail subject", Snippet: m + " mail snippet", FromAddr: "sender@example.com",
		ToAddrs: []string{acc.EmailAddress}, SentAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		HasAttachments: true, ImapLabels: []string{}, ConversationKey: "conv-" + acc.ID,
	})
	if err != nil {
		t.Fatalf("email thread: %v", err)
	}
	tn.ids["emailThread"] = th.ID
	att, err := w.q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: th.ID, AccountID: acc.ID, OrganizationID: tn.orgID,
		Filename: strings.ToLower(m) + ".txt", MimeType: "text/plain", SizeBytes: 4, PartID: "2",
	})
	if err != nil {
		t.Fatalf("email attachment: %v", err)
	}
	tn.ids["emailAttachment"] = att.ID
	sched, err := w.q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: util.NewID(), WorkspaceID: tn.wsID, AccountID: acc.ID, OrganizationID: tn.orgID, UserID: tn.userID,
		Payload: []byte(`{"to":["someone@example.com"],"subject":"` + m + ` scheduled","body_text":"x"}`),
		SendAt:  pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatalf("scheduled send: %v", err)
	}
	tn.ids["scheduledSend"] = sched.ID
	// Failed, as the worker leaves a send the SMTP server refused: the one
	// state retry acts on, and cancel still takes it.
	if _, err := w.pool.Exec(ctx, `UPDATE email_hub_scheduled_sends SET status = 'failed', last_error = 'smtp refused' WHERE id = $1`, sched.ID); err != nil {
		t.Fatalf("failed scheduled send: %v", err)
	}

	// The thread's AI summary, through the route the inbox uses.
	w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/email-hub/threads/"+th.ID+"/ai/summarize", tn.token, map[string]any{"account_id": acc.ID, "locale": "en"})

	// An inbox row for the owner, as the notification consumer writes it.
	n, err := w.q.UpsertNotification(ctx, db.UpsertNotificationParams{
		ID: util.NewID(), UserID: tn.userID, OrganizationID: tn.orgID, WorkspaceID: pgtype.Text{String: tn.wsID, Valid: true},
		Kind: "task_assigned", GroupKey: "task_assigned:" + tn.ids["task"], ResourceType: "task", ResourceID: tn.ids["task"],
		ActorKind: "human", ActorID: tn.peerID, TitleKey: "notifications.task_assigned",
		Params: `{"task_title":"` + m + ` Task"}`,
	})
	if err != nil {
		t.Fatalf("notification: %v", err)
	}
	tn.ids["notification"] = n.ID
	// One document row of that notification (UNI-2056), as the consumer
	// writes it for a document_changed notice.
	if _, err := w.q.InsertNotificationDocument(ctx, db.InsertNotificationDocumentParams{
		OrganizationID: tn.orgID, NotificationID: n.ID, DocumentID: tn.ids["document"],
	}); err != nil {
		t.Fatalf("notification document: %v", err)
	}

	// The comment orbit G8-03 added (UNI-1398): one edit-history row and one
	// mention row of the document comment. Revisions are written by the edit
	// route and mentions by G8-05; the world seeds them so both tables hold a
	// row of the tenant's and their read paths can be attacked.
	//
	// The seeded history row says revision 1's body was replaced, so the
	// comment itself must sit at revision 2: the edit path inserts the body
	// it replaces under the comment's CURRENT revision, and a comment left at
	// 1 would collide with this row on the unique (comment_id, revision) the
	// next PATCH takes (the REV 500 the write-control pass surfaces).
	if _, err := w.pool.Exec(ctx, `INSERT INTO document_comment_revisions
		(id, organization_id, workspace_id, document_id, comment_id, body, revision, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'human')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["document"], tn.ids["docComment"], m+" doc comment (cũ)", tn.userID); err != nil {
		t.Fatalf("document comment revision: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `UPDATE document_comments SET revision = 2 WHERE id = $1`, tn.ids["docComment"]); err != nil {
		t.Fatalf("document comment revision sync: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO document_comment_mentions
		(id, organization_id, workspace_id, document_id, comment_id, user_id, state, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, 'human')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["document"], tn.ids["docComment"], tn.peerID, tn.userID); err != nil {
		t.Fatalf("document comment mention: %v", err)
	}

	// A connected Google calendar.
	tokenEnc, err := w.box.Seal([]byte("token"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.q.UpsertCalendarConnection(ctx, db.UpsertCalendarConnectionParams{
		ID: util.NewID(), OrganizationID: tn.orgID, WorkspaceID: tn.wsID, UserID: tn.userID, Provider: "google",
		AccountEmail: strings.ToLower(m) + "-calendar@example.com", AccessTokenEnc: base64.StdEncoding.EncodeToString(tokenEnc), RefreshTokenEnc: base64.StdEncoding.EncodeToString(tokenEnc),
		AccessTokenExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		SelectedCalendarIds:  []byte(`[]`),
	}); err != nil {
		t.Fatalf("calendar connection: %v", err)
	}

	// A UniWork AI transcript of the tenant (G6-03a, A9): one conversation and
	// its first turn, written the way ConversationStore.Create/Append write
	// them, so both new tables hold a row of the tenant's.
	tn.ids["aiUniworkConversation"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO ai_uniwork_conversations
		(id, organization_id, user_id, document_id, module, created_by, created_by_kind, expires_at)
		VALUES ($1, $2, $3, $4, 'sheets', $3, 'human', now() + interval '30 minutes')`,
		tn.ids["aiUniworkConversation"], tn.orgID, tn.userID, tn.ids["document"]); err != nil {
		t.Fatalf("uniwork ai conversation: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO ai_uniwork_turns
		(id, organization_id, conversation_id, run_id, seq, role, ciphertext)
		VALUES ($1, $2, $3, 'iso-run', 1, 'user', $4)`,
		util.NewID(), tn.orgID, tn.ids["aiUniworkConversation"], []byte("iso-sealed")); err != nil {
		t.Fatalf("uniwork ai turn: %v", err)
	}
	// A run of the transcript (G6-03b, A3/A12): the counters one question may
	// spend, written the way RunStorePG.TakeTurn opens one, so every tenant
	// table that carries A's organization_id holds a row of A's.
	tn.ids["aiUniworkRun"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO ai_uniwork_runs
		(id, organization_id, conversation_id, model_calls, created_by, created_by_kind, expires_at)
		VALUES ($1, $2, $3, 1, $4, 'human', now() + interval '30 minutes')`,
		tn.ids["aiUniworkRun"], tn.orgID, tn.ids["aiUniworkConversation"], tn.userID); err != nil {
		t.Fatalf("uniwork ai run: %v", err)
	}
	// Two Ask UNI proposals of the tenant under its seeded answer, as the agent
	// loop's store writes them (R3): a rejected one, which every proposal route
	// reads without changing (so a route's own-rows control answers 409
	// proposal_not_pending, which proves it reached the row), and a pending one
	// for the body-id control, which applies it.
	for i, row := range []struct{ key, status string }{{"aiProposal", "rejected"}, {"aiProposalPending", "pending"}} {
		tn.ids[row.key] = util.NewID()
		if _, err := w.pool.Exec(ctx, `INSERT INTO agent_action_proposals
			(id, organization_id, workspace_id, source, run_id, conversation_id, message_id, position, action_type,
			 target_kind, payload, preview, risk_level, mode, status, expires_at, created_by, created_by_kind)
			VALUES ($1, $2, $3, 'ask_uni', $4, $5, $6, $7, 'create_task', 'task', $8, '{}', 'l1', 'ask', $9, now() + interval '24 hours', $10, 'human')`,
			tn.ids[row.key], tn.orgID, tn.wsID, util.NewID(), tn.ids["conversation"], tn.ids["aiAnswer"], i+1,
			fmt.Sprintf(`{"title":"%s proposal"}`, m), row.status, tn.userID); err != nil {
			t.Fatalf("ask uni proposal %s: %v", row.key, err)
		}
	}
	// One memory entry of the tenant owner's, and a rejected memory proposal
	// under the same answer (P4), so both memory tables hold a row of A's.
	tn.ids["aiMemory"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO ai_memories
		(id, organization_id, user_id, kind, body, source, created_by, created_by_kind)
		VALUES ($1, $2, $3, 'fact', $4, 'manual', $3, 'human')`,
		tn.ids["aiMemory"], tn.orgID, tn.userID, m+" memory entry"); err != nil {
		t.Fatalf("ask uni memory: %v", err)
	}
	tn.ids["aiMemoryProposal"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO ai_memory_proposals
		(id, organization_id, workspace_id, conversation_id, message_id, position, action, kind, body, status, expires_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, 1, 'remember', 'fact', $6, 'rejected', now() + interval '24 hours', $7, 'human')`,
		tn.ids["aiMemoryProposal"], tn.orgID, tn.wsID, tn.ids["conversation"], tn.ids["aiAnswer"], m+" memory proposal", tn.userID); err != nil {
		t.Fatalf("ask uni memory proposal: %v", err)
	}

	// A connected Google Drive account (UNI-2177, B1): seeded so drive_connections
	// holds a row of the tenant's and the isolation matrix hashes it before and after.
	tn.ids["driveConnection"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_connections
		(id, organization_id, user_id, provider, google_sub, google_email, refresh_token_enc, access_token_enc, access_expires_at, credential_version, scopes)
		VALUES ($1, $2, $3, 'google', $4, $5, $6, $6, now() + interval '1 hour', 1, 'openid email https://www.googleapis.com/auth/drive.file')`,
		tn.ids["driveConnection"], tn.orgID, tn.userID, "sub-"+strings.ToLower(m), strings.ToLower(m)+"-drive@example.com", base64.StdEncoding.EncodeToString(tokenEnc)); err != nil {
		t.Fatalf("drive connection: %v", err)
	}
	// A linked Google Drive file, the owner's read-access row, and its task link
	// (UNI-2180, B4): seeded so drive_files, drive_file_access and
	// drive_file_task_links hold rows of the tenant's.
	tn.ids["driveFile"] = util.NewID()
	extFileID := "ext-drive-" + strings.ToLower(m)
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_files
		(id, organization_id, workspace_id, external_file_id, connection_id, bound_by, created_by, created_by_kind,
		 name, mime_type, icon_kind, web_view_link, owner_display, sharing_state, metadata_refreshed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6, 'human', $7, 'application/vnd.google-apps.document', 'google_doc',
		        $8, $9, 'shared', now())`,
		tn.ids["driveFile"], tn.orgID, tn.wsID, extFileID, tn.ids["driveConnection"], tn.userID,
		m+" Drive Doc", "https://docs.google.com/document/d/"+extFileID+"/edit", m+" Owner"); err != nil {
		t.Fatalf("drive file: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_file_access
		(id, organization_id, workspace_id, drive_file_id, user_id, connection_id, state)
		VALUES ($1, $2, $3, $4, $5, $6, 'granted')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["driveFile"], tn.userID, tn.ids["driveConnection"]); err != nil {
		t.Fatalf("drive file access: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_file_task_links
		(id, organization_id, workspace_id, drive_file_id, task_id, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 'human')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["driveFile"], tn.ids["task"], tn.userID); err != nil {
		t.Fatalf("drive file task link: %v", err)
	}
	// A second connection for the owner and a peer-bound Drive file on which the
	// owner holds a granted drive_file_access row (B4b-F03): exercises PUT
	// /workspaces/{workspaceID}/drive-files/{driveFileID}/access in
	// isoReferences past the bound_by use_rebind gate and past the granted-access
	// gate, so the control (switching to driveConnection2) answers 200 and the
	// attack (naming A's driveConnection) reaches requireCallerConnection -> 404.
	tn.ids["driveConnection2"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_connections
		(id, organization_id, user_id, provider, google_sub, google_email, refresh_token_enc, access_token_enc, access_expires_at, credential_version, scopes)
		VALUES ($1, $2, $3, 'google', $4, $5, $6, $6, now() + interval '1 hour', 1, 'openid email https://www.googleapis.com/auth/drive.file')`,
		tn.ids["driveConnection2"], tn.orgID, tn.userID, "sub-2-"+strings.ToLower(m), strings.ToLower(m)+"-drive2@example.com", base64.StdEncoding.EncodeToString(tokenEnc)); err != nil {
		t.Fatalf("drive connection 2: %v", err)
	}
	tn.ids["peerDriveConnection"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_connections
		(id, organization_id, user_id, provider, google_sub, google_email, refresh_token_enc, access_token_enc, access_expires_at, credential_version, scopes)
		VALUES ($1, $2, $3, 'google', $4, $5, $6, $6, now() + interval '1 hour', 1, 'openid email https://www.googleapis.com/auth/drive.file')`,
		tn.ids["peerDriveConnection"], tn.orgID, tn.peerID, "sub-peer-"+strings.ToLower(m), strings.ToLower(m)+"-peer-drive@example.com", base64.StdEncoding.EncodeToString(tokenEnc)); err != nil {
		t.Fatalf("peer drive connection: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_file_access
		(id, organization_id, workspace_id, drive_file_id, user_id, connection_id, state)
		VALUES ($1, $2, $3, $4, $5, $6, 'granted')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["driveFile"], tn.peerID, tn.ids["peerDriveConnection"]); err != nil {
		t.Fatalf("peer access on drive file: %v", err)
	}
	tn.ids["peerBoundDriveFile"] = util.NewID()
	peerExtFileID := "ext-drive-peer-" + strings.ToLower(m)
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_files
		(id, organization_id, workspace_id, external_file_id, connection_id, bound_by, created_by, created_by_kind,
		 name, mime_type, icon_kind, web_view_link, owner_display, sharing_state, metadata_refreshed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6, 'human', $7, 'application/vnd.google-apps.document', 'google_doc',
		        $8, $9, 'shared', now())`,
		tn.ids["peerBoundDriveFile"], tn.orgID, tn.wsID, peerExtFileID, tn.ids["peerDriveConnection"], tn.peerID,
		m+" Peer Drive Doc", "https://docs.google.com/document/d/"+peerExtFileID+"/edit", m+" Peer Owner"); err != nil {
		t.Fatalf("peer bound drive file: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_file_access
		(id, organization_id, workspace_id, drive_file_id, user_id, connection_id, state)
		VALUES ($1, $2, $3, $4, $5, $6, 'granted')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["peerBoundDriveFile"], tn.userID, tn.ids["driveConnection"]); err != nil {
		t.Fatalf("owner access on peer bound drive file: %v", err)
	}
	// Seeded Drive task proposals and provenance link (UNI-2181, B5): one ready
	// proposal of the owner's, one ready proposal of the peer's in the same
	// workspace (§8.2a), and one drive_task_proposal_links row so every tenant
	// table holds a row of the tenant's.
	tn.ids["driveProposal"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_task_proposals
		(id, organization_id, workspace_id, drive_file_id, connection_id, requested_by, requested_by_kind,
		 prompt, items, truncated, usage_event_id, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8, false, 'usage-iso', 'ready', now() + interval '7 days')`,
		tn.ids["driveProposal"], tn.orgID, tn.wsID, tn.ids["driveFile"], tn.ids["driveConnection"], tn.userID,
		m+" proposal prompt", fmt.Sprintf(`[{"index":0,"title":"%s proposed task","label_ids":[],"goal":"%s goal","checklist":[],"excerpt":{"section":"Sec 1","quote":"%s quote"},"blocked_by_indexes":[]}]`, m, m, m)); err != nil {
		t.Fatalf("drive task proposal: %v", err)
	}
	for _, propKey := range []string{"driveProposalRefProject", "driveProposalRefParent", "driveProposalRefAssignee", "driveProposalRefLabel"} {
		tn.ids[propKey] = util.NewID()
		if _, err := w.pool.Exec(ctx, `INSERT INTO drive_task_proposals
			(id, organization_id, workspace_id, drive_file_id, connection_id, requested_by, requested_by_kind,
			 prompt, items, truncated, usage_event_id, status, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8, false, 'usage-iso-ref', 'ready', now() + interval '7 days')`,
			tn.ids[propKey], tn.orgID, tn.wsID, tn.ids["driveFile"], tn.ids["driveConnection"], tn.userID,
			m+" proposal prompt "+propKey, fmt.Sprintf(`[{"index":0,"title":"%s proposed task %s","label_ids":[],"goal":"%s goal","checklist":[],"excerpt":{"section":"Sec 1","quote":"%s quote"},"blocked_by_indexes":[]}]`, m, propKey, m, m)); err != nil {
			t.Fatalf("drive task proposal %s: %v", propKey, err)
		}
	}
	tn.ids["peerDriveProposal"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_task_proposals
		(id, organization_id, workspace_id, drive_file_id, connection_id, requested_by, requested_by_kind,
		 prompt, items, truncated, usage_event_id, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8, false, 'usage-iso-peer', 'ready', now() + interval '7 days')`,
		tn.ids["peerDriveProposal"], tn.orgID, tn.wsID, tn.ids["peerBoundDriveFile"], tn.ids["peerDriveConnection"], tn.peerID,
		m+" peer proposal prompt", fmt.Sprintf(`[{"index":0,"title":"%s peer proposed task","label_ids":[],"goal":"%s peer goal","checklist":[],"excerpt":{"section":"Sec 1","quote":"%s peer quote"},"blocked_by_indexes":[]}]`, m, m, m)); err != nil {
		t.Fatalf("peer drive task proposal: %v", err)
	}
	tn.ids["convertedDriveProposal"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_task_proposals
		(id, organization_id, workspace_id, drive_file_id, connection_id, requested_by, requested_by_kind,
		 prompt, items, truncated, usage_event_id, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, NULL, false, 'usage-iso-conv', 'converted', now() + interval '7 days')`,
		tn.ids["convertedDriveProposal"], tn.orgID, tn.wsID, tn.ids["driveFile"], tn.ids["driveConnection"], tn.userID,
		m+" converted proposal prompt"); err != nil {
		t.Fatalf("converted drive task proposal: %v", err)
	}
	tn.ids["driveProposalLink"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO drive_task_proposal_links
		(id, organization_id, workspace_id, proposal_id, item_index, task_id, drive_file_id, external_file_id, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, 'human')`,
		tn.ids["driveProposalLink"], tn.orgID, tn.wsID, tn.ids["convertedDriveProposal"], tn.ids["task"], tn.ids["driveFile"], extFileID, tn.userID); err != nil {
		t.Fatalf("drive task proposal link: %v", err)
	}
}

// buildWorkspaceAliases leaves an old task prefix and an old slug on record and
// the current ones unchanged, so workspace_aliases holds a row of each tenant's.
func (w *isoWorld) buildWorkspaceAliases(t *testing.T, tn *isoTenant) {
	t.Helper()
	ws := "/api/v1/workspaces/" + tn.wsID
	out := w.call(t, "GET", "/api/v1/orgs/"+tn.orgSlug+"/workspaces/"+tn.wsSlug, tn.token, nil)
	prefix, _ := out["workspace"].(map[string]any)["task_prefix"].(string)
	if prefix == "" {
		t.Fatal("workspace has no task_prefix")
	}
	w.call(t, "PATCH", ws, tn.token, map[string]string{"task_prefix": "ISO" + strings.ToUpper(tn.tag[:1]) + "OLD"})
	w.call(t, "PATCH", ws, tn.token, map[string]string{"task_prefix": prefix})
	w.call(t, "PATCH", ws, tn.token, map[string]string{"slug": tn.wsSlug + "-old"})
	w.call(t, "PATCH", ws, tn.token, map[string]string{"slug": tn.wsSlug})
}

// buildActivity leaves the traces people leave by using the product - a
// reaction, a nickname, a vote, an attendance mark - so every tenant table
// holds a row of the tenant's (TestIsolationMatrix checks it).
func (w *isoWorld) buildActivity(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	m := tn.marker
	ws := "/api/v1/workspaces/" + tn.wsID

	// A meeting held without a room (UNI-2001), its recording queued for
	// transcription through the route, and a second recording staged for the
	// reference case. The recordings are staged on FileService directly: the
	// shared upload session is the documents' one, already in this world.
	out := w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/meetings", tn.token, map[string]any{
		"title": m + " Held", "starts_at": time.Now().Add(48 * time.Hour).UTC().Truncate(time.Minute).Format(time.RFC3339),
		"ends_at": time.Now().Add(49 * time.Hour).UTC().Truncate(time.Minute).Format(time.RFC3339),
	})
	tn.ids["heldMeeting"] = isoID(t, out, "meeting")
	began := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	w.call(t, "POST", "/api/v1/meetings/"+tn.ids["heldMeeting"]+"/held", tn.token, map[string]any{
		"started_at": began.Format(time.RFC3339), "ended_at": began.Add(time.Hour).Format(time.RFC3339),
	})
	stageAudio := func(name string) string {
		up, err := w.files.Upload(ctx, files.UploadInput{
			Actor: audit.User(tn.userID), Purpose: files.MeetingAudio, IdempotencyKey: util.NewID(), Filename: name,
			Scope: files.Scope{OrganizationID: tn.orgID, WorkspaceID: tn.wsID},
			Body:  bytes.NewReader(append([]byte("ID3\x04\x00\x00\x00\x00\x00\x00"+m), 0xff, 0xfb, 0x90, 0x64)),
		})
		if err != nil {
			t.Fatalf("stage meeting audio: %v", err)
		}
		// The completed session the upload route leaves behind: it names the
		// uploader and the meeting, which a transcription request must match.
		if _, err := w.pool.Exec(ctx, `INSERT INTO file_multipart_uploads (id, organization_id, workspace_id, file_id,
			file_upload_session_id, created_by, created_by_kind, opened_via, storage_upload_id, object_key, filename, size_bytes,
			part_size, total_parts, probe_head_sha256, probe_tail_sha256, status, expires_at, closed_at, meeting_id)
			VALUES ($1, $2, $3, $4, $5, $6, 'human', 'meeting_audio', 's', 'k', 'f', 1, 1, 1, 'h', '', 'completed',
			now() + interval '1 day', now(), $7)`,
			util.NewID(), tn.orgID, tn.wsID, string(up.File.ID), util.NewID(), tn.userID, tn.ids["heldMeeting"]); err != nil {
			t.Fatalf("meeting audio session: %v", err)
		}
		return string(up.File.ID)
	}
	out = w.call(t, "POST", "/api/v1/meetings/"+tn.ids["heldMeeting"]+"/transcriptions", tn.token, map[string]any{
		"upload_id": stageAudio(strings.ToLower(m) + "-part-1.mp3"), "language": "vi", "consent": true,
	})
	tn.ids["transcription"] = isoID(t, out, "transcription")
	tn.ids["meetingAudioUpload"] = stageAudio(strings.ToLower(m) + "-part-2.mp3")

	w.call(t, "POST", "/api/v1/tasks/"+tn.ids["task"]+"/reactions", tn.token, map[string]any{"emoji": "👍"})
	w.call(t, "POST", "/api/v1/comments/"+tn.ids["taskComment"]+"/reactions", tn.token, map[string]any{"emoji": "👍"})
	w.call(t, "PUT", ws+"/task-view-preferences", tn.token, map[string]any{"scope_type": "workspace", "prefs": map[string]any{"layout": "list"}})
	w.call(t, "PUT", ws+"/home/preferences", tn.token, map[string]any{"prefs": map[string]any{"layout": "compact"}})
	w.call(t, "POST", "/api/v1/documents/"+tn.ids["document"]+"/favorite", tn.token, nil)
	w.call(t, "PUT", "/api/v1/orgs/"+tn.orgID+"/audit/retention", tn.token, map[string]any{"retain_days": 180})
	w.call(t, "PUT", ws+"/chat/users/"+tn.peerID+"/nickname", tn.token, map[string]any{"nickname": m + " nick"})
	w.call(t, "POST", ws+"/chat/users/"+tn.thirdID+"/block", tn.peerToken, nil)
	report := w.call(t, "POST", ws+"/chat/reports", tn.peerToken, map[string]any{"message_id": tn.ids["message"], "reason": "spam", "details": m + " report"})
	tn.ids["chatReport"], _ = report["id"].(string)
	w.call(t, "POST", ws+"/chat/threads/"+tn.ids["channelMessage"]+"/task-sync", tn.token, map[string]any{"task_id": tn.ids["task2"]})
	// A call ringing in the group: the voice routes act on a live call.
	w.call(t, "POST", ws+"/chat/rooms/"+tn.ids["room"]+"/voice/invite", tn.token, map[string]any{"call_id": tn.ids["callID"]})

	// The live meeting: a mark, chat, a transcript line, a summary, a vote.
	live := "/api/v1/meetings/" + tn.ids["liveMeeting"]
	out = w.call(t, "GET", live+"/participants", tn.token, nil)
	var hostPID string
	for _, p := range isoList(t, out, "participants") {
		if p["user_id"] == tn.userID {
			hostPID = p["id"].(string)
		}
	}
	if hostPID == "" {
		t.Fatalf("no host participant in %s's live meeting", tn.tag)
	}
	w.call(t, "PUT", live+"/attendance/"+hostPID, tn.token, map[string]any{"status": "PRESENT"})
	w.call(t, "POST", live+"/chat", tn.token, map[string]any{"message": m + " meeting chat"})
	out = w.call(t, "POST", live+"/transcript", tn.token, map[string]any{"text": m + " spoken line"})
	tn.ids["transcriptSegment"] = isoID(t, out, "segment")
	w.call(t, "POST", live+"/summary", tn.token, map[string]any{"locale": "en"}, http.StatusAccepted)
	// The run goes on after the answer (UNI-1995 #12); its rows exist once it ends.
	for deadline := time.Now().Add(30 * time.Second); ; time.Sleep(50 * time.Millisecond) {
		run, _ := w.call(t, "GET", live+"/summary", tn.token, nil)["run"].(map[string]any)
		if run["status"] == "idle" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s's summary run did not end: %v", tn.tag, run)
		}
	}
	out = w.call(t, "POST", live+"/motions", tn.token, map[string]any{
		"title": m + " Live motion", "ballot_mode": "PUBLIC", "threshold": "MAJORITY", "base": "PRESENT",
	})
	motion := isoID(t, out, "motion")
	w.call(t, "POST", live+"/motions/"+motion+"/open", tn.token, nil)
	w.call(t, "POST", live+"/motions/"+motion+"/ballot", tn.token, map[string]any{"choice": "YES"})

	// What the provider's webhooks and the legacy attendee list would write.
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_attendance_sessions
		(id, organization_id, meeting_id, conference_session_id, participant_id, provider_participant_identity, joined_at)
		SELECT $1, $2, $3, c.id, $4, 'uw_participant_' || $4, now()
		FROM meeting_conference_sessions c WHERE c.meeting_id = $3 LIMIT 1`,
		util.NewID(), tn.orgID, tn.ids["liveMeeting"], hostPID); err != nil {
		t.Fatalf("attendance session: %v", err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_attendees (organization_id, meeting_id, user_id) VALUES ($1, $2, $3)`,
		tn.orgID, tn.ids["meeting"], tn.peerID); err != nil {
		t.Fatalf("meeting attendee: %v", err)
	}

	// A summary of the scheduled meeting - the fake model answers with none -
	// and its action items: the reference cases convert items 0-2 and 4-6,
	// item 3 becomes a task here, and "actionItem" is the pending one the
	// routes with {actionItemID} name.
	tn.ids["meetingSummary"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_summaries
		(id, organization_id, meeting_id, summary, decisions, action_items, model, created_by)
		VALUES ($1, $2, $3, $4, '[]', '[]', 'fake', $5)`,
		tn.ids["meetingSummary"], tn.orgID, tn.ids["meeting"], m+" summary", tn.userID); err != nil {
		t.Fatalf("meeting summary: %v", err)
	}
	for i, key := range []string{"actionItem0", "actionItem1", "actionItem2", "actionItem3", "actionItem4", "actionItem5", "actionItem6", "actionItem"} {
		tn.ids[key] = util.NewID()
		if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_action_items
			(id, organization_id, workspace_id, meeting_id, source, summary_id, position, title, owner_text, created_by, created_by_kind)
			VALUES ($1, $2, $3, $4, 'AI', $5, $6, $7, $8, 'meeting_summary', 'system')`,
			tn.ids[key], tn.orgID, tn.wsID, tn.ids["meeting"], tn.ids["meetingSummary"], i,
			fmt.Sprintf("%s summary item %d", m, i), m+" Peer"); err != nil {
			t.Fatalf("meeting action item: %v", err)
		}
	}
	// A summary run's lease lives only while the run does; an expired one is
	// what a node that died mid-run leaves, so meeting_summary_runs holds a
	// row without holding the meeting's summaries up.
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_summary_runs
		(organization_id, meeting_id, run_id, expires_at)
		VALUES ($1, $2, $3, now() - interval '1 minute')`,
		tn.orgID, tn.ids["meeting"], util.NewID()); err != nil {
		t.Fatalf("meeting summary run: %v", err)
	}
	// A finished scribe run: the agent API has no session caller, so the row
	// is seeded the way MeetingService.ensureScribe writes it.
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_scribe_runs
		(id, organization_id, workspace_id, meeting_id, status, finished_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'FINISHED', now(), 'meeting_scribe', 'system')`,
		util.NewID(), tn.orgID, tn.wsID, tn.ids["meeting"]); err != nil {
		t.Fatalf("meeting scribe run: %v", err)
	}
	// An ended meeting waiting for its auto summary (UNI-2026): only
	// endMeeting queues it, and the isolation world configures no model.
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_auto_summaries (meeting_id, organization_id, due_at)
		VALUES ($1, $2, now() + interval '1 hour') ON CONFLICT DO NOTHING`, tn.ids["meeting"], tn.orgID); err != nil {
		t.Fatalf("meeting auto summary: %v", err)
	}
	// A speaker label of the shared microphone, filed the way
	// AppendAgentSegments files it (the agent API has no session caller).
	tn.ids["speakerLabel"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO meeting_speaker_labels
		(id, organization_id, workspace_id, meeting_id, label_key, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, 'meeting_scribe', 'system')`,
		tn.ids["speakerLabel"], tn.orgID, tn.wsID, tn.ids["meeting"], "uw_participant_"+tn.ids["participant"]+":1:A"); err != nil {
		t.Fatalf("meeting speaker label: %v", err)
	}
	w.call(t, "POST", "/api/v1/meetings/"+tn.ids["meeting"]+"/action-items/convert", tn.token, map[string]any{
		"items": []any{map[string]any{"action_item_id": tn.ids["actionItem3"], "assignee_id": tn.peerID}},
	})
}

// buildEditLocks seeds the document edit lock (UNI-1645 §6 step 1): two pages
// of their own - a live tenure on "document" would change what the restore,
// comment and share rows see - the owner's tenure on lockDocument from the
// desktop session buildOffice set, the peer's on peerLockDocument, and the
// peer's pending request to the owner. Raw SQL, like buildSeeded, so the
// fixture depends neither on the TTL nor on a minted desktop token.
func (w *isoWorld) buildEditLocks(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	m := tn.marker
	out := w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{"title": m + " Locked page", "kind": "page", "visibility": "workspace"})
	tn.ids["lockDocument"] = isoID(t, out, "document")
	// The matrix's controls run as the tenant's other members: the third
	// member's POST /edit-requests gates at edit, and a created
	// workspace-visible row opens at view (Q-S3). The share grant on the
	// document's own workspace raises the home row to edit (SH-S1's merge),
	// so the revision it bumps to is read back for the lock row's base.
	w.call(t, "POST", "/api/v1/documents/"+tn.ids["lockDocument"]+"/shares", tn.token,
		map[string]any{"principal_type": "workspace", "principal_id": tn.wsID, "level": "edit"})
	out = w.call(t, "GET", "/api/v1/documents/"+tn.ids["lockDocument"], tn.token, nil)
	tn.ids["lockDocumentRevision"] = isoString(t, out, "document", "revision")
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{"title": m + " Peer-locked page", "kind": "page", "visibility": "workspace"})
	tn.ids["peerLockDocument"] = isoID(t, out, "document")
	tn.ids["docEditor"] = util.NewID()

	tn.ids["docEditLock"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO document_edit_locks
		(id, organization_id, document_id, user_id, session_id, editor_id, client, base_revision, granted_via, acquired_at, heartbeat_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'desktop', $7, 'acquire', now(), now(), now() + interval '1 hour')`,
		tn.ids["docEditLock"], tn.orgID, tn.ids["lockDocument"], tn.userID, tn.get(t, "deviceSession"), tn.ids["docEditor"],
		tn.get(t, "lockDocumentRevision")); err != nil {
		t.Fatalf("edit lock: %v", err)
	}
	tn.ids["peerEditLock"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO document_edit_locks
		(id, organization_id, document_id, user_id, session_id, editor_id, client, base_revision, granted_via, acquired_at, heartbeat_at, expires_at)
		SELECT $1, $2, $3, $4, 'iso-peer-session', $5, 'web_page', revision, 'acquire', now(), now(), now() + interval '1 hour'
		FROM documents WHERE id = $3`,
		tn.ids["peerEditLock"], tn.orgID, tn.ids["peerLockDocument"], tn.peerID, util.NewID()); err != nil {
		t.Fatalf("peer edit lock: %v", err)
	}
	tn.ids["docEditRequest"] = util.NewID()
	if _, err := w.pool.Exec(ctx, `INSERT INTO document_edit_requests
		(id, organization_id, document_id, lock_id, requester_id, holder_id, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', now() + interval '1 hour')`,
		tn.ids["docEditRequest"], tn.orgID, tn.ids["lockDocument"], tn.ids["docEditLock"], tn.peerID, tn.userID); err != nil {
		t.Fatalf("edit request: %v", err)
	}
	// DOC-07 (UNI-1631): pending access requests the tenant's PEER and THIRD
	// sent on a workspace-visible page, so the tenant's owner (who may
	// administer it) sees them in the list and can approve one and decline the
	// other, while the peer is refused administering the same document. Two
	// requesters give the approve and the decline control a row each, so the
	// write-control pass does not close one with the other. The document is a
	// fresh one so neither decision disturbs a page a later case reads.
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/documents", tn.token, map[string]any{"title": m + " Access-request page", "kind": "page", "visibility": "workspace"})
	tn.ids["accessRequestDocument"] = isoID(t, out, "document")
	for _, r := range []struct {
		key        string
		requester  string
		level      string
		message    string
		sourceKind any
		sourceID   any
	}{
		{"accessRequest", tn.peerID, "view", m + " access request message", "task", tn.ids["task"]},
		{"accessRequestDecline", tn.thirdID, "edit", m + " decline access request message", nil, nil},
	} {
		tn.ids[r.key] = util.NewID()
		if _, err := w.pool.Exec(ctx, `INSERT INTO document_access_requests
			(id, organization_id, workspace_id, document_id, created_by, created_by_kind, requested_level, message, source_kind, source_id, status, expires_at)
			VALUES ($1, $2, $3, $4, $5, 'human', $6, $7, $8, $9, 'pending', now() + interval '30 days')`,
			tn.ids[r.key], tn.orgID, tn.wsID, tn.ids["accessRequestDocument"], r.requester, r.level, r.message, r.sourceKind, r.sourceID); err != nil {
			t.Fatalf("access request: %v", err)
		}
	}
}
