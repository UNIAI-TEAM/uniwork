package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func collectEvents(events *[]AskEvent) AskSink {
	return func(e AskEvent) { *events = append(*events, e) }
}

func eventNames(events []AskEvent) []string {
	names := []string{}
	for _, e := range events {
		names = append(names, e.Name)
	}
	return names
}

func messageCount(t *testing.T, s *AskUNIService, convID string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM ai_messages WHERE conversation_id = $1`, convID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAskStreamEmitsNothingBeforeChecks(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	ctx := context.Background()
	mine, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	addMember(t, s.meetings, w.ID, ub.ID)
	outsider := db.User{ID: util.NewID()}
	before := messageCount(t, s, mine.ConversationID)

	cases := []struct {
		name       string
		user       string
		ws         string
		in         AskInput
		want       error
		validation bool
	}{
		{"empty question", ua.ID, w.ID, AskInput{Question: "  "}, nil, true},
		{"not a member", outsider.ID, w.ID, AskInput{Question: "x"}, ai.ErrContextForbidden, false},
		{"rate limited", ua.ID, w.ID, AskInput{Question: "x"}, ai.ErrRateLimited, false},
		{"someone else's conversation", ub.ID, w.ID, AskInput{ConversationID: mine.ConversationID, Question: "x"}, ErrNotFound, false},
	}
	rdb := uniworkRedis(t)
	key := "uw:ai:ask:" + ua.ID
	t.Cleanup(func() { _ = rdb.Del(context.Background(), key, "uw:ai:ask:org:"+w.OrganizationID).Err() })
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s.rdb = nil
			if c.want == ai.ErrRateLimited {
				s.rdb = rdb
				if err := rdb.Set(ctx, key, askRateLimit, 0).Err(); err != nil {
					t.Fatal(err)
				}
			}
			var events []AskEvent
			_, err := s.AskStream(ctx, c.user, c.ws, c.in, collectEvents(&events))
			var ve ValidationError
			if c.validation && !errors.As(err, &ve) || !c.validation && !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
			if len(events) != 0 {
				t.Fatalf("events before a refusal: %v", eventNames(events))
			}
		})
	}
	if got := messageCount(t, s, mine.ConversationID); got != before {
		t.Fatalf("messages %d -> %d after refusals", before, got)
	}
}

func TestAskStreamP0EmitsRunDeltaCitationsDone(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	if _, err := s.tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Viết spec F-09"}); err != nil {
		t.Fatal(err)
	}
	var events []AskEvent
	res, err := s.AskStream(ctx, ua.ID, w.ID, AskInput{Question: "spec F-09", Locale: "vi"}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"run", "delta", "citations", "done"}; !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if events[0].Run.ConversationID != res.ConversationID || events[0].Run.RunID != "" {
		t.Fatalf("run %+v", events[0].Run)
	}
	if events[1].Delta != res.Message.Content || events[1].Delta == "" {
		t.Fatalf("delta %q, stored %q", events[1].Delta, res.Message.Content)
	}
	if len(res.Citations) == 0 || !slices.Equal(events[2].Citations, res.Citations) {
		t.Fatalf("citations %+v vs %+v", events[2].Citations, res.Citations)
	}
	if events[3].Done == nil || events[3].Done.Message.ID != res.Message.ID {
		t.Fatalf("done %+v", events[3].Done)
	}
	if res.Usage.InputTokens == 0 || res.Usage.InputTokens != res.InputTokens || res.Usage.OutputTokens != res.OutputTokens {
		t.Fatalf("usage %+v vs %d/%d", res.Usage, res.InputTokens, res.OutputTokens)
	}
}

func TestAskStreamAgentEmitsRunFirstWithItsRunID(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	scriptAgent(fake, "banner", "Xong [S1]")
	var events []AskEvent
	res, err := s.AskStream(context.Background(), ua.ID, w.ID, AskInput{Question: "Banner tới đâu?", Locale: "vi"}, collectEvents(&events))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"run", "delta", "citations", "done"}; !slices.Equal(eventNames(events), want) {
		t.Fatalf("events %v, want %v", eventNames(events), want)
	}
	if res.RunID == "" || events[0].Run.RunID != res.RunID {
		t.Fatalf("run %+v, result run id %q", events[0].Run, res.RunID)
	}
	if res.Usage.InputTokens != 30 || res.Usage.OutputTokens != 12 { // both calls of scriptAgent
		t.Fatalf("usage %+v, want the sum of the run's calls", res.Usage)
	}
}

func TestAskHistoryUsesTheLatestTurns(t *testing.T) {
	s, fake, ua, _, w := askFixture(t)
	ctx := context.Background()
	conv, err := s.q.AiCreateConversation(ctx, db.AiCreateConversationParams{ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 210 {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		if _, err := s.q.AiInsertMessage(ctx, db.AiInsertMessageParams{
			ID: util.NewID(), OrganizationID: w.OrganizationID, ConversationID: conv.ID, Role: role, Content: fmt.Sprintf("m%03d", i), Citations: "[]",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Việc câu 105"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: conv.ID, Question: "câu 105", Locale: "vi"}); err != nil {
		t.Fatal(err)
	}
	var sent strings.Builder
	for _, m := range fake.Last.Messages {
		sent.WriteString(m.Content)
	}
	if !strings.Contains(sent.String(), "m209") || !strings.Contains(sent.String(), "câu 105") || strings.Contains(sent.String(), "m199") {
		t.Fatalf("history is not the latest turns:\n%s", sent.String())
	}
	rows, err := s.Messages(ctx, ua.ID, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 200 || rows[len(rows)-1].Role != "assistant" || rows[len(rows)-1].Content == "m209" {
		t.Fatalf("%d rows, last %q", len(rows), rows[len(rows)-1].Content)
	}
}

func TestAskStreamAgentOrgCallBudgetRefusesBeforeRun(t *testing.T) {
	s, fake, ua, w := agentAskFixture(t)
	rdb := uniworkRedis(t)
	s.rdb = rdb
	ctx := context.Background()
	key := "uw:ai:ask:org:" + w.OrganizationID
	t.Cleanup(func() { _ = rdb.Del(context.Background(), key, "uw:ai:ask:"+ua.ID).Err() })
	if err := rdb.Set(ctx, key, askAgentOrgCallsPerMinute, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	conv, err := s.q.AiCreateConversation(ctx, db.AiCreateConversationParams{ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	var events []AskEvent
	_, err = s.AskStream(ctx, ua.ID, w.ID, AskInput{ConversationID: conv.ID, Question: "Banner?", Locale: "vi"}, collectEvents(&events))
	if !errors.Is(err, ai.ErrRateLimited) || fake.Calls != 0 {
		t.Fatalf("err %v, provider calls %d", err, fake.Calls)
	}
	if len(events) != 0 || messageCount(t, s, conv.ID) != 0 {
		t.Fatalf("events %v, messages %d; want none", eventNames(events), messageCount(t, s, conv.ID))
	}
}
