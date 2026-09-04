package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	voiceCallOutcomeCompleted  = "completed"
	voiceCallOutcomeUnanswered = "unanswered"
	voiceCallOutcomeDeclined   = "declined"
)

// VoiceCallLogInfo is metadata for a voice_call_log chat message.
type VoiceCallLogInfo struct {
	CallID          string
	Outcome         string
	DurationSeconds int
	CallerID        string
}

type voiceCallSession struct {
	roomID     string
	callerID   string
	acceptedAt *time.Time
}

var voiceCallSessions sync.Map // key: roomID|callID

func voiceCallSessionKey(roomID, callID string) string {
	return roomID + "|" + callID
}

func (s *ChatService) trackVoiceCallInvite(roomID, callID, callerID string) {
	voiceCallSessions.Store(voiceCallSessionKey(roomID, callID), voiceCallSession{
		roomID: roomID, callerID: callerID,
	})
}

func (s *ChatService) trackVoiceCallAccept(roomID, callID string) {
	key := voiceCallSessionKey(roomID, callID)
	raw, ok := voiceCallSessions.Load(key)
	if !ok {
		return
	}
	sess := raw.(voiceCallSession)
	now := time.Now()
	sess.acceptedAt = &now
	voiceCallSessions.Store(key, sess)
}

// requireDMVoiceAllowed rejects voice signaling when either party blocked the other.
func (s *ChatService) requireDMVoiceAllowed(ctx context.Context, room db.ChatRoom, userID string) error {
	if room.Kind != chatRoomKindDM {
		return nil
	}
	peerID, err := dmPeerUserID(room, userID)
	if err != nil {
		return err
	}
	blocked, err := s.dmMessagingBlocked(ctx, roomOrganizationID(room), userID, peerID)
	if err != nil {
		return err
	}
	if blocked {
		return errChatUserBlocked()
	}
	return nil
}

// ensureVoiceRoomMember rejoins dm rooms so accept and token mint work after leave.
func (s *ChatService) ensureVoiceRoomMember(ctx context.Context, room db.ChatRoom, userID string) error {
	switch room.Kind {
	case chatRoomKindGroup:
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		if err != nil {
			return err
		}
		if !canJoin {
			return ErrForbidden
		}
		return nil
	case chatRoomKindDM:
		if !s.userInVoiceRoomMemberSet(room, userID) {
			return ErrForbidden
		}
	default:
		return ErrForbidden
	}
	if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	}); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	return s.ensureRoomMember(ctx, room.ID, anchorWS, userID, "member")
}

func (s *ChatService) userCanJoinVoiceRoom(ctx context.Context, room db.ChatRoom, userID string) (bool, error) {
	switch room.Kind {
	case chatRoomKindDM:
		if !s.userInVoiceRoomMemberSet(room, userID) {
			return false, nil
		}
		_, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
			RoomID: room.ID, UserID: userID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	case chatRoomKindGroup:
		_, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
			RoomID: room.ID, UserID: userID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	default:
		return false, nil
	}
}

func (s *ChatService) requireVoiceCallActor(ctx context.Context, room db.ChatRoom, userID string, allowRejoin bool) error {
	switch room.Kind {
	case chatRoomKindGroup:
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		if err != nil {
			return err
		}
		if !canJoin {
			return ErrForbidden
		}
		return nil
	case chatRoomKindDM:
		if !s.userInVoiceRoomMemberSet(room, userID) {
			return ErrForbidden
		}
		if !allowRejoin {
			return nil
		}
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		if err != nil {
			return err
		}
		if canJoin {
			return nil
		}
		return s.ensureVoiceRoomMember(ctx, room, userID)
	default:
		return ErrForbidden
	}
}

// requireVoiceTokenAccess validates membership before minting a LiveKit token.
func (s *ChatService) requireVoiceTokenAccess(ctx context.Context, room db.ChatRoom, userID, wsID string) error {
	switch room.Kind {
	case chatRoomKindGroup:
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		if err != nil {
			return err
		}
		if !canJoin {
			return ErrForbidden
		}
		return nil
	case chatRoomKindDM:
		if !s.userInVoiceRoomMemberSet(room, userID) {
			return ErrForbidden
		}
		if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
			RoomID: room.ID, UserID: userID,
		}); err == nil {
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return s.ensureVoiceRoomMember(ctx, room, userID)
	case chatRoomKindWorkspace:
		if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
			RoomID: room.ID, UserID: userID,
		}); err == nil {
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if syncErr := s.syncWorkspaceRoomMembers(ctx, room.ID, wsID); syncErr != nil {
			return syncErr
		}
		if _, retryErr := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
			RoomID: room.ID, UserID: userID,
		}); retryErr != nil {
			if errors.Is(retryErr, pgx.ErrNoRows) {
				return ErrForbidden
			}
			return retryErr
		}
		return nil
	default:
		return ErrForbidden
	}
}

func liveKitRoomForActiveVoiceCall(room db.ChatRoom, callID string) (string, error) {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return "", Invalid("call_id is required")
	}
	key := voiceCallSessionKey(room.ID, callID)
	if _, ok := voiceCallSessions.Load(key); !ok {
		return "", ErrForbidden
	}
	const maxLen = 240
	suffix := "-" + callID
	base := room.LivekitRoomName
	if len(base)+len(suffix) > maxLen {
		base = base[:maxLen-len(suffix)]
	}
	return base + suffix, nil
}

func (s *ChatService) userInVoiceRoomMemberSet(room db.ChatRoom, userID string) bool {
	userID = strings.ToUpper(strings.TrimSpace(userID))
	if !room.MemberSetKey.Valid {
		return false
	}
	for _, id := range strings.Split(room.MemberSetKey.String, memberSetDelimiter) {
		if strings.ToUpper(strings.TrimSpace(id)) == userID {
			return true
		}
	}
	return false
}

func (s *ChatService) publishVoiceRoomSignal(ctx context.Context, room db.ChatRoom, actorID string, ev Event) error {
	switch room.Kind {
	case chatRoomKindDM:
		targetUserID, err := dmPeerUserID(room, actorID)
		if err != nil {
			return err
		}
		ev.Payload["call_kind"] = chatRoomKindDM
		ev.Payload["target_user_id"] = targetUserID
	case chatRoomKindGroup:
		ev.Payload["call_kind"] = chatRoomKindGroup
		ev.Payload["room_name"] = strings.TrimSpace(room.Name)
	default:
		return Invalid("cuộc gọi thoại không khả dụng trong phòng này")
	}
	s.publishChatRoomEvent(ctx, room.ID, ev)
	if room.Kind == chatRoomKindDM {
		if targetUserID := strings.TrimSpace(ev.Payload["target_user_id"]); targetUserID != "" {
			s.pub.SendToUser(ctx, targetUserID, ev)
		}
	} else if room.Kind == chatRoomKindGroup {
		s.publishChatRoomMembersEvent(ctx, room.ID, ev)
	}
	return nil
}

// authorizeVoiceSignalRoom validates workspace access, block rules, and room membership.
// When allowRejoin is true, dm/group callers who left may rejoin (accept / token mint).
func (s *ChatService) authorizeVoiceSignalRoom(
	ctx context.Context, userID, workspaceID, roomID string, allowRejoin bool,
) (db.ChatRoom, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err == nil {
		if blockErr := s.requireDMVoiceAllowed(ctx, room, userID); blockErr != nil {
			return db.ChatRoom{}, blockErr
		}
		return room, nil
	}
	if !allowRejoin || !errors.Is(err, ErrForbidden) {
		return db.ChatRoom{}, err
	}
	w, wErr := s.workspaceForChat(ctx, userID, workspaceID)
	if wErr != nil {
		return db.ChatRoom{}, wErr
	}
	room, rErr := s.q.GetChatRoomByID(ctx, roomID)
	if errors.Is(rErr, pgx.ErrNoRows) {
		return db.ChatRoom{}, ErrNotFound
	}
	if rErr != nil {
		return db.ChatRoom{}, rErr
	}
	if room.Kind == chatRoomKindWorkspace {
		return db.ChatRoom{}, ErrForbidden
	}
	if !room.OrganizationID.Valid || room.OrganizationID.String != w.OrganizationID {
		return db.ChatRoom{}, ErrNotFound
	}
	if blockErr := s.requireDMVoiceAllowed(ctx, room, userID); blockErr != nil {
		return db.ChatRoom{}, blockErr
	}
	if memberErr := s.ensureVoiceRoomMember(ctx, room, userID); memberErr != nil {
		return db.ChatRoom{}, memberErr
	}
	return room, nil
}

func (s *ChatService) finalizeVoiceCall(
	ctx context.Context, room db.ChatRoom, userID, callID string, clientDuration *int,
) error {
	key := voiceCallSessionKey(room.ID, callID)
	raw, ok := voiceCallSessions.LoadAndDelete(key)
	if !ok {
		return nil
	}
	sess := raw.(voiceCallSession)
	outcome, duration := voiceCallOutcome(sess, userID, clientDuration)
	meta, err := json.Marshal(map[string]any{
		"call_id":          callID,
		"outcome":          outcome,
		"duration_seconds": duration,
		"caller_id":        sess.callerID,
	})
	if err != nil {
		return err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.CreateChatVoiceCallLog(ctx, db.CreateChatVoiceCallLogParams{
		ID:          util.NewID(),
		RoomID:      room.ID,
		WorkspaceID: anchorWS,
		SenderID:    sess.callerID,
		Metadata:    meta,
	})
	if err != nil {
		return err
	}
	_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
	ev := Event{
		Type: "chat.message.created",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": msg.ID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace:
		s.pub.Publish(ctx, anchorWS, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
	return nil
}

func voiceCallOutcome(sess voiceCallSession, hungUpBy string, clientDuration *int) (string, int) {
	if sess.acceptedAt != nil {
		duration := int(time.Since(*sess.acceptedAt).Seconds())
		if clientDuration != nil && *clientDuration > duration {
			duration = *clientDuration
		}
		if duration < 0 {
			duration = 0
		}
		return voiceCallOutcomeCompleted, duration
	}
	if hungUpBy != sess.callerID {
		return voiceCallOutcomeDeclined, 0
	}
	return voiceCallOutcomeUnanswered, 0
}

func voiceCallLogFromMetadata(kind string, raw []byte) *VoiceCallLogInfo {
	if kind != "voice_call_log" || len(raw) == 0 {
		return nil
	}
	var meta struct {
		CallID          string `json:"call_id"`
		Outcome         string `json:"outcome"`
		DurationSeconds int    `json:"duration_seconds"`
		CallerID        string `json:"caller_id"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || meta.Outcome == "" {
		return nil
	}
	return &VoiceCallLogInfo{
		CallID:          meta.CallID,
		Outcome:         meta.Outcome,
		DurationSeconds: meta.DurationSeconds,
		CallerID:        meta.CallerID,
	}
}

func chatMessageRowFromListRow(row db.ListChatMessagesByRoomRow) ChatMessageRow {
	msg := ChatMessageRow{
		ID:                row.ID,
		RoomID:            row.RoomID,
		WorkspaceID:       row.WorkspaceID,
		SenderID:          row.SenderID,
		SenderDisplayName: row.SenderDisplayName,
		Body:              row.Body,
		Kind:              row.Kind,
		CreatedAt:         row.CreatedAt.Time,
		Reactions:         reactionCountsFromMetadata(row.Metadata),
		VoiceCall:         voiceCallLogFromMetadata(row.Kind, row.Metadata),
	}
	if row.ReplyToMessageID.Valid {
		s := row.ReplyToMessageID.String
		msg.ReplyToMessageID = &s
	}
	return msg
}

// unused import guard for pgtype in case — actually not needed, remove pgtype import if unused
