package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// SetParticipantPublish locks (false) or unlocks (true) a participant's mic
// without removing them from the room. Host/admin only; requires a synced
// conference session.
func (s *MeetingService) SetParticipantPublish(ctx context.Context, actorID, meetingID, participantID string, canPublish bool) error {
	if s.provider == nil {
		return coded(http.StatusServiceUnavailable, "livekit_not_configured", "LiveKit chưa được cấu hình trên server")
	}
	caps := s.provider.Capabilities(ctx)
	if !caps.UpdateParticipantPermissions {
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "provider không hỗ trợ cập nhật quyền")
	}
	m, err := s.requireHostOrAdmin(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingInProgress {
		return errInvalidState()
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || p.MeetingID != meetingID {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if p.Status != ParticipantActive {
		return coded(http.StatusConflict, "participant_not_active", "người tham gia không còn trong cuộc họp")
	}
	if p.PrincipalType == PrincipalUser && p.UserID.Valid && p.UserID.String == m.HostUserID && !canPublish {
		return coded(http.StatusConflict, "cannot_mute_host", "không thể tắt mic chủ tọa")
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		return coded(http.StatusConflict, "meeting_not_started", "cuộc họp chưa bắt đầu")
	}
	if !conferenceSessionReady(sess) {
		return coded(http.StatusConflict, "provider_not_ready", "phòng media chưa sẵn sàng")
	}
	room := sess.ProviderRoomName
	if room == "" {
		room = meetings.RoomNameForMeeting(m.ID)
	}
	// The role's grants with only the mic locked or unlocked: the provider
	// replaces the whole set, and a locked participant still listens, sends
	// signals, and keeps their camera and screen share.
	perms := meetings.MediaPermissionsForRole(p.Role)
	perms.MicrophoneLocked = !canPublish
	if err := s.provider.UpdateParticipant(ctx, meetings.UpdateProviderParticipantRequest{
		RoomName: room, Identity: meetings.IdentityForParticipant(participantID), Permissions: perms,
	}); err != nil {
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "không cập nhật được quyền media")
	}
	action := "PARTICIPANT_PUBLISH_REVOKED"
	if canPublish {
		action = "PARTICIPANT_PUBLISH_GRANTED"
	}
	_ = s.writeAudit(ctx, s.q, m, action, actorID, "", participantID, "{}")
	return nil
}
