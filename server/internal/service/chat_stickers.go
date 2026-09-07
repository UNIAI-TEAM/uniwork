package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

func (s *ChatService) SearchChatStickers(ctx context.Context, ownerID, workspaceID, query string, limit int) ([]ChatGifItem, error) {
	if _, err := s.workspaceForChat(ctx, ownerID, workspaceID); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return s.TrendingChatStickers(ctx, ownerID, workspaceID, limit)
	}
	if len([]rune(query)) > maxGifSearchLen {
		return nil, Invalid("từ khóa quá dài")
	}
	if strings.TrimSpace(s.TenorAPIKey) == "" {
		return s.offlineChatStickers(query), nil
	}
	return s.fetchTenor(ctx, tenorRequest{
		endpoint:     "search",
		params:       url.Values{"q": {query}, "limit": {fmt.Sprintf("%d", normalizeGifLimit(limit))}},
		mediaFilter:  "webp_transparent,tinywebptransparent,giftransparent,tinygiftransparent",
		searchFilter: "sticker",
		mapItem:      mapTenorSticker,
		fallback:     s.offlineChatStickers(query),
	})
}

func (s *ChatService) TrendingChatStickers(ctx context.Context, ownerID, workspaceID string, limit int) ([]ChatGifItem, error) {
	if _, err := s.workspaceForChat(ctx, ownerID, workspaceID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(s.TenorAPIKey) == "" {
		return s.offlineChatStickers(""), nil
	}
	return s.fetchTenor(ctx, tenorRequest{
		endpoint:     "featured",
		params:       url.Values{"limit": {fmt.Sprintf("%d", normalizeGifLimit(limit))}},
		mediaFilter:  "webp_transparent,tinywebptransparent,giftransparent,tinygiftransparent",
		searchFilter: "sticker",
		mapItem:      mapTenorSticker,
		fallback:     s.offlineChatStickers(""),
	})
}

func mapTenorSticker(id, description string, formats map[string]tenorMediaFormat) ChatGifItem {
	stickerURL := pickTenorFormat(
		formats,
		"webp_transparent",
		"giftransparent",
		"gif",
		"tinywebptransparent",
		"tinygiftransparent",
	)
	previewURL := pickTenorFormat(
		formats,
		"tinywebptransparent",
		"tinygiftransparent",
		"nanogiftransparent",
		"webp_transparent",
		"giftransparent",
	)
	if previewURL == "" {
		previewURL = stickerURL
	}
	label := strings.TrimSpace(description)
	if label == "" {
		label = "sticker"
	}
	return ChatGifItem{
		ID:         id,
		Label:      label,
		URL:        stickerURL,
		PreviewURL: previewURL,
	}
}
