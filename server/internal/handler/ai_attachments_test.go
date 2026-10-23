package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// attachFlagSwitch reads every flag as its default except the two Ask UNI
// attachments need, which follow the switch.
type attachFlagSwitch struct{ on atomic.Bool }

func (f *attachFlagSwitch) IsEnabled(_ context.Context, key string, def bool) bool {
	if key == "ask_uni_agent" || key == "ask_uni_attachments" {
		return f.on.Load()
	}
	return def
}

// attachEnv is a server whose Ask UNI has a real FileService over a temp
// directory, the agent wired as main wires it and both flags behind a switch
// (on), with an owner, their workspace, and a plain organization member who is
// not in that workspace.
type attachEnv struct {
	srv                 *httptest.Server
	flags               *attachFlagSwitch
	fs                  *service.FileService
	pool                *pgxpool.Pool
	owner, member, wsID string
	memberID            string
}

func attachWorld(t *testing.T) *attachEnv {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	gw := service.NewAIGateway(pool, q, &provider.Fake{Reply: ai.FakeReply}, ai.Options{})
	d.AskUNI = service.NewAskUNIService(pool, q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	flags := &attachFlagSwitch{}
	flags.on.Store(true)
	d.AskUNI.SetFlags(flags)
	d.AskUNI.SetReadTools(service.NewMcpToolService(q, d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin))
	stores, err := storage.BuildStores(context.Background(),
		storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatal(err)
	}
	fs, err := service.NewFileService(service.FileServiceOptions{Pool: pool, Store: stores[storage.BackendLocal], SpoolDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	d.AskUNI.SetFiles(fs)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	env := &attachEnv{srv: srv, flags: flags, fs: fs, pool: pool}
	env.owner, env.wsID = registerOrgWorkspace(t, srv, "askatt-owner@example.com", "Owner", "askatt")
	env.member, env.memberID = signUp(t, srv, "askatt-member@example.com", "Member")
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) SELECT organization_id, $1, 'member' FROM organization_members WHERE role = 'owner' AND organization_id = (SELECT id FROM organizations WHERE slug = 'askatt')`, env.memberID); err != nil {
		t.Fatal(err)
	}
	return env
}

// postAskFile sends one multipart "file" part. chunked hides the length from
// the client, so the server sees a body without Content-Length.
func postAskFile(t *testing.T, srv *httptest.Server, token, wsID, filename string, content []byte, chunked bool) (*http.Response, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	var reader io.Reader = &body
	if chunked {
		reader = io.MultiReader(&body)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/workspaces/"+wsID+"/ai/attachments", reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	raw, _ := readAll(res)
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func TestUploadAskAttachmentCapsTheBody(t *testing.T) {
	env := attachWorld(t)
	srv, owner, wsID := env.srv, env.owner, env.wsID
	const limit = 20 << 20
	// 20 MiB + 1 byte fits the multipart envelope's headroom, so the file
	// part itself is what is refused; 21 MiB is refused as a whole, with and
	// without a Content-Length.
	for name, tc := range map[string]struct {
		size    int
		chunked bool
	}{
		"one byte over the file cap": {limit + 1, false},
		"21 MiB with a length":       {21 << 20, false},
		"21 MiB chunked":             {21 << 20, true},
	} {
		res, out := postAskFile(t, srv, owner, wsID, "big.txt", bytes.Repeat([]byte("x"), tc.size), tc.chunked)
		wantError(t, name, res, out, http.StatusRequestEntityTooLarge, "too_large")
	}
}

func TestAskAttachmentRoutes(t *testing.T) {
	env := attachWorld(t)
	srv, flags, owner, member, wsID := env.srv, env.flags, env.owner, env.member, env.wsID
	pdf := []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")

	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/capabilities", owner, nil)
	if res.StatusCode != http.StatusOK || out["attachments"] != true {
		t.Fatalf("capabilities with both flags on: %d %v, want attachments true", res.StatusCode, out)
	}

	res, out = postAskFile(t, srv, owner, wsID, "note.pdf", pdf, false)
	if res.StatusCode != http.StatusOK || out["name"] != "note.pdf" || out["mime"] != "application/pdf" || out["kind"] != "pdf" || out["size"] != float64(len(pdf)) {
		t.Fatalf("upload: %d %v", res.StatusCode, out)
	}
	fileID, _ := out["file_id"].(string)
	if fileID == "" {
		t.Fatalf("upload returned no file_id: %v", out)
	}

	res, out = postAskFile(t, srv, owner, wsID, "x.xls", append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, make([]byte, 64)...), false)
	wantError(t, "legacy XLS", res, out, http.StatusUnsupportedMediaType, "file_type_rejected")
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/attachments", owner, map[string]any{})
	wantError(t, "no multipart body", res, out, http.StatusBadRequest, "invalid_request")

	// Someone who is not in the workspace is refused on both routes.
	res, out = postAskFile(t, srv, member, wsID, "note.pdf", pdf, false)
	wantError(t, "upload by a non-member", res, out, http.StatusForbidden, "ai_context_forbidden")
	res, out = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/ai/attachments/"+fileID, member, nil)
	wantError(t, "cancel by a non-member", res, out, http.StatusForbidden, "ai_context_forbidden")

	res, _ = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/ai/attachments/"+fileID, owner, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel by the uploader = %d, want 204", res.StatusCode)
	}
	res, out = doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/ai/attachments/01J8X4NOSUCHFILE00000000000", owner, nil)
	wantError(t, "cancel of an unknown file", res, out, http.StatusNotFound, "not_found")

	flags.on.Store(false)
	res, out = postAskFile(t, srv, owner, wsID, "note.pdf", pdf, false)
	wantError(t, "upload with the flags off", res, out, http.StatusForbidden, "ai_attachments_unavailable")
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/capabilities", owner, nil)
	if res.StatusCode != http.StatusOK || out["attachments"] != false {
		t.Errorf("capabilities with the flags off: %d %v, want attachments false", res.StatusCode, out)
	}
}

// deleteAskFile sends DELETE .../ai/attachments/{fileID} and returns the status
// and the raw body.
func deleteAskFile(t *testing.T, srv *httptest.Server, token, wsID, fileID string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, srv.URL+"/api/v1/workspaces/"+wsID+"/ai/attachments/"+fileID, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := readAll(res)
	return res.StatusCode, string(raw)
}

// A cancel that is not the caller's to make has one answer, whatever the
// reason: another member's unclaimed upload, another tenant's, a file of
// another purpose, one a question already holds, or nothing at all. A different
// body (or one naming the id) would tell a stranger that a file exists.
func TestCancelAskAttachmentAnswersOneNotFound(t *testing.T) {
	env := attachWorld(t)
	ctx := context.Background()
	pdf := []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")
	upload := func(token, wsID string) (fileID string) {
		t.Helper()
		res, out := postAskFile(t, env.srv, token, wsID, "note.pdf", pdf, false)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("upload: %d %v", res.StatusCode, out)
		}
		return out["file_id"].(string)
	}
	var orgID string
	if err := env.pool.QueryRow(ctx, `SELECT organization_id FROM workspaces WHERE id = $1`, env.wsID).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	// The plain member joins the workspace: from here the answer is about the
	// file, not about membership.
	if err := db.New(env.pool).AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: env.wsID, OrganizationID: orgID, UserID: env.memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	otherOwner, otherWS := registerOrgWorkspace(t, env.srv, "askatt-other@example.com", "Other", "askatt-other")

	var ownerID string
	mine := upload(env.owner, env.wsID)
	if err := env.pool.QueryRow(ctx, `SELECT created_by FROM file_upload_sessions WHERE file_id = $1`, mine).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	scope := files.Scope{OrganizationID: orgID, WorkspaceID: env.wsID}
	chatFile, err := env.fs.Upload(ctx, files.UploadInput{
		Actor: audit.User(ownerID), Purpose: files.ChatAttachment, Scope: scope,
		IdempotencyKey: "cancel-body-chat", Filename: "chat.pdf", Body: strings.NewReader(string(pdf)),
	})
	if err != nil {
		t.Fatal(err)
	}
	claimed := upload(env.owner, env.wsID)
	tx, err := env.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.fs.ClaimInTx(ctx, db.New(env.pool).WithTx(tx), files.ClaimInput{
		Actor: audit.User(ownerID), Purpose: files.AiAttachment, Scope: scope, FileIDs: []files.FileID{files.FileID(claimed)},
	}); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	foreign := upload(otherOwner, otherWS)

	status, want := deleteAskFile(t, env.srv, env.owner, env.wsID, "01J8X4NOSUCHFILE00000000000")
	if status != http.StatusNotFound || !strings.Contains(want, `"not_found"`) {
		t.Fatalf("unknown id = %d %s, want 404 not_found", status, want)
	}
	for name, tc := range map[string]struct{ token, wsID, fileID string }{
		"another member's unclaimed upload":  {env.member, env.wsID, mine},
		"another tenant's upload":            {env.owner, env.wsID, foreign},
		"the owner's file in another tenant": {otherOwner, otherWS, mine},
		"another purpose":                    {env.owner, env.wsID, string(chatFile.File.ID)},
		"a claimed file":                     {env.owner, env.wsID, claimed},
	} {
		status, got := deleteAskFile(t, env.srv, tc.token, tc.wsID, tc.fileID)
		// Compared with the unknown id's body with the id read out, since the
		// two ids differ.
		if status != http.StatusNotFound || got != want || strings.Contains(got, tc.fileID) {
			t.Errorf("%s = %d %s, want the same 404 as an unknown id (%s)", name, status, got, want)
		}
	}
	// None of the refusals touched the owner's own cancel.
	if status, body := deleteAskFile(t, env.srv, env.owner, env.wsID, mine); status != http.StatusNoContent {
		t.Fatalf("the owner's own cancel = %d %s, want 204", status, body)
	}
}
