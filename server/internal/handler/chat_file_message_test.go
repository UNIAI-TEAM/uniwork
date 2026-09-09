package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestSniffChatFileContentType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		data []byte
		file string
		want string
		ok   bool
	}{
		{"png", []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, "a.png", "image/png", true},
		{"pdf", []byte("%PDF-1.7\n"), "doc.pdf", "application/pdf", true},
		{"txt", []byte("hello world"), "notes.txt", "text/plain", true},
		{"jpeg", []byte{0xff, 0xd8, 0xff, 0xe0}, "a.jpg", "image/jpeg", true},
		{"gif", []byte("GIF89a........"), "a.gif", "image/gif", true},
		{"pdf by ext", []byte("%PDF-1.4"), "doc.PDF", "application/pdf", true},
		{"reject", []byte{0x00, 0x01, 0x02}, "x.bin", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := sniffChatFileContentType(tc.data, tc.file)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("got (%q, %v), want (%q, %v)", got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestToChatMessageDTOMapsFileWithoutObjectKey(t *testing.T) {
	t.Parallel()
	dto := toChatMessageDTO(service.ChatMessageRow{
		Kind: "file",
		File: &service.FileMessageInfo{
			Filename: "sprint.pdf", ObjectKey: "secret/key",
			ContentType: "application/pdf", SizeBytes: 99,
		},
	})
	if dto.File == nil {
		t.Fatal("file DTO is nil")
	}
	if dto.File.Filename != "sprint.pdf" || dto.File.ContentType != "application/pdf" || dto.File.SizeBytes != 99 {
		t.Fatalf("file DTO = %#v", dto.File)
	}
}

func uploadChatFile(
	t *testing.T,
	srvURL, token, workspaceID, roomID, filename, declaredType, clientMsgID string,
	content []byte,
) (*http.Response, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("client_msg_id", clientMsgID)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {declaredType},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	path := "/api/v1/workspaces/" + workspaceID + "/chat/rooms/" + roomID + "/messages/file"
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

func TestSendAndStreamChatFileMessage(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "filemsg")

	res, out := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"photo.png", "image/png", "file-http-client-1", tinyPNG,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d out=%v", res.StatusCode, out)
	}
	msg, _ := out["message"].(map[string]any)
	if msg == nil || msg["kind"] != "file" {
		t.Fatalf("message = %v", out)
	}
	fileMeta, _ := msg["file"].(map[string]any)
	if fileMeta == nil || fileMeta["filename"] != "photo.png" || fileMeta["object_key"] != nil {
		t.Fatalf("file meta = %v", fileMeta)
	}
	messageID, _ := msg["id"].(string)
	if messageID == "" {
		t.Fatal("missing message id")
	}

	// Idempotent retry with the same client_msg_id.
	res2, out2 := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"photo.png", "image/png", "file-http-client-1", tinyPNG,
	)
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("retry status = %d out=%v", res2.StatusCode, out2)
	}
	msg2, _ := out2["message"].(map[string]any)
	if msg2["id"] != messageID {
		t.Fatalf("retry id = %v want %s", msg2["id"], messageID)
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

	resBad, _ := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"x.bin", "application/octet-stream", "file-http-client-2", []byte{0, 1, 2},
	)
	if resBad.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("unsupported status = %d", resBad.StatusCode)
	}
}
