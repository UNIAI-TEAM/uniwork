package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

const (
	tenorClientKey  = "uniwork"
	defaultGifLimit = 24
	maxGifSearchLen = 64
	tenorLocale     = "vi_VN"
)

var tenorAPIBase = "https://tenor.googleapis.com"

type ChatGifItem struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	URL        string `json:"url"`
	PreviewURL string `json:"preview_url"`
}

type tenorGifResponse struct {
	Results []tenorGifResult `json:"results"`
}

type tenorGifResult struct {
	ID                 string                      `json:"id"`
	ContentDescription string                      `json:"content_description"`
	MediaFormats       map[string]tenorMediaFormat `json:"media_formats"`
}

type tenorMediaFormat struct {
	URL string `json:"url"`
}

func (s *ChatService) SearchChatGifs(ctx context.Context, ownerID, workspaceID, query string, limit int) ([]ChatGifItem, error) {
	if _, err := s.workspaceForChat(ctx, ownerID, workspaceID); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return s.TrendingChatGifs(ctx, ownerID, workspaceID, limit)
	}
	if len([]rune(query)) > maxGifSearchLen {
		return nil, Invalid("từ khóa quá dài")
	}
	if strings.TrimSpace(s.TenorAPIKey) == "" {
		return s.offlineChatGifs(query), nil
	}
	return s.fetchTenor(ctx, tenorRequest{
		endpoint:    "search",
		params:      url.Values{"q": {query}, "limit": {fmt.Sprintf("%d", normalizeGifLimit(limit))}},
		mediaFilter: "gif,tinygif",
		mapItem:     mapTenorGif,
		fallback:    s.offlineChatGifs(query),
	})
}

func (s *ChatService) TrendingChatGifs(ctx context.Context, ownerID, workspaceID string, limit int) ([]ChatGifItem, error) {
	if _, err := s.workspaceForChat(ctx, ownerID, workspaceID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(s.TenorAPIKey) == "" {
		return s.offlineChatGifs(""), nil
	}
	return s.fetchTenor(ctx, tenorRequest{
		endpoint:    "featured",
		params:      url.Values{"limit": {fmt.Sprintf("%d", normalizeGifLimit(limit))}},
		mediaFilter: "gif,tinygif",
		mapItem:     mapTenorGif,
		fallback:    s.offlineChatGifs(""),
	})
}

func normalizeGifLimit(limit int) int {
	if limit <= 0 {
		return defaultGifLimit
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func mapTenorGif(id, description string, formats map[string]tenorMediaFormat) ChatGifItem {
	gifURL := pickTenorFormat(formats, "gif", "mediumgif", "tinygif")
	previewURL := pickTenorFormat(formats, "tinygif", "nanogif", "gif")
	if previewURL == "" {
		previewURL = gifURL
	}
	label := strings.TrimSpace(description)
	if label == "" {
		label = "gif"
	}
	return ChatGifItem{
		ID:         id,
		Label:      label,
		URL:        gifURL,
		PreviewURL: previewURL,
	}
}
