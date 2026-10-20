package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Chat document link (UNI-2012 D5, S2). The sender attaches a document that
// already lives in Documents: nothing is uploaded, moved, renamed or copied,
// the room's recipients get share_level through the same only-raise chat
// grant as an upload send, and the message is the same kind="document" card.
// Only someone who may share the document may send it (D5 = A): the document
// command's own gate decides, never a second ACL.

// chatDocumentOriginLink marks a document message that attached an existing
// document. The message metadata carries it as "origin"; an absent origin is
// an upload (every message before this route was one), which S1d reads to
// decide what deleting the message does.
const chatDocumentOriginLink = "link"

// chatDocumentLinkMetadata is the metadata of a link-origin document message:
// ids and the origin only (§4.2).
func chatDocumentLinkMetadata(documentID string) ([]byte, error) {
	return json.Marshal(map[string]string{"document_id": documentID, "origin": chatDocumentOriginLink})
}

// SendDocumentLinkInput is one link send. ShareLevel is what every recipient
// gets; empty means comment, manage is refused.
type SendDocumentLinkInput struct {
	DocumentID       string
	ShareLevel       string
	ReplyToMessageID *string
	ClientMsgID      string
}

// SendDocumentLinkMessage sends an existing document into a room. The order:
// validate, the room gate, the replay fast path, the recipients, then one
// transaction that replays an existing message before any write, re-checks the
// sender, locks the document row and runs the share gate on it, grants and
// writes the message. The publish runs after the commit.
func (s *ChatService) SendDocumentLinkMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendDocumentLinkInput,
) (ChatMessageRow, error) {
	if s.docs == nil {
		return ChatMessageRow{}, filesError(files.StorageUnavailable(errChatDocumentsNotConfigured))
	}
	level, err := documentShareLevelFromInput(in.ShareLevel)
	if err != nil {
		return ChatMessageRow{}, err
	}
	documentID := strings.TrimSpace(in.DocumentID)
	if documentID == "" {
		return ChatMessageRow{}, Invalid("document_id là bắt buộc")
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
	// A retry needs neither the recipients nor the document gate: it answers
	// the stored message. The transaction repeats the lookup authoritatively.
	if clientMsgID != "" {
		existing, found, err := existingChatMessageInTx(ctx, s.q, room.ID, userID, clientMsgID)
		if err != nil {
			return ChatMessageRow{}, err
		}
		if found {
			if existing.Kind != chatMessageKindDocument {
				return ChatMessageRow{}, errClientMsgIDConflict()
			}
			return s.resolvedChatDocumentMessageRow(ctx, room, existing, userID)
		}
	}
	replyTo, err := s.documentLinkReplyTo(ctx, room, in.ReplyToMessageID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	recipients, err := s.documentGrantRecipients(ctx, userID, room)
	if err != nil {
		return ChatMessageRow{}, err
	}
	msg, created, err := s.commitDocumentLinkMessage(ctx, userID, workspaceID, room, documentID, clientMsgID, level, recipients, replyTo)
	if err != nil {
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
	return s.resolvedChatDocumentMessageRow(ctx, room, msg, userID)
}

// documentLinkReplyTo checks reply_to_message_id the way every message route
// does: a live message of the same room, else a 400.
func (s *ChatService) documentLinkReplyTo(ctx context.Context, room db.ChatRoom, raw *string) (pgtype.Text, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return pgtype.Text{}, nil
	}
	replyID := strings.TrimSpace(*raw)
	if _, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: replyID, RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.Text{}, Invalid("tin nhắn trả lời không hợp lệ")
		}
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: replyID, Valid: true}, nil
}

// commitDocumentLinkMessage is the one transaction of a link send: the replay
// lookup first, then the sender's gates, the document row lock and its share
// gate, the grants and the message.
func (s *ChatService) commitDocumentLinkMessage(
	ctx context.Context,
	userID, workspaceID string,
	room db.ChatRoom,
	documentID, clientMsgID string,
	level DocumentLevel,
	recipients []string,
	replyTo pgtype.Text,
) (db.ChatMessage, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

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
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, userID); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return db.ChatMessage{}, false, err
	}
	actor := Human(userID)
	doc, err := s.shareableDocumentForLinkQ(ctx, q, actor, room, documentID)
	if err != nil {
		return db.ChatMessage{}, false, err
	}

	msgID := util.NewID()
	if err := s.grantDocumentToRoomMembers(ctx, q, actor, DocumentFileResult{Document: doc}, recipients, level, room.ID, msgID); err != nil {
		return db.ChatMessage{}, false, err
	}
	meta, err := chatDocumentLinkMetadata(doc.ID)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	var clientMsg pgtype.Text
	if clientMsgID != "" {
		clientMsg = pgtype.Text{String: clientMsgID, Valid: true}
	}
	msg, err := q.CreateChatDocumentMessage(ctx, db.CreateChatDocumentMessageParams{
		ID:               msgID,
		RoomID:           room.ID,
		OrganizationID:   room.OrganizationID,
		WorkspaceID:      roomAnchorWorkspaceID(room),
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Body:             strings.TrimSpace(doc.Title),
		Metadata:         meta,
		ReplyToMessageID: replyTo,
		ClientMsgID:      clientMsg,
	})
	if err != nil {
		// A concurrent retry with the same key committed first: replay it,
		// and this transaction's grants go with the rollback.
		if clientMsgID != "" && isUniqueViolation(err) {
			existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, room.ID, userID, clientMsgID)
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

// shareableDocumentForLinkQ locks the document row and answers the share
// command's gate on it (shareDocumentInTx): a document of another
// organization, or one the sender neither reads nor administers, is not found
// (existence never leaks); the trash and the shelf are refused; an owned
// document, the My Folder row and a reader below manage get
// requireDocumentACLChange's answers; a folder takes no grant. Pages and files
// pass.
func (s *ChatService) shareableDocumentForLinkQ(
	ctx context.Context, q *db.Queries, actor Actor, room db.ChatRoom, documentID string,
) (db.Document, error) {
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, err
	}
	if doc.OrganizationID != room.OrganizationID {
		return db.Document{}, ErrNotFound
	}
	access, err := s.docs.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return db.Document{}, err
	}
	if err := decideDocumentViewOrAdminister(doc, access); err != nil {
		return db.Document{}, err
	}
	if doc.ArchivedAt.Valid {
		return db.Document{}, documentArchived()
	}
	if err := requireNotShelved(doc); err != nil {
		return db.Document{}, err
	}
	if err := requireDocumentACLChange(doc, access); err != nil {
		return db.Document{}, err
	}
	if err := refuseFolderShare(doc); err != nil {
		return db.Document{}, err
	}
	return doc, nil
}
