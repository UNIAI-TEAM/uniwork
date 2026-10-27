package handler

import (
	"context"
	"net/http"
	"net/url"
	"testing"
)

// UNI-2113 (contract A): GET .../documents/sources reads every ?type= value
// like the document lists do. A repeat is OR-ed, page (a list type sources
// cannot hold) adds nothing, a value no list accepts is 400 invalid_request.
func TestDocumentSourcesRepeatedTypeParam(t *testing.T) {
	srv, _ := sourceFrameWorld(t)
	f := setupChatFixtureOn(t, srv, "srcf-type")
	member := f.tokens["b"]

	seed := func(filename, contentType, clientID string) string {
		t.Helper()
		res, out := uploadChatFile(t, srv.URL, f.tokens["a"], f.wsID, f.dmRoomID, filename, contentType, clientID, []byte("x\n"))
		if res.StatusCode != http.StatusOK {
			t.Fatalf("upload chat %s: %d %v", filename, res.StatusCode, out)
		}
		messageID, _ := out["message"].(map[string]any)["id"].(string)
		var fileID string
		if err := testPool.QueryRow(context.Background(),
			`SELECT file_id::text FROM chat_messages WHERE id = $1`, messageID).Scan(&fileID); err != nil {
			t.Fatalf("chat file row(%s): %v", filename, err)
		}
		if _, err := testPool.Exec(context.Background(), `INSERT INTO files
			(id, organization_id, storage, object_key, original_filename, content_type, size_bytes, status, ready_at)
			VALUES ($1, $2, 'local', $3, $4, $5, 2, 'ready', now())`,
			fileID, f.orgID, "chat/"+fileID, filename, contentType); err != nil {
			t.Fatalf("files catalog row(%s): %v", filename, err)
		}
		return "chat:" + messageID
	}
	pdf := seed("spec.pdf", "application/pdf", "type-pdf-1")
	txt := seed("notes.txt", "text/plain", "type-txt-1")
	md := seed("readme.md", "text/markdown", "type-md-1")

	list := func(query string) (int, map[string]bool) {
		t.Helper()
		res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/documents/sources?"+query, member, nil)
		got := map[string]bool{}
		if items, ok := out["items"].([]any); ok {
			for _, raw := range items {
				got[raw.(map[string]any)["id"].(string)] = true
			}
		}
		return res.StatusCode, got
	}
	want := func(query string, ids ...string) {
		t.Helper()
		status, got := list(query)
		if status != http.StatusOK || len(got) != len(ids) {
			t.Fatalf("?%s = %d %v, want %v", query, status, got, ids)
		}
		for _, id := range ids {
			if !got[id] {
				t.Fatalf("?%s = %v, missing %s", query, got, id)
			}
		}
	}

	want("", pdf, txt, md)
	want("type=pdf", pdf)
	want("type=txt", txt)
	want(url.Values{"type": {"pdf", "txt"}}.Encode(), pdf, txt)
	want("type=%20md%20&type=md&type=pdf", pdf, md)
	want("type=page&type=pdf", pdf)
	want("type=page")
	for _, bad := range []string{"type=pdf&type=bogus", "type=", "type=pdf&type=", "type=image", "type=PDF"} {
		res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/documents/sources?"+bad, member, nil)
		wantErr(t, res, out, http.StatusBadRequest, "invalid_type", "")
	}
}
