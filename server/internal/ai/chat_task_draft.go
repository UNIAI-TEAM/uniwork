package ai

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

// ChatTaskDraft is the structured one-shot draft for creating a task from chat.
type ChatTaskDraft struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
	DueDate     string `json:"due_date"` // YYYY-MM-DD or empty
}

var (
	chatTaskDraftPriorities = map[string]struct{}{
		"none": {}, "low": {}, "medium": {}, "high": {}, "urgent": {},
	}
	chatTaskDraftDueDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// ParseChatTaskDraftJSON parses chat_task_draft model output.
func ParseChatTaskDraftJSON(s string) (ChatTaskDraft, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return ChatTaskDraft{}, ErrOutputInvalid.wrap(err)
	}
	var out ChatTaskDraft
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatTaskDraft{}, ErrOutputInvalid.wrap(err)
	}
	out.Title = strings.TrimSpace(out.Title)
	out.Description = strings.TrimSpace(out.Description)
	out.Priority = strings.TrimSpace(strings.ToLower(out.Priority))
	if _, ok := chatTaskDraftPriorities[out.Priority]; !ok {
		out.Priority = "medium"
	}
	out.DueDate = normalizeChatTaskDraftDueDate(out.DueDate)
	if out.Title == "" {
		return ChatTaskDraft{}, ErrOutputInvalid.wrap(errors.New("empty title"))
	}
	return out, nil
}

func normalizeChatTaskDraftDueDate(raw string) string {
	due := strings.TrimSpace(raw)
	if due == "" || !chatTaskDraftDueDate.MatchString(due) {
		return ""
	}
	if _, err := time.Parse("2006-01-02", due); err != nil {
		return ""
	}
	return due
}
