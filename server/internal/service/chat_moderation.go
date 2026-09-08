package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatRoomMemberView is a member row for chat room settings.
type ChatRoomMemberView struct {
	UserID         string
	Role           string
	SendRestricted bool
	Email          string
	DisplayName    string
}

type UpdateChatRoomMemberInput struct {
	Role           *string
	SendRestricted *bool
}

// ListChatRoomMembers returns active members with moderation fields.
func (s *ChatService) ListChatRoomMembers(
	ctx context.Context, userID, workspaceID, roomID string,
) ([]ChatRoomMemberView, error) {
	if _, err := s.authorizeRoom(ctx, userID, workspaceID, roomID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListChatRoomMembers(ctx, roomID)
	if err != nil {
		return nil, err
	}
	out := make([]ChatRoomMemberView, 0, len(rows))
	for _, row := range rows {
		out = append(out, ChatRoomMemberView{
			UserID: row.UserID, Role: row.Role, SendRestricted: row.SendRestricted,
			Email: row.Email, DisplayName: row.DisplayName,
		})
	}
	return out, nil
}

// UpdateChatRoomMember changes chat-room role and/or send restriction.
func (s *ChatService) UpdateChatRoomMember(
	ctx context.Context, actorID, workspaceID, roomID, targetUserID string, in UpdateChatRoomMemberInput,
) error {
	room, err := s.authorizeRoom(ctx, actorID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if room.Kind == chatRoomKindDM {
		return Invalid("không thể quản lý thành viên trong DM")
	}
	actorMember, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: actorID,
	})
	if err != nil {
		return err
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	if !canModerateChatRoom(actorID, actorMember, room, wsMember) {
		return ErrForbidden
	}
	target, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	targetWS := db.WorkspaceMember{WorkspaceID: workspaceID, UserID: targetUserID}
	if room.Kind == chatRoomKindWorkspace {
		targetWS, err = s.ws.RequireMember(ctx, workspaceID, targetUserID)
		if err != nil {
			return ErrNotFound
		}
	}
	if in.Role != nil {
		role := strings.TrimSpace(*in.Role)
		if role != "admin" && role != "member" {
			return Invalid("role phải là admin hoặc member")
		}
		if role != target.Role {
			if role == "admin" {
				if target.Role != "member" {
					return Invalid("chỉ có thể thăng member lên admin")
				}
				if err := s.q.UpdateChatRoomMemberRole(ctx, db.UpdateChatRoomMemberRoleParams{
					RoomID: roomID, UserID: targetUserID, Role: "admin",
				}); err != nil {
					return err
				}
			} else if !canDemoteChatAdmin(actorID, actorMember, room, wsMember, target, targetWS) {
				return ErrForbidden
			} else if err := s.q.UpdateChatRoomMemberRole(ctx, db.UpdateChatRoomMemberRoleParams{
				RoomID: roomID, UserID: targetUserID, Role: "member",
			}); err != nil {
				return err
			}
		}
	}
	if in.SendRestricted != nil {
		restricted := *in.SendRestricted
		if restricted && !canRestrictChatTarget(room, target, targetWS) {
			return ErrForbidden
		}
		if err := s.q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
			RoomID: roomID, UserID: targetUserID, SendRestricted: restricted,
		}); err != nil {
			return err
		}
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return nil
}

// RemoveChatRoomMember kicks a member from a group or removes them from the workspace room.
func (s *ChatService) RemoveChatRoomMember(
	ctx context.Context, actorID, workspaceID, roomID, targetUserID string,
) error {
	room, err := s.authorizeRoom(ctx, actorID, workspaceID, roomID)
	if err != nil {
		return err
	}
	switch room.Kind {
	case chatRoomKindWorkspace:
		return s.RemoveWorkspaceRoomMember(ctx, actorID, workspaceID, roomID, targetUserID)
	case chatRoomKindGroup:
		return s.removeGroupRoomMember(ctx, actorID, workspaceID, room, targetUserID)
	default:
		return Invalid("không thể xóa thành viên khỏi DM")
	}
}

func (s *ChatService) removeGroupRoomMember(
	ctx context.Context, actorID, workspaceID string, room db.ChatRoom, targetUserID string,
) error {
	actorMember, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: actorID,
	})
	if err != nil {
		return err
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	if !canModerateChatRoom(actorID, actorMember, room, wsMember) {
		return ErrForbidden
	}
	if targetUserID == room.CreatedBy {
		return ErrForbidden
	}
	target, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if target.Role == "admin" && targetUserID != actorID {
		return ErrForbidden
	}
	if err := s.q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
		RoomID: room.ID, UserID: targetUserID,
	}); err != nil {
		return err
	}
	s.publishChatRoomMembersEvent(ctx, room.ID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": room.ID},
	})
	return nil
}

func (s *ChatService) requireCanSendInRoom(ctx context.Context, userID, roomID string, room db.ChatRoom) error {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err != nil {
		return err
	}
	if member.SendRestricted {
		return Invalid("bạn bị cấm gửi tin trong phòng này")
	}
	return s.memberCanPerformRoomAction(ctx, userID, roomID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowSendMessages
	})
}

func canModerateChatRoom(
	actorID string, actorMember db.GetActiveChatRoomMemberRow, room db.ChatRoom, wsMember db.WorkspaceMember,
) bool {
	if actorMember.Role == "admin" {
		return true
	}
	if room.Kind == chatRoomKindWorkspace && adminLikeRole(wsMember.Role) {
		return true
	}
	if room.Kind == chatRoomKindGroup && room.CreatedBy == actorID {
		return true
	}
	return false
}

func canDemoteChatAdmin(
	actorID string, _ db.GetActiveChatRoomMemberRow, room db.ChatRoom, wsMember db.WorkspaceMember,
	target db.GetActiveChatRoomMemberRow, targetWS db.WorkspaceMember,
) bool {
	if room.Kind == chatRoomKindGroup {
		if room.CreatedBy != actorID {
			return false
		}
		return target.UserID != room.CreatedBy
	}
	if adminLikeRole(wsMember.Role) {
		return targetWS.Role != "owner"
	}
	return false
}

func canRestrictChatTarget(room db.ChatRoom, target db.GetActiveChatRoomMemberRow, targetWS db.WorkspaceMember) bool {
	if target.Role == "admin" {
		return false
	}
	if room.Kind == chatRoomKindGroup && target.UserID == room.CreatedBy {
		return false
	}
	if room.Kind == chatRoomKindWorkspace && targetWS.Role == "owner" {
		return false
	}
	return true
}
