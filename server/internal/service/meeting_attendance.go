package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	AttendancePresent = "PRESENT"
	AttendanceLate    = "LATE"
	AttendanceExcused = "EXCUSED"
	AttendanceAbsent  = "ABSENT"

	AttendanceSourceAuto      = "AUTO"
	AttendanceSourceManual    = "MANUAL"
	AttendanceSourceSuggested = "SUGGESTED"

	attendanceNoteMax = 200
)

// attendanceLateGrace: joining up to this long after the anchor still counts
// as on time. Fixed by the spec, not configurable.
const attendanceLateGrace = 10 * time.Minute

// attendanceAnchor is the moment "late" is measured from: when the meeting
// could actually be joined. For an instant meeting that is its actual start;
// for a scheduled one the later of the scheduled and the actual start, so a
// host who opens the room late does not make everyone late, and opening early
// does not move the bar before the agreed time (spec §3.4, update 2026-10-01).
func attendanceAnchor(m db.Meeting) time.Time {
	if !m.ActualStartAt.Valid {
		return m.StartsAt.Time
	}
	if m.MeetingType == MeetingTypeInstant || m.ActualStartAt.Time.After(m.StartsAt.Time) {
		return m.ActualStartAt.Time
	}
	return m.StartsAt.Time
}

// suggestAttendance derives a status from the first time someone entered.
func suggestAttendance(anchor time.Time, firstJoined *time.Time) string {
	if firstJoined == nil {
		return AttendanceAbsent
	}
	if firstJoined.Sub(anchor) > attendanceLateGrace {
		return AttendanceLate
	}
	return AttendancePresent
}

type AttendanceRow struct {
	Participant    db.MeetingParticipant
	Status         string
	Source         string
	Note           string
	FirstJoinedAt  pgtype.Timestamptz
	LastLeftAt     pgtype.Timestamptz
	InRoom         bool
	PresentSeconds int64
	SessionCount   int32
	// Removed: listed only on a finalized roll — the person was marked, then
	// removed or left the participant list; the snapshot still counts them.
	Removed bool
	// JoinedAfterFinalize: an active participant with no mark on a finalized
	// roll (added after it was finalized). Shown with a suggestion, never
	// counted, never on a vote's roll.
	JoinedAfterFinalize bool
}

// counted: the row is one of the members the summary and quorum are over.
func (r AttendanceRow) counted() bool {
	return r.Participant.Standing == StandingMember && !r.JoinedAfterFinalize
}

// onRoll: the row may vote — a counted member who is still a participant.
func (r AttendanceRow) onRoll() bool {
	return r.counted() && !r.Removed
}

type AttendanceSummary struct {
	Members, Present, Late, Excused, Absent int
	// QuorumMet is nil when the meeting sets no quorum or has no members.
	QuorumMet *bool
}

type AttendanceReport struct {
	Meeting db.Meeting
	Rows    []AttendanceRow
	Summary AttendanceSummary
}

// Attendance is readable by every workspace member of the meeting.
func (s *MeetingService) Attendance(ctx context.Context, userID, meetingID string) (AttendanceReport, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return AttendanceReport{}, err
	}
	return s.attendanceReport(ctx, s.q, m)
}

// attendanceReport merges clerk marks over suggestions for every active
// participant. Observers are listed but never counted.
//
// A finalized roll is a snapshot of its mark rows (finalize writes one for
// everybody): the summary counts exactly the marked members, whatever has
// happened to the participant list since, so inviting or removing someone
// after finalizing cannot move the recorded numbers. Marked participants who
// are no longer active stay listed (Removed); active ones without a mark
// joined after the finalize and are listed but not counted.
func (s *MeetingService) attendanceReport(ctx context.Context, q *db.Queries, m db.Meeting) (AttendanceReport, error) {
	ps, err := q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	totals, err := q.AttendanceSessionTotals(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	marks, err := q.ListAttendanceMarks(ctx, m.ID)
	if err != nil {
		return AttendanceReport{}, err
	}
	byTotals := make(map[string]db.AttendanceSessionTotalsRow, len(totals))
	for _, t := range totals {
		byTotals[t.ParticipantID] = t
	}
	byMark := make(map[string]db.MeetingAttendanceMark, len(marks))
	for _, mk := range marks {
		byMark[mk.ParticipantID] = mk
	}
	anchor := attendanceAnchor(m)
	finalized := m.AttendanceFinalizedAt.Valid
	rep := AttendanceReport{Meeting: m, Rows: make([]AttendanceRow, 0, len(ps))}
	for _, p := range ps {
		mk, marked := byMark[p.ID]
		active := p.Status == ParticipantActive
		if !active && !(finalized && marked) {
			continue
		}
		row := AttendanceRow{Participant: p, Removed: !active}
		if t, ok := byTotals[p.ID]; ok {
			row.FirstJoinedAt, row.LastLeftAt = t.FirstJoinedAt, t.LastLeftAt
			row.InRoom, row.SessionCount, row.PresentSeconds = t.InRoom, t.SessionCount, t.PresentSeconds
		}
		if marked {
			row.Status, row.Source, row.Note = mk.Status, mk.Source, mk.Note
		} else {
			var first *time.Time
			if row.FirstJoinedAt.Valid {
				f := row.FirstJoinedAt.Time
				first = &f
			}
			row.Status, row.Source = suggestAttendance(anchor, first), AttendanceSourceSuggested
			row.JoinedAfterFinalize = finalized
		}
		rep.Rows = append(rep.Rows, row)
		if !row.counted() {
			continue
		}
		rep.Summary.Members++
		switch row.Status {
		case AttendancePresent:
			rep.Summary.Present++
		case AttendanceLate:
			rep.Summary.Late++
		case AttendanceExcused:
			rep.Summary.Excused++
		default:
			rep.Summary.Absent++
		}
	}
	if m.QuorumPercent.Valid && rep.Summary.Members > 0 {
		met := (rep.Summary.Present+rep.Summary.Late)*100 >= int(m.QuorumPercent.Int16)*rep.Summary.Members
		rep.Summary.QuorumMet = &met
	}
	return rep, nil
}

func validAttendanceStatus(s string) bool {
	switch s {
	case AttendancePresent, AttendanceLate, AttendanceExcused, AttendanceAbsent:
		return true
	}
	return false
}

func errAttendanceFinalized() error {
	return coded(http.StatusConflict, "attendance_finalized", "điểm danh đã chốt; hãy mở lại trước")
}

// attendanceMeeting gates every attendance command: clerk, and a meeting that
// has actually happened or is happening.
func (s *MeetingService) attendanceMeeting(ctx context.Context, actorID, meetingID string) (db.Meeting, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingInProgress && m.Status != MeetingEnded {
		return db.Meeting{}, errInvalidState()
	}
	return m, nil
}

// MarkAttendance records a clerk's call for one person. A finalized roll is
// locked: correcting it means reopening first, so "finalized by" never sits
// on numbers that changed after it.
func (s *MeetingService) MarkAttendance(ctx context.Context, actorID, meetingID, participantID, status, note string) error {
	if !validAttendanceStatus(status) {
		return Invalid("trạng thái điểm danh không hợp lệ")
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > attendanceNoteMax {
		return Invalid("lý do tối đa 200 ký tự")
	}
	if status != AttendanceExcused {
		note = ""
	}
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (p.MeetingID != meetingID || p.Status != ParticipantActive)) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The row lock orders this against finalize and reopen.
	m, err = q.LockMeetingForAttendance(ctx, meetingID)
	if err != nil {
		return err
	}
	if m.AttendanceFinalizedAt.Valid {
		return errAttendanceFinalized()
	}
	before, err := s.attendanceReport(ctx, q, m)
	if err != nil {
		return err
	}
	prev := ""
	for _, r := range before.Rows {
		if r.Participant.ID == participantID {
			prev = r.Status
		}
	}
	if _, err := q.UpsertAttendanceMark(ctx, db.UpsertAttendanceMarkParams{
		ID: util.NewID(), OrganizationID: orgID, MeetingID: meetingID, ParticipantID: participantID,
		Status: status, Note: note, MarkedBy: strText(actorID),
	}); err != nil {
		return err
	}
	s.record(ctx, q, m, audit.User(actorID), "attendance.marked",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(map[string]any{"status": prev}, map[string]any{"status": status}))
	return tx.Commit(ctx)
}

// ClearAttendanceMark hands one person back to the automatic suggestion.
func (s *MeetingService) ClearAttendanceMark(ctx context.Context, actorID, meetingID, participantID string) error {
	if _, err := s.attendanceMeeting(ctx, actorID, meetingID); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	m, err := q.LockMeetingForAttendance(ctx, meetingID)
	if err != nil {
		return err
	}
	if m.AttendanceFinalizedAt.Valid {
		return errAttendanceFinalized()
	}
	n, err := q.DeleteAttendanceMark(ctx, db.DeleteAttendanceMarkParams{MeetingID: meetingID, ParticipantID: participantID})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	s.record(ctx, q, m, audit.User(actorID), "attendance.marked",
		meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
		audit.Diff(map[string]any{"source": AttendanceSourceManual}, map[string]any{"source": AttendanceSourceSuggested}))
	return tx.Commit(ctx)
}

// FinalizeAttendance freezes the current suggestions into AUTO rows, over the
// participants who are active at that moment.
// Idempotent: finalizing a finalized roll changes nothing and audits nothing.
func (s *MeetingService) FinalizeAttendance(ctx context.Context, actorID, meetingID string) error {
	m, err := s.attendanceMeeting(ctx, actorID, meetingID)
	if err != nil {
		return err
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if m, err = q.LockMeetingForAttendance(ctx, meetingID); err != nil {
		return err
	}
	if m.AttendanceFinalizedAt.Valid {
		return nil
	}
	// The snapshot is the people on the roll now. A clerk's mark outlives the
	// person's removal (and survives a reopen), so drop the marks of anyone
	// no longer a participant: otherwise they would come back, counted, on
	// the finalized roll they were never on.
	if _, err := q.DeleteInactiveAttendanceMarks(ctx, m.ID); err != nil {
		return err
	}
	rep, err := s.attendanceReport(ctx, q, m)
	if err != nil {
		return err
	}
	for _, r := range rep.Rows {
		if r.Source != AttendanceSourceSuggested {
			continue
		}
		if err := q.InsertAutoAttendanceMark(ctx, db.InsertAutoAttendanceMarkParams{
			ID: util.NewID(), OrganizationID: orgID, MeetingID: m.ID, ParticipantID: r.Participant.ID, Status: r.Status,
		}); err != nil {
			return err
		}
	}
	up, err := q.SetAttendanceFinalized(ctx, db.SetAttendanceFinalizedParams{
		ID: m.ID, FinalizedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, FinalizedBy: strText(actorID),
	})
	if err != nil {
		return err
	}
	_ = s.writeAudit(ctx, q, m, "ATTENDANCE_FINALIZED", actorID, "", "", "{}")
	s.record(ctx, q, up, audit.User(actorID), "attendance.finalized", nil, nil)
	return tx.Commit(ctx)
}

// ReopenAttendance drops the frozen AUTO rows; clerk marks stay.
func (s *MeetingService) ReopenAttendance(ctx context.Context, actorID, meetingID string) error {
	if _, err := s.attendanceMeeting(ctx, actorID, meetingID); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	m, err := q.LockMeetingForAttendance(ctx, meetingID)
	if err != nil {
		return err
	}
	if !m.AttendanceFinalizedAt.Valid {
		return nil
	}
	if err := q.DeleteAutoAttendanceMarks(ctx, m.ID); err != nil {
		return err
	}
	up, err := q.SetAttendanceFinalized(ctx, db.SetAttendanceFinalizedParams{ID: m.ID})
	if err != nil {
		return err
	}
	s.record(ctx, q, up, audit.User(actorID), "attendance.reopened", nil, nil)
	return tx.Commit(ctx)
}
