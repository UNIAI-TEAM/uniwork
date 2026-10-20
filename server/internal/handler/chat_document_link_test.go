package handler

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// TestSendChatDocumentLink is the document-link route over the real router
// (UNI-2012 D5): an existing page goes into the DM as a document card the
// receiver reads at the granted level; manage and an unknown level are 400,
// a malformed body is 400, a missing document is 404 and a non-member of the
// room is forbidden.
func TestSendChatDocumentLink(t *testing.T) {
	srv := newTestServerWithFilesAndDocuments(t)
	f := setupChatFixtureOn(t, srv, "chatdoclink")
	path := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.dmRoomID + "/messages/document-link"

	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/documents", f.tokens["a"], map[string]any{
		"title": "Báo cáo tuần", "kind": "page",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create page = %d %v", res.StatusCode, out)
	}
	docID, _ := out["document"].(map[string]any)["id"].(string)

	for _, level := range []string{"manage", "owner"} {
		res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{
			"document_id": docID, "share_level": level, "client_msg_id": "link-http-" + level,
		})
		if res.StatusCode != http.StatusBadRequest {
			t.Fatalf("share_level %s = %d %v, want 400", level, res.StatusCode, out)
		}
	}
	req, _ := http.NewRequest("POST", f.srv.URL+path, strings.NewReader(`{"document_id":`))
	req.Header.Set("Authorization", "Bearer "+f.tokens["a"])
	req.Header.Set("Content-Type", "application/json")
	raw, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, raw.Body)
	_ = raw.Body.Close()
	if raw.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed body = %d, want 400", raw.StatusCode)
	}
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{"document_id": "01J0000000000000000000NONE"})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown document = %d %v, want 404", res.StatusCode, out)
	}

	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{
		"document_id": docID, "client_msg_id": "link-http-1",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send = %d %v", res.StatusCode, out)
	}
	msg, _ := out["message"].(map[string]any)
	block, _ := msg["document"].(map[string]any)
	if msg["kind"] != "document" || block["document_id"] != docID || block["viewer_level"] != "manage" {
		t.Fatalf("message = %v", msg)
	}

	res, out = doJSON(t, f.srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.dmRoomID+"/messages", f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("receiver list = %d %v", res.StatusCode, out)
	}
	var receiverBlock map[string]any
	for _, raw := range out["messages"].([]any) {
		if row := raw.(map[string]any); row["id"] == msg["id"] {
			receiverBlock, _ = row["document"].(map[string]any)
		}
	}
	if receiverBlock == nil || receiverBlock["viewer_level"] != "comment" {
		t.Fatalf("receiver block = %v, want comment (the default level)", receiverBlock)
	}

	// The receiver may read the page but not share it: forbidden.
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["b"], map[string]any{"document_id": docID})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("reader send = %d %v, want 403", res.StatusCode, out)
	}
	// A workspace member outside the DM is refused by the room gate.
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["c"], map[string]any{"document_id": docID})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("non-member send = %d %v, want 403", res.StatusCode, out)
	}
}
