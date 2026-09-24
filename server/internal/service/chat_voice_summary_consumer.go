package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// ChatVoiceSummaryConsumer posts AI summaries after completed voice calls (C-13.8).
type ChatVoiceSummaryConsumer struct {
	chat *ChatService
}

func NewChatVoiceSummaryConsumer(chat *ChatService) *ChatVoiceSummaryConsumer {
	return &ChatVoiceSummaryConsumer{chat: chat}
}

func (*ChatVoiceSummaryConsumer) Name() string { return "chat_voice_summary" }

func (*ChatVoiceSummaryConsumer) Topics() []string {
	return []string{"chat.voice.call.completed"}
}

func (c *ChatVoiceSummaryConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("chat_voice_summary: payload of %s: %w", ev.ID, err)
		}
	}
	if strings.TrimSpace(payload["organization_id"]) == "" && ev.OrganizationID.Valid {
		payload["organization_id"] = strings.TrimSpace(ev.OrganizationID.String)
	}
	if strings.TrimSpace(payload["workspace_id"]) == "" && ev.WorkspaceID.Valid {
		payload["workspace_id"] = strings.TrimSpace(ev.WorkspaceID.String)
	}
	return c.chat.HandleVoiceCallCompleted(ctx, payload)
}
