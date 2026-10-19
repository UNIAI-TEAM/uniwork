package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// newTestServerWithFilesAndDocuments is newTestServerWithFiles with the
// Documents service the chat document send files into (UNI-1966). Without it
// the route answers 501, which is its own test below.
func newTestServerWithFilesAndDocuments(t *testing.T) *httptest.Server {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	fs := filesfake.New(filesfake.Options{})
	d.Chat.SetFiles(fs)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetFiles(fs)
	d.Documents = docs
	d.Chat.SetDocuments(docs)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

// uploadChatDocument posts the document multipart route with the fields the
// contract names.
func uploadChatDocument(
	t *testing.T, srvURL, token, workspaceID, roomID, filename, declaredType, clientMsgID, shareLevel string, content []byte,
) (*http.Response, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("client_msg_id", clientMsgID)
	_ = mw.WriteField("share_level", shareLevel)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {declaredType},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	path := "/api/v1/workspaces/" + workspaceID + "/chat/rooms/" + roomID + "/messages/document"
	req, _ := http.NewRequest("POST", srvURL+path, &body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res, out
}

// TestSendChatDocumentMessage is §7.2 test 14: the new route end to end over
// the real router, its cap, the room gate before the body and the 415 for a
// type outside the L8 subset.
func TestSendChatDocumentMessage(t *testing.T) {
	srv := newTestServerWithFilesAndDocuments(t)
	f := setupChatFixtureOn(t, srv, "chatdoc")
	docBody := []byte("# Kế hoạch\n\n- một\n- hai\n")

	res, out := uploadChatDocument(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.md", "text/markdown", "chatdoc-1", "comment", docBody,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send = %d %v", res.StatusCode, out)
	}
	msg, _ := out["message"].(map[string]any)
	if msg == nil || msg["kind"] != "document" {
		t.Fatalf("message = %v", out)
	}
	block, _ := msg["document"].(map[string]any)
	if block == nil || block["document_id"] == "" {
		t.Fatalf("document block = %v", block)
	}
	if block["viewer_has_access"] != true || block["viewer_level"] != "manage" {
		t.Fatalf("sender block = %v", block)
	}
	if block["title"] != "Kế hoạch" && block["format"] != "md" {
		t.Fatalf("block = %v", block)
	}
	// The block never leaks the storage locator.
	if _, leaked := block["file_id"]; leaked {
		t.Fatalf("block leaks file_id: %v", block)
	}

	// The receiver reads the card through the room list.
	res, out = doJSON(t, f.srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.dmRoomID+"/messages", f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("receiver list = %d %v", res.StatusCode, out)
	}
	var receiverBlock map[string]any
	for _, raw := range out["messages"].([]any) {
		row := raw.(map[string]any)
		if row["id"] == msg["id"] {
			receiverBlock, _ = row["document"].(map[string]any)
		}
	}
	if receiverBlock == nil || receiverBlock["viewer_level"] != "comment" {
		t.Fatalf("receiver block = %v", receiverBlock)
	}

	// L8: a PNG is on documentMIMETypes but off ChatDocumentMIMETypes.
	res, out = uploadChatDocument(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"pixel.png", "image/png", "chatdoc-png", "comment", tinyPNG,
	)
	if res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("png = %d %v, want 415", res.StatusCode, out)
	}
	if reason, _ := out["error"].(map[string]any)["fields"].(map[string]any)["reason"].(string); reason != "format" {
		t.Fatalf("fields = %v, want reason=format", out)
	}

	// A workspace member who is not in this DM is refused: the room gate runs
	// before the body.
	res, out = uploadChatDocument(
		t, f.srv.URL, f.tokens["c"], f.wsID, f.dmRoomID,
		"ke-hoach.md", "text/markdown", "chatdoc-out", "comment", docBody,
	)
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("a non-member of the DM sent a document: %d %v", res.StatusCode, out)
	}
}

// TestChatRoomDetailCarriesCanSendDocument is the L5 route test.
func TestChatRoomDetailCarriesCanSendDocument(t *testing.T) {
	srv := newTestServerWithFilesAndDocuments(t)
	f := setupChatFixtureOn(t, srv, "chatroomdetail")

	res, out := doJSON(t, f.srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.dmRoomID, f.tokens["a"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("room detail = %d %v", res.StatusCode, out)
	}
	room, _ := out["room"].(map[string]any)
	if room == nil || room["id"] != f.dmRoomID {
		t.Fatalf("room = %v", out)
	}
	if room["can_send_document"] != true {
		t.Fatalf("can_send_document = %v, want true on a two-person DM", room["can_send_document"])
	}
	// The room LIST never carries the flag.
	res, out = doJSON(t, f.srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms", f.tokens["a"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("room list = %d %v", res.StatusCode, out)
	}
	for _, raw := range out["rooms"].([]any) {
		if _, present := raw.(map[string]any)["can_send_document"]; present {
			t.Fatalf("the room list carries can_send_document: %v", raw)
		}
	}
}

// TestSendChatDocumentMessageUnwiredAnswers501: without the Documents service
// the route fails closed instead of half-working.
func TestSendChatDocumentMessageUnwiredAnswers501(t *testing.T) {
	srv := newTestServerWithFiles(t)
	f := setupChatFixtureOn(t, srv, "chatdoc501")
	res, out := uploadChatDocument(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.md", "text/markdown", "chatdoc-501", "comment", []byte("# x\n"),
	)
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("unwired send = %d %v, want 501", res.StatusCode, out)
	}
	if !strings.Contains(strings.ToLower(errorCodeOf(out)), "storage_unavailable") {
		t.Fatalf("code = %v", out)
	}
}
