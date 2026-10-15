package service

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

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
// mcpMaxList with AttendeesTruncated.
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

	// mcpMeetingMissed is a scheduled meeting whose time passed without it
	// starting. Only a list filter knows it; the service stores SCHEDULED.
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

func (s *McpToolService) meetingOf(base string, m db.Meeting) McpMeeting {
	out := McpMeeting{
		McpItem:  McpItem{Kind: "meeting", ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Status: m.Status, URL: s.frontend + base + "/meetings/" + m.ID, Excerpt: capRunes(m.Description, mcpMaxHitRunes, mcpHitCut)},
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

// GetMeeting reads one meeting: its row, the summary Ask UNI's reader puts in
// the excerpt, and its attendees. No transcript is read.
func (s *McpToolService) GetMeeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (McpMeeting, error) {
	m, err := s.meeting(ctx, p, workspaceID, meetingID)
	if err != nil {
		return McpMeeting{}, err
	}
	item, err := s.one(ctx, p, workspaceID, m.ID, "meeting_id", s.ask.meetingContext)
	if err != nil {
		return McpMeeting{}, err
	}
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return McpMeeting{}, err
	}
	// The row says everything but the excerpt, which carries the summary.
	out := s.meetingOf(base, m)
	out.Excerpt = item.Excerpt
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
	// "starts_at" is the screen's calendar order, around today in UTC here.
	f := MeetingListFilter{Status: in.Status, From: &from, To: &to, Limit: mcpMaxList, Sort: "starts_at", Location: time.UTC}
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

var mcpSchemaListMeetings = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"from":{"type":"string","description":"ISO 8601 with a timezone offset, e.g. 2026-10-15T00:00:00+07:00."},"to":{"type":"string","description":"ISO 8601 with a timezone offset, after from and at most 92 days later."},"hosted_by_me":{"type":"boolean","description":"Only the meetings the user hosts."},"status":{"type":"string","enum":["SCHEDULED","IN_PROGRESS","ENDED","CANCELED","MISSED"],"description":"MISSED is a scheduled meeting whose time passed without it starting (its status still reads SCHEDULED); SCHEDULED is one that can still start. Omit for every status."}},"required":["workspace_id","from","to"],"additionalProperties":false}`)

func mcpMeetingTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_meetings", "List meetings", "Meetings of one workspace that start between from and to (ISO 8601 with a timezone offset, at most 92 days apart), each with its revision. Ordered like the meetings screen: those starting today (UTC) or later first, soonest first, then earlier days, most recent day first, each day by start time. Cancelled ones are included with status CANCELED unless status narrows the list; MISSED is a scheduled meeting whose time passed without it starting (its status still reads SCHEDULED). hosted_by_me keeps only the meetings the user hosts. At most "+strconv.Itoa(mcpMaxList)+"; truncated says more matched. Attendees come with get_meeting.", mcpSchemaListMeetings,
			func(ctx context.Context, p McpPrincipal, in mcpListMeetingsIn) (any, error) {
				return s.ListMeetings(ctx, p, in)
			}),
	}
}
