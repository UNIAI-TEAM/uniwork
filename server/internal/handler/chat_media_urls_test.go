package handler

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// UNI-1633: chat file and voice bytes are read straight from storage. Every
// answer that hands a member a file or voice message carries the signed URLs
// (the in-memory FileService signs fake://presign/<id>), the stream routes are
// gone, and a room outsider never gets a message to take a URL from.
func TestChatMediaMessagesCarrySignedURLsFS(t *testing.T) {
	f := setupChatFixtureFiles(t, "fsurls")

	_, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"anh.png", "image/png", "urls-photo-1", tinyPNG)
	photoID := chatMessageDTO(t, out)["id"].(string)
	_, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.pdf", "application/pdf", "urls-doc-1", tinyPDF)
	docID := chatMessageDTO(t, out)["id"].(string)
	_, out = uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID, 4_000, "urls-voice-1", tinyWebM)
	voiceID := chatMessageDTO(t, out)["id"].(string)

	res, out := doJSON(t, f.srv, "GET", roomMessagesPath(f, f.dmRoomID), f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list as peer: %d %v", res.StatusCode, out)
	}
	byID := map[string]map[string]any{}
	for _, raw := range out["messages"].([]any) {
		msg := raw.(map[string]any)
		byID[msg["id"].(string)] = msg
	}
	for _, id := range []string{photoID, docID} {
		meta, _ := byID[id]["file"].(map[string]any)
		for _, key := range []string{"url", "download_url", "thumb_url"} {
			if v, _ := meta[key].(string); !strings.HasPrefix(v, "fake://presign/") {
				t.Fatalf("message %s file.%s = %v", id, key, meta)
			}
		}
		assertURLExpiry(t, meta)
	}
	voice, _ := byID[voiceID]["voice"].(map[string]any)
	if v, _ := voice["url"].(string); !strings.HasPrefix(v, "fake://presign/") {
		t.Fatalf("voice url = %v", voice)
	}
	assertURLExpiry(t, voice)

	// A single read, a reaction and a pin answer with the whole message; each
	// keeps its URLs so the client cache never loses them.
	base := roomMessagesPath(f, f.dmRoomID) + "/" + photoID
	for _, call := range []struct {
		method, path string
		body         any
	}{
		{"GET", base, nil},
		{"POST", base + "/reactions", map[string]string{"emoji": "👍"}},
		{"POST", base + "/pin", nil},
	} {
		res, out := doJSON(t, f.srv, call.method, call.path, f.tokens["b"], call.body)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s %s = %d %v", call.method, call.path, res.StatusCode, out)
		}
		meta, _ := chatMessageDTO(t, out)["file"].(map[string]any)
		if v, _ := meta["url"].(string); !strings.HasPrefix(v, "fake://presign/") {
			t.Fatalf("%s %s file = %v", call.method, call.path, meta)
		}
	}

	// The byte routes no longer exist.
	for _, suffix := range []string{"/file", "/file?variant=thumb"} {
		res, _ := getChatAttachment(t, f.srv, roomMessagesPath(f, f.dmRoomID)+"/"+photoID+suffix, f.tokens["b"])
		if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMethodNotAllowed {
			t.Fatalf("stream route %s still answers %d", suffix, res.StatusCode)
		}
	}
	res, _ = getChatAttachment(t, f.srv, roomMessagesPath(f, f.dmRoomID)+"/"+voiceID+"/voice", f.tokens["b"])
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("voice stream route still answers %d", res.StatusCode)
	}

	// c is in the workspace but not in the DM: no list, no message, no URL.
	for _, path := range []string{roomMessagesPath(f, f.dmRoomID), base} {
		res, out := doJSON(t, f.srv, "GET", path, f.tokens["c"], nil)
		if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
			t.Fatalf("outsider %s = %d %v", path, res.StatusCode, out)
		}
		if strings.Contains(fmt.Sprint(out), "fake://presign/") {
			t.Fatalf("outsider %s got a signed URL: %v", path, out)
		}
	}
}

func assertURLExpiry(t *testing.T, meta map[string]any) {
	t.Helper()
	raw, _ := meta["url_expires_at"].(string)
	at, err := time.Parse(time.RFC3339, raw)
	if err != nil || !at.After(time.Now()) {
		t.Fatalf("url_expires_at = %q (%v), want a future RFC3339 instant", raw, err)
	}
}
