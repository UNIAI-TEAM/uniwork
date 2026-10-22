package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func storeFixture(t *testing.T) (*AskUNIService, string, string, string) {
	t.Helper()
	s, _, ua, _, w := askFixture(t)
	conv, err := s.q.AiCreateConversation(context.Background(), db.AiCreateConversationParams{ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	return s, w.OrganizationID, conv.ID, ua.ID
}

func TestStoreKeepsStepsFollowupsAndContext(t *testing.T) {
	s, org, conv, _ := storeFixture(t)
	ctx := context.Background()
	_, err := s.store(ctx, org, conv, askTurn{
		Question: "q", Answer: "a",
		Focus:     &AskContextRef{Kind: "task", ID: "T1", Title: "Fix"},
		Mentions:  []AskContextRef{{Kind: "doc", ID: "D1", Title: "Spec"}},
		Steps:     []AskStep{{Tool: "search", Label: "Searched", Counts: map[string]int{"tasks": 2}}},
		Followups: []string{"next?"},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.q.AiListMessages(ctx, conv)
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows=%d err=%v", len(rows), err)
	}
	q, a := rows[0], rows[1]
	if q.Focus.String != `{"kind":"task","id":"T1","title":"Fix"}` || q.Mentions != `[{"kind":"doc","id":"D1","title":"Spec"}]` {
		t.Fatalf("question focus=%q mentions=%q", q.Focus.String, q.Mentions)
	}
	if a.Steps != `[{"tool":"search","label":"Searched","counts":{"tasks":2}}]` || a.Followups != `["next?"]` || a.Focus.Valid {
		t.Fatalf("answer steps=%q followups=%q focus=%v", a.Steps, a.Followups, a.Focus)
	}
}

func TestStoreRegenerateSupersedesWithoutANewQuestion(t *testing.T) {
	s, org, conv, _ := storeFixture(t)
	ctx := context.Background()
	first, err := s.store(ctx, org, conv, askTurn{Question: "q", Answer: "old"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.store(ctx, org, conv, askTurn{Question: "q", Answer: "new", Regenerates: first.ID}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.q.AiListMessages(ctx, conv)
	if err != nil || len(rows) != 2 || rows[0].Role != "user" || rows[1].Content != "new" {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	old, err := s.q.AiGetMessageInConversation(ctx, db.AiGetMessageInConversationParams{ID: first.ID, ConversationID: conv})
	if err != nil || !old.SupersededAt.Valid {
		t.Fatalf("old=%+v err=%v", old, err)
	}
}

func TestRenameMarksTheTitleTheUsers(t *testing.T) {
	s, _, conv, user := storeFixture(t)
	ctx := context.Background()
	c, err := s.RenameConversation(ctx, user, conv, "Mine")
	if err != nil || c.TitleSource != "user" {
		t.Fatalf("conv=%+v err=%v", c, err)
	}
	n, err := s.q.AiSetGeneratedTitle(ctx, db.AiSetGeneratedTitleParams{ID: conv, Title: "Generated"})
	if err != nil || n != 0 {
		t.Fatalf("rows=%d err=%v", n, err)
	}
	got, err := s.q.AiGetConversation(ctx, conv)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Mine" {
		t.Fatalf("title=%q", got.Title)
	}
}

func TestStoreRegenerateKeepsTheTitle(t *testing.T) {
	s, org, conv, _ := storeFixture(t)
	ctx := context.Background()
	first, err := s.store(ctx, org, conv, askTurn{Question: "original question", Answer: "old"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.store(ctx, org, conv, askTurn{Answer: "new", Regenerates: first.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := s.q.AiGetConversation(ctx, conv)
	if err != nil || got.Title != "original question" {
		t.Fatalf("title=%q err=%v", got.Title, err)
	}
}
