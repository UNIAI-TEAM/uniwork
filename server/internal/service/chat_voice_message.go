package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	MaxChatVoiceMessageBytes = 4 << 20
	maxVoiceDurationMS       = 120_000
)

var supportedVoiceContentTypes = map[string]struct{}{
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
}

type PrepareVoiceMessageInput struct {
	DurationMS       int
	ContentType      string
	SizeBytes        int64
	ReplyToMessageID *string
	ClientMsgID      string
}

// VoiceMessagePreparation carries authorization and validation from the
// multipart preflight to the insert, without exposing a storage URL.
type VoiceMessagePreparation struct {
	OrganizationID string
	Existing       *ChatMessageRow
	room           db.ChatRoom
	actorID        string
	senderName     string
	replyTo        pgtype.Text
	clientMsg      pgtype.Text
	input          PrepareVoiceMessageInput
}

func validateVoiceDurationMS(durationMS int) error {
	if durationMS < 1 || durationMS > maxVoiceDurationMS {
		return Invalid("duration_ms phải từ 1 đến 120000")
	}
	return nil
}

func validateVoiceMessageInput(in PrepareVoiceMessageInput) error {
	if err := validateVoiceDurationMS(in.DurationMS); err != nil {
		return err
	}
	if in.SizeBytes < 1 || in.SizeBytes > MaxChatVoiceMessageBytes {
		return Invalid("tệp thoại phải có kích thước từ 1 byte đến 4 MiB")
	}
	if _, ok := supportedVoiceContentTypes[strings.ToLower(strings.TrimSpace(in.ContentType))]; !ok {
		return Invalid("định dạng âm thanh không được hỗ trợ")
	}
	return validateClientMsgID(strings.TrimSpace(in.ClientMsgID))
}

func (s *ChatService) requireCanSendMessageInRoom(ctx context.Context, userID string, room db.ChatRoom) error {
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return err
	}
	if room.Kind != chatRoomKindDM {
		return nil
	}
	peerID, err := dmPeerUserID(room, userID)
	if err != nil {
		return err
	}
	blocked, err := s.dmMessagingBlocked(ctx, room.OrganizationID, userID, peerID)
	if err != nil {
		return err
	}
	if blocked {
		return errChatUserBlocked()
	}
	return nil
}

// PrepareVoiceMessage validates the upload and authorizes the room before any
// bytes are persisted. An idempotent retry returns Existing and needs no upload.
func (s *ChatService) PrepareVoiceMessage(
	ctx context.Context,
	userID, workspaceID, roomID string,
	in PrepareVoiceMessageInput,
) (VoiceMessagePreparation, error) {
	in.ContentType = strings.ToLower(strings.TrimSpace(in.ContentType))
	in.ClientMsgID = strings.TrimSpace(in.ClientMsgID)
	if err := validateVoiceMessageInput(in); err != nil {
		return VoiceMessagePreparation{}, err
	}
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return VoiceMessagePreparation{}, err
	}
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		return VoiceMessagePreparation{}, err
	}
	prep := VoiceMessagePreparation{
		OrganizationID: room.OrganizationID,
		room:           room,
		actorID:        userID,
		input:          in,
	}
	if in.ClientMsgID != "" {
		existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, room.ID, userID, in.ClientMsgID)
		if lookupErr != nil {
			return VoiceMessagePreparation{}, lookupErr
		}
		if found {
			row, rowErr := s.chatMessageRowForExisting(ctx, existing)
			if rowErr != nil {
				return VoiceMessagePreparation{}, rowErr
			}
			if row.Kind != "voice" {
				return VoiceMessagePreparation{}, Invalid("client_msg_id đã được dùng")
			}
			prep.Existing = &row
			return prep, nil
		}
		prep.clientMsg = pgtype.Text{String: in.ClientMsgID, Valid: true}
	}
	if in.ReplyToMessageID != nil && strings.TrimSpace(*in.ReplyToMessageID) != "" {
		replyID := strings.TrimSpace(*in.ReplyToMessageID)
		if _, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: replyID, RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return VoiceMessagePreparation{}, Invalid("tin nhắn trả lời không hợp lệ")
			}
			return VoiceMessagePreparation{}, err
		}
		prep.replyTo = pgtype.Text{String: replyID, Valid: true}
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return VoiceMessagePreparation{}, err
	}
	prep.senderName = user.DisplayName
	return prep, nil
}

// CreateVoiceMessage inserts metadata after storage succeeds. created=false
// means a concurrent idempotent request won and the caller should delete its object.
func (s *ChatService) CreateVoiceMessage(
	ctx context.Context,
	userID, objectKey string,
	prep VoiceMessagePreparation,
) (row ChatMessageRow, created bool, err error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" || prep.room.ID == "" || prep.actorID != userID {
		return ChatMessageRow{}, false, Invalid("object_key không hợp lệ")
	}
	meta, err := json.Marshal(map[string]any{
		"duration_ms":  prep.input.DurationMS,
		"object_key":   objectKey,
		"content_type": prep.input.ContentType,
		"size_bytes":   prep.input.SizeBytes,
	})
	if err != nil {
		return ChatMessageRow{}, false, err
	}
	msg, err := s.q.CreateChatVoiceMessage(ctx, db.CreateChatVoiceMessageParams{
		ID:               util.NewID(),
		RoomID:           prep.room.ID,
		OrganizationID:   prep.room.OrganizationID,
		WorkspaceID:      roomAnchorWorkspaceID(prep.room),
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Metadata:         meta,
		ReplyToMessageID: prep.replyTo,
		ClientMsgID:      prep.clientMsg,
	})
	if err != nil {
		if prep.input.ClientMsgID != "" && isUniqueViolation(err) {
			existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, prep.room.ID, userID, prep.input.ClientMsgID)
			if lookupErr != nil {
				return ChatMessageRow{}, false, lookupErr
			}
			if found && existing.Kind == "voice" {
				row, rowErr := s.chatMessageRowForExisting(ctx, existing)
				return row, false, rowErr
			}
		}
		return ChatMessageRow{}, false, err
	}
	_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: prep.room.ID, UserID: userID,
		LastReadAt: pgtype.Timestamptz{Time: msg.CreatedAt.Time, Valid: true},
	})
	_ = s.q.TouchChatRoomUpdatedAt(ctx, prep.room.ID)
	s.publishCreatedChatMessage(ctx, prep.room, msg.ID, msg.SenderID)
	return chatMessageRowFromDB(msg, prep.senderName), true, nil
}

// publishCreatedChatMessage carries the sender so a client can tell its own
// message from one that is unread for it without fetching it (UNI-1079).
func (s *ChatService) publishCreatedChatMessage(ctx context.Context, room db.ChatRoom, messageID, senderID string) {
	anchorWS := roomAnchorWorkspaceID(room)
	ev := Event{
		Type: "chat.message.created",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
			"sender_id":  senderID,
		},
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

// GetVoiceMessage authorizes both room and message and returns private object metadata.
func (s *ChatService) GetVoiceMessage(
	ctx context.Context,
	userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, error) {
	row, err := s.GetRoomMessage(ctx, userID, workspaceID, roomID, messageID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if row.Kind != "voice" || row.Voice == nil || (row.Voice.ObjectKey == "" && row.Voice.FileID == "") {
		return ChatMessageRow{}, ErrNotFound
	}
	return row, nil
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
	if validateVoiceMessageInput(PrepareVoiceMessageInput{
		DurationMS: meta.DurationMS, ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}) != nil || (objectKey == "" && fileID == "") {
		return nil
	}
	return &VoiceMessageInfo{
		DurationMS: meta.DurationMS, FileID: fileID, ObjectKey: objectKey,
		ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}
}
