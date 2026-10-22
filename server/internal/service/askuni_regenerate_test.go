package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
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
