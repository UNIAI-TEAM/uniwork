package service

import "strings"

// chatMediaAPIKeyAndBase returns the Tenor API key and v2 base URL when configured.
func (s *ChatService) chatMediaAPIKeyAndBase() (apiKey, apiBase string, ok bool) {
	if k := strings.TrimSpace(s.TenorAPIKey); k != "" {
		return k, tenorAPIBase, true
	}
	return "", "", false
}

func (s *ChatService) chatMediaRemoteEnabled() bool {
	_, _, ok := s.chatMediaAPIKeyAndBase()
	return ok
}
