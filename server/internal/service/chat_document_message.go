package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Chat document share (UNI-1966 §2.1, §3.1). A document message is a message
// kind whose bytes live in the Documents tree: the send stages one
// document_file upload, files it into the sender's My Folder, grants the
// room's current human members, and writes the message that names the
// document - all but the upload in one transaction, because a message must
// never exist without the document it names (ADR 0009).

// SendDocumentMessageInput is one document send. ShareLevel is the level every
// room member gets; empty means comment (§2.1).
type SendDocumentMessageInput struct {
	ShareLevel       string
	Filename         string
	Title            string
	Body             io.ReadSeeker
	ReplyToMessageID *string
	ClientMsgID      string
}

// errChatDocumentsNotConfigured is the send refusal when the Documents service
// is not wired: the command cannot file the bytes, so it fails closed with the
// storage-unavailable shape instead of half-working.
var errChatDocumentsNotConfigured = errors.New("chat: documents service is not configured")

// chatDocumentShareFault is a test seam on the commit path: when set, it runs
// after the document is created, so a test can force a failure between the
// document and the message and prove the whole commit rolls back together.
// Production never sets it.
var chatDocumentShareFault func() error

// documentShareLevelFromInput reads the requested level: empty is comment
// (§2.1's default), the four real levels are accepted, and manage is refused
// with a 400 because a chat send hands out read-ish access, never
// administration (§3.1.b).
func documentShareLevelFromInput(raw string) (DocumentLevel, error) {
	level := DocumentLevel(strings.ToLower(strings.TrimSpace(raw)))
	if level == "" {
		return DocumentLevelComment, nil
	}
	if level == DocumentLevelManage {
		return "", Invalid("share_level chỉ nhận view, comment hoặc edit")
	}
	if err := validShareLevel(level); err != nil {
		return "", err
	}
	return level, nil
}

// AuthorizeDocumentSend is the send gate of SendDocumentMessage, exposed so
// the upload handler can refuse a non-member before reading a byte of the
// body - the AuthorizeMediaSend shape.
func (s *ChatService) AuthorizeDocumentSend(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	return s.requireCanSendInRoom(ctx, userID, room.ID, room)
}

// SendDocumentMessage sends one document message (§3.1). The order is the
// contract's: gate, validate, hash, upload outside the transaction, then one
// transaction for the document, its grants and the message; the publish runs
// after the commit and any terminal error after the upload cancels the staged
// file.
func (s *ChatService) SendDocumentMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendDocumentMessageInput,
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
	var replyTo pgtype.Text
	if in.ReplyToMessageID != nil && strings.TrimSpace(*in.ReplyToMessageID) != "" {
		replyID := strings.TrimSpace(*in.ReplyToMessageID)
		if _, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: replyID, RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ChatMessageRow{}, Invalid("tin nhắn trả lời không hợp lệ")
			}
			return ChatMessageRow{}, err
		}
		replyTo = pgtype.Text{String: replyID, Valid: true}
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	// The payload digest joins the upload key, so a different file under the
	// same client_msg_id conflicts instead of replaying (the file/voice rule).
	sum := sha256.New()
	if _, err := io.Copy(sum, in.Body); err != nil {
		return ChatMessageRow{}, Invalid("không đọc được dữ liệu tệp")
	}
	if _, err := in.Body.Seek(0, io.SeekStart); err != nil {
		return ChatMessageRow{}, Invalid("không đọc được dữ liệu tệp")
	}
	// §3.4: the recipients are read before the bytes are stored, so a room
	// whose audience overflows the batch cap is refused with 422 before any
	// write - the same refusal the room read advertises through
	// can_send_document (L5).
	recipients, err := s.documentGrantRecipients(ctx, userID, room)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if len(recipients) > maxDocumentShareBatch {
		return ChatMessageRow{}, shareBatchTooLargeError()
	}

	scope := documentScope(room.OrganizationID, roomAnchorWorkspaceID(room))
	actor := Human(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.DocumentFile,
		Scope:          scope,
		IdempotencyKey: chatDocumentUploadKey(room.ID, userID, clientMsgID, sum.Sum(nil)),
		Filename:       in.Filename,
		Body:           in.Body,
		// L8: the document send accepts the editor formats only, so an image, a
		// stylesheet or a script is refused while its bytes are still in the
		// spool, before any object is stored. The check runs on the verified
		// content type, never the filename.
		Check: func(_ context.Context, _ io.ReaderAt, _ int64, contentType string) error {
			if !chatDocumentMIMEType(contentType) {
				return chatDocumentTypeRefused()
			}
			return nil
		},
	})
	if err != nil {
		// The policy refusal and the Check refusal are the same answer to the
		// client: the §2.3 415 with fields.reason "format".
		var fe *files.Error
		if codedIs(err, document.ErrCodeUnsupportedMedia) {
			return ChatMessageRow{}, err
		}
		if errors.As(err, &fe) && fe.Code == files.CodeTypeRejected {
			return ChatMessageRow{}, chatDocumentTypeRefused()
		}
		return ChatMessageRow{}, filesError(err)
	}
	// An idempotent replay of the same key returns the stored file without
	// spooling, so Check did not run; the verified type still decides.
	if !chatDocumentMIMEType(up.File.ContentType) {
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, chatDocumentTypeRefused()
	}

	msg, created, err := s.commitDocumentMessage(ctx, userID, room, in, level, recipients, up.File, actor, replyTo)
	if err != nil {
		// Any terminal error after the upload leaves a staged object; cancel
		// reclaims it instead of waiting for the 24h claim window. A file that
		// did get claimed reports already_claimed and stays.
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, err
	}
	if created {
		_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
			RoomID: room.ID, UserID: userID,
			LastReadAt: pgtype.Timestamptz{Time: msg.CreatedAt.Time, Valid: true},
		})
		_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
		s.publishCreatedChatMessage(ctx, room, msg.ID, msg.SenderID, "")
	}
	row := chatMessageRowFromDBForViewer(msg, user.DisplayName, userID)
	// The send answer carries the resolved block, so the sender's own card
	// renders without a refetch. The resolver mutates the slice element, so
	// the element is what the answer returns.
	out := []ChatMessageRow{row}
	s.resolveChatDocuments(ctx, room, out, userID)
	return out[0], nil
}

// commitDocumentMessage is step 3.1.e: the replay lookup, the permission
// recheck, the document, the grants and the message in ONE transaction. The
// document comes first and the message last, so a forced failure anywhere
// leaves neither: the message never names a document that does not exist.
func (s *ChatService) commitDocumentMessage(
	ctx context.Context,
	userID string,
	room db.ChatRoom,
	in SendDocumentMessageInput,
	level DocumentLevel,
	recipients []string,
	file files.File,
	actor audit.Actor,
	replyTo pgtype.Text,
) (msg db.ChatMessage, created bool, err error) {
	clientMsgID := strings.TrimSpace(in.ClientMsgID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	// 3.1.e.i: a retry replays the stored message and its document; no second
	// document, no second grant.
	if clientMsgID != "" {
		existing, found, err := existingChatMessageInTx(ctx, q, room.ID, userID, clientMsgID)
		if err != nil {
			return db.ChatMessage{}, false, err
		}
		if found {
			if existing.Kind != chatMessageKindDocument {
				return db.ChatMessage{}, false, errClientMsgIDConflict()
			}
			return existing, false, nil
		}
	}
	// 3.1.e.ii: a revoke during the upload must win.
	if _, err := s.ws.RequireMemberQ(ctx, q, roomAnchorWorkspaceID(room), userID); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return db.ChatMessage{}, false, err
	}

	// 3.1.e.iii: the bytes become a file document in the sender's My Folder.
	// The document create carries a derived idempotency key, so the document
	// ledger and the message ledger agree on a replay without the client
	// sending two keys.
	docRes, _, err := s.docs.createFileDocumentFromStagedUploadInTx(
		ctx, tx, q, s.files, actor, room.OrganizationID, roomAnchorWorkspaceID(room),
		file.ID, in.Filename, in.Title, "", DocumentSystemKindMyFolder, "",
	)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	doc := docRes.Document
	if chatDocumentShareFault != nil {
		if err := chatDocumentShareFault(); err != nil {
			return db.ChatMessage{}, false, err
		}
	}
	// 3.1.e.iv: the grants. The audience was decided before the upload and is
	// passed in: a member who joined meanwhile gets nothing (§3.4), and the
	// notify decision is taken here, before the first grant, against the
	// command-start shares (SH-S3 R1-01).
	if err := s.grantDocumentToRoomMembers(ctx, q, actor, docRes, recipients, level); err != nil {
		return db.ChatMessage{}, false, err
	}

	// 3.1.e.v: the message names the document, ids only (§4.2).
	meta, err := json.Marshal(map[string]string{"document_id": doc.ID})
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	var clientMsg pgtype.Text
	if clientMsgID != "" {
		clientMsg = pgtype.Text{String: clientMsgID, Valid: true}
	}
	body := files.SanitizeFilename(in.Filename)
	if body == "" {
		body = files.SanitizeFilename(file.Filename)
	}
	msg, err = q.CreateChatDocumentMessage(ctx, db.CreateChatDocumentMessageParams{
		ID:               util.NewID(),
		RoomID:           room.ID,
		OrganizationID:   room.OrganizationID,
		WorkspaceID:      roomAnchorWorkspaceID(room),
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Body:             body,
		Metadata:         meta,
		ReplyToMessageID: replyTo,
		ClientMsgID:      clientMsg,
	})
	if err != nil {
		// A concurrent retry with the same key committed first: replay its
		// message, and the document this transaction just made is discarded
		// with the rollback below.
		if clientMsgID != "" && isUniqueViolation(err) {
			existing, found, lookupErr := existingChatMessageInTx(ctx, q, room.ID, userID, clientMsgID)
			if lookupErr != nil || found {
				if found && existing.Kind != chatMessageKindDocument {
					return db.ChatMessage{}, false, errClientMsgIDConflict()
				}
				return existing, false, lookupErr
			}
		}
		return db.ChatMessage{}, false, err
	}
	if err := emitChatMessageNotifications(ctx, q, room, userID, msg.ID, "", "", chatMentions{}); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ChatMessage{}, false, err
	}
	return msg, true, nil
}

// grantDocumentToRoomMembers applies one share per recipient inside the
// caller's transaction. The document is shared, never its parent: the My
// Folder stays private to the sender (UNI-1974).
func (s *ChatService) grantDocumentToRoomMembers(
	ctx context.Context, q *db.Queries, actor Actor, docRes DocumentFileResult, recipients []string, level DocumentLevel,
) error {
	if len(recipients) == 0 {
		return nil
	}
	doc := docRes.Document
	access := docRes.Access
	sharesBefore, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if err != nil {
		return err
	}
	for _, recipientID := range recipients {
		notifyUserID, err := s.docs.notifyOnUserShare(ctx, q, actor, doc, sharesBefore, recipientID, level)
		if err != nil {
			return err
		}
		if _, err := s.docs.applyDocumentShareWithBatch(ctx, q, actor, doc, access,
			DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: recipientID, Level: level},
			"", notifyUserID); err != nil {
			return err
		}
	}
	return nil
}

// existingChatMessageInTx is existingMessageByClientMsgID read through the
// caller's transaction, so the replay lookup sees the same connection as the
// insert it guards.
func existingChatMessageInTx(ctx context.Context, q *db.Queries, roomID, senderID, clientMsgID string) (db.ChatMessage, bool, error) {
	msg, err := q.GetChatMessageByClientMsgID(ctx, db.GetChatMessageByClientMsgIDParams{
		RoomID:      roomID,
		SenderID:    senderID,
		ClientMsgID: pgtype.Text{String: clientMsgID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatMessage{}, false, nil
	}
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	if msg.DeletedAt.Valid {
		return db.ChatMessage{}, false, errClientMsgIDDeleted()
	}
	return msg, true, nil
}

// chatDocumentUploadKey binds one upload to one sender, room and client key,
// the chatMediaUploadKey shape.
func chatDocumentUploadKey(roomID, senderID, clientMsgID string, sum []byte) string {
	key := clientMsgID
	if key == "" {
		key = util.NewID()
	}
	return "chat/document/" + roomID + "/" + senderID + "/" + key + "/" + hex.EncodeToString(sum[:8])
}

// shareBatchTooLargeError is the §2.3 422: a room with more grantable
// recipients than one batch may name. It is the same code and shape
// ShareDocumentBatch answers.
func shareBatchTooLargeError() error {
	return CodedError{
		Code:   "share_batch_too_large",
		Status: http.StatusUnprocessableEntity,
		Msg:    "mỗi lần chia sẻ tối đa 50 người dùng",
		Fields: map[string]any{"max": maxDocumentShareBatch},
	}
}

// chatDocumentTypeRefused is the §2.3 415 for a file outside L8's subset.
// fields.reason is "format", the Documents vocabulary for a type it will not
// hold (document_files.go's documentFileError answers the same shape).
func chatDocumentTypeRefused() error {
	return CodedError{
		Code:   document.ErrCodeUnsupportedMedia,
		Status: http.StatusUnsupportedMediaType,
		Msg:    "định dạng tệp không được hỗ trợ",
		Fields: map[string]any{"reason": "format"},
	}
}
