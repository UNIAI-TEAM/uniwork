package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatDocumentShareRevokeActor is the system actor that records derived
// document.share_revoked rows when a chat room member leaves or is removed
// (UNI-2012 D2a).
var chatDocumentShareRevokeActor = audit.System("chat_document_share_revoke")

// ChatDocumentShareRevoker is the outbox consumer that revokes or restores
// chat-origin document shares when a member leaves or is removed from a chat
// room (UNI-2012 D2a).
//
// Hard rules:
//   - A share given by hand (source_kind IS NULL) is NEVER revoked here.
//   - Old chat grants written before D2a (source_kind IS NULL, no marker) are
//     NEVER auto-revoked here.
//   - If a chat grant raised an existing lower manual share
//     (prior_manual_level IS NOT NULL), leaving the room revokes the chat-origin
//     share row (writing document.share_revoked audit + outbox in the same tx)
//     and restores the manual share row at prior_manual_level with NULL
//     source_kind instead of removing access completely.
//   - If the person is still an invited/active member of another room in the
//     organization that holds a live (non-deleted) document message for the
//     same document, leaving the first room re-points the share's
//     source_room_id / source_message_id to the surviving room and keeps access.
//   - Deactivated organization members are already blocked by the membership
//     gates; this consumer does not subscribe to member.deactivated.
//
// It runs on the notify lane (main.go), never realtime, because it fans out
// across the member's chat-origin shares in the room and writes audit + outbox
// rows in transactions.
type ChatDocumentShareRevoker struct {
	docs *DocumentService
}

// NewChatDocumentShareRevoker constructs the consumer over DocumentService.
func NewChatDocumentShareRevoker(docs *DocumentService) *ChatDocumentShareRevoker {
	return &ChatDocumentShareRevoker{docs: docs}
}

func (*ChatDocumentShareRevoker) Name() string { return "chat_document_share_revoker" }

func (*ChatDocumentShareRevoker) Topics() []string {
	return []string{"chat.room.member_removed", "member.removed"}
}

func (c *ChatDocumentShareRevoker) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_document_share_revoker: payload of %s: %w", ev.ID, err)
		}
	}
	orgID := strings.TrimSpace(payload["organization_id"])
	if orgID == "" {
		orgID = strings.TrimSpace(ev.OrganizationID.String)
	}
	userID := strings.TrimSpace(payload["user_id"])
	if orgID == "" || userID == "" || c.docs == nil {
		return nil
	}
	switch ev.Topic {
	case "chat.room.member_removed":
		roomID := strings.TrimSpace(payload["room_id"])
		if roomID == "" {
			return nil
		}
		return c.docs.RevokeChatRoomDocumentSharesForMember(ctx, orgID, roomID, userID)
	case "member.removed":
		return c.docs.RevokeLeftChatRoomDocumentSharesForMember(ctx, orgID, userID)
	default:
		return nil
	}
}

// RevokeChatRoomDocumentSharesForMember processes every live chat-origin share
// granted from roomID to userID in orgID after userID leaves or is removed from
// roomID.
func (s *DocumentService) RevokeChatRoomDocumentSharesForMember(ctx context.Context, orgID, roomID, userID string) error {
	shares, err := s.q.ListLiveChatDocumentSharesForUserInRoom(ctx, db.ListLiveChatDocumentSharesForUserInRoomParams{
		OrganizationID: orgID,
		UserID:         userID,
		RoomID:         nullText(roomID),
	})
	if err != nil {
		return err
	}
	for _, sh := range shares {
		if err := s.revokeOrRestoreChatDocumentShare(ctx, orgID, roomID, sh); err != nil {
			return err
		}
	}
	return nil
}

// RevokeLeftChatRoomDocumentSharesForMember processes live chat-origin shares
// in orgID for userID whose source room no longer holds userID as an invited or
// active member (for example when removed from a workspace's default room via
// WorkspaceService.RemoveMember).
func (s *DocumentService) RevokeLeftChatRoomDocumentSharesForMember(ctx context.Context, orgID, userID string) error {
	shares, err := s.q.ListLiveChatDocumentSharesForUserLeftRooms(ctx, db.ListLiveChatDocumentSharesForUserLeftRoomsParams{
		OrganizationID: orgID,
		UserID:         userID,
	})
	if err != nil {
		return err
	}
	for _, sh := range shares {
		if err := s.revokeOrRestoreChatDocumentShare(ctx, orgID, sh.SourceRoomID.String, sh); err != nil {
			return err
		}
	}
	return nil
}

func (s *DocumentService) revokeOrRestoreChatDocumentShare(ctx context.Context, orgID, leftRoomID string, candidate db.DocumentShare) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	doc, err := q.LockDocumentByID(ctx, candidate.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if doc.OrganizationID != orgID {
		return nil
	}

	live, err := q.GetLiveDocumentShareByID(ctx, db.GetLiveDocumentShareByIDParams{
		ID:             candidate.ID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Hard rule: manual shares and old chat grants without a source_kind marker
	// are never auto-revoked.
	if !live.SourceKind.Valid || live.SourceKind.String != DocumentShareSourceKindChat {
		return nil
	}
	if leftRoomID != "" && live.SourceRoomID.String != leftRoomID {
		return nil
	}

	// If the user is still an active/invited member of another non-archived room
	// in the organization that holds a live document message for this document,
	// re-point the share marker to that room and keep their access.
	surviving, err := q.FindActiveChatRoomDocumentMessageForUser(ctx, db.FindActiveChatRoomDocumentMessageForUserParams{
		OrganizationID: doc.OrganizationID,
		UserID:         live.PrincipalID,
		DocumentID:     doc.ID,
		ExcludeRoomID:  leftRoomID,
	})
	if err == nil {
		if _, err := q.RepointDocumentShareChatSource(ctx, db.RepointDocumentShareChatSourceParams{
			ID:              live.ID,
			OrganizationID:  doc.OrganizationID,
			WorkspaceID:     doc.WorkspaceID,
			DocumentID:      doc.ID,
			SourceRoomID:    nullText(surviving.RoomID),
			SourceMessageID: nullText(surviving.MessageID),
		}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	// Revoke the chat-origin share through the DocumentService revoke path so
	// audit (document.share_revoked) and outbox are written in this transaction.
	if err := revokeDocumentShareRow(ctx, q, chatDocumentShareRevokeActor, doc, live); err != nil {
		return err
	}

	// If the chat grant had raised an existing lower manual share, restore that
	// manual share row (with NULL source_kind) instead of destroying it.
	if live.PriorManualLevel.Valid {
		if _, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
			ID:             util.NewID(),
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
			PrincipalType:  live.PrincipalType,
			PrincipalID:    live.PrincipalID,
			Level:          live.PriorManualLevel.String,
			GrantedBy:      chatDocumentShareRevokeActor.ID,
			GrantedByKind:  string(chatDocumentShareRevokeActor.Kind),
		}); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// Compile-time check that the consumer fits the dispatcher.
var _ interface {
	Name() string
	Topics() []string
	Handle(context.Context, outbox.Row) error
} = (*ChatDocumentShareRevoker)(nil)
