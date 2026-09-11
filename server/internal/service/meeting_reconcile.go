package service

import (
	"context"
)

// ReconcileProviderDesync finds IN_PROGRESS meetings whose provider room is IDLE
// while the control plane still considers the meeting active (e.g. LiveKit empty timeout).
func (s *MeetingService) ReconcileProviderDesync(ctx context.Context, limit int32) error {
	if limit <= 0 {
		limit = 50
	}
	ids, err := s.q.ListInProgressMeetingsWithIdleSession(ctx, limit)
	if err != nil {
		return err
	}
	for _, meetingID := range ids {
		if s.metrics != nil {
			s.metrics.IncProviderDesync()
		}
		m, merr := s.q.GetMeeting(ctx, meetingID)
		if merr != nil {
			continue
		}
		sess, serr := s.q.GetOpenConferenceSession(ctx, meetingID)
		if serr != nil {
			_ = s.writeAudit(ctx, s.q, meetingID, "PROVIDER_ROOM_IDLE_DESYNC", "", "IN_PROGRESS", "IDLE", "{}")
			continue
		}
		_ = s.writeAudit(ctx, s.q, meetingID, "PROVIDER_ROOM_IDLE_DESYNC", "", "IN_PROGRESS", "IDLE", "{}")
		_ = s.enqueue(ctx, s.q, m.WorkspaceID, "provider.ensure_session", map[string]string{
			"meeting_id": m.ID, "session_id": sess.ID, "room_name": sess.ProviderRoomName,
		})
	}
	return nil
}
