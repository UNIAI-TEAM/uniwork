package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AllowLobbyListen gates meeting-scoped lobby WebSocket subscriptions. The
// lobby mirrors the meeting's activity (start and end, admissions, chat and
// vote pulses, participant changes), so only the meeting's own audience may
// listen while it is not ended or canceled: a participant the host has not
// removed, a person whose knock is still pending, or a member of the
// meeting's workspace. Knowing the meeting id is not enough — it travels in
// invite links and URLs (ADR 0008 isolation matrix). A removal or a refusal
// reaches the socket that is already open; a reconnect afterwards is refused.
//
// A guest on the invite form has not knocked yet and is refused; the lobby
// client retries over HTTP until its first join creates the request, and the
// socket's next reconnect is admitted.
func (s *MeetingService) AllowLobbyListen(ctx context.Context, meetingID, userID, guestID string) (bool, error) {
	if userID == "" && guestID == "" {
		return false, nil
	}
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if m.Status == MeetingEnded || m.Status == MeetingCanceled {
		return false, nil
	}
	if userID != "" {
		id := pgtype.Text{String: userID, Valid: true}
		p, err := s.q.GetUserParticipantAnyStatus(ctx, db.GetUserParticipantAnyStatusParams{MeetingID: meetingID, UserID: id})
		if ok, err := lobbyRowFound(err); err != nil || (ok && p.Status != ParticipantRemoved) {
			return err == nil, err
		}
		jr, err := s.q.GetLatestJoinRequestForUser(ctx, db.GetLatestJoinRequestForUserParams{MeetingID: meetingID, RequesterUserID: id})
		if ok, err := lobbyRowFound(err); err != nil || (ok && jr.Status == JoinPending) {
			return err == nil, err
		}
		if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID); err == nil {
			return true, nil
		}
	}
	if guestID != "" {
		id := pgtype.Text{String: guestID, Valid: true}
		p, err := s.q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: meetingID, GuestID: id})
		if ok, err := lobbyRowFound(err); err != nil || (ok && p.Status != ParticipantRemoved) {
			return err == nil, err
		}
		jr, err := s.q.GetLatestJoinRequestForGuest(ctx, db.GetLatestJoinRequestForGuestParams{MeetingID: meetingID, RequesterGuestID: id})
		ok, err := lobbyRowFound(err)
		return ok && jr.Status == JoinPending, err
	}
	return false, nil
}

func lobbyRowFound(err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
