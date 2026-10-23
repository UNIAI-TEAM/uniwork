package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A meeting's AI content (the AI summary, its decisions, topics and open
// questions) is for the people of the meeting: the host, the workspace admins
// and every signed-in participant whose row is still ACTIVE. Its title, time,
// agenda and action items stay with the workspace (authorize).
//
// shortcut: this is the access stream's gate (wc/UNI-1995-access 0e8528f71,
// same file and names) without its ai_content_shared_at switch, so the
// summary reads of this branch are gated before both land; at the merge the
// add/add conflict on this file is resolved by taking the access stream's.

// errAIContentRestricted is the one answer of every AI-content read to a
// workspace member outside the meeting. It wraps ErrForbidden, so the paths
// that hide a refusal (MCP, Ask UNI) hide this one too.
func errAIContentRestricted() error {
	return CodedError{
		Code: "meeting_ai_restricted", Status: http.StatusForbidden, Err: ErrForbidden,
		Msg: "nội dung AI của cuộc họp chỉ dành cho người tham dự",
	}
}

// authorizeAIContent is authorize for an AI-content read.
func (s *MeetingService) authorizeAIContent(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, mem, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	ok, err := s.aiContentReader(ctx, m, mem, userID)
	if err != nil {
		return db.Meeting{}, err
	}
	if !ok {
		return db.Meeting{}, errAIContentRestricted()
	}
	return m, nil
}

// aiContentReader decides for a caller who already passed authorize.
func (s *MeetingService) aiContentReader(ctx context.Context, m db.Meeting, mem db.WorkspaceMember, userID string) (bool, error) {
	if m.HostUserID == userID || isWSAdmin(mem.Role) {
		return true, nil
	}
	_, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
