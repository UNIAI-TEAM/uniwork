package handler

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// FileService-path handler coverage (UNI-745, Advisor ruling "selectable
// path"): these tests wire filesfake into ChatService, so the endpoints run
// the FS send/open flow while every other handler test keeps the legacy
// storage pipeline.

// newTestServerWithFiles builds the full handler with the in-memory
// FileService attached to chat - the wiring an integrator flips at cutover.
func newTestServerWithFiles(t *testing.T) *httptest.Server {
	t.Helper()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Chat.SetFiles(filesfake.New(filesfake.Options{}))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

func setupChatFixtureFiles(t *testing.T, tag string) *chatFixture {
	t.Helper()
	return setupChatFixtureOn(t, newTestServerWithFiles(t), tag)
}

func TestSendAndStreamChatFileMessageFS(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixtureFiles(t, "fsfile")

	res, out := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"photo.png", "image/png", "fs-file-client-1", tinyPNG,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d out=%v", res.StatusCode, out)
	}
	msg, _ := out["message"].(map[string]any)
	if msg == nil || msg["kind"] != "file" {
		t.Fatalf("message = %v", out)
	}
	fileMeta, _ := msg["file"].(map[string]any)
	if fileMeta == nil || fileMeta["filename"] != "photo.png" {
		t.Fatalf("file meta = %v", fileMeta)
	}
	// The DTO never leaks the storage locator or the file reference.
	if fileMeta["object_key"] != nil || fileMeta["file_id"] != nil {
		t.Fatalf("file meta leaks internals = %v", fileMeta)
	}
	messageID, _ := msg["id"].(string)
	if messageID == "" {
		t.Fatal("missing message id")
	}

	// Idempotent retry with the same client_msg_id replays the message.
	res2, out2 := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"photo.png", "image/png", "fs-file-client-1", tinyPNG,
	)
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("retry status = %d out=%v", res2.StatusCode, out2)
	}
	msg2, _ := out2["message"].(map[string]any)
	if msg2["id"] != messageID {
		t.Fatalf("retry id = %v want %s", msg2["id"], messageID)
	}

	// A different payload under the same key is a different command:
	// idempotency_conflict (409) instead of a silent replay.
	res3, out3 := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"khac.png", "image/png", "fs-file-client-1", tinyPNG,
	)
	if res3.StatusCode != http.StatusConflict || errorCodeOf(out3) != "idempotency_conflict" {
		t.Fatalf("conflicting reuse = %d %v, want 409 idempotency_conflict", res3.StatusCode, out3)
	}

	streamPath := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.dmRoomID + "/messages/" + messageID + "/file"
	req, _ := http.NewRequest("GET", f.srv.URL+streamPath, nil)
	req.Header.Set("Authorization", "Bearer "+f.tokens["a"])
	stream, err := f.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d", stream.StatusCode)
	}
	got, _ := io.ReadAll(stream.Body)
	if !bytes.Equal(got, tinyPNG) {
		t.Fatalf("stream bytes = %d want %d", len(got), len(tinyPNG))
	}
	if cd := stream.Header.Get("Content-Disposition"); cd == "" {
		t.Fatal("stream lost the content disposition")
	}

	resBad, _ := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"x.bin", "application/octet-stream", "fs-file-client-2", []byte{0, 1, 2},
	)
	if resBad.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("unsupported status = %d", resBad.StatusCode)
	}
}

// On the FS path nothing reaches the module storage backend: bytes belong to
// FileService, so LOCAL_UPLOAD_DIR stays empty even after a send + retry.
func TestChatFileMessageFSLeavesLocalStorageEmpty(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixtureFiles(t, "fsemp")

	res, out := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.pdf", "application/pdf", "fs-keep-1", tinyPDF,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d out=%v", res.StatusCode, out)
	}
	if objects := listStoredObjects(t, dir); len(objects) != 0 {
		t.Fatalf("objects after FS upload = %v, want none (FileService owns chat bytes)", objects)
	}
}

// Voice upload + DTO on the FS path: the shared content detector (t1c,
// UNI-739) sniffs the EBML magic and maps it to audio/webm via the
// chat_voice canonical types, so a real voice note is accepted.
func TestSendChatVoiceMessageFS(t *testing.T) {
	f := setupChatFixtureFiles(t, "fsvoice")

	res, out := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID, 4_000, "fs-voice-1", tinyWebM)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice upload = %d %v", res.StatusCode, out)
	}
	msg := chatMessageDTO(t, out)
	if msg["kind"] != "voice" {
		t.Fatalf("message = %v", out)
	}
	voiceMeta, _ := msg["voice"].(map[string]any)
	if voiceMeta["object_key"] != nil || voiceMeta["file_id"] != nil {
		t.Fatalf("voice meta leaks internals = %v", voiceMeta)
	}
}
