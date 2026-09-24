package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// Bước 0 regression for UNI-745 (chat file + voice messages, plan §6.1).
//
// Every case here describes what develop does today, on the legacy handler
// path, so the same spec stays meaningful after T7 moves the uploads onto the
// shared FileService. Cases whose names carry "PinsForFileServiceMigration"
// assert behavior that migration deliberately changes (the 25 MiB/4 MiB caps
// and the MIME allowlists become purpose policy) and are expected to be edited
// by the migration PR, not deleted.

// tinyWebM is the smallest payload the voice sniffer accepts: EBML magic.
var tinyWebM = []byte{0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x00, 0x00, 0x00, 0x00}

// tinyPDF is enough for the %PDF- magic the file sniffer accepts.
var tinyPDF = []byte("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n")

func uploadChatVoice(
	t *testing.T,
	srvURL, token, workspaceID, roomID string,
	durationMS int,
	clientMsgID string,
	content []byte,
) (*http.Response, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("duration_ms", strconv.Itoa(durationMS))
	_ = mw.WriteField("client_msg_id", clientMsgID)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="voice.webm"`},
		"Content-Type":        {"audio/webm"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	path := "/api/v1/workspaces/" + workspaceID + "/chat/rooms/" + roomID + "/messages/voice"
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

func getChatAttachment(t *testing.T, srv *httptest.Server, path, token string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", srv.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	return res, raw
}

func fileStreamPath(wsID, roomID, messageID string) string {
	return "/api/v1/workspaces/" + wsID + "/chat/rooms/" + roomID + "/messages/" + messageID + "/file"
}

func voiceStreamPath(wsID, roomID, messageID string) string {
	return "/api/v1/workspaces/" + wsID + "/chat/rooms/" + roomID + "/messages/" + messageID + "/voice"
}

func uploadPath(wsID, roomID, kind string) string {
	return "/api/v1/workspaces/" + wsID + "/chat/rooms/" + roomID + "/messages/" + kind
}

// registerOtherOrgUser creates a second organization with its own workspace
// and returns its owner token plus the ids an attacker would have to guess.
// The two-organization case is the isolation contract every FileService
// consumer must keep (plan §6.1).
func registerOtherOrgUser(t *testing.T, srv *httptest.Server, tag string) (token, orgID, wsID string) {
	t.Helper()
	token, _ = registerChatUser(t, srv, "other-org-"+tag+"@example.com", "Other Org")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "Other Org " + tag, "slug": "other-org-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("other org: %d %v", res.StatusCode, out)
	}
	orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "Other WS " + tag, "slug": "other-ws-" + tag,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("other ws: %d %v", res.StatusCode, out)
	}
	wsID = out["workspace"].(map[string]any)["id"].(string)
	return token, orgID, wsID
}

// The second member of a room sees the attachment in the room timeline and
// downloads exactly the bytes the sender uploaded.
func TestChatFileMessageSecondMemberSeesAndDownloads(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "fileshare")

	res, out := uploadChatFile(
		t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"ke-hoach.pdf", "application/pdf", "share-file-1", tinyPDF,
	)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d out=%v", res.StatusCode, out)
	}
	sent := out["message"].(map[string]any)
	meta := sent["file"].(map[string]any)
	if meta["filename"] != "ke-hoach.pdf" || meta["content_type"] != "application/pdf" {
		t.Fatalf("file meta = %v", meta)
	}
	if got := int64(meta["size_bytes"].(float64)); got != int64(len(tinyPDF)) {
		t.Fatalf("size_bytes = %d want %d", got, len(tinyPDF))
	}
	if _, leaked := meta["object_key"]; leaked {
		t.Fatalf("object_key leaked to the client: %v", meta)
	}
	messageID := sent["id"].(string)

	// Second member lists the room and sees the same attachment.
	res, out = doJSON(t, f.srv, "GET", roomMessagesPath(f, f.groupRoomID), f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list as second member: %d %v", res.StatusCode, out)
	}
	found := false
	for _, raw := range out["messages"].([]any) {
		msg := raw.(map[string]any)
		if msg["id"] != messageID {
			continue
		}
		found = true
		fileMeta, _ := msg["file"].(map[string]any)
		if fileMeta == nil || fileMeta["filename"] != "ke-hoach.pdf" {
			t.Fatalf("second member file meta = %v", msg)
		}
	}
	if !found {
		t.Fatalf("second member did not see the file message: %v", out)
	}

	// And downloads the exact bytes through the authorized proxy route.
	stream, raw := getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.groupRoomID, messageID), f.tokens["b"])
	if stream.StatusCode != http.StatusOK {
		t.Fatalf("download status = %d", stream.StatusCode)
	}
	if !bytes.Equal(raw, tinyPDF) {
		t.Fatalf("downloaded %d bytes, want %d", len(raw), len(tinyPDF))
	}
	if got := stream.Header.Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("download content type = %q", got)
	}
	if got := stream.Header.Get("Content-Disposition"); got != `attachment; filename="ke-hoach.pdf"` {
		t.Fatalf("download disposition = %q", got)
	}
}

func TestChatFileMessageIdempotentResendKeepsOneMessage(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "fileidem")

	_, first := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"anh.png", "image/png", "idem-file-1", tinyPNG)
	firstID := first["message"].(map[string]any)["id"].(string)

	// A lost response is retried with the same client_msg_id; the payload is
	// the same file. It must not create a second message.
	res, second := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"anh.png", "image/png", "idem-file-1", tinyPNG)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("retry status = %d out=%v", res.StatusCode, second)
	}
	if got := second["message"].(map[string]any)["id"]; got != firstID {
		t.Fatalf("retry created a second message: %v want %s", got, firstID)
	}

	// Even a different payload under the same id returns the earlier message
	// today (no conflict). T7 replaces this with idempotency_conflict.
	res, third := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"khac.png", "image/png", "idem-file-1", tinyPNG)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("different payload under the same id should return the earlier message today: %d %v", res.StatusCode, third)
	}
	if got := third["message"].(map[string]any)["id"]; got != firstID {
		t.Fatalf("different payload under the same id created a new message: %v want %s", got, firstID)
	}

	res, out := doJSON(t, f.srv, "GET", roomMessagesPath(f, f.groupRoomID), f.tokens["a"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	fileMessages := 0
	for _, raw := range out["messages"].([]any) {
		if raw.(map[string]any)["kind"] == "file" {
			fileMessages++
		}
	}
	if fileMessages != 1 {
		t.Fatalf("file messages = %d, want 1", fileMessages)
	}

	// An image attachment streams inline; anything else is an attachment.
	stream, raw := getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.groupRoomID, firstID), f.tokens["b"])
	if stream.StatusCode != http.StatusOK || !bytes.Equal(raw, tinyPNG) {
		t.Fatalf("image download = %d, bytes=%d", stream.StatusCode, len(raw))
	}
	if got := stream.Header.Get("Content-Disposition"); got != `inline; filename="anh.png"` {
		t.Fatalf("image disposition = %q", got)
	}
	if got := stream.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("image cache control = %q", got)
	}
}

// The 25 MiB cap and the MIME allowlist are pinned for the FileService
// migration (the plan unifies the caps and moves the allowlist into the
// purpose policy).
func TestChatFileMessageSizeAndTypeRejectionPinsForFileServiceMigration(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "filebad")

	if service.MaxChatFileMessageBytes != 25<<20 {
		t.Fatalf("MaxChatFileMessageBytes = %d, want 25 MiB", service.MaxChatFileMessageBytes)
	}

	// Type is sniffed from the bytes: a ZIP is rejected however it is named.
	res, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"tai-lieu.zip", "application/zip", "bad-type-1", []byte("PK\x03\x04...."))
	if res.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("zip status = %d out=%v", res.StatusCode, out)
	}

	// The declared multipart type does not win over the content: PNG bytes
	// sent as text/plain are still stored as image/png.
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"anh.txt", "text/plain", "sniff-1", tinyPNG)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("declared-type mismatch status = %d out=%v", res.StatusCode, out)
	}
	meta := out["message"].(map[string]any)["file"].(map[string]any)
	if meta["content_type"] != "image/png" {
		t.Fatalf("content_type = %v, want image/png (content wins)", meta["content_type"])
	}

	// One byte over the cap is refused before anything is stored.
	oversize := bytes.Repeat([]byte{0x00}, service.MaxChatFileMessageBytes+1)
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"to.bin", "application/octet-stream", "too-big-1", oversize)
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize status = %d out=%v", res.StatusCode, out)
	}
}

func TestChatVoiceMessageSecondMemberPlaysWithDurationMetadata(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "voiceshare")

	res, out := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID, 12_500, "voice-share-1", tinyWebM)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice upload status = %d out=%v", res.StatusCode, out)
	}
	sent := out["message"].(map[string]any)
	if sent["kind"] != "voice" {
		t.Fatalf("kind = %v", sent["kind"])
	}
	voice := sent["voice"].(map[string]any)
	if voice["duration_ms"].(float64) != 12_500 {
		t.Fatalf("duration_ms = %v want 12500", voice["duration_ms"])
	}
	if voice["content_type"] != "audio/webm" || int64(voice["size_bytes"].(float64)) != int64(len(tinyWebM)) {
		t.Fatalf("voice meta = %v", voice)
	}
	messageID := sent["id"].(string)

	// The peer sees the same duration metadata in the room timeline.
	res, out = doJSON(t, f.srv, "GET", roomMessagesPath(f, f.groupRoomID), f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list as peer: %d %v", res.StatusCode, out)
	}
	found := false
	for _, raw := range out["messages"].([]any) {
		msg := raw.(map[string]any)
		if msg["id"] != messageID {
			continue
		}
		found = true
		peerVoice, _ := msg["voice"].(map[string]any)
		if peerVoice == nil || peerVoice["duration_ms"].(float64) != 12_500 {
			t.Fatalf("peer voice meta = %v", msg)
		}
	}
	if !found {
		t.Fatalf("peer did not see the voice message: %v", out)
	}

	// Playback streams the same bytes inline.
	stream, raw := getChatAttachment(t, f.srv, voiceStreamPath(f.wsID, f.groupRoomID, messageID), f.tokens["b"])
	if stream.StatusCode != http.StatusOK {
		t.Fatalf("playback status = %d", stream.StatusCode)
	}
	if !bytes.Equal(raw, tinyWebM) {
		t.Fatalf("streamed %d bytes, want %d", len(raw), len(tinyWebM))
	}
	if got := stream.Header.Get("Content-Type"); got != "audio/webm" {
		t.Fatalf("playback content type = %q", got)
	}
	if got := stream.Header.Get("Content-Disposition"); got != "inline" {
		t.Fatalf("playback disposition = %q", got)
	}
	if got := stream.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("playback cache control = %q", got)
	}

	// A retried voice upload with the same client_msg_id is one message.
	res, retry := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID, 12_500, "voice-share-1", tinyWebM)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice retry status = %d out=%v", res.StatusCode, retry)
	}
	if got := retry["message"].(map[string]any)["id"]; got != messageID {
		t.Fatalf("voice retry created a second message: %v want %s", got, messageID)
	}
}

func TestChatVoiceMessageRejectsBadDurationSizeAndTypePinsForFileServiceMigration(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "voicebad")

	if service.MaxChatVoiceMessageBytes != 4<<20 {
		t.Fatalf("MaxChatVoiceMessageBytes = %d, want 4 MiB", service.MaxChatVoiceMessageBytes)
	}

	cases := []struct {
		name       string
		durationMS int
		content    []byte
		want       int
	}{
		{"zero duration", 0, tinyWebM, http.StatusBadRequest},
		{"duration over 120s", 120_001, tinyWebM, http.StatusBadRequest},
		{"not audio", 5_000, []byte("khong-phai-am-thanh"), http.StatusUnsupportedMediaType},
		{"over 4 MiB", 5_000, append(append([]byte{}, tinyWebM...), bytes.Repeat([]byte{0x00}, service.MaxChatVoiceMessageBytes)...), http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, out := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID, tc.durationMS, "", tc.content)
			if res.StatusCode != tc.want {
				t.Fatalf("status = %d want %d out=%v", res.StatusCode, tc.want, out)
			}
		})
	}

	// duration_ms is required, not defaulted.
	res, out := uploadChatVoiceWithoutDuration(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing duration_ms = %d %v", res.StatusCode, out)
	}
}

// A workspace member who is not in the room cannot download the attachment,
// and losing room membership closes the download immediately.
func TestChatFileMessageOutsideRoomCannotDownload(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "fileacl")

	_, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"noi-bo.pdf", "application/pdf", "acl-file-1", tinyPDF)
	fileID := out["message"].(map[string]any)["id"].(string)
	_, voiceOut := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID, 3_000, "acl-voice-1", tinyWebM)
	voiceID := voiceOut["message"].(map[string]any)["id"].(string)

	// d is in the workspace but was never added to the group room.
	res, raw := getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.groupRoomID, fileID), f.tokens["d"])
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("non-room-member file download = %d (%s)", res.StatusCode, raw)
	}
	res, raw = getChatAttachment(t, f.srv, voiceStreamPath(f.wsID, f.groupRoomID, voiceID), f.tokens["d"])
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("non-room-member voice download = %d (%s)", res.StatusCode, raw)
	}
	res, out2 := doJSON(t, f.srv, "GET", roomMessagesPath(f, f.groupRoomID)+"/"+fileID, f.tokens["d"], nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("non-room-member message read = %d %v", res.StatusCode, out2)
	}
	res, out2 = uploadChatFile(t, f.srv.URL, f.tokens["d"], f.wsID, f.groupRoomID,
		"x.pdf", "application/pdf", "acl-file-2", tinyPDF)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("non-room-member upload = %d %v", res.StatusCode, out2)
	}

	// c is a member and can download; after leaving the room the same URL is
	// closed again.
	stream, got := getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.groupRoomID, fileID), f.tokens["c"])
	if stream.StatusCode != http.StatusOK || !bytes.Equal(got, tinyPDF) {
		t.Fatalf("member download = %d, bytes=%d", stream.StatusCode, len(got))
	}
	res, out2 = doJSON(t, f.srv, "POST",
		"/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID+"/leave", f.tokens["c"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("leave room: %d %v", res.StatusCode, out2)
	}
	res, raw = getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.groupRoomID, fileID), f.tokens["c"])
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("former-member download = %d (%s)", res.StatusCode, raw)
	}
}

// The two-organization case from plan §6.1: a member of another organization
// who guesses the workspace, room and message ids still cannot list the room,
// download the attachment or upload into it.
func TestChatFileMessageCrossOrganizationGuessedIDsBlocked(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "fileorg")

	_, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"bi-mat.pdf", "application/pdf", "org-file-1", tinyPDF)
	fileID := out["message"].(map[string]any)["id"].(string)

	otherToken, otherOrgID, otherWSID := registerOtherOrgUser(t, f.srv, "fileorg")
	if otherOrgID == f.orgID || otherWSID == f.wsID {
		t.Fatal("fixture did not create a second organization")
	}

	// Guessed ids from the other organization must never answer 200.
	for _, tc := range []struct {
		name string
		path string
	}{
		{"download file", fileStreamPath(f.wsID, f.groupRoomID, fileID)},
		{"list room messages", roomMessagesPath(f, f.groupRoomID)},
		{"read message", roomMessagesPath(f, f.groupRoomID) + "/" + fileID},
		{"list rooms", "/api/v1/workspaces/" + f.wsID + "/chat/rooms"},
	} {
		res, raw := getChatAttachment(t, f.srv, tc.path, otherToken)
		if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s as other-org member = %d (%s)", tc.name, res.StatusCode, raw)
		}
	}

	res, out2 := uploadChatFile(t, f.srv.URL, otherToken, f.wsID, f.groupRoomID,
		"xam-nhap.pdf", "application/pdf", "org-file-2", tinyPDF)
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("other-org upload = %d %v", res.StatusCode, out2)
	}
	if _, poisoned := out2["message"]; poisoned {
		t.Fatalf("other-org upload returned a message: %v", out2)
	}
}

// DM block and per-member send permission both gate the file/voice upload.
func TestChatFileAndVoiceUploadRespectsDMBlockAndSendRestriction(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "filemod")

	// A sends into the DM before the block.
	res, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"truoc-khi-chan.pdf", "application/pdf", "dm-block-1", tinyPDF)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pre-block upload = %d %v", res.StatusCode, out)
	}

	// B blocks A: both directions stop, so A's file and voice uploads fail.
	res, out = doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/users/"+f.ids["a"]+"/block", f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("block: %d %v", res.StatusCode, out)
	}
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"sau-khi-chan.pdf", "application/pdf", "dm-block-2", tinyPDF)
	if res.StatusCode != http.StatusForbidden || out["code"] != "chat_user_blocked" {
		t.Fatalf("blocked file upload = %d %v", res.StatusCode, out)
	}
	res, out = uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID, 4_000, "dm-block-3", tinyWebM)
	if res.StatusCode != http.StatusForbidden || out["code"] != "chat_user_blocked" {
		t.Fatalf("blocked voice upload = %d %v", res.StatusCode, out)
	}

	// Unblocking restores the DM upload path.
	res, out = doJSON(t, f.srv, "DELETE", "/api/v1/workspaces/"+f.wsID+"/chat/users/"+f.ids["a"]+"/block", f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unblock: %d %v", res.StatusCode, out)
	}
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"sau-khi-bo-chan.pdf", "application/pdf", "dm-block-4", tinyPDF)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("post-unblock upload = %d %v", res.StatusCode, out)
	}

	// A restricts C in the group room; C can still read but not upload.
	restricted := true
	res, out = doJSON(t, f.srv, "PATCH",
		"/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID+"/members/"+f.ids["c"],
		f.tokens["a"], map[string]any{"send_restricted": &restricted})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("restrict member: %d %v", res.StatusCode, out)
	}
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["c"], f.wsID, f.groupRoomID,
		"bi-han-che.pdf", "application/pdf", "restricted-1", tinyPDF)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("restricted file upload = %d %v", res.StatusCode, out)
	}
	res, out = uploadChatVoice(t, f.srv.URL, f.tokens["c"], f.wsID, f.groupRoomID, 2_000, "restricted-2", tinyWebM)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("restricted voice upload = %d %v", res.StatusCode, out)
	}
	res, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"van-gui-duoc.pdf", "application/pdf", "restricted-3", tinyPDF)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("owner upload after restriction = %d %v", res.StatusCode, out)
	}
}

// listStoredObjects returns the object keys below the local upload dir,
// ignoring the .meta.json sidecars the local backend writes next to them.
func listStoredObjects(t *testing.T, dir string) []string {
	t.Helper()
	var keys []string
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if !strings.HasSuffix(rel, ".meta.json") {
			keys = append(keys, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk upload dir: %v", err)
	}
	sort.Strings(keys)
	return keys
}

// The object key layout and the fact that a deleted message keeps its bytes
// are pinned for the FileService migration: T7 stores files/<purpose>/<org>/â€¦
// and hands the bytes to the service, and message delete becomes a release
// that only GC acts on.
func TestChatFileMessageStorageKeyAndDeletePinsForFileServiceMigration(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixture(t, "filestore")

	_, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"luu-tru.pdf", "application/pdf", "store-1", tinyPDF)
	messageID := out["message"].(map[string]any)["id"].(string)

	objects := listStoredObjects(t, dir)
	if len(objects) != 1 {
		t.Fatalf("objects after upload = %v, want exactly one", objects)
	}
	wantPrefix := "chat/files/" + f.orgID + "/" + f.groupRoomID + "/"
	if !strings.HasPrefix(objects[0], wantPrefix) || !strings.HasSuffix(objects[0], ".pdf") {
		t.Fatalf("file object key = %q, want %s<ulid>.pdf", objects[0], wantPrefix)
	}

	// The retry uploads its own copy first and deletes it after the insert
	// reports the earlier message: the room still holds one object.
	res, retry := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID,
		"luu-tru.pdf", "application/pdf", "store-1", tinyPDF)
	if res.StatusCode != http.StatusOK || retry["message"].(map[string]any)["id"] != messageID {
		t.Fatalf("retry = %d %v", res.StatusCode, retry)
	}
	if objects := listStoredObjects(t, dir); len(objects) != 1 {
		t.Fatalf("objects after retry = %v, want the retry copy removed", objects)
	}

	_, voiceOut := uploadChatVoice(t, f.srv.URL, f.tokens["a"], f.wsID, f.groupRoomID, 2_000, "store-2", tinyWebM)
	voiceID := voiceOut["message"].(map[string]any)["id"].(string)
	voicePrefix := "chat/voice/" + f.orgID + "/" + f.groupRoomID + "/"
	voiceObjects := 0
	for _, key := range listStoredObjects(t, dir) {
		if strings.HasPrefix(key, voicePrefix) && strings.HasSuffix(key, ".webm") {
			voiceObjects++
		}
	}
	if voiceObjects != 1 {
		t.Fatalf("voice objects = %d, want 1 under %s", voiceObjects, voicePrefix)
	}

	// Deleting the message soft-deletes the row and leaves the bytes in
	// place â€” today nothing removes the object (pinned; reported as a
	// finding for the migration to decide on).
	res, out = doJSON(t, f.srv, "DELETE", roomMessagesPath(f, f.groupRoomID)+"/"+messageID, f.tokens["a"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete message = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "GET", roomMessagesPath(f, f.groupRoomID)+"/"+messageID, f.tokens["a"], nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted message read = %d %v", res.StatusCode, out)
	}
	if objects := listStoredObjects(t, dir); len(objects) != 2 {
		t.Fatalf("objects after message delete = %v, want both bytes kept", objects)
	}
	_ = voiceID
}

// uploadChatVoiceWithoutDuration omits the duration_ms field entirely: the
// handler must reject the request rather than default it.
func uploadChatVoiceWithoutDuration(t *testing.T, srvURL, token, workspaceID, roomID string) (*http.Response, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="voice.webm"`},
		"Content-Type":        {"audio/webm"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(tinyWebM)
	_ = mw.Close()
	path := "/api/v1/workspaces/" + workspaceID + "/chat/rooms/" + roomID + "/messages/voice"
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
