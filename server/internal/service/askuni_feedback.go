package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AskFeedbackInput is one person's rating of one Ask UNI answer (R14).
type AskFeedbackInput struct {
	Rating string // up | down
	Reason string // "" | wrong_facts | missing_sources | not_helpful | other
	Note   string // at most 500 characters
}

const (
	askFeedbackNoteMax = 500
	askTitleMax        = 80
)

var askFeedbackReasons = map[string]bool{"": true, "wrong_facts": true, "missing_sources": true, "not_helpful": true, "other": true}

// ratedAnswer finds the assistant answer a rating is about. Someone else's
// conversation, another conversation's message, a user turn and a missing id
// all answer ErrNotFound.
func (s *AskUNIService) ratedAnswer(ctx context.Context, userID, conversationID, messageID string) (db.AiConversation, error) {
	conv, err := s.ownConversation(ctx, userID, conversationID, "")
	if err != nil {
		return db.AiConversation{}, err
	}
	m, err := s.q.AiGetMessageInConversation(ctx, db.AiGetMessageInConversationParams{ID: messageID, ConversationID: conversationID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.Role != "assistant") {
		return db.AiConversation{}, ErrNotFound
	}
	return conv, err
}

// SetFeedback rates an answer; a second call by the same person replaces the first.
func (s *AskUNIService) SetFeedback(ctx context.Context, userID, conversationID, messageID string, in AskFeedbackInput) error {
	if in.Rating != "up" && in.Rating != "down" {
		return Invalid("rating phải là up hoặc down")
	}
	if !askFeedbackReasons[in.Reason] {
		return Invalid("reason không hợp lệ")
	}
	if utf8.RuneCountInString(in.Note) > askFeedbackNoteMax {
		return Invalid("ghi chú tối đa 500 ký tự")
	}
	conv, err := s.ratedAnswer(ctx, userID, conversationID, messageID)
	if err != nil {
		return err
	}
	return s.q.AiUpsertMessageFeedback(ctx, db.AiUpsertMessageFeedbackParams{
		ID: util.NewID(), OrganizationID: conv.OrganizationID, WorkspaceID: conv.WorkspaceID,
		ConversationID: conversationID, MessageID: messageID,
		Rating: in.Rating, Reason: in.Reason, Note: in.Note, CreatedBy: userID,
	})
}

// ClearFeedback withdraws the caller's rating; having none is still a success.
func (s *AskUNIService) ClearFeedback(ctx context.Context, userID, conversationID, messageID string) error {
	conv, err := s.ratedAnswer(ctx, userID, conversationID, messageID)
	if err != nil {
		return err
	}
	return s.q.AiClearMessageFeedback(ctx, db.AiClearMessageFeedbackParams{
		OrganizationID: conv.OrganizationID, MessageID: messageID, CreatedBy: userID,
	})
}

// RenameConversation sets the title of the caller's own conversation.
func (s *AskUNIService) RenameConversation(ctx context.Context, userID, conversationID, title string) (db.AiConversation, error) {
	title = strings.TrimSpace(title)
	if n := utf8.RuneCountInString(title); n < 1 || n > askTitleMax {
		return db.AiConversation{}, Invalid("tiêu đề dài 1–80 ký tự")
	}
	if _, err := s.ownConversation(ctx, userID, conversationID, ""); err != nil {
		return db.AiConversation{}, err
	}
	return s.q.AiRenameConversation(ctx, db.AiRenameConversationParams{ID: conversationID, Title: title})
}
