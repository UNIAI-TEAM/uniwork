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
