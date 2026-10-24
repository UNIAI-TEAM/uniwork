package handler

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// chatPresenceSignaler adapts ChatService for inbound WS presence.beat frames.
type chatPresenceSignaler struct {
	chat *service.ChatService
}

func (a chatPresenceSignaler) SignalPresence(
	ctx context.Context,
	userID, workspaceID, state string,
	visible bool,
) ([]string, error) {
	return a.chat.SignalPresence(ctx, userID, workspaceID, state, visible)
}

// ChatPresenceSignaler returns the hub-facing adapter for chat presence beats.
func ChatPresenceSignaler(chat *service.ChatService) realtime.PresenceSignaler {
	return chatPresenceSignaler{chat: chat}
}
