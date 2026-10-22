package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func feedbackRows(t *testing.T, s *AskUNIService, convID string) (n int, rating string) {
	t.Helper()
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*), coalesce(max(rating), '') FROM ai_message_feedback WHERE conversation_id = $1`, convID).Scan(&n, &rating); err != nil {
		t.Fatal(err)
	}
	return n, rating
}

func TestAskFeedbackUpsertsOnePerPerson(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	conv, msg := res.ConversationID, res.Message.ID
	if err := s.SetFeedback(ctx, ua.ID, conv, msg, AskFeedbackInput{Rating: "up"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetFeedback(ctx, ua.ID, conv, msg, AskFeedbackInput{Rating: "down", Reason: "wrong_facts", Note: "sai số"}); err != nil {
		t.Fatal(err)
	}
	if n, rating := feedbackRows(t, s, conv); n != 1 || rating != "down" {
		t.Fatalf("rows=%d rating=%q, want one down", n, rating)
	}
	var reason, note string
	if err := s.pool.QueryRow(ctx, `SELECT reason, note FROM ai_message_feedback WHERE message_id = $1`, msg).Scan(&reason, &note); err != nil || reason != "wrong_facts" || note != "sai số" {
		t.Fatalf("reason=%q note=%q err=%v", reason, note, err)
	}
	if err := s.ClearFeedback(ctx, ua.ID, conv, msg); err != nil {
		t.Fatal(err)
	}
	if n, _ := feedbackRows(t, s, conv); n != 0 {
		t.Fatalf("rows after clear = %d", n)
	}
	if err := s.ClearFeedback(ctx, ua.ID, conv, msg); err != nil {
		t.Fatalf("clearing nothing must stay a success: %v", err)
	}
	if err := s.ClearFeedback(ctx, ua.ID, conv, util.NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("clear on a missing message = %v, want ErrNotFound", err)
	}
}

func TestAskFeedbackRefusesOthersAndUserTurns(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	ctx := context.Background()
	mine, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "y"})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Messages(ctx, ua.ID, mine.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	var userTurn string
	for _, r := range rows {
		if r.Role == "user" {
			userTurn = r.ID
		}
	}
	in := AskFeedbackInput{Rating: "up"}
	cases := map[string]error{
		"someone else's conversation": s.SetFeedback(ctx, ub.ID, mine.ConversationID, mine.Message.ID, in),
		"a user turn":                 s.SetFeedback(ctx, ua.ID, mine.ConversationID, userTurn, in),
		"another conversation's turn": s.SetFeedback(ctx, ua.ID, mine.ConversationID, other.Message.ID, in),
		"a missing id":                s.SetFeedback(ctx, ua.ID, mine.ConversationID, util.NewID(), in),
	}
	for name, got := range cases {
		if !errors.Is(got, ErrNotFound) {
			t.Errorf("%s: got %v, want ErrNotFound", name, got)
		}
	}
	if n, _ := feedbackRows(t, s, mine.ConversationID); n != 0 {
		t.Fatalf("refused calls wrote %d rows", n)
	}
}

func TestAskFeedbackValidates(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	bad := []AskFeedbackInput{
		{Rating: ""},
		{Rating: "meh"},
		{Rating: "down", Reason: "boring"},
		{Rating: "down", Note: strings.Repeat("ế", 501)},
	}
	for _, in := range bad {
		err := s.SetFeedback(ctx, ua.ID, res.ConversationID, res.Message.ID, in)
		var v ValidationError
		if !errors.As(err, &v) {
			t.Errorf("%+v: got %v, want a validation error", in, err)
		}
	}
	if err := s.SetFeedback(ctx, ua.ID, res.ConversationID, res.Message.ID, AskFeedbackInput{Rating: "down", Reason: "other", Note: strings.Repeat("ế", 500)}); err != nil {
		t.Fatalf("500 runes must pass: %v", err)
	}
}

func TestRenameConversation(t *testing.T) {
	s, _, ua, ub, w := askFixture(t)
	ctx := context.Background()
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	for _, title := range []string{"", "   ", strings.Repeat("ế", 81)} {
		var v ValidationError
		if _, err := s.RenameConversation(ctx, ua.ID, res.ConversationID, title); !errors.As(err, &v) {
			t.Errorf("%q: got %v, want a validation error", title, err)
		}
	}
	if _, err := s.RenameConversation(ctx, ub.ID, res.ConversationID, "của tôi"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's conversation = %v, want ErrNotFound", err)
	}
	var before time.Time
	if err := s.pool.QueryRow(ctx, `SELECT updated_at FROM ai_conversations WHERE id = $1`, res.ConversationID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	got, err := s.RenameConversation(ctx, ua.ID, res.ConversationID, "  Việc quá hạn  ")
	if err != nil || got.Title != "Việc quá hạn" {
		t.Fatalf("rename = %+v, %v", got, err)
	}
	// A rename must not float an old conversation to the top of the history.
	if !got.UpdatedAt.Time.Equal(before) {
		t.Fatalf("updated_at moved %v -> %v", before, got.UpdatedAt.Time)
	}
	if _, err := s.RenameConversation(ctx, ua.ID, res.ConversationID, strings.Repeat("ế", 80)); err != nil {
		t.Fatalf("80 runes must pass: %v", err)
	}
}

func TestDeleteConversationRemovesItsFeedback(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	ctx := context.Background()
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetFeedback(ctx, ua.ID, res.ConversationID, res.Message.ID, AskFeedbackInput{Rating: "up"}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteConversation(ctx, ua.ID, res.ConversationID); err != nil {
		t.Fatal(err)
	}
	if n, _ := feedbackRows(t, s, res.ConversationID); n != 0 {
		t.Fatalf("%d feedback rows survive the conversation", n)
	}
}
