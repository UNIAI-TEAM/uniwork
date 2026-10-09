package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SignalVoiceInvite notifies organization members of an outgoing voice call.
func (s *ChatService) SignalVoiceInvite(ctx context.Context, userID, workspaceID, roomID, callID string) error {
	callID, err := normalizeVoiceCallID(callID)
	if err != nil {
		return err
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, false)
	if err != nil {
		return err
	}
	if isWorkspaceDefaultRoom(room) {
		return Invalid("cuộc gọi thoại không khả dụng trong phòng workspace")
	}
	if room.Kind != chatRoomKindDM && !voiceCallMultiPartyKind(room.Kind) {
		return Invalid("cuộc gọi thoại chỉ khả dụng trong tin nhắn trực tiếp, nhóm hoặc kênh")
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
	callID, err := normalizeVoiceCallID(callID)
	if err != nil {
		return err
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, true); err != nil {
		return err
	}
	s.trackVoiceCallAccept(roomID, callID)
	s.trackVoiceCallParticipant(roomID, callID, userID)
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
	callID, err := normalizeVoiceCallID(callID)
	if err != nil {
		return err
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, false); err != nil {
		return err
	}
	if voiceCallMultiPartyKind(room.Kind) {
		key := voiceCallSessionKey(roomID, callID)
		sess, ok := loadVoiceCallSession(key)
		if !ok {
			return ErrForbidden
		}
		if sess.callerID != userID {
			return ErrForbidden
		}
	}
	s.trackVoiceCallParticipant(roomID, callID, userID)
	s.stopVoiceRecordingOnHangup(ctx, room, callID, userID)
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
	if isWorkspaceDefaultRoom(room) {
		s.pub.Publish(ctx, workspaceID, ev)
		return nil
	}
	s.publishChatRoomEvent(ctx, roomID, ev)
	return nil
}

// SignalPresence records a presence heartbeat ("online", the default) or an
// explicit leave ("offline") in the workspace. The workspace hears about it
// only when the caller's state changes (chat_presence.go). An online beat
// returns the users online in the workspace, the caller included; nil when
// the store could not answer or for a leave.
func (s *ChatService) SignalPresence(ctx context.Context, userID, workspaceID, state string) ([]string, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	normalized := strings.ToLower(strings.TrimSpace(state))
	if normalized == "" {
		normalized = "online"
	}
	switch normalized {
	case "online":
		return s.presence().beat(ctx, workspaceID, userID)
	case "offline":
		return nil, s.presence().leave(ctx, workspaceID, userID)
	default:
		return nil, Invalid("state must be online or offline")
	}
}

// markChatRoomRead moves the caller's read pointer to at and, only when that
// moves it forward, tells the reader's other tabs and, in a DM, the peer who
// renders the receipt. Nobody else shows another person's read state, and
// every client that hears one reloads its sidebar, so a room-wide read (or a
// repeat that moved nothing) cost every open client a reload for nothing.
func (s *ChatService) markChatRoomRead(ctx context.Context, room db.ChatRoom, userID string, at pgtype.Timestamptz) {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return // reading a public channel without joining: no pointer to move
	}
	if err == nil && member.LastReadAt.Valid && !at.Time.After(member.LastReadAt.Time) {
		return
	}
	if err := s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: room.ID, UserID: userID, LastReadAt: at,
	}); err != nil {
		return
	}
	ev := Event{
		Type: "chat.room.read",
		Payload: map[string]string{
			"room_id": room.ID,
			"user_id": userID,
		},
	}
	s.pub.SendToUser(ctx, userID, ev)
	if peerID, err := dmPeerUserID(room, userID); err == nil {
		s.pub.SendToUser(ctx, peerID, ev)
	}
}
