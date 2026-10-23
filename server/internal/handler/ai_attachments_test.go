package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

// sizedAskPDF is a valid one-page PDF of size bytes, padded by a comment line
// (or its own size, when that is larger): a question that is sent reads its
// files, so they must open.
func sizedAskPDF(size int) []byte {
	build := func(pad int) []byte {
		var b bytes.Buffer
		b.WriteString("%PDF-1.4\n")
		if pad >= 0 {
			b.WriteString("%" + strings.Repeat("x", pad) + "\n")
		}
		var offs []int
		for _, obj := range []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"} {
			offs = append(offs, b.Len())
			fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offs), obj)
		}
		xref := b.Len()
		fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offs)+1)
		for _, o := range offs {
			fmt.Fprintf(&b, "%010d 00000 n \n", o)
		}
		fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offs)+1, xref)
		return b.Bytes()
	}
	pad, b := 0, build(0)
	// Later passes absorb a startxref that grew a digit with the padding.
	for range 3 {
		if d := size - len(b); d != 0 && pad+d >= 0 {
			pad += d
			b = build(pad)
		}
	}
	if len(b) > size {
		return build(-1)
	}
	return b
}

// A question carries the files it names: the answer to the ask holds none, the
// list of messages shows them on the question in the order they were attached,
// and every id the asker may not attach, or not at all, is refused with one
// body and nothing stored.
func TestAskWithAttachmentsOverHTTP(t *testing.T) {
	env := attachWorld(t)
	srv, flags, owner, member, wsID := env.srv, env.flags, env.owner, env.member, env.wsID
	askPath, streamPath := "/api/v1/workspaces/"+wsID+"/ai/ask", "/api/v1/workspaces/"+wsID+"/ai/ask/stream"
	upload := func(token, ws, name string, content []byte) string {
		t.Helper()
		res, out := postAskFile(t, srv, token, ws, name, content, false)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("upload %s: %d %v", name, res.StatusCode, out)
		}
		return out["file_id"].(string)
	}
	small := sizedAskPDF(200)
	a, b := upload(owner, wsID, "a.pdf", small), upload(owner, wsID, "b.pdf", small)

	res, out := doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "tóm tắt hai file", "attachment_ids": []string{b, a}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("ask with files: %d %v", res.StatusCode, out)
	}
	if got, ok := out["message"].(map[string]any)["attachments"].([]any); !ok || len(got) != 0 {
		t.Fatalf("the stored answer carries attachments %v, want []", out["message"].(map[string]any)["attachments"])
	}
	convID := out["conversation_id"].(string)

	res, out = doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+convID+"/messages", owner, nil)
	msgs, _ := out["messages"].([]any)
	if res.StatusCode != http.StatusOK || len(msgs) != 2 {
		t.Fatalf("messages: %d %v", res.StatusCode, out)
	}
	question, answer := msgs[0].(map[string]any), msgs[1].(map[string]any)
	atts, _ := question["attachments"].([]any)
	if question["role"] != "user" || len(atts) != 2 {
		t.Fatalf("the question carries %v, want two files", question["attachments"])
	}
	for i, want := range []string{"b.pdf", "a.pdf"} {
		got := atts[i].(map[string]any)
		if got["name"] != want || got["mime"] != "application/pdf" || got["kind"] != "pdf" || got["size"] != float64(len(small)) || got["id"] == "" || got["id"] == a || got["id"] == b || len(got) != 5 {
			t.Errorf("attachment %d = %v, want %s with id, name, mime, size and kind only", i, got, want)
		}
	}
	if got, ok := answer["attachments"].([]any); !ok || len(got) != 0 {
		t.Errorf("the answer carries attachments %v, want []", answer["attachments"])
	}

	// A file the question holds is not an unsent upload any more; it answers
	// like an id that names nothing, and so does another member's.
	otherOwner, otherWS := registerOrgWorkspace(t, srv, "askatt-elsewhere@example.com", "Elsewhere", "askatt-elsewhere")
	foreign := upload(otherOwner, otherWS, "foreign.pdf", small)
	res, want := doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "x", "attachment_ids": []string{"01J8X4NOSUCHFILE00000000000"}})
	wantError(t, "an id that names nothing", res, want, http.StatusNotFound, "not_found")
	for name, id := range map[string]string{"a sent file": a, "another tenant's upload": foreign} {
		for route, path := range map[string]string{"ask": askPath, "stream": streamPath} {
			if route == "stream" {
				res = postStream(t, srv, wsID, owner, map[string]any{"question": "x", "attachment_ids": []string{id}})
				raw, _ := readAll(res)
				var got map[string]any
				_ = json.Unmarshal(raw, &got)
				if res.StatusCode != http.StatusNotFound || !equalJSON(got, want) {
					t.Errorf("%s on stream = %d %v, want the 404 of an id that names nothing %v", name, res.StatusCode, got, want)
				}
				continue
			}
			res, out = doJSON(t, srv, "POST", path, owner, map[string]any{"question": "x", "attachment_ids": []string{id}})
			if res.StatusCode != http.StatusNotFound || !equalJSON(out, want) {
				t.Errorf("%s on %s = %d %v, want the 404 of an id that names nothing %v", name, route, res.StatusCode, out, want)
			}
		}
	}

	c := upload(owner, wsID, "c.pdf", small)
	res, out = doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "x", "attachment_ids": []string{c, c}})
	wantError(t, "the same file twice", res, out, http.StatusBadRequest, "ai_attachments_invalid")
	res, out = doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "x", "attachment_ids": []string{"1", "2", "3", "4", "5", "6"}})
	wantError(t, "six files", res, out, http.StatusBadRequest, "ai_attachments_invalid")
	big1, big2 := upload(owner, wsID, "big1.pdf", sizedAskPDF(10<<20)), upload(owner, wsID, "big2.pdf", sizedAskPDF(10<<20+1))
	res, out = doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "x", "attachment_ids": []string{big1, big2}})
	wantError(t, "over 20 MB in total", res, out, http.StatusUnprocessableEntity, "ai_attachments_too_large")

	// The stream route takes the same ids; its done event carries the answer,
	// and the list then shows the file on the new question.
	sres := postStream(t, srv, wsID, owner, map[string]any{"question": "tóm tắt c", "attachment_ids": []string{c}})
	var done struct {
		Message struct {
			Attachments []any `json:"attachments"`
		}
	}
	for _, f := range collectFrames(readSSE(sres.Body)) {
		if f.event == "done" {
			_ = json.Unmarshal([]byte(f.data), &done)
		}
	}
	if sres.StatusCode != http.StatusOK || done.Message.Attachments == nil || len(done.Message.Attachments) != 0 {
		t.Fatalf("stream with a file: %d, done attachments %v, want 200 and []", sres.StatusCode, done.Message.Attachments)
	}
	_, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/ai/conversations", owner, nil)
	var withC int
	for _, conv := range out["conversations"].([]any) {
		_, listed := doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+conv.(map[string]any)["id"].(string)+"/messages", owner, nil)
		for _, m := range listed["messages"].([]any) {
			for _, att := range m.(map[string]any)["attachments"].([]any) {
				if att.(map[string]any)["name"] == "c.pdf" {
					withC++
				}
			}
		}
	}
	if withC != 1 {
		t.Errorf("c.pdf is listed on %d messages, want the one question that sent it", withC)
	}

	// Files are off: a question that names one is refused, a plain one is not.
	d := upload(owner, wsID, "d.pdf", small)
	flags.on.Store(false)
	res, out = doJSON(t, srv, "POST", askPath, owner, map[string]any{"question": "x", "attachment_ids": []string{d}})
	wantError(t, "a file while the flags are off", res, out, http.StatusForbidden, "ai_attachments_unavailable")
	flags.on.Store(true)
	// Someone outside the workspace is refused before the files are looked at.
	res, out = doJSON(t, srv, "POST", askPath, member, map[string]any{"question": "x", "attachment_ids": []string{d}})
	wantError(t, "a non-member", res, out, http.StatusForbidden, "ai_context_forbidden")
}

// getAskFile sends GET .../ai/attachments/{attachmentID}/content.
func getAskFile(t *testing.T, srv *httptest.Server, token, wsID, attachmentID string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/workspaces/"+wsID+"/ai/attachments/"+attachmentID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := readAll(res)
	return res, raw
}

// A file a question carries downloads as an attachment, never sniffed and
// never cached, by the id its message lists it under, and only for the asker:
// everyone else, and every id that names no file of theirs, hears one 404.
func TestDownloadAskAttachmentHeaders(t *testing.T) {
	env := attachWorld(t)
	ctx := context.Background()
	srv, owner, wsID := env.srv, env.owner, env.wsID
	pdf := sizedAskPDF(400)
	res, out := postAskFile(t, srv, owner, wsID, "note.pdf", pdf, false)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload: %d %v", res.StatusCode, out)
	}
	fileID := out["file_id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, map[string]any{"question": "tóm tắt", "attachment_ids": []string{fileID}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("ask: %d %v", res.StatusCode, out)
	}
	convID := out["conversation_id"].(string)
	_, out = doJSON(t, srv, "GET", "/api/v1/ai/conversations/"+convID+"/messages", owner, nil)
	atts := out["messages"].([]any)[0].(map[string]any)["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("the question carries %v, want one file", atts)
	}
	attID := atts[0].(map[string]any)["id"].(string)

	res, body := getAskFile(t, srv, owner, wsID, attID)
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, pdf) {
		t.Fatalf("download = %d with %d bytes, want 200 with the %d uploaded", res.StatusCode, len(body), len(pdf))
	}
	for header, want := range map[string]string{
		"Content-Disposition":    `attachment; filename="note.pdf"`,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "private, no-store",
		"Content-Type":           "application/pdf",
		"Content-Length":         fmt.Sprint(len(pdf)),
	} {
		if got := res.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}

	// One answer for every attachment that is not the caller's: another member
	// of the workspace, another tenant's owner in their own workspace, the
	// upload's file id (not the row's), a row that never was.
	var orgID string
	if err := env.pool.QueryRow(ctx, `SELECT organization_id FROM workspaces WHERE id = $1`, wsID).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	if err := db.New(env.pool).AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: wsID, OrganizationID: orgID, UserID: env.memberID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	otherOwner, otherWS := registerOrgWorkspace(t, srv, "askatt-dl-other@example.com", "Other", "askatt-dl-other")
	res, want := getAskFile(t, srv, owner, wsID, "01J8X4NOSUCHATTACH000000000")
	if res.StatusCode != http.StatusNotFound || !strings.Contains(string(want), `"not_found"`) {
		t.Fatalf("unknown id = %d %s, want 404 not_found", res.StatusCode, want)
	}
	for name, tc := range map[string]struct{ token, wsID, id string }{
		"another member":       {env.member, wsID, attID},
		"another tenant":       {otherOwner, otherWS, attID},
		"the upload's file id": {owner, wsID, fileID},
	} {
		res, got := getAskFile(t, srv, tc.token, tc.wsID, tc.id)
		if res.StatusCode != http.StatusNotFound || !bytes.Equal(got, want) || strings.Contains(string(got), tc.id) {
			t.Errorf("%s = %d %s, want the same 404 as an unknown id (%s)", name, res.StatusCode, got, want)
		}
	}

	// The flags gate adding files, not taking back what was attached.
	env.flags.on.Store(false)
	if res, body := getAskFile(t, srv, owner, wsID, attID); res.StatusCode != http.StatusOK || !bytes.Equal(body, pdf) {
		t.Errorf("download with the flags off = %d, want 200 with the file", res.StatusCode)
	}
	env.flags.on.Store(true)

	// The file goes with its conversation.
	if res, _ := doJSON(t, srv, "DELETE", "/api/v1/ai/conversations/"+convID, owner, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("delete conversation = %d, want 200", res.StatusCode)
	}
	if res, got := getAskFile(t, srv, owner, wsID, attID); res.StatusCode != http.StatusNotFound || !bytes.Equal(got, want) {
		t.Errorf("download after the conversation was deleted = %d %s, want the 404 of an unknown id", res.StatusCode, got)
	}
}

// equalJSON is whether two decoded bodies are the same.
func equalJSON(a, b map[string]any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}
