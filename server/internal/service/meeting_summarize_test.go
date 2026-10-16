package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// summaryMetrics records what Summarize counts.
type summaryMetrics struct {
	mu      sync.Mutex
	events  []string
	reasons []string
}

func (m *summaryMetrics) IncJoinDecision(string) {}
func (m *summaryMetrics) IncWebhookReceived()    {}
func (m *summaryMetrics) IncWebhookDuplicate()   {}
func (m *summaryMetrics) IncWebhookProcessed()   {}
func (m *summaryMetrics) IncWebhookErrors()      {}
func (m *summaryMetrics) IncOutboxDone()         {}
func (m *summaryMetrics) IncOutboxRetry()        {}
func (m *summaryMetrics) IncOutboxDeadLetter()   {}
func (m *summaryMetrics) IncProviderDesync()     {}
func (m *summaryMetrics) IncSummaryError(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reasons = append(m.reasons, reason)
}
func (m *summaryMetrics) Inc(event string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
}

// summaryFixture is a meeting in progress with one transcript line, hosted by
// ua, and a gateway on the given fake provider.
func summaryFixture(t *testing.T, fake *provider.Fake, opts ai.Options) (*MeetingService, db.User, db.Meeting, *summaryMetrics) {
	t.Helper()
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	met := &summaryMetrics{}
	s.SetMeetingMetrics(met)
	if fake != nil {
		s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, opts)
	}
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Họp tuần")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendTranscript(ctx, ua.ID, m.ID, "Chốt ship vào thứ Sáu", time.Time{}); err != nil {
		t.Fatal(err)
	}
	return s, ua, m, met
}

func countSummaryRows(t *testing.T, s *MeetingService, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// UNI-1853 M13/M22/L2: every way the model side can fail answers a fixed
// refusal the client translates, never the cause's text; stores no summary,
// no audit row and no event; leaves the usage row settled the way the
// gateway settled it; and counts summary_error with its reason.
func TestSummarizeFailuresAnswerFixedCodes(t *testing.T) {
	const secret = "pgx: password=hunter2 detail"
	cases := []struct {
		name       string
		fake       *provider.Fake
		opts       ai.Options
		status     int
		code       string
		reason     string
		usage      string // status of the newest meeting_summarization usage row; "" = none
		usageCode  string
		retryAfter int
	}{
		{name: "not configured", status: http.StatusServiceUnavailable, code: "ai_not_configured", reason: summaryReasonNotConfigured},
		{name: "provider error", fake: &provider.Fake{Err: errors.New(secret)},
			status: http.StatusBadGateway, code: "ai_failed", reason: summaryReasonProvider, usage: "failed", usageCode: "ai_provider_error"},
		{name: "timeout", fake: &provider.Fake{Delay: 5 * time.Second}, opts: ai.Options{Timeout: 50 * time.Millisecond},
			status: http.StatusGatewayTimeout, code: "ai_timeout", reason: summaryReasonTimeout, usage: "failed", usageCode: "ai_provider_timeout"},
		{name: "vendor rate limit", fake: &provider.Fake{Err: &provider.StatusError{Status: http.StatusTooManyRequests, RetryAfter: 7 * time.Second}},
			status: http.StatusTooManyRequests, code: "ai_rate_limited", reason: summaryReasonRateLimited, usage: "failed", usageCode: "ai_rate_limited", retryAfter: 7},
		{name: "malformed json", fake: &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{Text: `{"summary": "cut off` + secret, Model: "fake", InputTokens: 10, OutputTokens: 5}
		}}, status: http.StatusBadGateway, code: "ai_failed", reason: summaryReasonParse, usage: "succeeded"},
		{name: "empty output", fake: &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{Text: "  ", Model: "fake", InputTokens: 10}
		}}, status: http.StatusBadGateway, code: "ai_failed", reason: summaryReasonEmpty, usage: "succeeded"},
		{name: "empty object", fake: &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{Text: `{"summary":"","decisions":[],"action_items":[]}`, Model: "fake", InputTokens: 10}
		}}, status: http.StatusBadGateway, code: "ai_failed", reason: summaryReasonEmpty, usage: "succeeded"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, ua, m, met := summaryFixture(t, c.fake, c.opts)
			ctx := context.Background()
			_, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != c.code || ce.Status != c.status {
				t.Fatalf("err = %#v, want %d %s", err, c.status, c.code)
			}
			if strings.Contains(ce.Msg, "hunter2") || strings.Contains(ce.Msg, "pgx") || ce.Msg == "" {
				t.Fatalf("message %q must be fixed and must not quote the cause", ce.Msg)
			}
			if c.retryAfter != 0 && ce.Fields["retry_after"] != c.retryAfter {
				t.Fatalf("fields = %v, want retry_after %d carried through", ce.Fields, c.retryAfter)
			}
			if n := countSummaryRows(t, s, `SELECT count(*) FROM meeting_summaries WHERE meeting_id = $1`, m.ID); n != 0 {
				t.Fatalf("%d summary rows stored after a failure", n)
			}
			if n := countSummaryRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1`, audit.ActionMeetingSummaryCreated); n != 0 {
				t.Fatalf("%d summary audit rows after a failure", n)
			}
			if n := countSummaryRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'summary.created'`); n != 0 {
				t.Fatalf("%d summary.created events after a failure", n)
			}
			var status, reasonCode string
			err = s.pool.QueryRow(ctx, `SELECT status, coalesce(reason_code, '') FROM ai_usage_events
				WHERE organization_id = $1 AND capability = 'meeting_summarization' ORDER BY created_at DESC LIMIT 1`, m.OrganizationID).Scan(&status, &reasonCode)
			switch {
			case c.usage == "" && err == nil:
				t.Fatalf("usage row %s written without a gateway call", status)
			case c.usage != "" && (err != nil || status != c.usage || reasonCode != c.usageCode):
				t.Fatalf("usage row = %q %q (%v), want %q %q", status, reasonCode, err, c.usage, c.usageCode)
			}
			if len(met.reasons) != 1 || met.reasons[0] != c.reason {
				t.Fatalf("summary error reasons = %v, want [%s]", met.reasons, c.reason)
			}
			if len(met.events) != 1 || met.events[0] != "summary_error" {
				t.Fatalf("lifecycle events = %v, want [summary_error]", met.events)
			}
			// The run lock was given back: the next run is not refused as in progress.
			if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); codedIs(err, "summary_in_progress") {
				t.Fatal("the failed run left the meeting's summary lock held")
			}
		})
	}
}

// UNI-1853 M7: a stored summary carries its meeting.summary_created audit row
// (with the usage row that paid for it), its meeting timeline row and its
// summary.created outbox event, all from the one transaction; nothing is
// published directly any more.
func TestSummarizeRecordsAuditAndEventWithTheSummary(t *testing.T) {
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{
			Text:  `{"summary":"Đã chốt.","decisions":["Ship thứ Sáu"],"action_items":[{"title":"Gửi báo cáo","owner":"B"}]}`,
			Model: "fake", InputTokens: 30, OutputTokens: 20,
		}
	}}
	s, ua, m, met := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	if _, err := s.AddNote(ctx, ua.ID, m.ID, "Nhớ gửi bản nháp"); err != nil {
		t.Fatal(err)
	}
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content; !strings.Contains(prompt, "A: Nhớ gửi bản nháp") {
		t.Fatalf("notes are not rendered with their author: %s", prompt)
	}

	var actorKind, actorID, resourceType, resourceID, workspaceID string
	var metadata []byte
	if err := s.pool.QueryRow(ctx, `SELECT actor_kind, actor_id, resource_type, resource_id, coalesce(workspace_id, ''), metadata
		FROM audit_events WHERE action = $1`, audit.ActionMeetingSummaryCreated).Scan(&actorKind, &actorID, &resourceType, &resourceID, &workspaceID, &metadata); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if actorKind != "human" || actorID != ua.ID || resourceType != "meeting" || resourceID != m.ID || workspaceID != m.WorkspaceID {
		t.Fatalf("audit row = %s %s %s %s %s", actorKind, actorID, resourceType, resourceID, workspaceID)
	}
	var meta map[string]any
	if err := json.Unmarshal(metadata, &meta); err != nil {
		t.Fatal(err)
	}
	if meta["summary_id"] != sum.ID || meta["usage_event_id"] != sum.UsageEventID.String || sum.UsageEventID.String == "" {
		t.Fatalf("audit metadata = %v, want summary %s and usage %s", meta, sum.ID, sum.UsageEventID.String)
	}

	var payload []byte
	if err := s.pool.QueryRow(ctx, `SELECT payload FROM outbox_events WHERE topic = 'summary.created'`).Scan(&payload); err != nil {
		t.Fatalf("summary.created outbox row: %v", err)
	}
	var ev map[string]string
	if err := json.Unmarshal(payload, &ev); err != nil {
		t.Fatal(err)
	}
	if len(ev) != 3 || ev["meeting_id"] != m.ID || ev["summary_id"] != sum.ID || ev["workspace_id"] != m.WorkspaceID {
		t.Fatalf("summary.created payload = %v, want ids only", ev)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'SUMMARY_CREATED' AND to_state = $2`, m.ID, sum.ID); n != 1 {
		t.Fatalf("meeting timeline rows = %d, want 1", n)
	}
	if len(met.events) != 1 || met.events[0] != "summary_ok" || len(met.reasons) != 0 {
		t.Fatalf("metrics = %v / %v, want one summary_ok", met.events, met.reasons)
	}
}

// UNI-1853 M9: one summary run per meeting at a time, across nodes. A run
// already holding the meeting's lock (here, another connection standing in
// for another API node) makes the next one answer 409 summary_in_progress
// before the model is asked; another meeting is not held up; once the lock is
// given back the meeting summarizes again.
func TestSummarizeIsSingleFlightPerMeeting(t *testing.T) {
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"ok","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Khác")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendTranscript(ctx, ua.ID, other.ID, "Một dòng", time.Time{}); err != nil {
		t.Fatal(err)
	}

	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	holder := db.New(conn)
	if ok, err := holder.MeetingSummaryTryRunLock(ctx, m.ID); err != nil || !ok {
		t.Fatalf("take the lock: %v %v", ok, err)
	}

	_, err = s.Summarize(ctx, ua.ID, m.ID, "vi")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "summary_in_progress" || ce.Status != http.StatusConflict {
		t.Fatalf("second run = %v, want 409 summary_in_progress", err)
	}
	if fake.Calls != 0 {
		t.Fatalf("the refused run still asked the model (%d calls)", fake.Calls)
	}
	if _, err := s.Summarize(ctx, ua.ID, other.ID, "vi"); err != nil {
		t.Fatalf("another meeting is held up by this meeting's lock: %v", err)
	}

	if ok, err := holder.MeetingSummaryRunUnlock(ctx, m.ID); err != nil || !ok {
		t.Fatalf("give the lock back: %v %v", ok, err)
	}
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); err != nil {
		t.Fatalf("after the lock is free: %v", err)
	}
	// The service gave its own lock back too: the holder can take it again.
	if ok, err := holder.MeetingSummaryTryRunLock(ctx, m.ID); err != nil || !ok {
		t.Fatalf("lock still held after a finished run: %v %v", ok, err)
	}
	if _, err := holder.MeetingSummaryRunUnlock(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
}

// A meeting with nothing to read is refused with summary_no_source before
// the model is asked.
func TestSummarizeWithoutSourceIsRefused(t *testing.T) {
	fake := &provider.Fake{}
	s, ua, _, w := meetingFixture(t)
	s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{})
	m, err := s.CreateInstant(context.Background(), ua.ID, w.ID, "Trống")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Summarize(context.Background(), ua.ID, m.ID, "vi")
	if !codedIs(err, "summary_no_source") || fake.Calls != 0 {
		t.Fatalf("err = %v (calls %d), want summary_no_source and no model call", err, fake.Calls)
	}
}

// UNI-1853 M8: the summary capability follows the organization's plan, not
// only the server's AI configuration.
func TestMeetingCapabilitiesFollowThePlan(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	caps, err := s.Capabilities(ctx, ua.ID, w.ID)
	if err != nil || caps.AISummary {
		t.Fatalf("no AI configured: %+v %v, want ai_summary false", caps, err)
	}
	s.AI = ai.NewGateway(s.q, &provider.Fake{}, NewAIQuota(s.ent), nil, ai.Options{})
	if caps, err = s.Capabilities(ctx, ua.ID, w.ID); err != nil || !caps.AISummary {
		t.Fatalf("AI configured, plan includes it: %+v %v, want ai_summary true", caps, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = '{"meeting.ai_summary": false}'::jsonb WHERE organization_id = $1`, w.OrganizationID); err != nil {
		t.Fatal(err)
	}
	if caps, err = s.Capabilities(ctx, ua.ID, w.ID); err != nil || caps.AISummary {
		t.Fatalf("plan without meeting.ai_summary: %+v %v, want ai_summary false", caps, err)
	}
}

// UNI-1853 L3: a transcript line longer than the cap is cut by character,
// so a cut through a multi-byte letter never reaches the insert.
func TestAppendTranscriptCutsByRune(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Dài")
	if err != nil {
		t.Fatal(err)
	}
	long := "a" + strings.Repeat("ệ", transcriptSegmentRunes)
	seg, err := s.AppendTranscript(ctx, ua.ID, m.ID, long, time.Time{})
	if err != nil {
		t.Fatalf("a long Vietnamese line: %v", err)
	}
	if n := utf8.RuneCountInString(seg.Text); n != transcriptSegmentRunes || !utf8.ValidString(seg.Text) {
		t.Fatalf("stored %d runes (valid %v), want %d", n, utf8.ValidString(seg.Text), transcriptSegmentRunes)
	}
}

// UNI-1853 L3: notes carry their author, a huge note is clipped instead of
// crowding out the rest, and what they use is reported so the transcript
// gives it up.
func TestSummaryNoteLinesShareTheBudget(t *testing.T) {
	notes := []db.ListMeetingNotesRow{
		{DisplayName: "Lan", Body: "  Gửi báo cáo  "},
		{DisplayName: "", Body: "Không tên"},
		{DisplayName: "Minh", Body: "   "},
		{DisplayName: "Huy", Body: strings.Repeat("ư", summaryNoteRunes*2)},
	}
	lines, used := summaryNoteLines(notes)
	if len(lines) != 3 || lines[0] != "Lan: Gửi báo cáo" || lines[1] != "Không tên" {
		t.Fatalf("lines = %q", lines)
	}
	if !strings.HasPrefix(lines[2], "Huy: ") || utf8.RuneCountInString(lines[2]) != len("Huy: ")+summaryNoteRunes {
		t.Fatalf("the long note is not clipped to %d runes: %d", summaryNoteRunes, utf8.RuneCountInString(lines[2]))
	}
	want := 0
	for _, l := range lines {
		want += utf8.RuneCountInString(l) + 1
	}
	if used != want {
		t.Fatalf("used = %d, want %d", used, want)
	}

	many := make([]db.ListMeetingNotesRow, 0, 40)
	for i := 0; i < 40; i++ {
		many = append(many, db.ListMeetingNotesRow{DisplayName: "Lan", Body: strings.Repeat("x", 1000)})
	}
	lines, used = summaryNoteLines(many)
	if used > summaryNotesRunes+64 || len(lines) >= 40 || !strings.Contains(strings.Join(lines, "\n"), "lines omitted") {
		t.Fatalf("notes past the budget: %d lines, %d runes (budget %d)", len(lines), used, summaryNotesRunes)
	}
}
