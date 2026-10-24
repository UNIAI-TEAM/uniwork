package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// mergeVoiceCallSession combines two views of the same call (memory vs Postgres).
// In-process state can carry accepted_at before a list query reads a stale row.
func mergeVoiceCallSession(a, b voiceCallSession) voiceCallSession {
	out := a
	if b.acceptedAt != nil && (out.acceptedAt == nil || b.acceptedAt.After(*out.acceptedAt)) {
		t := *b.acceptedAt
		out.acceptedAt = &t
	}
	if b.invitedAt.After(out.invitedAt) {
		out.invitedAt = b.invitedAt
	}
	if len(b.participantIDs) > len(out.participantIDs) {
		out.participantIDs = append([]string(nil), b.participantIDs...)
	}
	if len(b.declinedIDs) > len(out.declinedIDs) {
		out.declinedIDs = append([]string(nil), b.declinedIDs...)
	}
	return out
}

func voiceCallSessionFromRow(row db.ChatVoiceCallSession) voiceCallSession {
	sess := voiceCallSession{
		roomID:         row.RoomID,
		callID:         row.CallID,
		callerID:       row.CallerID,
		callerName:     row.CallerName,
		callKind:       row.CallKind,
		roomName:       row.RoomName,
		video:          row.Video,
		participantIDs: append([]string(nil), row.ParticipantIds...),
		inviteeIDs:     append([]string(nil), row.InviteeIds...),
		declinedIDs:    append([]string(nil), row.DeclinedIds...),
	}
	if row.InvitedAt.Valid {
		sess.invitedAt = row.InvitedAt.Time
	}
	if row.AcceptedAt.Valid {
		t := row.AcceptedAt.Time
		sess.acceptedAt = &t
	}
	return sess
}

// pgTextArray sends PostgreSQL TEXT[] as '{}' instead of NULL (NOT NULL columns).
func pgTextArray(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func timestamptzOf(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func timestamptzPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return timestamptzOf(*t)
}

func (s *ChatService) upsertVoiceCallSessionRow(ctx context.Context, orgID string, sess voiceCallSession) error {
	rowID := util.NewID()
	existing, err := s.q.GetChatVoiceCallSession(ctx, db.GetChatVoiceCallSessionParams{
		RoomID: sess.roomID, CallID: sess.callID,
	})
	if err == nil {
		rowID = existing.ID
		if orgID == "" {
			orgID = existing.OrganizationID
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if orgID == "" {
		return errors.New("voice call session missing organization_id")
	}
	return s.q.UpsertChatVoiceCallSession(ctx, db.UpsertChatVoiceCallSessionParams{
		ID:             rowID,
		OrganizationID: orgID,
		RoomID:         sess.roomID,
		CallID:         sess.callID,
		CallerID:       sess.callerID,
		CallerName:     sess.callerName,
		CallKind:       sess.callKind,
		RoomName:       sess.roomName,
		Video:          sess.video,
		InvitedAt:      timestamptzOf(sess.invitedAt),
		AcceptedAt:     timestamptzPtr(sess.acceptedAt),
		ParticipantIds: pgTextArray(sess.participantIDs),
		InviteeIds:     pgTextArray(sess.inviteeIDs),
		DeclinedIds:    pgTextArray(sess.declinedIDs),
	})
}

func (s *ChatService) loadVoiceCallSessionFromDB(ctx context.Context, roomID, callID string) (voiceCallSession, bool, error) {
	row, err := s.q.GetChatVoiceCallSession(ctx, db.GetChatVoiceCallSessionParams{RoomID: roomID, CallID: callID})
	if errors.Is(err, pgx.ErrNoRows) {
		return voiceCallSession{}, false, nil
	}
	if err != nil {
		return voiceCallSession{}, false, err
	}
	sess := voiceCallSessionFromRow(row)
	if sess.expired(time.Now()) {
		_ = s.deleteVoiceCallSessionRow(ctx, roomID, callID)
		return voiceCallSession{}, false, nil
	}
	return sess, true, nil
}

func (s *ChatService) deleteVoiceCallSessionRow(ctx context.Context, roomID, callID string) error {
	_, err := s.q.TakeChatVoiceCallSession(ctx, db.TakeChatVoiceCallSessionParams{RoomID: roomID, CallID: callID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func (s *ChatService) sweepExpiredVoiceCallSessionsDB(ctx context.Context, now time.Time) error {
	if s.q == nil {
		return nil
	}
	answeredCutoff := now.Add(-voiceCallAnsweredTTL)
	unansweredCutoff := now.Add(-voiceCallUnansweredTTL)
	return s.q.DeleteExpiredChatVoiceCallSessions(ctx, db.DeleteExpiredChatVoiceCallSessionsParams{
		AcceptedAt: timestamptzOf(answeredCutoff),
		InvitedAt:  timestamptzOf(unansweredCutoff),
	})
}

func (s *ChatService) loadVoiceCallSession(ctx context.Context, roomID, callID string) (voiceCallSession, bool) {
	key := voiceCallSessionKey(roomID, callID)
	now := time.Now()
	if raw, ok := voiceCallSessions.Load(key); ok {
		sess := raw.(voiceCallSession)
		if !sess.expired(now) {
			return sess, true
		}
		s.deleteVoiceCallSession(ctx, roomID, callID)
		return voiceCallSession{}, false
	}
	if found, inJournal := journalLoad(key); inJournal {
		if !found.expired(now) {
			cacheVoiceCallSessionInProcess(key, found)
			return found, true
		}
		s.deleteVoiceCallSession(ctx, roomID, callID)
		return voiceCallSession{}, false
	}
	if s.q != nil {
		found, ok, err := s.loadVoiceCallSessionFromDB(ctx, roomID, callID)
		if err != nil {
			slog.Warn("chat: voice call session db read failed", "room_id", roomID, "call_id", callID, "error", err)
			return voiceCallSession{}, false
		}
		if ok {
			cacheVoiceCallSessionInProcess(key, found)
			return found, true
		}
	}
	return voiceCallSession{}, false
}

func (s *ChatService) storeVoiceCallSession(ctx context.Context, orgID string, sess voiceCallSession) {
	key := voiceCallSessionKey(sess.roomID, sess.callID)
	writeVoiceCallSessionLocal(key, sess)
	if s.q == nil {
		return
	}
	if err := s.upsertVoiceCallSessionRow(ctx, orgID, sess); err != nil {
		slog.Warn("chat: voice call session not persisted", "room_id", sess.roomID, "call_id", sess.callID, "error", err)
	}
}

func (s *ChatService) deleteVoiceCallSession(ctx context.Context, roomID, callID string) {
	key := voiceCallSessionKey(roomID, callID)
	deleteVoiceCallSessionLocal(key)
	if s.q == nil {
		return
	}
	if err := s.deleteVoiceCallSessionRow(ctx, roomID, callID); err != nil {
		slog.Warn("chat: voice call session db delete failed", "room_id", roomID, "call_id", callID, "error", err)
	}
}
