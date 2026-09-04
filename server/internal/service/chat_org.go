package service

import (
	"context"

	"errors"
	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *ChatService) workspaceForChat(ctx context.Context, userID, workspaceID string) (db.Workspace, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Workspace{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Workspace{}, ErrNotFound
		}
		return db.Workspace{}, err
	}
	return w, nil
}

func (s *ChatService) requireOrgPeer(ctx context.Context, orgID, targetUserID string) error {
	_, err := s.ws.orgs.RequireMember(ctx, orgID, targetUserID)
	if err != nil {
		if err == ErrForbidden {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *ChatService) publishChatRoomEvent(ctx context.Context, roomID string, ev Event) {
	s.pub.PublishToScope(ctx, ChatScopeType, roomID, ev)
}

func (s *ChatService) publishChatRoomMembersEvent(ctx context.Context, roomID string, ev Event) {
	ids, err := s.q.ListChatRoomMemberUserIDs(ctx, roomID)
	if err != nil {
		return
	}
	seen := make(map[string]struct{}, len(ids))
	for _, userID := range ids {
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		s.pub.SendToUser(ctx, userID, ev)
	}
}

func (s *ChatService) publishChatRoomActivity(ctx context.Context, roomID string) {
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type:    "chat.room.activity",
		Payload: map[string]string{"room_id": roomID},
	})
}

// AuthorizeChatScope gates WebSocket subscriptions to chat:{roomId}.
func (s *ChatService) AuthorizeChatScope(ctx context.Context, userID, workspaceID, roomID string) (bool, error) {
	_, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func roomAnchorWorkspaceID(room db.ChatRoom) string {
	if room.WorkspaceID.Valid {
		return room.WorkspaceID.String
	}
	return ""
}

func roomOrganizationID(room db.ChatRoom) string {
	if room.OrganizationID.Valid {
		return room.OrganizationID.String
	}
	return ""
}
