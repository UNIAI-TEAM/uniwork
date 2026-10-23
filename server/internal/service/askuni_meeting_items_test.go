package service

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// longRecordMeeting is an ended meeting with a long summary, ten decisions
// and seven action items: the shape the UNI-1995 demo's M1 had (#17).
func longRecordMeeting(t *testing.T, x *mcpToolWorld, title string) (db.Meeting, []string) {
	t.Helper()
	ctx := context.Background()
	m := endedMeeting(t, x, title)
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE meetings SET description = $2 WHERE id = $1`, m.ID, strings.Repeat("Mô tả dài. ", 80)); err != nil {
		t.Fatal(err)
	}
	var decisions []string
	for i := 1; i <= 10; i++ {
		decisions = append(decisions, fmt.Sprintf(`{"text":"Quyết định số %d về ngân sách và nhân sự của quý tới","evidence":[]}`, i))
	}
	if _, err := x.tools.ask.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: x.w.OrganizationID, Summary: strings.Repeat("Nhóm rà soát tiến độ từng mảng. ", 60),
		Decisions: "[" + strings.Join(decisions, ",") + "]", ActionItems: `[]`,
		Topics: `[{"title":"Ngân sách","start":null,"points":[]}]`, OpenQuestions: `[{"text":"Ai duyệt?","evidence":[]}]`,
		Model: "fake", CreatedBy: x.ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	var titles []string
	for i := 1; i <= 7; i++ {
		title := fmt.Sprintf("Việc số %d cần chốt", i)
		if _, err := x.tools.ask.meetings.AddActionItem(ctx, x.ua.ID, m.ID, AddActionItemInput{Title: title, OwnerText: "An"}); err != nil {
			t.Fatal(err)
		}
		titles = append(titles, title)
	}
	return m, titles
}

// UNI-1995 #17: scoped to a meeting, every action item reaches the model even
// past a long summary, and the items come before the summary they would
// otherwise be cut behind.
func TestScopedMeetingSourceKeepsEveryActionItem(t *testing.T) {
	x := newMcpToolWorld(t)
	m, titles := longRecordMeeting(t, x, "Giao ban tuần 43")
	srcs, err := x.tools.ask.Sources(context.Background(), ai.SourceQuery{
		UserID: x.ua.ID, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID,
		Question: "Có những việc gì, ai nhận?", Focus: &ai.Focus{Kind: "meeting", ID: m.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	pack, _ := ai.BuildContext(srcs)
	ex := pack[0].Excerpt
	for _, w := range titles {
		if !strings.Contains(ex, "- "+w+" · chưa giao · người được nêu: An") {
			t.Errorf("the scoped meeting source lost %q:\n%s", w, ex)
		}
	}
	items, summary, desc := strings.Index(ex, "Việc cần làm:"), strings.Index(ex, "Tóm tắt:"), strings.Index(ex, "Mô tả:")
	if items < 0 || summary < 0 || items > summary || (desc >= 0 && desc < summary) {
		t.Errorf("want items, then summary, then description; at %d, %d, %d:\n%s", items, summary, desc, ex)
	}
}

// UNI-1995 #17: asked without a scope, the meeting a question finds brings
// its action items, not only its summary search excerpt; a member outside the
// meeting gets the items and still not the summary.
func TestUnscopedQuestionBringsTheFoundMeetingsItems(t *testing.T) {
	x := newMcpToolWorld(t)
	_, titles := longRecordMeeting(t, x, "Giao ban tuần 43")
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	for _, who := range []string{x.ua.ID, x.ub.ID} {
		srcs, err := x.tools.ask.Sources(context.Background(), ai.SourceQuery{
			UserID: who, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID,
			Question: "Cuộc họp giao ban tuần 43 có những việc gì, ai nhận?",
		})
		if err != nil {
			t.Fatal(err)
		}
		pack, _ := ai.BuildContext(srcs)
		var ex string
		for _, s := range pack {
			if s.Kind == "meeting" {
				ex = s.Excerpt
				break
			}
		}
		for _, w := range titles {
			if !strings.Contains(ex, "- "+w+" · chưa giao") {
				t.Errorf("%s: the found meeting lacks %q:\n%s", who, w, ex)
			}
		}
		if hasSummary := strings.Contains(ex, "Nhóm rà soát tiến độ"); hasSummary != (who == x.ua.ID) {
			t.Errorf("%s: summary quoted = %v:\n%s", who, hasSummary, ex)
		}
	}
}
