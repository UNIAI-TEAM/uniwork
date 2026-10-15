package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// meetingList runs list_meetings on the world's workspace between from and to
// (RFC 3339) with extra JSON fields (without braces) and reads the wrapper
// back.
func (x *mcpToolWorld) meetingList(t *testing.T, from, to, extra string) McpMeetingList {
	t.Helper()
	input := `{"workspace_id":"` + x.w.ID + `","from":"` + from + `","to":"` + to + `"`
	if extra != "" {
		input += "," + extra
	}
	raw, err := callMcpTool(t, x.tools, x.p, "list_meetings", input+"}")
	if err != nil {
		t.Fatal(err)
	}
	var list McpMeetingList
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("list_meetings = %s (%v)", raw, err)
	}
	return list
}

// aroundNow is a range holding every meeting the world schedules an hour
// ahead, and the ones moved a few days back.
func aroundNow() (from, to string) {
	return time.Now().Add(-10 * 24 * time.Hour).UTC().Format(time.RFC3339), time.Now().Add(10 * 24 * time.Hour).UTC().Format(time.RFC3339)
}

func meetingTitles(list McpMeetingList) []string {
	out := make([]string, 0, len(list.Meetings))
	for _, m := range list.Meetings {
		out = append(out, m.Title)
	}
	return out
}

func TestMcpListMeetingsInARange(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	from := time.Now().UTC().Format(time.RFC3339)
	to := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	list := x.meetingList(t, from, to, "")
	if len(list.Meetings) != 1 || list.Truncated || list.Meetings[0].ID != m.ID || list.Meetings[0].Revision != int64(m.Version) || list.Meetings[0].Kind != "meeting" {
		t.Fatalf("list_meetings = %+v", list)
	}
	// Outside the range it is nothing, and the list is still a list.
	later := time.Now().Add(5 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if list := x.meetingList(t, later, time.Now().Add(6*24*time.Hour).UTC().Format(time.RFC3339), ""); list.Meetings == nil || len(list.Meetings) != 0 || list.Truncated {
		t.Fatalf("empty range = %+v", list)
	}
}

// A time is read with its offset or refused; the range is bounded.
func TestMcpListMeetingsValidatesInput(t *testing.T) {
	x := newMcpToolWorld(t)
	ws := x.w.ID
	from := time.Now().UTC().Format(time.RFC3339)
	to := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	for name, tc := range map[string]struct{ input, want string }{
		"no offset":         {`"from":"2026-10-15T10:00","to":"` + to + `"`, "from must be ISO 8601 with a timezone offset"},
		"date only":         {`"from":"` + from + `","to":"2026-10-17"`, "to must be ISO 8601 with a timezone offset"},
		"no from":           {`"to":"` + to + `"`, "from must be ISO 8601"},
		"to before from":    {`"from":"` + to + `","to":"` + from + `"`, "to must be after from"},
		"to equals from":    {`"from":"` + from + `","to":"` + from + `"`, "to must be after from"},
		"more than 92 days": {`"from":"` + from + `","to":"` + time.Now().Add(93*24*time.Hour).UTC().Format(time.RFC3339) + `"`, "at most 92 days"},
		"unknown status":    {`"from":"` + from + `","to":"` + to + `","status":"scheduled"`, "status must be one of SCHEDULED, IN_PROGRESS, ENDED, CANCELED, MISSED"},
	} {
		_, err := callMcpTool(t, x.tools, x.p, "list_meetings", `{"workspace_id":"`+ws+`",`+tc.input+`}`)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, tc.want) {
			t.Errorf("%s: %v, want invalid arguments with %q", name, err, tc.want)
		}
	}
	// 92 days exactly is the longest range; both ends come from one reading of
	// the clock, so a tick between two readings cannot make it 92 days and a second.
	start := time.Now()
	if _, err := callMcpTool(t, x.tools, x.p, "list_meetings", `{"workspace_id":"`+ws+`","from":"`+start.UTC().Format(time.RFC3339)+`","to":"`+start.Add(mcpMaxRange).UTC().Format(time.RFC3339)+`"}`); err != nil {
		t.Errorf("92 days: %v", err)
	}
	// The schema offers the statuses the tool accepts.
	var schema struct {
		Properties struct{ Status struct{ Enum []string } }
	}
	if err := json.Unmarshal(mcpSchemaListMeetings, &schema); err != nil || !slices.Equal(schema.Properties.Status.Enum, mcpMeetingStatuses) {
		t.Errorf("schema status enum = %v (%v), want %v", schema.Properties.Status.Enum, err, mcpMeetingStatuses)
	}
}

// The service orders like the meetings screen: today and later first, soonest
// first, then earlier days, the most recent day first. The tool says so.
func TestMcpListMeetingsOrderStatusAndHost(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	// Scheduled latest first, so neither creation order serves for soonest first.
	later := x.meeting(t, x.ua.ID, x.w.ID, "Sau", "")
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE meetings SET starts_at = now() + interval '3 hours', ends_at = now() + interval '4 hours' WHERE id = $1`, later.ID); err != nil {
		t.Fatal(err)
	}
	soon := x.meeting(t, x.ub.ID, x.w.ID, "Sớm", "")
	// Two that were never held: three days and two days ago.
	old3 := x.meeting(t, x.ua.ID, x.w.ID, "Ba ngày trước", "")
	old2 := x.meeting(t, x.ua.ID, x.w.ID, "Hai ngày trước", "")
	for id, days := range map[string]int{old3.ID: 3, old2.ID: 2} {
		if _, err := x.tools.ask.pool.Exec(ctx, fmt.Sprintf(`UPDATE meetings SET starts_at = now() - interval '%d days', ends_at = now() - interval '%d days' + interval '1 hour' WHERE id = $1`, days, days), id); err != nil {
			t.Fatal(err)
		}
	}
	gone := x.meeting(t, x.ua.ID, x.w.ID, "Đã hủy", "")
	if err := x.tools.ask.meetings.Cancel(ctx, x.ua.ID, gone.ID, "test"); err != nil {
		t.Fatal(err)
	}
	from, to := aroundNow()

	all := x.meetingList(t, from, to, "")
	if got, want := meetingTitles(all), []string{"Sớm", "Đã hủy", "Sau", "Hai ngày trước", "Ba ngày trước"}; !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	for _, c := range []struct {
		status string
		want   []string
	}{
		{"SCHEDULED", []string{"Sớm", "Sau"}},
		{"MISSED", []string{"Hai ngày trước", "Ba ngày trước"}},
		{"CANCELED", []string{"Đã hủy"}},
		{"ENDED", nil},
	} {
		got := meetingTitles(x.meetingList(t, from, to, `"status":"`+c.status+`"`))
		if len(got) != len(c.want) || (len(got) > 0 && !slices.Equal(got, c.want)) {
			t.Errorf("status %s = %v, want %v", c.status, got, c.want)
		}
	}
	// The status of a row is the one its filter selects: a scheduled meeting
	// whose time passed reads MISSED, listed with or without a filter and by
	// get_meeting; a cancelled one reads CANCELED. The services keep SCHEDULED.
	for title, want := range map[string]string{"Sớm": MeetingScheduled, "Sau": MeetingScheduled, "Đã hủy": MeetingCanceled, "Hai ngày trước": mcpMeetingMissed, "Ba ngày trước": mcpMeetingMissed} {
		for _, m := range all.Meetings {
			if m.Title == title && m.Status != want {
				t.Errorf("%s has status %s, want %s", title, m.Status, want)
			}
		}
	}
	for _, status := range []string{MeetingScheduled, mcpMeetingMissed} {
		for _, m := range x.meetingList(t, from, to, `"status":"`+status+`"`).Meetings {
			if m.Status != status {
				t.Errorf("a row of the %s filter reads %s: %s", status, m.Status, m.Title)
			}
		}
	}
	if got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, old2.ID); err != nil || got.Status != mcpMeetingMissed {
		t.Errorf("get_meeting of a missed meeting = %q (%v), want %s", got.Status, err, mcpMeetingMissed)
	}
	if stored, err := x.tools.ask.meetings.Get(ctx, x.ua.ID, old2.ID); err != nil || stored.Status != MeetingScheduled {
		t.Errorf("stored status of the missed meeting = %q (%v), want %s", stored.Status, err, MeetingScheduled)
	}
	// hosted_by_me keeps the principal's own; the other host's is not theirs.
	mine := x.meetingList(t, from, to, `"hosted_by_me":true`)
	if slices.Contains(meetingTitles(mine), soon.Title) || len(mine.Meetings) != len(all.Meetings)-1 {
		t.Errorf("hosted_by_me = %v", meetingTitles(mine))
	}
	for _, m := range mine.Meetings {
		if m.HostUserID != x.ua.ID {
			t.Errorf("hosted_by_me row %s is hosted by %s", m.Title, m.HostUserID)
		}
	}
}

func TestMcpListMeetingsStopsAtTheCapAndSaysSo(t *testing.T) {
	x := newMcpToolWorld(t)
	for i := range mcpMaxList + 1 {
		x.meeting(t, x.ua.ID, x.w.ID, fmt.Sprintf("Họp %02d", i), "")
	}
	from, to := aroundNow()
	list := x.meetingList(t, from, to, "")
	if len(list.Meetings) != mcpMaxList || !list.Truncated {
		t.Fatalf("%d meetings, truncated %v; want %d and true", len(list.Meetings), list.Truncated, mcpMaxList)
	}
	if list := x.meetingList(t, from, to, `"hosted_by_me":true,"status":"SCHEDULED"`); len(list.Meetings) != mcpMaxList || !list.Truncated {
		t.Fatalf("filtered: %d meetings, truncated %v", len(list.Meetings), list.Truncated)
	}
	if list := x.meetingList(t, from, to, `"status":"CANCELED"`); len(list.Meetings) != 0 || list.Truncated {
		t.Fatalf("no match: %+v", list)
	}
}

func TestMcpGetMeetingListsAttendeesAndRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "Chương trình")
	raw, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpMeeting
	if err := json.Unmarshal(raw, &one); err != nil || one.Revision != int64(m.Version) || one.HostUserID != x.ua.ID || one.Timezone != "Asia/Ho_Chi_Minh" || one.EndsAt == "" || one.StartsAt == "" ||
		len(one.Attendees) != 1 || one.Attendees[0].UserID != x.ua.ID || one.Attendees[0].Role != RoleModerator || one.Attendees[0].Status != ParticipantActive || one.Attendees[0].Name == "" ||
		one.AttendeesTruncated || strings.Contains(string(raw), "@") {
		t.Fatalf("get_meeting = %s (%v)", raw, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"01J0000000000000000000000X"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown meeting: %v", err)
	}
}

// The host and a person invited keep an email in their participant row; the
// tool shows names only. A guest has no user_id to show.
func TestMcpGetMeetingAttendeesCarryNoEmail(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	if _, err := x.tools.ask.meetings.Invite(ctx, x.ua.ID, m.ID, x.ub.ID); err != nil {
		t.Fatal(err)
	}
	newGuestParticipant(t, x.tools.ask.meetings, m.ID)
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil || len(got.Attendees) != 3 {
		t.Fatalf("attendees = %+v, %v", got.Attendees, err)
	}
	raw, _ := json.Marshal(got)
	for _, a := range got.Attendees {
		if a.Name == "" || a.Role == "" || a.Status == "" {
			t.Errorf("attendee = %+v", a)
		}
	}
	if got.Attendees[2].UserID != "" || got.Attendees[2].Name != "Khách" {
		t.Errorf("guest = %+v, want a name and no user_id", got.Attendees[2])
	}
	for _, e := range []string{x.ua.Email, x.ub.Email, "@"} {
		if strings.Contains(string(raw), e) {
			t.Errorf("get_meeting carries %q: %s", e, raw)
		}
	}
}

func TestMcpGetMeetingStopsAtTheAttendeeCapAndSaysSo(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp lớn", "")
	// The host and mcpMaxList-1 guests fill the list exactly.
	for range mcpMaxList - 1 {
		newGuestParticipant(t, x.tools.ask.meetings, m.ID)
	}
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil || len(got.Attendees) != mcpMaxList || got.AttendeesTruncated {
		t.Fatalf("%d attendees, truncated %v (%v); want %d and false", len(got.Attendees), got.AttendeesTruncated, err, mcpMaxList)
	}
	newGuestParticipant(t, x.tools.ask.meetings, m.ID)
	got, err = x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil || len(got.Attendees) != mcpMaxList || !got.AttendeesTruncated {
		t.Fatalf("%d attendees, truncated %v (%v); want %d and true", len(got.Attendees), got.AttendeesTruncated, err, mcpMaxList)
	}
	// The host, added first, is still listed.
	if got.Attendees[0].UserID != x.ua.ID {
		t.Errorf("first attendee = %+v", got.Attendees[0])
	}
	out, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"}`)
	if err != nil || !strings.Contains(string(out), `"attendees_truncated":true`) {
		t.Errorf("attendees_truncated in %s (%v)", out, err)
	}
}

// The description comes back exactly as stored, past the length of a search
// hit, and is cut only at the item limit with its flag; the list shows none.
func TestMcpGetMeetingDescriptionIsExactAndListShowsNone(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	mid := strings.Repeat("ạ", mcpMaxHitRunes+300)
	long := strings.Repeat("ẹ", mcpMaxItemRunes+5)
	midM := x.meeting(t, x.ua.ID, x.w.ID, "Vừa", mid)
	longM := x.meeting(t, x.ua.ID, x.w.ID, "Dài", long)
	emptyM := x.meeting(t, x.ua.ID, x.w.ID, "Trống", "")
	get := func(id string) McpMeeting {
		t.Helper()
		got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := get(midM.ID); deref(got.Description) != mid || got.DescriptionTruncated {
		t.Errorf("middle description: %d characters, truncated %v", utf8.RuneCountInString(deref(got.Description)), got.DescriptionTruncated)
	}
	if got := get(longM.ID); deref(got.Description) != strings.Repeat("ẹ", mcpMaxItemRunes) || !got.DescriptionTruncated {
		t.Errorf("long description: %d characters, truncated %v", utf8.RuneCountInString(deref(got.Description)), got.DescriptionTruncated)
	}
	// An empty description is an empty string, not an absent field: a model
	// edits from what it reads.
	if got := get(emptyM.ID); got.Description == nil || *got.Description != "" || got.DescriptionTruncated {
		t.Errorf("empty description = %v, truncated %v", got.Description, got.DescriptionTruncated)
	}
	from, to := aroundNow()
	for _, m := range x.meetingList(t, from, to, "").Meetings {
		if m.Description != nil || m.DescriptionTruncated || m.Attendees != nil || m.AttendeesTruncated || utf8.RuneCountInString(m.Excerpt) > mcpMaxHitRunes {
			t.Errorf("list row %s carries get_meeting's fields: %+v", m.Title, m)
		}
	}
}

// meeting() reads one meeting as the person. It checks the grant itself, so no
// tool that reaches a meeting can forget to.
func TestMcpMeetingLookupStaysInTheGrantAndTheWorkspace(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	if got, err := x.tools.meeting(ctx, x.p, x.w.ID, m.ID); err != nil || got.ID != m.ID {
		t.Fatalf("control: %+v, %v", got, err)
	}
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	otherM := x.meeting(t, x.ua.ID, other.ID, "Ngoài", "")
	_, unknown := x.tools.meeting(ctx, x.p, x.w.ID, "01NOSUCHMEETING")
	if !errors.Is(unknown, ErrNotFound) {
		t.Fatalf("unknown meeting: %v", unknown)
	}
	// A meeting of a workspace the person belongs to in another organization,
	// and a workspace outside the grant.
	if _, err := x.tools.meeting(ctx, x.p, x.w.ID, otherM.ID); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
		t.Errorf("meeting of another workspace: %v, want %v", err, unknown)
	}
	outside := McpPrincipal{UserID: x.ua.ID, OrganizationID: "01NOSUCHORGANIZATION"}
	if _, err := x.tools.meeting(ctx, outside, x.w.ID, m.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("workspace outside the grant: %v, want ErrNotFound", err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "list_meetings", `{"workspace_id":"`+other.ID+`","from":"2026-10-15T10:00:00Z","to":"2026-10-16T10:00:00Z"}`); !errors.Is(err, ErrNotFound) {
		t.Errorf("list_meetings outside the grant: %v, want ErrNotFound", err)
	}
	for _, id := range []string{"", "  ", "\t"} {
		var bad McpInvalidArgs
		if _, err := x.tools.meeting(ctx, x.p, x.w.ID, id); !errors.As(err, &bad) || bad.Msg != "meeting_id is required" {
			t.Errorf("meeting id %q: %v, want meeting_id is required", id, err)
		}
		if _, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, id); !errors.As(err, &bad) {
			t.Errorf("GetMeeting id %q: %v, want invalid arguments", id, err)
		}
	}
}

// The excerpt of get_meeting is the AI summary alone: the description has its
// own field, so a long one neither repeats in the excerpt nor pushes the summary
// out of it.
func TestMcpGetMeetingExcerptIsTheSummaryAlone(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	long := strings.Repeat("ẹ", mcpMaxItemRunes)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp dài", long)
	bare := x.meeting(t, x.ua.ID, x.w.ID, "Họp trống", "mô tả riêng")
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, bare.ID)
	if err != nil || got.Excerpt != "" || deref(got.Description) != "mô tả riêng" {
		t.Fatalf("no summary: excerpt %q, description %q (%v)", got.Excerpt, deref(got.Description), err)
	}
	summary := db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, Summary: "Đã chốt OKR quý", Decisions: "Giữ ngân sách", ActionItems: "Gửi biên bản",
		Model: "fake", CreatedBy: x.ua.ID, OrganizationID: x.w.OrganizationID,
	}
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, summary); err != nil {
		t.Fatal(err)
	}
	got, err = x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range []string{"Tóm tắt: Đã chốt OKR quý", "Quyết định: Giữ ngân sách", "Việc cần làm: Gửi biên bản"} {
		if !strings.Contains(got.Excerpt, w) {
			t.Errorf("excerpt does not hold %q: %.200s", w, got.Excerpt)
		}
	}
	if strings.Contains(got.Excerpt, "ẹẹẹ") || deref(got.Description) != long || got.DescriptionTruncated {
		t.Errorf("excerpt repeats the description, or the description changed: excerpt %d characters, description %d characters, truncated %v",
			utf8.RuneCountInString(got.Excerpt), utf8.RuneCountInString(deref(got.Description)), got.DescriptionTruncated)
	}
	// A summary longer than the item limit is cut there, with the marker; the
	// latest one is the one shown.
	summary.ID, summary.Summary = util.NewID(), strings.Repeat("ạ", mcpMaxItemRunes+10)
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, summary); err != nil {
		t.Fatal(err)
	}
	got, err = x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil || utf8.RuneCountInString(got.Excerpt) != mcpMaxItemRunes || !strings.HasSuffix(got.Excerpt, mcpItemCut) {
		t.Errorf("long summary: excerpt %d characters, ends %q (%v)", utf8.RuneCountInString(got.Excerpt), got.Excerpt[max(0, len(got.Excerpt)-30):], err)
	}
}

// What the description promises holds: the summary reaches get_meeting, a
// transcript never does, even where one exists.
func TestMcpGetMeetingExcludesTranscripts(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "Chương trình")
	if _, err := x.tools.ask.q.InsertTranscriptSegment(ctx, db.InsertTranscriptSegmentParams{
		ID: util.NewID(), MeetingID: m.ID, SpeakerName: "A", Text: "lời nói bí mật",
		SpokenAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, OrganizationID: x.w.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, Summary: "Đã chốt OKR quý", Decisions: "Giữ ngân sách", ActionItems: "Gửi biên bản",
		Model: "fake", CreatedBy: x.ua.ID, OrganizationID: x.w.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"}`)
	if err != nil || strings.Contains(string(raw), "lời nói bí mật") || !strings.Contains(string(raw), "Đã chốt OKR quý") {
		t.Fatalf("get_meeting = %s (%v)", raw, err)
	}
}

// callJSON runs a tool with its arguments built as a map, for values a test
// cannot write as a string: a revision, a list, null.
func (x *mcpToolWorld) callJSON(t *testing.T, p McpPrincipal, tool string, args map[string]any) (json.RawMessage, error) {
	t.Helper()
	b, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	return callMcpTool(t, x.tools, p, tool, string(b))
}

// meetingRow is the stored row of a meeting.
func (x *mcpToolWorld) meetingRow(t *testing.T, id string) db.Meeting {
	t.Helper()
	m, err := x.tools.ask.q.GetMeeting(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// scheduleArgs is a valid schedule_meeting call a day ahead, with extra's
// fields over it.
func (x *mcpToolWorld) scheduleArgs(extra map[string]any) map[string]any {
	start := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	args := map[string]any{"workspace_id": x.w.ID, "title": "Họp khách ACME", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339)}
	maps.Copy(args, extra)
	return args
}

// updateArgs is an update_meeting call on a meeting at the revision it holds
// now, with extra's fields over it.
func (x *mcpToolWorld) updateArgs(t *testing.T, id string, extra map[string]any) map[string]any {
	t.Helper()
	args := map[string]any{"workspace_id": x.w.ID, "meeting_id": id, "revision": x.meetingRow(t, id).Version}
	maps.Copy(args, extra)
	return args
}

func (x *mcpToolWorld) meetingCount(t *testing.T) (n int) {
	t.Helper()
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM meetings WHERE workspace_id = $1`, x.w.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// meetingEvents counts the outbox rows of a topic that name a meeting.
func (x *mcpToolWorld) meetingEvents(t *testing.T, topic, meetingID string) (n int) {
	t.Helper()
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'meeting_id' = $2`, topic, meetingID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// member makes ub a plain member of the organization and the workspace.
func (x *mcpToolWorld) member(t *testing.T) McpPrincipal {
	t.Helper()
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleMember)
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	return McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}
}

func TestMcpScheduleMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	start := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	raw, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"description": "Chương trình: báo giá", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339)}))
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	id, _ := item["id"].(string)
	row := x.meetingRow(t, id)
	if id == "" || res.Revision == 0 || res.Revision != int64(row.Version) || item["revision"] != float64(row.Version) || item["kind"] != "meeting" || item["status"] != "SCHEDULED" ||
		item["host_user_id"] != x.ua.ID || item["workspace_id"] != x.w.ID || item["timezone"] != "Asia/Ho_Chi_Minh" || item["title"] != "Họp khách ACME" ||
		item["starts_at"] != start.UTC().Format(time.RFC3339) || item["ends_at"] != start.Add(time.Hour).UTC().Format(time.RFC3339) ||
		!strings.Contains(fmt.Sprint(item["url"]), "/meetings/"+id) || len(res.Changes) != 0 || res.Note != "" {
		t.Fatalf("schedule_meeting = %s", raw)
	}
	onlyKeys(t, "schedule_meeting item", item, "kind", "id", "workspace_id", "title", "excerpt", "url", "status", "starts_at", "revision", "ends_at", "timezone", "host_user_id", "project_id")
	if row.Description != "Chương trình: báo giá" || row.HostUserID != x.ua.ID || row.CreatedBy != x.ua.ID || row.CreatedByKind != "human" || row.Status != MeetingScheduled {
		t.Fatalf("stored meeting = %+v", row)
	}
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, id)
	if err != nil || len(got.Attendees) != 1 || got.Attendees[0].UserID != x.ua.ID || got.Attendees[0].Role != RoleModerator {
		t.Fatalf("attendees = %+v (%v), want the host alone", got.Attendees, err)
	}
	var kind string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT actor_kind FROM audit_events WHERE action = 'meeting.created' AND resource_id = $1`, id).Scan(&kind); err != nil || kind != "human" {
		t.Fatalf("meeting.created actor_kind = %q (%v), want human", kind, err)
	}
}

// A time without an offset is refused, not read as UTC; what the service would
// misread is refused in the words of the field, and nothing is written.
func TestMcpScheduleMeetingValidatesInput(t *testing.T) {
	x := newMcpToolWorld(t)
	same := time.Now().Add(24 * time.Hour).Truncate(time.Minute).Format(time.RFC3339)
	many := make([]string, 51)
	for i := range many {
		many[i] = util.NewID()
	}
	for name, tc := range map[string]struct {
		extra map[string]any
		want  string
	}{
		"no offset":        {map[string]any{"starts_at": "2026-10-15T10:00"}, "starts_at must be ISO 8601 with a timezone offset"},
		"date only end":    {map[string]any{"ends_at": "2026-10-15"}, "ends_at must be ISO 8601 with a timezone offset"},
		"blank title":      {map[string]any{"title": "  "}, "title must be 1-300 characters"},
		"title too long":   {map[string]any{"title": strings.Repeat("a", 301)}, "title must be 1-300 characters"},
		"ends at starts":   {map[string]any{"starts_at": same, "ends_at": same}, "ends_at must be after starts_at"},
		"unknown zone":     {map[string]any{"timezone": "Mars/Base"}, "timezone must be an IANA zone"},
		"local zone":       {map[string]any{"timezone": "Local"}, "timezone must be an IANA zone"},
		"long description": {map[string]any{"description": strings.Repeat("ạ", mcpMaxItemRunes+1)}, "description holds at most " + strconv.Itoa(mcpMaxItemRunes)},
		"51 attendees":     {map[string]any{"attendee_ids": many}, "at most 50 attendees"},
		"blank attendee":   {map[string]any{"attendee_ids": []string{" "}}, "attendee_ids must not hold a blank id"},
		"empty attendee":   {map[string]any{"attendee_ids": []string{x.ub.ID, ""}}, "attendee_ids must not hold a blank id"},
		"blank project":    {map[string]any{"project_id": " "}, "project_id must not be blank"},
	} {
		_, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(tc.extra))
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.HasPrefix(bad.Msg, tc.want) {
			t.Errorf("%s: %v, want invalid arguments with %q", name, err, tc.want)
		}
	}
	args := x.scheduleArgs(nil)
	delete(args, "workspace_id")
	var bad McpInvalidArgs
	if _, err := x.callJSON(t, x.p, "schedule_meeting", args); !errors.As(err, &bad) || bad.Msg != "workspace_id is required" {
		t.Errorf("no workspace: %v", err)
	}
	if n := x.meetingCount(t); n != 0 {
		t.Fatalf("a refused call scheduled %d meetings", n)
	}
	// The limits themselves are allowed.
	if _, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"title": strings.Repeat("a", 300), "description": strings.Repeat("ạ", mcpMaxItemRunes)})); err != nil {
		t.Fatalf("title and description at the limit: %v", err)
	}
}

// An empty zone is the person's own; one given must be an IANA zone.
func TestMcpScheduleMeetingTimezone(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	zone := func(extra map[string]any) string {
		t.Helper()
		raw, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(extra))
		if err != nil {
			t.Fatal(err)
		}
		_, item := writeResult(t, raw)
		return fmt.Sprint(item["timezone"])
	}
	profile := func(tz string) {
		t.Helper()
		if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE users SET timezone = $1 WHERE id = $2`, tz, x.ua.ID); err != nil {
			t.Fatal(err)
		}
	}
	if got := zone(nil); got != "Asia/Ho_Chi_Minh" {
		t.Errorf("the default profile zone: %s", got)
	}
	profile("Asia/Tokyo")
	for _, tc := range []struct {
		given map[string]any
		want  string
	}{
		{nil, "Asia/Tokyo"},
		{map[string]any{"timezone": "  "}, "Asia/Tokyo"},
		{map[string]any{"timezone": "Europe/Paris"}, "Europe/Paris"},
		{map[string]any{"timezone": " Europe/Paris "}, "Europe/Paris"},
	} {
		if got := zone(tc.given); got != tc.want {
			t.Errorf("zone %v = %s, want %s", tc.given, got, tc.want)
		}
	}
	// A profile zone Go cannot load, or one update_meeting would refuse to send
	// back ("Local" loads and means nothing elsewhere), falls back to Vietnam's.
	for _, bad := range []string{"Nowhere/Land", "Local", ""} {
		profile(bad)
		if got := zone(nil); got != "Asia/Ho_Chi_Minh" {
			t.Errorf("profile zone %q: %s, want Asia/Ho_Chi_Minh", bad, got)
		}
	}
}

func TestMcpScheduleMeetingInAProject(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	pid := x.project(t, "Dự án họp")
	raw, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"project_id": pid}))
	if err != nil {
		t.Fatal(err)
	}
	_, item := writeResult(t, raw)
	if item["project_id"] != pid || x.meetingRow(t, fmt.Sprint(item["id"])).ProjectID.String != pid {
		t.Fatalf("schedule_meeting with a project = %s", raw)
	}
	// A project of another workspace, and one nobody has, read the same and
	// schedule nothing.
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	foreign, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), other.ID, CreateProjectInput{Title: "Dự án ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	before := x.meetingCount(t)
	var answers []string
	for _, id := range []string{foreign.ID, util.NewID()} {
		_, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"project_id": id}))
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("project %s: %v, want ErrNotFound", id, err)
		}
		answers = append(answers, err.Error())
	}
	if answers[0] != answers[1] || x.meetingCount(t) != before {
		t.Errorf("answers %q, meetings %d (was %d)", answers, x.meetingCount(t), before)
	}
}

// Scheduling adds the people named as attendees, each once, and notifies
// nobody: the service records no participant.invited for them, and only that
// event has a notification rule (rules.go, ruleParticipantInvited).
func TestMcpScheduleMeetingAddsAttendeesWithoutNotifyingThem(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	x.member(t)
	raw, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"attendee_ids": []string{x.ub.ID, x.ub.ID, x.ua.ID}}))
	if err != nil {
		t.Fatal(err)
	}
	_, item := writeResult(t, raw)
	id := fmt.Sprint(item["id"])
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, id)
	if err != nil || len(got.Attendees) != 2 || got.Attendees[0].UserID != x.ua.ID || got.Attendees[1].UserID != x.ub.ID || got.Attendees[1].Role != RoleAttendee {
		t.Fatalf("attendees = %+v (%v), want the host and ub once each", got.Attendees, err)
	}
	if n := x.meetingEvents(t, "participant.invited", id); n != 0 {
		t.Errorf("scheduling put %d participant.invited rows on the outbox; the tool descriptions say it notifies nobody", n)
	}
}

// A person outside the workspace is refused in one answer, the same for a user
// of another organization as for an id nobody has, and the meeting is not made.
func TestMcpScheduleMeetingRefusesAnAttendeeOutsideTheWorkspace(t *testing.T) {
	x := newMcpToolWorld(t)
	x.org(t, x.ub.ID, "Bravo", "bravo")
	var answers []string
	for _, id := range []string{x.ub.ID, util.NewID()} {
		_, err := x.callJSON(t, x.p, "schedule_meeting", x.scheduleArgs(map[string]any{"attendee_ids": []string{id}}))
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "attendee_ids") || !strings.Contains(bad.Msg, "list_members") {
			t.Fatalf("attendee %s: %v, want invalid arguments naming attendee_ids and list_members", id, err)
		}
		answers = append(answers, err.Error())
	}
	if answers[0] != answers[1] {
		t.Errorf("a user of another organization answers %q, an unknown id %q", answers[0], answers[1])
	}
	if n := x.meetingCount(t); n != 0 {
		t.Errorf("a refused call scheduled %d meetings", n)
	}
}

func TestMcpUpdateMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	oldStart, oldEnd := m.StartsAt.Time.UTC().Format(time.RFC3339), m.EndsAt.Time.UTC().Format(time.RFC3339)
	newStart := m.StartsAt.Time.Add(time.Hour)
	args := x.updateArgs(t, m.ID, map[string]any{"starts_at": newStart.Format(time.RFC3339), "ends_at": newStart.Add(time.Hour).Format(time.RFC3339)})
	raw, err := x.callJSON(t, x.p, "update_meeting", args)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	row := x.meetingRow(t, m.ID)
	if res.Revision != int64(m.Version)+1 || res.Revision != int64(row.Version) || item["revision"] != float64(row.Version) || res.Note != "" || item["status"] != "SCHEDULED" {
		t.Fatalf("update_meeting = %s", raw)
	}
	want := []McpChange{
		{"starts_at", oldStart, newStart.UTC().Format(time.RFC3339)},
		{"ends_at", oldEnd, newStart.Add(time.Hour).UTC().Format(time.RFC3339)},
	}
	if !slices.Equal(res.Changes, want) {
		t.Fatalf("changes = %+v, want %+v", res.Changes, want)
	}
	// The same revision twice: the second call wrote nothing and names the current one.
	_, err = x.callJSON(t, x.p, "update_meeting", args)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "revision_conflict" || !strings.Contains(te.Msg, "current revision is "+strconv.Itoa(int(row.Version))) {
		t.Fatalf("the same revision twice: %v, want revision_conflict naming %d", err, row.Version)
	}
	if x.meetingRow(t, m.ID).Version != row.Version {
		t.Fatal("a refused update wrote")
	}
	// A revision the meeting has not reached is as stale: it is the same refusal.
	_, err = x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "Tương lai", "revision": row.Version + 5}))
	if !errors.As(err, &te) || te.Code != "revision_conflict" || x.meetingRow(t, m.ID).Version != row.Version {
		t.Fatalf("a revision from the future: %v, want revision_conflict and no write", err)
	}
	// Sending the from values back puts the times back.
	if _, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"starts_at": oldStart, "ends_at": oldEnd})); err != nil {
		t.Fatal(err)
	}
	if got := x.meetingRow(t, m.ID); !got.StartsAt.Time.Truncate(time.Second).Equal(m.StartsAt.Time.Truncate(time.Second)) || !got.EndsAt.Time.Truncate(time.Second).Equal(m.EndsAt.Time.Truncate(time.Second)) {
		t.Fatalf("undo left %v-%v, want %v-%v", got.StartsAt.Time, got.EndsAt.Time, m.StartsAt.Time, m.EndsAt.Time)
	}
	// Title and description, in the order of the fields.
	raw, err = x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "  Giao ban tuần  ", "description": "Chương trình mới"}))
	if err != nil {
		t.Fatal(err)
	}
	res, _ = writeResult(t, raw)
	if want := []McpChange{{"title", "Giao ban", "Giao ban tuần"}, {"description", "", "Chương trình mới"}}; !slices.Equal(res.Changes, want) {
		t.Fatalf("changes = %+v, want %+v", res.Changes, want)
	}
	var n int
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.updated' AND resource_id = $1 AND actor_kind = 'human' AND actor_id = $2`, m.ID, x.ua.ID).Scan(&n); err != nil || n != 3 {
		t.Fatalf("meeting.updated audit rows by the person = %d (%v), want 3", n, err)
	}
}

// Moving the zone relabels the meeting; it does not move it in time.
func TestMcpUpdateMeetingTimezone(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	raw, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"timezone": " Asia/Tokyo "}))
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if want := []McpChange{{"timezone", "Asia/Ho_Chi_Minh", "Asia/Tokyo"}}; !slices.Equal(res.Changes, want) || item["timezone"] != "Asia/Tokyo" {
		t.Fatalf("update_meeting timezone = %s", raw)
	}
	if got := x.meetingRow(t, m.ID); got.Timezone != "Asia/Tokyo" || !got.StartsAt.Time.Equal(m.StartsAt.Time) || !got.EndsAt.Time.Equal(m.EndsAt.Time) {
		t.Fatalf("stored meeting = %+v", got)
	}
}

// What the service would misread, or the model could not undo, is refused in
// the words of the field before anything is written.
func TestMcpUpdateMeetingValidatesInput(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Kiểm tra", "")
	rev := strconv.Itoa(int(x.meetingRow(t, m.ID).Version))
	update := func(extra string) error {
		_, err := callMcpTool(t, x.tools, x.p, "update_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"`+extra+`}`)
		return err
	}
	withRev := `,"revision":` + rev
	for extra, want := range map[string]string{
		``:                              "revision is required",
		`,"revision":0`:                 "revision is required",
		`,"revision":-3`:                "revision is required",
		`,"revision":3000000000`:        "revision is required",
		withRev:                         "name at least one field to change",
		withRev + `,"title":null`:       "title cannot be null; send a value",
		withRev + `,"starts_at":null`:   "starts_at cannot be null; send a value",
		withRev + `,"ends_at":null`:     "ends_at cannot be null; send a value",
		withRev + `,"timezone":null`:    "timezone cannot be null; send a value",
		withRev + `,"description":null`: `description cannot be null; send "" to clear it`,
		withRev + `,"title":"  "`:       "title must be 1-300 characters",
		withRev + `,"title":"` + strings.Repeat("a", 301) + `"`:                          "title must be 1-300 characters",
		withRev + `,"starts_at":"2026-10-15T10:00"`:                                      "starts_at must be ISO 8601 with a timezone offset",
		withRev + `,"ends_at":"2026-10-15"`:                                              "ends_at must be ISO 8601 with a timezone offset",
		withRev + `,"starts_at":"2026-10-15T11:00:00Z","ends_at":"2026-10-15T11:00:00Z"`: "ends_at must be after starts_at",
		withRev + `,"timezone":"Mars/Base"`:                                              "timezone must be an IANA zone",
		withRev + `,"timezone":""`:                                                       "timezone must be an IANA zone",
		withRev + `,"timezone":"Local"`:                                                  "timezone must be an IANA zone",
		withRev + `,"project_id":" "`:                                                    "project_id must not be blank; send null to clear it",
		withRev + `,"project_id":""`:                                                     "project_id must not be blank; send null to clear it",
		withRev + `,"description":"` + strings.Repeat("ạ", mcpMaxItemRunes+1) + `"`:      "description holds at most " + strconv.Itoa(mcpMaxItemRunes),
	} {
		var bad McpInvalidArgs
		if err := update(extra); !errors.As(err, &bad) || !strings.HasPrefix(bad.Msg, want) {
			t.Errorf("update_meeting %s: %v, want %q", tail(extra, 70), err, want)
		}
	}
	// An end before the start the meeting already has is the service's refusal.
	var bad McpInvalidArgs
	if err := update(withRev + `,"ends_at":"2000-01-01T00:00:00Z"`); !errors.As(err, &bad) {
		t.Errorf("an end before the stored start: %v, want invalid arguments", err)
	}
	if got := x.meetingRow(t, m.ID); strconv.Itoa(int(got.Version)) != rev || got.Title != "Kiểm tra" {
		t.Fatal("a refused update wrote")
	}
}

// A call that names no field would still bump the revision and notify the web.
func TestMcpUpdateMeetingNamingNoFieldWritesNothing(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Không đổi", "")
	audits := func() (n int) {
		t.Helper()
		if err := x.tools.ask.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.updated' AND resource_id = $1`, m.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := audits()
	_, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, nil))
	var bad McpInvalidArgs
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "name at least one field to change") {
		t.Fatalf("update_meeting naming no field: %v, want invalid arguments naming a field to change", err)
	}
	if x.meetingRow(t, m.ID).Version != m.Version || audits() != before {
		t.Fatalf("a call naming no field wrote: version %d (was %d), %d audit rows (were %d)", x.meetingRow(t, m.ID).Version, m.Version, audits(), before)
	}
}

// Undo holds for a meeting description as for a task's: from is the whole old
// text, and a description too long to put back is never replaced here.
func TestMcpUpdateMeetingDescriptionUndo(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	long := strings.Repeat("Dòng **một**.\n", 357) + "Hết"
	if n := utf8.RuneCountInString(long); n < 5000 || n > mcpMaxItemRunes {
		t.Fatalf("fixture is %d characters", n)
	}
	m := x.meeting(t, x.ua.ID, x.w.ID, "Mô tả dài", long)
	update := func(extra map[string]any) (json.RawMessage, error) {
		t.Helper()
		return x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, extra))
	}
	raw, err := update(map[string]any{"description": "Ngắn"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if len(res.Changes) != 1 || res.Changes[0].Field != "description" || res.Changes[0].From != long || res.Changes[0].To != "Ngắn" {
		t.Fatalf("description change is cut or missing: %d changes", len(res.Changes))
	}
	if _, err := update(map[string]any{"description": long}); err != nil {
		t.Fatal(err)
	}
	if got := x.meetingRow(t, m.ID); got.Description != long {
		t.Fatal("sending from back did not restore the description")
	}

	var bad McpInvalidArgs
	if _, err := update(map[string]any{"description": strings.Repeat("ạ", mcpMaxItemRunes+1)}); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "description") {
		t.Fatalf("a new description over the limit: %v, want invalid arguments", err)
	}
	// A description stored over the limit, as the web may have saved it.
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE meetings SET description = $1 WHERE id = $2`, strings.Repeat("ạ", mcpMaxItemRunes+1), m.ID); err != nil {
		t.Fatal(err)
	}
	version := x.meetingRow(t, m.ID).Version
	if _, err := update(map[string]any{"title": "Đổi tên", "description": "Ngắn"}); !errors.As(err, &bad) || !strings.Contains(bad.Msg, "edit it in UniWork") {
		t.Fatalf("replacing a description over the limit: %v, want invalid arguments", err)
	}
	if x.meetingRow(t, m.ID).Version != version {
		t.Fatal("a refused description replace wrote")
	}
	if _, err := update(map[string]any{"title": "Đổi tên"}); err != nil {
		t.Fatalf("a call that leaves the long description alone: %v", err)
	}
}

// project_id null takes the meeting out of its project, and changes carries
// that as null, so sending from back is the undo.
func TestMcpUpdateMeetingProject(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Dự án", "")
	pid := x.project(t, "Dự án họp")
	raw, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"project_id": pid}))
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if want := []McpChange{{"project_id", nil, pid}}; !slices.Equal(res.Changes, want) || item["project_id"] != pid || x.meetingRow(t, m.ID).ProjectID.String != pid {
		t.Fatalf("setting the project = %s", raw)
	}
	// The undo: the from of that change is null.
	raw, err = x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"project_id": res.Changes[0].From}))
	if err != nil {
		t.Fatal(err)
	}
	res, item = writeResult(t, raw)
	if want := []McpChange{{"project_id", pid, nil}}; !slices.Equal(res.Changes, want) || item["project_id"] != nil || x.meetingRow(t, m.ID).ProjectID.Valid {
		t.Fatalf("clearing the project = %s", raw)
	}
	// Clearing a meeting that has none changes nothing.
	raw, err = x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"project_id": nil}))
	if res, _ = writeResult(t, raw); err != nil || len(res.Changes) != 0 {
		t.Fatalf("clearing an empty project = %s (%v)", raw, err)
	}
	// A project of another workspace, and one nobody has, read the same.
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	foreign, err := x.tools.ask.tasks.CreateProject(ctx, Human(x.ua.ID), other.ID, CreateProjectInput{Title: "Dự án ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	var answers []string
	for _, id := range []string{foreign.ID, util.NewID()} {
		_, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"project_id": id}))
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("project %s: %v, want ErrNotFound", id, err)
		}
		answers = append(answers, err.Error())
	}
	if answers[0] != answers[1] || x.meetingRow(t, m.ID).ProjectID.Valid {
		t.Errorf("answers %q; project %+v", answers, x.meetingRow(t, m.ID).ProjectID)
	}
}

// Only the host or a workspace owner or admin changes or invites; a member
// refused for it does not write anything.
func TestMcpMeetingWritesNeedTheHostOrAWorkspaceAdmin(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	member := x.member(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Của chủ", "")
	version := x.meetingRow(t, m.ID).Version
	_, err := x.callJSON(t, member, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "Chiếm"}))
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "not_meeting_host" {
		t.Fatalf("member update: %v, want not_meeting_host", err)
	}
	// A refusal that holds for the whole call is the tool's error, not N
	// identical results a model that reads only isError would call a success.
	raw, err := x.callJSON(t, member, "invite_to_meeting", map[string]any{"workspace_id": x.w.ID, "meeting_id": m.ID, "user_ids": []string{x.ua.ID, util.NewID()}})
	if !errors.As(err, &te) || te.Code != "not_meeting_host" {
		t.Fatalf("member invite = %s (%v), want the tool error not_meeting_host", raw, err)
	}
	if x.meetingRow(t, m.ID).Version != version || x.meetingEvents(t, "participant.invited", m.ID) != 0 {
		t.Fatal("a refused call wrote")
	}
	// The member's own meeting: the member may, and the workspace owner (an
	// admin of every workspace of the organization) may too.
	mine := x.meeting(t, x.ub.ID, x.w.ID, "Của thành viên", "")
	if _, err := x.callJSON(t, member, "update_meeting", x.updateArgs(t, mine.ID, map[string]any{"title": "Host đổi"})); err != nil {
		t.Fatalf("the host's own update: %v", err)
	}
	if _, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, mine.ID, map[string]any{"title": "Admin đổi"})); err != nil {
		t.Fatalf("the workspace owner's update: %v", err)
	}
	if got, err := x.tools.ask.meetings.Get(ctx, x.ua.ID, mine.ID); err != nil || got.Title != "Admin đổi" {
		t.Fatalf("stored title = %q (%v)", got.Title, err)
	}
}

// A meeting that ended or was cancelled cannot be changed; once it started its
// times cannot, but the rest can.
func TestMcpUpdateMeetingByStatus(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Đang họp", "")
	setStatus := func(status string) {
		t.Helper()
		if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE meetings SET status = $1 WHERE id = $2`, status, m.ID); err != nil {
			t.Fatal(err)
		}
	}
	setStatus(MeetingInProgress)
	var bad McpInvalidArgs
	if _, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"starts_at": time.Now().Add(48 * time.Hour).Format(time.RFC3339)})); !errors.As(err, &bad) {
		t.Fatalf("times of a meeting in progress: %v, want invalid arguments", err)
	}
	if _, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "Vẫn đổi được"})); err != nil {
		t.Fatalf("title of a meeting in progress: %v", err)
	}
	for _, status := range []string{MeetingEnded, MeetingCanceled} {
		setStatus(status)
		version := x.meetingRow(t, m.ID).Version
		_, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "Không đổi"}))
		var te McpToolError
		if !errors.As(err, &te) || te.Code != "invalid_meeting_state" || x.meetingRow(t, m.ID).Version != version {
			t.Errorf("%s: %v, want invalid_meeting_state and no write", status, err)
		}
	}
}

// MISSED is how a person reads a scheduled meeting whose time passed; it is
// never a stored status, so an update neither compares against it nor writes it.
func TestMcpUpdateMeetingOfAMissedMeetingKeepsTheStoredStatus(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := x.meeting(t, x.ua.ID, x.w.ID, "Lỡ", "")
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE meetings SET starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 hour' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	raw, err := x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"title": "Lỡ, dời lại"}))
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if item["status"] != mcpMeetingMissed || len(res.Changes) != 1 || res.Changes[0].Field != "title" || x.meetingRow(t, m.ID).Status != MeetingScheduled {
		t.Fatalf("update of a missed meeting = %s; stored status %s", raw, x.meetingRow(t, m.ID).Status)
	}
	start := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	raw, err = x.callJSON(t, x.p, "update_meeting", x.updateArgs(t, m.ID, map[string]any{"starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339)}))
	if err != nil {
		t.Fatal(err)
	}
	res, item = writeResult(t, raw)
	if item["status"] != MeetingScheduled || len(res.Changes) != 2 || x.meetingRow(t, m.ID).Status != MeetingScheduled {
		t.Fatalf("rescheduling a missed meeting = %s", raw)
	}
	for _, c := range res.Changes {
		if c.Field == "status" {
			t.Errorf("changes carries the display status: %+v", res.Changes)
		}
	}
}

// invitedAnswer is invite_to_meeting's result as a model reads it.
type invitedAnswer struct {
	Item struct {
		Meeting McpMeeting         `json:"meeting"`
		Invites []McpInviteOutcome `json:"invites"`
	} `json:"item"`
	Revision int64       `json:"revision"`
	Changes  []McpChange `json:"changes"`
	Note     string      `json:"note"`
}

func (x *mcpToolWorld) invite(t *testing.T, p McpPrincipal, meetingID string, ids ...string) invitedAnswer {
	t.Helper()
	raw, err := x.callJSON(t, p, "invite_to_meeting", map[string]any{"workspace_id": x.w.ID, "meeting_id": meetingID, "user_ids": ids})
	if err != nil {
		t.Fatal(err)
	}
	var out invitedAnswer
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("invite_to_meeting = %s (%v)", raw, err)
	}
	return out
}

func TestMcpInviteToMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	x.member(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	ghost := util.NewID()
	out := x.invite(t, x.p, m.ID, x.ub.ID, ghost)
	if len(out.Item.Invites) != 2 || out.Item.Invites[0] != (McpInviteOutcome{x.ub.ID, "invited"}) || out.Item.Invites[1].UserID != ghost || out.Item.Invites[1].Result == "invited" || out.Item.Invites[1].Result == "" {
		t.Fatalf("invites = %+v, want ub invited and the unknown id refused", out.Item.Invites)
	}
	// The meeting comes back as it is now, with its attendees and its revision.
	stored := x.meetingRow(t, m.ID)
	if out.Item.Meeting.ID != m.ID || out.Item.Meeting.Revision != int64(stored.Version) || out.Revision != int64(stored.Version) || len(out.Changes) != 0 || out.Note != "" ||
		len(out.Item.Meeting.Attendees) != 2 || out.Item.Meeting.Attendees[1].UserID != x.ub.ID || out.Item.Meeting.Attendees[1].Role != RoleAttendee {
		t.Fatalf("invite_to_meeting = %+v", out)
	}
	// One invitation notification event for the person invited, none for the refusal.
	if n := x.meetingEvents(t, "participant.invited", m.ID); n != 1 {
		t.Fatalf("%d participant.invited rows, want 1", n)
	}
	// Inviting someone already on the meeting is not refused, and notifies again.
	if out := x.invite(t, x.p, m.ID, x.ub.ID); len(out.Item.Invites) != 1 || out.Item.Invites[0].Result != "invited" || len(out.Item.Meeting.Attendees) != 2 {
		t.Fatalf("a second invite = %+v", out)
	}
	if n := x.meetingEvents(t, "participant.invited", m.ID); n != 2 {
		t.Fatalf("%d participant.invited rows after a second invite, want 2", n)
	}
}

// Whether an id belongs to someone in another organization is not something a
// result may tell: it reads as an id nobody has.
func TestMcpInviteResultsDoNotRevealWhoExists(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	x.org(t, x.ub.ID, "Bravo", "bravo")
	out := x.invite(t, x.p, m.ID, x.ub.ID, util.NewID())
	a, b := out.Item.Invites[0].Result, out.Item.Invites[1].Result
	if a != b || !strings.Contains(a, "list_members") {
		t.Fatalf("a user of another organization answers %q, an unknown id %q", a, b)
	}
	// An organization member who is not in this workspace reads the same.
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleMember)
	if out := x.invite(t, x.p, m.ID, x.ub.ID); out.Item.Invites[0].Result != a {
		t.Errorf("an organization member outside the workspace answers %q, want %q", out.Item.Invites[0].Result, a)
	}
	if n := x.meetingEvents(t, "participant.invited", m.ID); n != 0 {
		t.Errorf("refused invitations put %d participant.invited rows on the outbox", n)
	}
}

// A refusal about one person is that person's result, and the call still returns
// the meeting; one about the whole call is the tool's error.
func TestMcpInviteReportsEachPersonsRefusal(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	x.member(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	ghosts := []string{util.NewID(), util.NewID()}
	out := x.invite(t, x.p, m.ID, ghosts...)
	if len(out.Item.Invites) != 2 || out.Item.Invites[0].Result == "invited" || out.Item.Invites[1].Result == "invited" || out.Item.Meeting.Revision != int64(x.meetingRow(t, m.ID).Version) || len(out.Item.Meeting.Attendees) != 1 {
		t.Fatalf("every invite refused = %+v", out)
	}
	// Someone the host removed earlier is refused in words the model can read.
	x.invite(t, x.p, m.ID, x.ub.ID)
	rows, err := x.tools.ask.meetings.ListParticipants(ctx, x.ua.ID, "", m.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.UserID.String == x.ub.ID {
			if err := x.tools.ask.meetings.RemoveParticipant(ctx, x.ua.ID, m.ID, r.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	got := x.invite(t, x.p, m.ID, x.ub.ID).Item.Invites[0].Result
	if !strings.HasPrefix(got, "participant_removed:") || !strings.Contains(got, "removed") || !strings.Contains(got, "cannot be invited") || strings.Contains(got, "UniWork") {
		t.Errorf("a removed person's result = %q", got)
	}
	// A meeting that was cancelled takes no invitations: the call fails, once,
	// for everyone named, and nobody is invited.
	if err := x.tools.ask.meetings.Cancel(ctx, x.ua.ID, m.ID, "test"); err != nil {
		t.Fatal(err)
	}
	before := x.meetingEvents(t, "participant.invited", m.ID)
	raw, err := x.callJSON(t, x.p, "invite_to_meeting", map[string]any{"workspace_id": x.w.ID, "meeting_id": m.ID, "user_ids": []string{x.ub.ID, util.NewID()}})
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "invalid_meeting_state" || x.meetingEvents(t, "participant.invited", m.ID) != before {
		t.Errorf("a cancelled meeting = %s (%v), want the tool error invalid_meeting_state and no invitation", raw, err)
	}
}

func TestMcpInviteValidatesInput(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	x.member(t)
	many := make([]string, 21)
	for i := range many {
		many[i] = util.NewID()
	}
	for name, tc := range map[string]struct {
		ids  []string
		want string
	}{
		"none":     {[]string{}, "user_ids must hold 1-20"},
		"21 ids":   {many, "user_ids must hold 1-20"},
		"blank id": {[]string{x.ub.ID, " "}, "user_ids must not hold a blank id"},
		"empty id": {[]string{""}, "user_ids must not hold a blank id"},
	} {
		_, err := x.callJSON(t, x.p, "invite_to_meeting", map[string]any{"workspace_id": x.w.ID, "meeting_id": m.ID, "user_ids": tc.ids})
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.HasPrefix(bad.Msg, tc.want) {
			t.Errorf("%s: %v, want invalid arguments with %q", name, err, tc.want)
		}
	}
	var bad McpInvalidArgs
	if _, err := x.callJSON(t, x.p, "invite_to_meeting", map[string]any{"workspace_id": x.w.ID, "meeting_id": " ", "user_ids": []string{x.ub.ID}}); !errors.As(err, &bad) || bad.Msg != "meeting_id is required" {
		t.Errorf("blank meeting id: %v", err)
	}
	if n := x.meetingEvents(t, "participant.invited", m.ID); n != 0 {
		t.Fatalf("a refused call put %d participant.invited rows on the outbox", n)
	}
	// An id named twice is invited once.
	if out := x.invite(t, x.p, m.ID, x.ub.ID, x.ub.ID); len(out.Item.Invites) != 1 {
		t.Errorf("duplicate ids = %+v, want one outcome", out.Item.Invites)
	}
	if n := x.meetingEvents(t, "participant.invited", m.ID); n != 1 {
		t.Errorf("%d participant.invited rows after a duplicated id, want 1", n)
	}
	// The workspace outside the grant, and a meeting of another workspace.
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	otherM := x.meeting(t, x.ua.ID, other.ID, "Ngoài", "")
	for _, args := range []map[string]any{
		{"workspace_id": x.w.ID, "meeting_id": otherM.ID, "user_ids": []string{x.ub.ID}},
		{"workspace_id": x.w.ID, "meeting_id": util.NewID(), "user_ids": []string{x.ub.ID}},
		{"workspace_id": other.ID, "meeting_id": otherM.ID, "user_ids": []string{x.ub.ID}},
	} {
		if _, err := x.callJSON(t, x.p, "invite_to_meeting", args); !errors.Is(err, ErrNotFound) {
			t.Errorf("invite %v: %v, want ErrNotFound", args, err)
		}
	}
}
