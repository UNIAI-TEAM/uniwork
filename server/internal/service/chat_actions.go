package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

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
	mentionedUserIDs, err := s.resolveMentionRecipients(ctx, userID, room, body)
	if err != nil {
		return ChatMessageRow{}, err
	}
	updated, err = s.persistMessageMentions(ctx, updated, mentionedUserIDs)
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

// DeleteChatMessage soft-deletes the caller's own message.
func (s *ChatService) DeleteChatMessage(
	ctx context.Context, userID, workspaceID, roomID, messageID string,
) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	deleted, err := s.q.SoftDeleteChatMessage(ctx, db.SoftDeleteChatMessageParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, SenderID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	s.publishChatMessageDeleted(ctx, room, deleted.ID)
	return nil
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
	meta, pinned, err := togglePinInMetadata(msg.Metadata)
	if err != nil {
		return ChatMessageRow{}, err
	}
	updated, err := s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, Metadata: meta,
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
	anchorWS := roomAnchorWorkspaceID(room)
	ev := Event{
		Type: "chat.message.updated",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		s.pub.Publish(ctx, anchorWS, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
}

func (s *ChatService) publishChatMessageDeleted(ctx context.Context, room db.ChatRoom, messageID string) {
	anchorWS := roomAnchorWorkspaceID(room)
	ev := Event{
		Type: "chat.message.deleted",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		s.pub.Publish(ctx, anchorWS, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
}
