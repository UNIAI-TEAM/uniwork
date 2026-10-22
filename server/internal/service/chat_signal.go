package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SignalVoiceInvite notifies organization members of an outgoing voice call.
func (s *ChatService) SignalVoiceInvite(ctx context.Context, userID, workspaceID, roomID, callID string, video bool) error {
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
	// A call rings every member and ends in a log message under the caller's name.
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	callerName := strings.TrimSpace(u.DisplayName)
	if callerName == "" {
		callerName = u.Email
	}
	invitees, err := s.voiceCallInvitees(ctx, room, userID)
	if err != nil {
		return err
	}
	if err := s.trackVoiceCallInvite(room, callID, userID, callerName, video, invitees); err != nil {
		return err
	}
	if err := s.emitVoiceCallRings(ctx, room, userID, callID, invitees); err != nil {
		dropVoiceCallInvite(room.ID, callID)
		return err
	}
	ev := Event{
		Type: "chat.voice.invite",
		Payload: map[string]string{
			"room_id": roomID, "call_id": callID, "caller_id": userID,
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
	s.trackVoiceCallAccept(roomID, callID, userID)
	s.trackVoiceCallParticipant(roomID, callID, userID)
	// Their ring row closes either way; their phones are told to stop only
	// when the call rang them (a ring row in the database, or this node's
	// session), whichever node the answer reached.
	s.closeAnsweredRing(ctx, room, callID, userID, voiceCallInvitee(roomID, callID, userID))
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
	ctx context.Context, userID, workspaceID, roomID, callID string,
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
	// The session is gone either way, so the other side hears the hangup even
	// when the call log could not be written.
	logErr := s.finalizeVoiceCall(ctx, room, userID, callID)
	ev := Event{
		Type: "chat.voice.hangup",
		Payload: map[string]string{
			"room_id": roomID, "call_id": callID, "user_id": userID,
		},
	}
	pubErr := s.publishVoiceRoomSignal(ctx, room, userID, ev)
	return errors.Join(logErr, pubErr)
}

// SignalVoiceDecline is a callee saying no to a call that rings for them. In
// a DM it is the hangup: the call ends for both, as the call screen's own
// Decline does. In a group or channel the call goes on without them: the
// session remembers it, so the pending list and the ring pushes leave them
// out, and their ring row closes with a ring_closed row that stops their
// other Android phones. A call this node does not hold, the caller, or
// someone already in the call or already declined has nothing to decline: no
// error and nothing sent, so a retried decline from a phone is harmless.
func (s *ChatService) SignalVoiceDecline(ctx context.Context, userID, workspaceID, roomID, callID string) error {
	callID, err := normalizeVoiceCallID(callID)
	if err != nil {
		return err
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, false)
	if err != nil {
		return err
	}
	if !voiceCallMultiPartyKind(room.Kind) {
		return s.SignalVoiceHangup(ctx, userID, workspaceID, roomID, callID)
	}
	if !trackVoiceCallDecline(room.ID, callID, userID) {
		return nil
	}
	s.closeVoiceCallRings(ctx, room, callID, userID, []string{userID})
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
// the store could not answer or for a leave. visible says the beating page
// is in front of its user; only such a beat holds back chat pushes.
func (s *ChatService) SignalPresence(ctx context.Context, userID, workspaceID, state string, visible bool) ([]string, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	normalized := strings.ToLower(strings.TrimSpace(state))
	if normalized == "" {
		normalized = "online"
	}
	switch normalized {
	case "online":
		return s.presence().beat(ctx, workspaceID, userID, visible)
	case "offline":
		return nil, s.presence().leave(ctx, workspaceID, userID)
	default:
		return nil, Invalid("state must be online or offline")
	}
}

// closeRoomNotifications closes the reader's open message notifications of
// the room (a DM, a mention) and, when one of those had reached a phone
// (phone_pushed_at), writes in the same transaction the
// chat.room.notifications_cleared row the push lane turns into a "read
// elsewhere" push: the reader's Android phones take those notifications out of
// the tray and set the icon's count while the app is closed. A read that closed
// only rows no phone was shown writes nothing, so reading a quiet room, or
// chatting on the web while each push is held back because the person is
// reading, wakes no phone. Thread replies and calls stay in the tray, as in the
// app.
func (s *ChatService) closeRoomNotifications(ctx context.Context, room db.ChatRoom, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	closed, err := qtx.CloseRoomNotificationGroups(ctx, db.CloseRoomNotificationGroupsParams{
		UserID: userID, GroupKeys: []string{ChatDMNotifyGroup(room.ID), ChatMentionNotifyGroup(room.ID)},
	})
	if err != nil {
		return err
	}
	if closed > 0 {
		if err := auditRecorder.Emit(ctx, qtx, Human(userID), audit.Event{
			Topic: "chat.room.notifications_cleared", Version: 1,
			Payload:        map[string]string{"room_id": room.ID, "user_id": userID},
			OrganizationID: room.OrganizationID, WorkspaceID: roomAnchorWorkspaceID(room),
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// markChatRoomRead moves the caller's read pointer to at and, only when that
// moves it forward, tells the reader's other tabs and, in a DM, the peer who
// renders the receipt. Every client that hears chat.room.read reloads its
// sidebar, so a room-wide one (or a repeat that moved nothing) cost every open
// client a reload for nothing. A group or a non-default channel instead tells
// the sockets holding it open with chat.room.member_read, which only refetches
// that room's member list ("N người đã xem").
func (s *ChatService) markChatRoomRead(ctx context.Context, room db.ChatRoom, userID string, at pgtype.Timestamptz) error {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // reading a public channel without joining: no pointer to move
	}
	if err != nil {
		return err
	}
	// Before the pointer check: a notification that arrived after the last
	// read still closes, so the next message pushes again (UNI-1665).
	if err := s.closeRoomNotifications(ctx, room, userID); err != nil {
		slog.WarnContext(ctx, "chat: close room notifications", "room_id", room.ID, "user_id", userID, "error", err)
	}
	if member.LastReadAt.Valid && !at.Time.After(member.LastReadAt.Time) {
		return nil
	}
	if err := s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: room.ID, UserID: userID, LastReadAt: at,
	}); err != nil {
		return err
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
	// The default channel's members are the workspace: refetching that list
	// on every read in every open client costs more than the count is worth.
	if room.Kind == chatRoomKindGroup || (room.Kind == chatRoomKindChannel && !room.IsDefault) {
		s.publishChatRoomEvent(ctx, room.ID, Event{
			Type:    "chat.room.member_read",
			Payload: map[string]string{"room_id": room.ID, "user_id": userID},
		})
	}
	return nil
}
