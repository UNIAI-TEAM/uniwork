package service

import (
	"context"
	"errors"
)

// AuthorizeMeetingScope gates WebSocket subscriptions to meeting:{meetingId}
// from a workspace socket (realtime.MeetingScopeGate). The scope carries what
// the meeting's room and detail page show, so it admits whoever may read
// those over HTTP from that socket: a member of the meeting's workspace, the
// same gate authorizeActiveParticipant applies to a member. The meeting must
// belong to the socket's own workspace, so a frame never crosses to a socket
// opened for another tenant. A guest, or a user admitted through an invite
// link, is not on a workspace socket: the lobby socket serves them.
func (s *MeetingService) AuthorizeMeetingScope(ctx context.Context, userID, workspaceID, meetingID string) (bool, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if refusesMeetingScope(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return m.WorkspaceID == workspaceID, nil
}

// refusesMeetingScope reports whether err is an answer rather than a failure:
// the meeting is gone or hidden, or the membership gate said no.
func refusesMeetingScope(err error) bool {
	return errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) ||
		errors.Is(err, ErrMemberDeactivated) || errors.Is(err, ErrOrganizationSuspended)
}
