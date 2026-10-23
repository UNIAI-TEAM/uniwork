package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// Media sources the host can lock on a participant. An empty source is the
// microphone, the only one clients knew before screen-share locks.
const (
	MediaSourceMicrophone  = "microphone"
	MediaSourceScreenShare = "screen_share"
)

// participantMediaLockBudget bounds the provider read and write together
// while the advisory lock pins a pool connection: both answer in milliseconds
// when LiveKit is healthy, and an outage turns into a 503 after this instead
// of after two full RPC deadlines per click.
var participantMediaLockBudget = 5 * time.Second

// SetParticipantPublish locks (false) or unlocks (true) one of a
// participant's media sources — the mic or the screen share — without
// removing them from the room. Host/admin only; requires a synced conference
// session.
func (s *MeetingService) SetParticipantPublish(ctx context.Context, actorID, meetingID, participantID, source string, canPublish bool) error {
	if source == "" {
		source = MediaSourceMicrophone
	}
	if source != MediaSourceMicrophone && source != MediaSourceScreenShare {
		return Invalid("source phải là microphone hoặc screen_share")
	}
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
		if source == MediaSourceScreenShare {
			return coded(http.StatusConflict, "cannot_lock_host_share", "không thể khóa chia sẻ màn hình của chủ tọa")
		}
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
	identity := meetings.IdentityForParticipant(participantID)
	// Locks live only on the provider: read the one this call leaves alone, or
	// the write below, which replaces the whole set, would lift it. The read
	// and the write take turns per participant (an advisory lock held until
	// commit), so a host locking the mic and an admin locking the share at
	// the same moment both stick.
	//
	// Known limitation (mic and share alike): a join or refresh token grants
	// every source, so a reload, rejoinAfterDrop, a new tab or a full LiveKit
	// restart mints a participant without the lock. Persisting the locks on
	// meeting_participants and minting them into CanPublishSources is the
	// follow-up ("khóa mic chưa lưu DB").
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.LockParticipantMediaLocks(ctx, participantID); err != nil {
		return err
	}
	rpcCtx, cancel := context.WithTimeout(ctx, participantMediaLockBudget)
	defer cancel()
	current, err := s.provider.GetParticipantPermissions(rpcCtx, meetings.GetProviderParticipantRequest{RoomName: room, Identity: identity})
	if err != nil {
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "không đọc được quyền media hiện tại")
	}
	// The role's grants with the two locks: a locked participant still
	// listens, sends signals, and keeps their camera.
	perms := meetings.MediaPermissionsForRole(p.Role)
	perms.MicrophoneLocked, perms.ScreenShareLocked = current.MicrophoneLocked, current.ScreenShareLocked
	action := "PARTICIPANT_PUBLISH_REVOKED"
	if source == MediaSourceScreenShare {
		perms.ScreenShareLocked = !canPublish
		action = "PARTICIPANT_SCREEN_SHARE_REVOKED"
		if canPublish {
			action = "PARTICIPANT_SCREEN_SHARE_GRANTED"
		}
	} else {
		perms.MicrophoneLocked = !canPublish
		if canPublish {
			action = "PARTICIPANT_PUBLISH_GRANTED"
		}
	}
	if err := s.provider.UpdateParticipant(rpcCtx, meetings.UpdateProviderParticipantRequest{
		RoomName: room, Identity: identity, Permissions: perms,
	}); err != nil {
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "không cập nhật được quyền media")
	}
	// The transaction holds only the lock; the provider already took the
	// change, so ending it cannot fail the request.
	_ = tx.Commit(ctx)
	_ = s.writeAudit(ctx, s.q, m, action, actorID, "", participantID, "{}")
	return nil
}
