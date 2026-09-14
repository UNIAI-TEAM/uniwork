package service

import (
	"context"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SignalVoiceInvite notifies organization members of an outgoing voice call.
func (s *ChatService) SignalVoiceInvite(ctx context.Context, userID, workspaceID, roomID, callID string) error {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, false)
	if err != nil {
		return err
	}
	if isWorkspaceDefaultRoom(room) {
		return Invalid("cuộc gọi thoại không khả dụng trong phòng workspace")
	}
	if room.Kind != chatRoomKindDM && room.Kind != chatRoomKindGroup {
		return Invalid("cuộc gọi thoại chỉ khả dụng trong tin nhắn trực tiếp hoặc nhóm")
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	callerName := strings.TrimSpace(u.DisplayName)
	if callerName == "" {
		callerName = u.Email
	}
	s.trackVoiceCallInvite(room, callID, userID, callerName)
	ev := Event{
		Type: "chat.voice.invite",
		Payload: map[string]string{
			"room_id": roomID, "call_id": callID,
			"caller_id": userID, "caller_name": callerName,
		},
	}
	return s.publishVoiceRoomSignal(ctx, room, userID, ev)
}

// SignalVoiceAccept notifies room members that a voice call was answered.
func (s *ChatService) SignalVoiceAccept(ctx context.Context, userID, workspaceID, roomID, callID string) error {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, true); err != nil {
		return err
	}
	s.trackVoiceCallAccept(roomID, callID)
	ev := Event{
		Type: "chat.voice.accept",
		Payload: map[string]string{
			"room_id": roomID, "call_id": callID, "user_id": userID,
		},
	}
	return s.publishVoiceRoomSignal(ctx, room, userID, ev)
}

// SignalVoiceHangup notifies room members that a voice call ended.
func (s *ChatService) SignalVoiceHangup(
	ctx context.Context, userID, workspaceID, roomID, callID string, durationSeconds *int,
) error {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, false); err != nil {
		return err
	}
	if room.Kind == chatRoomKindGroup {
		key := voiceCallSessionKey(roomID, callID)
		raw, ok := voiceCallSessions.Load(key)
		if !ok {
			return ErrForbidden
		}
		sess := raw.(voiceCallSession)
		if sess.callerID != userID {
			return ErrForbidden
		}
	}
	if logErr := s.finalizeVoiceCall(ctx, room, userID, callID, durationSeconds); logErr != nil {
		return logErr
	}
	ev := Event{
		Type: "chat.voice.hangup",
		Payload: map[string]string{
			"room_id": roomID, "call_id": callID, "user_id": userID,
		},
	}
	if pubErr := s.publishVoiceRoomSignal(ctx, room, userID, ev); pubErr != nil {
		return pubErr
	}
	return nil
}

// SignalTyping broadcasts a typing indicator for a chat room.
func (s *ChatService) SignalTyping(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if err := s.requireCanSendInRoom(ctx, userID, roomID, room); err != nil {
		return err
	}
	if !shouldPublishTyping(userID, roomID, time.Now()) {
		return nil
	}
	ev := Event{
		Type: "chat.typing",
		Payload: map[string]string{
			"room_id": roomID, "user_id": userID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		s.pub.Publish(ctx, workspaceID, ev)
	default:
		s.publishChatRoomEvent(ctx, roomID, ev)
	}
	return nil
}

// SignalPresence broadcasts that the caller is online or offline in the workspace.
func (s *ChatService) SignalPresence(ctx context.Context, userID, workspaceID, state string) error {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return err
	}
	normalized := strings.ToLower(strings.TrimSpace(state))
	if normalized == "" {
		normalized = "online"
	}
	if normalized != "online" && normalized != "offline" {
		return Invalid("state must be online or offline")
	}
	topic := "user.presence"
	if normalized == "online" {
		if !shouldPublishPresence(userID, time.Now()) {
			return nil
		}
	} else {
		clearPresenceThrottle(userID)
		topic = "user.offline"
	}
	s.pub.Publish(ctx, workspaceID, Event{
		Type: topic,
		Payload: map[string]string{
			"user_id": userID,
		},
	})
	return nil
}

func (s *ChatService) publishChatRoomRead(ctx context.Context, room db.ChatRoom, userID string) {
	ev := Event{
		Type: "chat.room.read",
		Payload: map[string]string{
			"room_id": room.ID,
			"user_id": userID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		s.pub.Publish(ctx, roomAnchorWorkspaceID(room), ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
	}
}
