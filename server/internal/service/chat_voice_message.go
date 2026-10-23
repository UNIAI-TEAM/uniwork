package service

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	MaxChatVoiceMessageBytes = 4 << 20
	maxVoiceDurationMS       = 120_000
)

var storedVoiceContentTypes = map[string]struct{}{
	"audio/webm": {},
	"audio/ogg":  {},
	"audio/mp4":  {},
}

// VoiceMessageInfo is private-object metadata for a stored voice message.
// FileID is the FileService reference on rows written after the migration;
// ObjectKey is used only by the authenticated streaming handler for rows
// written before it.
type VoiceMessageInfo struct {
	DurationMS  int
	FileID      string
	ObjectKey   string
	ContentType string
	SizeBytes   int64
	// Read URL signed for the viewer (signChatMedia); empty when unsigned.
	URL          string
	URLExpiresAt time.Time
}

func validateVoiceDurationMS(durationMS int) error {
	if durationMS < 1 || durationMS > maxVoiceDurationMS {
		return Invalid("duration_ms phải từ 1 đến 120000")
	}
	return nil
}

func validStoredVoiceMetadata(durationMS int, contentType string, sizeBytes int64, clientMsgID string) bool {
	if durationMS < 1 || durationMS > maxVoiceDurationMS {
		return false
	}
	if sizeBytes < 1 || sizeBytes > MaxChatVoiceMessageBytes {
		return false
	}
	if _, ok := storedVoiceContentTypes[strings.ToLower(strings.TrimSpace(contentType))]; !ok {
		return false
	}
	return validateClientMsgID(strings.TrimSpace(clientMsgID)) == nil
}

// publishCreatedChatMessage carries the sender so a client can tell its own
// message from one that is unread for it without fetching it (UNI-1079), and
// a thread reply's root, because the sidebar counts only the main timeline
// (UNI-1693). threadRootID is "" for a main-timeline message.
func (s *ChatService) publishCreatedChatMessage(ctx context.Context, room db.ChatRoom, messageID, senderID, threadRootID string) {
	anchorWS := roomAnchorWorkspaceID(room)
	ev := Event{
		Type:    "chat.message.created",
		Payload: chatMessageFramePayload(room.ID, messageID, senderID, threadRootID),
	}
	if isWorkspaceDefaultRoom(room) {
		s.pub.Publish(ctx, anchorWS, ev)
		return
	}
	s.publishChatRoomEvent(ctx, room.ID, ev)
	s.publishChatRoomActivity(ctx, room.ID)
}

// SendVoiceMessageInput is a voice send on the FileService path. The bytes go
// to FileService, which verifies size and type under the chat_voice policy;
// the service claims the file and writes the message in one transaction.
// DurationMS is the client's measured duration - message metadata FileService
// does not own.
type SendVoiceMessageInput struct {
	DurationMS       int
	Body             io.ReadSeeker
	ReplyToMessageID *string
	ClientMsgID      string
}

// SendVoiceMessage uploads the voice note through FileService and commits
// claim + message in one transaction. A replayed client_msg_id with the same
// file returns the earlier message; a different command under the key is
// idempotency_conflict.
func (s *ChatService) SendVoiceMessage(
	ctx context.Context,
	userID, workspaceID, roomID string,
	in SendVoiceMessageInput,
) (ChatMessageRow, error) {
	in.ClientMsgID = strings.TrimSpace(in.ClientMsgID)
	if err := validateVoiceDurationMS(in.DurationMS); err != nil {
		return ChatMessageRow{}, err
	}
	if in.Body == nil {
		return ChatMessageRow{}, Invalid("tệp thoại là bắt buộc")
	}
	if err := validateClientMsgID(in.ClientMsgID); err != nil {
		return ChatMessageRow{}, err
	}
	return s.sendChatMedia(ctx, userID, workspaceID, roomID, chatMediaCommand{
		purpose:     files.ChatVoice,
		kind:        "voice",
		filename:    "voice-message",
		body:        in.Body,
		durationMS:  in.DurationMS,
		replyToID:   in.ReplyToMessageID,
		clientMsgID: in.ClientMsgID,
	})
}

// OpenChatVoiceMessage authorizes the read and opens the voice bytes through
// FileService. An empty Reader means a pre-migration row whose bytes still
// sit behind the legacy storage object key.
func (s *ChatService) OpenChatVoiceMessage(
	ctx context.Context,
	userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, files.Reader, error) {
	return s.openChatMediaMessage(ctx, userID, workspaceID, roomID, messageID, "voice", "")
}

// voiceMessageFromMetadata reads rows written by either path: a
// post-migration row references the file by file_id, a pre-migration row by
// object_key; both carry duration and the verified type/size snapshot.
func voiceMessageFromMetadata(kind string, raw []byte) *VoiceMessageInfo {
	if kind != "voice" || len(raw) == 0 {
		return nil
	}
	var meta struct {
		DurationMS  int    `json:"duration_ms"`
		FileID      string `json:"file_id"`
		ObjectKey   string `json:"object_key"`
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil
	}
	objectKey := strings.TrimSpace(meta.ObjectKey)
	fileID := strings.TrimSpace(meta.FileID)
	if !validStoredVoiceMetadata(meta.DurationMS, meta.ContentType, meta.SizeBytes, "") ||
		(objectKey == "" && fileID == "") {
		return nil
	}
	return &VoiceMessageInfo{
		DurationMS: meta.DurationMS, FileID: fileID, ObjectKey: objectKey,
		ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}
}
