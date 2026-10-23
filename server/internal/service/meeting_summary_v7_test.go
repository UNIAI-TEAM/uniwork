package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// lastPromptOf is the rendered user message of a provider request.
func lastPromptOf(req provider.CompletionRequest) string {
	if n := len(req.Messages); n > 0 {
		return req.Messages[n-1].Content
	}
	return ""
}

// lockedFake serializes a Fake: the parts of a long summary are asked
// concurrently and Fake records its calls without a lock.
type lockedFake struct {
	mu sync.Mutex
	*provider.Fake
}

func (f *lockedFake) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Fake.Complete(ctx, req)
}

// Benchmark #6: an answer cut at max_tokens is billed and, at temperature 0,
// cut the same way again; the summary asks once more in brief mode and
// stores that answer instead of failing.
func TestSummarizeRetriesACutAnswerInBriefMode(t *testing.T) {
	var prompts []string
	fake := &provider.Fake{}
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		p := lastPromptOf(req)
		prompts = append(prompts, p)
		if strings.Contains(p, "\nOutput mode: brief\n") {
			fake.Err = nil
			return provider.CompletionResponse{Text: `{"tldr":"Chốt ship thứ Sáu.","topics":[],"decisions":[],"action_items":[{"title":"Gửi bản build","owner":"An","due":"thứ Sáu","description":"","priority":"","evidence":["S1"],"draft":""}],"open_questions":[]}`, OutputTokens: 40}
		}
		fake.Err = provider.ErrTruncated
		return provider.CompletionResponse{Text: `{"tldr":"Chốt`, OutputTokens: 12000}
	}
	s, ua, m, met := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if len(prompts) != 2 || strings.Contains(prompts[0], "Output mode") || !strings.Contains(prompts[1], "Output mode: brief") {
		t.Fatalf("prompts = %d, want the full one then the brief one", len(prompts))
	}
	if sum.Summary != "Chốt ship thứ Sáu." {
		t.Fatalf("summary = %q", sum.Summary)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM meeting_action_items WHERE meeting_id = $1 AND title = 'Gửi bản build' AND owner_text = 'An'`, m.ID); n != 1 {
		t.Fatalf("brief answer's items stored = %d", n)
	}
	// Both calls are billed; the first one settled as bad output.
	if n := countSummaryRows(t, s, `SELECT count(*) FROM ai_usage_events WHERE organization_id = $1 AND capability = 'meeting_summarization' AND reason_code = 'ai_output_invalid'`, m.OrganizationID); n != 1 {
		t.Fatalf("truncated usage rows = %d, want 1", n)
	}
	if !containsEvent(met.events, "summary_truncated") || !containsEvent(met.events, "summary_ok") {
		t.Fatalf("lifecycle events = %v", met.events)
	}
}

func containsEvent(events []string, e string) bool {
	for _, x := range events {
		if x == e {
			return true
		}
	}
	return false
}

// Benchmark #8: a transcript longer than one call's budget is read in parts
// whose records the summary combines; nothing in the middle is dropped, the
// record keeps the topics with their start segments and the open questions,
// and its evidence still names the transcript's rows.
func TestSummarizeLongTranscriptInParts(t *testing.T) {
	var parts, reduce []string
	fake := &provider.Fake{Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		p := lastPromptOf(req)
		if strings.Contains(req.System, "You write the notes of one stretch") {
			parts = append(parts, p)
			// Cite the stretch's first labelled line.
			label := p[strings.Index(p, "[S")+1 : strings.Index(p, "[S")+strings.Index(p[strings.Index(p, "[S"):], "]")]
			return provider.CompletionResponse{Text: fmt.Sprintf(`{"tldr":"Phần.","topics":[{"title":"Phần","start_label":"%s","points":[{"text":"Ý","evidence":["%s"]}]}],"decisions":[],"action_items":[],"open_questions":[]}`, label, label)}
		}
		reduce = append(reduce, p)
		return provider.CompletionResponse{Text: `{"tldr":"Cả buổi.","topics":[{"title":"Ngân sách","start_label":"S1","points":[{"text":"Giữ 2 tỷ","evidence":["S1","S99"]}]}],"decisions":[],"action_items":[],"open_questions":[{"text":"Ai duyệt?","evidence":["S2"]}]}`}
	}}
	s, ua, m, _ := summaryFixture(t, nil, ai.Options{})
	s.AI = ai.NewGateway(s.q, &lockedFake{Fake: fake}, NewAIQuota(s.ent), nil, ai.Options{})
	ctx := context.Background()
	line := strings.Repeat("Bàn kế hoạch ngân sách quý tới ", 100) // ~3100 runes
	for i := 0; i < 30; i++ {                                      // ~93k runes: two parts of the 60k floor
		if _, err := s.AppendTranscript(ctx, ua.ID, m.ID, fmt.Sprintf("%d %s", i, line), time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 2 || len(reduce) != 1 {
		t.Fatalf("calls: %d parts, %d reduce; want 2 and 1", len(parts), len(reduce))
	}
	for _, p := range parts {
		if strings.Contains(p, "lines omitted") {
			t.Fatalf("a part dropped lines:\n%.400s", p)
		}
	}
	if !strings.Contains(reduce[0], `<untrusted source="partial_records">`) || !strings.Contains(reduce[0], "(summarized in the partial records above)") ||
		!strings.Contains(reduce[0], "Part 2 of 2") {
		t.Fatalf("reduce prompt lacks the parts:\n%.2000s", reduce[0])
	}
	if sum.Partial {
		t.Fatal("a transcript read whole in parts is not partial")
	}
	topics := DecodeSummaryTopics(sum.Topics)
	if len(topics) != 1 || topics[0].Start == nil || topics[0].Start.Kind != EvidenceSegment || len(topics[0].Points[0].Evidence) != 1 {
		t.Fatalf("topics = %+v (S99 names no line and is dropped)", topics)
	}
	var first string
	if err := s.pool.QueryRow(ctx, `SELECT id FROM meeting_transcript_segments WHERE meeting_id = $1 ORDER BY spoken_at, id LIMIT 1`, m.ID).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if topics[0].Start.ID != first {
		t.Fatalf("topic start = %s, want the first segment %s", topics[0].Start.ID, first)
	}
	if qs := DecodeSummaryDecisions(sum.OpenQuestions); len(qs) != 1 || qs[0].Text != "Ai duyệt?" || len(qs[0].Evidence) != 1 {
		t.Fatalf("open questions = %+v", qs)
	}
	v, err := s.SummaryWithRun(ctx, ua.ID, m.ID)
	if err != nil || v.Summary == nil || v.TopicStarts[first].IsZero() || v.Run.Status != SummaryRunIdle {
		t.Fatalf("view = %+v, %v", v, err)
	}
}

// Benchmark #21: the summary is handed the pending live items as drafts and
// refines one in place (owner, due, priority, description, more evidence),
// never as a second item; the never-repeat list holds only handled items.
func TestSummarizeRefinesLiveDraftsInPlace(t *testing.T) {
	var prompt string
	fake := &provider.Fake{Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		prompt = lastPromptOf(req)
		return provider.CompletionResponse{Text: `{"tldr":"Chốt.","topics":[],"decisions":[],"open_questions":[],"action_items":[
			{"title":"Gửi báo giá","owner":"Bình","due":"thứ Năm","description":"Khách cần trước demo.","priority":"high","evidence":["S1"],"draft":"D1"},
			{"title":"Gửi báo giá","owner":"Bình","due":"","description":"","priority":"","evidence":[],"draft":"D1"},
			{"title":"Đặt phòng demo","owner":"","due":"","description":"","priority":"","evidence":[],"draft":"D7"}]}`}
	}}
	s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	scribe := audit.System("meeting_scribe")
	live, err := s.q.InsertMeetingActionItem(ctx, db.InsertMeetingActionItemParams{
		ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
		Source: ActionItemSourceLive, Title: "Gửi báo giá", OwnerText: "An", Evidence: "[]",
		CreatedBy: scribe.ID, CreatedByKind: string(scribe.Kind),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Việc tay"}); err != nil {
		t.Fatal(err)
	}
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "<untrusted source=\"draft_action_items\">\n- [D1] Gửi báo giá · owner: An\n</untrusted>") ||
		!strings.Contains(prompt, "<untrusted source=\"existing_action_items\">\n- Việc tay\n</untrusted>") {
		t.Fatalf("prompt does not hand the live item as a draft:\n%s", prompt)
	}
	items := itemsByTitle(t, s, ua.ID, m)
	if len(items) != 3 {
		t.Fatalf("items = %v, want the draft refined, the manual one and one new", items)
	}
	got := items["Gửi báo giá"].Item
	if got.ID != live.ID || got.Source != ActionItemSourceLive || got.OwnerText != "Bình" || got.DueText != "thứ Năm" ||
		got.SuggestedPriority != "high" || got.Description != "Khách cần trước demo." || len(decodeEvidence(got.Evidence)) != 1 {
		t.Fatalf("refined draft = %+v", got)
	}
	if n := items["Đặt phòng demo"]; n.Item.Source != ActionItemSourceAI {
		t.Fatalf("an unknown draft label becomes a new AI item: %+v", n.Item)
	}
	var metadata string
	if err := s.pool.QueryRow(ctx, `SELECT metadata::text FROM audit_events WHERE action = $1 AND metadata::jsonb->>'summary_id' = $2`,
		audit.ActionMeetingSummaryCreated, sum.ID).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	_ = json.Unmarshal([]byte(metadata), &meta)
	if meta["refined_drafts"] != float64(1) || meta["skipped_duplicates"] != float64(1) {
		t.Fatalf("audit metadata = %v", meta)
	}
}

// Benchmark #12: GET summary says whether a summary is being made: the run
// lease of a clerk's or the system's run, or the system's queued run.
func TestSummaryWithRunReportsTheRun(t *testing.T) {
	s, ua, m, _ := summaryFixture(t, nil, ai.Options{})
	ctx := context.Background()
	v, err := s.SummaryWithRun(ctx, ua.ID, m.ID)
	if err != nil || v.Summary != nil || v.Run.Status != SummaryRunIdle {
		t.Fatalf("idle view = %+v, %v", v, err)
	}
	release, err := s.claimSummaryRun(ctx, m, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := s.SummaryWithRun(ctx, ua.ID, m.ID); v.Run.Status != SummaryRunRunning || v.Run.At.IsZero() {
		t.Fatalf("running view = %+v", v.Run)
	}
	release()
	if err := s.q.QueueMeetingAutoSummary(ctx, db.QueueMeetingAutoSummaryParams{MeetingID: m.ID, OrganizationID: m.OrganizationID, AfterSeconds: 30}); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.SummaryWithRun(ctx, ua.ID, m.ID); v.Run.Status != SummaryRunQueued || time.Until(v.Run.At) < 20*time.Second {
		t.Fatalf("queued view = %+v", v.Run)
	}
	if _, err := s.SummaryWithRun(ctx, "nobody", m.ID); err == nil {
		t.Fatal("a non-member read the run state")
	}
}

// Benchmark #12: a provider failure, a timeout or a rate limit leaves the
// queue row due again after a backoff; only the last attempt reminds the
// host. A billed answer that did not parse still settles at once.
func TestAutoSummaryRetriesWhatPasses(t *testing.T) {
	ctx := context.Background()
	t.Run("provider error backs off, then the last attempt reminds", func(t *testing.T) {
		s, ua, m, _ := summaryFixture(t, &provider.Fake{Err: errors.New("vendor down")}, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		for attempt := 1; attempt < autoSummaryMaxAttempts; attempt++ {
			makeAutoDue(t, s, m.ID)
			if err := s.claimAutoSummaries(ctx); err != nil {
				t.Fatal(err)
			}
			due, queued := autoQueue(t, s, m.ID)
			want := autoSummaryBackoff << (2 * (attempt - 1))
			if !queued || due < want-5*time.Second || due > want+5*time.Second {
				t.Fatalf("attempt %d: queued=%v due in %v, want ~%v", attempt, queued, due, want)
			}
			if n := outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID); n != 0 {
				t.Fatalf("attempt %d reminded the host", attempt)
			}
			if v, _ := s.SummaryWithRun(ctx, ua.ID, m.ID); v.Run.Status != SummaryRunQueued || v.Run.Attempts != attempt {
				t.Fatalf("run while waiting = %+v", v.Run)
			}
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if _, queued := autoQueue(t, s, m.ID); queued || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 1 {
			t.Fatal("the last attempt must settle and remind")
		}
	})
	t.Run("a rate limit waits its retry_after", func(t *testing.T) {
		s, ua, m, _ := summaryFixture(t, &provider.Fake{Err: &provider.StatusError{Status: 429, RetryAfter: 300 * time.Second}}, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if due, queued := autoQueue(t, s, m.ID); !queued || due < 290*time.Second {
			t.Fatalf("queued=%v due in %v, want the 300 s retry_after", queued, due)
		}
	})
	t.Run("a refusal settles on the first attempt", func(t *testing.T) {
		// ai_refused is billed and deterministic: a retry pays again for the same no.
		fake := &provider.Fake{Err: provider.ErrRefused}
		s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if _, queued := autoQueue(t, s, m.ID); queued || fake.Calls != 1 || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 1 {
			t.Fatalf("a refusal must settle and remind (queued %v, calls %d)", queued, fake.Calls)
		}
	})
	t.Run("a bad answer settles", func(t *testing.T) {
		var calls atomic.Int32
		s, ua, m, _ := summaryFixture(t, &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			calls.Add(1)
			return provider.CompletionResponse{Text: "not json"}
		}}, ai.Options{})
		if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		makeAutoDue(t, s, m.ID)
		if err := s.claimAutoSummaries(ctx); err != nil {
			t.Fatal(err)
		}
		if _, queued := autoQueue(t, s, m.ID); queued || calls.Load() != 1 || outboxTopicCount(t, s, topicAutoSummaryFailed, m.ID) != 1 {
			t.Fatalf("a parse failure must settle and remind (calls %d)", calls.Load())
		}
	})
}

// Benchmark #22 j: the system's summary speaks the meeting's language.
func TestAutoSummarySpeaksTheMeetingsLanguage(t *testing.T) {
	var prompt string
	fake := &provider.Fake{Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		prompt = lastPromptOf(req)
		return provider.CompletionResponse{Text: `{"tldr":"Ship on Friday.","topics":[],"decisions":[],"action_items":[],"open_questions":[]}`}
	}}
	s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	// The fixture's one Vietnamese line stays; English is most of what was said.
	for i := 0; i < 8; i++ {
		line := "Let's agree we ship the release on Friday afternoon, then I will prepare the build and demo it on Monday"
		if _, err := s.AppendTranscript(ctx, ua.ID, m.ID, line, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SummarizeAuto(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(prompt, "Output language: English\n") {
		t.Fatalf("auto summary of an English meeting:\n%.200s", prompt)
	}
}

func TestMeetingLanguage(t *testing.T) {
	seg := func(lang, text string) db.MeetingTranscriptSegment {
		return db.MeetingTranscriptSegment{Language: lang, Text: text}
	}
	en := "we will ship the release on friday and then demo it to the customer on monday morning as agreed today"
	vi := "chúng ta sẽ phát hành vào thứ sáu rồi demo cho khách vào sáng thứ hai như đã thống nhất hôm nay"
	cases := []struct {
		name string
		segs []db.MeetingTranscriptSegment
		chat []db.MeetingChatMessage
		want string
	}{
		{"nothing said", nil, nil, "vi"},
		{"tagged by the recognizer", []db.MeetingTranscriptSegment{seg("en-US", vi), seg("en", vi)}, nil, "en"},
		{"tags win over the words", []db.MeetingTranscriptSegment{seg("vi", en), seg("vi-VN", en), seg("", en)}, nil, "vi"},
		{"English words", []db.MeetingTranscriptSegment{seg("", en)}, nil, "en"},
		{"Vietnamese words", []db.MeetingTranscriptSegment{seg("", vi)}, nil, "vi"},
		{"too few words", []db.MeetingTranscriptSegment{seg("", "ok thanks")}, nil, "vi"},
		{"chat counts", nil, []db.MeetingChatMessage{{Message: en}}, "en"},
	}
	for _, c := range cases {
		if got := meetingLanguage(c.segs, nil, c.chat); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

func TestSplitSummaryTranscript(t *testing.T) {
	lines := func(n, size int) []ai.TranscriptLine {
		out := make([]ai.TranscriptLine, n)
		for i := range out {
			out[i] = ai.TranscriptLine{Label: fmt.Sprint(i), Speaker: "A", Text: strings.Repeat("x", size-4)}
		}
		return out
	}
	if chunks, cut := splitSummaryTranscript(lines(10, 100), 1000, 4); len(chunks) != 1 || len(chunks[0]) != 10 || cut {
		t.Fatalf("fits: %d chunks, cut %v", len(chunks), cut)
	}
	if chunks, cut := splitSummaryTranscript(nil, 1000, 4); len(chunks) != 1 || len(chunks[0]) != 0 || cut {
		t.Fatalf("empty: %d chunks", len(chunks))
	}
	chunks, cut := splitSummaryTranscript(lines(25, 100), 1000, 4)
	total := 0
	for _, c := range chunks {
		size := 0
		for _, l := range c {
			size += summaryLineRunes(l)
		}
		if size > 1000 {
			t.Fatalf("a chunk of %d runes is over the budget", size)
		}
		total += len(c)
	}
	if len(chunks) != 3 || total != 25 || cut {
		t.Fatalf("2.5 budgets: %d chunks, %d lines, cut %v", len(chunks), total, cut)
	}
	chunks, cut = splitSummaryTranscript(lines(100, 100), 1000, 4)
	if len(chunks) > 4 || !cut {
		t.Fatalf("10 budgets in 4 parts: %d chunks, cut %v", len(chunks), cut)
	}
}

// The run's own deadline (its lease minus a minute) covers the calls a long
// meeting makes one after another at the summary's per-call timeout: the map
// step's rounds and the combining call. At the smallest budget it used to be
// 5 minutes for up to three 3-minute calls.
func TestSummaryRunDeadlineFitsEveryCall(t *testing.T) {
	s := &MeetingService{AI: ai.NewGateway(nil, &provider.Fake{}, nil, nil, ai.Options{Timeout: time.Minute})}
	call := s.AI.CallTimeoutFor(ai.CapMeetingSummarization)
	rounds := (summaryMaxParts+summaryPartConcurrency-1)/summaryPartConcurrency + 1
	for _, runes := range []int{0, 240000} {
		s.rt.SummaryMaxRunes = runes
		if b := s.summaryBudget(); b.lease-time.Minute < time.Duration(rounds)*call {
			t.Errorf("max runes %d: run deadline %s for %d calls of %s", runes, b.lease-time.Minute, rounds, call)
		}
	}
}
