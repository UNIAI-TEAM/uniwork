package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	voiceCallOutcomeCompleted  = "completed"
	voiceCallOutcomeUnanswered = "unanswered"
	voiceCallOutcomeDeclined   = "declined"
)

func voiceCallMultiPartyKind(kind string) bool {
	return kind == chatRoomKindGroup || kind == chatRoomKindChannel
}

// VoiceCallParticipant is one person listed on a voice_call_log message.
type VoiceCallParticipant struct {
	UserID      string
	DisplayName string
}

// VoiceCallLogInfo is metadata for a voice_call_log chat message.
type VoiceCallLogInfo struct {
	CallID          string
	Outcome         string
	DurationSeconds int
	CallerID        string
	RecordingID     string
	RecordingStatus string
	RecordingURL    string
	Participants    []VoiceCallParticipant
}

type voiceCallSession struct {
	roomID         string
	callID         string
	callerID       string
	callerName     string
	callKind       string
	roomName       string
	invitedAt      time.Time
	acceptedAt     *time.Time
	participantIDs []string
}

const voiceCallInvitePendingTTL = 5 * time.Minute

var voiceCallSessions sync.Map // key: roomID|callID

func voiceCallSessionKey(roomID, callID string) string {
	return roomID + "|" + callID
}

func appendVoiceCallParticipantID(ids []string, userID string) []string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ids
	}
	for _, id := range ids {
		if id == userID {
			return ids
		}
	}
	return append(ids, userID)
}

func (s *ChatService) trackVoiceCallParticipant(roomID, callID, userID string) {
	key := voiceCallSessionKey(roomID, callID)
	raw, ok := voiceCallSessions.Load(key)
	if !ok {
		return
	}
	sess := raw.(voiceCallSession)
	sess.participantIDs = appendVoiceCallParticipantID(sess.participantIDs, userID)
	voiceCallSessions.Store(key, sess)
}

func (s *ChatService) trackVoiceCallInvite(room db.ChatRoom, callID, callerID, callerName string) {
	now := time.Now()
	sess := voiceCallSession{
		roomID:         room.ID,
		callID:         callID,
		callerID:       callerID,
		callerName:     callerName,
		callKind:       room.Kind,
		roomName:       strings.TrimSpace(room.Name),
		invitedAt:      now,
		participantIDs: []string{callerID},
	}
	// Group/channel calls connect immediately — there is no separate accept
	// signal from the caller, but the log still needs a completed window.
	if voiceCallMultiPartyKind(room.Kind) {
		sess.acceptedAt = &now
	}
	voiceCallSessions.Store(voiceCallSessionKey(room.ID, callID), sess)
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
	case chatRoomKindGroup, chatRoomKindChannel:
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
	case chatRoomKindGroup, chatRoomKindChannel:
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
	case chatRoomKindGroup, chatRoomKindChannel:
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
	case chatRoomKindGroup, chatRoomKindChannel:
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

// PendingVoiceInvite is an unanswered voice/video call waiting for the callee.
type PendingVoiceInvite struct {
	RoomID     string
	CallID     string
	CallerID   string
	CallerName string
	CallKind   string
	RoomName   string
	InvitedAt  time.Time
}

// ListPendingVoiceInvites returns active ring invites the caller may have missed while offline.
func (s *ChatService) ListPendingVoiceInvites(
	ctx context.Context, userID, workspaceID string,
) ([]PendingVoiceInvite, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	out := make([]PendingVoiceInvite, 0)
	voiceCallSessions.Range(func(_ any, value any) bool {
		sess, ok := value.(voiceCallSession)
		if !ok || sess.acceptedAt != nil || sess.callerID == userID {
			return true
		}
		if now.Sub(sess.invitedAt) > voiceCallInvitePendingTTL {
			return true
		}
		room, err := s.q.GetChatRoomByID(ctx, sess.roomID)
		if err != nil {
			return true
		}
		if !room.OrganizationID.Valid || room.OrganizationID.String != w.OrganizationID {
			return true
		}
		if !s.userIsVoiceInviteRecipient(ctx, room, userID, sess.callerID) {
			return true
		}
		if blockErr := s.requireDMVoiceAllowed(ctx, room, userID); blockErr != nil {
			return true
		}
		out = append(out, PendingVoiceInvite{
			RoomID:     sess.roomID,
			CallID:     sess.callID,
			CallerID:   sess.callerID,
			CallerName: sess.callerName,
			CallKind:   sess.callKind,
			RoomName:   sess.roomName,
			InvitedAt:  sess.invitedAt,
		})
		return true
	})
	return out, nil
}

func (s *ChatService) userIsVoiceInviteRecipient(
	ctx context.Context, room db.ChatRoom, userID, callerID string,
) bool {
	switch room.Kind {
	case chatRoomKindDM:
		peerID, err := dmPeerUserID(room, callerID)
		return err == nil && peerID == userID
	case chatRoomKindGroup:
		if !s.userInVoiceRoomMemberSet(room, userID) {
			return false
		}
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		return err == nil && canJoin
	case chatRoomKindChannel:
		canJoin, err := s.userCanJoinVoiceRoom(ctx, room, userID)
		return err == nil && canJoin
	default:
		return false
	}
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
	case chatRoomKindChannel:
		ev.Payload["call_kind"] = chatRoomKindChannel
		ev.Payload["room_name"] = strings.TrimSpace(room.Name)
	default:
		return Invalid("cuộc gọi thoại không khả dụng trong phòng này")
	}
	s.publishChatRoomEvent(ctx, room.ID, ev)
	if room.Kind == chatRoomKindDM {
		if targetUserID := strings.TrimSpace(ev.Payload["target_user_id"]); targetUserID != "" {
			s.pub.SendToUser(ctx, targetUserID, ev)
		}
	} else if voiceCallMultiPartyKind(room.Kind) {
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
	if isWorkspaceDefaultRoom(room) {
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
	participantIDs := voiceCallParticipantIDsForLog(room, sess)
	participants, err := s.resolveVoiceCallParticipants(ctx, participantIDs)
	if err != nil {
		return err
	}
	metaMap := map[string]any{
		"call_id":          callID,
		"outcome":          outcome,
		"duration_seconds": duration,
		"caller_id":        sess.callerID,
	}
	if len(participants) > 0 {
		rows := make([]map[string]string, 0, len(participants))
		for _, p := range participants {
			rows = append(rows, map[string]string{
				"user_id": p.UserID, "display_name": p.DisplayName,
			})
		}
		metaMap["participants"] = rows
	}
	anchorWS := roomAnchorWorkspaceID(room)
	// Pre-create message id so recording metadata can reference it before insert.
	msgID := util.NewID()
	metaMap = s.attachVoiceRecordingToCallLog(ctx, room, callID, msgID, metaMap)
	meta, err := json.Marshal(metaMap)
	if err != nil {
		return err
	}
	msg, err := s.q.CreateChatVoiceCallLog(ctx, db.CreateChatVoiceCallLogParams{
		ID:          msgID,
		RoomID:      room.ID,
		WorkspaceID: anchorWS,
		SenderID:    sess.callerID,
		Metadata:    meta,
	})
	if err != nil {
		return err
	}
	_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
	s.publishCreatedChatMessage(ctx, room, msg.ID)

	if outcome == voiceCallOutcomeCompleted && duration >= voiceCallSummaryMinDuration {
		endedAt := time.Now().UTC()
		startedAt := endedAt.Add(-time.Duration(duration) * time.Second)
		if sess.acceptedAt != nil {
			startedAt = sess.acceptedAt.UTC()
		}
		payload := map[string]string{
			"room_id":             room.ID,
			"workspace_id":        anchorWS,
			"organization_id":     roomOrganizationID(room),
			"call_id":             callID,
			"call_log_message_id": msgID,
			"caller_id":           sess.callerID,
			"started_at":          startedAt.Format(time.RFC3339),
			"ended_at":            endedAt.Format(time.RFC3339),
			"duration_seconds":    fmt.Sprintf("%d", duration),
			"duration_label":      formatVoiceCallDurationLabel(duration),
			"participants":        formatVoiceCallParticipantNames(participants),
		}
		if emitErr := s.emitVoiceCallCompleted(ctx, room, payload); emitErr != nil {
			return emitErr
		}
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

func voiceCallParticipantIDsForLog(room db.ChatRoom, sess voiceCallSession) []string {
	ids := append([]string(nil), sess.participantIDs...)
	if room.Kind == chatRoomKindDM {
		if peerID, err := dmPeerUserID(room, sess.callerID); err == nil {
			ids = appendVoiceCallParticipantID(ids, peerID)
		}
	}
	return ids
}

func (s *ChatService) resolveVoiceCallParticipants(ctx context.Context, ids []string) ([]VoiceCallParticipant, error) {
	out := make([]VoiceCallParticipant, 0, len(ids))
	for _, id := range ids {
		u, err := s.q.GetUserByID(ctx, id)
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(u.DisplayName)
		if name == "" {
			name = u.Email
		}
		out = append(out, VoiceCallParticipant{UserID: id, DisplayName: name})
	}
	return out, nil
}

func voiceCallParticipantsFromMetadata(raw []byte) []VoiceCallParticipant {
	var meta struct {
		Participants []struct {
			UserID      string `json:"user_id"`
			DisplayName string `json:"display_name"`
		} `json:"participants"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || len(meta.Participants) == 0 {
		return nil
	}
	out := make([]VoiceCallParticipant, 0, len(meta.Participants))
	for _, row := range meta.Participants {
		if strings.TrimSpace(row.UserID) == "" {
			continue
		}
		out = append(out, VoiceCallParticipant{
			UserID:      row.UserID,
			DisplayName: strings.TrimSpace(row.DisplayName),
		})
	}
	return out
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
		RecordingID     string `json:"recording_id"`
		RecordingStatus string `json:"recording_status"`
		RecordingURL    string `json:"recording_url"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || meta.Outcome == "" {
		return nil
	}
	return &VoiceCallLogInfo{
		CallID:          meta.CallID,
		Outcome:         meta.Outcome,
		DurationSeconds: meta.DurationSeconds,
		CallerID:        meta.CallerID,
		RecordingID:     meta.RecordingID,
		RecordingStatus: meta.RecordingStatus,
		RecordingURL:    meta.RecordingURL,
		Participants:    voiceCallParticipantsFromMetadata(raw),
	}
}

func chatMessageRowFromListRow(row db.ListChatMessagesByRoomRow, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		row.ID, row.RoomID, row.WorkspaceID, row.SenderID, row.SenderDisplayName,
		row.Kind, row.Body, row.Metadata, row.ReplyToMessageID, row.EditedAt, row.CreatedAt, viewerID,
	)
	out.ClientMsgID = row.ClientMsgID.String
	applyThreadFields(&out, row.ThreadRootID, row.ReplyCount, row.LastReplyAt)
	return out
}

func applyThreadFields(out *ChatMessageRow, threadRootID pgtype.Text, replyCount int32, lastReplyAt pgtype.Timestamptz) {
	if threadRootID.Valid {
		s := threadRootID.String
		out.ThreadRootID = &s
	}
	out.ReplyCount = int(replyCount)
	if lastReplyAt.Valid {
		t := lastReplyAt.Time
		out.LastReplyAt = &t
	}
}

func chatMessageRowFromMessageFields(
	id, roomID, workspaceID, senderID, senderDisplayName, kind, body string,
	metadata []byte,
	replyToMessageID pgtype.Text,
	editedAt, createdAt pgtype.Timestamptz,
	viewerID string,
) ChatMessageRow {
	msg := ChatMessageRow{
		ID: id, RoomID: roomID, WorkspaceID: workspaceID,
		SenderID: senderID, SenderDisplayName: senderDisplayName,
		Body: body, Kind: kind,
		CreatedAt:        createdAt.Time,
		Reactions:        reactionCountsFromMetadata(metadata),
		MyReactions:      myReactionsFromMetadata(metadata, viewerID),
		Pinned:           pinFromMetadata(metadata),
		MentionedUserIDs: mentionedUserIDsFromMetadata(metadata),
		VoiceCall:        voiceCallLogFromMetadata(kind, metadata),
		VoiceCallSummary: voiceCallSummaryFromMetadata(kind, metadata),
		Voice:            voiceMessageFromMetadata(kind, metadata),
		File:             fileMessageFromMetadata(kind, metadata),
		Poll:             pollFromMetadata(kind, metadata, viewerID),
		Reminder:         reminderFromMetadata(kind, metadata),
		Note:             noteFromMetadata(kind, metadata, body),
		Post:             postFromMetadata(kind, metadata, body),
		Priority:         priorityFromMetadata(metadata),
	}
	if editedAt.Valid {
		t := editedAt.Time
		msg.EditedAt = &t
	}
	if replyToMessageID.Valid {
		s := replyToMessageID.String
		msg.ReplyToMessageID = &s
	}
	return msg
}
