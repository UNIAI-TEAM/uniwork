package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// runTranscriptTool runs the agent's get_meeting_transcript as the asker.
func runTranscriptTool(t *testing.T, s *AskUNIService, tc ai.ToolContext, args string) []agentItem {
	t.Helper()
	for _, tool := range s.agentTools() {
		if tool.Name == askToolTranscript {
			items, err := tool.run(context.Background(), tc, json.RawMessage(args))
			if err != nil {
				t.Fatalf("get_meeting_transcript(%s): %v", args, err)
			}
			return items
		}
	}
	t.Fatal("no get_meeting_transcript tool")
	return nil
}

// B8 (§5.2): the tool reads a stretch of the transcript by time and by
// keyword, at most 200 segments a call, with the meeting's own read
// permission; an outsider or another workspace reads it as absent.
func TestMeetingTranscriptToolReadsByTimeAndWord(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	early := catchUpSegment(t, s, m, "AGENT", "An", "Mở đầu cuộc họp", 25*time.Minute)
	catchUpSegment(t, s, m, "AGENT", "Bình", "Ngân sách quý IV tăng mười phần trăm", 15*time.Minute)
	catchUpSegment(t, s, m, "CAPTION", "Chi", "Ngân sách theo phụ đề trình duyệt", 14*time.Minute)
	catchUpSegment(t, s, m, "AGENT", "An", "Chốt lịch demo thứ Sáu", 5*time.Minute)
	tc := ai.ToolContext{ActorID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}
	args := func(from, to, query string) string {
		return fmt.Sprintf(`{"meeting_id":%q,"from":%q,"to":%q,"query":%q}`, m.ID, from, to, query)
	}

	all := runTranscriptTool(t, s, tc, args("", "", ""))
	if len(all) != 1 || all[0].Kind != "transcript" || all[0].Key == "" {
		t.Fatalf("whole transcript: %+v", all)
	}
	if all[0].Title != m.Title || !strings.HasSuffix(all[0].Href, "/meetings/"+m.ID+"?section=transcript") {
		t.Fatalf("source label = %q, href = %q", all[0].Title, all[0].Href)
	}
	text := all[0].Text
	if !strings.Contains(text, "Mở đầu") || !strings.Contains(text, "Chốt lịch demo") || strings.Contains(text, "phụ đề trình duyệt") {
		t.Fatalf("source rule or order broken:\n%s", text)
	}
	if strings.Index(text, "Mở đầu") > strings.Index(text, "Chốt lịch") {
		t.Fatalf("not oldest first:\n%s", text)
	}
	if !strings.Contains(text, meetingClock(m)(early.SpokenAt.Time)) {
		t.Fatalf("lines carry no time:\n%s", text)
	}

	from := time.Now().Add(-20 * time.Minute).Format(time.RFC3339)
	to := time.Now().Add(-10 * time.Minute).Format(time.RFC3339)
	ranged := runTranscriptTool(t, s, tc, args(from, to, ""))
	if len(ranged) != 1 || !strings.Contains(ranged[0].Text, "Ngân sách quý IV") || strings.Contains(ranged[0].Text, "Mở đầu") || strings.Contains(ranged[0].Text, "Chốt lịch") {
		t.Fatalf("time range: %+v", ranged)
	}
	found := runTranscriptTool(t, s, tc, args("", "", "ngan sach"))
	if len(found) != 1 || !strings.Contains(found[0].Text, "Ngân sách quý IV") || strings.Contains(found[0].Text, "Mở đầu") {
		t.Fatalf("keyword: %+v", found)
	}
	if got := runTranscriptTool(t, s, tc, args("hôm qua", "", "")); !isError(got, "invalid_args: from must be ISO 8601 with an offset, or \"\"") {
		t.Fatalf("bad from: %+v", got)
	}

	outsider := ai.ToolContext{ActorID: ub.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}
	if got := runTranscriptTool(t, s, outsider, args("", "", "")); !isError(got, "not_found") {
		t.Fatalf("outsider read the transcript: %+v", got)
	}
	elsewhere := ai.ToolContext{ActorID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: "01OTHERWORKSPACE0000000000"}
	if got := runTranscriptTool(t, s, elsewhere, args("", "", "")); !isError(got, "not_found") {
		t.Fatalf("another workspace read the transcript: %+v", got)
	}
}

func TestMeetingTranscriptToolCapsAt200Segments(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	for i := range 205 {
		catchUpSegment(t, s, m, "AGENT", "An", fmt.Sprintf("câu số %d", i), time.Duration(300-i)*time.Second)
	}
	tc := ai.ToolContext{ActorID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}
	items := runTranscriptTool(t, s, tc, fmt.Sprintf(`{"meeting_id":%q,"from":"","to":"","query":""}`, m.ID))
	if len(items) != 2 || items[1].Kind != "note" {
		t.Fatalf("want the transcript and a note that more exist, got %d items", len(items))
	}
	if n := strings.Count(items[0].Text, "\n") + 1; n != askTranscriptMax {
		t.Fatalf("lines = %d, want %d", n, askTranscriptMax)
	}
}

// A keyword scans the oldest summaryTranscriptRows lines; when the stretch
// holds more, the tool says so instead of answering "nothing matches".
func TestMeetingTranscriptToolSaysWhenTheKeywordScanWasCut(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	for i := range summaryTranscriptRows {
		catchUpSegment(t, s, m, "AGENT", "An", fmt.Sprintf("câu số %d", i), time.Duration(3*summaryTranscriptRows-i)*time.Second)
	}
	catchUpSegment(t, s, m, "AGENT", "Bình", "Ngân sách quý IV", time.Second)
	tc := ai.ToolContext{ActorID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}
	items := runTranscriptTool(t, s, tc, fmt.Sprintf(`{"meeting_id":%q,"from":"","to":"","query":"ngan sach"}`, m.ID))
	if len(items) == 0 || items[len(items)-1].Kind != "note" {
		t.Fatalf("a cut keyword scan must end with a note that more lines exist, got %+v", items)
	}
}

// P0 (ask_uni_agent off): a question asked with a meeting in focus also
// reads the transcript lines that match it.
func TestAskMeetingFocusReadsTheTranscript(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "Bình", "Ngân sách quý IV tăng mười phần trăm", 15*time.Minute)
	srcs, err := s.Sources(context.Background(), ai.SourceQuery{
		UserID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID,
		Question: "ngân sách quý IV thế nào?", Focus: &ai.Focus{Kind: "meeting", ID: m.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	var hit bool
	for _, src := range srcs {
		hit = hit || (src.Kind == "transcript" && strings.Contains(src.Excerpt, "tăng mười phần trăm"))
	}
	if !hit {
		t.Fatalf("no transcript source: %+v", srcs)
	}
}

// Fix round 1: on P0 the focus source ranks lines by how much of the
// question they hold, newest first among equals, so a late line about the
// subject beats a crowd of early lines that only share common words, and
// survives the excerpt cut (ai.MaxExcerpt).
func TestAskMeetingFocusRanksTheRelevantLateLine(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	for i := range 40 {
		catchUpSegment(t, s, m, "AGENT", "An", fmt.Sprintf("Mọi người vừa nói về lịch nghỉ lần %d", i), time.Duration(40-i)*time.Minute+30*time.Second)
	}
	catchUpSegment(t, s, m, "AGENT", "Bình", "Ngân sách quý IV tăng mười phần trăm", time.Minute)
	srcs, err := s.Sources(context.Background(), ai.SourceQuery{
		UserID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID,
		Question: "vừa nói gì về ngân sách?", Focus: &ai.Focus{Kind: "meeting", ID: m.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	var excerpt string
	for _, src := range srcs {
		if src.Kind == "transcript" {
			excerpt = src.Excerpt
		}
	}
	head := []rune(excerpt)
	if len(head) > ai.MaxExcerpt {
		head = head[:ai.MaxExcerpt]
	}
	if !strings.Contains(string(head), "Ngân sách quý IV") {
		t.Fatalf("the late line about the budget is not within the excerpt the model sees:\n%s", excerpt)
	}
	if n := strings.Count(excerpt, "\n") + 1; n > askTranscriptP0Lines {
		t.Fatalf("focus source has %d lines, want at most %d", n, askTranscriptP0Lines)
	}
}

// Without a stopword to lean on, ranking still wins: more of the question's
// words beat fewer, and the kept lines fit one excerpt in time order.
func TestAskMeetingFocusKeepsTheBestLinesWithinOneExcerpt(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	for i := range 40 {
		catchUpSegment(t, s, m, "AGENT", "An", fmt.Sprintf("Kế hoạch tuyển dụng cho dự án mới, đợt thứ %d trong năm nay", i), time.Duration(40-i)*time.Minute+30*time.Second)
	}
	catchUpSegment(t, s, m, "AGENT", "Bình", "Kế hoạch ngân sách quý IV tăng mười phần trăm", time.Minute)
	srcs, err := s.focusTranscript(context.Background(), ai.ToolContext{ActorID: ua.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}, m.ID, "kế hoạch ngân sách ra sao?")
	if err != nil || len(srcs) != 1 {
		t.Fatalf("focus: %v %+v", err, srcs)
	}
	ex := srcs[0].Excerpt
	if utf8.RuneCountInString(ex) > ai.MaxExcerpt || !strings.Contains(ex, "Kế hoạch ngân sách quý IV") {
		t.Fatalf("excerpt (%d runes) lacks the best line or exceeds one excerpt:\n%s", utf8.RuneCountInString(ex), ex)
	}
}

// UNI-1995 access: a workspace member outside the meeting reads its
// transcript through Ask UNI as absent, and a question focused on the
// meeting keeps the meeting's context without what was said; invited, they
// read it like the host.
func TestMeetingTranscriptToolIsForThePeopleOfTheMeeting(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	addMember(t, s.meetings, w.ID, ub.ID)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "An", "Kết quả đánh giá của Bình", 10*time.Minute)
	tc := ai.ToolContext{ActorID: ub.ID, OrganizationID: m.OrganizationID, WorkspaceID: w.ID}
	args := fmt.Sprintf(`{"meeting_id":%q,"from":"","to":"","query":""}`, m.ID)
	if got := runTranscriptTool(t, s, tc, args); !isError(got, "not_found") {
		t.Fatalf("uninvited member read the transcript: %+v", got)
	}
	srcs, err := s.focusTranscript(context.Background(), tc, m.ID, "đánh giá thế nào?")
	if err != nil || len(srcs) != 0 {
		t.Fatalf("focus for an uninvited member = %+v, %v; want nothing and no error", srcs, err)
	}
	if _, err := s.meetings.Invite(context.Background(), ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	if got := runTranscriptTool(t, s, tc, args); len(got) != 1 || !strings.Contains(got[0].Text, "Kết quả đánh giá") {
		t.Fatalf("invited member: %+v", got)
	}
}
