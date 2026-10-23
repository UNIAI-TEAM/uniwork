package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
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

// attachWorld is a server whose Ask UNI has a real FileService over a temp
// directory and both flags behind a switch (on), with an owner, their
// workspace, and a plain organization member who is not in that workspace.
func attachWorld(t *testing.T) (srv *httptest.Server, flags *attachFlagSwitch, owner, member, wsID string) {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	gw := service.NewAIGateway(pool, q, &provider.Fake{Reply: ai.FakeReply}, ai.Options{})
	d.AskUNI = service.NewAskUNIService(pool, q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	flags = &attachFlagSwitch{}
	flags.on.Store(true)
	d.AskUNI.SetFlags(flags)
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
	srv = httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	owner, wsID = registerOrgWorkspace(t, srv, "askatt-owner@example.com", "Owner", "askatt")
	var memberID string
	member, memberID = signUp(t, srv, "askatt-member@example.com", "Member")
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) SELECT organization_id, $1, 'member' FROM organization_members WHERE role = 'owner' AND organization_id = (SELECT id FROM organizations WHERE slug = 'askatt')`, memberID); err != nil {
		t.Fatal(err)
	}
	return srv, flags, owner, member, wsID
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
	srv, _, owner, _, wsID := attachWorld(t)
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
	srv, flags, owner, member, wsID := attachWorld(t)
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
