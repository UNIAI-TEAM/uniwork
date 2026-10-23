package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ReconcileProviderDesync finds IN_PROGRESS meetings whose provider room is IDLE
// while the control plane still considers the meeting active (e.g. LiveKit empty timeout).
// It is the backstop for a re-ensure whose queued row died, so it queues one
// whatever the session's sync status. The timeline row and the queued ensure
// commit together, so the timeline never shows a desync whose repair was not
// queued. A meeting that fails is skipped and the sweep goes on; the errors
// come back joined.
func (s *MeetingService) ReconcileProviderDesync(ctx context.Context, limit int32) error {
	if limit <= 0 {
		limit = 50
	}
	ids, err := s.q.ListInProgressMeetingsWithIdleSession(ctx, limit)
	if err != nil {
		return err
	}
	var errs []error
	for _, meetingID := range ids {
		if s.metrics != nil {
			s.metrics.IncProviderDesync()
		}
		if err := s.reconcileIdleRoom(ctx, meetingID); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *MeetingService) reconcileIdleRoom(ctx context.Context, meetingID string) error {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := s.writeAudit(ctx, q, m, "PROVIDER_ROOM_IDLE_DESYNC", "", "IN_PROGRESS", "IDLE", "{}"); err != nil {
		return err
	}
	sess, err := q.GetOpenConferenceSession(ctx, meetingID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Nothing left to re-ensure; the timeline still says what was seen.
	case err != nil:
		return err
	default:
		if err := s.enqueue(ctx, q, m.WorkspaceID, "provider.ensure_session", map[string]string{
			"meeting_id": m.ID, "session_id": sess.ID, "room_name": sess.ProviderRoomName,
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
