package service

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatRoomMemberPermissions are group/workspace settings for regular members.
type ChatRoomMemberPermissions struct {
	AllowChangeProfile bool `json:"allow_change_profile"`
	AllowPinContent    bool `json:"allow_pin_content"`
	AllowCreateNotes   bool `json:"allow_create_notes"`
	AllowCreatePolls   bool `json:"allow_create_polls"`
	AllowSendMessages  bool `json:"allow_send_messages"`
	// AllowForward lets members forward this room's messages elsewhere.
	AllowForward bool `json:"allow_forward"`
}

// chatRoomNameMaxRunes caps a renamed group or workspace room, the same as a channel name.
const chatRoomNameMaxRunes = 80

func defaultChatRoomMemberPermissions() ChatRoomMemberPermissions {
	return ChatRoomMemberPermissions{
		AllowChangeProfile: true,
		AllowPinContent:    true,
		AllowCreateNotes:   true,
		AllowCreatePolls:   true,
		AllowSendMessages:  true,
		AllowForward:       true,
	}
}

func memberPermissionsFromRaw(raw []byte) ChatRoomMemberPermissions {
	if len(raw) == 0 {
		return defaultChatRoomMemberPermissions()
	}
	// A key the stored row predates (allow_forward) keeps its default.
	out := defaultChatRoomMemberPermissions()
	if err := json.Unmarshal(raw, &out); err != nil {
		return defaultChatRoomMemberPermissions()
	}
	return out
}

func encodeMemberPermissions(perms ChatRoomMemberPermissions) ([]byte, error) {
	return json.Marshal(perms)
}

type UpdateChatRoomSettingsInput struct {
	Name *string
	// Topic is the room's description; "" clears it.
	Topic             *string
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

	// Validate and authorize everything before the first write, so a refused
	// request changes nothing.
	current := memberPermissionsFromRaw(room.MemberPermissions)
	changes := map[string]audit.Change{}
	if in.MemberPermissions != nil {
		if !isModerator {
			return ChatRoomMemberPermissions{}, ErrForbidden
		}
		if *in.MemberPermissions != current {
			changes["member_permissions"] = audit.Change{From: current, To: *in.MemberPermissions}
		}
	}
	var name string
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if name == "" {
			return ChatRoomMemberPermissions{}, Invalid("tên phòng không được để trống")
		}
		if utf8.RuneCountInString(name) > chatRoomNameMaxRunes {
			return ChatRoomMemberPermissions{}, Invalid("tên phòng tối đa 80 ký tự")
		}
		// Only a group lets regular members rename it; a channel, the default
		// one included, is renamed by its moderators.
		if !isModerator && (room.Kind != chatRoomKindGroup || !current.AllowChangeProfile) {
			return ChatRoomMemberPermissions{}, ErrForbidden
		}
		if name != room.Name {
			changes["name"] = audit.Change{From: room.Name, To: name}
		}
	}
	var topic string
	if in.Topic != nil {
		topic = strings.TrimSpace(*in.Topic)
		if utf8.RuneCountInString(topic) > chatChannelTopicMaxRunes {
			return ChatRoomMemberPermissions{}, Invalid("mô tả tối đa 280 ký tự")
		}
		// The description follows the rename rule.
		if !isModerator && (room.Kind != chatRoomKindGroup || !current.AllowChangeProfile) {
			return ChatRoomMemberPermissions{}, ErrForbidden
		}
		if topic != room.Topic {
			changes["topic"] = audit.Change{From: room.Topic, To: topic}
		}
	}
	if len(changes) == 0 {
		return current, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	perms := current
	if _, ok := changes["member_permissions"]; ok {
		perms = *in.MemberPermissions
		encoded, err := encodeMemberPermissions(perms)
		if err != nil {
			return ChatRoomMemberPermissions{}, err
		}
		if err := q.UpdateChatRoomMemberPermissions(ctx, db.UpdateChatRoomMemberPermissionsParams{
			ID: roomID, MemberPermissions: encoded,
		}); err != nil {
			return ChatRoomMemberPermissions{}, err
		}
	}
	if _, ok := changes["name"]; ok {
		if err := q.UpdateChatRoomName(ctx, db.UpdateChatRoomNameParams{
			ID: roomID, Name: name,
		}); err != nil {
			return ChatRoomMemberPermissions{}, err
		}
	}
	if _, ok := changes["topic"]; ok {
		if err := q.UpdateChatRoomTopic(ctx, db.UpdateChatRoomTopicParams{
			ID: roomID, Topic: topic,
		}); err != nil {
			return ChatRoomMemberPermissions{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
		Actor:          audit.User(actorID),
		Action:         audit.ActionChatRoomSettingsUpdated,
		ResourceType:   "chat_room",
		ResourceID:     roomID,
		Changes:        changes,
	}); err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatRoomMemberPermissions{}, err
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return perms, nil
}

func memberMayPerform(
	member db.GetActiveChatRoomMemberRow, userID string, room db.ChatRoom, check func(ChatRoomMemberPermissions) bool,
) error {
	if member.Role == "admin" {
		return nil
	}
	if room.Kind == chatRoomKindGroup && room.CreatedBy == userID {
		return nil
	}
	if !check(memberPermissionsFromRaw(room.MemberPermissions)) {
		return ErrForbidden
	}
	return nil
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
	return memberMayPerform(member, userID, room, check)
}
