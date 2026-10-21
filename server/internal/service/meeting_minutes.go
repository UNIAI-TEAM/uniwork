package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The minutes of a meeting (UNI-2003, spec meeting follow-through §6.6, D12):
// a UniNote page the meeting references. A clerk makes it once the meeting
// has ended; "finalized" is a document version whose id the meeting records,
// so the page stays in the tree, editable for corrections, and the meeting
// shows when it changed since. Finalizing and reopening also need edit on the
// page: the meeting is never a second way into the document.

func errMinutesUnavailable() error {
	return coded(http.StatusServiceUnavailable, "minutes_unavailable", "máy chủ chưa bật tài liệu cho biên bản")
}

func errMinutesExist() error {
	return coded(http.StatusConflict, "minutes_exist", "cuộc họp đã có biên bản")
}

func errMinutesMissing() error {
	return coded(http.StatusConflict, "minutes_missing", "cuộc họp chưa có biên bản")
}

func errMinutesEditRequired() error {
	return CodedError{Code: "minutes_edit_required", Status: http.StatusForbidden, Err: ErrForbidden,
		Msg: "cần quyền sửa trang biên bản"}
}

// MeetingMinutes is the minutes' state as the meeting shows it.
type MeetingMinutes struct {
	DocumentID string
	// FinalizedAt is zero while the minutes are a draft.
	FinalizedAt        time.Time
	FinalizedBy        string
	FinalizedVersionID string
	// FinalizedVersion is the version's ordinal in the page's history.
	FinalizedVersion int32
	// EditedSinceFinalized: the page's content was saved after that version.
	EditedSinceFinalized bool
	// CanEdit is the caller's level on the page, edit or more.
	CanEdit bool
	// Readable is false for a member who may not read the page (it was made
	// private since): the meeting still says it has minutes and whether they
	// are finalized, but names neither the page, its version nor its edits.
	Readable bool
}

// Minutes reads the minutes of a meeting for any member; nil when it has
// none (never made, or the page was deleted or trashed since).
func (s *MeetingService) Minutes(ctx context.Context, userID, meetingID string) (*MeetingMinutes, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Docs == nil {
		return nil, nil
	}
	return s.describeMinutes(ctx, userID, m)
}

// FlagOrganization is the organization a meeting route's flags evaluate at:
// the meeting's, for a member of its workspace; "" for anyone else, who then
// learns nothing about that organization's flags.
func (s *MeetingService) FlagOrganization(ctx context.Context, userID, meetingID string) string {
	if userID == "" || meetingID == "" {
		return ""
	}
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return ""
	}
	return m.OrganizationID
}

// liveMinutesPage is the meeting's minutes page while it is alive.
func liveMinutesPage(ctx context.Context, q *db.Queries, m db.Meeting) (db.Document, bool, error) {
	if !m.MinutesDocumentID.Valid {
		return db.Document{}, false, nil
	}
	doc, err := q.GetDocument(ctx, db.GetDocumentParams{ID: m.MinutesDocumentID.String, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, false, nil
	}
	if err != nil {
		return db.Document{}, false, err
	}
	return doc, !doc.ArchivedAt.Valid, nil
}

func (s *MeetingService) describeMinutes(ctx context.Context, userID string, m db.Meeting) (*MeetingMinutes, error) {
	doc, ok, err := liveMinutesPage(ctx, s.q, m)
	if err != nil || !ok {
		return nil, err
	}
	out := &MeetingMinutes{DocumentID: doc.ID}
	if m.MinutesFinalizedAt.Valid {
		out.FinalizedAt = m.MinutesFinalizedAt.Time
		out.FinalizedBy = m.MinutesFinalizedBy.String
		out.FinalizedVersionID = m.MinutesFinalizedVersionID.String
		v, err := s.q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
			ID: out.FinalizedVersionID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		switch {
		case err == nil:
			out.FinalizedVersion = v.Version
			out.EditedSinceFinalized = doc.ContentSavedAt.Valid && doc.ContentSavedAt.Time.After(v.CreatedAt.Time)
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, err
		}
	}
	level, err := s.Docs.LevelFor(ctx, Human(userID), doc)
	if err != nil {
		return nil, err
	}
	out.CanEdit = level.AtLeast(DocumentLevelEdit)
	out.Readable = level.AtLeast(DocumentLevelView)
	if !out.Readable {
		out.DocumentID, out.FinalizedVersionID, out.FinalizedVersion, out.EditedSinceFinalized = "", "", 0, false
	}
	return out, nil
}

// CreateMinutes makes the minutes page of an ended meeting from its data
// (§7.6), shares edit with the host and the current secretaries, and records
// it on the meeting, all in one transaction.
func (s *MeetingService) CreateMinutes(ctx context.Context, userID, meetingID, locale string) (*MeetingMinutes, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Docs == nil {
		return nil, errMinutesUnavailable()
	}
	if m.Status != MeetingEnded {
		return nil, errInvalidState()
	}
	if _, ok, err := liveMinutesPage(ctx, s.q, m); err != nil || ok {
		if err == nil {
			err = errMinutesExist()
		}
		return nil, err
	}
	layout := minutesLayoutFor(locale)
	facts, narrative, editors, err := s.minutesInputs(ctx, m, userID)
	if err != nil {
		return nil, err
	}
	content, err := document.MarkdownToPage(renderMinutes(facts, narrative, layout), nil)
	if err != nil {
		return nil, documentServiceError(err)
	}
	err = s.inTx(ctx, func(q *db.Queries) error {
		locked, err := q.LockMeetingForMinutes(ctx, db.LockMeetingForMinutesParams{ID: m.ID, OrganizationID: m.OrganizationID})
		if err != nil {
			return err
		}
		if _, ok, err := liveMinutesPage(ctx, q, locked); err != nil || ok {
			if err == nil {
				err = errMinutesExist()
			}
			return err
		}
		doc, err := s.Docs.CreateSharedPageInTx(ctx, q, Human(userID), SharedPageInput{
			OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
			Title: minutesTitle(layout, facts), Content: content, Editors: editors,
		})
		if err != nil {
			return err
		}
		if err := q.SetMeetingMinutesDocument(ctx, db.SetMeetingMinutesDocumentParams{
			DocumentID: strText(doc.ID), ID: m.ID, OrganizationID: m.OrganizationID,
		}); err != nil {
			return err
		}
		return s.recordMinutes(ctx, q, m, userID, audit.ActionMeetingMinutesCreated, "minutes.created", doc.ID, nil)
	})
	if err != nil {
		return nil, err
	}
	return s.minutesAfter(ctx, userID, m.ID)
}

// FinalizeMinutes takes a version of the minutes page and records it. Again
// after a correction, the new version replaces the recorded one; with nothing
// changed since the latest version, that version is recorded.
func (s *MeetingService) FinalizeMinutes(ctx context.Context, userID, meetingID string) (*MeetingMinutes, error) {
	return s.changeMinutes(ctx, userID, meetingID, func(q *db.Queries, m db.Meeting, doc db.Document) error {
		v, err := s.Docs.CreateDocumentVersionInTx(ctx, q, Human(userID), doc)
		if err != nil {
			return err
		}
		if err := q.FinalizeMeetingMinutes(ctx, db.FinalizeMeetingMinutesParams{
			FinalizedBy: strText(userID), VersionID: strText(v.ID), ID: m.ID, OrganizationID: m.OrganizationID,
		}); err != nil {
			return err
		}
		// The meeting's own activity timeline still reads meeting_audit_logs.
		if err := s.writeAudit(ctx, q, m, "MINUTES_FINALIZED", userID, "", "", "{}"); err != nil {
			return err
		}
		return s.recordMinutes(ctx, q, m, userID, audit.ActionMeetingMinutesFinalized, "minutes.finalized", doc.ID,
			map[string]any{"version_id": v.ID, "version": v.Version})
	})
}

// ReopenMinutes makes the minutes a draft again; the version stays in the
// page's history. Minutes that are a draft already are left as they are.
func (s *MeetingService) ReopenMinutes(ctx context.Context, userID, meetingID string) (*MeetingMinutes, error) {
	return s.changeMinutes(ctx, userID, meetingID, func(q *db.Queries, m db.Meeting, doc db.Document) error {
		if !m.MinutesFinalizedAt.Valid {
			return nil
		}
		if err := q.ReopenMeetingMinutes(ctx, db.ReopenMeetingMinutesParams{ID: m.ID, OrganizationID: m.OrganizationID}); err != nil {
			return err
		}
		return s.recordMinutes(ctx, q, m, userID, audit.ActionMeetingMinutesReopened, "minutes.reopened", doc.ID,
			map[string]any{"version_id": m.MinutesFinalizedVersionID.String})
	})
}

// changeMinutes runs a finalize or reopen: a clerk, under the meeting lock,
// on a live minutes page they may edit.
func (s *MeetingService) changeMinutes(ctx context.Context, userID, meetingID string, fn func(q *db.Queries, m db.Meeting, doc db.Document) error) (*MeetingMinutes, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Docs == nil {
		return nil, errMinutesUnavailable()
	}
	err = s.inTx(ctx, func(q *db.Queries) error {
		locked, err := q.LockMeetingForMinutes(ctx, db.LockMeetingForMinutesParams{ID: m.ID, OrganizationID: m.OrganizationID})
		if err != nil {
			return err
		}
		if !locked.MinutesDocumentID.Valid {
			return errMinutesMissing()
		}
		doc, err := s.Docs.LockPageForEditInTx(ctx, q, Human(userID), locked.MinutesDocumentID.String)
		switch {
		case errors.Is(err, ErrForbidden):
			return errMinutesEditRequired()
		case errors.Is(err, ErrNotFound):
			return errMinutesMissing()
		case err != nil:
			return err
		}
		if doc.OrganizationID != m.OrganizationID || doc.WorkspaceID != m.WorkspaceID {
			return errMinutesMissing()
		}
		return fn(q, locked, doc)
	})
	if err != nil {
		return nil, err
	}
	return s.minutesAfter(ctx, userID, m.ID)
}

// minutesAfter answers a command with the minutes as they now stand.
func (s *MeetingService) minutesAfter(ctx context.Context, userID, meetingID string) (*MeetingMinutes, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	return s.describeMinutes(ctx, userID, m)
}

// recordMinutes writes the audit row and the minutes.* event of a command,
// in its transaction.
func (s *MeetingService) recordMinutes(ctx context.Context, q *db.Queries, m db.Meeting, userID, action, topic, docID string, meta map[string]any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	meta["document_id"] = docID
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, Actor: audit.User(userID),
		Action: action, ResourceType: "meeting", ResourceID: m.ID, Metadata: meta,
	}, audit.Event{Topic: topic, Payload: map[string]string{
		"meeting_id": m.ID, "document_id": docID, "workspace_id": m.WorkspaceID,
	}})
}

// minutesInputs reads what the minutes state (§7.6): the facts from tables,
// the narrative from the latest summary, and who edits the page (the host
// and the current secretaries).
func (s *MeetingService) minutesInputs(ctx context.Context, m db.Meeting, authorID string) (minutesFacts, minutesNarrative, []string, error) {
	var f minutesFacts
	var n minutesNarrative
	loc := meetingLocation(m.Timezone)
	day := func(t time.Time) string { return t.In(loc).Format("02/01/2006") }
	clock := func(t time.Time) string { return t.In(loc).Format("15:04") }
	start, end := m.StartsAt, m.EndsAt
	if m.ActualStartAt.Valid {
		start, end = m.ActualStartAt, m.ActualEndAt
	}
	f.Title, f.Date, f.Start, f.Zone = m.Title, day(start.Time), clock(start.Time), gmtOffset(start.Time.In(loc))
	if end.Valid {
		f.End = clock(end.Time)
	}
	f.CreatedOn = day(time.Now())

	ps, err := s.q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return f, n, nil, err
	}
	editors := []string{m.HostUserID}
	for _, p := range ps {
		if p.Status != ParticipantActive {
			continue
		}
		f.Invited = append(f.Invited, p.DisplayNameSnapshot)
		if p.UserID.String == m.HostUserID {
			f.Host = p.DisplayNameSnapshot
		}
		if p.IsSecretary && p.UserID.Valid {
			f.Secretaries = append(f.Secretaries, p.DisplayNameSnapshot)
			editors = append(editors, p.UserID.String)
		}
	}
	if m.AttendanceFinalizedAt.Valid {
		rep, err := s.attendanceReport(ctx, s.q, m)
		if err != nil {
			return f, n, nil, err
		}
		f.Attendance = summaryAttendanceFacts(m, rep)
	}
	closed, err := s.q.ListClosedMeetingMotions(ctx, m.ID)
	if err != nil {
		return f, n, nil, err
	}
	f.Motions = summaryMotionFacts(closed)

	items, err := s.q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return f, n, nil, err
	}
	nameIDs := []string{authorID, m.HostUserID}
	for _, r := range items {
		if actionItemStatus(r.MeetingActionItem, r.TaskLive) == ActionItemConverted && r.TaskAssigneeID.Valid {
			nameIDs = append(nameIDs, r.TaskAssigneeID.String)
		}
	}
	users, err := s.q.GetUsersByIDs(ctx, nameIDs)
	if err != nil {
		return f, n, nil, err
	}
	names := make(map[string]string, len(users))
	for _, u := range users {
		names[u.ID] = u.DisplayName
	}
	f.Author = names[authorID]
	if f.Host == "" {
		f.Host = names[m.HostUserID]
	}
	for _, r := range items {
		if actionItemStatus(r.MeetingActionItem, r.TaskLive) != ActionItemConverted {
			continue
		}
		t := minutesTask{Title: r.TaskTitle, Assignee: names[r.TaskAssigneeID.String]}
		if r.TaskDueDate.Valid {
			t.Due = r.TaskDueDate.Time.Format("02/01/2006")
		}
		f.Assigned = append(f.Assigned, t)
	}

	sum, err := s.q.GetLatestMeetingSummary(ctx, m.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, n, editors, nil
	}
	if err != nil {
		return f, n, nil, err
	}
	n.Summary = sum.Summary
	decisions := DecodeSummaryDecisions(sum.Decisions)
	at, err := s.segmentMoments(ctx, m, decisions, clock)
	if err != nil {
		return f, n, nil, err
	}
	for _, d := range decisions {
		md := minutesDecision{Text: d.Text}
		for _, r := range d.Evidence {
			if mark, ok := at[r.ID]; ok && r.Kind == EvidenceSegment && !slices.Contains(md.At, mark) {
				md.At = append(md.At, mark)
			}
		}
		n.Decisions = append(n.Decisions, md)
	}
	return f, n, editors, nil
}

// segmentMoments maps each transcript segment the decisions cite to the clock
// time it was spoken at, as the meeting's own clock shows it.
func (s *MeetingService) segmentMoments(ctx context.Context, m db.Meeting, decisions []SummaryDecision, clock func(time.Time) string) (map[string]string, error) {
	out := map[string]string{}
	var ids []string
	for _, d := range decisions {
		for _, r := range d.Evidence {
			if r.Kind == EvidenceSegment {
				ids = append(ids, r.ID)
			}
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.ListTranscriptSegmentsByIDs(ctx, db.ListTranscriptSegmentsByIDsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID, Ids: ids})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.SpokenAt.Valid {
			out[r.ID] = clock(r.SpokenAt.Time)
		}
	}
	return out, nil
}

// gmtOffset names t's offset from UTC the way a reader expects it: "GMT+7",
// "GMT+5:30", "GMT-3", "GMT+0".
func gmtOffset(t time.Time) string {
	_, secs := t.Zone()
	sign := "+"
	if secs < 0 {
		sign, secs = "-", -secs
	}
	if mins := secs % 3600 / 60; mins != 0 {
		return fmt.Sprintf("GMT%s%d:%02d", sign, secs/3600, mins)
	}
	return fmt.Sprintf("GMT%s%d", sign, secs/3600)
}
