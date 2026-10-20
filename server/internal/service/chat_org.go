package service

import (
	"context"
	"errors"
	"slices"

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

// requireOrgPeer checks someone other than the caller, through the caller's
// own gate. Its coded refusals (member_deactivated, organization_*) tell the
// client that the caller is locked out, so for a peer every refusal reads as
// "not here" (UNI-1659); only infrastructure errors pass through.
func (s *ChatService) requireOrgPeer(ctx context.Context, orgID, targetUserID string) error {
	return s.requireOrgPeers(ctx, orgID, []string{targetUserID})
}

func (s *ChatService) requireOrgPeers(ctx context.Context, orgID string, targetUserIDs []string) error {
	if len(targetUserIDs) == 0 {
		return nil
	}
	err := s.ws.orgs.RequireMembers(ctx, orgID, targetUserIDs)
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrMemberDeactivated) ||
		errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrOrganizationDeletionScheduled) {
		return ErrNotFound
	}
	return err
}

func (s *ChatService) publishChatRoomEvent(ctx context.Context, roomID string, ev Event) {
	s.pub.PublishToScope(ctx, ChatScopeType, roomID, ev)
}

func (s *ChatService) publishChatRoomMembersEvent(ctx context.Context, roomID string, ev Event) {
	ids, err := s.q.ListChatRoomMemberUserIDs(ctx, roomID)
	if err != nil {
		return
	}
	slices.Sort(ids)
	ids = slices.DeleteFunc(slices.Compact(ids), func(id string) bool { return id == "" })
	s.pub.SendToUsers(ctx, ids, ev)
}

func (s *ChatService) publishChatRoomActivity(ctx context.Context, roomID string) {
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type:    "chat.room.activity",
		Payload: map[string]string{"room_id": roomID},
	})
}

// AuthorizeChatScope gates WebSocket subscriptions to chat:{roomId}. Whoever
// may read the room may subscribe, so a workspace member viewing a public
// channel without joining hears its edits, now that they no longer go to the
// whole workspace.
func (s *ChatService) AuthorizeChatScope(ctx context.Context, userID, workspaceID, roomID string) (bool, error) {
	_, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
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
