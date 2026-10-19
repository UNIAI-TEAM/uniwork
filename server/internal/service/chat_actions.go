package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// EditChatMessage updates the caller's own text message.
func (s *ChatService) EditChatMessage(
	ctx context.Context, userID, workspaceID, roomID, messageID, body string,
) (ChatMessageRow, error) {
	if err := validateChatMessageBody(body); err != nil {
		return ChatMessageRow{}, err
	}
	body = strings.TrimSpace(body)
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, roomID, room); err != nil {
		return ChatMessageRow{}, err
	}
	// Before the update: a refused @all must not leave the new body behind.
	mentions, err := s.resolveMentionRecipients(ctx, userID, room, body)
	if err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatMessageRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	updated, err := q.UpdateChatMessageBody(ctx, db.UpdateChatMessageBodyParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, Body: body, SenderID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrForbidden
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	before := decodeChatMessageMetadata(updated.Metadata)
	meta, err := encodeMentionsMetadata(updated.Metadata, mentions)
	if err != nil {
		return ChatMessageRow{}, err
	}
	added := newMentionNotifyIDs(before, mentions)
	updated, err = q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, Metadata: meta,
	})
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := emitChatMentionsAdded(ctx, q, room, userID, updated, added); err != nil {
		return ChatMessageRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.updateCopiedComment(ctx, userID, updated); err != nil {
		return ChatMessageRow{}, err
	}
	s.publishChatMessageUpdated(ctx, room, updated.ID)
	if len(added) > 0 {
		threadRoot := ""
		if updated.ThreadRootID.Valid {
			threadRoot = updated.ThreadRootID.String
		}
		s.publishMentionNotifications(ctx, room, userID, updated.ID, threadRoot, added)
	}
	u, err := s.q.GetUserByID(ctx, updated.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return chatMessageRowFromDB(updated, u.DisplayName), nil
}

// DeleteChatMessage soft-deletes the caller's own message (or, for a room
// moderator, anyone's reminder) and releases the FileService reference in the
// same transaction; the bytes stay with the garbage collector, which
// re-checks every reference provider.
func (s *ChatService) DeleteChatMessage(
	ctx context.Context, userID, workspaceID, roomID, messageID string,
) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	deleted, err := q.SoftDeleteChatMessage(ctx, db.SoftDeleteChatMessageParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, SenderID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// A repeating reminder outlives its author's membership, so a room
		// moderator may retire someone else's; every other kind stays the
		// sender's own.
		moderator, merr := s.isChatRoomModerator(ctx, userID, room)
		if merr != nil {
			return merr
		}
		if !moderator {
			return ErrForbidden
		}
		deleted, err = q.SoftDeleteChatReminderMessage(ctx, db.SoftDeleteChatReminderMessageParams{
			ID: messageID, RoomID: roomID, WorkspaceID: anchorWS,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrForbidden
		}
	}
	if err != nil {
		return err
	}
	if err := s.releaseChatMessageFile(ctx, q, deleted); err != nil {
		return err
	}
	if deleted.ThreadRootID.Valid {
		if err := q.DropChatThreadReplyStats(ctx, db.DropChatThreadReplyStatsParams{
			ThreadRootID: deleted.ThreadRootID, RoomID: room.ID, WorkspaceID: anchorWS,
		}); err != nil {
			return err
		}
	}
	if err := deleteCommentCopiedFromMessage(ctx, q, userID, deleted.ID); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: room.OrganizationID,
		WorkspaceID:    anchorWS,
		Actor:          audit.User(userID),
		Action:         audit.ActionChatMessageDeleted,
		ResourceType:   "chat_message",
		ResourceID:     deleted.ID,
		Metadata:       map[string]any{"room_id": room.ID},
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.publishChatMessageDeleted(ctx, room, deleted.ID)
	if deleted.ThreadRootID.Valid {
		// The root's reply count changed; clients refetch it on this frame.
		s.publishChatMessageUpdated(ctx, room, deleted.ThreadRootID.String)
	}
	return nil
}

// updateCopiedComment carries an edit onto the task comment copied from the
// message, with its audit row and task.comment_updated in one transaction.
func (s *ChatService) updateCopiedComment(ctx context.Context, userID string, msg db.ChatMessage) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := updateCommentCopiedFromMessage(ctx, s.q.WithTx(tx), userID, msg); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *ChatService) publishChatMessageDeleted(ctx context.Context, room db.ChatRoom, messageID string) {
	ev := Event{
		Type: "chat.message.deleted",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
		},
	}
	s.publishChatMessageChange(ctx, room, ev)
}

const maxChatPinnedMessagesPerRoom = 10

// ToggleChatMessagePin toggles whether a message is pinned in the room.
func (s *ChatService) ToggleChatMessagePin(
	ctx context.Context, userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.memberCanPerformRoomAction(ctx, userID, roomID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowPinContent
	}); err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrNotFound
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	if !decodeChatMessageMetadata(msg.Metadata).Pinned {
		count, err := s.q.CountPinnedChatMessagesInRoom(ctx, db.CountPinnedChatMessagesInRoomParams{
			RoomID: roomID, WorkspaceID: anchorWS,
		})
		if err != nil {
			return ChatMessageRow{}, err
		}
		if count >= maxChatPinnedMessagesPerRoom {
			return ChatMessageRow{}, Invalid("phòng đã ghim đủ số tin cho phép")
		}
	}
	var pinned bool
	updated, err := s.mutateChatMessageMetadata(ctx, messageID, roomID, anchorWS,
		func(msg db.ChatMessage) ([]byte, error) {
			meta, p, err := togglePinInMetadata(msg.Metadata)
			pinned = p
			return meta, err
		})
	if err != nil {
		return ChatMessageRow{}, err
	}
	s.publishChatMessageUpdated(ctx, room, updated.ID)
	u, err := s.q.GetUserByID(ctx, updated.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	row := chatMessageRowFromDB(updated, u.DisplayName)
	row.Pinned = pinned
	return s.signChatMediaRow(ctx, room, row), nil
}

func (s *ChatService) publishChatMessageUpdated(ctx context.Context, room db.ChatRoom, messageID string) {
	ev := Event{
		Type: "chat.message.updated",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
		},
	}
	s.publishChatMessageChange(ctx, room, ev)
}

// publishChatMessageChange sends an edit, delete, reaction or pin of a
// message. The default channel's members are the workspace, so it goes there;
// any other channel's goes to chat:{room} only, like before without a
// per-member activity frame (one per reaction would reload every member's
// sidebar). DMs and groups also refresh their members' sidebar previews.
func (s *ChatService) publishChatMessageChange(ctx context.Context, room db.ChatRoom, ev Event) {
	switch {
	case isWorkspaceDefaultRoom(room):
		s.pub.Publish(ctx, roomAnchorWorkspaceID(room), ev)
	case room.Kind == chatRoomKindChannel:
		s.publishChatRoomEvent(ctx, room.ID, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
}
