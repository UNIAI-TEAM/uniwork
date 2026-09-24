package service

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	MaxChatFileMessageBytes = 25 << 20
	maxChatFilenameRunes    = 200
)

var supportedChatFileContentTypes = map[string]string{
	"image/jpeg":      "jpg",
	"image/png":       "png",
	"image/gif":       "gif",
	"image/webp":      "webp",
	"application/pdf": "pdf",
	"text/plain":      "txt",
}

// FileMessageInfo is private-object metadata for a stored chat file.
type FileMessageInfo struct {
	Filename    string
	ObjectKey   string
	ContentType string
	SizeBytes   int64
}

type PrepareFileMessageInput struct {
	Filename         string
	ContentType      string
	SizeBytes        int64
	ReplyToMessageID *string
	ClientMsgID      string
}

// FileMessagePreparation carries authorization before bytes are persisted.
type FileMessagePreparation struct {
	OrganizationID string
	Existing       *ChatMessageRow
	room           db.ChatRoom
	actorID        string
	senderName     string
	replyTo        pgtype.Text
	clientMsg      pgtype.Text
	input          PrepareFileMessageInput
}

func sanitizeChatFilename(name string) string {
	name = strings.TrimSpace(name)
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Trim(name, ". ")
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	if utf8.RuneCountInString(name) > maxChatFilenameRunes {
		runes := []rune(name)
		name = string(runes[:maxChatFilenameRunes])
	}
	return name
}

func validateFileMessageInput(in PrepareFileMessageInput) error {
	if in.SizeBytes < 1 || in.SizeBytes > MaxChatFileMessageBytes {
		return Invalid("tệp phải có kích thước từ 1 byte đến 25 MiB")
	}
	if _, ok := supportedChatFileContentTypes[strings.ToLower(strings.TrimSpace(in.ContentType))]; !ok {
		return Invalid("định dạng tệp không được hỗ trợ")
	}
	if sanitizeChatFilename(in.Filename) == "" {
		return Invalid("tên tệp không hợp lệ")
	}
	return validateClientMsgID(strings.TrimSpace(in.ClientMsgID))
}

func ExtForChatFileContentType(contentType string) string {
	return supportedChatFileContentTypes[strings.ToLower(strings.TrimSpace(contentType))]
}

// PrepareFileMessage validates the upload and authorizes the room before any
// bytes are persisted. An idempotent retry returns Existing and needs no upload.
func (s *ChatService) PrepareFileMessage(
	ctx context.Context,
	userID, workspaceID, roomID string,
	in PrepareFileMessageInput,
) (FileMessagePreparation, error) {
	in.ContentType = strings.ToLower(strings.TrimSpace(in.ContentType))
	in.ClientMsgID = strings.TrimSpace(in.ClientMsgID)
	in.Filename = sanitizeChatFilename(in.Filename)
	if err := validateFileMessageInput(in); err != nil {
		return FileMessagePreparation{}, err
	}
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return FileMessagePreparation{}, err
	}
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		return FileMessagePreparation{}, err
	}
	prep := FileMessagePreparation{
		OrganizationID: roomOrganizationID(room),
		room:           room,
		actorID:        userID,
		input:          in,
	}
	if in.ClientMsgID != "" {
		existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, room.ID, userID, in.ClientMsgID)
		if lookupErr != nil {
			return FileMessagePreparation{}, lookupErr
		}
		if found {
			row, rowErr := s.chatMessageRowForExisting(ctx, existing)
			if rowErr != nil {
				return FileMessagePreparation{}, rowErr
			}
			if row.Kind != "file" {
				return FileMessagePreparation{}, Invalid("client_msg_id đã được dùng")
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
				return FileMessagePreparation{}, Invalid("tin nhắn trả lời không hợp lệ")
			}
			return FileMessagePreparation{}, err
		}
		prep.replyTo = pgtype.Text{String: replyID, Valid: true}
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return FileMessagePreparation{}, err
	}
	prep.senderName = user.DisplayName
	return prep, nil
}

func (p FileMessagePreparation) Filename() string {
	return p.input.Filename
}

// CreateFileMessage inserts metadata after storage succeeds.
func (s *ChatService) CreateFileMessage(
	ctx context.Context,
	userID, objectKey string,
	prep FileMessagePreparation,
) (row ChatMessageRow, created bool, err error) {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" || prep.room.ID == "" || prep.actorID != userID {
		return ChatMessageRow{}, false, Invalid("object_key không hợp lệ")
	}
	meta, err := json.Marshal(map[string]any{
		"filename":     prep.input.Filename,
		"object_key":   objectKey,
		"content_type": prep.input.ContentType,
		"size_bytes":   prep.input.SizeBytes,
	})
	if err != nil {
		return ChatMessageRow{}, false, err
	}
	msg, err := s.q.CreateChatFileMessage(ctx, db.CreateChatFileMessageParams{
		ID:               util.NewID(),
		RoomID:           prep.room.ID,
		WorkspaceID:      roomAnchorWorkspaceID(prep.room),
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Body:             prep.input.Filename,
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
			if found && existing.Kind == "file" {
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
	s.publishCreatedChatMessage(ctx, prep.room, msg.ID)
	return chatMessageRowFromDB(msg, prep.senderName), true, nil
}

// GetFileMessage authorizes room/message and returns private object metadata.
func (s *ChatService) GetFileMessage(
	ctx context.Context,
	userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, error) {
	row, err := s.GetRoomMessage(ctx, userID, workspaceID, roomID, messageID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if row.Kind != "file" || row.File == nil || row.File.ObjectKey == "" {
		return ChatMessageRow{}, ErrNotFound
	}
	return row, nil
}

func fileMessageFromMetadata(kind string, raw []byte) *FileMessageInfo {
	if kind != "file" || len(raw) == 0 {
		return nil
	}
	var meta struct {
		Filename    string `json:"filename"`
		ObjectKey   string `json:"object_key"`
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil
	}
	filename := sanitizeChatFilename(meta.Filename)
	if validateFileMessageInput(PrepareFileMessageInput{
		Filename: filename, ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}) != nil || strings.TrimSpace(meta.ObjectKey) == "" {
		return nil
	}
	return &FileMessageInfo{
		Filename: filename, ObjectKey: meta.ObjectKey,
		ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}
}
