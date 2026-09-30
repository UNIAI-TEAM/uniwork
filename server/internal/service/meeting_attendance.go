package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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
)

// attendanceLateGrace: joining up to this long after the anchor still counts
// as on time. Fixed by the spec, not configurable.
const attendanceLateGrace = 10 * time.Minute

// attendanceAnchor is the moment "late" is measured from: the scheduled start,
// or the actual start for an instant meeting that had no schedule.
func attendanceAnchor(m db.Meeting) time.Time {
	if m.MeetingType == MeetingTypeInstant && m.ActualStartAt.Valid {
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
	rep := AttendanceReport{Meeting: m, Rows: make([]AttendanceRow, 0, len(ps))}
	for _, p := range ps {
		if p.Status != ParticipantActive {
			continue
		}
		row := AttendanceRow{Participant: p}
		if t, ok := byTotals[p.ID]; ok {
			row.FirstJoinedAt, row.LastLeftAt = t.FirstJoinedAt, t.LastLeftAt
			row.InRoom, row.SessionCount, row.PresentSeconds = t.InRoom, t.SessionCount, t.PresentSeconds
		}
		if mk, ok := byMark[p.ID]; ok {
			row.Status, row.Source, row.Note = mk.Status, mk.Source, mk.Note
		} else {
			var first *time.Time
			if row.FirstJoinedAt.Valid {
				f := row.FirstJoinedAt.Time
				first = &f
			}
			row.Status, row.Source = suggestAttendance(anchor, first), AttendanceSourceSuggested
		}
		rep.Rows = append(rep.Rows, row)
		if p.Standing != StandingMember {
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
