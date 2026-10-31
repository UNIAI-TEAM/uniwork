package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// meeting_summary@8: the stored paragraph is the summary sentences joined,
// and each sentence keeps only the evidence labels the input showed, the way
// decisions do.
func TestSummarizeStoresSummaryPoints(t *testing.T) {
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"tldr":"Một đoạn khác.","summary_points":[{"text":"Chốt ship thứ Sáu.","evidence":["S1","S99"]},{"text":"Chưa ai nhận việc.","evidence":[]}],"topics":[],"decisions":[],"action_items":[],"open_questions":[]}`}
	}}
	s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
	sum, err := s.Summarize(context.Background(), ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if sum.Summary != "Chốt ship thứ Sáu. Chưa ai nhận việc." {
		t.Fatalf("summary = %q", sum.Summary)
	}
	pts := DecodeSummaryDecisions(sum.SummaryPoints)
	if len(pts) != 2 || pts[0].Text != "Chốt ship thứ Sáu." || len(pts[0].Evidence) != 1 || pts[0].Evidence[0].Kind != EvidenceSegment || len(pts[1].Evidence) != 0 {
		t.Fatalf("summary points = %+v (S99 names no line and is dropped)", pts)
	}
}
