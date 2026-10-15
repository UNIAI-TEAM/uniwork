package service

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// sendKindMessage is the shared tail of a poll, note, post or reminder send,
// after each has checked its own content and permissions: the same steps as
// sendMessage. A repeated clientMsgID returns the first message, and the
// message commits with its notification rows (a DM's peer hears it offline).
// afterInsert, when set, writes rows that must commit with the message.
func (s *ChatService) sendKindMessage(
	ctx context.Context, userID string, room db.ChatRoom, kind, body string, meta []byte, clientMsgID string,
	afterInsert func(q *db.Queries, msg db.ChatMessage, sender db.User) error,
) (ChatMessageRow, error) {
	clientMsgID = strings.TrimSpace(clientMsgID)
	if err := validateClientMsgID(clientMsgID); err != nil {
		return ChatMessageRow{}, err
	}
	// Before the insert, so a failed lookup cannot answer 500 for a stored message.
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	existing := func() (ChatMessageRow, bool, error) {
		if clientMsgID == "" {
			return ChatMessageRow{}, false, nil
		}
		msg, found, err := s.existingMessageByClientMsgID(ctx, room.ID, userID, clientMsgID)
		if err != nil || !found {
			return ChatMessageRow{}, false, err
		}
		return chatMessageRowFromDBForViewer(msg, u.DisplayName, userID), true, nil
	}
	if row, found, err := existing(); err != nil || found {
		return row, err
	}
	var clientMsg pgtype.Text
	if clientMsgID != "" {
		clientMsg = pgtype.Text{String: clientMsgID, Valid: true}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatMessageRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	msg, err := q.CreateChatKindMessage(ctx, db.CreateChatKindMessageParams{
		ID:             util.NewID(),
		RoomID:         room.ID,
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
		SenderID:       userID,
		SenderKind:     string(audit.KindHuman),
		Kind:           kind,
		Body:           body,
		Metadata:       meta,
		ClientMsgID:    clientMsg,
	})
	if err != nil {
		// A concurrent retry with the same key committed first.
		if clientMsgID != "" && isUniqueViolation(err) {
			if row, found, lookupErr := existing(); lookupErr != nil || found {
				return row, lookupErr
			}
		}
		return ChatMessageRow{}, err
	}
	if afterInsert != nil {
		if err := afterInsert(q, msg, u); err != nil {
			return ChatMessageRow{}, err
		}
	}
	if err := emitChatMessageNotifications(ctx, q, room, userID, msg.ID, "", chatMentions{}); err != nil {
		return ChatMessageRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatMessageRow{}, err
	}
	_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: room.ID, UserID: userID, LastReadAt: pgtype.Timestamptz{Time: msg.CreatedAt.Time, Valid: true},
	})
	_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
	s.publishCreatedChatMessage(ctx, room, msg.ID, msg.SenderID, "")
	return chatMessageRowFromDBForViewer(msg, u.DisplayName, userID), nil
}
