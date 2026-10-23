package service

import (
	"context"
	"encoding/json"
	"io"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/files"
)

const (
	MaxChatFileMessageBytes = 25 << 20
	maxChatFilenameRunes    = 200
)

// storedChatFileMIMETypes is the set of content types persisted in message
// metadata and accepted when hydrating a row. Upload validation lives in the
// chat_attachment FileService policy.
var storedChatFileMIMETypes = map[string]string{
	"image/jpeg":      "jpg",
	"image/png":       "png",
	"image/gif":       "gif",
	"image/webp":      "webp",
	"application/pdf": "pdf",
	"text/plain":      "txt",
	"text/csv":        "csv",
	"text/markdown":   "md",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       "xlsx",
}

// FileMessageInfo is private-object metadata for a stored chat file. FileID
// is the FileService reference on rows written after the migration; ObjectKey
// survives only on rows written before it.
type FileMessageInfo struct {
	Filename    string
	FileID      string
	ObjectKey   string
	ContentType string
	SizeBytes   int64
	// Read URLs signed for the viewer (signChatMedia); empty when unsigned.
	URL          string
	DownloadURL  string
	ThumbURL     string
	URLExpiresAt time.Time
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

func validStoredFileMetadata(filename, contentType string, sizeBytes int64, clientMsgID string) bool {
	if sizeBytes < 1 || sizeBytes > MaxChatFileMessageBytes {
		return false
	}
	if _, ok := storedChatFileMIMETypes[strings.ToLower(strings.TrimSpace(contentType))]; !ok {
		return false
	}
	if sanitizeChatFilename(filename) == "" {
		return false
	}
	return validateClientMsgID(strings.TrimSpace(clientMsgID)) == nil
}

// SendFileMessageInput is a chat file send on the FileService path: the bytes
// go to FileService, which verifies size and type under the chat_attachment
// policy; the service claims the file and writes the message in one transaction.
type SendFileMessageInput struct {
	Filename         string
	Body             io.ReadSeeker
	ReplyToMessageID *string
	ClientMsgID      string
}

// SendFileMessage uploads the file through FileService and commits claim +
// message in one transaction. A replayed client_msg_id with the same file
// returns the earlier message; a different command under the key is
// idempotency_conflict.
func (s *ChatService) SendFileMessage(
	ctx context.Context,
	userID, workspaceID, roomID string,
	in SendFileMessageInput,
) (ChatMessageRow, error) {
	in.ClientMsgID = strings.TrimSpace(in.ClientMsgID)
	in.Filename = sanitizeChatFilename(in.Filename)
	if in.Body == nil {
		return ChatMessageRow{}, Invalid("tệp là bắt buộc")
	}
	if err := validateClientMsgID(in.ClientMsgID); err != nil {
		return ChatMessageRow{}, err
	}
	return s.sendChatMedia(ctx, userID, workspaceID, roomID, chatMediaCommand{
		purpose:     files.ChatAttachment,
		kind:        "file",
		filename:    in.Filename,
		body:        in.Body,
		replyToID:   in.ReplyToMessageID,
		clientMsgID: in.ClientMsgID,
	})
}

// OpenChatFileMessage authorizes the read and opens the file bytes through
// FileService; thumb asks for the photo's thumbnail, which is the original
// until one exists. An empty Reader means a pre-migration row whose bytes
// still sit behind the legacy storage object key.
func (s *ChatService) OpenChatFileMessage(
	ctx context.Context,
	userID, workspaceID, roomID, messageID string,
	thumb bool,
) (ChatMessageRow, files.Reader, error) {
	var variant files.Variant
	if thumb {
		variant = files.VariantThumb
	}
	return s.openChatMediaMessage(ctx, userID, workspaceID, roomID, messageID, "file", variant)
}

// fileMessageFromMetadata reads rows written by either path: a post-migration
// row references the file by file_id, a pre-migration row by object_key; both
// carry the verified name/type/size snapshot.
func fileMessageFromMetadata(kind string, raw []byte) *FileMessageInfo {
	if kind != "file" || len(raw) == 0 {
		return nil
	}
	var meta struct {
		Filename    string `json:"filename"`
		FileID      string `json:"file_id"`
		ObjectKey   string `json:"object_key"`
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil
	}
	filename := sanitizeChatFilename(meta.Filename)
	objectKey := strings.TrimSpace(meta.ObjectKey)
	fileID := strings.TrimSpace(meta.FileID)
	if !validStoredFileMetadata(filename, meta.ContentType, meta.SizeBytes, "") ||
		(objectKey == "" && fileID == "") {
		return nil
	}
	return &FileMessageInfo{
		Filename: filename, FileID: fileID, ObjectKey: objectKey,
		ContentType: meta.ContentType, SizeBytes: meta.SizeBytes,
	}
}
