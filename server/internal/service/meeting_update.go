package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type UpdateMeetingInput struct {
	Title            *string
	Description      *string
	StartsAt         *time.Time
	EndsAt           *time.Time
	Timezone         *string
	AllowJoinRequest *bool
	ProjectID        *string
	// QuorumPercent: 1–100 sets the minimum attendance, 0 clears it.
	QuorumPercent *int
}

// quorumChanges: setting want (0 = none) would change the stored quorum.
func quorumChanges(stored pgtype.Int2, want int) bool {
	current := 0
	if stored.Valid {
		current = int(stored.Int16)
	}
	return current != want
}

func meetingEditable(m db.Meeting, in UpdateMeetingInput) error {
	if m.Status == MeetingEnded || m.Status == MeetingCanceled {
		return errInvalidState()
	}
	if m.Status == MeetingInProgress && (in.StartsAt != nil || in.EndsAt != nil) {
		return Invalid("không sửa thời gian dự kiến khi cuộc họp đang diễn ra")
	}
	return nil
}

func (s *MeetingService) Update(ctx context.Context, userID, meetingID string, in UpdateMeetingInput) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if err := meetingEditable(m, in); err != nil {
		return db.Meeting{}, err
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	if in.QuorumPercent != nil && (*in.QuorumPercent < 0 || *in.QuorumPercent > 100) {
		return db.Meeting{}, Invalid("tỉ lệ có mặt tối thiểu phải từ 1 đến 100")
	}
	// Checked before the transaction: it reads through the pool, and taking a
	// second connection while this one holds the meeting row lock can starve
	// the pool. A meeting never changes organization or workspace, so the row
	// requireHostOrAdmin loaded is as good as the locked one.
	if in.ProjectID != nil {
		if err := s.requireMeetingProject(ctx, m.OrganizationID, m.WorkspaceID, *in.ProjectID); err != nil {
			return db.Meeting{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The lock attendance commands take: the quorum is part of what a
	// finalized roll records, so it is re-read with the finalized flag under
	// that lock and cannot change beside a concurrent finalize.
	m, err = q.LockMeetingForAttendance(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if err := meetingEditable(m, in); err != nil {
		return db.Meeting{}, err
	}
	// The edit dialog sends the quorum back unchanged with every save; only a
	// different value is refused on a finalized roll.
	if in.QuorumPercent != nil && m.AttendanceFinalizedAt.Valid && quorumChanges(m.QuorumPercent, *in.QuorumPercent) {
		return db.Meeting{}, errAttendanceFinalized()
	}
	// Validate the window the row would end up with before writing it.
	starts, ends := m.StartsAt.Time, m.EndsAt.Time
	if in.StartsAt != nil {
		starts = *in.StartsAt
	}
	if in.EndsAt != nil {
		ends = *in.EndsAt
	}
	if !ends.After(starts) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	params := db.UpdateMeetingParams{
		ID: meetingID, Version: m.Version, Title: optText(in.Title), Description: optText(in.Description),
		StartsAt: optTimestamptz(in.StartsAt), EndsAt: optTimestamptz(in.EndsAt),
		Timezone: optText(in.Timezone), AllowJoinRequest: optBool(in.AllowJoinRequest),
		ProjectID: optText(in.ProjectID), UpdatedBy: strText(userID),
	}
	if in.QuorumPercent != nil {
		params.QuorumPercent = pgtype.Int2{Int16: int16(*in.QuorumPercent), Valid: true}
	}
	up, err := q.UpdateMeeting(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrConflict
	}
	if err != nil {
		return db.Meeting{}, err
	}
	_ = s.writeAudit(ctx, q, m, "MEETING_UPDATED", userID, m.Status, up.Status, "{}")
	s.record(ctx, q, up, audit.User(userID), "meeting.updated", nil, audit.Diff(
		map[string]any{"title": m.Title, "starts_at": tsOrNil(m.StartsAt), "ends_at": tsOrNil(m.EndsAt), "quorum_percent": quorumOrNil(m.QuorumPercent)},
		map[string]any{"title": up.Title, "starts_at": tsOrNil(up.StartsAt), "ends_at": tsOrNil(up.EndsAt), "quorum_percent": quorumOrNil(up.QuorumPercent)},
	))
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	return up, nil
}

const (
	defaultExtendMinutes = 15
	maxExtendMinutes     = 120
)

// Extend pushes ends_at forward while the meeting is live. Calendar PATCH
// cannot do this: Update forbids schedule edits on IN_PROGRESS meetings.
func (s *MeetingService) Extend(ctx context.Context, userID, meetingID string, minutes int) (db.Meeting, error) {
	if minutes <= 0 {
		minutes = defaultExtendMinutes
	}
	if minutes > maxExtendMinutes {
		return db.Meeting{}, Invalid("chỉ được gia hạn tối đa 120 phút")
	}
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingInProgress {
		return db.Meeting{}, errInvalidState()
	}
	base := time.Now().UTC()
	if m.EndsAt.Valid && m.EndsAt.Time.After(base) {
		base = m.EndsAt.Time.UTC()
	}
	next := base.Add(time.Duration(minutes) * time.Minute)
	params := db.UpdateMeetingParams{
		ID: meetingID, Version: m.Version, EndsAt: optTimestamptz(&next), UpdatedBy: strText(userID),
	}
	up, err := s.q.UpdateMeeting(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrConflict
	}
	if err != nil {
		return db.Meeting{}, err
	}
	_ = s.writeAudit(ctx, s.q, m, "MEETING_UPDATED", userID, m.Status, up.Status, "{}")
	s.record(ctx, s.q, up, audit.User(userID), "meeting.updated", nil, audit.Diff(
		map[string]any{"ends_at": tsOrNil(m.EndsAt)},
		map[string]any{"ends_at": tsOrNil(up.EndsAt)},
	))
	return up, nil
}
