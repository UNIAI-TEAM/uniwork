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
	updated, err := s.q.UpdateChatMessageBody(ctx, db.UpdateChatMessageBodyParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, Body: body, SenderID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrForbidden
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	updated, err = s.persistMessageMentions(ctx, s.q, updated, mentions)
	if err != nil {
		return ChatMessageRow{}, err
	}
	s.publishChatMessageUpdated(ctx, room, updated.ID)
	u, err := s.q.GetUserByID(ctx, updated.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return chatMessageRowFromDB(updated, u.DisplayName), nil
}

// DeleteChatMessage soft-deletes the caller's own message and releases the
// FileService reference in the same transaction; the bytes stay with the
// garbage collector, which re-checks every reference provider.
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
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if err := s.releaseChatMessageFile(ctx, q, deleted); err != nil {
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
	return nil
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

// ToggleChatMessagePin toggles whether a message is pinned in the room.
func (s *ChatService) ToggleChatMessagePin(
	ctx context.Context, userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.memberCanPerformRoomAction(ctx, userID, roomID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowPinContent
	}); err != nil {
		return ChatMessageRow{}, err
	}
	var pinned bool
	updated, err := s.mutateChatMessageMetadata(ctx, messageID, roomID, roomAnchorWorkspaceID(room),
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
	return row, nil
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
