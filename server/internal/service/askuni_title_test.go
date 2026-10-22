package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestCleanTitle(t *testing.T) {
	long := strings.Repeat("ạ", 60)
	for name, c := range map[string]struct{ in, want string }{
		"quotes and newline":   {"\"Việc trễ dự án Q4\"\n", "Việc trễ dự án Q4"},
		"curly and guillemets": {"«“Việc trễ”»", "Việc trễ"},
		"trailing marks":       {"Việc trễ dự án Q4.!?:", "Việc trễ dự án Q4"},
		"inner whitespace":     {"  Việc   trễ \n dự án ", "Việc trễ dự án"},
		"cut to 40 runes":      {long, strings.Repeat("ạ", 40)},
		"quote then dot":       {"\"Việc trễ\".", "Việc trễ"},
		"source ref":           {"Việc [S1] trễ", "Việc trễ"},
		"space after the cut":  {strings.Repeat("a", 39) + " bbb", strings.Repeat("a", 39)},
		"mark after the cut":   {strings.Repeat("a", 39) + ". bbb", strings.Repeat("a", 39)},
		"empty":                {"", ""},
		"blank":                {" \n\t ", ""},
		"only quotes":          {`""`, ""},
	} {
		if got := cleanTitle(c.in); got != c.want {
			t.Errorf("%s: cleanTitle(%q) = %q, want %q", name, c.in, got, c.want)
		}
	}
}

// titleScript answers the title prompt with title (or fails it with err) and
// every other call as scriptAgent does; titleCalls counts the title calls.
func titleScript(fake *provider.Fake, answer, title string, titleErr error) *int {
	scriptAgent(fake, "x", answer)
	inner := fake.Reply
	n := new(int)
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		// Complete returns fake.Err right after Reply, so it is set per call.
		fake.Err = nil
		if strings.Contains(req.System, "Name this conversation") {
			*n++
			fake.Err = titleErr
			return provider.CompletionResponse{Text: title, UsagePresent: true, InputTokens: 3, OutputTokens: 2, StopReason: "end_turn"}
		}
		return inner(req)
	}
	return n
}

func convRow(t *testing.T, s *AskUNIService, id string) db.AiConversation {
	t.Helper()
	conv, err := s.q.AiGetConversation(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return conv
}

func titleUsageRows(t *testing.T, s *AskUNIService, orgID string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM ai_usage_events WHERE organization_id = $1 AND capability = 'copilot_title'`, orgID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestFirstDockAnswerNamesTheConversation(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	titleScript(fake, "Có 1 việc [S1]", `"Banner Tết đến đâu."`, nil)
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu rồi?", Locale: "vi", Dock: true}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	names := eventNames(events)
	if len(names) < 2 || names[len(names)-2] != "done" || names[len(names)-1] != "title" {
		t.Fatalf("events %v", names)
	}
	if ev := events[len(events)-1].Title; ev == nil || ev.ConversationID != res.ConversationID || ev.Title != "Banner Tết đến đâu" {
		t.Fatalf("title event %+v", ev)
	}
	conv := convRow(t, s, res.ConversationID)
	if conv.Title != "Banner Tết đến đâu" || conv.TitleSource != "generated" {
		t.Fatalf("conversation %q / %q", conv.Title, conv.TitleSource)
	}
	if n := titleUsageRows(t, s, w.OrganizationID); n != 1 {
		t.Fatalf("copilot_title usage rows = %d, want 1", n)
	}
}

func TestFakeProviderTitleIsFakeTitle(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "x", "Xong [S1]")
	agentReply := fake.Reply
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if strings.Contains(req.System, "Name this conversation") {
			return ai.FakeReply(req)
		}
		return agentReply(req)
	}
	res, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	if conv := convRow(t, s, res.ConversationID); conv.Title != "Fake title" {
		t.Fatalf("title %q", conv.Title)
	}
}

func TestTitleNeverOverwritesARename(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	titleScript(fake, "Có 1 việc [S1]", "UNI đặt", nil)
	var events []AskEvent
	var convID string
	// The rename lands right after the turn is stored, before the title call.
	sink := func(e AskEvent) {
		events = append(events, e)
		if e.Name == "run" {
			convID = e.Run.ConversationID
		}
		if e.Name == "done" {
			if _, err := s.q.AiRenameConversation(context.Background(), db.AiRenameConversationParams{ID: convID, Title: "Tên của tôi"}); err != nil {
				t.Error(err)
			}
		}
	}
	if _, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu rồi?", Locale: "vi", Dock: true}, sink); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(eventNames(events), "title") {
		t.Fatalf("events %v", eventNames(events))
	}
	if conv := convRow(t, s, convID); conv.Title != "Tên của tôi" || conv.TitleSource != "user" {
		t.Fatalf("conversation %q / %q", conv.Title, conv.TitleSource)
	}
}

func TestTitleFailureKeepsTheQuestion(t *testing.T) {
	for name, c := range map[string]struct {
		title string
		err   error
	}{"gateway error": {"x", errors.New("boom")}, "empty title": {`" . "`, nil}} {
		t.Run(name, func(t *testing.T) {
			s, fake, ua, w := agentAskFixture(t)
			agentTask(t, s, ua, w, "Banner Tết")
			titleScript(fake, "Có 1 việc [S1]", c.title, c.err)
			var events []AskEvent
			question := strings.Repeat("a", 100)
			res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: question, Locale: "vi", Dock: true}, collectEvents(&events))
			if err != nil {
				t.Fatal(err)
			}
			if got := eventNames(events); slices.Contains(got, "error") || slices.Contains(got, "title") || got[len(got)-1] != "done" {
				t.Fatalf("events %v", got)
			}
			if conv := convRow(t, s, res.ConversationID); conv.Title != strings.Repeat("a", 80)+"…" || conv.TitleSource != "question" {
				t.Fatalf("conversation %q / %q", conv.Title, conv.TitleSource)
			}
		})
	}
}

func TestSecondAnswerDoesNotRename(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	calls := titleScript(fake, "Có 1 việc [S1]", "Tên đầu", nil)
	first, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu rồi?", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "Còn gì nữa?", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	if *calls != 1 || titleUsageRows(t, s, w.OrganizationID) != 1 || convRow(t, s, second.ConversationID).Title != "Tên đầu" {
		t.Fatalf("title calls %d", *calls)
	}
}

func TestRegenerateAndNonDockDoNotName(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	calls := titleScript(fake, "Có 1 việc [S1]", "Tên", nil)
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "P0 hỏi", Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	if *calls != 0 {
		t.Fatalf("a non-dock turn named its conversation (%d calls)", *calls)
	}
	// The question's conversation was not named by the dock; make one that has
	// an answer, then regenerate it: the answer exists, so nothing is named.
	first, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Lượt đầu", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	before := *calls
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Locale: "vi", Dock: true}); err != nil {
		t.Fatal(err)
	}
	if *calls != before {
		t.Fatalf("a regenerate named its conversation (%d calls)", *calls-before)
	}
}

func TestNoticeAnswerDoesNotName(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	calls := titleScript(fake, "", "Tên", nil) // an empty answer twice is agent_failed
	res, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Hỏi", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Notice.String == "" || *calls != 0 {
		t.Fatalf("notice %q, title calls %d", res.Message.Notice.String, *calls)
	}
}

func TestTitleCallRunsAfterTheRunSlotIsFree(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	s.agentRuns = newUniworkConcurrency(nil, "ai:ask:", askAgentPodMax, 1, askAgentGlobalMax, time.Minute)
	titleScript(fake, "Có 1 việc [S1]", "Tên", nil)
	inner := fake.Reply
	inTitle, unblock := make(chan struct{}), make(chan struct{})
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if strings.Contains(req.System, "Name this conversation") {
			close(inTitle)
			<-unblock
		}
		return inner(req)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner?", Locale: "vi", Dock: true})
		done <- err
	}()
	<-inTitle
	release, err := s.agentRuns.Acquire(context.Background(), w.OrganizationID)
	if err != nil {
		t.Errorf("the title call holds the organization's run slot: %v", err)
	} else {
		release()
	}
	close(unblock)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestNoticeOnlyFirstTurnLeavesTheNamingToTheNextAnswer(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	answer := ""
	calls := titleScript(fake, "", "Tên sau", nil)
	inner := fake.Reply
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if !strings.Contains(req.System, "Name this conversation") && req.Messages[len(req.Messages)-1].Role != "tool" && answer == "" {
			return provider.CompletionResponse{Text: "", UsagePresent: true, InputTokens: 1, StopReason: "end_turn"}
		}
		return inner(req)
	}
	first, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Lượt một", Locale: "vi", Dock: true})
	if err != nil || first.Message.Notice.String == "" || *calls != 0 {
		t.Fatalf("turn 1: err %v notice %q title calls %d", err, first.Message.Notice.String, *calls)
	}
	answer = "ok"
	scriptAgent(fake, "x", "Có rồi [S1]")
	titleScript(fake, "Có rồi [S1]", "Tên sau", nil)
	res, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "Lượt hai", Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	if conv := convRow(t, s, res.ConversationID); conv.Title != "Tên sau" || conv.TitleSource != "generated" {
		t.Fatalf("conversation %q / %q", conv.Title, conv.TitleSource)
	}
}

// The title call reads the answer with each [S#] replaced by its object's
// title, so the name it gives can name the object; unknown markers go.
func TestTitleCallReadsTheCitedObjectsNames(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "banner", "Tóm tắt [S1] và [S9].")
	inner := fake.Reply
	var seen string
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		fake.Err = nil
		if strings.Contains(req.System, "Name this conversation") {
			seen = req.System
			for _, m := range req.Messages {
				seen += "\n" + m.Content
			}
			return provider.CompletionResponse{Text: "Tên", UsagePresent: true, InputTokens: 3, OutputTokens: 2, StopReason: "end_turn"}
		}
		return inner(req)
	}
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi", Dock: true}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(seen, "Tóm tắt Banner Tết và.") || strings.Contains(seen, "[S1]") || strings.Contains(seen, "[S9]") {
		t.Fatalf("title call read:\n%s", seen)
	}
}

// The asker leaving right after done does not cancel the title call: it is
// billed either way (ruling over T7), so its title is stored; only the frame
// is not sent to a closed stream.
func TestTitleCallOutlivesTheAsker(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	titleScript(fake, "Có 1 việc [S1]", "Tên sau khi rời", nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var events []AskEvent
	sink := func(e AskEvent) {
		events = append(events, e)
		if e.Name == "done" {
			cancel()
		}
	}
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "Banner tới đâu rồi?", Locale: "vi", Dock: true}, sink)
	if err != nil {
		t.Fatal(err)
	}
	if conv := convRow(t, s, res.ConversationID); conv.Title != "Tên sau khi rời" || conv.TitleSource != "generated" {
		t.Fatalf("conversation %q / %q", conv.Title, conv.TitleSource)
	}
	if slices.Contains(eventNames(events), "title") {
		t.Fatalf("events %v: a title frame after the asker left", eventNames(events))
	}
}
