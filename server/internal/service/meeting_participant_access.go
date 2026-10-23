package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// authorizeActiveParticipant allows workspace members, and anyone else — a
// guest, or a signed-in user from outside the workspace who came in through an
// invite link (UNI-901) — with an active participant row in the meeting. Used
// for in-room read paths and chat.
func (s *MeetingService) authorizeActiveParticipant(ctx context.Context, userID, guestID, meetingID string) (db.Meeting, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if userID != "" {
		_, _, aerr := s.authorize(ctx, userID, meetingID)
		if aerr == nil {
			return m, nil
		}
		// Plain ErrForbidden is "not a member". A deactivated member or a
		// suspended organization stays refused, whatever rows remain.
		if !errors.Is(aerr, ErrForbidden) {
			return db.Meeting{}, aerr
		}
		admitted, err := s.linkAdmittedUser(ctx, meetingID, userID)
		if err != nil {
			return db.Meeting{}, err
		}
		if !admitted {
			return db.Meeting{}, aerr
		}
		return m, nil
	}
	if guestID == "" {
		return db.Meeting{}, ErrForbidden
	}
	if _, err := s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{
		MeetingID: meetingID,
		GuestID:   strText(guestID),
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrForbidden
	} else if err != nil {
		return db.Meeting{}, err
	}
	return m, nil
}

// linkAdmittedUser reports whether the user's active participant row came in
// through an invite link: admitted by the link itself, or by a host approving
// a request filed through one. Rows from the user's time as a member (creator,
// direct invite, a member's join request) are not a way back in after they
// leave the workspace.
func (s *MeetingService) linkAdmittedUser(ctx context.Context, meetingID, userID string) (bool, error) {
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{
		MeetingID: meetingID,
		UserID:    strText(userID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	switch p.SourceType {
	case GrantInviteLink:
		return true, nil
	case GrantJoinApproval:
		jr, err := s.q.GetJoinRequest(ctx, p.SourceID.String)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return jr.InviteLinkID.Valid, nil
	default:
		return false, nil
	}
}
