package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"golang.org/x/sync/semaphore"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// unreadBody fails the assertion below if the handler reads a single byte:
// the refusals here must happen on headers alone (C7).
type unreadBody struct{ read bool }

func (b *unreadBody) Read([]byte) (int, error) { b.read = true; return 0, io.EOF }

func TestChatUploadRefusesBeforeReadingTheBody(t *testing.T) {
	f := setupChatFixtureFiles(t, "upearly")
	base := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.groupRoomID + "/messages/"
	cases := []struct {
		name, route, token string
		length             int64
		want               int
	}{
		// d is in the workspace but not in the group room.
		{"file from a non-member", "file", f.tokens["d"], 1 << 20, http.StatusForbidden},
		{"voice from a non-member", "voice", f.tokens["d"], 1 << 20, http.StatusForbidden},
		{"file over the cap by Content-Length", "file", f.tokens["a"], service.MaxChatFileMessageBytes + 1<<20, http.StatusRequestEntityTooLarge},
		{"voice over the cap by Content-Length", "voice", f.tokens["a"], service.MaxChatVoiceMessageBytes + 1<<20, http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := &unreadBody{}
			req := httptest.NewRequest(http.MethodPost, base+tc.route, body)
			req.ContentLength = tc.length
			req.Header.Set("Authorization", "Bearer "+tc.token)
			req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
			rec := httptest.NewRecorder()
			f.srv.Config.Handler.ServeHTTP(rec, req)
			if rec.Code != tc.want || body.read {
				t.Fatalf("status=%d read=%v, want %d and an unread body (%s)", rec.Code, body.read, tc.want, rec.Body.String())
			}
		})
	}
}

// Task and workspace attachments refuse an oversized declared body the same
// way, before r.FormFile would have buffered it.
func TestAttachmentUploadRefusesOversizeBeforeReadingTheBody(t *testing.T) {
	f := setupChatFixtureFiles(t, "upattach")
	for _, path := range []string{
		"/api/v1/tasks/01HZZZZZZZZZZZZZZZZZZZZZZZ/attachments",
		"/api/v1/workspaces/" + f.wsID + "/attachments",
	} {
		body := &unreadBody{}
		req := httptest.NewRequest(http.MethodPost, path, body)
		req.ContentLength = service.MaxAttachmentBytes + 1<<20
		req.Header.Set("Authorization", "Bearer "+f.tokens["a"])
		req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
		rec := httptest.NewRecorder()
		f.srv.Config.Handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge || body.read {
			t.Fatalf("%s: status=%d read=%v, want 413 and an unread body", path, rec.Code, body.read)
		}
	}
}

// The web and desktop clients append the file before client_msg_id,
// duration_ms and reply_to_message_id; those trailing fields must still count.
func TestChatUploadReadsFieldsSentAfterTheFile(t *testing.T) {
	f := setupChatFixtureFiles(t, "uptrail")
	send := func(route string, fields map[string]string, filename string, content []byte) map[string]any {
		t.Helper()
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", filename)
		_, _ = fw.Write(content)
		for k, v := range fields {
			_ = mw.WriteField(k, v)
		}
		_ = mw.Close()
		req, _ := http.NewRequest(http.MethodPost, f.srv.URL+"/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.dmRoomID+"/messages/"+route, &body)
		req.Header.Set("Authorization", "Bearer "+f.tokens["a"])
		req.Header.Set("Content-Type", mw.FormDataContentType())
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s upload = %d %v", route, res.StatusCode, out)
		}
		return chatMessageDTO(t, out)
	}

	first := send("file", map[string]string{"client_msg_id": "trail-file-1"}, "a.pdf", tinyPDF)
	again := send("file", map[string]string{"client_msg_id": "trail-file-1"}, "a.pdf", tinyPDF)
	if first["id"] != again["id"] {
		t.Fatalf("replay under a trailing client_msg_id made a new message: %v vs %v", first["id"], again["id"])
	}
	voice := send("voice", map[string]string{"client_msg_id": "trail-voice-1", "duration_ms": "4200"}, "voice.webm", tinyWebM)
	meta, _ := voice["voice"].(map[string]any)
	if meta == nil || meta["duration_ms"] != float64(4200) {
		t.Fatalf("voice meta = %v, want duration_ms 4200", meta)
	}
}

// The pod-wide budget sheds an upload with 503 + Retry-After instead of
// letting concurrent bodies pile up, and gives the bytes back on release.
func TestBeginUploadShedsPastTheInflightBudget(t *testing.T) {
	sem := semaphore.NewWeighted(100)
	start := func(length int64) (*httptest.ResponseRecorder, func(), bool) {
		req := httptest.NewRequest(http.MethodPost, "/upload", http.NoBody)
		req.ContentLength = length
		rec := httptest.NewRecorder()
		release, ok := beginUpload(rec, req, sem, 80, "too big")
		return rec, release, ok
	}
	_, release, ok := start(60)
	if !ok {
		t.Fatal("first upload refused")
	}
	rec, _, ok := start(60)
	if ok || rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("second upload ok=%v status=%d retry=%q, want 503 with Retry-After", ok, rec.Code, rec.Header().Get("Retry-After"))
	}
	release()
	// A chunked body (no Content-Length) is charged the whole per-route cap.
	_, release, ok = start(-1)
	if !ok {
		t.Fatal("upload refused after release")
	}
	if rec, _, ok := start(30); ok {
		t.Fatalf("chunked upload charged less than its cap: second got %d", rec.Code)
	}
	release()
	if rec, _, ok := start(81); ok || rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over-cap Content-Length ok=%v status=%d, want 413", ok, rec.Code)
	}
}

// net/http removes multipart temp files only for the request it created, and
// the router hands the handler a copy, so the handler must remove them itself.
func TestUploadRemovesItsMultipartTempFiles(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixtureFiles(t, "uptmp")
	// Past uploadFormMemory, so the part spills to a temp file.
	content := append(append([]byte{}, tinyPDF...), bytes.Repeat([]byte(" "), 2*uploadFormMemory)...)
	res, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID, "big.pdf", "application/pdf", "tmp-file-1", content)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d out=%v", res.StatusCode, out)
	}
	left, _ := filepath.Glob(filepath.Join(tmp, "multipart-*"))
	if len(left) != 0 {
		t.Fatalf("multipart temp files left behind: %v", left)
	}
}
