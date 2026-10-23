package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The meeting tools of the MCP connector (spec 2026-10-14 §5.3). Meetings live
// on MeetingService, where a workspace member reads every meeting of the
// workspace; each call runs as the person who consented. Transcripts never
// leave, and neither do attendee emails.

// McpAttendee is one row of a meeting's participant list, by name: the
// participant row also holds an email, which stays behind. A guest has no
// user_id.
type McpAttendee struct {
	UserID string `json:"user_id,omitempty"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

// McpMeeting is a meeting as a tool shows it. Description and the attendees
// are only set by get_meeting: the description is the stored text, exact, cut
// at mcpMaxItemRunes with DescriptionTruncated when longer, so a model edits
// from the real text and not from the excerpt; the attendees stop at
// mcpMaxList with AttendeesTruncated. get_meeting's excerpt is the AI summary
// alone; the description is not repeated in it.
type McpMeeting struct {
	McpItem
	Revision             int64         `json:"revision"`
	EndsAt               string        `json:"ends_at,omitempty"`
	Timezone             string        `json:"timezone,omitempty"`
	HostUserID           string        `json:"host_user_id,omitempty"`
	ProjectID            string        `json:"project_id,omitempty"`
	Attendees            []McpAttendee `json:"attendees,omitempty"`
	AttendeesTruncated   bool          `json:"attendees_truncated,omitempty"`
	Description          *string       `json:"description,omitempty"`
	DescriptionTruncated bool          `json:"description_truncated,omitempty"`
}

// McpMeetingList is what list_meetings returns: the rows, and whether more
// matched than came back.
type McpMeetingList struct {
	Meetings  []McpMeeting `json:"meetings"`
	Truncated bool         `json:"truncated"`
}

const (
	mcpMaxRange = 92 * 24 * time.Hour

	// A meeting title holds at most this many characters here. The tools'
	// own limit, not the service's (the web has none): changes cuts a title
	// at mcpMaxHitRunes, so one stored longer cannot be restored from from.
	mcpMaxMeetingTitleRunes = 300
	mcpMaxAttendees         = 50
	mcpMaxInvites           = 20

	// A cancellation's reason holds at most this many characters; the
	// schema says so and the tool holds it too.
	mcpMaxCancelReasonRunes = 500

	// mcpNotMember is the answer for a person who is not in the workspace: the
	// same for an id of another organization as for one nobody has.
	mcpNotMember = "not a member of this workspace; call list_members for the user_id values"

	// mcpMeetingMissed is a scheduled meeting whose time passed without it
	// starting. The service stores SCHEDULED; the list filter and meetingOf
	// know it as MISSED.
	mcpMeetingMissed = "MISSED"
)

// mcpMeetingStatuses is the statuses list_meetings filters by, as a person
// sees them (MeetingListFilter.Status).
var mcpMeetingStatuses = []string{MeetingScheduled, MeetingInProgress, MeetingEnded, MeetingCanceled, mcpMeetingMissed}

// mcpParseTime reads an RFC 3339 time with its offset. A time without one is
// refused, never read as UTC: "10 giờ" means the person's 10 o'clock.
func mcpParseTime(field, v string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, McpInvalidArgs{Msg: field + " must be ISO 8601 with a timezone offset, e.g. 2026-10-15T10:00:00+07:00"}
	}
	return t, nil
}

// meetingOf shows a meeting row. Its status is display-only, what the meetings
// screen shows (displayMeetingStatus) and what the MISSED filter of
// list_meetings selects: a scheduled meeting whose end has passed reads MISSED.
// The services keep the stored SCHEDULED, and no tool writes this value.
func (s *McpToolService) meetingOf(base string, m db.Meeting) McpMeeting {
	status := m.Status
	if status == MeetingScheduled && m.EndsAt.Valid && m.EndsAt.Time.Before(time.Now()) {
		status = mcpMeetingMissed
	}
	out := McpMeeting{
		McpItem:  McpItem{Kind: "meeting", ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Status: status, URL: s.frontend + base + "/meetings/" + m.ID, Excerpt: capRunes(m.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: int64(m.Version), Timezone: m.Timezone, HostUserID: m.HostUserID, ProjectID: m.ProjectID.String,
	}
	if m.StartsAt.Valid {
		out.StartsAt = m.StartsAt.Time.UTC().Format(time.RFC3339)
	}
	if m.EndsAt.Valid {
		out.EndsAt = m.EndsAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// meeting resolves a meeting id inside the workspace as the person. It first
// checks that the workspace belongs to the grant's organization, so no tool
// that reaches a meeting can forget to; a meeting of another workspace reads
// as absent.
func (s *McpToolService) meeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (db.Meeting, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return db.Meeting{}, err
	}
	if strings.TrimSpace(meetingID) == "" {
		return db.Meeting{}, McpInvalidArgs{Msg: "meeting_id is required"}
	}
	m, err := s.ask.meetings.Get(ctx, p.UserID, meetingID)
	if err != nil {
		return db.Meeting{}, hidden(err)
	}
	if m.WorkspaceID != workspaceID {
		return db.Meeting{}, ErrNotFound
	}
	return m, nil
}

// attendees lists the first mcpMaxList participants in the order they were
// added, the removed ones too, as the participant list of a screen does.
func (s *McpToolService) attendees(ctx context.Context, p McpPrincipal, meetingID string) (out []McpAttendee, truncated bool, err error) {
	rows, err := s.ask.meetings.ListParticipants(ctx, p.UserID, "", meetingID)
	if err != nil {
		return nil, false, err
	}
	if truncated = len(rows) > mcpMaxList; truncated {
		rows = rows[:mcpMaxList]
	}
	out = make([]McpAttendee, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpAttendee{UserID: r.UserID.String, Name: r.DisplayNameSnapshot, Role: r.Role, Status: r.Status})
	}
	return out, truncated, nil
}

// GetMeeting reads one meeting: its row, its attendees, and the AI summary in
// the excerpt. No transcript is read.
func (s *McpToolService) GetMeeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (McpMeeting, error) {
	m, err := s.meeting(ctx, p, workspaceID, meetingID)
	if err != nil {
		return McpMeeting{}, err
	}
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return McpMeeting{}, err
	}
	out := s.meetingOf(base, m)
	// The description has a field of its own here, and Ask UNI's reader puts it
	// before the summary, so a long one would push the summary out of the
	// excerpt: the excerpt is the summary alone.
	out.Excerpt = ""
	sum, err := s.ask.meetings.Summary(ctx, p.UserID, m.ID)
	if err != nil {
		return McpMeeting{}, hidden(err)
	}
	if sum != nil {
		out.Excerpt = capRunes("Tóm tắt: "+sum.Summary+"\nQuyết định: "+sum.Decisions+"\nViệc cần làm: "+sum.ActionItems, mcpMaxItemRunes, mcpItemCut)
	}
	desc := capRunes(m.Description, mcpMaxItemRunes, "")
	out.Description, out.DescriptionTruncated = &desc, desc != m.Description
	if out.Attendees, out.AttendeesTruncated, err = s.attendees(ctx, p, m.ID); err != nil {
		return McpMeeting{}, hidden(err)
	}
	return out, nil
}

type mcpListMeetingsIn struct {
	WorkspaceID string `json:"workspace_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	HostedByMe  bool   `json:"hosted_by_me"`
	Status      string `json:"status"`
}

func (s *McpToolService) ListMeetings(ctx context.Context, p McpPrincipal, in mcpListMeetingsIn) (McpMeetingList, error) {
	from, err := mcpParseTime("from", in.From)
	if err != nil {
		return McpMeetingList{}, err
	}
	to, err := mcpParseTime("to", in.To)
	if err != nil {
		return McpMeetingList{}, err
	}
	if !to.After(from) || to.Sub(from) > mcpMaxRange {
		return McpMeetingList{}, McpInvalidArgs{Msg: "to must be after from, at most 92 days later"}
	}
	if in.Status != "" {
		if err := mcpProjectEnum("status", in.Status, mcpMeetingStatuses); err != nil {
			return McpMeetingList{}, err
		}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpMeetingList{}, err
	}
	// "starts_at" is the screen's calendar order, around the person's own today.
	tz, err := s.timezoneOf(ctx, p.UserID, "")
	if err != nil {
		return McpMeetingList{}, err
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return McpMeetingList{}, err
	}
	f := MeetingListFilter{Status: in.Status, From: &from, To: &to, Limit: mcpMaxList, Sort: "starts_at", Location: loc}
	if in.HostedByMe {
		f.HostUserID = p.UserID
	}
	rows, total, err := s.ask.meetings.ListFiltered(ctx, p.UserID, in.WorkspaceID, f)
	if err != nil {
		return McpMeetingList{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpMeetingList{}, err
	}
	out := McpMeetingList{Meetings: make([]McpMeeting, 0, len(rows)), Truncated: total > int64(len(rows))}
	for _, r := range rows {
		out.Meetings = append(out.Meetings, s.meetingOf(base, r.Meeting))
	}
	return out, nil
}

// mcpZone is an IANA zone Go can load. "Local" loads too and means nothing to
// anyone reading the meeting elsewhere, so it is refused with the rest.
func mcpZone(tz string) (string, error) {
	if _, err := time.LoadLocation(tz); err != nil || tz == "" || tz == "Local" {
		return "", McpInvalidArgs{Msg: "timezone must be an IANA zone such as Asia/Ho_Chi_Minh"}
	}
	return tz, nil
}

// timezoneOf is the zone a new meeting is set in: the one given, else the
// person's own (users.timezone; one that is empty or not a usable zone is
// Vietnam's, as on the home screen). The zone is a label; starts_at already
// names the moment.
func (s *McpToolService) timezoneOf(ctx context.Context, userID, given string) (string, error) {
	if tz := strings.TrimSpace(given); tz != "" {
		return mcpZone(tz)
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	// A profile zone update_meeting would refuse to send back ("Local" loads)
	// is not a label to give a meeting.
	if tz, err := mcpZone(u.Timezone); err == nil {
		return tz, nil
	}
	return homeDefaultTimezone, nil
}

// mcpVersion is the meeting revision a model sent, as the int32 the service
// compares.
func mcpVersion(rev *int64) (int32, error) {
	if rev == nil || *rev <= 0 || *rev > math.MaxInt32 {
		return 0, McpInvalidArgs{Msg: "revision is required; read the meeting first and send its revision"}
	}
	return int32(*rev), nil
}

// mcpIDList is a list of ids, each kept once in the order given. A blank entry
// is a mistake for the model to correct, never someone to skip.
func mcpIDList(field string, ids []string) ([]string, error) {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return nil, McpInvalidArgs{Msg: field + " must not hold a blank id"}
		}
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out, nil
}

// notWorkspaceMember is the refusal MeetingService gives for a person it cannot
// invite because they are not in the workspace (inviteUserTx). It gives it for
// every failed membership check, so an id of another organization and one
// nobody has cannot be told apart.
func notWorkspaceMember(err error) bool { return codedIs(err, "invalid_request") }

type mcpScheduleMeetingIn struct {
	WorkspaceID string   `json:"workspace_id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	StartsAt    string   `json:"starts_at"`
	EndsAt      string   `json:"ends_at"`
	Timezone    string   `json:"timezone"`
	AttendeeIDs []string `json:"attendee_ids"`
	ProjectID   string   `json:"project_id"`
}

// ScheduleMeeting makes a meeting hosted by the person. The people in
// attendee_ids join it, each once, and nobody is notified: MeetingService
// records no participant.invited for them, and only that event has a
// notification rule. invite_to_meeting is the call that notifies.
func (s *McpToolService) ScheduleMeeting(ctx context.Context, p McpPrincipal, in mcpScheduleMeetingIn) (McpWriteResult, error) {
	if title := strings.TrimSpace(in.Title); title == "" || utf8.RuneCountInString(title) > mcpMaxMeetingTitleRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxMeetingTitleRunes)}
	}
	// update_meeting could never edit or undo a longer one.
	if utf8.RuneCountInString(in.Description) > mcpMaxItemRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here", mcpMaxItemRunes)}
	}
	start, err := mcpParseTime("starts_at", in.StartsAt)
	if err != nil {
		return McpWriteResult{}, err
	}
	end, err := mcpParseTime("ends_at", in.EndsAt)
	if err != nil {
		return McpWriteResult{}, err
	}
	if !end.After(start) {
		return McpWriteResult{}, McpInvalidArgs{Msg: "ends_at must be after starts_at"}
	}
	if len(in.AttendeeIDs) > mcpMaxAttendees {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("at most %d attendees", mcpMaxAttendees)}
	}
	attendees, err := mcpIDList("attendee_ids", in.AttendeeIDs)
	if err != nil {
		return McpWriteResult{}, err
	}
	if _, err := mcpID("project_id", in.ProjectID); err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	tz, err := s.timezoneOf(ctx, p.UserID, in.Timezone)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Read before the write: a failure after it would read as a failed schedule.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	m, err := s.ask.meetings.Create(ctx, p.UserID, in.WorkspaceID, CreateMeetingInput{
		Title: in.Title, Description: in.Description, StartsAt: start, EndsAt: end, Timezone: tz,
		ProjectID: in.ProjectID, AttendeeUserIDs: attendees,
	})
	if notWorkspaceMember(err) {
		return McpWriteResult{}, McpInvalidArgs{Msg: "attendee_ids holds someone " + mcpNotMember}
	}
	if err != nil {
		return McpWriteResult{}, err
	}
	item, note := s.scheduledItem(ctx, p, base, m)
	return McpWriteResult{Item: item, Revision: int64(m.Version), Note: note}, nil
}

// scheduledItem is the meeting just made, with the attendees read back as
// invite_to_meeting does. The meeting exists already, so a failed read is named
// in the note, never returned: a model that read "failed" would schedule twice.
func (s *McpToolService) scheduledItem(ctx context.Context, p McpPrincipal, base string, m db.Meeting) (McpMeeting, string) {
	item := s.meetingOf(base, m)
	var err error
	if item.Attendees, item.AttendeesTruncated, err = s.attendees(ctx, p, m.ID); err != nil {
		item.Attendees, item.AttendeesTruncated = nil, false
		return item, "the meeting was scheduled, but its attendees could not be read back; call get_meeting for them"
	}
	return item, ""
}

type mcpUpdateMeetingIn struct {
	WorkspaceID string         `json:"workspace_id"`
	MeetingID   string         `json:"meeting_id"`
	Revision    *int64         `json:"revision"`
	Title       mcpOpt[string] `json:"title"`
	Description mcpOpt[string] `json:"description"`
	StartsAt    mcpOpt[string] `json:"starts_at"`
	EndsAt      mcpOpt[string] `json:"ends_at"`
	Timezone    mcpOpt[string] `json:"timezone"`
	ProjectID   mcpOpt[string] `json:"project_id"`
}

// parse refuses what the service would misread, or the model could not undo,
// and reads the call into the service's input: no revision, nothing to change,
// null for a field that cannot be empty, a blank project, a time without an
// offset. project_id null is the one clear: the service takes "" for it.
func (in mcpUpdateMeetingIn) parse() (UpdateMeetingInput, error) {
	var upd UpdateMeetingInput
	version, err := mcpVersion(in.Revision)
	if err != nil {
		return upd, err
	}
	upd.ExpectedVersion = &version
	// Nothing to write would still bump the revision and notify the web.
	if !(in.Title.Set || in.Description.Set || in.StartsAt.Set || in.EndsAt.Set || in.Timezone.Set || in.ProjectID.Set) {
		return upd, McpInvalidArgs{Msg: "name at least one field to change"}
	}
	if in.Description.Null {
		return upd, McpInvalidArgs{Msg: `description cannot be null; send "" to clear it`}
	}
	for _, f := range []struct {
		name string
		o    mcpOpt[string]
	}{{"title", in.Title}, {"starts_at", in.StartsAt}, {"ends_at", in.EndsAt}, {"timezone", in.Timezone}} {
		if f.o.Null {
			return upd, McpInvalidArgs{Msg: f.name + " cannot be null; send a value"}
		}
	}
	if err := mcpDescriptionUndoable(in.Description, ""); err != nil {
		return upd, err
	}
	upd.Description = in.Description.ptr()
	if in.Title.Set {
		title := strings.TrimSpace(in.Title.Value)
		if title == "" || utf8.RuneCountInString(title) > mcpMaxMeetingTitleRunes {
			return upd, McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxMeetingTitleRunes)}
		}
		upd.Title = &title
	}
	if in.StartsAt.Set {
		t, err := mcpParseTime("starts_at", in.StartsAt.Value)
		if err != nil {
			return upd, err
		}
		upd.StartsAt = &t
	}
	if in.EndsAt.Set {
		t, err := mcpParseTime("ends_at", in.EndsAt.Value)
		if err != nil {
			return upd, err
		}
		upd.EndsAt = &t
	}
	if upd.StartsAt != nil && upd.EndsAt != nil && !upd.EndsAt.After(*upd.StartsAt) {
		return upd, McpInvalidArgs{Msg: "ends_at must be after starts_at"}
	}
	if in.Timezone.Set {
		tz, err := mcpZone(strings.TrimSpace(in.Timezone.Value))
		if err != nil {
			return upd, err
		}
		upd.Timezone = &tz
	}
	if in.ProjectID.Set {
		project := ""
		if !in.ProjectID.Null {
			if project = strings.TrimSpace(in.ProjectID.Value); project == "" {
				return upd, McpInvalidArgs{Msg: "project_id must not be blank; send null to clear it"}
			}
		}
		upd.ProjectID = &project
	}
	return upd, nil
}

// UpdateMeeting changes one meeting in one command. The service checks the
// revision again under the row lock, so a meeting changed after the read below
// is refused and nothing is written. Nobody is notified: meeting.updated has
// no notification rule.
func (s *McpToolService) UpdateMeeting(ctx context.Context, p McpPrincipal, in mcpUpdateMeetingIn) (McpWriteResult, error) {
	upd, err := in.parse()
	if err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Undo sends from back, and get_meeting shows no more than this: a longer
	// description replaced here could not be restored.
	if err := mcpDescriptionUndoable(in.Description, before.Description); err != nil {
		return McpWriteResult{}, err
	}
	// The same for a title and a zone: the tool refuses to send back a title over
	// its cap or a zone that is not an IANA one, so it does not replace either.
	if in.Title.Set && utf8.RuneCountInString(before.Title) > mcpMaxMeetingTitleRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "the meeting's title is too long to change safely here; edit it in UniWork"}
	}
	if in.Timezone.Set {
		if _, err := mcpZone(before.Timezone); err != nil {
			return McpWriteResult{}, McpInvalidArgs{Msg: "the meeting's timezone is not an IANA zone this tool could send back, so it is not changed here; edit it in UniWork"}
		}
	}
	// Read before the write: a failure after it would read as a failed update.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	after, err := s.ask.meetings.Update(ctx, p.UserID, before.ID, upd)
	if err != nil {
		return McpWriteResult{}, err
	}
	// meetingOf's status is display-only; no change below reads it.
	b, a := s.meetingOf(base, before), s.meetingOf(base, after)
	changes := mcpChanges(McpChange{"title", before.Title, after.Title})
	if before.Description != after.Description {
		// Uncut, unlike the rest: both sides are at most mcpMaxItemRunes, and
		// from is how the model puts the old text back.
		changes = append(changes, McpChange{"description", before.Description, after.Description})
	}
	changes = append(changes, mcpChanges(
		McpChange{"starts_at", b.StartsAt, a.StartsAt},
		McpChange{"ends_at", b.EndsAt, a.EndsAt},
		McpChange{"timezone", b.Timezone, a.Timezone},
		McpChange{"project_id", mcpNullable(b.ProjectID), mcpNullable(a.ProjectID)},
	)...)
	return McpWriteResult{Item: a, Revision: a.Revision, Changes: changes}, nil
}

type mcpInviteIn struct {
	WorkspaceID string   `json:"workspace_id"`
	MeetingID   string   `json:"meeting_id"`
	UserIDs     []string `json:"user_ids"`
}

// McpInviteOutcome is one person of an invite_to_meeting call: "invited",
// "already_attending" (on the meeting before the call, notified again), or why
// not.
type McpInviteOutcome struct {
	UserID string `json:"user_id"`
	Result string `json:"result"`
}

// McpInviteResult is what invite_to_meeting returns: the outcome for each
// person, and the meeting as it is now. The meeting is absent when it could not
// be read back after the invitations went out.
type McpInviteResult struct {
	Meeting *McpMeeting        `json:"meeting,omitempty"`
	Invites []McpInviteOutcome `json:"invites"`
}

// mcpInviteRefusal is a person's result when the service refused them: the
// words the transport would show, never the service's text.
func mcpInviteRefusal(err error) string {
	if notWorkspaceMember(err) {
		return mcpNotMember
	}
	return mcpStepError(err)
}

// mcpCallRefusal is a refusal that holds for the whole invite call, whoever is
// named: the person may not invite, the meeting does not take invitations, or
// it is gone. Read as the first invitation's, it is the tool's error; a refusal
// about the person (not a member, removed) is only theirs.
func mcpCallRefusal(err error) bool {
	return codedIs(err, "not_meeting_host") || codedIs(err, "invalid_meeting_state") || errors.Is(mcpMapError(err), ErrNotFound)
}

// InviteToMeeting invites each person in turn, as the service does for one:
// each person invited is notified (participant.invited, ruleParticipantInvited),
// one already on the meeting again, and that one reads already_attending, not
// invited, since the undo of an invite removes only a person it added. A refusal about one person is that person's
// result and does not stop the others; one about the whole call fails the call
// at the first person, before anyone is invited.
func (s *McpToolService) InviteToMeeting(ctx context.Context, p McpPrincipal, in mcpInviteIn) (McpWriteResult, error) {
	if len(in.UserIDs) == 0 || len(in.UserIDs) > mcpMaxInvites {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("user_ids must hold 1-%d user_id values from list_members", mcpMaxInvites)}
	}
	ids, err := mcpIDList("user_ids", in.UserIDs)
	if err != nil {
		return McpWriteResult{}, err
	}
	m, err := s.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Read before the write: a failure after the invitations went out would
	// tell the model they failed, and a retry would notify twice.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Who is on the meeting now, before the invitations change it: inviting one
	// of them adds nobody, so their result is not "invited", and undoing the
	// invite must not remove them.
	rows, err := s.ask.meetings.ListParticipants(ctx, p.UserID, "", m.ID)
	if err != nil {
		return McpWriteResult{}, hidden(err)
	}
	attending := map[string]bool{}
	for _, r := range rows {
		if r.Status == ParticipantActive && r.UserID.Valid {
			attending[r.UserID.String] = true
		}
	}
	outcomes := make([]McpInviteOutcome, 0, len(ids))
	for i, id := range ids {
		result := "invited"
		if _, err := s.ask.meetings.Invite(ctx, p.UserID, m.ID, id); err != nil {
			if i == 0 && mcpCallRefusal(err) {
				return McpWriteResult{}, mcpMapError(err)
			}
			result = mcpInviteRefusal(err)
		} else if attending[id] {
			result = "already_attending"
		}
		outcomes = append(outcomes, McpInviteOutcome{UserID: id, Result: result})
	}
	// The invitations are out. A failed read-back is named in the note, never
	// returned: a model that read "failed" would invite everyone again.
	var item McpMeeting
	after, err := s.ask.meetings.Get(ctx, p.UserID, m.ID)
	if err == nil {
		item = s.meetingOf(base, after)
		item.Attendees, item.AttendeesTruncated, err = s.attendees(ctx, p, m.ID)
	}
	if err != nil {
		return McpWriteResult{Item: McpInviteResult{Invites: outcomes}, Note: "the invitations in invites were processed, but the meeting could not be read back; call get_meeting for its attendees and revision"}, nil
	}
	return McpWriteResult{Item: McpInviteResult{Meeting: &item, Invites: outcomes}, Revision: item.Revision}, nil
}

type mcpCancelMeetingIn struct {
	WorkspaceID string `json:"workspace_id"`
	MeetingID   string `json:"meeting_id"`
	Revision    *int64 `json:"revision"`
	Reason      string `json:"reason"`
}

// mcpRestoreMeetingIn has no reason: decodeInto refuses one, as the schema says.
type mcpRestoreMeetingIn struct {
	WorkspaceID string `json:"workspace_id"`
	MeetingID   string `json:"meeting_id"`
	Revision    *int64 `json:"revision"`
}

// meetingToChange is the start of cancel_meeting and restore_meeting: the
// revision the model sent, the meeting as it is, and the link base. All three
// are read before the write, so a failure after it cannot read as a failed one.
func (s *McpToolService) meetingToChange(ctx context.Context, p McpPrincipal, workspaceID, meetingID string, revision *int64) (before db.Meeting, version int32, base string, err error) {
	if version, err = mcpVersion(revision); err != nil {
		return
	}
	if before, err = s.meeting(ctx, p, workspaceID, meetingID); err != nil {
		return
	}
	base, err = s.ask.base(ctx, workspaceID)
	return
}

// meetingChanged reads the meeting back after a cancel or restore that went
// through. The change is committed, so a failed read is named in the note and
// never returned: a model that read "failed" would send it again. The status
// change is of the stored statuses; the item's status is the display one.
func (s *McpToolService) meetingChanged(ctx context.Context, p McpPrincipal, before db.Meeting, base, saved, note string) (McpWriteResult, error) {
	after, err := s.ask.meetings.Get(ctx, p.UserID, before.ID)
	if err != nil {
		unread := saved + ", but the meeting could not be read back; call get_meeting for its status and revision"
		if note != "" {
			unread += "; " + note
		}
		return McpWriteResult{Note: unread}, nil
	}
	return McpWriteResult{Item: s.meetingOf(base, after), Revision: int64(after.Version), Changes: mcpChanges(McpChange{"status", before.Status, after.Status}), Note: note}, nil
}

// CancelMeeting cancels a scheduled meeting. The service takes a meeting that
// is still SCHEDULED, one whose time passed (displayed MISSED) included, and
// refuses one in progress, ended or already cancelled. Nobody is notified:
// meeting.canceled and meeting.deleted have no notification rule.
// RestoreMeeting is its undo, but only while the end is ahead, so a meeting
// cancelled after its time says so in the note.
func (s *McpToolService) CancelMeeting(ctx context.Context, p McpPrincipal, in mcpCancelMeetingIn) (McpWriteResult, error) {
	if utf8.RuneCountInString(in.Reason) > mcpMaxCancelReasonRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("reason holds at most %d characters", mcpMaxCancelReasonRunes)}
	}
	before, version, base, err := s.meetingToChange(ctx, p, in.WorkspaceID, in.MeetingID, in.Revision)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := s.ask.meetings.CancelAt(ctx, p.UserID, before.ID, in.Reason, version); err != nil {
		return McpWriteResult{}, err
	}
	var note string
	if !before.EndsAt.Time.After(time.Now()) {
		note = "the meeting's end time has passed, so restore_meeting cannot bring it back"
	}
	return s.meetingChanged(ctx, p, before, base, "the meeting was cancelled", note)
}

// RestoreMeeting brings a cancelled meeting back to scheduled while its end is
// still ahead; the service refuses any other state and the host check the same
// way as for the cancel. Nobody is notified: meeting.updated has no rule.
func (s *McpToolService) RestoreMeeting(ctx context.Context, p McpPrincipal, in mcpRestoreMeetingIn) (McpWriteResult, error) {
	before, version, base, err := s.meetingToChange(ctx, p, in.WorkspaceID, in.MeetingID, in.Revision)
	if err != nil {
		return McpWriteResult{}, err
	}
	if _, err := s.ask.meetings.Restore(ctx, p.UserID, before.ID, &version); err != nil {
		return McpWriteResult{}, err
	}
	return s.meetingChanged(ctx, p, before, base, "the meeting was restored", "")
}

var mcpSchemaListMeetings = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"from":{"type":"string","description":"ISO 8601 with a timezone offset, e.g. 2026-10-15T00:00:00+07:00."},"to":{"type":"string","description":"ISO 8601 with a timezone offset, after from and at most 92 days later."},"hosted_by_me":{"type":"boolean","description":"Only the meetings the user hosts."},"status":{"type":"string","enum":["SCHEDULED","IN_PROGRESS","ENDED","CANCELED","MISSED"],"description":"MISSED is a scheduled meeting whose time passed without it starting, and its status reads MISSED; SCHEDULED is one that can still start. Omit for every status."}},"required":["workspace_id","from","to"],"additionalProperties":false}`)

var (
	mcpSchemaScheduleMeeting = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":` + strconv.Itoa(mcpMaxMeetingTitleRunes) + `},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `},"starts_at":{"type":"string","description":"ISO 8601 with a timezone offset, e.g. 2026-10-15T10:00:00+07:00."},"ends_at":{"type":"string","description":"ISO 8601 with a timezone offset, after starts_at."},"timezone":{"type":"string","description":"IANA zone such as Asia/Ho_Chi_Minh, the zone the meeting is set in. Omit for the user's own."},"attendee_ids":{"type":"array","items":{"type":"string","minLength":1},"maxItems":` + strconv.Itoa(mcpMaxAttendees) + `,"description":"user_id values from list_members. They are added without a notification."},"project_id":{"type":"string"}},"required":["workspace_id","title","starts_at","ends_at"],"additionalProperties":false}`)
	mcpSchemaUpdateMeeting   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer","description":"The revision you read with get_meeting or list_meetings."},"title":{"type":"string","minLength":1,"maxLength":` + strconv.Itoa(mcpMaxMeetingTitleRunes) + `},"description":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxItemRunes) + `,"description":"Replaces the whole description. Edit from the description get_meeting returns."},"starts_at":{"type":"string","description":"ISO 8601 with a timezone offset."},"ends_at":{"type":"string","description":"ISO 8601 with a timezone offset, after starts_at."},"timezone":{"type":"string","description":"IANA zone such as Asia/Ho_Chi_Minh."},"project_id":{"type":["string","null"],"description":"A project of this workspace from list_projects; null takes the meeting out of its project."}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
	mcpSchemaCancelMeeting   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer","description":"The revision you read with get_meeting or list_meetings."},"reason":{"type":"string","maxLength":` + strconv.Itoa(mcpMaxCancelReasonRunes) + `}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
	mcpSchemaRestoreMeeting  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer","description":"The revision the cancel_meeting call returned, or get_meeting shows now."}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
	mcpSchemaInviteToMeeting = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"user_ids":{"type":"array","items":{"type":"string","minLength":1},"minItems":1,"maxItems":` + strconv.Itoa(mcpMaxInvites) + `,"description":"user_id values from list_members."}},"required":["workspace_id","meeting_id","user_ids"],"additionalProperties":false}`)
)

func mcpMeetingTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_meetings", "List meetings", "Meetings of one workspace that start between from and to (ISO 8601 with a timezone offset, at most 92 days apart), each with its revision. Ordered like the meetings screen: those starting today in the user's timezone or later first, soonest first, then earlier days, most recent day first, each day by start time. Cancelled ones are included with status CANCELED unless status narrows the list; MISSED is a scheduled meeting whose time passed without it starting, and its status reads MISSED. hosted_by_me keeps only the meetings the user hosts. Each row's excerpt is the start of the description, and get_meeting has the whole description. At most "+strconv.Itoa(mcpMaxList)+"; truncated says more matched, and then narrowing from and to shows the rest. Attendees come with get_meeting.", mcpSchemaListMeetings,
			func(ctx context.Context, p McpPrincipal, in mcpListMeetingsIn) (any, error) {
				return s.ListMeetings(ctx, p, in)
			}),
		mcpWriteTool("schedule_meeting", "Schedule meeting", "Schedules a meeting in the workspace with the user as its host. Everyone in the workspace sees it. starts_at and ends_at are ISO 8601 with a timezone offset, e.g. 2026-10-15T10:00:00+07:00; timezone is the zone the meeting is set in, and defaults to the user's own, else Asia/Ho_Chi_Minh. People in attendee_ids (user_id values from list_members, at most "+strconv.Itoa(mcpMaxAttendees)+", each added once) are added to the meeting but are not notified: call invite_to_meeting to notify them. Someone who is not a member of the workspace refuses the whole call. The meeting comes back with its attendees. The description holds at most "+strconv.Itoa(mcpMaxItemRunes)+" characters.", "cancel_meeting", false, mcpSchemaScheduleMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpScheduleMeetingIn) (any, error) {
				return s.ScheduleMeeting(ctx, p, in)
			}),
		mcpWriteTool("update_meeting", "Update meeting", "Changes one meeting as the user: omitted fields stay as they are, and null clears project_id. revision must be the one you read with get_meeting or list_meetings; if the meeting changed since, nothing is written and the call fails with revision_conflict. Only its host or a workspace owner or admin may change it (not_meeting_host otherwise); a meeting that ended or was cancelled cannot be changed (invalid_meeting_state), and times cannot change once it has started. Everyone in the workspace sees the change. Attendees are not notified of it, so if the time moved the user has to tell them. timezone is the zone the meeting is set in; it does not move starts_at. A title longer than "+strconv.Itoa(mcpMaxMeetingTitleRunes)+" characters or a description longer than "+strconv.Itoa(mcpMaxItemRunes)+" characters is too long to replace here, and a stored timezone that is not an IANA zone cannot be replaced here; edit those in UniWork.", "call update_meeting again with the from values in changes", true, mcpSchemaUpdateMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateMeetingIn) (any, error) {
				return s.UpdateMeeting(ctx, p, in)
			}),
		mcpWriteTool("invite_to_meeting", "Invite to meeting", "Invites workspace members to a meeting, by user_id from list_members (1-"+strconv.Itoa(mcpMaxInvites)+" per call, each once). Each person invited gets an in-app notification, unless they turned that kind off; someone already on the meeting is notified again and reported as already_attending, and the undo applies only to results that read invited. Only the meeting's host or a workspace owner or admin may invite, and only to a scheduled or in-progress meeting. invites holds the outcome for each person: invited, already_attending, or why not. Someone who is not a member of the workspace, or was removed from the meeting earlier (participant_removed, cannot be invited again), is refused, and one refusal does not stop the others. A refusal that covers everyone (not_meeting_host, invalid_meeting_state, or a meeting that is gone) fails as a whole: the call returns that error and nobody is invited. The meeting comes back with its attendees and its revision.", "for each person whose result reads invited, the host removes them from the meeting in UniWork; someone who read already_attending was on the meeting before and stays", false, mcpSchemaInviteToMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpInviteIn) (any, error) {
				return s.InviteToMeeting(ctx, p, in)
			}),
		mcpWriteTool("cancel_meeting", "Cancel meeting", "Cancels a meeting as the user. Only its host or a workspace owner or admin may (not_meeting_host otherwise), and only while it is scheduled: one that is in progress, ended or already cancelled fails with invalid_meeting_state. revision must be the one you read with get_meeting or list_meetings; if the meeting changed since, nothing is written and the call fails with revision_conflict. Everyone in the workspace sees it as cancelled. Attendees are not notified, so the user has to tell them. reason (optional, at most "+strconv.Itoa(mcpMaxCancelReasonRunes)+" characters) is recorded with the cancellation and is not sent to anyone. A scheduled meeting whose time already passed (MISSED) can be cancelled too, but restore_meeting cannot bring it back, and the result's note says so.", "restore_meeting, while the meeting's end time is still ahead", true, mcpSchemaCancelMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpCancelMeetingIn) (any, error) {
				return s.CancelMeeting(ctx, p, in)
			}),
		mcpWriteTool("restore_meeting", "Restore meeting", "Brings a cancelled meeting back to scheduled as the user, only while its end time is still ahead: a meeting that is not cancelled, or whose end has passed, fails with invalid_meeting_state. Only its host or a workspace owner or admin may (not_meeting_host otherwise). revision must be the one cancel_meeting returned, or get_meeting shows now; if the meeting changed since, nothing is written and the call fails with revision_conflict. Everyone in the workspace sees it as scheduled again. Attendees are not notified, and the reason given for the cancellation is cleared; join requests that were pending when it was cancelled stay expired.", "cancel_meeting", false, mcpSchemaRestoreMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpRestoreMeetingIn) (any, error) {
				return s.RestoreMeeting(ctx, p, in)
			}),
	}
}
