package service

import (
	"context"
	"encoding/json"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatRoomMemberPermissions are group/workspace settings for regular members.
type ChatRoomMemberPermissions struct {
	AllowChangeProfile bool `json:"allow_change_profile"`
	AllowPinContent    bool `json:"allow_pin_content"`
	AllowCreateNotes   bool `json:"allow_create_notes"`
	AllowCreatePolls   bool `json:"allow_create_polls"`
	AllowSendMessages  bool `json:"allow_send_messages"`
}

func defaultChatRoomMemberPermissions() ChatRoomMemberPermissions {
	return ChatRoomMemberPermissions{
		AllowChangeProfile: true,
		AllowPinContent:    true,
		AllowCreateNotes:   true,
		AllowCreatePolls:   true,
		AllowSendMessages:  true,
	}
}

func memberPermissionsFromRaw(raw []byte) ChatRoomMemberPermissions {
	if len(raw) == 0 {
		return defaultChatRoomMemberPermissions()
	}
	var out ChatRoomMemberPermissions
	if err := json.Unmarshal(raw, &out); err != nil {
		return defaultChatRoomMemberPermissions()
	}
	return out
}

func encodeMemberPermissions(perms ChatRoomMemberPermissions) ([]byte, error) {
	return json.Marshal(perms)
}

type UpdateChatRoomSettingsInput struct {
	Name              *string
	MemberPermissions *ChatRoomMemberPermissions
}

// GetRoomMemberPermissions returns member permission settings for a room the caller can access.
func (s *ChatService) GetRoomMemberPermissions(
	ctx context.Context, userID, workspaceID, roomID string,
) (ChatRoomMemberPermissions, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	return memberPermissionsFromRaw(room.MemberPermissions), nil
}

// UpdateChatRoomSettings updates room name and/or member permissions.
func (s *ChatService) UpdateChatRoomSettings(
	ctx context.Context, actorID, workspaceID, roomID string, in UpdateChatRoomSettingsInput,
) (ChatRoomMemberPermissions, error) {
	room, err := s.authorizeRoom(ctx, actorID, workspaceID, roomID)
	if err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	if room.Kind == chatRoomKindDM {
		return ChatRoomMemberPermissions{}, Invalid("không thể cấu hình quyền trong DM")
	}
	actorMember, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: actorID,
	})
	if err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	isModerator := canModerateChatRoom(actorID, actorMember, room, wsMember)

	if in.MemberPermissions != nil {
		if !isModerator {
			return ChatRoomMemberPermissions{}, ErrForbidden
		}
		perms := *in.MemberPermissions
		encoded, err := encodeMemberPermissions(perms)
		if err != nil {
			return ChatRoomMemberPermissions{}, err
		}
		if err := s.q.UpdateChatRoomMemberPermissions(ctx, db.UpdateChatRoomMemberPermissionsParams{
			ID: roomID, MemberPermissions: encoded,
		}); err != nil {
			return ChatRoomMemberPermissions{}, err
		}
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return ChatRoomMemberPermissions{}, Invalid("tên phòng không được để trống")
		}
		if !isModerator {
			if err := s.memberCanPerformRoomAction(ctx, actorID, roomID, room, func(p ChatRoomMemberPermissions) bool {
				return p.AllowChangeProfile
			}); err != nil {
				return ChatRoomMemberPermissions{}, err
			}
		}
		if err := s.q.UpdateChatRoomName(ctx, db.UpdateChatRoomNameParams{
			ID: roomID, Name: name,
		}); err != nil {
			return ChatRoomMemberPermissions{}, err
		}
	}
	perms := memberPermissionsFromRaw(room.MemberPermissions)
	if in.MemberPermissions != nil {
		perms = *in.MemberPermissions
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return perms, nil
}

func (s *ChatService) memberCanPerformRoomAction(
	ctx context.Context, userID, roomID string, room db.ChatRoom, check func(ChatRoomMemberPermissions) bool,
) error {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err != nil {
		return err
	}
	if member.Role == "admin" {
		return nil
	}
	if room.Kind == chatRoomKindGroup && room.CreatedBy == userID {
		return nil
	}
	perms := memberPermissionsFromRaw(room.MemberPermissions)
	if !check(perms) {
		return ErrForbidden
	}
	return nil
}
