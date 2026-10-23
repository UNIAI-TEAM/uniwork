package service

import (
	"context"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// endedMeeting is a meeting of the world that has ended, so it takes items.
func endedMeeting(t *testing.T, x *mcpToolWorld, title string) db.Meeting {
	t.Helper()
	m := x.meeting(t, x.ua.ID, x.w.ID, title, "")
	if _, err := x.tools.ask.pool.Exec(context.Background(), `UPDATE meetings SET status = $2 WHERE id = $1`, m.ID, MeetingEnded); err != nil {
		t.Fatal(err)
	}
	return m
}

// Benchmark #17: Ask UNI and the MCP connector quote a meeting's action items
// as the meeting holds them now: a pending one with what was said, a
// converted one as its task stands, a dismissed one not at all, and never
// the model's raw proposal stored with the summary.
func TestMeetingExcerptQuotesTheRealActionItems(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := endedMeeting(t, x, "Họp tuần")
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: x.w.OrganizationID, Summary: "Đã chốt OKR quý",
		Decisions: `[{"text":"Giữ ngân sách","evidence":[]}]`, ActionItems: `[{"title":"Đề xuất thô của mô hình"}]`,
		Topics: `[{"title":"Ngân sách","start":null,"points":[]}]`, OpenQuestions: `[{"text":"Ai duyệt?","evidence":[]}]`,
		Model: "fake", CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	meetings := x.tools.ask.meetings
	meetings.Tasks = x.tools.ask.tasks // conversion makes a task
	pending, err := meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Gửi biên bản", OwnerText: "An", DueText: "thứ Sáu"})
	if err != nil {
		t.Fatal(err)
	}
	_ = pending
	gone, err := meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Việc đã bỏ"})
	if err != nil {
		t.Fatal(err)
	}
	if err := meetings.DismissActionItem(ctx, x.ua.ID, m.ID, gone.Item.ID, "trùng"); err != nil {
		t.Fatal(err)
	}
	conv, err := meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Chốt hợp đồng"})
	if err != nil {
		t.Fatal(err)
	}
	due := "2026-12-01"
	if _, err := meetings.ConvertActionItems(ctx, x.ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: conv.Item.ID, AssigneeID: &x.ua.ID, DueDate: &due}}); err != nil {
		t.Fatal(err)
	}
	got, err := x.tools.GetMeeting(ctx, x.p, x.w.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	srcs, err := x.tools.ask.meetingContext(ctx, ai.ToolContext{ActorID: x.ua.ID, WorkspaceID: x.w.ID}, m.ID)
	if err != nil || len(srcs) != 1 {
		t.Fatalf("meetingContext = %+v, %v", srcs, err)
	}
	for name, excerpt := range map[string]string{"mcp": got.Excerpt, "ask": srcs[0].Excerpt} {
		for _, w := range []string{
			"Tóm tắt: Đã chốt OKR quý", "Chủ đề: Ngân sách", `Quyết định: ["Giữ ngân sách"]`, `Câu hỏi còn mở: ["Ai duyệt?"]`,
			"- Gửi biên bản · chưa giao · người được nêu: An · hạn được nêu: thứ Sáu",
			"- Chốt hợp đồng · đã giao thành task · trạng thái: Cần làm · ", "· người nhận: " + x.ua.DisplayName + " · hạn: 2026-12-01",
		} {
			if !strings.Contains(excerpt, w) {
				t.Errorf("%s excerpt lacks %q:\n%s", name, w, excerpt)
			}
		}
		for _, gone := range []string{"Việc đã bỏ", "Đề xuất thô của mô hình"} {
			if strings.Contains(excerpt, gone) {
				t.Errorf("%s excerpt quotes %q:\n%s", name, gone, excerpt)
			}
		}
	}
}

// Benchmark #14: a meeting is found by what it decided and what it assigned,
// not only by its title, and the hit quotes its summary; list_meetings quotes
// it too.
func TestMeetingSearchScoresTheRecord(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := endedMeeting(t, x, "Họp giao ban thứ Hai")
	x.meeting(t, x.ua.ID, x.w.ID, "Họp khác", "")
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: x.w.OrganizationID, Summary: "Nhóm rà soát tiến độ.",
		Decisions: `[{"text":"Giữ ngân sách marketing ở 2 tỷ","evidence":[]}]`, ActionItems: `[]`,
		Topics: `[]`, OpenQuestions: `[]`, Model: "fake", CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.ask.meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Đặt lịch phỏng vấn ứng viên"}); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"ngân sách marketing", "phỏng vấn ứng viên"} {
		hits, err := x.tools.Search(ctx, x.p, x.w.ID, q)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, h := range hits {
			if h.Kind == "meeting" && h.ID == m.ID {
				found = true
				if !strings.Contains(h.Excerpt, "Tóm tắt: Nhóm rà soát tiến độ.") {
					t.Errorf("%q: hit excerpt lacks the summary: %q", q, h.Excerpt)
				}
			}
			if h.Kind == "meeting" && h.ID != m.ID {
				t.Errorf("%q matched the other meeting", q)
			}
		}
		if !found {
			t.Errorf("%q did not find the meeting by its record: %+v", q, hits)
		}
	}
	from, to := aroundNow()
	for _, it := range x.meetingList(t, from, to, "").Meetings {
		if it.ID == m.ID && !strings.Contains(it.Excerpt, "Tóm tắt: Nhóm rà soát tiến độ.") {
			t.Errorf("list_meetings excerpt lacks the summary: %q", it.Excerpt)
		}
	}
}

// The summary is for the people of the meeting (UNI-1995 access), and so is
// what its pending items say (demo bug 2): a member outside it never finds
// the meeting by either, no read of Ask UNI, MCP or GET summary quotes them,
// and a converted item reaches them as the task it became.
func TestMeetingSummaryStaysWithThePeopleOfTheMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	m := endedMeeting(t, x, "Họp giao ban thứ Hai")
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: x.w.OrganizationID, Summary: "Nhóm rà soát tiến độ.",
		Decisions: `[{"text":"Giữ ngân sách marketing ở 2 tỷ","evidence":[]}]`, ActionItems: `[]`,
		Topics: `[{"title":"Tuyển dụng kỹ sư","start":null,"points":[]}]`, OpenQuestions: `[]`, Model: "fake", CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	meetings := x.tools.ask.meetings
	meetings.Tasks = x.tools.ask.tasks // conversion makes a task
	if _, err := meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Đặt lịch phỏng vấn ứng viên", OwnerText: "Lan"}); err != nil {
		t.Fatal(err)
	}
	conv, err := meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: "Chốt hợp đồng thuê"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := meetings.ConvertActionItems(ctx, x.ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: conv.Item.ID}}); err != nil {
		t.Fatal(err)
	}
	addMember(t, meetings, x.w.ID, x.ub.ID)
	outsider := McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}
	said := []string{"Nhóm rà soát tiến độ", "ngân sách marketing", "Tuyển dụng kỹ sư", "phỏng vấn ứng viên", "Lan"}
	quotes := func(where, s string) {
		for _, w := range said {
			if strings.Contains(s, w) {
				t.Errorf("%s quotes the summary (%q) to a member outside the meeting:\n%s", where, w, s)
			}
		}
	}
	for _, q := range []string{"ngân sách marketing", "tuyển dụng kỹ sư", "phỏng vấn ứng viên"} {
		hits, err := x.tools.Search(ctx, outsider, x.w.ID, q)
		if err != nil {
			t.Fatal(err)
		}
		for _, h := range hits {
			if h.Kind == "meeting" && h.ID == m.ID {
				t.Errorf("%q found the meeting through its AI content for an outsider: %q", q, h.Excerpt)
			}
		}
	}
	from, to := aroundNow()
	x.p = outsider
	for _, it := range x.meetingList(t, from, to, "").Meetings {
		quotes("list_meetings", it.Excerpt)
	}
	got, err := x.tools.GetMeeting(ctx, outsider, x.w.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	quotes("get_meeting", got.Excerpt)
	srcs, err := x.tools.ask.meetingContext(ctx, ai.ToolContext{ActorID: x.ub.ID, WorkspaceID: x.w.ID}, m.ID)
	if err != nil || len(srcs) != 1 {
		t.Fatalf("meetingContext for an outsider = %+v, %v", srcs, err)
	}
	quotes("ask meeting context", srcs[0].Excerpt)
	for name, excerpt := range map[string]string{"get_meeting": got.Excerpt, "ask meeting context": srcs[0].Excerpt} {
		if !strings.Contains(excerpt, "- Chốt hợp đồng thuê · đã giao thành task") {
			t.Errorf("%s dropped the task the meeting handed out for an outsider: %q", name, excerpt)
		}
	}
	host, err := x.tools.ask.meetingContext(ctx, ai.ToolContext{ActorID: x.ua.ID, WorkspaceID: x.w.ID}, m.ID)
	if err != nil || len(host) != 1 || !strings.Contains(host[0].Excerpt, "Đặt lịch phỏng vấn ứng viên · chưa giao · người được nêu: Lan") {
		t.Errorf("meetingContext for the host lost the pending item: %+v, %v", host, err)
	}
	if _, err := x.tools.ask.meetings.SummaryWithRun(ctx, x.ub.ID, m.ID); !codedIs(err, "meeting_ai_restricted") {
		t.Errorf("GET summary for an outsider: %v, want meeting_ai_restricted", err)
	}
	if v, err := x.tools.ask.meetings.SummaryWithRun(ctx, x.ua.ID, m.ID); err != nil || v.Summary == nil {
		t.Errorf("GET summary for the host = %+v, %v", v, err)
	}
}
