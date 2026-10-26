package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

func dockAsk(c *ctxWorld, in AskInput) (AskResult, error) {
	in.Dock, in.Locale = true, "vi"
	return c.s.Ask(context.Background(), c.x.ua.ID, c.x.w.ID, in)
}

func isInvalid(err error) bool {
	var v ValidationError
	return errors.As(err, &v)
}

func TestDockTurnStoresItsContext(t *testing.T) {
	c := newCtxWorld(t)
	scriptAgent(c.fake, "x", "Xong [S1]")
	res, err := dockAsk(c, AskInput{Question: "Tóm tắt", Focus: &ai.Focus{Kind: "task", ID: c.task}, Mentions: []ai.Focus{{Kind: "member", ID: c.x.ub.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := c.s.q.AiListMessages(context.Background(), res.ConversationID)
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows=%d err=%v", len(rows), err)
	}
	var focus AskContextRef
	var mentions []AskContextRef
	if err := json.Unmarshal([]byte(rows[0].Focus.String), &focus); err != nil || focus.Kind != "task" || focus.ID != c.task || !strings.Contains(focus.Title, "Chuẩn bị báo cáo quý") {
		t.Fatalf("focus %q", rows[0].Focus.String)
	}
	if err := json.Unmarshal([]byte(rows[0].Mentions), &mentions); err != nil || len(mentions) != 1 || mentions[0] != (AskContextRef{Kind: "member", ID: c.x.ub.ID, Title: c.x.ub.DisplayName}) {
		t.Fatalf("mentions %q", rows[0].Mentions)
	}
}

func TestRegenerateReplacesTheLastAnswerWithItsContext(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	scriptAgent(c.fake, "x", "Câu trả lời cũ [S1]")
	first, err := dockAsk(c, AskInput{Question: "Câu hỏi gốc", Focus: &ai.Focus{Kind: "task", ID: c.task}, Mentions: []ai.Focus{{Kind: "project", ID: c.project}}})
	if err != nil {
		t.Fatal(err)
	}
	reqs := scriptAgent(c.fake, "x", "Câu trả lời mới [S1]")
	res, err := dockAsk(c, AskInput{ConversationID: first.ConversationID, Question: "khác", Regenerate: first.Message.ID})
	if err != nil {
		t.Fatal(err)
	}
	msgs := (*reqs)[0].Messages
	prompt := msgs[len(msgs)-1].Content
	if !strings.Contains(prompt, "Câu hỏi gốc") || strings.Contains(prompt, "khác") ||
		!strings.Contains(block(prompt, "S1"), "Chuẩn bị báo cáo quý") || !strings.Contains(block(prompt, "S2"), "Website mới") {
		t.Fatalf("prompt:\n%s", prompt)
	}
	for _, m := range msgs[:len(msgs)-1] {
		if strings.Contains(m.Content, "Câu trả lời cũ") || strings.Contains(m.Content, "Câu hỏi gốc") {
			t.Fatalf("history holds the replaced turn: %q", m.Content)
		}
	}
	rows, err := c.s.q.AiListMessages(ctx, first.ConversationID)
	if err != nil || len(rows) != 2 || rows[0].Content != "Câu hỏi gốc" || rows[1].ID != res.Message.ID || rows[1].Content != "Câu trả lời mới [S1]" {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
}

func TestRegenerateRefusesAnOlderAnswer(t *testing.T) {
	c := newCtxWorld(t)
	scriptAgent(c.fake, "x", "một")
	first, err := dockAsk(c, AskInput{Question: "lượt 1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dockAsk(c, AskInput{ConversationID: first.ConversationID, Question: "lượt 2"}); err != nil {
		t.Fatal(err)
	}
	calls := c.fake.Calls
	_, err = dockAsk(c, AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID})
	if !isInvalid(err) || err.Error() != "regenerate: not the last answer" || c.fake.Calls != calls {
		t.Fatalf("err %v, calls %d", err, c.fake.Calls-calls)
	}
}

func TestRegenerateRefusesAMessageOfAnotherConversation(t *testing.T) {
	c := newCtxWorld(t)
	scriptAgent(c.fake, "x", "một")
	a, err := dockAsk(c, AskInput{Question: "hội thoại A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := dockAsk(c, AskInput{Question: "hội thoại B"})
	if err != nil {
		t.Fatal(err)
	}
	calls := c.fake.Calls
	for _, id := range []string{a.Message.ID, "01NOSUCHMESSAGE0000000000000"} {
		_, err = dockAsk(c, AskInput{ConversationID: b.ConversationID, Regenerate: id})
		if !isInvalid(err) || err.Error() != "regenerate: not the last answer" || c.fake.Calls != calls {
			t.Fatalf("id %s: err %v, calls %d", id, err, c.fake.Calls-calls)
		}
	}
	// Someone else's conversation reads as absent, whatever the message id.
	if _, err := c.s.Ask(context.Background(), c.x.ub.ID, c.x.w.ID, AskInput{Dock: true, ConversationID: b.ConversationID, Regenerate: b.Message.ID}); !errors.Is(err, ErrNotFound) || c.fake.Calls != calls {
		t.Fatalf("err %v", err)
	}
	rows, _ := c.s.q.AiListMessages(context.Background(), a.ConversationID)
	if len(rows) != 2 {
		t.Fatalf("A's rows changed: %d", len(rows))
	}
}

func TestRegenerateNeedsTheDock(t *testing.T) {
	c := newCtxWorld(t)
	scriptAgent(c.fake, "x", "một")
	first, err := dockAsk(c, AskInput{Question: "hỏi"})
	if err != nil {
		t.Fatal(err)
	}
	calls := c.fake.Calls
	_, err = c.s.Ask(context.Background(), c.x.ua.ID, c.x.w.ID, AskInput{ConversationID: first.ConversationID, Question: "hỏi", Regenerate: first.Message.ID})
	if !isInvalid(err) || c.fake.Calls != calls {
		t.Fatalf("err %v", err)
	}
}

func TestRegenerateKeepsEarlierTurnsInHistory(t *testing.T) {
	c := newCtxWorld(t)
	scriptAgent(c.fake, "x", "Trả lời một")
	first, err := dockAsk(c, AskInput{Question: "Hỏi một"})
	if err != nil {
		t.Fatal(err)
	}
	scriptAgent(c.fake, "x", "Trả lời hai cũ")
	second, err := dockAsk(c, AskInput{ConversationID: first.ConversationID, Question: "Hỏi hai"})
	if err != nil {
		t.Fatal(err)
	}
	reqs := scriptAgent(c.fake, "x", "Trả lời hai mới")
	if _, err := dockAsk(c, AskInput{ConversationID: first.ConversationID, Regenerate: second.Message.ID}); err != nil {
		t.Fatal(err)
	}
	msgs := (*reqs)[0].Messages
	var hist strings.Builder
	for _, m := range msgs[:len(msgs)-1] {
		hist.WriteString(m.Content)
	}
	h := hist.String()
	if !strings.Contains(h, "Hỏi một") || !strings.Contains(h, "Trả lời một") || strings.Contains(h, "Trả lời hai cũ") || strings.Contains(h, "Hỏi hai") {
		t.Fatalf("history:\n%s", h)
	}
	if last := msgs[len(msgs)-1].Content; !strings.Contains(last, "Hỏi hai") {
		t.Fatalf("question missing:\n%s", last)
	}
}

// A regenerate that loses to a newer answer while its model call runs ends
// with an error and no done frame, is reported rejected, and leaves one answer.
func TestRegenerateLostRaceEndsWithoutDone(t *testing.T) {
	c := newCtxWorld(t)
	m := &agentMetricsFake{}
	c.s.SetAgentMetrics(m)
	scriptAgent(c.fake, "x", "một")
	first, err := dockAsk(c, AskInput{Question: "hỏi"})
	if err != nil {
		t.Fatal(err)
	}
	inner := scriptAgent(c.fake, "x", "thua")
	reply := c.fake.Reply
	c.fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if len(*inner) == 0 { // the rival regenerate stores first
			if _, err := c.s.store(context.Background(), c.x.w.OrganizationID, first.ConversationID, askTurn{Answer: "thắng", Regenerates: first.Message.ID}); err != nil {
				t.Error(err)
			}
		}
		return reply(req)
	}
	var events []AskEvent
	in := AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Dock: true, Locale: "vi"}
	_, err = c.s.AskStream(context.Background(), c.x.ua.ID, c.x.w.ID, in, collectEvents(&events))
	if !isInvalid(err) || slices.Contains(eventNames(events), "done") {
		t.Fatalf("err %v events %v", err, eventNames(events))
	}
	if len(m.runs) == 0 || !strings.HasPrefix(m.runs[len(m.runs)-1], "rejected/") {
		t.Fatalf("runs %v", m.runs)
	}
	rows, _ := c.s.q.AiListMessages(context.Background(), first.ConversationID)
	if len(rows) != 2 || rows[1].Content != "thắng" {
		t.Fatalf("rows %+v", rows)
	}
}

// A regenerate that ends with no answer keeps the answer it was to replace:
// nothing is stored or superseded, the stream ends with the error and no
// done, and the calls it made stay billed.
func TestFailedRegenerateKeepsTheOldAnswer(t *testing.T) {
	for name, c := range map[string]struct {
		// fail answers the regenerate's second call (the one after the
		// search) without an answer; it may cancel the request through stop.
		fail func(f *provider.Fake, stop func(), search provider.CompletionResponse) provider.CompletionResponse
		want error
	}{
		"model call fails": {func(f *provider.Fake, _ func(), _ provider.CompletionResponse) provider.CompletionResponse {
			f.Err = errors.New("vendor 503")
			return provider.CompletionResponse{}
		}, ai.ErrProviderError},
		"refused": {func(f *provider.Fake, _ func(), _ provider.CompletionResponse) provider.CompletionResponse {
			f.Err = provider.ErrRefused // billed, like Anthropic's stop_reason refusal
			return provider.CompletionResponse{UsagePresent: true, InputTokens: 9, OutputTokens: 1, StopReason: "refusal"}
		}, ai.ErrRefused},
		"stopped before any text": {func(_ *provider.Fake, stop func(), answer provider.CompletionResponse) provider.CompletionResponse {
			stop() // the stream sees the cancel before its first delta
			return answer
		}, nil},
	} {
		t.Run(name, func(t *testing.T) {
			w := newCtxWorld(t)
			ctx := context.Background()
			scriptAgent(w.fake, "x", "Câu trả lời cũ")
			first, err := dockAsk(w, AskInput{Question: "Câu hỏi gốc"})
			if err != nil {
				t.Fatal(err)
			}
			runCtx, stop := context.WithCancel(ctx)
			defer stop()
			scriptAgent(w.fake, "x", "Câu trả lời mới")
			search, calls := w.fake.Reply, 0
			w.fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
				if calls++; calls == 2 {
					return c.fail(w.fake, stop, search(req))
				}
				return search(req)
			}
			before := usageRows(t, w.s, w.x.w.OrganizationID)
			var events []AskEvent
			in := AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Dock: true, Locale: "vi"}
			_, err = w.s.AskStream(runCtx, w.x.ua.ID, w.x.w.ID, in, collectEvents(&events))
			if err == nil || (c.want != nil && !errors.Is(err, c.want)) || slices.Contains(eventNames(events), "done") {
				t.Fatalf("err %v, events %v", err, eventNames(events))
			}
			assertOnlyAnswer(t, w.s, first.ConversationID, first.Message.ID)
			if after := usageRows(t, w.s, w.x.w.OrganizationID); after <= before {
				t.Fatalf("usage rows %d -> %d, want the regenerate's calls kept", before, after)
			}
		})
	}
}

// An answer round that stays malformed after its retry keeps the old answer too.
func TestMalformedRegenerateKeepsTheOldAnswer(t *testing.T) {
	w := newCtxWorld(t)
	scriptAgent(w.fake, "x", "Câu trả lời cũ")
	first, err := dockAsk(w, AskInput{Question: "Câu hỏi gốc"})
	if err != nil {
		t.Fatal(err)
	}
	scriptAgent(w.fake, "x", "") // empty, and the retry asks for a tool again
	var events []AskEvent
	in := AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Dock: true, Locale: "vi"}
	if _, err = w.s.AskStream(context.Background(), w.x.ua.ID, w.x.w.ID, in, collectEvents(&events)); !errors.Is(err, ai.ErrOutputInvalid) || slices.Contains(eventNames(events), "done") {
		t.Fatalf("err %v, events %v", err, eventNames(events))
	}
	assertOnlyAnswer(t, w.s, first.ConversationID, first.Message.ID)
}

// assertOnlyAnswer holds that the conversation's one assistant row, superseded
// or not, is id and still live.
func assertOnlyAnswer(t *testing.T, s *AskUNIService, convID, id string) {
	t.Helper()
	var n, live int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*), count(*) FILTER (WHERE id = $2 AND superseded_at IS NULL) FROM ai_messages WHERE conversation_id = $1 AND role = 'assistant'`,
		convID, id).Scan(&n, &live); err != nil {
		t.Fatal(err)
	}
	if n != 1 || live != 1 {
		t.Fatalf("assistant rows %d, old answer live %d; want only the old answer, live", n, live)
	}
}

func usageRows(t *testing.T, s *AskUNIService, orgID string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM ai_usage_events WHERE organization_id = $1`, orgID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A source only the replaced answer cited is new again to the next turn, so
// its sources frame announces it for the live answer's chips.
func TestRegenerateForgetsTheReplacedAnswersSources(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	ask := func(in AskInput) ([]AskEvent, AskResult) {
		t.Helper()
		var events []AskEvent
		in.Dock, in.Locale = true, "vi"
		res, err := s.AskStream(context.Background(), ua.ID, w.ID, in, collectEvents(&events))
		if err != nil {
			t.Fatal(err)
		}
		return events, res
	}
	scriptAgent(fake, "banner", "Có [S1]")
	_, first := ask(AskInput{Question: "Banner tới đâu?"})
	scriptAgent(fake, "banner", "Không nói tới việc nào")
	ask(AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID})
	scriptAgent(fake, "banner", "Vẫn là [S1]")
	events, _ := ask(AskInput{ConversationID: first.ConversationID, Question: "Còn banner?"})
	for _, e := range events {
		for _, c := range e.Sources {
			if c.Title == "Banner Tết" {
				return
			}
		}
	}
	t.Fatalf("no sources frame named the task: %v", eventNames(events))
}
