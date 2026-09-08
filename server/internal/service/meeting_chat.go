package service

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageLimit = 5000

func normalizeChatMessage(text string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", Invalid("nội dung không được để trống")
	}
	if len(text) > 4000 {
		text = text[:4000]
	}
	return text, nil
}

func (s *MeetingService) AppendChatMessage(ctx context.Context, userID, guestID, meetingID, message string) (db.MeetingChatMessage, error) {
	m, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID)
	if err != nil {
		return db.MeetingChatMessage{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingChatMessage{}, errInvalidState()
	}
	message, err = normalizeChatMessage(message)
	if err != nil {
		return db.MeetingChatMessage{}, err
	}

	senderName := ""
	pid := pgtype.Text{}
	senderIdentity := ""
	if userID != "" {
		if p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)}); err == nil {
			pid = strText(p.ID)
			senderIdentity = meetings.IdentityForParticipant(p.ID)
			senderName = p.DisplayNameSnapshot
		}
		if senderName == "" {
			if u, err := s.q.GetUserByID(ctx, userID); err == nil {
				senderName = u.DisplayName
			}
		}
	} else if guestID != "" {
		if p, err := s.q.GetActiveGuestParticipant(ctx, db.GetActiveGuestParticipantParams{MeetingID: meetingID, GuestID: strText(guestID)}); err == nil {
			pid = strText(p.ID)
			senderIdentity = meetings.IdentityForParticipant(p.ID)
			senderName = p.DisplayNameSnapshot
		}
	}
	if senderIdentity == "" {
		return db.MeetingChatMessage{}, Invalid("chưa tham gia phòng họp")
	}

	sentAt := time.Now().UTC()
	msg, err := s.q.InsertMeetingChatMessage(ctx, db.InsertMeetingChatMessageParams{
		ID:             util.NewID(),
		MeetingID:      meetingID,
		ParticipantID:  pid,
		SenderIdentity: senderIdentity,
		SenderName:     senderName,
		Message:        message,
		SentAt:         pgtype.Timestamptz{Time: sentAt, Valid: true},
	})
	if err != nil {
		return db.MeetingChatMessage{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "chat.message", Payload: map[string]string{"meeting_id": meetingID}})
	return msg, nil
}

func (s *MeetingService) ChatMessages(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingChatMessage, error) {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingChatMessages(ctx, db.ListMeetingChatMessagesParams{MeetingID: meetingID, Limit: chatMessageLimit})
}
