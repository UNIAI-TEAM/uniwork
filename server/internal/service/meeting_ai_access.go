package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A meeting's AI content - the verbatim transcript, the AI summary, the
// evidence lines it cites, the live catch-up, and the Ask UNI and MCP reads
// of them - is narrower than the meeting itself (UNI-1995 access). Its
// title, time, agenda and action items stay with the workspace (authorize);
// what was said is for the people of the meeting: the host, the workspace
// admins (organization owners/admins are implicit ones in RequireMember),
// and every signed-in participant whose row is still ACTIVE - the invited,
// the admitted, the secretaries, and whoever attended. A participant the
// host removed reads nothing more, even what was said while they were in.
// The host or a clerk may share it with the whole workspace (ai_content_shared_at).

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

// AIContentReadable is the gate's rule once the caller's standing is read:
// the host, a workspace admin, an ACTIVE user participant, or anyone in the
// workspace once a clerk shared it. The notification rules that tell people
// about AI content (the recap) filter through it too.
func AIContentReadable(m db.Meeting, userID string, wsAdmin, activeParticipant bool) bool {
	return m.HostUserID == userID || wsAdmin || m.AiContentSharedAt.Valid || activeParticipant
}

// aiContentReader decides for a caller who already passed authorize.
func (s *MeetingService) aiContentReader(ctx context.Context, m db.Meeting, mem db.WorkspaceMember, userID string) (bool, error) {
	if AIContentReadable(m, userID, isWSAdmin(mem.Role), false) {
		return true, nil
	}
	_, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// CanReadAIContent tells the meeting page whether to show the AI content or
// say who it is for. A read failure answers false: the reads refuse anyway.
func (s *MeetingService) CanReadAIContent(ctx context.Context, userID string, m db.Meeting) bool {
	mem, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID)
	if err != nil {
		return false
	}
	ok, _ := s.aiContentReader(ctx, m, mem, userID)
	return ok
}

// SetAIContentShared shares the meeting's AI content with its whole
// workspace, or takes it back to the people of the meeting: a clerk's
// command (host, secretary, workspace admin), audited, any status.
func (s *MeetingService) SetAIContentShared(ctx context.Context, userID, meetingID string, shared bool) (db.Meeting, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	updated, err := q.SetMeetingAIContentShared(ctx, db.SetMeetingAIContentSharedParams{ID: m.ID, Shared: shared, By: userID})
	if err != nil {
		return db.Meeting{}, err
	}
	if m.AiContentSharedAt.Valid != updated.AiContentSharedAt.Valid {
		s.recordAction(ctx, q, updated, audit.User(userID), audit.ActionMeetingAISharingChanged, "meeting.updated", nil,
			audit.Diff(map[string]any{"ai_content_shared": m.AiContentSharedAt.Valid}, map[string]any{"ai_content_shared": shared}),
			"meeting", m.ID)
	}
	return updated, tx.Commit(ctx)
}
