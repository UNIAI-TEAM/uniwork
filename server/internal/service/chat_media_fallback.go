package service

import "strings"

// Offline catalogs when TENOR_API_KEY is missing or Tenor is unreachable.
// Only IDs verified to return real GIF bytes (not Giphy's "NOT AVAILABLE" placeholder).
var chatGifFallbackItems = []ChatGifItem{
	{ID: "fb-gif-fire", Label: "quá đỉnh", URL: "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif", PreviewURL: "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif"},
	{ID: "fb-gif-yes", Label: "đồng ý", URL: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif", PreviewURL: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif"},
	{ID: "fb-gif-work", Label: "làm việc", URL: "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif", PreviewURL: "https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif"},
	{ID: "fb-gif-dance", Label: "nhảy", URL: "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif", PreviewURL: "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif"},
	{ID: "fb-gif-celebrate", Label: "ăn mừng", URL: "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif", PreviewURL: "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif"},
}

var chatStickerFallbackItems = append([]ChatGifItem(nil), chatGifFallbackItems...)

func filterChatMediaFallback(query string, items []ChatGifItem) []ChatGifItem {
	normalized := strings.ToLower(strings.TrimSpace(query))
	if normalized == "" {
		return append([]ChatGifItem(nil), items...)
	}
	out := make([]ChatGifItem, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Label), normalized) {
			out = append(out, item)
		}
	}
	if len(out) == 0 {
		return append([]ChatGifItem(nil), items...)
	}
	return out
}

func (s *ChatService) offlineChatGifs(query string) []ChatGifItem {
	return filterChatMediaFallback(query, chatGifFallbackItems)
}

func (s *ChatService) offlineChatStickers(query string) []ChatGifItem {
	return filterChatMediaFallback(query, chatStickerFallbackItems)
}
