package service

import (
	"context"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// Benchmark UNI-1995 #22 and #8: the minutes say how many items are still
// pending (the finalize warning), carry a @7 summary's topics and open
// questions, and take a facts-only refresh while they are a draft.

func TestMinutesCarryTopicsAndCountPendingItems(t *testing.T) {
	s, ua, _, _, m := minutesFixture(t)
	ctx := context.Background()
	if _, err := s.storeSummary(ctx, m, Human(ua.ID), ai.MeetingSummary{
		Summary: "Nhóm chốt ngân sách.", Decisions: []ai.Decision{{Text: "Chốt ngân sách quý 4"}}, ActionItems: []ai.ActionItem{},
		Topics:        []ai.SummaryTopic{{Title: "Ngân sách quý 4", Points: []ai.Decision{{Text: "Đề xuất 2 tỷ"}}}},
		OpenQuestions: []ai.Decision{{Text: "Ai duyệt kế hoạch tuyển dụng?"}},
	}, ai.Response{Model: "fake"}, newSummaryLabels(), false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Gửi biên bản"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.CreateMinutes(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if got.PendingItems != 1 {
		t.Errorf("pending items = %d, want 1", got.PendingItems)
	}
	doc, err := s.q.GetDocumentByID(ctx, got.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Ngân sách quý 4", "Đề xuất 2 tỷ", "Vấn đề còn mở", "Ai duyệt kế hoạch tuyển dụng?"} {
		if !strings.Contains(doc.ContentText, want) {
			t.Errorf("page text lacks %q:\n%s", want, doc.ContentText)
		}
	}
}

func TestRefreshMinutesFactsKeepsWhatWasWritten(t *testing.T) {
	s, ua, ub, uc, m := minutesFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)

	_, err := s.RefreshMinutesFacts(ctx, ua.ID, m.ID)
	wantCode(t, err, "minutes_missing")
	made, err := s.CreateMinutes(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	// The secretary corrects the narrative by hand.
	view, err := s.Docs.GetDocument(ctx, Human(ub.ID), made.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	edited := strings.Replace(string(view.Document.Content), "Nhóm chốt ngân sách.", "Nhóm chốt ngân sách, đã sửa tay.", 1)
	if edited == string(view.Document.Content) {
		t.Fatal("the summary paragraph is not in the page")
	}
	if _, err := s.Docs.UpdateDocument(ctx, Human(ub.ID), made.DocumentID, UpdateDocumentInput{
		Revision: view.Document.Revision, Content: []byte(edited),
	}); err != nil {
		t.Fatal(err)
	}
	// A task is assigned after the minutes were made.
	item, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Chốt hợp đồng in"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: item.Item.ID, AssigneeID: &ub.ID}}); err != nil {
		t.Fatal(err)
	}

	_, err = s.RefreshMinutesFacts(ctx, uc.ID, m.ID)
	wantCode(t, err, "not_meeting_clerk")
	got, err := s.RefreshMinutesFacts(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.PendingItems != 0 {
		t.Errorf("pending items = %d", got.PendingItems)
	}
	doc, err := s.q.GetDocumentByID(ctx, made.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Việc đã giao", "Chốt hợp đồng in", "đã sửa tay", "Người được mời", "Chốt ngân sách quý 4"} {
		if !strings.Contains(doc.ContentText, want) {
			t.Errorf("refreshed page lacks %q:\n%s", want, doc.ContentText)
		}
	}
	if n := strings.Count(doc.ContentText, "Việc đã giao"); n != 1 {
		t.Errorf("assigned section %d times:\n%s", n, doc.ContentText)
	}
	// Nothing changed since: a second refresh writes nothing.
	rev := doc.Revision
	if _, err := s.RefreshMinutesFacts(ctx, ub.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if again, _ := s.q.GetDocumentByID(ctx, made.DocumentID); again.Revision != rev {
		t.Errorf("an idle refresh moved the revision %d → %d", rev, again.Revision)
	}

	// Finalized minutes are the record: no refresh until they are reopened.
	if _, err := s.FinalizeMinutes(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.RefreshMinutesFacts(ctx, ua.ID, m.ID)
	wantCode(t, err, "minutes_finalized")
}

// TestSpliceMinutesFacts: a section that appears later (the votes) lands in
// its place, one that went away (the invited list, once the roll is final)
// is replaced, and everything else is left as written.
func TestSpliceMinutesFacts(t *testing.T) {
	l := minutesLayoutFor("vi")
	before := fullMinutesFacts()
	before.Attendance, before.Motions, before.Assigned = nil, nil, nil
	before.Invited = []string{"Nguyễn An"}
	page := mustPage(t, renderMinutes(before, fullMinutesNarrative(), l)+"\nGhi chú tay cuối trang.\n")
	got, changed, err := spliceMinutesFacts(page, fullMinutesFacts(), l)
	if err != nil || !changed {
		t.Fatalf("splice = %v, changed %v", err, changed)
	}
	text := string(got)
	order := []string{"Thành phần", "Nội dung", "Kết luận", "Kết quả biểu quyết", "Việc đã giao", "Người lập", "Ghi chú tay cuối trang."}
	last := -1
	for _, w := range order {
		i := strings.Index(text, w)
		if i <= last {
			t.Fatalf("%q out of place (at %d after %d):\n%s", w, i, last, text)
		}
		last = i
	}
	if strings.Contains(text, "Người được mời") {
		t.Errorf("the invited list stayed beside the roll:\n%s", text)
	}
	if _, changed, err := spliceMinutesFacts(got, fullMinutesFacts(), l); err != nil || changed {
		t.Errorf("a second splice changed the page (%v)", err)
	}
}

func mustPage(t *testing.T, md string) []byte {
	t.Helper()
	p, err := minutesPage(md)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
