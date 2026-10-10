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

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
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
	d, pool := newTestDeps(t, nil, discardOutbox{})
	// The Office desktop bridge: the download profile and the desktop client
	// the launch and device routes check against.
	d.Cfg.APIPublicURL = "https://api.example.test"
	d.Cfg.OfficeInstallerStableURL = "https://downloads.example.test/office.exe"
	d.Cfg.DesktopAuthClientID = isoOfficeClient
	d.Cfg.DesktopAuthDeploymentIDs = []string{isoOfficeDeployment}
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
	d.Meetings.Chat = d.Chat
	d.Tasks.Chat = d.Chat
	d.Chat.SetAIGateway(d.Meetings.AI)

	// Documents and Office run on the FileService fake: the Office engine
	// reads through a presigned URL, which the local disk backend cannot mint.
	docFiles := filesfake.New(filesfake.Options{})
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetFiles(docFiles)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	d.Documents = docs
	d.DesktopAuth = service.NewDesktopAuthService(pool, q, d.Minter, d.Cfg)
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
		Pool: pool, Queries: q, Files: docFiles, Engine: newHandlerStubEngine(t), Documents: docs,
		// The stub engine never finishes a blank document; a short deadline
		// keeps that refusal from costing the run a minute.
		MaxDeadline: 3 * time.Second,
	})

	box := testEmailHubSecretBox(t)
	d.EmailHub = service.NewEmailHubService(q, d.Workspaces, box)
	d.EmailHub.AI = d.Meetings.AI
	d.EmailHub.Tasks = d.Tasks
	d.AskUNI.SetEmailHub(d.EmailHub)
	d.CalendarConnections = service.NewCalendarConnectionService(pool, q, d.Workspaces, box, config.Config{
		FrontendOrigin: "http://localhost:3000",
	})

	d.Hub.SetAuthorizer(realtime.ScopeAuthorizers{
		realtime.ScopeChat:    realtime.ChatScopeAuthorizer{Gate: d.Chat},
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

	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return &isoWorld{srv: srv, pool: pool, q: q, deps: d, files: fs, box: box}
}

// isoBody is what a matrix request sends: JSON, a multipart file part, or
// nothing at all.
type isoBody struct {
	json      any
	multipart *isoMultipart
	headers   map[string]string
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
	if frame, ok := w.frameTokens[token]; ok && strings.HasPrefix(path, "/api/v1/office-frame/") {
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
	w.buildOfficeFrame(t, tn)
	w.buildSeeded(t, tn)
	w.buildActivity(t, tn)
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
		tok, err := long.Mint(p.id)
		if err != nil {
			t.Fatal(err)
		}
		*p.token = tok
	}
	// The frame token stays; it is now sent in place of the new session.
	w.frameTokens[tn.token] = tn.ids["frameToken"]
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
	rp := ws + "/chat/rooms/" + tn.ids["room"]
	out = w.call(t, "POST", rp+"/messages", tn.token, map[string]any{"body": m + " chat message", "client_msg_id": util.NewID()})
	tn.ids["message"] = isoID(t, out, "message")
	w.call(t, "POST", rp+"/threads/"+tn.ids["message"]+"/messages", tn.peerToken, map[string]any{"body": m + " thread reply", "client_msg_id": util.NewID()})
	out = w.call(t, "POST", rp+"/messages", tn.token, map[string]any{
		"client_msg_id": util.NewID(), "poll": map[string]any{"question": m + " poll", "options": []string{"Canteen", "Outside"}},
	})
	tn.ids["pollMessage"] = isoID(t, out, "message")
	tn.ids["pollOption"] = isoString(t, out["message"].(map[string]any)["poll"].(map[string]any)["options"].([]any)[0].(map[string]any), "id")
	out = w.upload(t, rp+"/messages/file", tn.token, isoMultipart{
		fields: map[string]string{"client_msg_id": util.NewID()}, filename: strings.ToLower(m) + ".pdf", contentType: "application/pdf", content: tinyPDF,
	})
	tn.ids["fileMessage"] = isoID(t, out, "message")
	out = w.upload(t, rp+"/messages/voice", tn.token, isoMultipart{
		fields: map[string]string{"client_msg_id": util.NewID(), "duration_ms": "4000"}, filename: "voice.webm", contentType: "audio/webm", content: tinyWebM,
	})
	tn.ids["voiceMessage"] = isoID(t, out, "message")
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
	dp := "/api/v1/documents/" + tn.ids["document"]
	out = w.call(t, "POST", dp+"/comments", tn.token, map[string]any{"body": m + " doc comment", "type": "comment"})
	tn.ids["docComment"] = isoID(t, out, "comment")
	out = w.call(t, "POST", dp+"/shares", tn.token, map[string]any{"principal_type": "user", "principal_id": tn.peerID, "level": "view"})
	tn.ids["share"] = isoID(t, out, "share")
	w.call(t, "PUT", "/api/v1/orgs/"+tn.orgID+"/documents/settings", tn.token, map[string]any{"public_links_enabled": true})
	out = w.call(t, "POST", dp+"/links", tn.token, map[string]any{})
	tn.ids["docLink"] = isoID(t, out, "link")
	tn.ids["docLinkToken"] = isoString(t, out, "token")
	out = w.upload(t, dp+"/assets", tn.token, isoMultipart{filename: strings.ToLower(m) + ".png", contentType: "image/png", content: docsPNG})
	tn.ids["asset"] = isoID(t, out, "asset")
	out = w.call(t, "POST", dp+"/versions", tn.token, map[string]any{"label": m + " version"})
	tn.ids["version"] = fmt.Sprint(out["version"].(map[string]any)["version"])

	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": m + " File"}, filename: strings.ToLower(m) + ".md", contentType: "text/markdown",
		content: []byte("# " + m + " file body\n"),
	})
	tn.ids["fileDocument"] = isoID(t, out, "document")
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
}

func (w *isoWorld) buildOrganization(t *testing.T, tn *isoTenant) {
	t.Helper()
	m := tn.marker
	org := "/api/v1/orgs/" + tn.orgSlug
	out := w.call(t, "POST", org+"/departments", tn.token, map[string]any{"name": m + " Department"})
	tn.ids["department"] = isoID(t, out, "department")
	// A pending invitation to someone outside both tenants: its id for the
	// revoke route, its token for the accept route.
	invitee := strings.ToLower(m) + "-invitee@example.com"
	w.call(t, "POST", org+"/invitations", tn.token, map[string]any{"emails": []string{invitee}, "org_role": "member"})
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
	out = w.call(t, "GET", "/api/v1/orgs/"+tn.orgID+"/audit", tn.token, nil)
	if rows := isoList(t, out, "events"); len(rows) > 0 {
		tn.ids["auditEvent"] = rows[0]["id"].(string)
	}
	out = w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/ai/ask", tn.token, map[string]any{"question": m + " question"})
	tn.ids["conversation"] = isoString(t, out, "conversation_id")
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
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, SmtpHost: "smtp.example.com", SmtpPort: 465,
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
}

// buildActivity leaves the traces people leave by using the product - a
// reaction, a nickname, a vote, an attendance mark - so every tenant table
// holds a row of the tenant's (TestIsolationMatrix checks it).
func (w *isoWorld) buildActivity(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	m := tn.marker
	ws := "/api/v1/workspaces/" + tn.wsID

	w.call(t, "POST", "/api/v1/tasks/"+tn.ids["task"]+"/reactions", tn.token, map[string]any{"emoji": "👍"})
	w.call(t, "POST", "/api/v1/comments/"+tn.ids["taskComment"]+"/reactions", tn.token, map[string]any{"emoji": "👍"})
	w.call(t, "PUT", ws+"/task-view-preferences", tn.token, map[string]any{"scope_type": "workspace", "prefs": map[string]any{"layout": "list"}})
	w.call(t, "PUT", ws+"/home/preferences", tn.token, map[string]any{"prefs": map[string]any{"layout": "compact"}})
	w.call(t, "POST", "/api/v1/documents/"+tn.ids["document"]+"/favorite", tn.token, nil)
	w.call(t, "PUT", "/api/v1/orgs/"+tn.orgID+"/audit/retention", tn.token, map[string]any{"retain_days": 180})
	w.call(t, "PUT", ws+"/chat/users/"+tn.peerID+"/nickname", tn.token, map[string]any{"nickname": m + " nick"})
	w.call(t, "POST", ws+"/chat/users/"+tn.thirdID+"/block", tn.peerToken, nil)
	w.call(t, "POST", ws+"/chat/threads/"+tn.ids["message"]+"/task-sync", tn.token, map[string]any{"task_id": tn.ids["task2"]})
	// A call ringing in the group: the voice routes act on a live call.
	w.call(t, "POST", ws+"/chat/rooms/"+tn.ids["room"]+"/voice/invite", tn.token, map[string]any{"call_id": tn.ids["callID"]})

	// The live meeting: a mark, chat, a transcript line, a summary, a vote.
	live := "/api/v1/meetings/" + tn.ids["liveMeeting"]
	out := w.call(t, "GET", live+"/participants", tn.token, nil)
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
	w.call(t, "POST", live+"/transcript", tn.token, map[string]any{"text": m + " spoken line"})
	w.call(t, "POST", live+"/summary", tn.token, map[string]any{"locale": "en"})
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
}
