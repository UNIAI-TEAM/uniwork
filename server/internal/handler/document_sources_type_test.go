package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// UNI-2288: wire JSON contract for DocumentSourceDTO (kind, document_id) and
// DocumentMinutesMeetingDTO (minutes_meeting with title omitted when blank).
func TestDocumentMinutesMeetingAndSourceDTOWireShape(t *testing.T) {
	fileDTO := documentSourceDTO(service.DocumentSourceItem{
		ID: "chat:01MSG", Source: "chat", Name: "spec.pdf", MimeType: "application/pdf", Extension: "pdf", SizeBytes: 42,
	})
	var fileJSON map[string]any
	raw, err := json.Marshal(fileDTO)
	if err != nil || json.Unmarshal(raw, &fileJSON) != nil {
		t.Fatalf("marshal fileDTO: %v", err)
	}
	if fileJSON["kind"] != "file" {
		t.Fatalf("file kind = %v, want file", fileJSON["kind"])
	}
	if _, has := fileJSON["document_id"]; has {
		t.Fatalf("file DTO unexpectedly serialized document_id: %v", fileJSON)
	}

	pageDTO := documentSourceDTO(service.DocumentSourceItem{
		ID: "meeting:minutes:01MTG", Source: "meeting", Kind: "page", DocumentID: "01DOC",
		Parent: service.DocumentSourceParent{Kind: "meeting", ID: "01MTG", Title: "Giao ban"},
		Name:   "Giao ban",
	})
	var pageJSON map[string]any
	raw, err = json.Marshal(pageDTO)
	if err != nil || json.Unmarshal(raw, &pageJSON) != nil {
		t.Fatalf("marshal pageDTO: %v", err)
	}
	if pageJSON["kind"] != "page" || pageJSON["document_id"] != "01DOC" || pageJSON["name"] != "Giao ban" ||
		pageJSON["mime_type"] != "" || pageJSON["extension"] != "" || pageJSON["size_bytes"] != float64(0) ||
		pageJSON["can_open_in_app"] != false || pageJSON["can_save"] != false {
		t.Fatalf("page DTO JSON = %v", pageJSON)
	}

	// minutes_meeting omitted when nil; includes id+title for a workspace member; omits title when blank.
	plainSummary := documentSummaryDTO(db.Document{ID: "01DOC", Kind: "page"}, service.DocumentListFacts{}, "", nil)
	var plainMap map[string]any
	raw, _ = json.Marshal(plainSummary)
	_ = json.Unmarshal(raw, &plainMap)
	if _, has := plainMap["minutes_meeting"]; has {
		t.Fatalf("non-minutes summary serialized minutes_meeting: %v", plainMap)
	}

	memberDoc := documentDTO(service.DocumentView{
		Document:       db.Document{ID: "01DOC", Kind: "page"},
		MinutesMeeting: &service.DocumentMinutesMeeting{ID: "01MTG", Title: "Giao ban"},
	})
	var memberMap map[string]any
	raw, _ = json.Marshal(memberDoc)
	_ = json.Unmarshal(raw, &memberMap)
	mm, _ := memberMap["minutes_meeting"].(map[string]any)
	if mm["id"] != "01MTG" || mm["title"] != "Giao ban" {
		t.Fatalf("member minutes_meeting = %v", mm)
	}

	crossTree := documentTreeDTOs([]service.DocumentTreeNode{{
		ID: "01DOC", Kind: "page",
		MinutesMeeting: &service.DocumentMinutesMeeting{ID: "01MTG", Title: ""},
	}})
	var treeMap []map[string]any
	raw, _ = json.Marshal(crossTree)
	_ = json.Unmarshal(raw, &treeMap)
	treeMM, _ := treeMap[0]["minutes_meeting"].(map[string]any)
	if treeMM["id"] != "01MTG" {
		t.Fatalf("tree minutes_meeting = %v", treeMM)
	}
	if _, hasTitle := treeMM["title"]; hasTitle {
		t.Fatalf("blank title must be omitted from minutes_meeting JSON: %v", treeMM)
	}
}
