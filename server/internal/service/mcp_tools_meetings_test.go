package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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
