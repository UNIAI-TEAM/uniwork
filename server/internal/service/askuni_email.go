package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
)

// EmailThreadFocusID encodes account and thread for Ask UNI focus (accountID|threadID).
func EmailThreadFocusID(accountID, threadID string) string {
	return accountID + "|" + threadID
}

func splitEmailThreadFocusID(raw string) (accountID, threadID string, ok bool) {
	accountID, threadID, ok = strings.Cut(raw, "|")
	ok = ok && accountID != "" && threadID != ""
	return accountID, threadID, ok
}

func (s *AskUNIService) emailThreadContext(ctx context.Context, tc ai.ToolContext, focusID string) ([]ai.Source, error) {
	if s.emailHub == nil {
		return nil, nil
	}
	accountID, threadID, ok := splitEmailThreadFocusID(focusID)
	if !ok {
		return nil, Invalid("focus email_thread không hợp lệ")
	}
	view, err := s.emailHub.GetThread(ctx, Human(tc.ActorID), tc.WorkspaceID, accountID, threadID, true, false)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	body := imapclient.PlainBodyForAI(view.BodyHTML, view.BodyText, view.Snippet)
	if body == "" {
		body = view.Snippet
	}
	title := strings.TrimSpace(view.Subject)
	if title == "" {
		title = "Email"
	}
	excerpt := body
	if len([]rune(excerpt)) > ai.MaxExcerpt {
		excerpt = string([]rune(excerpt)[:ai.MaxExcerpt])
	}
	return []ai.Source{{
		ID: "S1", Kind: "email_thread", Title: title,
		Href:    fmt.Sprintf("%s/email?thread=%s&account=%s", base, threadID, accountID),
		Excerpt: excerpt,
	}}, nil
}
