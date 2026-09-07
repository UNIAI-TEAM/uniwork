package service

import (
	"context"
	"strings"
)

func (s *ChatService) ChatMediaTenorEnabled() bool {
	return strings.TrimSpace(s.TenorAPIKey) != ""
}

func (s *ChatService) ChatMediaStatus(ctx context.Context, ownerID, workspaceID string) (bool, error) {
	if _, err := s.workspaceForChat(ctx, ownerID, workspaceID); err != nil {
		return false, err
	}
	return s.ChatMediaTenorEnabled(), nil
}
