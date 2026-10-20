package service

import (
	"context"
	"errors"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ShareAttachmentAsDocumentInput is POST
// .../chat/rooms/{roomID}/messages/{messageID}/share-as-document (UNI-1966
// §2.2, §3.3). ShareLevel defaults to comment when empty; manage is refused
// with 400.
type ShareAttachmentAsDocumentInput struct {
	ShareLevel  string
	ClientMsgID string
}

// chatAttachmentShareBeforeLock is a test seam: when set, it runs after the
// copied bytes are uploaded and right before the conversion transaction opens
// its message row lock, so a test can race two conversions on the same
// attachment and prove only one document is created. nil in production.
var chatAttachmentShareBeforeLock func()

// ShareAttachmentAsDocument converts an existing file attachment message into
// a shared Document in place (§3.3, L1):
//  1. authorizeRoom + requireCanSendInRoom; load the live message
//  2. sender only (403 otherwise)
//  3. L1 replay: if already converted to kind='document', return 200 with the
//     same message + document (whatever client_msg_id or share_level)
//  4. kind='file' (404 otherwise), type on L8's subset and saveable (422
//     source_not_saveable otherwise), recipients within the batch cap (422
//     share_batch_too_large otherwise)
//  5. open the attachment bytes via OpenChatFileMessage and upload a copy as a
//     new document_file object
//  6. one transaction: lock the message row (replay if another call converted
//     it meanwhile), create the Document at the root of the workspace the
//     sender stands in, grant the room's current human members, flip the
//     message in place to
//     kind='document' and metadata={"document_id"} keeping body and
//     client_msg_id untouched, and release the old chat_attachment reference
//     only after the document holds its own object
//  7. publish chat.message.updated after commit.
func (s *ChatService) ShareAttachmentAsDocument(
	ctx context.Context, userID, workspaceID, roomID, messageID string, in ShareAttachmentAsDocumentInput,
) (ChatMessageRow, error) {
	if s.files == nil {
		return ChatMessageRow{}, filesError(files.StorageUnavailable(errChatFilesNotConfigured))
	}
	if s.docs == nil {
		return ChatMessageRow{}, filesError(files.StorageUnavailable(errChatDocumentsNotConfigured))
	}
	level, err := documentShareLevelFromInput(in.ShareLevel)
	if err != nil {
		return ChatMessageRow{}, err
	}
	clientMsgID := strings.TrimSpace(in.ClientMsgID)
	if err := validateClientMsgID(clientMsgID); err != nil {
		return ChatMessageRow{}, err
	}
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: room.ID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrNotFound
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	if msg.SenderID != userID {
		return ChatMessageRow{}, ErrForbidden
	}
	// L1: any second call by the sender on an already converted message
	// answers 200 with the same message + document, whatever its client_msg_id
	// or share_level.
	if msg.Kind == chatMessageKindDocument {
		if documentMessageFromMetadata(msg.Kind, msg.Metadata) == nil {
			return ChatMessageRow{}, ErrNotFound
		}
		return s.resolvedChatDocumentMessageRow(ctx, room, msg, userID)
	}
	if msg.Kind != "file" {
		return ChatMessageRow{}, ErrNotFound
	}
	fileInfo := fileMessageFromMetadata(msg.Kind, msg.Metadata)
	if fileInfo == nil || !s.chatFileSaveableAsDocument(*fileInfo) {
		return ChatMessageRow{}, errSourceNotSaveable()
	}
	recipients, err := s.documentGrantRecipients(ctx, userID, room)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if len(recipients) > maxDocumentShareBatch {
		return ChatMessageRow{}, shareBatchTooLargeError()
	}

	_, rd, err := s.OpenChatFileMessage(ctx, userID, workspaceID, room.ID, messageID, false)
	if err != nil {
		return ChatMessageRow{}, err
	}
	defer func() { _ = rd.Close() }()
	if rd.Body == nil {
		return ChatMessageRow{}, errSourceNotSaveable()
	}

	scope := documentScope(room.OrganizationID, workspaceID)
	actor := Human(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.DocumentFile,
		Scope:          scope,
		IdempotencyKey: "chatlink/" + room.ID + "/" + messageID + "/" + util.NewID(),
		Filename:       fileInfo.Filename,
		Body:           rd.Body,
		Check: func(_ context.Context, _ io.ReaderAt, _ int64, contentType string) error {
			if !chatDocumentMIMEType(contentType) {
				return errSourceNotSaveable()
			}
			return nil
		},
	})
	if err != nil {
		var fe *files.Error
		if codedIs(err, errCodeSourceNotSaveable) {
			return ChatMessageRow{}, err
		}
		if errors.As(err, &fe) && fe.Code == files.CodeTypeRejected {
			return ChatMessageRow{}, errSourceNotSaveable()
		}
		return ChatMessageRow{}, filesError(err)
	}
	if !chatDocumentMIMEType(up.File.ContentType) {
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, errSourceNotSaveable()
	}

	updated, converted, err := s.commitAttachmentAsDocument(
		ctx, userID, workspaceID, room, messageID, fileInfo.Filename, level, recipients, up.File, actor,
	)
	if err != nil {
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, err
	}
	if !converted {
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
	} else {
		s.publishChatMessageUpdated(ctx, room, updated.ID)
	}
	return s.resolvedChatDocumentMessageRow(ctx, room, updated, userID)
}

func (s *ChatService) commitAttachmentAsDocument(
	ctx context.Context,
	userID string,
	workspaceID string,
	room db.ChatRoom,
	messageID string,
	filename string,
	level DocumentLevel,
	recipients []string,
	file files.File,
	actor audit.Actor,
) (db.ChatMessage, bool, error) {
	if chatAttachmentShareBeforeLock != nil {
		chatAttachmentShareBeforeLock()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	anchorWS := roomAnchorWorkspaceID(room)
	locked, err := q.GetChatMessageInRoomForUpdate(ctx, db.GetChatMessageInRoomForUpdateParams{
		ID: messageID, RoomID: room.ID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatMessage{}, false, ErrNotFound
	}
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	if locked.SenderID != userID {
		return db.ChatMessage{}, false, ErrForbidden
	}
	// Replay guard under the row lock: if a concurrent call already converted
	// the attachment, return its message and document without creating a
	// second one.
	if locked.Kind == chatMessageKindDocument {
		if documentMessageFromMetadata(locked.Kind, locked.Metadata) == nil {
			return db.ChatMessage{}, false, ErrNotFound
		}
		return locked, false, nil
	}
	if locked.Kind != "file" {
		return db.ChatMessage{}, false, ErrNotFound
	}
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, userID); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return db.ChatMessage{}, false, err
	}

	docRes, _, err := s.docs.createFileDocumentFromStagedUploadInTx(
		ctx, tx, q, s.files, actor, room.OrganizationID, workspaceID,
		file.ID, filename, "", "", "", "",
	)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	if chatDocumentShareFault != nil {
		if err := chatDocumentShareFault(); err != nil {
			return db.ChatMessage{}, false, err
		}
	}
	if err := s.grantDocumentToRoomMembers(ctx, q, actor, docRes, recipients, level, room.ID, locked.ID); err != nil {
		return db.ChatMessage{}, false, err
	}

	meta, err := attachmentToDocumentMetadata(locked.Metadata, docRes.Document.ID)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	updated, err := q.ConvertChatFileMessageToDocument(ctx, db.ConvertChatFileMessageToDocumentParams{
		ID:          locked.ID,
		RoomID:      room.ID,
		WorkspaceID: anchorWS,
		Metadata:    meta,
	})
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := s.releaseChatMessageFile(ctx, q, locked); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ChatMessage{}, false, err
	}
	return updated, true, nil
}

// attachmentToDocumentMetadata keeps everything on the message but the file
// block: reactions and the pin live in the same metadata and belong to other
// people's input, so a conversion drops only the five file keys and adds the
// document id.
func attachmentToDocumentMetadata(raw []byte, documentID string) ([]byte, error) {
	meta := raw
	for _, key := range []string{"filename", "file_id", "object_key", "content_type", "size_bytes"} {
		var err error
		if meta, err = patchMetadataKey(meta, key, nil); err != nil {
			return nil, err
		}
	}
	return patchMetadataKey(meta, "document_id", documentID)
}

func (s *ChatService) resolvedChatDocumentMessageRow(
	ctx context.Context, room db.ChatRoom, msg db.ChatMessage, viewerID string,
) (ChatMessageRow, error) {
	u, err := s.q.GetUserByID(ctx, msg.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	out := []ChatMessageRow{chatMessageRowFromDBForViewer(msg, u.DisplayName, viewerID)}
	s.resolveChatDocuments(ctx, room, out, viewerID)
	return out[0], nil
}
